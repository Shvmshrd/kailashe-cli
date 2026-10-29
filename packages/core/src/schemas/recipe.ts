/**
 * Recipe schema — SPEC §6.5
 *
 * Saved after a successful deploy (F2.9). The next deploy replays the recipe;
 * the agent loop is only used when a recipe step fails.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const RecipeSchema = z
  .object({
    /** Recipe format version. */
    version: z.number().int().min(1).default(1),

    /** Human label, typically "projectId @ provider". */
    id: z.string().min(1).describe("Recipe identifier, e.g. 'my-app@digitalocean'."),

    provider: z.string().min(1).describe("Provider id this recipe targets."),
    appType: z.string().min(1).describe("App type at the time the recipe was saved."),
    artifactKind: z.enum(["image", "build-dir", "repo", "static-dir"]).describe("Artifact kind the recipe deploys."),

    /**
     * The ordered commands from the successful DeployPlan that worked.
     * Replayed verbatim; the runner still enforces the provider allowlist.
     */
    commands: z
      .array(
        z
          .object({
            command: z.array(z.string().min(1)).min(1),
            description: z.string().min(1),
            /** doc ref captured so future runs can warn if docs changed. */
            docUrl: z.string().url().nullable().default(null),
            docDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/, "docDate must be YYYY-MM-DD")
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .min(1),

    /** When the provider docs referenced by the recipe were fetched. */
    docsDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "docsDate must be YYYY-MM-DD"),

    /** When this recipe was saved (ISO 8601). */
    createdAt: z.string().datetime({ offset: true }),

    /** Project id used for tagging. */
    projectId: z.string().min(1),

    /** Live URL observed after the successful deploy that produced this recipe. */
    url: z.string().url().nullable().default(null),

    notes: z.string().optional().describe("Operator notes, e.g. why this path was chosen."),
  })
  .strict();

export type Recipe = z.infer<typeof RecipeSchema>;

// ---------------------------------------------------------------------------
// JSON Schema export
// ---------------------------------------------------------------------------

export const RecipeJsonSchema = zodToJsonSchema(RecipeSchema, {
  name: "Recipe",
  $refStrategy: "none",
  target: "jsonSchema7",
});
