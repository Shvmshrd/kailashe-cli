/**
 * Scanner tests — S7 digest collectors.
 *
 * Fixtures are temp dirs with sample repos. No network.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import {
  readReadme,
  readManifests,
  readRoutes,
  readUiCopy,
  readSeoState,
  scanProject,
  StubLighthouseService,
} from "../src/scanner.js";
import type { SeoState } from "../src/scanner.js";

// ---------------------------------------------------------------------------
// Fixture helper — temp dir per test
// ---------------------------------------------------------------------------

let tmpRoot = "";

async function mkTmp(prefix = "scan-test-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(root: string, relPath: string, content: string): Promise<void> {
  const full = path.join(root, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

async function cleanup(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

beforeEach(async () => {
  tmpRoot = await mkTmp();
});

afterEach(async () => {
  if (tmpRoot) await cleanup(tmpRoot);
});

// ---------------------------------------------------------------------------
// readReadme
// ---------------------------------------------------------------------------

describe("readReadme", () => {
  it("reads README.md and extracts titleHint from first heading", async () => {
    await writeFile(tmpRoot, "README.md", "# Acme Widgets\n\nA widget platform.\n");
    const d = await readReadme(tmpRoot);
    expect(d.raw).toContain("Acme Widgets");
    expect(d.source).toBe(path.join(tmpRoot, "README.md"));
    expect(d.titleHint).toBe("Acme Widgets");
  });

  it("falls back to first non-empty line when no heading", async () => {
    await writeFile(tmpRoot, "README.md", "Hello world\n\nSecond line\n");
    const d = await readReadme(tmpRoot);
    expect(d.titleHint).toBe("Hello world");
  });

  it("returns nulls when no README exists", async () => {
    const d = await readReadme(tmpRoot);
    expect(d.raw).toBeNull();
    expect(d.source).toBeNull();
    expect(d.titleHint).toBeNull();
  });

  it("skips empty README files", async () => {
    await writeFile(tmpRoot, "README.md", "   \n");
    await writeFile(tmpRoot, "README", "Fallback content\n");
    const d = await readReadme(tmpRoot);
    // empty README.md is skipped, README fallback read
    expect(d.raw).toContain("Fallback");
  });
});

// ---------------------------------------------------------------------------
// readManifests
// ---------------------------------------------------------------------------

describe("readManifests", () => {
  it("reads package.json and extracts name/version/description", async () => {
    await writeFile(tmpRoot, "package.json", JSON.stringify({ name: "acme-app", version: "1.2.3", description: "Acme app" }));
    const ms = await readManifests(tmpRoot);
    expect(ms).toHaveLength(1);
    const m = ms[0]!;
    expect(m.kind).toBe("package.json");
    expect(m.packageName).toBe("acme-app");
    expect(m.version).toBe("1.2.3");
    expect(m.description).toBe("Acme app");
    expect(m.parsed).toBeDefined();
  });

  it("returns empty when no manifest files present", async () => {
    const ms = await readManifests(tmpRoot);
    expect(ms).toHaveLength(0);
  });

  it("reads multiple manifests and handles non-JSON gracefully", async () => {
    await writeFile(tmpRoot, "package.json", '{"name":"a"}');
    await writeFile(tmpRoot, "go.mod", "module example.com/app\n\ngo 1.21\n");
    await writeFile(tmpRoot, "requirements.txt", "flask==3.0.0\n");
    const ms = await readManifests(tmpRoot);
    expect(ms.length).toBeGreaterThanOrEqual(3);
    const go = ms.find((m) => m.kind === "go.mod");
    expect(go?.raw).toContain("module example.com/app");
  });

  it("truncates very large manifest raw", async () => {
    await writeFile(tmpRoot, "package.json", "x".repeat(9000));
    const ms = await readManifests(tmpRoot);
    expect(ms[0]!.raw).toContain("…(truncated)");
  });
});

// ---------------------------------------------------------------------------
// readRoutes
// ---------------------------------------------------------------------------

describe("readRoutes", () => {
  it("discovers Next.js pages routes and maps to route paths", async () => {
    await writeFile(tmpRoot, "pages/index.tsx", "export default function Home(){}");
    await writeFile(tmpRoot, "pages/about.tsx", "export default function About(){}");
    await writeFile(tmpRoot, "pages/blog/[slug].tsx", "export default function Post(){}");
    const routes = await readRoutes(tmpRoot);
    expect(routes.length).toBeGreaterThanOrEqual(3);
    const byPath = new Map(routes.map((r) => [r.filePath, r]));
    const indexRoute = routes.find((r) => r.filePath.endsWith(path.join("pages", "index.tsx")));
    expect(indexRoute?.route).toBe("/");
    const aboutRoute = routes.find((r) => r.filePath.endsWith(path.join("pages", "about.tsx")));
    expect(aboutRoute?.route).toBe("/about");
    const dynamicRoute = routes.find((r) => r.filePath.endsWith("[slug].tsx"));
    expect(dynamicRoute?.route).toBe("/blog/:slug");
    // sanity: all have framework hint
    for (const r of routes) expect(r.framework.length).toBeGreaterThan(0);
    // all files under pages/ are accounted for
    expect(byPath.size).toBe(routes.length);
  });

  it("handles nested app router", async () => {
    await writeFile(tmpRoot, "app/page.tsx", "");
    await writeFile(tmpRoot, "app/dashboard/page.tsx", "");
    const routes = await readRoutes(tmpRoot);
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty when no route directories present", async () => {
    await writeFile(tmpRoot, "index.html", "<h1>Hi</h1>");
    const routes = await readRoutes(tmpRoot);
    expect(routes).toHaveLength(0);
  });

  it("skips node_modules and dot dirs", async () => {
    await writeFile(tmpRoot, "pages/index.tsx", "");
    await writeFile(tmpRoot, "pages/.hidden/secret.tsx", "");
    await writeFile(tmpRoot, "node_modules/pages/index.tsx", "");
    const routes = await readRoutes(tmpRoot);
    expect(routes.every((r) => !r.filePath.includes("node_modules"))).toBe(true);
    expect(routes.every((r) => !r.filePath.includes(".hidden"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readUiCopy
// ---------------------------------------------------------------------------

describe("readUiCopy", () => {
  it("extracts headings and CTA-adjacent text from TSX/HTML", async () => {
    await writeFile(
      tmpRoot,
      "src/components/Hero.tsx",
      `
      export function Hero() {
        return (
          <section>
            <h1>Build faster with Acme</h1>
            <p>The fastest way to ship your ideas into production.</p>
            <button> Get started free </button>
            <input placeholder="Enter your email" />
          </section>
        );
      }
    `,
    );
    const d = await readUiCopy(tmpRoot);
    expect(d.byFile.length).toBeGreaterThan(0);
    // At least the hero strings show up
    expect(d.allStrings.join(" ")).toMatch(/Build faster with Acme/);
    expect(d.allStrings.join(" ")).toMatch(/Get started free/);
    expect(d.allStrings.join(" ")).toMatch(/Enter your email/);
  });

  it("returns empty when no matching files", async () => {
    await writeFile(tmpRoot, "README.md", "# Hello\n");
    const d = await readUiCopy(tmpRoot);
    expect(d.byFile).toHaveLength(0);
    expect(d.allStrings).toHaveLength(0);
  });

  it("dedupes across files", async () => {
    await writeFile(tmpRoot, "a.tsx", `<h1>Same Title</h1>`);
    await writeFile(tmpRoot, "b.tsx", `<h1>Same Title</h1>`);
    const d = await readUiCopy(tmpRoot);
    expect(d.allStrings.filter((s) => s === "Same Title")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// readSeoState
// ---------------------------------------------------------------------------

describe("readSeoState", () => {
  it("extracts title, meta description, OG, canonical, robots, sitemap, JSON-LD", async () => {
    await writeFile(
      tmpRoot,
      "index.html",
      `<!doctype html><html><head>
        <title>Acme — Ship faster</title>
        <meta name="description" content="The best widget platform.">
        <meta name="robots" content="index, follow">
        <meta property="og:title" content="Acme">
        <meta property="og:image" content="https://example.com/og.png">
        <meta property="og:url" content="https://example.com/">
        <link rel="canonical" href="https://example.com/">
        <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      </head><body><h1>Hi</h1></body></html>`,
    );
    await writeFile(tmpRoot, "robots.txt", "User-agent: *\nAllow: /\n");
    await writeFile(tmpRoot, "sitemap.xml", '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>');

    const seo: SeoState = await readSeoState(tmpRoot);

    expect(seo.title?.value).toBe("Acme — Ship faster");
    expect(seo.metaDescription?.value).toBe("The best widget platform.");
    expect(seo.metaRobots?.value).toBe("index, follow");
    expect(seo.openGraph.some((o) => o.value.property === "og:title" && o.value.content === "Acme")).toBe(true);
    expect(seo.openGraph.some((o) => o.value.property === "og:image")).toBe(true);
    expect(seo.canonical?.value).toBe("https://example.com/");
    expect(seo.robotsTxt?.value).toContain("User-agent");
    expect(seo.sitemap?.value).toContain("<urlset");
    expect(seo.jsonLd.length).toBe(1);
    expect((seo.jsonLd[0]!.value as { name: string }).name).toBe("Acme");
  });

  it("handles canonical with href before rel", async () => {
    await writeFile(
      tmpRoot,
      "index.html",
      `<head><link href="https://example.com/page" rel="canonical"></head>`,
    );
    const seo = await readSeoState(tmpRoot);
    expect(seo.canonical?.value).toBe("https://example.com/page");
  });

  it("parses JSON-LD even when invalid JSON (stores raw)", async () => {
    await writeFile(
      tmpRoot,
      "index.html",
      `<head><script type="application/ld+json">{ not: valid }</script></head>`,
    );
    const seo = await readSeoState(tmpRoot);
    expect(seo.jsonLd.length).toBe(1);
    expect(typeof seo.jsonLd[0]!.value).toBe("string");
  });

  it("collects extra meta tags beyond description/robots/og", async () => {
    await writeFile(
      tmpRoot,
      "index.html",
      `<head>
        <meta name="viewport" content="width=device-width">
        <meta name="author" content="Jane">
      </head>`,
    );
    const seo = await readSeoState(tmpRoot);
    expect(seo.extraMeta.some((m) => m.value.key === "viewport")).toBe(true);
    expect(seo.extraMeta.some((m) => m.value.key === "author")).toBe(true);
  });

  it("reads sitemap from public/ as fallback", async () => {
    await writeFile(tmpRoot, "public/sitemap.xml", "<urlset></urlset>");
    const seo = await readSeoState(tmpRoot);
    expect(seo.sitemap?.value).toContain("<urlset");
  });

  it("returns nulls/empties when no SEO-relevant files", async () => {
    const seo = await readSeoState(tmpRoot);
    expect(seo.title).toBeNull();
    expect(seo.metaDescription).toBeNull();
    expect(seo.openGraph).toHaveLength(0);
    expect(seo.jsonLd).toHaveLength(0);
    expect(seo.robotsTxt).toBeNull();
    expect(seo.sitemap).toBeNull();
  });

  it("handles single-quoted attributes", async () => {
    await writeFile(
      tmpRoot,
      "index.html",
      `<head><title>T</title><meta name='description' content='Hello world'></head>`,
    );
    const seo = await readSeoState(tmpRoot);
    expect(seo.metaDescription?.value).toBe("Hello world");
  });
});

// ---------------------------------------------------------------------------
// scanProject (full digest)
// ---------------------------------------------------------------------------

describe("scanProject full digest", () => {
  it("composes all collectors and returns sources provenance", async () => {
    await writeFile(tmpRoot, "README.md", "# My App\n\nMy app does things.\n");
    await writeFile(tmpRoot, "package.json", JSON.stringify({ name: "my-app", version: "0.1.0", description: "My app" }));
    await writeFile(tmpRoot, "pages/index.tsx", "<h1>Welcome</h1>");
    await writeFile(tmpRoot, "index.html", "<head><title>My App</title></head><body><h1>Welcome</h1></body>");

    const digest = await scanProject(tmpRoot);

    expect(digest.rootDir).toBe(tmpRoot);
    expect(digest.readme.raw).toContain("My App");
    expect(digest.manifests.length).toBe(1);
    expect(digest.routes.length).toBeGreaterThan(0);
    expect(digest.seo.title?.value).toBe("My App");
    expect(digest.lighthouse).toBeNull(); // no liveUrl
    expect(digest.sources.length).toBeGreaterThan(0);
    // Deduplicated
    expect(new Set(digest.sources).size).toBe(digest.sources.length);
  });

  it("attaches a Lighthouse placeholder when liveUrl is given", async () => {
    const digest = await scanProject(tmpRoot, { liveUrl: "https://example.com" });
    expect(digest.lighthouse).not.toBeNull();
    expect(digest.lighthouse!.placeholder).toBe(true);
    expect(digest.lighthouse!.url).toBe("https://example.com");
    expect(digest.lighthouse!.categories.length).toBeGreaterThan(0);
    expect(digest.lighthouse!.categories.every((c) => c.score === null)).toBe(true);
  });

  it("respects a custom LighthouseService", async () => {
    const svc = new StubLighthouseService({
      url: "https://example.com",
      generatedAt: new Date().toISOString(),
      categories: [{ id: "performance", title: "Performance", score: 0.9 }],
      placeholder: false,
      note: "custom",
    });
    const digest = await scanProject(tmpRoot, { liveUrl: "https://example.com", lighthouseService: svc });
    expect(digest.lighthouse!.placeholder).toBe(false);
    expect(digest.lighthouse!.categories[0]!.score).toBe(0.9);
  });

  it("works on an empty project (no crash, empty digest)", async () => {
    const digest = await scanProject(tmpRoot);
    expect(digest.readme.raw).toBeNull();
    expect(digest.manifests).toHaveLength(0);
    expect(digest.routes).toHaveLength(0);
    expect(digest.sources).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lighthouse placeholder invariants
// ---------------------------------------------------------------------------

describe("StubLighthouseService", () => {
  it("placeholder has all expected categories with null scores", async () => {
    const svc = new StubLighthouseService();
    const s = svc.placeholder("https://example.com");
    expect(s.placeholder).toBe(true);
    expect(s.url).toBe("https://example.com");
    const ids = s.categories.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["performance", "accessibility", "seo"]));
    for (const c of s.categories) expect(c.score).toBeNull();
    expect(s.note).toBeDefined();
  });

  it("audit returns placeholder when no fixed result", async () => {
    const svc = new StubLighthouseService();
    const s = await svc.audit("https://example.com");
    expect(s.placeholder).toBe(true);
  });
});
