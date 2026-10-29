/**
 * Market schema — SPEC §6.6 and references/market-research.md.
 *
 * Every figure carries source, date, region (data-quality rules §12).
 * Missing data → unknowns[], never guesses, never crash.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

export const TrendShapeSchema = z.enum(["rising", "steady", "seasonal", "fading", "spike"]);
export type TrendShape = z.infer<typeof TrendShapeSchema>;

export const ConfidenceSchema = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const IntentSchema = z.enum(["informational", "commercial", "transactional", "navigational"]);
export type Intent = z.infer<typeof IntentSchema>;

export const TrendSchema = z.object({
  term: z.string(),
  shape: TrendShapeSchema,
  source: z.string(),
  range: z.string(),
  region: z.string(),
  confidence: ConfidenceSchema,
  /** ISO date (YYYY-MM-DD) when this trend datum was fetched. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type Trend = z.infer<typeof TrendSchema>;

export const ClusterSchema = z.object({
  name: z.string(),
  primary_keyword: z.string(),
  intent: IntentSchema,
  volume: z.number().int().nonnegative(),
  difficulty: z.number().nonnegative(),
  score: z.number(),
  gap: z.string(),
  /** Per-figure provenance (data-quality §12) */
  source: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  region: z.string(),
  /** Optional fit values used to compute score */
  intent_fit: z.number().min(0).max(3).optional(),
  product_fit: z.number().min(0).max(3).optional(),
});
export type Cluster = z.infer<typeof ClusterSchema>;

export const CompetitorSchema = z.object({
  name: z.string(),
  url: z.string(),
  positioning: z.string(),
  pricing: z.string(),
  source: z.string().optional(),
  date: z.string().optional(),
  region: z.string().optional(),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const CommunitySchema = z.object({
  name: z.string(),
  url: z.string(),
  rules: z.string(),
  fit: z.number().int().min(0).max(5),
  source: z.string().optional(),
  date: z.string().optional(),
  region: z.string().optional(),
});
export type Community = z.infer<typeof CommunitySchema>;

export const ChannelRankedSchema = z.object({
  channel: z.string(),
  why: z.string(),
  kpi: z.string(),
  stop_if: z.string(),
});
export type ChannelRanked = z.infer<typeof ChannelRankedSchema>;

// ---------------------------------------------------------------------------
// Top-level Market schema (SPEC §6.6)
// ---------------------------------------------------------------------------

export const MarketSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  archetype: z.string(),
  icp: z.string(),
  trends: z.array(TrendSchema),
  clusters: z.array(ClusterSchema),
  competitors: z.array(CompetitorSchema),
  communities: z.array(CommunitySchema),
  channels_ranked: z.array(ChannelRankedSchema),
  first_targets: z.array(z.string()),
  unknowns: z.array(z.string()),
});

export type Market = z.infer<typeof MarketSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scoring formula per playbook §9:
 *   score = intent_fit × product_fit × log10(volume + 10) / (difficulty + 10)
 * fits ∈ [0,3], difficulty ≥ 0, volume ≥ 0.
 */
export function computeScore(
  intentFit: number,
  productFit: number,
  volume: number,
  difficulty: number,
): number {
  if (intentFit <= 0 || productFit <= 0) return 0;
  return (intentFit * productFit * Math.log10(volume + 10)) / (difficulty + 10);
}

/**
 * Export JSON Schema for the Market type (S0 contract — JSON Schema alongside Zod).
 */
export function marketJsonSchema(): Record<string, unknown> {
  // Minimal JSON Schema representation; consumers can use zod-to-json-schema if desired.
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Market",
    type: "object",
    required: ["date", "archetype", "icp", "trends", "clusters", "competitors", "communities", "channels_ranked", "first_targets", "unknowns"],
    properties: {
      date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      archetype: { type: "string" },
      icp: { type: "string" },
      trends: { type: "array" },
      clusters: { type: "array" },
      competitors: { type: "array" },
      communities: { type: "array" },
      channels_ranked: { type: "array" },
      first_targets: { type: "array", items: { type: "string" } },
      unknowns: { type: "array", items: { type: "string" } },
    },
  };
}
