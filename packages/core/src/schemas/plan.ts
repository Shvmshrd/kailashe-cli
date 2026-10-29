/**
 * Plan schema — SPEC §6.7 (archetype → strategy in S9)
 *
 * Archetype + reason, 90-day goal, KPIs, ranked channels (why / first 3 actions /
 * KPI / stop condition), content plan, flows, later list.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

export const KpiSchema = z
  .object({
    name: z.string().min(1).describe("KPI slug, e.g. 'activation_rate', 'referring_domains'."),
    target: z.string().min(1).describe("Target value/description for the 90-day window."),
    source: z.string().min(1).describe("Where the number is read from (tool, sheet, analytics)."),
  })
  .strict();

export type Kpi = z.infer<typeof KpiSchema>;

// ---------------------------------------------------------------------------
// Ranked channel (richer than Market.channels_ranked — includes the 3 actions)
// ---------------------------------------------------------------------------

export const PlanChannelSchema = z
  .object({
    channel: z.string().min(1).describe("Channel id (validated via ChannelMap, per Q6)."),
    why: z.string().min(1).describe("Why this channel for this project/market."),
    firstActions: z
      .array(z.string().min(1))
      .length(3, "Exactly 3 first actions per channel (SPEC §6.7)."),
    kpi: z.string().min(1).describe("Primary KPI for this channel."),
    stopIf: z.string().min(1).describe("Stop / pivot condition."),
  })
  .strict();

export type PlanChannel = z.infer<typeof PlanChannelSchema>;

// ---------------------------------------------------------------------------
// Content plan entry
// ---------------------------------------------------------------------------

export const ContentPlanItemSchema = z
  .object({
    title: z.string().min(1),
    keyword: z.string().min(1).describe("Primary keyword / topic."),
    intent: z.enum(["informational", "commercial", "transactional", "navigational"]),
    stage: z.enum(["bottom", "middle", "top", "proof"]).describe("Funnel stage (from archetype content_mix)."),
    week: z.number().int().min(1).max(12).describe("Scheduled week within the 12-week calendar."),
    channel: z.string().min(1).optional().describe("Primary channel this piece serves, if any."),
  })
  .strict();

export type ContentPlanItem = z.infer<typeof ContentPlanItemSchema>;

// ---------------------------------------------------------------------------
// Later item — deferred channel/tactic with its activation trigger
// ---------------------------------------------------------------------------

export const LaterItemSchema = z
  .object({
    item: z.string().min(1).describe("Channel or tactic deferred to later."),
    trigger: z.string().min(1).describe("When it activates, e.g. 'after 20 indexed pages'."),
  })
  .strict();

export type LaterItem = z.infer<typeof LaterItemSchema>;

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export const PlanSchema = z
  .object({
    version: z.number().int().min(1).default(1),
    projectId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }).optional(),

    archetype: z.string().min(1).describe("Chosen archetype id (one of 9 in archetypes.yaml)."),
    archetypeReason: z.string().min(1).describe("Why this archetype fits this project/market."),

    goal90d: z.string().min(1).describe("90-day goal (specific, measurable)."),

    kpis: z.array(KpiSchema).min(1).describe("3–5 KPIs that fit the archetype."),

    channels: z.array(PlanChannelSchema).min(1).describe("Ranked channels — each with 3 first actions, KPI, stop condition."),

    contentPlan: z.array(ContentPlanItemSchema).default([]).describe("Content plan for the 90-day window (≤12 weeks)."),

    flows: z.array(z.string().min(1)).default([]).describe("Starter flow ids to build (tool-hubs §7, validated by validate-pack)."),

    later: z.array(LaterItemSchema).default([]).describe("Deferred items with triggers (shown as 'Later' in prompt.md §4)."),
  })
  .strict();

export type Plan = z.infer<typeof PlanSchema>;

// ---------------------------------------------------------------------------
// JSON Schema export
// ---------------------------------------------------------------------------

export const PlanJsonSchema = zodToJsonSchema(PlanSchema, {
  name: "Plan",
  $refStrategy: "none",
  target: "jsonSchema7",
});
