import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProjectGraph, summarizeProjectGraph } from "../src/graph.js";

const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "kailashe-graph-"));
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

describe("buildProjectGraph", () => {
  it("maps files, packages, contains edges and resolved imports", async () => {
    const root = fixture({
      "package.json": JSON.stringify({
        name: "demo",
        dependencies: { next: "15.0.0", react: "19.0.0" },
        devDependencies: { typescript: "5.8.2" },
      }),
      "src/index.ts": "import { util } from './util';\nimport React from 'react';\nexport const x = util(React);\n",
      "src/util.ts": "export function util(r: unknown) { return r; }\n",
      "node_modules/junk/index.js": "import './src/index';\n",
    });

    const graph = await buildProjectGraph(root, { framework: "Next.js 15", appType: "nextjs" });

    expect(graph.source).toBe("builtin");
    const kinds = graph.nodes.map((n) => n.kind);
    expect(kinds).toContain("package");
    expect(graph.nodes.find((n) => n.id === "pkg:next")).toBeDefined();
    expect(graph.nodes.find((n) => n.id === "framework:Next.js 15")).toBeDefined();

    // node_modules is skipped entirely.
    expect(graph.nodes.some((n) => n.id.includes("junk"))).toBe(false);

    expect(graph.edges).toContainEqual({ source: "project:root", target: "pkg:react", kind: "depends-on" });
    expect(graph.edges).toContainEqual({ source: "file:src/index.ts", target: "file:src/util.ts", kind: "imports" });
    expect(graph.edges).toContainEqual({ source: "file:src/index.ts", target: "pkg:react", kind: "imports" });
    expect(graph.edges).toContainEqual({ source: "project:root", target: "framework:Next.js 15", kind: "detected-as" });
    expect(graph.entrypoints).toContain("src/index.ts");
    expect(graph.stats).toMatchObject({ files: 3, packages: 3 });

    const summary = summarizeProjectGraph(graph);
    expect(summary.source).toBe("builtin");
    expect(summary.importEdges).toBe(graph.stats.importEdges);
    expect(summary.topConnected.length).toBeGreaterThan(0);
  });

  it("survives a project with no package.json", async () => {
    const root = fixture({ "main.py": "print('hi')\n" });
    const graph = await buildProjectGraph(root);
    expect(graph.stats.packages).toBe(0);
    expect(graph.nodes.some((n) => n.id === "file:main.py")).toBe(true);
    expect(graph.entrypoints).toContain("main.py");
  });

  it("is deterministic across runs", async () => {
    const root = fixture({
      "a.ts": "import './b';\n",
      "b.ts": "export const b = 1;\n",
    });
    const first = await buildProjectGraph(root);
    const second = await buildProjectGraph(root);
    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
  });
});
