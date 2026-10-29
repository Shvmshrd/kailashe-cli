/**
 * Graphify ingestion — read and summarize a knowledge graph produced by
 * Graphify (https://github.com/Graphify-Labs/graphify, PyPI package
 * `graphifyy`, Apache-2.0), the optional external tool Kailashe uses for
 * deep codebase understanding.
 *
 * How Graphify works (verified against its README/skill): the user installs
 * it themselves (`pipx install graphifyy`), runs `graphify install` once,
 * then `/graphify .` inside their AI assistant, which writes
 * `graphify-out/graph.json` — a NetworkX node-link JSON (`nodes` + `links`).
 * Graphify has no non-interactive build subcommand, so Kailashe never tries
 * to execute it: Kailashe only READS that file, validates it with Zod at
 * the boundary, and falls back to the built-in graph (graph.ts) when no
 * Graphify graph exists. The exact pinned setup commands are provided by
 * graphifySetupLines() for the CLI to print.
 *
 * Node attrs (from Graphify's export): id, label, file_type
 * (code|document|paper|image), source_file, source_location.
 * Link attrs: source, target, relation (calls|implements|references|...),
 * confidence (EXTRACTED|INFERRED|AMBIGUOUS), confidence_score, weight.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

/** Pinned upstream version Kailashe's setup instructions recommend. */
export const GRAPHIFY_PINNED_VERSION = "0.9.97";
export const GRAPHIFY_PACKAGE = "graphifyy";
export const GRAPHIFY_LICENSE = "Apache-2.0";

/** Commands the CLI prints so the user can enable Graphify themselves. */
export function graphifySetupLines(): string[] {
  return [
    "Graphify (optional) builds a much richer project graph — code, docs, schemas — that Kailashe can read:",
    `  pipx install ${GRAPHIFY_PACKAGE}==${GRAPHIFY_PINNED_VERSION}   (or: uv tool install ${GRAPHIFY_PACKAGE}==${GRAPHIFY_PINNED_VERSION})`,
    "  graphify install                 # registers the /graphify skill with your assistant",
    "  /graphify .                      # inside Claude Code: writes graphify-out/graph.json",
    "Kailashe reads graphify-out/graph.json automatically when it exists (you stay in control of installs).",
  ];
}

// ---------------------------------------------------------------------------
// Schemas — tolerant at the boundary (Graphify versions evolve), strict on
// the fields Kailashe actually consumes.
// ---------------------------------------------------------------------------

const GraphifyNodeSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  label: z.string().optional(),
  file_type: z.string().optional(),
  source_file: z.string().optional(),
  source_location: z.string().optional(),
  community: z.union([z.string(), z.number()]).optional(),
}).passthrough();

const GraphifyLinkSchema = z.object({
  source: z.union([z.string(), z.number()]).transform((v) => String(v)),
  target: z.union([z.string(), z.number()]).transform((v) => String(v)),
  relation: z.string().optional(),
  confidence: z.string().optional(),
  confidence_score: z.number().optional(),
  weight: z.number().optional(),
}).passthrough();

const GraphifyFileSchema = z.object({
  nodes: z.array(GraphifyNodeSchema).default([]),
  links: z.array(GraphifyLinkSchema).optional(),
  edges: z.array(GraphifyLinkSchema).optional(),
}).passthrough();

export interface GraphifyNode {
  id: string;
  label?: string;
  fileType?: string;
  sourceFile?: string;
  sourceLocation?: string;
  community?: string;
}

export interface GraphifyLink {
  source: string;
  target: string;
  relation?: string;
  confidence?: string;
  confidenceScore?: number;
  weight?: number;
}

export interface GraphifyGraph {
  source: "graphify";
  graphPath: string;
  nodes: GraphifyNode[];
  links: GraphifyLink[];
}

export function graphifyGraphPath(rootDir: string): string {
  return path.join(path.resolve(rootDir), "graphify-out", "graph.json");
}

/**
 * Load `<root>/graphify-out/graph.json`. Returns null when no Graphify graph
 * exists (the normal case -> built-in fallback). Throws when the file exists
 * but is unreadable/corrupt, so a broken graph is never silently ignored.
 */
