/**
 * DeployPlan schema — SPEC §6.3
 *
 * Shown and approved pre-flight (F2.5) before any create/modify/delete runs.
 * Includes: resources, exact commands, monthly cost estimate, rollback, docs per step.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// Resource descriptor
// ---------------------------------------------------------------------------

export const ResourceKindSchema = z.enum([
  "static-site",
  "container-service",
  "container-image",
  "image-registry",
  "database",
  "cache",
  "object-storage",
  "cdn",
  "domain",
  "dns-record",
  "iam-role",
  "iam-policy",
  "secret",
  "other",
]);

export type ResourceKind = z.infer<typeof ResourceKindSchema>;

export const DeployPlanResourceSchema = z
  .object({
    name: z.string().min(1).describe("Human label for the resource, e.g. 'web container service'."),
    kind: ResourceKindSchema,
    provider: z.string().min(1).describe("Provider id that owns this resource."),
    /** Estimated action for this resource in the plan context (create / update / reuse). */
    action: z.enum(["create", "update", "reuse"]).default("create"),
    /** Provider-specific identifier once created (filled post-execute; may be null in the plan). */
    resourceId: z.string().nullable().default(null),
    details: z.record(z.unknown()).optional().describe("Provider-specific metadata (region, tier, etc.)."),
  })
  .strict();

export type DeployPlanResource = z.infer<typeof DeployPlanResourceSchema>;

// ---------------------------------------------------------------------------
// Command step
// ---------------------------------------------------------------------------

export const PlanCommandSchema = z
  .object({
    /** Exact command array — first element is the binary. Args are never shell-interpreted. */
    command: z.array(z.string().min(1)).min(1),
    description: z.string().min(1).describe("What this step does."),
    /** Risk class for approval prompting; must agree with the provider allowlist. */
    riskClass: z.enum(["read", "create", "modify", "delete", "iam-billing-network"]),
    /** Resource index (into resources[]) this command acts on, if any. */
    resourceRef: z.string().nullable().default(null),
    /** Official docs URL backing this step. */
    docUrl: z.string().url().nullable().default(null),
    /** Date the docs were checked (ISO date, YYYY-MM-DD). */
    docDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "docDate must be YYYY-MM-DD")
      .nullable()
      .default(null),
    /** Whether this command may be retried on failure. */
    retryable: z.boolean().default(true),
  })
  .strict();

export type PlanCommand = z.infer<typeof PlanCommandSchema>;

// ---------------------------------------------------------------------------
// DeployPlan
// ---------------------------------------------------------------------------

export const DeployPlanSchema = z
  .object({
    /** Stable plan/version identifier (UUID or short id). */
    id: z.string().min(1).default("plan-001"),
    provider: z.string().min(1).describe("Target provider id."),
    projectId: z.string().min(1).describe("Project slug/id (used for tagging)."),
    createdAt: z.string().datetime({ offset: true }).describe("Plan creation timestamp (ISO 8601)."),

    resources: z.array(DeployPlanResourceSchema).min(1).describe("Resources the plan will create/manage."),
    commands: z.array(PlanCommandSchema).min(1).describe("Exact commands in execution order."),

    /** Monthly recurring cost estimate (USD). 0 means free tier / not estimated. */
    monthlyCost: z
      .object({
        amountUsd: z.number().min(0),
        currency: z.string().default("USD"),
        breakdown: z
          .array(
            z.object({
              resource: z.string().min(1),
              costUsd: z.number().min(0),
              note: z.string().optional(),
            }),
          )
          .default([]),
        note: z.string().optional().describe("Extra context, e.g. 'excludes egress, first month free tier'."),
      })
      .strict(),

    /** Rollback commands — run in order if deploy fails mid-flight. */
    rollbackCommands: z
      .array(PlanCommandSchema)
      .default([])
      .describe("Rollback/teardown commands (F2.5 rollback, F2.8 teardown only tagged)."),

    /** Freeform summary printed with the plan (why this provider, assumptions). */
    summary: z.string().optional(),
  })
  .strict();

export type DeployPlan = z.infer<typeof DeployPlanSchema>;

// ---------------------------------------------------------------------------
// JSON Schema export
// ---------------------------------------------------------------------------

export const DeployPlanJsonSchema = zodToJsonSchema(DeployPlanSchema, {
  name: "DeployPlan",
  $refStrategy: "none",
  target: "jsonSchema7",
});
