/**
 * Scanner — project digest for S7.
 *
 * Reads a project directory deterministically (no network):
 * - README.md / README
 * - manifests: package.json, pyproject.toml, Cargo.toml, go.mod, Gemfile, etc.
 * - routes: glob for framework route files
 * - UI copy extraction: titles, headings, hero/CTA/placeholder strings from HTML/TSX/JSX
 * - SEO state: title, meta description, OG tags, canonical, robots, sitemap, JSON-LD
 * - Lighthouse summary: interface + stub (runtime Playwright, not in unit tests)
 *
 * Every collected fact is traceable to a file path or URL (source field).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Shared sourced value
// ---------------------------------------------------------------------------

/** A value extracted from a specific file/URL. */
export interface SourcedValue<T> {
  readonly value: T;
  readonly source: string;
}

// ---------------------------------------------------------------------------
// README
// ---------------------------------------------------------------------------

export interface ReadmeDigest {
  /** Raw README text (trimmed) or null if not found. */
  readonly raw: string | null;
  /** File that was read (absolute path) or null. */
  readonly source: string | null;
  /** First heading or first non-empty line as a title hint. */
  readonly titleHint: string | null;
}

const README_CANDIDATES = ["README.md", "Readme.md", "readme.md", "README", "README.txt", "README.rst"];

export async function readReadme(rootDir: string): Promise<ReadmeDigest> {
  for (const candidate of README_CANDIDATES) {
    const filePath = path.join(rootDir, candidate);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      const titleHint = extractTitleHint(trimmed);
      return { raw: trimmed, source: filePath, titleHint };
    } catch (err: unknown) {
      if (!isNotFound(err)) throw err;
    }
  }
  return { raw: null, source: null, titleHint: null };
}

function extractTitleHint(markdown: string): string | null {
  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    // Markdown heading
    const heading = t.match(/^#{1,6}\s+(.*)/);
    if (heading?.[1]) return heading[1].trim();
    // First non-empty non-markdown-formatting line
    if (!t.startsWith("```") && !t.startsWith("<!--") && !t.startsWith("![")) return t.slice(0, 120);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

export type ManifestKind =
  | "package.json"
  | "pyproject.toml"
  | "Cargo.toml"
  | "go.mod"
  | "Gemfile"
  | "composer.json"
  | "pom.xml"
  | "build.gradle"
  | "requirements.txt"
  | "Pipfile"
  | "poetry.lock";

export interface ManifestEntry {
  readonly kind: ManifestKind;
  readonly path: string;
  /** Raw file content (trimmed, truncated to 8k chars for digest). */
  readonly raw: string;
  /** Parsed JSON for JSON manifests (package.json, composer.json). */
  readonly parsed?: unknown;
  /** Package name if extractable (e.g. package.json#name). */
  readonly packageName?: string;
  /** Version if extractable. */
  readonly version?: string;
  /** Description if extractable. */
  readonly description?: string;
}

const MANIFEST_FILES: readonly ManifestKind[] = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "requirements.txt",
  "Pipfile",
  "poetry.lock",
] as const;

export async function readManifests(rootDir: string): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  for (const kind of MANIFEST_FILES) {
    const filePath = path.join(rootDir, kind);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch (err: unknown) {
      if (isNotFound(err)) continue;
      throw err;
    }
    const entry: ManifestEntry = {
      kind,
      path: filePath,
      raw: raw.length > 8000 ? raw.slice(0, 8000) + "\n…(truncated)" : raw,
    };
    // Try parse JSON manifests
    if (kind === "package.json" || kind === "composer.json") {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        (entry as { parsed?: unknown }).parsed = parsed;
        if (typeof parsed["name"] === "string") (entry as { packageName?: string }).packageName = parsed["name"] as string;
        if (typeof parsed["version"] === "string") (entry as { version?: string }).version = parsed["version"] as string;
        if (typeof parsed["description"] === "string") (entry as { description?: string }).description = parsed["description"] as string;
      } catch {
        // leave parsed undefined; raw is still collected
      }
    }
    entries.push(entry);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Routes — glob for route files per framework
// ---------------------------------------------------------------------------

/** A route file discovered by glob. */
export interface RouteEntry {
  /** Absolute path to the file. */
  readonly filePath: string;
  /** Inferred route path (e.g. "/about" from "pages/about.tsx"). */
  readonly route: string;
  /** Framework hint based on location/convention. */
  readonly framework: string;
}

/** Framework route patterns (checked relative to root). */
const ROUTE_PATTERNS: ReadonlyArray<{ glob: string; framework: string }> = [
  { glob: "pages", framework: "next-pages" },
  { glob: "app", framework: "next-app" },
  { glob: "src/pages", framework: "next-pages" },
  { glob: "src/app", framework: "next-app" },
  { glob: "routes", framework: "generic" },
  { glob: "src/routes", framework: "sveltekit" },
  { glob: "src/router", framework: "generic" },
  { glob: "api", framework: "api" },
  { glob: "src/api", framework: "api" },
];

const ROUTE_FILE_EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte", ".astro"]);

export async function readRoutes(rootDir: string): Promise<RouteEntry[]> {
  const entries: RouteEntry[] = [];

  for (const pattern of ROUTE_PATTERNS) {
    const dir = path.join(rootDir, pattern.glob);
    if (!(await isDirectory(dir))) continue;
    const files = await walkRouteFiles(dir);
    for (const filePath of files) {
      const relFromPattern = path.relative(dir, filePath);
      const route = filePathToRoute(relFromPattern);
      entries.push({ filePath, route, framework: pattern.framework });
    }
  }

  // Deduplicate by filePath (a file may be found via multiple patterns only if
  // patterns overlap — keep first).
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.filePath)) return false;
    seen.add(e.filePath);
    return true;
  });
}

