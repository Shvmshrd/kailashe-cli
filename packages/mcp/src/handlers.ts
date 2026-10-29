/**
 * Tool handlers for the Kailashe MCP server (SPEC F4 / S12).
 *
 * Read tools (`detect_project`, `list_providers`, `status`) answer without
 * side effects and never require confirmation.
 * Write tools (`deploy`, `scan_business`, `build_prompt`) return a plan
 * first (`status: "needs_confirmation"`) and only invoke the backend when
 * the caller passes an explicit `confirm: true` argument.
 *
 * Handlers are thin and injectable: they depend only on the
 * `KailasheBackend` interface, so tests use a fake backend and never spawn
 * real providers, CLIs, or network calls. `StubBackend` is the default
 * wiring used by the stdio server until real scan/deploy/compose backends
 * are injected by the host; every stub result is marked `stub: true`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Backend contract (injected; real implementations live outside this package)
// ---------------------------------------------------------------------------

export interface ProviderInfo {
  id: string;
  name: string;
  riskClass?: string;
}

export interface DetectProjectResult {
  path: string;
  appType: string;
  hints: string[];
  stub: boolean;
}

export interface StatusResult {
  path: string;
  state: string;
  stub: boolean;
}

export interface WriteResult {
  action: string;
  path: string;
  status: string;
  stub: boolean;
  detail: string;
}

export interface KailasheBackend {
  detectProject(input: { path: string }): Promise<DetectProjectResult>;
  listProviders(): Promise<ProviderInfo[]>;
  status(input: { path: string }): Promise<StatusResult>;
  deploy(input: { path: string; provider?: string }): Promise<WriteResult>;
  scanBusiness(input: { path: string }): Promise<WriteResult>;
  buildPrompt(input: { path: string }): Promise<WriteResult>;
}

/**
 * STUB backend — returns structured placeholder data, performs no side
 * effects, no subprocesses and no network calls. Replace by injecting a
 * real backend into `createHandlers` / `createKailasheServer`.
 */
export class StubBackend implements KailasheBackend {
  async detectProject(input: { path: string }): Promise<DetectProjectResult> {
    return { path: input.path, appType: "unknown", hints: [], stub: true };
  }

  async listProviders(): Promise<ProviderInfo[]> {
    return [];
  }

  async status(input: { path: string }): Promise<StatusResult> {
    return { path: input.path, state: "unknown", stub: true };
  }

  async deploy(input: { path: string; provider?: string }): Promise<WriteResult> {
    return {
      action: "deploy",
      path: input.path,
      status: "stubbed",
      stub: true,
      detail: `StubBackend: no deploy performed${input.provider ? ` (provider=${input.provider})` : ""}. Inject a real backend to deploy.`,
    };
  }

  async scanBusiness(input: { path: string }): Promise<WriteResult> {
    return {
      action: "scan_business",
      path: input.path,
      status: "stubbed",
      stub: true,
      detail: "StubBackend: no scan performed. Inject a real backend to scan.",
    };
  }

