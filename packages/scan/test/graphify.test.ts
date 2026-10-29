import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GRAPHIFY_PINNED_VERSION,
  graphifyGraphPath,
  graphifySetupLines,
  loadGraphifyGraph,
  summarizeGraphifyGraph,
} from "../src/graphify.js";

const dirs: string[] = [];

function projectWithGraph(graphJson: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "kailashe-graphify-"));
  dirs.push(dir);
  if (graphJson !== null) {
    mkdirSync(join(dir, "graphify-out"), { recursive: true });
    writeFileSync(graphifyGraphPath(dir), graphJson, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// Node-link JSON exactly as Graphify exports it (networkx shape).
const NODE_LINK_GRAPH = JSON.stringify({
  directed: false,
  multigraph: false,
  graph: {},
  nodes: [
    { id: "auth", label: "AuthModule", file_type: "code", source_file: "src/auth.ts", community: 0 },
    { id: "db", label: "Database", file_type: "code", source_file: "src/db.ts", community: 0 },
    { id: "api", label: "ApiRouter", file_type: "code", source_file: "src/api.ts", community: 1 },
    { id: "readme", label: "README", file_type: "document", source_file: "README.md", community: 1 },
  ],
  links: [
    { source: "api", target: "auth", relation: "calls", confidence: "EXTRACTED", confidence_score: 1, weight: 1 },
    { source: "auth", target: "db", relation: "references", confidence: "EXTRACTED", confidence_score: 1, weight: 1 },
    { source: "api", target: "db", relation: "calls", confidence: "INFERRED", confidence_score: 0.7, weight: 1 },
    { source: "readme", target: "auth", relation: "references", confidence: "AMBIGUOUS", confidence_score: 0.4, weight: 1 },
  ],
});

describe("loadGraphifyGraph", () => {
  it("returns null when no Graphify graph exists (built-in fallback case)", async () => {
    const root = projectWithGraph(null);
    await expect(loadGraphifyGraph(root)).resolves.toBeNull();
  });

  it("loads a node-link graph and summarizes god nodes, file types and confidence", async () => {
    const root = projectWithGraph(NODE_LINK_GRAPH);
    const graph = await loadGraphifyGraph(root);
    expect(graph).not.toBeNull();
    expect(graph!.source).toBe("graphify");
    expect(graph!.nodes).toHaveLength(4);
    expect(graph!.links).toHaveLength(4);

    const summary = summarizeGraphifyGraph(graph!);
    expect(summary.nodes).toBe(4);
    expect(summary.links).toBe(4);
    expect(summary.byFileType).toEqual({ code: 3, document: 1 });
    expect(summary.communities).toBe(2);
    // 2 of 4 links EXTRACTED.
    expect(summary.extractedShare).toBe(0.5);
    expect(summary.godNodes[0]).toMatchObject({ label: "AuthModule", sourceFile: "src/auth.ts" });
    expect(summary.godNodes[0]!.degree).toBe(3);
    expect(summary.relations[0]).toEqual({ relation: "calls", count: 2 });
    expect(summary.keyFiles[0]).toBe("src/auth.ts");
  });

  it("throws a clear error on a corrupt graph instead of ignoring it", async () => {
    const root = projectWithGraph("{ not json");
    await expect(loadGraphifyGraph(root)).rejects.toThrow(/not valid JSON/);
    const root2 = projectWithGraph(JSON.stringify({ nodes: "nope" }));
    await expect(loadGraphifyGraph(root2)).rejects.toThrow(/unexpected shape/);
  });
});

describe("graphifySetupLines", () => {
  it("pins the exact Graphify version and uses the pipx route", () => {
    const lines = graphifySetupLines().join("\n");
    expect(lines).toContain(`graphifyy==${GRAPHIFY_PINNED_VERSION}`);
    expect(lines).toContain("graphify install");
    expect(lines).toContain("/graphify .");
    expect(lines).toContain("graphify-out/graph.json");
  });
});
