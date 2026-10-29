/**
 * Ahrefs adapter — stub.
 */
import type { KeywordsProvider, KeywordDatum, CostEstimator } from "../interfaces.js";

export const AHREFS_COST_PER_TERM = 0.008;

export class AhrefsAdapter implements KeywordsProvider, CostEstimator {
  readonly name = "ahrefs";
  private fixture: KeywordDatum[] = [];

  constructor(fixtures?: { keywords?: KeywordDatum[] }) {
    if (fixtures?.keywords) this.fixture = fixtures.keywords;
  }

  estimateCost(termCount: number): number {
    return termCount * AHREFS_COST_PER_TERM;
  }

  async fetch(seedTerms: string[], opts?: { region?: string }): Promise<KeywordDatum[]> {
    void seedTerms;
    void opts;
    return [...this.fixture];
  }
}
