/**
 * Market research orchestrator — takes seed terms + providers → market.json.
 *
 * Rules:
 * - Recorded fixtures → stable clusters/scores
 * - Missing keys → unknowns[], never guesses, never crash
 * - Every figure carries source, date, region
 * - Budget guard enforced
 * - No network in tests
 */

import type { TrendsProvider, KeywordsProvider, SerpProvider, CostEstimator, TrendDatum, KeywordDatum, SerpDatum } from "./interfaces.js";
import type { Market, Trend, Cluster, Competitor, Community, ChannelRanked } from "./types.js";
import { MarketBudget, BUDGET_ENABLING_LINE, isBudgetUnset, MarketBudgetExceededError } from "./budget.js";
import { MarketCache } from "./cache.js";
import { clusterKeywords } from "./clustering.js";

// Re-exports
export * from "./types.js";
export * from "./interfaces.js";
export * from "./budget.js";
export * from "./cache.js";
export * from "./clustering.js";
export { DataForSEOAdapter } from "./adapters/dataforseo.js";
export { SerpApiAdapter } from "./adapters/serpapi.js";
export { SemrushAdapter } from "./adapters/semrush.js";
export { AhrefsAdapter } from "./adapters/ahrefs.js";
export { TrendsAlphaAdapter } from "./adapters/trends-alpha.js";

// ---------------------------------------------------------------------------
// Orchestrator types
// ---------------------------------------------------------------------------

export interface MarketOptions {
  seedTerms: string[];
  region?: string;
  archetype?: string;
  icp?: string;
  date?: string; // YYYY-MM-DD; defaults to today
  competitors?: Competitor[];
  communities?: Community[];
  channelsRanked?: ChannelRanked[];
  env?: Record<string, string | undefined>;
  /** Optional cache to populate */
  cache?: MarketCache;
}

