/**
 * Google Trends Alpha adapter — stub (managed Trends endpoint).
 */
import type { TrendsProvider, TrendDatum, CostEstimator } from "../interfaces.js";

export const TRENDS_ALPHA_COST_PER_TERM = 0.002;

export class TrendsAlphaAdapter implements TrendsProvider, CostEstimator {
  readonly name = "trends-alpha";
  private fixture: TrendDatum[] = [];

  constructor(fixtures?: { trends?: TrendDatum[] }) {
    if (fixtures?.trends) this.fixture = fixtures.trends;
  }

  estimateCost(termCount: number): number {
    return termCount * TRENDS_ALPHA_COST_PER_TERM;
  }

  async fetch(terms: string[], opts?: { region?: string }): Promise<TrendDatum[]> {
    void terms;
    void opts;
    return [...this.fixture];
  }
}
