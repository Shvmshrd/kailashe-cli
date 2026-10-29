import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraphReport, formatGraphReport } from "../src/commands/graph.js";
import { createDomainCommand } from "../src/commands/domain.js";
import { buildProgram } from "../src/index.js";

const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "kailashe-cli-graph-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const NEXTJS_FILES = {
  "package.json": JSON.stringify({
    name: "web",
    dependencies: { next: "15.0.0", react: "19.0.0" },
    scripts: { build: "next build", start: "next start" },
  }),
  "app/page.tsx": "export default function Page() { return null; }\n",
};

describe("buildGraphReport", () => {
  it("Next.js project: built-in graph, Vercel offered first, domain step skipped for Vercel", async () => {
    const root = fixture(NEXTJS_FILES);
    const report = await buildGraphReport(root);
    expect(report.profile.appType).toBe("nextjs");
    expect(report.graphSource).toBe("builtin");
    expect(report.vercelFit.eligible).toBe(true);
    expect(report.nextStep.kind).toBe("offer-vercel");
    const text = formatGraphReport(report).join("\n");
    expect(text).toContain("Vercel fit: YES");
    expect(text).toContain("kailashe.tech subdomain step is skipped");
    // Built-in fallback tells the user how to get the richer Graphify graph.
    expect(text).toContain("graphifyy==");
  });

  it("Python API project: Vercel does not fit, provider choice comes before any domain step", async () => {
    const root = fixture({
      "requirements.txt": "fastapi==0.115.0\nuvicorn==0.30.0\n",
      "main.py": "from fastapi import FastAPI\napp = FastAPI()\n",
    });
    const report = await buildGraphReport(root);
    expect(report.profile.appType).toBe("fastapi");
    expect(report.vercelFit.eligible).toBe(false);
    expect(report.nextStep.kind).toBe("choose-provider");
    expect(formatGraphReport(report).join("\n")).toContain("Vercel fit: NO");
  });

  it("prefers a Graphify graph when graphify-out/graph.json exists", async () => {
    const root = fixture({
      ...NEXTJS_FILES,
      "graphify-out/graph.json": JSON.stringify({
        directed: false,
        multigraph: false,
        graph: {},
        nodes: [
          { id: "a", label: "Page", file_type: "code", source_file: "app/page.tsx", community: 0 },
          { id: "b", label: "Layout", file_type: "code", source_file: "app/layout.tsx", community: 0 },
        ],
        links: [{ source: "a", target: "b", relation: "references", confidence: "EXTRACTED" }],
      }),
    });
    const report = await buildGraphReport(root);
    expect(report.graphSource).toBe("graphify");
    expect(report.graphify).toMatchObject({ nodes: 2, links: 1 });
    expect(formatGraphReport(report).join("\n")).toContain("Graphify");
  });

  it("rejects a missing directory", async () => {
    await expect(buildGraphReport(join(tmpdir(), "kailashe-does-not-exist-xyz"))).rejects.toThrow(/not found/);
  });
});

describe("graph command registration", () => {
  it("is registered on the program next to domain", () => {
    const names = buildProgram().commands.map((c) => c.name());
    expect(names).toContain("graph");
    expect(names).toContain("domain");
    const domainSubcommands = createDomainCommand().commands.map((c) => c.name());
    expect(domainSubcommands).toContain("setup");
  });
});
