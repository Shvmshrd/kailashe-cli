/**
 * ComposeInput schema — SPEC §6.12
 *
 * Every placeholder in skill/kailashe-operator/assets/prompt.template.md.
 * Field-for-field mirror of packages/compose's ComposeInput interface.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const s = z.string();
const s1 = z.string().min(1);

export const ComposeProjectSchema = z.object({ name: s1, url: s, repo: s }).strict();
export type ComposeProject = z.infer<typeof ComposeProjectSchema>;

export const ComposePlanRefSchema = z.object({ version: s }).strict();
export type ComposePlanRef = z.infer<typeof ComposePlanRefSchema>;

export const ComposeBriefSchema = z
  .object({
    what: s, audience: s, problem: s, features: s, pricing: s,
    limits: s, voice: s, donotsay: s, links: s, owner: s,
  })
  .strict();
export type ComposeBrief = z.infer<typeof ComposeBriefSchema>;

export const ComposeMarketSchema = z
  .object({
    date: s, archetype: s, archetype_reason: s, trends_table: s, clusters_table: s,
    gaps: s, competitors_table: s, communities_table: s, unknowns: s, json_ref: s,
  })
  .strict();
export type ComposeMarket = z.infer<typeof ComposeMarketSchema>;

export const ComposeGoalsSchema = z.object({ ninety: s }).strict();
export type ComposeGoals = z.infer<typeof ComposeGoalsSchema>;

export const ComposeOwnerSchema = z.object({ tz: s, contact: s }).strict();
export type ComposeOwner = z.infer<typeof ComposeOwnerSchema>;

export const ComposeBudgetSchema = z.object({ cap: s, paid: s }).strict();
export type ComposeBudget = z.infer<typeof ComposeBudgetSchema>;

export const ComposeInputSchema = z
  .object({
    project: ComposeProjectSchema,
    date: s,
    plan: ComposePlanRefSchema,
    brief: ComposeBriefSchema,
    market: ComposeMarketSchema,
    goals: ComposeGoalsSchema,
    kpi_table: s,
    channels_ranked: s,
    content_plan: s,
    flows: s,
    later_list: s,
    checklist: s,
    tool_manifest_yaml: s,
    hubs_in_use: s,
    backlog_yaml: s,
    owner: ComposeOwnerSchema,
    budget: ComposeBudgetSchema,
    preapproved: s,
    never: s,
    playbooks_included: s,
  })
  .strict();
export type ComposeInput = z.infer<typeof ComposeInputSchema>;

export const ComposeInputJsonSchema = zodToJsonSchema(ComposeInputSchema, { name: "ComposeInput", $refStrategy: "none", target: "jsonSchema7" });
