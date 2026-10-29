/**
 * Built-in project graph ("graphify-lite") — a deterministic, dependency-free
 * map of a project: files, directories, npm packages, and the import edges
 * between them. This is the always-available fallback used when no Graphify
 * graph exists yet (see graphify.ts for ingesting Graphify's richer output).
 *
 * No network, no subprocesses, bounded walk. Only file *paths* and import
 * specifiers are read — never file contents beyond import statements, and
 * never secret values (a `.env` file is a node; its contents are not read).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas (validated at the boundary: anything Kailashe hands onward)
// ---------------------------------------------------------------------------

export const ProjectGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["project", "directory", "file", "package", "framework"]),
  label: z.string().min(1),
  path: z.string().optional(),
}).strict();
export type ProjectGraphNode = z.infer<typeof ProjectGraphNodeSchema>;

export const ProjectGraphEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  kind: z.enum(["contains", "imports", "depends-on", "detected-as"]),
}).strict();
export type ProjectGraphEdge = z.infer<typeof ProjectGraphEdgeSchema>;

export const ProjectGraphSchema = z.object({
  source: z.literal("builtin"),
  root: z.string(),
  nodes: z.array(ProjectGraphNodeSchema),
  edges: z.array(ProjectGraphEdgeSchema),
  entrypoints: z.array(z.string()),
  stats: z.object({
    files: z.number().int().nonnegative(),
    directories: z.number().int().nonnegative(),
    packages: z.number().int().nonnegative(),
    importEdges: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type ProjectGraph = z.infer<typeof ProjectGraphSchema>;

// ---------------------------------------------------------------------------
// Walk + parse helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  ".vercel", "__pycache__", "graphify-out", ".kailashe", "target", "vendor",
]);
const CODE_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rb", ".vue", ".svelte", ".astro"]);
const KEY_FILES = new Set([
  "package.json", "tsconfig.json", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
  "vercel.json", "wrangler.toml", "wrangler.json", "fly.toml", "modal.toml",
  "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile", "composer.json",
]);
const CONFIG_RE = /^(next|vite|nuxt|svelte|astro|remix|tailwind|eslint|prettier)\.config\.[^.]+$/;
const MAX_FILES = 400;
const MAX_FILE_BYTES = 200_000;
const ENTRYPOINT_RE = /(^|\/)(index|main|server|app|mod)\.(ts|tsx|js|jsx|mjs|py)$/;

const PackageJsonSchema = z.object({
  name: z.string().optional(),
  dependencies: z.record(z.string()).optional(),
  devDependencies: z.record(z.string()).optional(),
}).passthrough();

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

function barePackageName(spec: string): string {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split("/")[0] ?? spec;
}

function resolveRelativeImport(fromRel: string, spec: string, fileIds: ReadonlySet<string>): string | undefined {
  const dir = path.posix.dirname(fromRel);
  const base = path.posix.normalize(path.posix.join(dir, spec));
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".py"].map((ext) => base + ext),
    ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((ext) => `${base}/index${ext}`),
  ];
  for (const candidate of candidates) {
    if (fileIds.has(`file:${candidate}`)) return `file:${candidate}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildProjectGraphOptions {
  /** Detected app type (e.g. "nextjs") attached as a framework node. */
  appType?: string;
  /** Detected framework label (e.g. "Next.js 15") attached as framework node. */
  framework?: string | null;
}

