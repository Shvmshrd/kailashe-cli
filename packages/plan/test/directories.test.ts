import { describe, it, expect } from "vitest";
import {
  vetDirectories,
  importDirectories,
  renderDirectoriesSeedCsv,
  buildListingKit,
  DIRECTORY_SEED_COLUMNS,
  type DirectoryRow,
} from "../src/index.js";

describe("vetDirectories", () => {
  it("drops pay-to-list, link-farm, dead, link-selling and fake-review rows", () => {
    const rows: DirectoryRow[] = [
      { name: "Good", url: "https://good.example", relevance: 5, quality: 5 },
      { name: "PayToList", url: "https://pay.example", payToList: true },
      { name: "PayPriced", url: "https://pay2.example", pricing: "pay-to-list" },
      { name: "Farm", url: "https://farm.example", linkFarm: true },
      { name: "Dead", url: "https://dead.example", dead: true },
      { name: "Links", url: "https://links.example", sellsLinks: true },
      { name: "Reviews", url: "https://reviews.example", sellsFakeReviews: true },
    ];
    const vetted = vetDirectories(rows);
    expect(vetted.map((r) => r.name)).toEqual(["Good"]);
    expect(vetted[0]!.score).toBe(100);
    // pure: input untouched
    expect(rows[0]).not.toHaveProperty("score");
  });

  it("scores and sorts the rest best-first, penalising paid listings", () => {
    const vetted = vetDirectories([
      { name: "Low", url: "https://low.example", relevance: 1, quality: 1 },
      { name: "HighPaid", url: "https://hp.example", relevance: 5, quality: 5, pricing: "paid" },
      { name: "High", url: "https://high.example", relevance: 5, quality: 5 },
    ]);
    expect(vetted.map((r) => r.name)).toEqual(["High", "HighPaid", "Low"]);
    expect(vetted[0]!.score).toBe(100);
    expect(vetted[1]!.score).toBe(90);
    expect(vetted.every((r) => r.score >= 0 && r.score <= 100)).toBe(true);
  });
});

describe("importDirectories + empty seed (Q7)", () => {
  it("seed CSV is header only — no copied rows", () => {
    const seed = renderDirectoriesSeedCsv();
    expect(seed).toBe(DIRECTORY_SEED_COLUMNS.join(","));
    expect(seed.split("\n")).toHaveLength(1);
    expect(importDirectories(seed)).toEqual([]);
  });

  it("parses valid rows (quoted commas, flags, scores)", () => {
    const csv = [
      renderDirectoriesSeedCsv(),
      'Good Dir,https://good.example,AI,free,"Notes, with comma",false,false,false,false,false,5,4',
      "Paid Dir,https://paid.example,Dev,paid,,false,false,true,false,false,4,4",
    ].join("\n");
    const rows = importDirectories(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Good Dir", pricing: "free", relevance: 5, quality: 4, payToList: false });
    expect(rows[0]!.notes).toBe("Notes, with comma");
    expect(vetDirectories(rows).map((r) => r.name)).toEqual(["Good Dir"]);
  });

  it("rejects bad rows and bad headers", () => {
    const header = renderDirectoriesSeedCsv();
    expect(() => importDirectories(`${header}\nNo URL,not-a-url,,,,,,,,,,`)).toThrow(/Invalid directory row 2/);
    expect(() => importDirectories(`${header}\n,https://x.example,,,,,,,,,,`)).toThrow(/Invalid directory row 2/);
    expect(() => importDirectories(`${header}\nBad,https://x.example,,bogus,,,,,,,,`)).toThrow(/pricing/);
    expect(() => importDirectories(`${header}\nBad,https://x.example,,,,maybe,,,,,,`)).toThrow(/dead/);
    expect(() => importDirectories("name,url,unknown_col\nA,https://x.example,1")).toThrow(/unknown column/);
    expect(() => importDirectories("")).toThrow(/missing header/);
    expect(() => importDirectories("url,category\nhttps://x.example,AI")).toThrow(/missing required column "name"/);
  });
});

describe("buildListingKit (channels.md §2)", () => {
  const brief = {
    name: "Widgetly",
    tagline: "Turns messy spreadsheets into clean dashboards",
    description:
      "Widgetly turns messy spreadsheets into clean dashboards for small operations teams. " +
      "It imports CSV files, checks them for errors, and builds shareable dashboards without code. " +
      "Teams use it to report weekly numbers without copying data between tools by hand every Friday.",
    audience: "small operations teams",
    features: ["CSV import with error checks", "shareable dashboards", "no-code setup"],
    pricing: "Free tier, then $12 per month",
    categories: ["Productivity", "Data tools"],
    tags: ["dashboards", "spreadsheets"],
    links: { site: "https://widgetly.example", docs: "https://widgetly.example/docs" },
    founderBio: "Built by a former ops lead.",
    supportEmail: "support@widgetly.example",
    socialHandles: ["@widgetly"],
  };

  it("produces exactly 3 taglines derived from the brief", () => {
    const kit = buildListingKit(brief);
    expect(kit.taglines).toHaveLength(3);
    expect(new Set(kit.taglines).size).toBe(3);
    expect(kit.taglines[0]).toContain("spreadsheets");
  });

  it("produces descriptions at ~160 / ~300 / ~500 chars from brief text only", () => {
    const kit = buildListingKit(brief);
    expect(kit.descriptions.short.length).toBeGreaterThan(120);
    expect(kit.descriptions.short.length).toBeLessThanOrEqual(160);
    expect(kit.descriptions.medium.length).toBeGreaterThan(240);
    expect(kit.descriptions.medium.length).toBeLessThanOrEqual(300);
    expect(kit.descriptions.long.length).toBeGreaterThan(400);
    expect(kit.descriptions.long.length).toBeLessThanOrEqual(500);
    expect(kit.descriptions.short).toContain("Widgetly");
    // No invented superlative claims.
    for (const text of Object.values(kit.descriptions)) {
      expect(text).not.toMatch(/best|fastest|#1|revolutionary/i);
    }
  });

  it("carries categories, links, pricing and the asset checklist", () => {
    const kit = buildListingKit(brief);
    expect(kit.categories).toEqual(["Productivity", "Data tools"]);
    expect(kit.tags).toEqual(["dashboards", "spreadsheets"]);
    expect(kit.links.site).toBe("https://widgetly.example");
    expect(kit.pricingSummary).toContain("$12");
    const items = kit.assetChecklist.map((a) => a.item);
    expect(items).toEqual([
      "Logo (square)",
      "Logo (wide)",
      "Screenshots (3 to 5)",
      "Short demo video link",
      "Founder bio",
      "Support email that works",
      "Pricing summary",
      "Social handles",
    ]);
    expect(kit.assetChecklist.find((a) => a.item === "Founder bio")!.ready).toBe(true);
    expect(kit.assetChecklist.find((a) => a.item === "Logo (square)")!.ready).toBe(false);
    expect(kit.assetChecklist.find((a) => a.item === "Screenshots (3 to 5)")!.ready).toBe(false);
  });

  it("marks provided assets ready and rejects briefs with no source text", () => {
    const kit = buildListingKit({
      ...brief,
      assets: {
        logoSquare: "logo-square.png",
        logoWide: "logo-wide.png",
        screenshots: ["a.png", "b.png", "c.png"],
        demoVideo: "https://widgetly.example/demo",
      },
    });
    expect(kit.assetChecklist.every((a) => a.ready)).toBe(true);
    expect(() => buildListingKit({ name: "Empty" })).toThrow(/tagline, description or what/);
  });
});
