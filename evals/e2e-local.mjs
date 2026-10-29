#!/usr/bin/env node
/**
 * Local end-to-end (no network, no real provider accounts).
 * Exercises built dists: detect -> providers/choice -> plan -> gate -> MCP handlers -> runner allowlist.
 * Run: pnpm build && node evals/e2e-local.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const p of ["packages/scan/dist/index.js", "packages/deploy/dist/index.js", "packages/plan/dist/index.js", "packages/cli/dist/gate.js", "packages/mcp/dist/handlers.js", "packages/core/dist/index.js"]) {
  if (!existsSync(path.join(root, p))) { console.error(`requires built packages: run pnpm build first (missing ${p})`); process.exit(1); }
}
const scan = await import(pathToFileURL(path.join(root, "packages/scan/dist/index.js")));
const deploy = await import(pathToFileURL(path.join(root, "packages/deploy/dist/index.js")));
const plan = await import(pathToFileURL(path.join(root, "packages/plan/dist/index.js")));
const gate = await import(pathToFileURL(path.join(root, "packages/cli/dist/gate.js")));
const mcp = await import(pathToFileURL(path.join(root, "packages/mcp/dist/handlers.js")));
const cliGraph = await import(pathToFileURL(path.join(root, "packages/cli/dist/commands/graph.js"))).catch(() => null);
const cliDomain = await import(pathToFileURL(path.join(root, "packages/cli/dist/commands/domain.js"))).catch(() => null);

let fails = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`); if (!cond) fails++; };

// 1. Detect fixtures
for (const [fx, want] of [["express", "express"], ["fastapi", "fastapi"], ["nextjs", "nextjs"], ["injection", "express"]]) {
  const prof = await scan.detectProfile(path.join(root, "fixtures", fx));
  check(`detect ${fx}`, prof.appType.value === want, prof.appType.value);
}
// 2. Provider registry incl new targets
const providers = await deploy.loadProviders(path.join(root, "providers"));
const ids = providers.map((p) => p.id).sort();
check("registry has 7 providers", ids.length === 7, ids.join(","));
check("modal registered", ids.includes("modal"));
check("cloudflare-workers registered", ids.includes("cloudflare-workers"));

// 3. Choice: modal for python, workers for edge, aws never preselected
check("python API -> modal", deploy.chooseProvider({ isPythonServerless: true, availableProviderIds: ids }).preselectedProviderId === "modal");
check("edge app -> cloudflare-workers", deploy.chooseProvider({ isEdgeSuitable: true, availableProviderIds: ids }).preselectedProviderId === "cloudflare-workers");
check("container+db -> digitalocean", deploy.chooseProvider({ hasContainer: true, hasDatabase: true, availableProviderIds: ids }).preselectedProviderId === "digitalocean");
check("no preselect aws", deploy.chooseProvider({ availableProviderIds: ids }).preselectedProviderId !== "aws");

// 4. Allowlist: new providers allowed, dangerous blocked
const modalModal = providers.find((p) => p.id === "modal");
const wf = providers.find((p) => p.id === "cloudflare-workers");
check("modal deploy allowlisted create", modalModal.allowedPatterns.some((a) => a.pattern === "modal deploy" && a.class === "create"));
check("wrangler deploy allowlisted create", wf.allowedPatterns.some((a) => a.pattern === "wrangler deploy" && a.class === "create"));
check("no credential-file patterns", providers.every((p) => p.allowedPatterns.every((a) => !/\.modal\.toml|credentials|\.aws\//i.test(a.pattern))));

// 5. Plan -> gate summary (<=12 lines)
const planned = plan.planSync({ profile: { appType: "api" }, archetypeOverride: "dev-tool", projectSlug: "e2e-demo" });
check("plan archetype", planned.archetype.id === "dev-tool");
const summary = gate.renderGateSummary({ projectName: "e2e-demo", archetype: planned.archetype.id, channels: planned.plan.channelsRanked.map((c) => c.channel), filePath: "prompt.md", content: "# e2e-demo\n## Start here\nDemo prompt." });
check("gate summary <=12 lines", summary.split("\n").length <= 12, `${summary.split("\n").length} lines`);

// 6. MCP handlers: read ok, write needs confirmation
const handlers = mcp.createHandlers(new mcp.StubBackend());
const list = await handlers.listProviders({});
check("mcp list_providers ok", list.status === "ok");
const dep = await handlers.deploy({ path: ".", provider: "modal" });
check("mcp deploy without confirm blocked", dep.status === "needs_confirmation");

// 7. Graphify + hosting flow: read project -> graph -> Vercel decision -> domain step
const tmp = mkdtempSync(path.join(tmpdir(), "kailashe-e2e-"));
try {
  const nextDir = path.join(tmp, "next-app");
  mkdirSync(path.join(nextDir, "app"), { recursive: true });
  writeFileSync(path.join(nextDir, "package.json"), JSON.stringify({ name: "web", dependencies: { next: "15.0.0", react: "19.0.0" }, scripts: { build: "next build", start: "next start" } }));
  writeFileSync(path.join(nextDir, "app", "page.tsx"), "export default function Page() { return null; }\n");

  // Built-in graph fallback when no Graphify graph exists.
  const graph = await scan.buildProjectGraph(nextDir, { appType: "nextjs" });
  check("builtin graph maps nextjs project", graph.stats.files >= 2 && graph.nodes.some((n) => n.id === "pkg:next"), `${graph.stats.files} files`);
  check("no graphify graph yet -> null", (await scan.loadGraphifyGraph(nextDir)) === null);

  // A Graphify-built graph is picked up and summarized.
  mkdirSync(path.join(nextDir, "graphify-out"), { recursive: true });
  writeFileSync(path.join(nextDir, "graphify-out", "graph.json"), JSON.stringify({
    directed: false, multigraph: false, graph: {},
    nodes: [
      { id: "a", label: "Page", file_type: "code", source_file: "app/page.tsx", community: 0 },
      { id: "b", label: "Layout", file_type: "code", source_file: "app/layout.tsx", community: 0 },
    ],
    links: [{ source: "a", target: "b", relation: "references", confidence: "EXTRACTED" }],
  }));
  const gGraph = await scan.loadGraphifyGraph(nextDir);
  check("graphify graph loads + summarizes", gGraph !== null && scan.summarizeGraphifyGraph(gGraph).godNodes.length === 2);

  // Hosting flow: Next.js fits Vercel -> offered first -> Vercel domain used, domain step skipped.
  if (cliGraph) {
    const report = await cliGraph.buildGraphReport(nextDir);
    check("graph report: graphify source + offer-vercel", report.graphSource === "graphify" && report.nextStep.kind === "offer-vercel", report.profile.appType);
    const vercelFlow = deploy.resolveHostingFlow({ vercelFit: report.vercelFit, chosenProviderId: "vercel", deployedUrl: "web.vercel.app" });
    check("vercel deploy -> use vercel domain (no kailashe.tech step)", vercelFlow.kind === "use-provider-domain" && vercelFlow.url === "https://web.vercel.app");
  } else {
    check("graph report: graphify source + offer-vercel", false, "cli graph dist missing");
  }

  // Non-Vercel deploy -> domain step: claim zi1.kailashe.tech exactly once.
  const registry = new deploy.InMemoryTenantRegistry();
  const dns = new deploy.FakeDnsProvider();
  const claimed = await deploy.provisionSubdomain({ userId: "user-a", label: "zi1", targetHost: "zi1-app.modal.run", registry, dns });
  check("claim zi1 -> https://zi1.kailashe.tech + https", claimed.url === "https://zi1.kailashe.tech" && claimed.https.enabled === true, claimed.https.mode);
  let duplicateBlocked = false;
  try {
    await deploy.provisionSubdomain({ userId: "user-b", label: "zi1", targetHost: "evil.modal.run", registry, dns });
  } catch { duplicateBlocked = true; }
  check("zi1 cannot be claimed twice (unique, once)", duplicateBlocked);
  const ownDomain = deploy.resolveHostingFlow({ vercelFit: deploy.assessVercelFit({ appType: "fastapi", artifactKind: "repo", rendering: "dynamic" }), chosenProviderId: "modal", deployedHost: "zi1-app.modal.run", hasOwnDomain: true, ownDomain: "mysite.com" });
  check("modal deploy + own domain -> DNS settings", ownDomain.kind === "custom-domain" && ownDomain.settings.records[0].value === "zi1-app.modal.run");

  if (cliDomain) {
    const dnsSel = cliDomain.dnsProviderFromEnv({ VERCEL_API_TOKEN: "x" }, "kailashe.tech");
    check("tenant dns: VERCEL_API_TOKEN selects Vercel DNS", dnsSel instanceof deploy.VercelDnsProvider);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails ? `\nE2E FAILED (${fails})` : "\nE2E PASSED");
process.exit(fails ? 1 : 0);