export async function loadGraphifyGraph(rootDir: string): Promise<GraphifyGraph | null> {
  const graphPath = graphifyGraphPath(rootDir);
  let raw: string;
  try {
    raw = await fs.readFile(graphPath, "utf-8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Graphify graph at ${graphPath} is not valid JSON; rebuild it with /graphify . or delete graphify-out/.`);
  }
  const parsed = GraphifyFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Graphify graph at ${graphPath} has an unexpected shape; rebuild it with /graphify . or delete graphify-out/.`);
  }
  const nodes: GraphifyNode[] = parsed.data.nodes.map((n) => ({
    id: n.id,
    ...(n.label !== undefined ? { label: n.label } : {}),
    ...(n.file_type !== undefined ? { fileType: n.file_type } : {}),
    ...(n.source_file !== undefined ? { sourceFile: n.source_file } : {}),
    ...(n.source_location !== undefined ? { sourceLocation: n.source_location } : {}),
    ...(n.community !== undefined ? { community: String(n.community) } : {}),
  }));
  const rawLinks = parsed.data.links ?? parsed.data.edges ?? [];
  const links: GraphifyLink[] = rawLinks.map((l) => ({
    source: l.source,
    target: l.target,
    ...(l.relation !== undefined ? { relation: l.relation } : {}),
    ...(l.confidence !== undefined ? { confidence: l.confidence } : {}),
    ...(l.confidence_score !== undefined ? { confidenceScore: l.confidence_score } : {}),
    ...(l.weight !== undefined ? { weight: l.weight } : {}),
  }));
  return { source: "graphify", graphPath, nodes, links };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface GraphifyGraphSummary {
  source: "graphify";
  nodes: number;
  links: number;
  byFileType: Record<string, number>;
  /** Share of links Graphify extracted directly from source (vs inferred). */
  extractedShare: number | null;
  relations: Array<{ relation: string; count: number }>;
  communities: number;
  /** Highest-degree nodes ("god nodes") — the concepts everything touches. */
  godNodes: Array<{ label: string; degree: number; sourceFile?: string }>;
  /** Code files with the most graph presence — good entrypoint candidates. */
  keyFiles: string[];
}

export function summarizeGraphifyGraph(graph: GraphifyGraph): GraphifyGraphSummary {
  const byFileType: Record<string, number> = {};
  const communities = new Set<string>();
  for (const node of graph.nodes) {
    const kind = node.fileType ?? "unknown";
    byFileType[kind] = (byFileType[kind] ?? 0) + 1;
    if (node.community !== undefined) communities.add(node.community);
  }

  const relationCounts = new Map<string, number>();
  const degree = new Map<string, number>();
  let extracted = 0;
  let withConfidence = 0;
  for (const link of graph.links) {
    const relation = link.relation ?? "related";
    relationCounts.set(relation, (relationCounts.get(relation) ?? 0) + 1);
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
    if (link.confidence !== undefined) {
      withConfidence += 1;
      if (link.confidence.toUpperCase() === "EXTRACTED") extracted += 1;
    }
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const godNodes = [...degree.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([id, deg]) => {
      const node = byId.get(id);
      return {
        label: node?.label ?? id,
        degree: deg,
        ...(node?.sourceFile !== undefined ? { sourceFile: node.sourceFile } : {}),
      };
    });

  const fileDegree = new Map<string, number>();
  for (const [id, deg] of degree) {
    const file = byId.get(id)?.sourceFile;
    if (file) fileDegree.set(file, (fileDegree.get(file) ?? 0) + deg);
  }
  const keyFiles = [...fileDegree.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([file]) => file);

  return {
    source: "graphify",
    nodes: graph.nodes.length,
    links: graph.links.length,
    byFileType,
    extractedShare: withConfidence > 0 ? extracted / withConfidence : null,
    relations: [...relationCounts.entries()]
      .map(([relation, count]) => ({ relation, count }))
      .sort((a, b) => b.count - a.count || a.relation.localeCompare(b.relation))
      .slice(0, 8),
    communities: communities.size,
    godNodes,
    keyFiles,
  };
}
