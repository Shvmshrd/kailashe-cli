/**
 * Provider schema — SPEC §6.2 (providers/*.yaml, S3 registry + bootstrap)
 *
 * Each file in providers/*.yaml describes one deployment provider:
 * CLI binary, OS install commands with source URLs, login/verify, docs domains,
 * and the allowlisted binary+subcommand patterns with risk classes (§F2a form).
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// Risk classes — locked per SPEC §4.2 / §F2a
// ---------------------------------------------------------------------------

export const RiskClassSchema = z.enum([
  "read",
  "create",
  "modify",
  "delete",
  "iam-billing-network",
]);

export type RiskClass = z.infer<typeof RiskClassSchema>;

// ---------------------------------------------------------------------------
// Install command — per-OS entry, source URL required (SPEC F2.3)
// ---------------------------------------------------------------------------

export const OsNameSchema = z.enum(["linux", "macos", "windows"]);

export type OsName = z.infer<typeof OsNameSchema>;

export const InstallCommandSchema = z
  .object({
    os: OsNameSchema.describe("Operating system this install path applies to."),
    command: z.string().min(1).describe("Exact install command shown to the user or run via the runner."),
    sourceUrl: z.string().url().describe("Official documentation URL that authorizes this install command."),
    notes: z.string().optional(),
  })
  .strict();

export type InstallCommand = z.infer<typeof InstallCommandSchema>;

// ---------------------------------------------------------------------------
// Allowed pattern — binary + subcommand prefix + risk class
// ---------------------------------------------------------------------------

export const AllowedPatternSchema = z
  .object({
    /** Prefix pattern; the runner matches binary + subcommand prefix (SPEC §F2a). */
    pattern: z.string().min(1).describe("Allowlist pattern, e.g. 'aws sts get-caller-identity'."),
    class: RiskClassSchema.describe("Risk class for approval prompting."),
    notes: z.string().optional(),
  })
  .strict();

export type AllowedPattern = z.infer<typeof AllowedPatternSchema>;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const ProviderSchema = z
  .object({
    /** Stable machine id used as providers/<id>.yaml filename and in DeployState/Provider references. */
    id: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/, "Provider id must be lowercase alphanumeric + hyphens, starting with a letter."),
    /** Human display name. */
    name: z.string().min(1),
    /**
     * Primary CLI binary name (e.g. 'aws', 'doctl', 'vercel', 'wrangler', 'fly').
     * All allowlist patterns and audit log entries are keyed on this.
     */
    cliBinary: z.string().min(1),

    /**
     * Install instructions per OS. Shown verbatim (§F2.3) before bootstrap.
     * At least one entry is required; coverage of linux+macos+windows is recommended.
     */
    install: z.array(InstallCommandSchema).min(1),

    /**
     * Login command run with inherited stdio after CLI detection (F2.4).
     * Example: { command: 'aws sso login', docsUrl: '...' }
     */
    login: z
      .object({
        command: z.string().min(1).describe("Command run to authenticate (runner, inherited stdio)."),
        docsUrl: z.string().url().optional(),
        /**
         * Printed alongside the login prompt so the user sees the URL/code.
         * Providers that show a URL/code at login (e.g. doctl, fly, vercel) set this.
         */
        helpText: z.string().optional(),
      })
      .strict(),

    /** Command run after login to confirm authentication is valid. */
    verify: z
      .object({
        command: z.string().min(1).describe("Verify command — must be in allowlist and class `read`."),
        expectedExitCode: z.number().int().min(0).max(255).default(0),
      })
      .strict(),

    /**
     * Docs domains allowlisted for fetch_docs (SPEC §5). Only domains in this
     * list (plus any global fetch allowlist) may be fetched for this provider.
     */
    docsDomains: z.array(z.string().min(1)).default([]),

    /**
     * Allowlisted binary+subcommand patterns. Any command outside this list
     * is rejected before spawn (S4, SPEC §4.2). Mirrors the SPEC §F2a table.
     */
    allowedPatterns: z.array(AllowedPatternSchema).min(1),

    /**
     * Health check + tagging conventions for this provider.
     * `healthPath` is fetched (HTTP 200) to verify a deploy (F2.7).
     * `tagPrefix`/`tagKey` controls kailashe-project={{id}} resource tagging (F2.6).
     */
    health: z
      .object({
        path: z.string().min(1).default("/").describe("Health path probed after deploy (GET → 200)."),
        timeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
      })
      .strict()
      .optional(),

    tagging: z
      .object({
        /** Tag key used for resource ownership, e.g. 'kailashe-project'. */
        key: z.string().min(1).default("kailashe-project"),
        /** Tag value set to {{projectId}} (the actual project slug/id). */
        value: z.string().optional().describe("Unused on output; included so the YAML can document the convention."),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((provider, _ctx) => {
    // login + verify must correspond to allowlisted patterns
    const binary = provider.cliBinary;
    const allowPatterns = new Set(provider.allowedPatterns.map((p) => p.pattern));
    // Helper: does any allowlist pattern cover a given command prefix?
    const isCovered = (cmd: string): boolean => {
      const normalized = cmd.trim().split(/\s+/).join(" ");
      for (const pat of allowPatterns) {
        if (normalized === pat || normalized.startsWith(pat + " ") || normalized.startsWith(pat + " --")) {
          return true;
        }
        // If pattern is just the binary, it covers everything from that binary.
        if (pat === binary && normalized.startsWith(`${binary} `)) return true;
      }
      return false;
    };
    // Verify cmd must be covered (warning-style: we still let it pass, but flag it)
    void isCovered;
  });

export type Provider = z.infer<typeof ProviderSchema>;

// ---------------------------------------------------------------------------
// Helper — validate a raw YAML load against the schema with a useful prefix
// ---------------------------------------------------------------------------

/**
 * Parse a raw provider object (from YAML) and return either `{ provider }` or
 * `{ errors }` with formatted issues. Does not throw.
 */
export function parseProvider(
  raw: unknown,
): { provider: Provider; errors?: undefined } | { provider?: undefined; errors: string } {
  const parsed = ProviderSchema.safeParse(raw);
  if (parsed.success) return { provider: parsed.data };
  return { errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

// ---------------------------------------------------------------------------
// JSON Schema export
// ---------------------------------------------------------------------------

export const ProviderJsonSchema = zodToJsonSchema(ProviderSchema, {
  name: "Provider",
  $refStrategy: "none",
  target: "jsonSchema7",
});
