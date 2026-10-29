/**
 * Deploy agent types — SPEC S5 (Gate G2)
 *
 * Tool definitions for the LLM loop, agent state, and plan/state/recipe schemas.
 * One slice, one package (packages/deploy/src/agent).
 */

import { z } from "zod";

// ── Tool names (SPEC S5: exactly these 7) ──────────────────────────────────

export const AGENT_TOOL_NAMES = [
  "fetch_docs",
  "run",
  "read_file",
  "write_file",
  "http_check",
  "ask_user",
  "record_state",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

// ── Tool arg / result shapes ───────────────────────────────────────────────

export interface FetchDocsArgs {
  /** Full URL to fetch (must be on docs allowlist). */
  url: string;
  /** Optional hint shown in logs. */
  reason?: string;
}

export interface FetchDocsResult {
  url: string;
  fetchedAt: string;
  /** Wrapped, script-stripped, truncated untrusted-data block. */
  content: string;
  /** True if content was truncated. */
  truncated: boolean;
  /** Source domain. */
  domain: string;
}

export interface RunArgs {
  /** Binary without path, e.g. "aws", "docker". */
  binary: string;
  /** Args array — never shell-interpreted. */
  args: string[];
  /** Working directory override. */
  cwd?: string;
  /** Timeout ms. */
  timeoutMs?: number;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Resolved binary path if available. */
  resolvedPath?: string;
  durationMs?: number;
  timedOut?: boolean;
}

export interface ReadFileArgs {
  path: string;
}

export interface ReadFileResult {
  path: string;
  content: string;
  truncated?: boolean;
}

export interface WriteFileArgs {
  path: string;
  content: string;
}

export interface WriteFileResult {
  path: string;
  bytesWritten: number;
}

export interface HttpCheckArgs {
  url: string;
  /** Expected status code (default 200). */
  expectedStatus?: number;
  timeoutMs?: number;
}

export interface HttpCheckResult {
  url: string;
  status: number;
  ok: boolean;
  bodySnippet?: string;
  durationMs: number;
}

export interface AskUserArgs {
  question: string;
  /** Optional context shown alongside the question. */
  context?: string;
  /** Approval class hint. */
  approvalClass?: "read" | "create" | "modify" | "delete" | "iam-billing-network";
}

export interface AskUserResult {
  approved: boolean;
  answer?: string;
}

export interface RecordStateArgs {
  /** Arbitrary state patch to merge into deploy-state.json. Caller provides the full shape. */
  state: AgentState;
}

export interface RecordStateResult {
  path: string;
  state: AgentState;
}

// ── Tool arg validation (LLM output is an external boundary: parse, never cast) ──

export const FetchDocsArgsSchema = z
  .object({ url: z.string().min(1), reason: z.string().optional() })
  .strict();

export const RunArgsSchema = z
  .object({
    binary: z.string().min(1),
    args: z.array(z.string()),
    cwd: z.string().optional(),
    timeoutMs: z.number().optional(),
  })
  .strict();

export const ReadFileArgsSchema = z.object({ path: z.string().min(1) }).strict();

export const WriteFileArgsSchema = z
  .object({ path: z.string().min(1), content: z.string() })
  .strict();

export const HttpCheckArgsSchema = z
  .object({
    url: z.string().min(1),
    expectedStatus: z.number().int().optional(),
    timeoutMs: z.number().optional(),
  })
  .strict();

export const AskUserArgsSchema = z
  .object({
    question: z.string().min(1),
    context: z.string().optional(),
    approvalClass: z
      .enum(["read", "create", "modify", "delete", "iam-billing-network"])
      .optional(),
  })
  .strict();

// AgentStateSchema is declared below; record_state validation reuses it there.

// ── Union tool call ────────────────────────────────────────────────────────

export type AgentToolCall =
  | { tool: "fetch_docs"; args: FetchDocsArgs }
  | { tool: "run"; args: RunArgs }
  | { tool: "read_file"; args: ReadFileArgs }
  | { tool: "write_file"; args: WriteFileArgs }
  | { tool: "http_check"; args: HttpCheckArgs }
  | { tool: "ask_user"; args: AskUserArgs }
  | { tool: "record_state"; args: RecordStateArgs };

// ── Deploy plan (SPEC §6.3) ───────────────────────────────────────────────

/**
 * One step in the deploy plan. Shown to the user for approval before any
 * create/modify/delete is executed (SPEC F2.5).
 */
export const DeployPlanStepSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    /** Exact binary invocation, e.g. "aws ecr create-repository ...". */
    command: z.string().min(1),
    /** Parsed binary + args for runner execution. */
    binary: z.string().min(1),
    args: z.array(z.string()),
    /** Risk class determines approval prompting. */
    riskClass: z.enum(["read", "create", "modify", "delete", "iam-billing-network"]),
    /** Monthly cost delta for this step, if applicable. */
    costDeltaUsd: z.number().optional(),
    /** Rollback command to undo this step (exact command or description). */
    rollback: z.string().min(1),
    /** Docs URL + fetch date that authorizes this step (SPEC S5: record URL+date). */
    docsUrl: z.string().url().optional(),
    docsFetchedAt: z.string().optional(),
    /** Provider resource id produced by this step (filled after success). */
    resourceId: z.string().optional(),
  })
  .strict();

