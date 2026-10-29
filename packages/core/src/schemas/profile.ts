/**
 * Profile schema — SPEC §6.1
 *
 * Detected project profile. Every field is wrapped as { value, source, confidence };
 * low-confidence fields surface as questions during S2 detection.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export const ConfidenceSchema = z
  .enum(["high", "medium", "low"])
  .describe("Detection confidence. `low` fields become user questions.");

export type Confidence = z.infer<typeof ConfidenceSchema>;

// ---------------------------------------------------------------------------
// ProfileField — the wrapper for every detected value
// ---------------------------------------------------------------------------

export function profileField<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .object({
      value: valueSchema,
      source: z
        .string()
        .min(1)
        .describe("How the value was determined (e.g. file path, detector name, 'llm-inferred')."),
      confidence: ConfidenceSchema,
    })
    .strict();
}

// ---------------------------------------------------------------------------
// Enums for the profile
// ---------------------------------------------------------------------------

export const AppTypeSchema = z.enum([
  "nextjs",
  "vite-spa",
  "astro",
  "remix",
  "nuxt",
  "sveltekit",
  "express",
  "fastify",
  "nestjs",
  "fastapi",
  "django",
  "flask",
  "rails",
  "laravel",
  "go",
  "rust",
  "static",
  "unknown",
]);

export type AppType = z.infer<typeof AppTypeSchema>;

export const ArtifactKindSchema = z.enum(["image", "build-dir", "repo", "static-dir"]);

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const FrameworkSchema = z
  .string()
  .min(1)
  .describe("Framework / runtime identifier, e.g. 'nextjs@14', 'express@4', 'fastapi'.");

export const ResourceHintTypeSchema = z.enum([
  "database",
  "cache",
  "object-storage",
  "queue",
  "cron",
  "search",
]);

export type ResourceHintType = z.infer<typeof ResourceHintTypeSchema>;

export const ResourceHintSchema = z
  .object({
    type: ResourceHintTypeSchema,
    detail: z.string().min(1).describe("Human-readable detail, e.g. 'postgres via DATABASE_URL'."),
    envVars: z.array(z.string()).default([]).describe("Related env var names."),
  })
  .strict();

export type ResourceHint = z.infer<typeof ResourceHintSchema>;

// ---------------------------------------------------------------------------
// EnvVar — just the name is captured; values never leave the host (SPEC §5)
// ---------------------------------------------------------------------------

export const EnvVarNameSchema = z
  .string()
  .min(1)
  .describe("Environment variable name (never the value).");

// ---------------------------------------------------------------------------
// Full Profile — every field uses profileField<{value shape}>
// ---------------------------------------------------------------------------

export const ProfileSchema = z
  .object({
    /**
     * High-level app type detected from manifests / framework hints.
     */
    appType: profileField(AppTypeSchema),
    /**
     * Framework / stack identifier plus version when detectable.
     */
    framework: profileField(
      FrameworkSchema.nullable().describe(
        "Framework identifier or null if not determinable.",
      ),
    ),
    /**
     * How the app is shipped: Docker image, build output directory, the repo itself.
     */
    artifactKind: profileField(ArtifactKindSchema),
    /**
     * Ports the app listens on (collected from Dockerfile, compose, code, etc.).
     */
    ports: profileField(z.array(z.number().int().min(1).max(65535)).default([])),
    /**
     * Build command, if any (e.g. 'npm run build', 'pip install -r requirements.txt').
     */
    buildCommand: profileField(z.string().nullable()),
    /**
     * Start / run command (e.g. 'npm start', 'uvicorn main:app').
     */
    startCommand: profileField(z.string().nullable()),
    /**
     * Environment variable names the project reads (from .env.example, code scan, etc.).
     */
    envVars: profileField(z.array(EnvVarNameSchema).default([])),
    /**
     * Supplementary resource needs inferred from code / config (DB, cache, etc.).
     */
    resourceHints: profileField(z.array(ResourceHintSchema).default([])),
    /**
     * Whether the site is static (no server runtime) or dynamic (needs a running process).
     */
    rendering: profileField(z.enum(["static", "dynamic"])),

    /**
     * Freeform notes from detectors (e.g. 'has Dockerfile', 'monorepo workspace detected').
     */
    notes: z.array(z.string()).default([]).describe("Detector notes, not a confidence question."),

    /**
     * Human-readable questions surfaced for low-confidence fields — shown to the user in S2.
     */
    questions: z
      .array(
        z.object({
          field: z.string().min(1).describe("Dot-path of the low-confidence field."),
          question: z.string().min(1),
        }),
      )
      .default([]),
  })
  .strict();

export type Profile = z.infer<typeof ProfileSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true if any confidence on the profile is `low`.
 */
export function profileHasLowConfidence(profile: Profile): boolean {
  const fields: Array<{ confidence: Confidence }> = [
    profile.appType,
    profile.framework,
    profile.artifactKind,
    profile.ports,
    profile.buildCommand,
    profile.startCommand,
    profile.envVars,
    profile.resourceHints,
    profile.rendering,
  ];
  return fields.some((f) => f.confidence === "low") || profile.questions.length > 0;
}

/**
 * Collect dot-paths for every low-confidence field.
 */
export function profileLowConfidenceFields(profile: Profile): string[] {
  const entries: Array<[string, { confidence: Confidence }]> = [
    ["appType", profile.appType],
    ["framework", profile.framework],
    ["artifactKind", profile.artifactKind],
    ["ports", profile.ports],
    ["buildCommand", profile.buildCommand],
    ["startCommand", profile.startCommand],
    ["envVars", profile.envVars],
    ["resourceHints", profile.resourceHints],
    ["rendering", profile.rendering],
  ];
  return entries.filter(([, f]) => f.confidence === "low").map(([k]) => k);
}

// ---------------------------------------------------------------------------
// JSON Schema export
// ---------------------------------------------------------------------------

export const ProfileJsonSchema = zodToJsonSchema(ProfileSchema, {
  name: "Profile",
  $refStrategy: "none",
  target: "jsonSchema7",
});
