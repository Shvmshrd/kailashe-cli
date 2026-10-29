/**
 * Manifest schema — SPEC §6.9 (tool-hubs.md §4)
 *
 * project, budget{monthly_cap_usd, per_action_cap_usd},
 * capabilities[{id, route, allowed[], class, cost?, notes?}].
 * Every entry's id must exist in connectors.yaml; never wildcard or admin actions.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ApprovalClassSchema } from "./task.js";

export const CapabilityIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/, "Capability id must be dotted lowercase, e.g. 'seo.keywords'");

const allowedAction = z.string().min(1).refine(
  (a) => !a.includes("*") && !/(^|[._:-])admin($|[._:-])/.test(a.toLowerCase()) && a.toLowerCase() !== "delete_admin",
  "allowed actions must never be wildcard or admin actions",
);

export const ManifestBudgetSchema = z
  .object({
    monthly_cap_usd: z.number().min(0),
    per_action_cap_usd: z.number().min(0),
  })
  .strict();
export type ManifestBudget = z.infer<typeof ManifestBudgetSchema>;

export const ManifestCapabilitySchema = z
  .object({
    id: CapabilityIdSchema,
    route: z.string().min(1).describe("Route, e.g. 'muse:github', 'zapier:<app>', 'direct:<service>', 'browser'."),
    allowed: z.array(allowedAction).min(1).describe("Narrowest allowed actions. Never wildcard or admin."),
    class: ApprovalClassSchema,
    cost: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();
export type ManifestCapability = z.infer<typeof ManifestCapabilitySchema>;

export const ManifestSchema = z
  .object({
    project: z.string().min(1).describe("Project slug."),
    budget: ManifestBudgetSchema,
    capabilities: z.array(ManifestCapabilitySchema),
  })
  .strict();
export type Manifest = z.infer<typeof ManifestSchema>;

/** Capability ids in the manifest that do not exist in the given registry id set. */
export function unknownCapabilityIds(manifest: Manifest, capabilityIds: Iterable<string>): string[] {
  const known = new Set(capabilityIds);
  return manifest.capabilities.filter((c) => !known.has(c.id)).map((c) => c.id);
}

export const ManifestJsonSchema = zodToJsonSchema(ManifestSchema, { name: "Manifest", $refStrategy: "none", target: "jsonSchema7" });