export async function buildProjectGraph(
  rootDir: string,
  options: BuildProjectGraphOptions = {},
): Promise<ProjectGraph> {
  const root = path.resolve(rootDir);
  const nodes = new Map<string, ProjectGraphNode>();
  const edges: ProjectGraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const addNode = (node: ProjectGraphNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (edge: ProjectGraphEdge): void => {
    const key = `${edge.source}|${edge.kind}|${edge.target}`;
    if (edgeKeys.has(key) || edge.source === edge.target) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  addNode({ id: "project:root", kind: "project", label: path.basename(root) || root, path: "." });

  // -- walk -----------------------------------------------------------------
  const fileRels: string[] = [];
  const dirRels = new Set<string>();
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6 || fileRels.length >= MAX_FILES) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (fileRels.length >= MAX_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      const rel = toPosix(path.relative(root, full));
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          dirRels.add(rel);
          await walk(full, depth + 1);
        }
      } else if (entry.isFile()) {
        if (CODE_EXTS.has(path.extname(entry.name).toLowerCase()) || KEY_FILES.has(entry.name) || CONFIG_RE.test(entry.name)) {
          fileRels.push(rel);
        }
      }
    }
  }
  await walk(root, 0);

  // Directory nodes only for directories that (transitively) hold kept files.
  const dirsWithFiles = new Set<string>();
  for (const rel of fileRels) {
    let dir = path.posix.dirname(rel);
    while (dir !== "." && dir !== "") {
      dirsWithFiles.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  for (const dir of [...dirsWithFiles].sort()) {
    addNode({ id: `dir:${dir}`, kind: "directory", label: dir, path: dir });
    const parent = path.posix.dirname(dir);
    addEdge({
      source: parent === "." || parent === "" ? "project:root" : `dir:${parent}`,
      target: `dir:${dir}`,
      kind: "contains",
    });
  }

  const fileIds = new Set<string>();
  for (const rel of fileRels) {
    const id = `file:${rel}`;
    fileIds.add(id);
    addNode({ id, kind: "file", label: path.posix.basename(rel), path: rel });
    const parent = path.posix.dirname(rel);
    addEdge({
      source: parent === "." || parent === "" ? "project:root" : `dir:${parent}`,
      target: id,
      kind: "contains",
    });
  }

  // -- package.json: dependencies become package nodes -----------------------
  const packageNames = new Set<string>();
  const pkgJsonPath = path.join(root, "package.json");
  try {
    const raw = await fs.readFile(pkgJsonPath, "utf-8");
    const parsed = PackageJsonSchema.safeParse(JSON.parse(raw) as unknown);
    if (parsed.success) {
      const all = { ...(parsed.data.dependencies ?? {}), ...(parsed.data.devDependencies ?? {}) };
      for (const name of Object.keys(all).sort()) {
        packageNames.add(name);
        addNode({ id: `pkg:${name}`, kind: "package", label: name });
        addEdge({ source: "project:root", target: `pkg:${name}`, kind: "depends-on" });
      }
    }
  } catch {
    // No readable package.json: the graph is still useful without packages.
  }

  // -- import edges ------------------------------------------------------------
  let importEdges = 0;
  for (const rel of fileRels) {
    if (!CODE_EXTS.has(path.extname(rel).toLowerCase())) continue;
    let content: string;
    try {
      const stat = await fs.stat(path.join(root, rel));
      if (stat.size > MAX_FILE_BYTES) continue;
      content = await fs.readFile(path.join(root, rel), "utf-8");
    } catch {
      continue;
    }
    for (const match of content.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const target = resolveRelativeImport(rel, spec, fileIds);
        if (target) {
          addEdge({ source: `file:${rel}`, target, kind: "imports" });
          importEdges += 1;
        }
      } else if (!spec.startsWith("node:")) {
        const pkg = barePackageName(spec);
        if (packageNames.has(pkg)) {
          addEdge({ source: `file:${rel}`, target: `pkg:${pkg}`, kind: "imports" });
          importEdges += 1;
        }
      }
    }
  }

  // -- framework / app-type node ------------------------------------------------
  const frameworkLabel = options.framework ?? options.appType;
  if (frameworkLabel) {
    addNode({ id: `framework:${frameworkLabel}`, kind: "framework", label: frameworkLabel });
    addEdge({ source: "project:root", target: `framework:${frameworkLabel}`, kind: "detected-as" });
  }

  const entrypoints = fileRels.filter((rel) => ENTRYPOINT_RE.test(rel)).sort();

  const graph: ProjectGraph = {
    source: "builtin",
    root,
    nodes: [...nodes.values()],
    edges,
    entrypoints,
    stats: {
      files: fileRels.length,
      directories: dirsWithFiles.size,
      packages: packageNames.size,
      importEdges,
    },
  };
  return ProjectGraphSchema.parse(graph);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface ProjectGraphSummary {
  source: "builtin";
  files: number;
  directories: number;
  packages: number;
  importEdges: number;
  entrypoints: string[];
  /** Most-connected nodes (by degree), highest first, max 5. */
  topConnected: Array<{ label: string; kind: string; degree: number }>;
}

export function summarizeProjectGraph(graph: ProjectGraph): ProjectGraphSummary {
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const topConnected = [...degree.entries()]
    .filter(([id]) => id !== "project:root")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([id, deg]) => {
      const node = byId.get(id);
      return { label: node?.label ?? id, kind: node?.kind ?? "file", degree: deg };
    });
  return {
    source: "builtin",
    files: graph.stats.files,
    directories: graph.stats.directories,
    packages: graph.stats.packages,
    importEdges: graph.stats.importEdges,
    entrypoints: graph.entrypoints,
    topConnected,
  };
}