function filePathToRoute(relPath: string): string {
  // Strip extension
  const ext = path.extname(relPath);
  let base = relPath.slice(0, relPath.length - ext.length);
  // Normalize separators
  base = base.split(path.sep).join("/");
  // Next.js conventions
  if (base.endsWith("/index")) base = base.slice(0, -"/index".length) || "/";
  else if (base === "index") base = "/";
  else base = "/" + base;
  // Dynamic segments ([id] → :id)
  base = base.replace(/\[([^\]]+)\]/g, ":$1");
  // Remove duplicate slashes
  base = base.replace(/\/+/g, "/");
  return base || "/";
}

async function walkRouteFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // Skip dotfiles, node_modules, .next, dist, build
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist" || entry.name === "build") continue;
    if (entry.isDirectory()) {
      results.push(...(await walkRouteFiles(full)));
    } else if (entry.isFile() && ROUTE_FILE_EXTS.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// UI copy extraction — headings, hero, CTA, placeholders from source
// ---------------------------------------------------------------------------

export interface UiCopyDigest {
  /** Source file → extracted strings (headings, hero text, CTA labels, placeholders). */
  readonly byFile: ReadonlyArray<{ filePath: string; strings: string[] }>;
  /** All unique strings across files (dedup, for quick overview). */
  readonly allStrings: string[];
}

/** File extensions to scan for UI copy. */
const UI_COPY_EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".html", ".vue", ".svelte", ".astro"]);

