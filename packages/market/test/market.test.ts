/**
 * Market module tests — S8 (SPEC §6.6, F3.4, §8; TASKS S8).
 *
 * Fake providers only. No network, no real API keys, no `any`.
 * Every figure is expected to carry source, date and region
 * (market-research.md §12); missing data lands in unknowns[], never
 * as a guessed figure and never as a crash.
 */
import { describe, it, expect } from "vitest";
import {
  runMarketResearch,
  computeScore,
  clusterKeywords,
  MarketBudget,
  MarketBudgetExceededError,
  MarketCache,
  isBudgetUnset,
  resolveBudgetCap,
  BUDGET_ENABLING_LINE,
  MARKET_BUDGET_ENV,
  MarketSchema,
  TrendSchema,
  ClusterSchema,
} from "../src/index.js";
import type {
  TrendsProvider,
  KeywordsProvider,
  SerpProvider,
  CostEstimator,
  TrendDatum,
  KeywordDatum,
  SerpDatum,
} from "../src/index.js";
import { SemrushAdapter } from "../src/adapters/semrush.js";
import { AhrefsAdapter } from "../src/adapters/ahrefs.js";
import { TrendsAlphaAdapter } from "../src/adapters/trends-alpha.js";
import { SerpApiAdapter } from "../src/adapters/serpapi.js";
import { DataForSEOAdapter } from "../src/adapters/dataforseo.js";

// ---------------------------------------------------------------------------
// Recorded fixture data (fixed dates/regions so runs are stable)
// ---------------------------------------------------------------------------

const FIXTURE_DATE = "2026-10-29";
const FIXTURE_REGION = "US";

const RECORDED_TRENDS: TrendDatum[] = [
  { term: "invoice tool", shape: "rising", range: "2021-11-01..2026-10-29", region: FIXTURE_REGION, confidence: "high", source: "fake-trends", date: FIXTURE_DATE },
  { term: "best invoice tool", shape: "steady", range: "2021-11-01..2026-10-29", region: FIXTURE_REGION, confidence: "medium", source: "fake-trends", date: FIXTURE_DATE },
];

const RECORDED_KEYWORDS: KeywordDatum[] = [
  { keyword: "best invoice tool", volume: 1000, difficulty: 20, intent: "commercial", source: "fake-keywords", date: FIXTURE_DATE, region: FIXTURE_REGION },
  { keyword: "best invoice tool for freelancers", volume: 500, difficulty: 30, intent: "commercial", source: "fake-keywords", date: FIXTURE_DATE, region: FIXTURE_REGION },
  { keyword: "invoice tool pricing", volume: 300, difficulty: 10, intent: "transactional", source: "fake-keywords", date: FIXTURE_DATE, region: FIXTURE_REGION },
  { keyword: "invoice tool alternative", volume: 400, difficulty: 40, intent: "commercial", source: "fake-keywords", date: FIXTURE_DATE, region: FIXTURE_REGION },
  { keyword: "how to invoice clients", volume: 800, difficulty: 15, intent: "informational", source: "fake-keywords", date: FIXTURE_DATE, region: FIXTURE_REGION },
];

const RECORDED_SERP: SerpDatum[] = [
  {
    keyword: "best invoice tool",
    results: [
      { url: "https://example.com/a", title: "A", snippet: "a", position: 1 },
      { url: "https://example.com/b", title: "B", snippet: "b", position: 2 },
    ],
    source: "fake-serp",
    date: FIXTURE_DATE,
    region: FIXTURE_REGION,
  },
];

// ---------------------------------------------------------------------------
// Fake providers implementing the S8 interfaces (count calls, never network)
// ---------------------------------------------------------------------------

class FakeTrendsProvider implements TrendsProvider, CostEstimator {
  readonly name = "fake-trends";
  calls = 0;
  lastTerms: string[] = [];
  constructor(
    private readonly data: TrendDatum[],
    private readonly costPerTerm = 0.01,
    private readonly failure: Error | null = null,
  ) {}
  estimateCost(termCount: number): number {
    return termCount * this.costPerTerm;
  }
  async fetch(terms: string[]): Promise<TrendDatum[]> {
    this.calls += 1;
    this.lastTerms = [...terms];
    if (this.failure) throw this.failure;
    return [...this.data];
  }
}

