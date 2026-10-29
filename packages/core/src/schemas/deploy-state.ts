/**
 * DeployState schema — SPEC §6.4 (.kailashe/deploy-state.json)
 *
 * Written after each successful create (F2.6). Tracks project, provider,
 * tagged resource ids, live URL, timestamps, and a step log.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// Log entry for a single executed command
// ---------------------------------------------------------------------------

export const StepLogStatusSchema = z.enum(["succeeded", "failed", "skipped", "pending"]);

export type StepLogStatus = z.infer<typeof StepLogStatusSchema>;

export const StepLogEntrySchema = z
  .object({
    step: z.number().int().min(0).describe("Index into the DeployPlan commands array."),
    command: z.array(z.string()).min(1).describe("Command that was run (redacted where needed)."),
    status: StepLogStatusSchema,
    startedAt: z.string().datetime({ offset: true }).nullable().default(null),
    finishedAt: z.string().datetime({ offset: true }).nullable().default(null),
    exitCode: z.number().int().nullable().default(null),
    outputSnippet: z.string().nullable().default(null).describe("Truncated/redacted stdout+stderr snippet."),
    resourceId: z.string().nullable().default(null).describe("Resource id created/updated by this step, if any."),
    error: z.string().nullable().default(null),
  })
  .strict();

export type StepLogEntry = z.infer<typeof StepLogEntrySchema>;

// ---------------------------------------------------------------------------
// Stored resource snapshot
// ---------------------------------------------------------------------------

export const DeployStateResourceSchema = z
  .object({
    name: z.string().min(1),
    kind: z.string().min(1),
    provider: z.string().min(1),
    resourceId: z.string().min(1).describe("Provider-side identifier for the resource."),
    tags: z.record(z.string()).default({}).describe("Tags applied at creation, e.g. { 'kailashe-project': 'my-app' }."),
    createdAt: z.string().datetime({ offset: true }),
    details: z.record(z.unknown()).optional(),
  })
  .strict();

export type DeployStateResource = z.infer<typeof DeployStateResourceSchema>;

// ---------------------------------------------------------------------------
// DeployState
// ---------------------------------------------------------------------------

export const DeployStateSchema = z
  .object({
    /** File format version — bump on breaking changes. */
    version: z.number().int().min(1).default(1),

    projectId: z.string().min(1).describe("Project slug/id (also used as tag value)."),
    provider: z.string().min(1).describe("Active provider id."),
    planId: z.string().min(1).default("plan-001").describe("Plan that produced this state."),

    /**
     * Live URL once deploy succeeds (F2.7). Null during a partial / in-flight deploy.
     */
    url: z.string().url().nullable().default(null),

    /** Resources created/managed (tagged kailashe-project={{projectId}}). */
    resources: z.array(DeployStateResourceSchema).default([]),

    /** When the project was first created in this state file. */
    createdAt: z.string().datetime({ offset: true }),
    /** When the state was last mutated (after each create, per F2.6). */
    updatedAt: z.string().datetime({ offset: true }),

    /**
     * Step log — one entry per DeployPlan command that has been attempted.
     * Appended after every create (F2.6) so teardown can find tagged resources even after a partial failure.
     */
    stepLog: z.array(StepLogEntrySchema).default([]),

    /** Overall deploy status. */
    status: z.enum(["pending", "in-progress", "deployed", "failed", "torn-down"]).default("pending"),
  })
  .strict();

export type DeployState = z.infer<typeof DeployStateSchema>;

// ---------------------------------------------------------------------------
// JSON Schema export
// ---------------------------------------------------------------------------

export const DeployStateJsonSchema = zodToJsonSchema(DeployStateSchema, {
  name: "DeployState",
  $refStrategy: "none",
  target: "jsonSchema7",
});