  async buildPrompt(input: { path: string }): Promise<WriteResult> {
    return {
      action: "build_prompt",
      path: input.path,
      status: "stubbed",
      stub: true,
      detail: "StubBackend: no prompt built. Inject a real backend to compose prompt.md.",
    };
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — every external input is validated at the boundary (AGENTS.md)
// ---------------------------------------------------------------------------

const PathSchema = z.string().trim().min(1, "path must be a non-empty string");

export const DetectProjectArgsSchema = z.object({ path: PathSchema }).strict();
export const ListProvidersArgsSchema = z.object({}).strict();
export const StatusArgsSchema = z
  .object({ path: PathSchema.optional() })
  .strict();
export const DeployArgsSchema = z
  .object({
    path: PathSchema,
    provider: z.string().trim().min(1).optional(),
    confirm: z.boolean().optional(),
  })
  .strict();
export const ScanBusinessArgsSchema = z
  .object({ path: PathSchema, confirm: z.boolean().optional() })
  .strict();
export const BuildPromptArgsSchema = z
  .object({ path: PathSchema, confirm: z.boolean().optional() })
  .strict();

export type DetectProjectArgs = z.infer<typeof DetectProjectArgsSchema>;
export type StatusArgs = z.infer<typeof StatusArgsSchema>;
export type DeployArgs = z.infer<typeof DeployArgsSchema>;
export type ScanBusinessArgs = z.infer<typeof ScanBusinessArgsSchema>;
export type BuildPromptArgs = z.infer<typeof BuildPromptArgsSchema>;

// ---------------------------------------------------------------------------
// Handler result shape
// ---------------------------------------------------------------------------

export type ToolStatus = "ok" | "needs_confirmation";

export interface ToolResult<T> {
  status: ToolStatus;
  /** True for read tools, false for write tools. */
  readOnly: boolean;
  data?: T;
  /** Human/LLM-readable plan, present when confirmation is required. */
  plan?: string;
}

/** Thrown for invalid arguments; the MCP layer surfaces it as a tool error. */
export class NeedsConfirmationError extends Error {
  readonly code = "needs_confirmation";
  constructor(action: string) {
    super(`${action} is a write tool: re-call with confirm=true to proceed.`);
    this.name = "NeedsConfirmationError";
  }
}

function needsConfirmation<T>(action: string, plan: string): ToolResult<T> {
  return { status: "needs_confirmation", readOnly: false, plan };
}

// ---------------------------------------------------------------------------
// Handlers (injectable, directly testable without any transport)
// ---------------------------------------------------------------------------

export interface Handlers {
  detectProject(args: unknown): Promise<ToolResult<DetectProjectResult>>;
  listProviders(args: unknown): Promise<ToolResult<ProviderInfo[]>>;
  status(args: unknown): Promise<ToolResult<StatusResult>>;
  deploy(args: unknown): Promise<ToolResult<WriteResult>>;
  scanBusiness(args: unknown): Promise<ToolResult<WriteResult>>;
  buildPrompt(args: unknown): Promise<ToolResult<WriteResult>>;
}

export function createHandlers(backend: KailasheBackend): Handlers {
  return {
    async detectProject(args: unknown) {
      const parsed: DetectProjectArgs = DetectProjectArgsSchema.parse(args ?? {});
      const data = await backend.detectProject({ path: parsed.path });
      return { status: "ok", readOnly: true, data };
    },

    async listProviders(args: unknown) {
      ListProvidersArgsSchema.parse(args ?? {});
      const data = await backend.listProviders();
      return { status: "ok", readOnly: true, data };
    },

    async status(args: unknown) {
      const parsed: StatusArgs = StatusArgsSchema.parse(args ?? {});
      const data = await backend.status({ path: parsed.path ?? "." });
      return { status: "ok", readOnly: true, data };
    },

    async deploy(args: unknown) {
      const parsed: DeployArgs = DeployArgsSchema.parse(args ?? {});
      if (parsed.confirm !== true) {
        return needsConfirmation<WriteResult>(
          "deploy",
          `Plan: deploy project at "${parsed.path}"${parsed.provider ? ` via provider "${parsed.provider}"` : ""}. ` +
            `No action has been taken. Re-call deploy with confirm=true to proceed.`,
        );
      }
      const data = await backend.deploy({ path: parsed.path, provider: parsed.provider });
      return { status: "ok", readOnly: false, data };
    },

    async scanBusiness(args: unknown) {
      const parsed: ScanBusinessArgs = ScanBusinessArgsSchema.parse(args ?? {});
      if (parsed.confirm !== true) {
        return needsConfirmation<WriteResult>(
          "scan_business",
          `Plan: scan the business/project at "${parsed.path}" and write scan outputs. ` +
            `No action has been taken. Re-call scan_business with confirm=true to proceed.`,
        );
      }
      const data = await backend.scanBusiness({ path: parsed.path });
      return { status: "ok", readOnly: false, data };
    },

    async buildPrompt(args: unknown) {
      const parsed: BuildPromptArgs = BuildPromptArgsSchema.parse(args ?? {});
      if (parsed.confirm !== true) {
        return needsConfirmation<WriteResult>(
          "build_prompt",
          `Plan: build prompt.md for the project at "${parsed.path}". ` +
            `No file has been written. Re-call build_prompt with confirm=true to proceed.`,
        );
      }
      const data = await backend.buildPrompt({ path: parsed.path });
      return { status: "ok", readOnly: false, data };
    },
  };
}
