#!/usr/bin/env node
/**
 * Local end-to-end (no network, no real provider accounts).
 * Exercises built dists: detect -> providers/choice -> plan -> gate -> MCP handlers -> runner allowlist.
 * Run: pnpm build && node evals/e2e-local.mjs
 */
import { existsSync } from "node:fs";
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
console.log(fails ? `\nE2E FAILED (${fails})` : "\nE2E PASSED");
process.exit(fails ? 1 : 0);
