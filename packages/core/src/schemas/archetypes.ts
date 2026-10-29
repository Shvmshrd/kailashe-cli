/**
 * Archetypes schema — SPEC §6.11 (archetypes.yaml shape, §2.1)
 *
 * The 9 archetypes: id, name, detect[], audience, channels_ranked[],
 * content_mix{bottom,middle,top,proof}, first_30_days[], flows[], kpis[], cautions[].
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const ArchetypeIdSchema = z.enum([
  "dev-tool",
  "b2b-saas",
  "b2c-app",
  "ai-tool",
  "content-media",
  "ecommerce",
  "local-service",
  "digital-product",
  "free-utility",
]);
export type ArchetypeId = z.infer<typeof ArchetypeIdSchema>;

const pct = z.number().min(0).max(100);
export const ContentMixSchema = z
  .object({ bottom: pct, middle: pct, top: pct, proof: pct })
  .strict()
  .refine((m) => m.bottom + m.middle + m.top + m.proof === 100, "content_mix percentages must sum to 100");
export type ContentMix = z.infer<typeof ContentMixSchema>;

const strings = z.array(z.string().min(1)).min(1);

export const ArchetypeSchema = z
  .object({
    id: ArchetypeIdSchema,
    name: z.string().min(1),
    detect: strings,
    audience: z.string().min(1),
    channels_ranked: strings.describe("Channel ids (labels; validated via ChannelMap, SPEC §6.13)."),
    content_mix: ContentMixSchema,
    first_30_days: strings,
    flows: strings.describe("Starter flow ids (tool-hubs.md §7)."),
    kpis: strings,
    cautions: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type Archetype = z.infer<typeof ArchetypeSchema>;

export const ArchetypesSchema = z
  .object({
    version: z.number().int().min(1),
    archetypes: z
      .array(ArchetypeSchema)
      .length(9, "Exactly the 9 archetypes from archetypes.yaml")
      .superRefine((list, ctx) => {
        const seen = new Set<string>();
        list.forEach((a, i) => {
          if (seen.has(a.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "id"], message: `Duplicate archetype id '${a.id}'` });
          seen.add(a.id);
        });
      }),
  })
  .strict();
export type Archetypes = z.infer<typeof ArchetypesSchema>;

export const ArchetypeJsonSchema = zodToJsonSchema(ArchetypeSchema, { name: "Archetype", $refStrategy: "none", target: "jsonSchema7" });
export const ArchetypesJsonSchema = zodToJsonSchema(ArchetypesSchema, { name: "Archetypes", $refStrategy: "none", target: "jsonSchema7" });