class FakeKeywordsProvider implements KeywordsProvider, CostEstimator {
  readonly name = "fake-keywords";
  calls = 0;
  lastTerms: string[] = [];
  constructor(
    private readonly data: KeywordDatum[],
    private readonly costPerTerm = 0.01,
    private readonly failure: Error | null = null,
  ) {}
  estimateCost(termCount: number): number {
    return termCount * this.costPerTerm;
  }
  async fetch(seedTerms: string[]): Promise<KeywordDatum[]> {
    this.calls += 1;
    this.lastTerms = [...seedTerms];
    if (this.failure) throw this.failure;
    return [...this.data];
  }
}

class FakeSerpProvider implements SerpProvider, CostEstimator {
  readonly name = "fake-serp";
  calls = 0;
  lastTerms: string[] = [];
  constructor(
    private readonly data: SerpDatum[],
    private readonly costPerTerm = 0.01,
    private readonly failure: Error | null = null,
  ) {}
  estimateCost(termCount: number): number {
    return termCount * this.costPerTerm;
  }
  async fetch(keywords: string[]): Promise<SerpDatum[]> {
    this.calls += 1;
    this.lastTerms = [...keywords];
    if (this.failure) throw this.failure;
    return [...this.data];
  }
}

function paidFakes(): { trends: FakeTrendsProvider; keywords: FakeKeywordsProvider; serp: FakeSerpProvider } {
  return {
    trends: new FakeTrendsProvider(RECORDED_TRENDS),
    keywords: new FakeKeywordsProvider(RECORDED_KEYWORDS),
    serp: new FakeSerpProvider(RECORDED_SERP),
  };
}

const ENABLED_ENV: Record<string, string> = { [MARKET_BUDGET_ENV]: "10" };

// ---------------------------------------------------------------------------
// Budget guard — unset: no paid calls, unknowns[] + enabling line (F3.4)
// ---------------------------------------------------------------------------

describe("budget guard: unset budget", () => {
  it("treats missing, empty and invalid values as unset", () => {
    expect(isBudgetUnset({})).toBe(true);
    expect(isBudgetUnset({ [MARKET_BUDGET_ENV]: "" })).toBe(true);
    expect(isBudgetUnset({ [MARKET_BUDGET_ENV]: "not-a-number" })).toBe(true);
    expect(isBudgetUnset({ [MARKET_BUDGET_ENV]: "-5" })).toBe(true);
    expect(isBudgetUnset({ [MARKET_BUDGET_ENV]: "Infinity" })).toBe(true);
    expect(resolveBudgetCap({})).toBeNull();
    expect(resolveBudgetCap({ [MARKET_BUDGET_ENV]: "not-a-number" })).toBeNull();
    expect(resolveBudgetCap({ [MARKET_BUDGET_ENV]: "-5" })).toBeNull();
    expect(resolveBudgetCap({ [MARKET_BUDGET_ENV]: "2.50" })).toBe(2.5);
    expect(resolveBudgetCap({ [MARKET_BUDGET_ENV]: "0" })).toBe(0);
    expect(new MarketBudget({}).isUnset).toBe(true);
    expect(new MarketBudget({ [MARKET_BUDGET_ENV]: "not-a-number" }).isUnset).toBe(true);
  });

  it("makes no paid provider calls and emits unknowns plus the enabling line", async () => {
    const fakes = paidFakes();
    const market = await runMarketResearch(
      { seedTerms: ["invoice tool"], archetype: "b2b-saas", icp: "freelance designers", date: FIXTURE_DATE, region: FIXTURE_REGION, env: {} },
      fakes,
    );
    expect(fakes.trends.calls).toBe(0);
    expect(fakes.keywords.calls).toBe(0);
    expect(fakes.serp.calls).toBe(0);
    expect(market.trends).toEqual([]);
    expect(market.clusters).toEqual([]);
    expect(market.first_targets).toEqual([]);
    expect(market.unknowns).toContain(BUDGET_ENABLING_LINE);
    expect(BUDGET_ENABLING_LINE).toBe(
      "Set KAILASHE_MARKET_BUDGET_USD=<amount> in .env to enable paid market research; free sources were used where possible.",
    );
    expect(market.unknowns.join("\n")).toContain("budget not set");
    expect(() => MarketSchema.parse(market)).not.toThrow();
  });

  it("empty-string and invalid budgets behave exactly like unset", async () => {
    for (const value of ["", "not-a-number", "-5"]) {
      const fakes = paidFakes();
      const market = await runMarketResearch(
        { seedTerms: ["invoice tool"], date: FIXTURE_DATE, env: { [MARKET_BUDGET_ENV]: value } },
        fakes,
      );
      expect(fakes.trends.calls + fakes.keywords.calls + fakes.serp.calls, `budget=${value}`).toBe(0);
      expect(market.unknowns).toContain(BUDGET_ENABLING_LINE);
      expect(market.clusters).toEqual([]);
    }
  });

  it("unset budget with no seed terms still emits the enabling line, never crashes", async () => {
    const market = await runMarketResearch({ seedTerms: [], date: FIXTURE_DATE, env: {} }, paidFakes());
    expect(market.unknowns).toContain(BUDGET_ENABLING_LINE);
    expect(market.unknowns.join("\n")).toContain("No seed terms provided");
  });
});

