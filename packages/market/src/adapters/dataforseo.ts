/**
 * DataForSEO adapter — stub implementing KeywordsProvider + CostEstimator.
 * No real API calls (no network in tests). Uses injected fixture data or returns empty results.
 *
 * One class cannot implement Trends/Keywords/SERP at once: each interface
 * declares `fetch` with a different return type, so a single `fetch`
 * signature cannot satisfy all three. This adapter therefore implements
 * the Keywords shape via `fetch` and exposes the Trends/SERP shapes via
 * the explicitly named `fetchTrends` / `fetchSerp` helpers.
 */
import type { TrendDatum, KeywordsProvider, KeywordDatum, SerpDatum, CostEstimator } from "../interfaces.js";

export const DATAFORSEO_PAID_COST_PER_TERM = 0.005;

export class DataForSEOAdapter implements KeywordsProvider, CostEstimator {
  readonly name = "dataforseo";

  private trendsFixture: TrendDatum[] = [];
  private keywordsFixture: KeywordDatum[] = [];
  private serpFixture: SerpDatum[] = [];

  constructor(fixtures?: { trends?: TrendDatum[]; keywords?: KeywordDatum[]; serp?: SerpDatum[] }) {
    if (fixtures?.trends) this.trendsFixture = fixtures.trends;
    if (fixtures?.keywords) this.keywordsFixture = fixtures.keywords;
    if (fixtures?.serp) this.serpFixture = fixtures.serp;
  }

  estimateCost(termCount: number): number {
    return termCount * DATAFORSEO_PAID_COST_PER_TERM;
  }

  async fetch(seedTerms: string[], opts?: { region?: string }): Promise<KeywordDatum[]> {
    void seedTerms;
    void opts;
    return [...this.keywordsFixture];
  }

  async fetchTrends(terms: string[], opts?: { region?: string }): Promise<TrendDatum[]> {
    void terms;
    void opts;
    return [...this.trendsFixture];
  }

  async fetchKeywords(seedTerms: string[], opts?: { region?: string }): Promise<KeywordDatum[]> {
    void seedTerms;
    void opts;
    return [...this.keywordsFixture];
  }

  async fetchSerp(keywords: string[], opts?: { region?: string }): Promise<SerpDatum[]> {
    void keywords;
    void opts;
    return [...this.serpFixture];
  }

  /** Trends/SERP shapes are exposed as fetchTrends/fetchSerp above; `fetch` is the Keywords shape. */
}