export type DeployPlanStep = z.infer<typeof DeployPlanStepSchema>;

export const DeployPlanSchema = z
  .object({
    projectId: z.string().min(1),
    provider: z.string().min(1),
    /** AWS path choice: "ecs-express" or "lightsail" (SPEC F2a, Q4). */
    awsPath: z.enum(["ecs-express", "lightsail", "none"]).default("none"),
    awsPathReason: z.string().optional(),
    resources: z.array(z.string()).default([]),
    steps: z.array(DeployPlanStepSchema),
    estimatedMonthlyCostUsd: z.number().min(0),
    rollbackSummary: z.string().min(1),
  })
  .strict();

export type DeployPlan = z.infer<typeof DeployPlanSchema>;

// ── Agent state (deploy-state.json, SPEC §6.4) ─────────────────────────────

export const DeployedResourceSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    providerResourceId: z.string().optional(),
    createdAt: z.string().min(1),
    tags: z.record(z.string()).default({}),
    command: z.string().optional(),
    docsUrl: z.string().optional(),
    docsFetchedAt: z.string().optional(),
  })
  .strict();

export type DeployedResource = z.infer<typeof DeployedResourceSchema>;

export const AgentStateSchema = z
  .object({
    projectId: z.string().min(1),
    provider: z.string().min(1),
    region: z.string().optional(),
    resources: z.array(DeployedResourceSchema).default([]),
    url: z.string().optional(),
    timestamps: z
      .object({
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
        lastDeployAt: z.string().optional(),
      })
      .default({}),
    /** Log of completed steps (binary+args+exitCode). */
    stepLog: z
      .array(
        z.object({
          stepId: z.string(),
          binary: z.string(),
          args: z.array(z.string()),
          exitCode: z.number(),
          at: z.string(),
          durationMs: z.number().optional(),
          attempts: z.number().default(1),
        }),
      )
      .default([]),
    /** Escalation flag — set when 3 retries exhausted on a step. */
    escalated: z.boolean().optional(),
    escalationReason: z.string().optional(),
  })
  .strict();

export type AgentState = z.infer<typeof AgentStateSchema>;

export function createInitialState(projectId: string, provider: string): AgentState {
  const now = new Date().toISOString();
  return {
    projectId,
    provider,
    resources: [],
    timestamps: { createdAt: now, updatedAt: now },
    stepLog: [],
  };
}

export const RecordStateArgsSchema = z.object({ state: AgentStateSchema }).strict();

// ── Recipe (SPEC S5: replay on next deploy) ────────────────────────────────

export const RecipeSchema = z
  .object({
    version: z.number().int().default(1),
    provider: z.string().min(1),
    appType: z.string().min(1),
    artifactKind: z.string().optional(),
    commands: z.array(
      z.object({
        binary: z.string().min(1),
        args: z.array(z.string()).default([]),
        riskClass: z.string().optional(),
      }),
    ),
    docsDate: z.string().min(1).describe("ISO date when docs were last fetched for this recipe."),
    docsUrls: z.array(z.string().url()).default([]),
    createdAt: z.string().min(1),
    projectId: z.string().optional(),
    awsPath: z.enum(["ecs-express", "lightsail", "none"]).optional(),
  })
  .strict();

export type Recipe = z.infer<typeof RecipeSchema>;

// ── Agent options ───────────────────────────────────────────────────────────

export interface DeployAgentOptions {
  /** Project identifier used for tagging: kailashe-project={{id}}. */
  projectId: string;
  /** Provider id, e.g. "aws", "vercel", "digitalocean", "cloudflare", "fly". */
  provider: string;
  /** Absolute project root on disk. */
  projectRoot: string;
  /** Allowed docs domains (from provider registry docs_domains). */
  docsDomains: string[];
  /** AWS path override. When undefined the agent picks one from the profile/prompt. */
  awsPath?: "ecs-express" | "lightsail";
  /** Region (informational, passed to commands). */
  region?: string;
  /** Max LLM tool-loop iterations (default 40). */
  maxIterations?: number;
  /** Retries per failed step before escalate (default 3, SPEC S5). */
  maxRetriesPerStep?: number;
  /** Health path to verify after deploy (default "/"). */
  healthPath?: string;
  /** Override fetch for tests. */
  fetchFn?: typeof fetch;
}

// ── Final deploy report (SPEC F2.7) ───────────────────────────────────────

export interface DeployReport {
  ok: boolean;
  url?: string;
  resources: DeployedResource[];
  estimatedMonthlyCostUsd?: number;
  teardownCommand: string;
  plan?: DeployPlan;
  escalated?: boolean;
  escalationReason?: string;
}

// ── Approval callback ─────────────────────────────────────────────────────

export type ApprovalFn = (
  step: DeployPlanStep | { binary: string; args: string[]; riskClass: string },
) => Promise<boolean> | boolean;

// ── Constants ───────────────────────────────────────────────────────────────

export const KAILASHE_TAG_KEY = "kailashe-project";
export const DEPLOY_STATE_FILE = ".kailashe/deploy-state.json";
export const DOC_FETCH_DATE_FMT = "YYYY-MM-DD";
