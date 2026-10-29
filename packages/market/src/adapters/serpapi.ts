/**
 * SerpApi adapter — stub (no network).
 *
 * Implements the SerpProvider shape via `fetch`; the Trends shape is
 * exposed as `fetchTrends` because one `fetch` signature cannot satisfy
 * both interfaces (different return types).
 */
import type { SerpProvider, SerpDatum, CostEstimator, TrendDatum } from "../interfaces.js";

export const SERPAPI_COST_PER_SEARCH = 0.01;

export class SerpApiAdapter implements SerpProvider, CostEstimator {
  readonly name = "serpapi";

  private serpFixture: SerpDatum[] = [];
  private trendsFixture: TrendDatum[] = [];

  constructor(fixtures?: { serp?: SerpDatum[]; trends?: TrendDatum[] }) {
    if (fixtures?.serp) this.serpFixture = fixtures.serp;
    if (fixtures?.trends) this.trendsFixture = fixtures.trends;
  }

  estimateCost(termCount: number): number {
    return termCount * SERPAPI_COST_PER_SEARCH;
  }

  async fetch(keywords: string[], opts?: { region?: string }): Promise<SerpDatum[]> {
    void keywords;
    void opts;
    return [...this.serpFixture];
  }

  async fetchSerp(keywords: string[], opts?: { region?: string }): Promise<SerpDatum[]> {
    void keywords;
    void opts;
    return [...this.serpFixture];
  }

  async fetchTrends(terms: string[], opts?: { region?: string }): Promise<TrendDatum[]> {
    void terms;
    void opts;
    return [...this.trendsFixture];
  }
}
