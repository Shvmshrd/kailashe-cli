/**
 * Market schema — SPEC §6.6 (market.json, references/market-research.md §1/§12)
 *
 * Market research output: date, archetype, icp, trends[], clusters[],
 * competitors, communities, channels_ranked, first_targets[], unknowns[].
 *
 * Scoring (§9): score = intent_fit × product_fit × log10(volume+10) / (difficulty+10)
 * with fits 0–3 and a single difficulty scale per market.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export const TrendShapeSchema = z.enum(["rising", "steady", "seasonal", "fading", "spike"]);

export type TrendShape = z.infer<typeof TrendShapeSchema>;

export const TrendSchema = z
  .object({
    term: z.string().min(1).describe("Search term the trend was measured for."),
    shape: TrendShapeSchema.describe("Label from the 5-value trend shape vocabulary."),
    source: z.string().min(1).describe("Where the figure came from (e.g. 'google-trends-api', 'trends-website', 'dataforseo')."),
    range: z.string().min(1).describe("Date range, e.g. '2021-01 to 2026-10 (5y)'."),
    region: z.string().min(1).describe("Geography, e.g. 'Worldwide', 'US', 'DE'."),
    confidence: z.enum(["high", "medium", "low"]),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional()
      .describe("When the pull happened, if different from market.date."),
    note: z.string().optional(),
  })
  .strict();

export type Trend = z.infer<typeof TrendSchema>;

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------

export const ClusterIntentSchema = z.enum(["informational", "commercial", "transactional", "navigational"]);

export type ClusterIntent = z.infer<typeof ClusterIntentSchema>;

export const ClusterSchema = z
  .object({
    name: z.string().min(1).describe("Cluster display name."),
    primary_keyword: z.string().min(1).describe("Head term for this cluster (one page per cluster)."),
    intent: ClusterIntentSchema,
    volume: z.number().int().min(0).describe("Monthly search volume (modeled estimate, not counted)."),
    difficulty: z.number().min(0).max(100).describe("Keyword difficulty on the single chosen scale for this market."),
    score: z.number().min(0).describe("score = intent_fit × product_fit × log10(volume+10) / (difficulty+10), fits 0–3."),
    gap: z.string().min(1).describe("SERP gap in one sentence — the angle for the page."),
    // Helper inputs retained so scoring is auditable
    intent_fit: z.number().int().min(0).max(3).optional().describe("0–3, how well query intent matches conversion intent."),
    product_fit: z.number().int().min(0).max(3).optional().describe("0–3, how well the product solves the query."),
    source: z.string().optional().describe("Keyword source, e.g. 'dataforseo', 'serpapi'."),
    region: z.string().optional(),
  })
  .strict();

export type Cluster = z.infer<typeof ClusterSchema>;

/**
 * Recompute the cluster score per the spec formula.
 * Use the same constants the producer used (intent_fit/product_fit 0–3, single difficulty scale).
 */
export function clusterScore(
  intentFit: number,
  productFit: number,
  volume: number,
  difficulty: number,
): number {
  return (intentFit * productFit * Math.log10(volume + 10)) / (difficulty + 10);
}

// ---------------------------------------------------------------------------
// Competitors & Communities
// ---------------------------------------------------------------------------

export const CompetitorSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    positioning: z.string().min(1).describe("Positioning line for this competitor."),
    pricing: z.string().min(1).describe("Pricing summary or 'unknown' / 'contact sales'."),
  })
  .strict();

export type Competitor = z.infer<typeof CompetitorSchema>;

export const CommunitySchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    rules: z.string().min(1).describe("Rule summary (self-promo, links, disclosure)."),
    fit: z.number().min(1).max(5).describe("Audience fit 1–5."),
  })
  .strict();

export type Community = z.infer<typeof CommunitySchema>;

// ---------------------------------------------------------------------------
// Channels ranked
// ---------------------------------------------------------------------------

export const ChannelRankedSchema = z
  .object({
    channel: z.string().min(1).describe("Channel id (labels per Q6; validated via ChannelMap, not channels.md)."),
    why: z.string().min(1).describe("Why this channel for this market."),
    kpi: z.string().min(1).describe("Primary KPI for this channel."),
    stop_if: z.string().min(1).describe("Stop / pivot condition."),
  })
  .strict();

export type ChannelRanked = z.infer<typeof ChannelRankedSchema>;

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export const MarketSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD").describe("Research date."),
    archetype: z.string().min(1).describe("Chosen archetype id (one of the 9 in archetypes.yaml)."),
    icp: z.string().min(1).describe("Ideal customer profile (3 concise lines)."),

    trends: z.array(TrendSchema).default([]),
    clusters: z.array(ClusterSchema).default([]),
    competitors: z.array(CompetitorSchema).default([]),
    communities: z.array(CommunitySchema).default([]),
    channels_ranked: z.array(ChannelRankedSchema).default([]),

    /** First 10 content/target keywords (the §9 first-targets selection). */
    first_targets: z.array(z.string().min(1)).default([]),

    /** Anything that could not be determined (used when budget/keys missing, F3.4). */
    unknowns: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type Market = z.infer<typeof MarketSchema>;

// ---------------------------------------------------------------------------
// JSON Schema export
// ---------------------------------------------------------------------------

export const MarketJsonSchema = zodToJsonSchema(MarketSchema, {
  name: "Market",
  $refStrategy: "none",
  target: "jsonSchema7",
});