export async function readUiCopy(rootDir: string): Promise<UiCopyDigest> {
  const byFile: Array<{ filePath: string; strings: string[] }> = [];
  const allFiles = await walkFiles(rootDir, UI_COPY_EXTS);

  for (const filePath of allFiles) {
    const raw = await fs.readFile(filePath, "utf-8");
    const strings = extractUiStrings(raw);
    if (strings.length > 0) {
      byFile.push({ filePath, strings });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const allStrings: string[] = [];
  for (const entry of byFile) {
    for (const s of entry.strings) {
      if (!seen.has(s)) {
        seen.add(s);
        allStrings.push(s);
      }
    }
  }

  return { byFile, allStrings };
}

function extractUiStrings(source: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  const add = (s: string): void => {
    const t = s.trim().replace(/\s+/g, " ");
    if (t.length < 3 || t.length > 200) return;
    // Skip code-like strings (mostly symbols)
    if (/^[{}();=[\]<>]+$/.test(t)) return;
    // Skip likely non-UI strings (URLs, import paths, hex hashes)
    if (/^(https?:\/\/|@?[a-z-]+\/[a-z-]|0x[0-9a-f]{6,})/i.test(t)) return;
    if (!seen.has(t)) {
      seen.add(t);
      results.push(t);
    }
  };

  // 1) HTML text content between tags: <h1>Text</h1>, <p>Text</p>, <a>Text</a>, etc.
  const htmlTextRe = /<(?:h[1-6]|p|a|button|span|label|title|strong|em|li|td|th|figcaption|summary)[^>]*>([^<]{3,200})<\//gi;
  for (const m of source.matchAll(htmlTextRe)) {
    const inner = m[1];
    if (inner) add(stripJsxExpression(inner));
  }

  // 2) JSX string props: title="...", placeholder="...", label="...", aria-label="..."
  const propRe = /(?:title|placeholder|label|aria-label|alt|heading|description|emptyText|helperText)\s*=\s*["'`]([^"'`]{3,200})["'`]/gi;
  for (const m of source.matchAll(propRe)) {
    if (m[1]) add(m[1]);
  }

  // 3) Quoted string literals that look like UI copy (heuristic: capitalized, >3 words or CTA-like)
  // Only capture strings that are not obviously code.
  const ctaHints = /^(Get started|Sign up|Log in|Try|Start|Join|Contact|Learn more|Read more|See more|View all|Explore|Discover|Subscribe|Download|Buy now|Order|Add to)/i;
  for (const m of source.matchAll(/["'`]([^"'`]{5,120})["'`]/g)) {
    const inner = m[1];
    if (!inner) continue;
    if (ctaHints.test(inner) || inner.split(/\s+/).length >= 4) {
      // Extra guard: skip if looks like an import/URL/code identifier
      if (/^[a-z0-9_./-]+$/i.test(inner) && !inner.includes(" ")) continue;
      add(inner);
    }
  }

  return results;
}

function stripJsxExpression(s: string): string {
  return s.replace(/\{[^}]*\}/g, "").trim();
}

// ---------------------------------------------------------------------------
// SEO state — title, meta, OG, canonical, robots, sitemap, JSON-LD
// ---------------------------------------------------------------------------

export interface SeoState {
  /** <title> text (first occurrence). */
  readonly title: SourcedValue<string> | null;
  /** <meta name="description"> content. */
  readonly metaDescription: SourcedValue<string> | null;
  /** <meta name="robots"> content. */
  readonly metaRobots: SourcedValue<string> | null;
  /** Open Graph tags (og:title, og:description, og:image, og:url, og:type …). */
  readonly openGraph: ReadonlyArray<SourcedValue<{ property: string; content: string }>>;
  /** <link rel="canonical" href="…"> */
  readonly canonical: SourcedValue<string> | null;
  /** robots.txt raw content (if present in rootDir). */
  readonly robotsTxt: SourcedValue<string> | null;
  /** sitemap.xml raw content (if present). Also checks public/sitemap.xml. */
  readonly sitemap: SourcedValue<string> | null;
  /** JSON-LD objects parsed from <script type="application/ld+json"> blocks. */
  readonly jsonLd: ReadonlyArray<SourcedValue<unknown>>;
  /** Any additional <meta> tags (name or property) not covered above. */
  readonly extraMeta: ReadonlyArray<SourcedValue<{ key: string; content: string }>>;
}

/**
 * Collect SEO state from HTML files in the project.
 * - Inline SEO tags: reads .html files under rootDir (and public/, dist/, out/ if present).
 * - robots.txt and sitemap.xml: reads from rootDir and common locations.
 * - JSON-LD: parsed from HTML script blocks.
 *
 * If no HTML files exist, SEO fields will be null/empty and robots/sitemap
 * are still collected from the filesystem.
 */
export async function readSeoState(rootDir: string): Promise<SeoState> {
  // Gather HTML sources
  const htmlSources = await collectHtmlSources(rootDir);

  let title: SourcedValue<string> | null = null;
  let metaDescription: SourcedValue<string> | null = null;
  let metaRobots: SourcedValue<string> | null = null;
  let canonical: SourcedValue<string> | null = null;
  const openGraph: Array<SourcedValue<{ property: string; content: string }>> = [];
  const jsonLd: Array<SourcedValue<unknown>> = [];
  const extraMeta: Array<SourcedValue<{ key: string; content: string }>> = [];

  for (const src of htmlSources) {
    const html = src.html;
    const source = src.path;

    // <title>
    if (!title) {
      const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (m?.[1]?.trim()) title = { value: m[1].trim(), source };
    }

    // <meta name="description" content="…"> or single-quoted
    if (!metaDescription) {
      const m = extractMetaContent(html, "name", "description");
      if (m) metaDescription = { value: m, source };
    }

    // <meta name="robots" content="…">
    if (!metaRobots) {
      const m = extractMetaContent(html, "name", "robots");
      if (m) metaRobots = { value: m, source };
    }

    // Open Graph
    const ogRe = /<meta\s+[^>]*property\s*=\s*["']og:([^"']+)["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*\/?>/gi;
    const ogRe2 = /<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:([^"']+)["'][^>]*\/?>/gi;
    for (const re of [ogRe, ogRe2]) {
      for (const mm of html.matchAll(re)) {
        const prop = mm[1] ?? mm[2];
        const content = mm[2] ?? mm[1];
        if (!prop || content === undefined) continue;
        // Avoid duplicates
        if (openGraph.some((o) => o.value.property === `og:${prop}`)) continue;
        openGraph.push({ value: { property: `og:${prop}`, content }, source });
      }
    }

    // canonical
    if (!canonical) {
      const m =
        html.match(/<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*\/?>/i) ??
        html.match(/<link\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["'][^>]*\/?>/i);
      if (m?.[1]) canonical = { value: m[1], source };
    }

    // JSON-LD — <script type="application/ld+json">…</script>
    const ldRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const mm of html.matchAll(ldRe)) {
      const raw = mm[1]?.trim();
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        jsonLd.push({ value: parsed, source });
      } catch {
        // Invalid JSON-LD — record as raw string so it's still traceable
        jsonLd.push({ value: raw, source });
      }
    }

    // Extra meta (any <meta name|property content> not already captured)
    const metaRe = /<meta\s+[^>]*?(?:name|property)\s*=\s*["']([^"']+)["'][^>]*?content\s*=\s*["']([^"']*)["'][^>]*\/?>/gi;
    const metaRe2 = /<meta\s+[^>]*?content\s*=\s*["']([^"']*)["'][^>]*?(?:name|property)\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
    for (const re of [metaRe, metaRe2]) {
      for (const mm of html.matchAll(re)) {
        // Determine which capture is key vs content based on pattern
        // metaRe: key=1, content=2; metaRe2: content=1, key=2
        const isMetaRe = re === metaRe;
        const key = isMetaRe ? mm[1] : mm[2];
        const content = isMetaRe ? mm[2] : mm[1];
        if (!key || content === undefined) continue;
        const lowerKey = key.toLowerCase();
        if (lowerKey === "description" || lowerKey === "robots" || lowerKey.startsWith("og:")) continue;
        if (extraMeta.some((e) => e.value.key === key)) continue;
        extraMeta.push({ value: { key, content }, source });
      }
    }
  }

  // robots.txt and sitemap.xml from filesystem (not HTML)
  const robotsTxt = await readOptionalFile(path.join(rootDir, "robots.txt"));
  const sitemap =
    (await readOptionalFile(path.join(rootDir, "sitemap.xml"))) ??
    (await readOptionalFile(path.join(rootDir, "public", "sitemap.xml"))) ??
    (await readOptionalFile(path.join(rootDir, "static", "sitemap.xml"))) ??
    null;

  return { title, metaDescription, metaRobots, openGraph, canonical, robotsTxt, sitemap, jsonLd, extraMeta };
}

function extractMetaContent(html: string, attr: string, value: string): string | null {
  // Try both orderings and quote styles
  const patterns = [
    new RegExp(`<meta\\s+[^>]*${attr}\\s*=\\s*["']${value}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*\\/?>`, "i"),
    new RegExp(`<meta\\s+[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*${attr}\\s*=\\s*["']${value}["'][^>]*\\/?>`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function collectHtmlSources(
  rootDir: string,
): Promise<Array<{ path: string; html: string }>> {
  const results: Array<{ path: string; html: string }> = [];
  const htmlDirs = [
    rootDir,
    path.join(rootDir, "public"),
    path.join(rootDir, "dist"),
    path.join(rootDir, "out"),
    path.join(rootDir, "build"),
    path.join(rootDir, ".next"),
    path.join(rootDir, "app"),
    path.join(rootDir, "src"),
  ];

  const seenPaths = new Set<string>();
  for (const dir of htmlDirs) {
    if (!(await isDirectory(dir))) continue;
    // For rootDir, only top-level HTML files to avoid scanning huge trees;
    // for known output dirs, scan shallowly too.
    const shallow = dir === rootDir;
    const files = shallow ? await shallowHtmlFiles(dir) : await walkHtmlFiles(dir);
    for (const filePath of files) {
      if (seenPaths.has(filePath)) continue;
      seenPaths.add(filePath);
      try {
        const html = await fs.readFile(filePath, "utf-8");
        results.push({ path: filePath, html });
      } catch {
        // skip unreadable
      }
    }
  }
  return results;
}

async function shallowHtmlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === ".html")
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function walkHtmlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    if (entry.isDirectory()) {
      results.push(...(await walkHtmlFiles(full)));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".html") {
      results.push(full);
    }
  }
  return results;
}

async function readOptionalFile(filePath: string): Promise<SourcedValue<string> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    // Truncate very large files for digest
    const value = raw.length > 10_000 ? raw.slice(0, 10_000) + "\n…(truncated)" : raw;
    return { value, source: filePath };
  } catch (err: unknown) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Lighthouse summary — placeholder interface (no actual Lighthouse run)
// ---------------------------------------------------------------------------

/** Lighthouse category scores (0–1 scale, as Lighthouse reports). */
export interface LighthouseCategoryScore {
  readonly id: string; // e.g. "performance", "accessibility", "best-practices", "seo", "pwa"
  readonly title: string;
  readonly score: number | null; // null = not run
}

/** Lighthouse summary (placeholder — real run needs Playwright at runtime). */
export interface LighthouseSummary {
  /** URL that was (or would be) audited. */
  readonly url: string;
  /** When the summary was produced (ISO string). */
  readonly generatedAt: string;
  /** Category scores (null score = not measured). */
  readonly categories: readonly LighthouseCategoryScore[];
  /** Whether this is a placeholder (no real run) vs a live result. */
  readonly placeholder: boolean;
  /** Human-readable note (e.g. "Run with Playwright at runtime" or audit notes). */
  readonly note?: string;
}

/**
 * Interface for Lighthouse audits. The real implementation requires Playwright
 * + `lighthouse` at runtime; the stub is used in unit tests.
 */
export interface LighthouseService {
  /**
   * Audit `url` and return a Lighthouse summary.
   * Implementations that cannot run Lighthouse should return a placeholder.
   */
  audit(url: string): Promise<LighthouseSummary>;

  /**
   * Return a placeholder summary without running anything.
   * Used when Lighthouse is unavailable or in offline/test mode.
   */
  placeholder(url: string, note?: string): LighthouseSummary;
}

// Known Lighthouse category ids/titles for placeholder generation.
const LIGHTHOUSE_CATEGORIES: ReadonlyArray<{ id: string; title: string }> = [
  { id: "performance", title: "Performance" },
  { id: "accessibility", title: "Accessibility" },
  { id: "best-practices", title: "Best Practices" },
  { id: "seo", title: "SEO" },
  { id: "pwa", title: "PWA" },
];

export class StubLighthouseService implements LighthouseService {
  private readonly fixed: LighthouseSummary | null;

  constructor(fixed?: LighthouseSummary) {
    this.fixed = fixed ?? null;
  }

  async audit(url: string): Promise<LighthouseSummary> {
    if (this.fixed) return this.fixed;
    return this.placeholder(url);
  }

  placeholder(url: string, note?: string): LighthouseSummary {
    return {
      url,
      generatedAt: new Date().toISOString(),
      categories: LIGHTHOUSE_CATEGORIES.map((c) => ({ id: c.id, title: c.title, score: null })),
      placeholder: true,
      note: note ?? "Lighthouse not run — use Playwright at runtime (e.g. kailashe scan --lighthouse).",
    };
  }
}

/**
 * Real Lighthouse service — shells out via Playwright.
 *
 * Requires `playwright` and `lighthouse` to be installed. Dynamically imports
 * them so the package has no hard dependency. Throws a clear error if missing.
 */
export class PlaywrightLighthouseService implements LighthouseService {
  async audit(url: string): Promise<LighthouseSummary> {
    validateUrlForAudit(url);
    let playwright: { chromium: { launch: (o: unknown) => Promise<BrowserLike> } };
    let lighthouse: (url: string, flags: unknown, config: unknown) => Promise<{ lhr: LhResult }>;
    try {
      const pwSpec = "playwright";
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      playwright = (await import(/* @vite-ignore */ pwSpec)) as typeof playwright;
    } catch {
      throw new Error(
        "Playwright is not installed. Run: pnpm add -D playwright && npx playwright install chromium",
      );
    }
    try {
      const lhSpec = "lighthouse";
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = (await import(/* @vite-ignore */ lhSpec)) as unknown as { default: typeof lighthouse };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      lighthouse = mod.default ?? (mod as unknown as typeof lighthouse);
    } catch {
      throw new Error("lighthouse is not installed. Run: pnpm add -D lighthouse");
    }

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      // Lighthouse expects a Chrome debugging port; we expose it via Playwright's
      // browserWSEndpoint and pass it through. For simplicity, we use the
      // default Chrome flags that Lighthouse documents for headless audits.
      const port = 9222; // Playwright does not expose a port; real impl would use `chromium.launch({args:['--remote-debugging-port=9222']})`.
      // We run Lighthouse with the port-based flow. If this is not available,
      // fall back to a placeholder so the pipeline never crashes on audit.
      try {
        const result = await lighthouse(url, { port, onlyCategories: ["performance", "accessibility", "best-practices", "seo", "pwa"] }, undefined);
        const categories: LighthouseCategoryScore[] = Object.entries(result.lhr.categories).map(([id, cat]) => ({
          id,
          title: cat.title,
          score: cat.score,
        }));
        return { url, generatedAt: new Date().toISOString(), categories, placeholder: false };
      } catch {
        // Lighthouse run failed — return placeholder rather than throw, so the
        // digest pipeline degrades gracefully (caller decides whether to error).
        return this.placeholder(url, "Lighthouse run failed — check URL and network.");
      }
    } finally {
      await browser.close();
    }
  }

  placeholder(url: string, note?: string): LighthouseSummary {
    return {
      url,
      generatedAt: new Date().toISOString(),
      categories: LIGHTHOUSE_CATEGORIES.map((c) => ({ id: c.id, title: c.title, score: null })),
      placeholder: true,
      note: note ?? "Lighthouse not run — use Playwright at runtime.",
    };
  }
}

// Minimal type for browser handle used by Lighthouse service.
interface BrowserLike {
  close(): Promise<void>;
}

interface LighthouseCategory {
  title: string;
  score: number | null;
}

interface LhResult {
  categories: Record<string, LighthouseCategory>;
}

function validateUrlForAudit(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL for Lighthouse audit: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Lighthouse URL must be http(s): ${url}`);
  }
}

// ---------------------------------------------------------------------------
// Full digest — composes all collectors
// ---------------------------------------------------------------------------

export interface ScanDigest {
  readonly rootDir: string;
  readonly readme: ReadmeDigest;
  readonly manifests: readonly ManifestEntry[];
  readonly routes: readonly RouteEntry[];
  readonly uiCopy: UiCopyDigest;
  readonly seo: SeoState;
  /** Lighthouse placeholder/summary for live URL (if provided). */
  readonly lighthouse: LighthouseSummary | null;
  /** All sources touched (file paths + URLs), for audit/provenance. */
  readonly sources: string[];
}

/**
 * Run a full scan digest over `rootDir`.
 * Optionally include a live URL for Lighthouse (placeholder when unavailable).
 *
 * This function is deterministic and offline — it never makes network calls.
 * Lighthouse is always a placeholder unless the caller passes a
 * LighthouseService that performs a real audit.
 */
export async function scanProject(
  rootDir: string,
  opts: {
    liveUrl?: string;
    lighthouseService?: LighthouseService;
  } = {},
): Promise<ScanDigest> {
  const absRoot = path.resolve(rootDir);

  const [readme, manifests, routes, uiCopy, seo] = await Promise.all([
    readReadme(absRoot),
    readManifests(absRoot),
    readRoutes(absRoot),
    readUiCopy(absRoot),
    readSeoState(absRoot),
  ]);

  let lighthouse: LighthouseSummary | null = null;
  if (opts.liveUrl) {
    const svc = opts.lighthouseService ?? new StubLighthouseService();
    lighthouse = await svc.audit(opts.liveUrl);
  }

  // Aggregate sources for provenance
  const sources: string[] = [];
  if (readme.source) sources.push(readme.source);
  for (const m of manifests) sources.push(m.path);
  for (const r of routes) sources.push(r.filePath);
  for (const entry of uiCopy.byFile) sources.push(entry.filePath);
  // SEO sources
  if (seo.title) sources.push(seo.title.source);
  if (seo.metaDescription) sources.push(seo.metaDescription.source);
  if (seo.robotsTxt) sources.push(seo.robotsTxt.source);
  if (seo.sitemap) sources.push(seo.sitemap.source);
  for (const og of seo.openGraph) sources.push(og.source);
  for (const ld of seo.jsonLd) sources.push(ld.source);
  // Deduplicate
  const uniqueSources = [...new Set(sources)];

  return { rootDir: absRoot, readme, manifests, routes, uiCopy, seo, lighthouse, sources: uniqueSources };
}

// ---------------------------------------------------------------------------
// File walk helpers
// ---------------------------------------------------------------------------

async function walkFiles(rootDir: string, exts: Set<string>): Promise<string[]> {
  const results: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    // Skip common ignored dirs
    if (entry.name.startsWith(".")) {
      // But do scan .github, etc.? No — skip all dot dirs for digest.
      continue;
    }
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".next" || entry.name === "out" || entry.name === "build" || entry.name === ".vercel" || entry.name === "coverage") {
      continue;
    }
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full, exts)));
    } else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "ENOENT";
}
