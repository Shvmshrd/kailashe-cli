/**
 * Provider interfaces for the market module.
 * Mirrors SPEC S8: Trends, Keywords, SERP.
 * Each interface has a single fetch method (requirement).
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface FetchMeta {
  source: string;
  date: string; // YYYY-MM-DD
  region: string;
}

export interface TrendDatum {
  term: string;
  shape: "rising" | "steady" | "seasonal" | "fading" | "spike";
  range: string;
  region: string;
  confidence: "low" | "medium" | "high";
  source: string;
  date: string;
}

export interface KeywordDatum {
  keyword: string;
  volume: number;
  difficulty: number;
  intent: "informational" | "commercial" | "transactional" | "navigational";
  source: string;
  date: string;
  region: string;
  // provider may also supply cpc, trend shape, serp type etc.
  cpc?: number;
  trend_shape?: string;
}

export interface SerpResult {
  url: string;
  title: string;
  snippet: string;
  position: number;
}

export interface SerpDatum {
  keyword: string;
  results: SerpResult[];
  source: string;
  date: string;
  region: string;
}

// ---------------------------------------------------------------------------
// Provider contracts — each has a fetch method.
// ---------------------------------------------------------------------------

export interface TrendsProvider {
  readonly name: string;
  fetch(terms: string[], opts?: { region?: string }): Promise<TrendDatum[]>;
}

export interface KeywordsProvider {
  readonly name: string;
  fetch(seedTerms: string[], opts?: { region?: string }): Promise<KeywordDatum[]>;
}

export interface SerpProvider {
  readonly name: string;
  fetch(keywords: string[], opts?: { region?: string }): Promise<SerpDatum[]>;
}

// ---------------------------------------------------------------------------
// Cost estimation — each provider can estimate its call cost (USD)
// ---------------------------------------------------------------------------

export interface CostEstimator {
  /** Estimate cost in USD for fetching these terms (before the call). */
  estimateCost(termCount: number): number;
}
