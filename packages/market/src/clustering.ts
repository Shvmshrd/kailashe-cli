/**
 * Keyword clustering + scoring per references/market-research.md §§5, 9.
 *
 * - Cluster by meaning and SERP overlap (normalized keyword groups).
 * - Score: intent_fit × product_fit × log10(volume+10) / (difficulty+10)
 */

import type { KeywordDatum, SerpDatum } from "./interfaces.js";
import { computeScore } from "./types.js";
import type { Cluster, Intent } from "./types.js";

// ---------------------------------------------------------------------------
// Intent + product fit heuristics (deterministic, fixture-stable)
// ---------------------------------------------------------------------------

function inferIntentFit(keyword: string): number {
  const kw = keyword.toLowerCase();
  // Commercial signals
  if (/(best|top|vs\b|versus|alternative|review|compare|pricing|price)/i.test(kw)) return 3;
  if (/(buy|sign up|free trial|download|pricing)/i.test(kw)) return 3; // transactional high intent
  // Informational
  if (/(how to|what is|examples|guide|tutorial|tips)/i.test(kw)) return 1;
  return 2; // default mid intent
}

function inferProductFit(keyword: string, seedTerms: string[]): number {
  const kw = keyword.toLowerCase();
  for (const seed of seedTerms) {
    if (kw.includes(seed.toLowerCase())) return 3;
    // partial overlap
    const words = seed.toLowerCase().split(/\s+/).filter(Boolean);
    const overlap = words.filter((w) => kw.includes(w)).length;
    if (overlap > 0 && words.length > 0) {
      // at least one seed word overlap → mid fit
      return 2;
    }
  }
  return 1; // weak but non-zero fit
}

function intentFromKeyword(keyword: string): Intent {
  const kw = keyword.toLowerCase();
  if (/(buy|sign up|free trial|download|pricing|price)/i.test(kw)) return "transactional";
  if (/(best|top|vs\b|versus|alternative|review|compare)/i.test(kw)) return "commercial";
  if (/(how to|what is|examples|guide|tutorial|tips|learn)/i.test(kw)) return "informational";
  // default: informational for generic terms
  return "informational";
}

// ---------------------------------------------------------------------------
// Normalization + clustering
// ---------------------------------------------------------------------------

function normalizeKeyword(kw: string): string {
  return kw.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Simple deterministic clustering: group keywords whose normalized forms
 * share a common stem (first two significant words) or that SERP results
 * indicate should be grouped. For fixture stability we use normalized prefix grouping.
 */
export function clusterKeywords(
  keywords: KeywordDatum[],
  serpData: SerpDatum[] = [],
  seedTerms: string[] = [],
  opts: { date?: string; region?: string } = {},
): Cluster[] {
  if (keywords.length === 0) return [];

  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const region = opts.region ?? "global";

  // Build SERP overlap map: keywords that share top URLs belong together.
  // For deterministic grouping we index serpData by keyword.
  const serpUrlsByKeyword = new Map<string, Set<string>>();
  for (const s of serpData) {
    const urls = new Set(s.results.slice(0, 5).map((r) => r.url));
    serpUrlsByKeyword.set(normalizeKeyword(s.keyword), urls);
  }

  // Normalize + deduplicate: keep highest volume entry per normalized keyword.
  const deduped = new Map<string, KeywordDatum>();
  for (const k of keywords) {
    const norm = normalizeKeyword(k.keyword);
    const existing = deduped.get(norm);
    if (!existing || k.volume > existing.volume) deduped.set(norm, k);
  }
  const items = [...deduped.values()];

  // Deterministic sort before clustering
  items.sort((a, b) => normalizeKeyword(a.keyword).localeCompare(normalizeKeyword(b.keyword)));

  // Greedy clustering: assign to existing cluster if overlap criteria met.
  type Bucket = { keywords: KeywordDatum[]; stem: string };
  const buckets: Bucket[] = [];

  for (const item of items) {
    const norm = normalizeKeyword(item.keyword);
    const words = norm.split(/\s+/);
    const stem = words.slice(0, 2).join(" ");

    let placed = false;

    // Check SERP overlap first
    const itemUrls = serpUrlsByKeyword.get(norm);
    if (itemUrls) {
      for (const bucket of buckets) {
        // If any keyword in bucket shares SERP URLs with this item, merge
        for (const bkKw of bucket.keywords) {
          const bkUrls = serpUrlsByKeyword.get(normalizeKeyword(bkKw.keyword));
          if (!bkUrls) continue;
          const overlap = [...itemUrls].filter((u) => bkUrls.has(u)).length;
          if (overlap >= 2) {
            bucket.keywords.push(item);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }

    // Stem-based grouping fallback
    if (!placed) {
      const existing = buckets.find((b) => b.stem === stem);
      if (existing) {
        existing.keywords.push(item);
        placed = true;
      }
    }

    if (!placed) {
      buckets.push({ keywords: [item], stem });
    }
  }

  // Convert buckets to Clusters
  const clusters: Cluster[] = buckets.map((bucket) => {
    // Primary keyword = highest volume in bucket
    const sorted = [...bucket.keywords].sort((a, b) => b.volume - a.volume);
    const primary = sorted[0]!;
    const totalVolume = bucket.keywords.reduce((s, k) => s + k.volume, 0);
    // Difficulty: average of bucket (rounded)
    const avgDifficulty = bucket.keywords.reduce((s, k) => s + k.difficulty, 0) / bucket.keywords.length;
    const intentFit = inferIntentFit(primary.keyword);
    const productFit = inferProductFit(primary.keyword, seedTerms);
    const score = computeScore(intentFit, productFit, totalVolume || primary.volume, avgDifficulty);
    const intent = intentFromKeyword(primary.keyword);

    return {
      name: bucket.stem || primary.keyword,
      primary_keyword: primary.keyword,
      intent,
      volume: totalVolume,
      difficulty: Math.round(avgDifficulty * 10) / 10,
      score: Math.round(score * 1000) / 1000,
      gap: `Opportunity in "${bucket.stem}" — ${bucket.keywords.length} related keyword(s).`,
      source: primary.source,
      date,
      region,
      intent_fit: intentFit,
      product_fit: productFit,
    };
  });

  // Sort by score descending (stable for equal scores)
  clusters.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return clusters;
}