export interface MarketProviders {
  trends?: TrendsProvider | null;
  keywords?: KeywordsProvider | null;
  serp?: SerpProvider | null;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function asTrend(t: TrendDatum): Trend {
  return {
    term: t.term,
    shape: t.shape,
    source: t.source,
    range: t.range,
    region: t.region,
    confidence: t.confidence,
    date: t.date,
  };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runMarketResearch(
  opts: MarketOptions,
  providers: MarketProviders = {},
): Promise<Market> {
  const date = opts.date ?? todayISO();
  const region = opts.region ?? "US";
  const cache = opts.cache ?? new MarketCache();
  const env = opts.env ?? (process.env as Record<string, string | undefined>);

  const unknowns: string[] = [];
  const budget = new MarketBudget(env);
  const budgetUnset = isBudgetUnset(env);

  let trends: Trend[] = [];
  let clusters: Cluster[] = [];
  let rawKeywords: KeywordDatum[] = [];
  let rawSerp: SerpDatum[] = [];
  let rawTrends: TrendDatum[] = [];

  // -----------------------------------------------------------------------
  // Budget guard: when unset, no paid calls.
  // We still allow providers that were explicitly constructed with fixtures
  // to be treated as free (tests). Heuristic: if budget is unset, skip providers
  // that implement CostEstimator — unless they have been flagged as free.
  // For v0.1: when budget is unset, we skip all provider fetch calls entirely
  // and record unknowns + enabling line.
  // -----------------------------------------------------------------------
  if (budgetUnset) {
    // Do not call any providers; emit unknowns with enabling line.
    unknowns.push(BUDGET_ENABLING_LINE);
    if (!opts.seedTerms || opts.seedTerms.length === 0) {
      unknowns.push("No seed terms provided — no keyword research possible.");
    } else {
      unknowns.push(`Trends data unavailable — budget not set (seed terms: ${opts.seedTerms.join(", ")}).`);
      unknowns.push(`Keyword data unavailable — budget not set (seed terms: ${opts.seedTerms.join(", ")}).`);
      unknowns.push(`SERP data unavailable — budget not set (seed terms: ${opts.seedTerms.join(", ")}).`);
    }
  } else {
    // Budget is set — estimate then fetch, hard stop at cap.
    const cap = budget.cap!;

    // Estimate costs upfront
    let estimatedTotal = 0;
    const estimates: Array<{ name: string; cost: number }> = [];

    if (providers.trends && isCostEstimator(providers.trends)) {
      const c = providers.trends.estimateCost(opts.seedTerms.length);
      estimates.push({ name: providers.trends.name, cost: c });
      estimatedTotal += c;
    }
    if (providers.keywords && isCostEstimator(providers.keywords)) {
      const c = providers.keywords.estimateCost(opts.seedTerms.length);
      estimates.push({ name: providers.keywords.name, cost: c });
      estimatedTotal += c;
    }
    if (providers.serp && isCostEstimator(providers.serp)) {
      // SERP typically fetched per cluster head term; estimate as seedTerms length
      const c = providers.serp.estimateCost(opts.seedTerms.length);
      estimates.push({ name: providers.serp.name, cost: c });
      estimatedTotal += c;
    }

    if (estimatedTotal > cap) {
      throw new MarketBudgetExceededError(estimatedTotal, cap);
    }

    // Fetch trends
    if (providers.trends) {
      try {
        const cost = findEstimate(estimates, providers.trends.name);
        rawTrends = await providers.trends.fetch(opts.seedTerms, { region });
        cache.add(providers.trends.name, date, rawTrends);
        if (cost !== null) budget.addCost(cost);
        trends = rawTrends.map(asTrend);
      } catch (e) {
        if (e instanceof MarketBudgetExceededError) throw e;
        unknowns.push(`Trends provider "${providers.trends.name}" failed: ${(e as Error).message}`);
      }
    } else {
      unknowns.push("No Trends provider configured — trends unavailable.");
    }

    // Fetch keywords
    if (providers.keywords) {
      try {
        const cost = findEstimate(estimates, providers.keywords.name);
        rawKeywords = await providers.keywords.fetch(opts.seedTerms, { region });
        cache.add(providers.keywords.name, date, rawKeywords);
        if (cost !== null) budget.addCost(cost);
      } catch (e) {
        if (e instanceof MarketBudgetExceededError) throw e;
        unknowns.push(`Keywords provider "${providers.keywords.name}" failed: ${(e as Error).message}`);
      }
    } else {
      unknowns.push("No Keywords provider configured — keyword data unavailable.");
    }

    // Fetch SERP (use top keywords or seed terms if no keywords)
    if (providers.serp) {
      try {
        const serpTerms = rawKeywords.length > 0
          ? [...new Set(rawKeywords.map((k) => k.keyword))].slice(0, 15)
          : opts.seedTerms;
        const cost = findEstimate(estimates, providers.serp.name);
        rawSerp = await providers.serp.fetch(serpTerms, { region });
        cache.add(providers.serp.name, date, rawSerp);
        if (cost !== null) budget.addCost(cost);
      } catch (e) {
        if (e instanceof MarketBudgetExceededError) throw e;
        unknowns.push(`SERP provider "${providers.serp.name}" failed: ${(e as Error).message}`);
      }
    } else {
      unknowns.push("No SERP provider configured — SERP gap analysis unavailable.");
    }

    // Handle empty results as unknowns (not crashes)
    if (rawTrends.length === 0 && providers.trends) {
      unknowns.push("Trends provider returned no data for the given seed terms.");
    }
    if (rawKeywords.length === 0 && providers.keywords) {
      unknowns.push("Keywords provider returned no data for the given seed terms.");
    }

    // Clustering
    if (rawKeywords.length > 0) {
      try {
        clusters = clusterKeywords(rawKeywords, rawSerp, opts.seedTerms, { date, region });
      } catch (e) {
        unknowns.push(`Clustering failed: ${(e as Error).message}`);
        clusters = [];
      }
    }
  }

  // Competitors / communities / channels — pass through or unknowns
  const competitors: Competitor[] = opts.competitors ?? [];
  const communities: Community[] = opts.communities ?? [];
  const channels_ranked: ChannelRanked[] = opts.channelsRanked ?? [];

  if (competitors.length === 0) unknowns.push("No competitor data — competitor research not configured.");
  if (communities.length === 0) unknowns.push("No community data — community research not configured.");
  if (channels_ranked.length === 0) unknowns.push("No channel ranking — archetype or planning step not run.");

  // first_targets: top clusters by score
  const first_targets: string[] = clusters.slice(0, 10).map((c) => c.primary_keyword);

  // Archetype / ICP fallbacks → unknowns
  let archetype = opts.archetype ?? "";
  let icp = opts.icp ?? "";
  if (!archetype) {
    unknowns.push("Archetype not determined — brief or detection step missing.");
    archetype = "unknown";
  }
  if (!icp) {
    unknowns.push("ICP not defined — brief audience step missing.");
    icp = "unknown";
  }

  const market: Market = {
    date,
    archetype,
    icp,
    trends,
    clusters,
    competitors,
    communities,
    channels_ranked,
    first_targets,
    unknowns,
  };

  return market;
}

function isCostEstimator(p: unknown): p is CostEstimator {
  return typeof (p as CostEstimator).estimateCost === "function";
}

function findEstimate(estimates: Array<{ name: string; cost: number }>, name: string): number | null {
  const e = estimates.find((x) => x.name === name);
  return e ? e.cost : null;
}

/** Synchronous helper to test budget guard without network */
export function checkBudgetOrThrow(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): void {
  if (isBudgetUnset(env)) {
    // Not an error — caller should emit unknowns + enabling line.
    return;
  }
  // Budget is set — if cap is 0, any spend exceeds it.
  const cap = new MarketBudget(env).cap;
  if (cap !== null && cap <= 0) throw new MarketBudgetExceededError(0.01, cap);
}