// ---------------------------------------------------------------------------
// Budget guard — set: estimate first, hard stop at cap (exit 7)
// ---------------------------------------------------------------------------

describe("budget guard: budget set", () => {
  it("MarketBudget stops exactly at the cap and throws exit 7 beyond it", () => {
    const budget = new MarketBudget({ [MARKET_BUDGET_ENV]: "10" });
    expect(budget.cap).toBe(10);
    expect(() => budget.checkEstimate(10)).not.toThrow();
    expect(() => budget.checkEstimate(10.01)).toThrow(MarketBudgetExceededError);
    budget.addCost(6);
    budget.addCost(4);
    expect(budget.totalSpent).toBe(10);
    expect(budget.remaining).toBe(0);
    try {
      budget.addCost(0.01);
      expect.unreachable("addCost past the cap must throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MarketBudgetExceededError);
      expect((err as MarketBudgetExceededError).exitCode).toBe(7);
      expect((err as MarketBudgetExceededError).cap).toBe(10);
    }
  });

  it("estimates before any call: an over-cap estimate throws and no provider is called", async () => {
    const keywords = new FakeKeywordsProvider(RECORDED_KEYWORDS, 0.01);
    await expect(
      runMarketResearch(
        { seedTerms: ["a", "b", "c"], date: FIXTURE_DATE, env: { [MARKET_BUDGET_ENV]: "0.02" } },
        { keywords },
      ),
    ).rejects.toMatchObject({ name: "MarketBudgetExceededError", exitCode: 7 });
    expect(keywords.calls).toBe(0);
  });

  it("sums estimates across providers before calling any of them", async () => {
    const trends = new FakeTrendsProvider(RECORDED_TRENDS, 0.02);
    const keywords = new FakeKeywordsProvider(RECORDED_KEYWORDS, 0.02);
    // Each provider alone (0.04 for 2 terms) is under the 0.05 cap; together they are not.
    await expect(
      runMarketResearch(
        { seedTerms: ["a", "b"], date: FIXTURE_DATE, env: { [MARKET_BUDGET_ENV]: "0.05" } },
        { trends, keywords },
      ),
    ).rejects.toBeInstanceOf(MarketBudgetExceededError);
    expect(trends.calls).toBe(0);
    expect(keywords.calls).toBe(0);
  });

  it("a zero cap blocks any priced call", async () => {
    const keywords = new FakeKeywordsProvider(RECORDED_KEYWORDS, 0.01);
    await expect(
      runMarketResearch(
        { seedTerms: ["invoice tool"], date: FIXTURE_DATE, env: { [MARKET_BUDGET_ENV]: "0" } },
        { keywords },
      ),
    ).rejects.toBeInstanceOf(MarketBudgetExceededError);
    expect(keywords.calls).toBe(0);
  });

  it("within budget, each provider is called once and raw pulls are cached with dates", async () => {
    const fakes = paidFakes();
    const cache = new MarketCache();
    const market = await runMarketResearch(
      { seedTerms: ["invoice tool"], archetype: "b2b-saas", icp: "freelance designers", date: FIXTURE_DATE, region: FIXTURE_REGION, env: ENABLED_ENV, cache },
      fakes,
    );
    expect(fakes.trends.calls).toBe(1);
    expect(fakes.keywords.calls).toBe(1);
    expect(fakes.serp.calls).toBe(1);
    expect(cache.size()).toBe(3);
    expect(cache.getAll().map((e) => e.date)).toEqual([FIXTURE_DATE, FIXTURE_DATE, FIXTURE_DATE]);
    expect(market.clusters.length).toBeGreaterThan(0);
    expect(market.first_targets.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scoring formula — playbook §9 / SPEC §6.6
// score = intent_fit * product_fit * log10(volume + 10) / (difficulty + 10)
// ---------------------------------------------------------------------------

describe("scoring formula", () => {
  it("matches hand-computed exact cases", () => {
    // fits are 0..3; a zero fit zeroes the score regardless of volume.
    expect(computeScore(0, 3, 100_000, 0)).toBe(0);
    expect(computeScore(3, 0, 100_000, 0)).toBe(0);
    // 9 * log10(10) / 10 = 0.9
    expect(computeScore(3, 3, 0, 0)).toBeCloseTo(0.9, 12);
    // 1 * log10(100) / 10 = 0.2
    expect(computeScore(1, 1, 90, 0)).toBeCloseTo(0.2, 12);
    // 6 * log10(10000) / 50 = 0.48
    expect(computeScore(3, 2, 9_990, 40)).toBeCloseTo(0.48, 12);
    // 6 * log10(1_000_000_000) / 30 = 1.8
    expect(computeScore(2, 3, 999_999_990, 20)).toBeCloseTo(1.8, 12);
    // volume 0 is safe (log10(10) = 1, never -Infinity or NaN)
    expect(computeScore(1, 1, 0, 0)).toBeCloseTo(0.1, 12);
    expect(Number.isFinite(computeScore(3, 3, 0, 0))).toBe(true);
  });

  it("rises with volume and falls with difficulty", () => {
    expect(computeScore(2, 2, 10_000, 20)).toBeGreaterThan(computeScore(2, 2, 100, 20));
    expect(computeScore(2, 2, 10_000, 90)).toBeLessThan(computeScore(2, 2, 10_000, 10));
  });
});

// ---------------------------------------------------------------------------
// Clustering stability on recorded fixture data (§§5, 9)
// ---------------------------------------------------------------------------

describe("clustering stability", () => {
  it("produces identical clusters on repeated runs and on shuffled input", () => {
    const first = clusterKeywords(RECORDED_KEYWORDS, RECORDED_SERP, ["invoice tool"], { date: FIXTURE_DATE, region: FIXTURE_REGION });
    const second = clusterKeywords(RECORDED_KEYWORDS, RECORDED_SERP, ["invoice tool"], { date: FIXTURE_DATE, region: FIXTURE_REGION });
    const shuffled = clusterKeywords([...RECORDED_KEYWORDS].reverse(), RECORDED_SERP, ["invoice tool"], { date: FIXTURE_DATE, region: FIXTURE_REGION });
    expect(second).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it("groups by shared stem, sums volume, averages difficulty and scores the primary keyword", () => {
    const clusters = clusterKeywords(RECORDED_KEYWORDS, RECORDED_SERP, ["invoice tool"], { date: FIXTURE_DATE, region: FIXTURE_REGION });
    const byPrimary = new Map(clusters.map((c) => [c.primary_keyword, c]));

    const best = byPrimary.get("best invoice tool");
    expect(best?.volume).toBe(1500); // 1000 + 500, one cluster, one page
    expect(best?.difficulty).toBe(25); // average of 20 and 30
    expect(best?.intent).toBe("commercial");
    expect(best?.intent_fit).toBe(3);
    expect(best?.product_fit).toBe(3);
    expect(best?.score).toBeCloseTo((3 * 3 * Math.log10(1500 + 10)) / (25 + 10), 3);

    const invoiceTool = byPrimary.get("invoice tool alternative");
    expect(invoiceTool?.volume).toBe(700); // alternative 400 + pricing 300
    expect(invoiceTool?.difficulty).toBe(25); // average of 40 and 10

    // Clusters come back sorted by score, highest first.
    const scores = clusters.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(clusters[0]?.primary_keyword).toBe("best invoice tool");
  });

  it("deduplicates normalized keywords, keeping the highest-volume entry", () => {
    const dupes: KeywordDatum[] = [
      { keyword: "Invoice Tool", volume: 100, difficulty: 10, intent: "commercial", source: "fake-keywords", date: FIXTURE_DATE, region: FIXTURE_REGION },
      { keyword: "invoice tool", volume: 900, difficulty: 10, intent: "commercial", source: "fake-keywords", date: FIXTURE_DATE, region: FIXTURE_REGION },
    ];
    const clusters = clusterKeywords(dupes, [], ["invoice tool"], { date: FIXTURE_DATE, region: FIXTURE_REGION });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.volume).toBe(900); // not 1000: the duplicate is not double-counted
    expect(clusters[0]?.primary_keyword).toBe("invoice tool");
  });

  it("merges keywords whose SERPs overlap by at least two top URLs, even with different stems", () => {
    const serp: SerpDatum[] = [
      {
        keyword: "freelance billing software",
        results: [
          { url: "https://example.com/a", title: "A", snippet: "", position: 1 },
          { url: "https://example.com/b", title: "B", snippet: "", position: 2 },
          { url: "https://example.com/c", title: "C", snippet: "", position: 3 },
        ],
        source: "fake-serp",
        date: FIXTURE_DATE,
        region: FIXTURE_REGION,
      },
      {
        keyword: "invoice tool alternative",
        results: [
          { url: "https://example.com/a", title: "A", snippet: "", position: 1 },
          { url: "https://example.com/b", title: "B", snippet: "", position: 2 },
          { url: "https://example.com/z", title: "Z", snippet: "", position: 3 },
        ],
        source: "fake-serp",
        date: FIXTURE_DATE,
        region: FIXTURE_REGION,
      },
    ];
    const keywords: KeywordDatum[] = [
      { keyword: "freelance billing software", volume: 600, difficulty: 20, intent: "commercial", source: "fake-keywords", date: FIXTURE_DATE, region: FIXTURE_REGION },
      { keyword: "invoice tool alternative", volume: 400, difficulty: 40, intent: "commercial", source: "fake-keywords", date: FIXTURE_DATE, region: FIXTURE_REGION },
    ];
    const clusters = clusterKeywords(keywords, serp, ["invoice tool"], { date: FIXTURE_DATE, region: FIXTURE_REGION });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.volume).toBe(1000);
  });

  it("returns an empty list for empty input instead of crashing", () => {
    expect(clusterKeywords([], [], [], { date: FIXTURE_DATE, region: FIXTURE_REGION })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Provenance: every figure carries source, date, region (§12)
// ---------------------------------------------------------------------------

describe("provenance on every figure", () => {
  it("run output validates against MarketSchema and every trend/cluster is sourced, dated, regioned", async () => {
    const market = await runMarketResearch(
      { seedTerms: ["invoice tool"], archetype: "b2b-saas", icp: "freelance designers", date: FIXTURE_DATE, region: FIXTURE_REGION, env: ENABLED_ENV },
      paidFakes(),
    );
    expect(() => MarketSchema.parse(market)).not.toThrow();
    expect(market.trends.length).toBeGreaterThan(0);
    expect(market.clusters.length).toBeGreaterThan(0);
    for (const trend of market.trends) {
      expect(trend.source.length).toBeGreaterThan(0);
      expect(trend.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(trend.region.length).toBeGreaterThan(0);
    }
    for (const cluster of market.clusters) {
      expect(cluster.source.length).toBeGreaterThan(0);
      expect(cluster.date).toBe(FIXTURE_DATE);
      expect(cluster.region).toBe(FIXTURE_REGION);
    }
  });

  it("schemas reject a figure that is missing source, date or region", () => {
    const trend: TrendDatum = RECORDED_TRENDS[0]!;
    expect(() => TrendSchema.parse(trend)).not.toThrow();
    expect(() => TrendSchema.parse({ ...trend, source: undefined })).toThrow();
    expect(() => TrendSchema.parse({ ...trend, region: undefined })).toThrow();
    expect(() => TrendSchema.parse({ ...trend, date: "last week" })).toThrow();

    const cluster = clusterKeywords(RECORDED_KEYWORDS, RECORDED_SERP, ["invoice tool"], { date: FIXTURE_DATE, region: FIXTURE_REGION })[0]!;
    expect(() => ClusterSchema.parse(cluster)).not.toThrow();
    expect(() => ClusterSchema.parse({ ...cluster, source: undefined })).toThrow();
    expect(() => ClusterSchema.parse({ ...cluster, region: undefined })).toThrow();
    expect(() => ClusterSchema.parse({ ...cluster, date: "2026/10/29" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Missing keys / failing providers: unknowns[], never guesses, never crash
// ---------------------------------------------------------------------------

describe("missing keys and failing providers", () => {
  it("no providers configured: unknowns explain each gap, figures stay empty", async () => {
    const market = await runMarketResearch(
      { seedTerms: ["invoice tool"], archetype: "b2b-saas", icp: "freelance designers", date: FIXTURE_DATE, env: ENABLED_ENV },
      {},
    );
    expect(market.trends).toEqual([]);
    expect(market.clusters).toEqual([]);
    expect(market.first_targets).toEqual([]);
    const joined = market.unknowns.join("\n");
    expect(joined).toContain("No Trends provider configured");
    expect(joined).toContain("No Keywords provider configured");
    expect(joined).toContain("No SERP provider configured");
    expect(() => MarketSchema.parse(market)).not.toThrow();
  });

  it("explicitly null providers behave like missing providers", async () => {
    const market = await runMarketResearch(
      { seedTerms: ["invoice tool"], date: FIXTURE_DATE, env: ENABLED_ENV },
      { trends: null, keywords: null, serp: null },
    );
    expect(market.clusters).toEqual([]);
    expect(market.unknowns.join("\n")).toContain("No Keywords provider configured");
  });

  it("a provider throwing (e.g. a missing API key) becomes an unknown, not a crash or a guess", async () => {
    const keywords = new FakeKeywordsProvider([], 0.01, new Error("missing API key for fake-keywords"));
    const market = await runMarketResearch(
      { seedTerms: ["invoice tool"], archetype: "b2b-saas", icp: "freelance designers", date: FIXTURE_DATE, env: ENABLED_ENV },
      { keywords, trends: new FakeTrendsProvider(RECORDED_TRENDS) },
    );
    expect(market.unknowns.join("\n")).toContain('Keywords provider "fake-keywords" failed: missing API key for fake-keywords');
    expect(market.clusters).toEqual([]);
    expect(market.first_targets).toEqual([]);
    // Trends still came through with provenance; nothing was invented for keywords.
    expect(market.trends).toHaveLength(RECORDED_TRENDS.length);
  });

  it("providers returning no data produce unknowns, not fabricated figures", async () => {
    const market = await runMarketResearch(
      { seedTerms: ["invoice tool"], archetype: "b2b-saas", icp: "freelance designers", date: FIXTURE_DATE, env: ENABLED_ENV },
      { trends: new FakeTrendsProvider([]), keywords: new FakeKeywordsProvider([]), serp: new FakeSerpProvider([]) },
    );
    expect(market.trends).toEqual([]);
    expect(market.clusters).toEqual([]);
    expect(market.unknowns.join("\n")).toContain("returned no data");
  });

  it("bundled stub adapters with no fixture data return empty results instead of crashing", async () => {
    await expect(new SemrushAdapter().fetch(["invoice tool"])).resolves.toEqual([]);
    await expect(new AhrefsAdapter().fetch(["invoice tool"])).resolves.toEqual([]);
    await expect(new TrendsAlphaAdapter().fetch(["invoice tool"])).resolves.toEqual([]);
    await expect(new SerpApiAdapter().fetch(["invoice tool"])).resolves.toEqual([]);
  });

  it("bundled stub adapters return their injected fixture data through the right fetch shape", async () => {
    const dataForSeo = new DataForSEOAdapter({ trends: RECORDED_TRENDS, keywords: RECORDED_KEYWORDS, serp: RECORDED_SERP });
    // `fetch` is the KeywordsProvider shape; trends/SERP use their named helpers.
    await expect(dataForSeo.fetch(["invoice tool"])).resolves.toEqual(RECORDED_KEYWORDS);
    await expect(dataForSeo.fetchTrends(["invoice tool"])).resolves.toEqual(RECORDED_TRENDS);
    await expect(dataForSeo.fetchSerp(["invoice tool"])).resolves.toEqual(RECORDED_SERP);
    const serpApi = new SerpApiAdapter({ serp: RECORDED_SERP, trends: RECORDED_TRENDS });
    await expect(serpApi.fetch(["invoice tool"])).resolves.toEqual(RECORDED_SERP);
    await expect(serpApi.fetchTrends(["invoice tool"])).resolves.toEqual(RECORDED_TRENDS);
  });

  it("missing archetype/ICP are reported as unknowns and marked unknown, never invented", async () => {
    const market = await runMarketResearch({ seedTerms: ["invoice tool"], date: FIXTURE_DATE, env: ENABLED_ENV }, paidFakes());
    expect(market.archetype).toBe("unknown");
    expect(market.icp).toBe("unknown");
    expect(market.unknowns.join("\n")).toContain("Archetype not determined");
    expect(market.unknowns.join("\n")).toContain("ICP not defined");
  });
});
