/**
 * LLMClient interface + default Meta Model API implementation.
 *
 * SPEC §2.2:
 * - Base URL https://api.meta.ai/v1, key MODEL_API_KEY, model muse-spark-1.3 (KAILASHE_MODEL)
 * - Endpoint Responses API: POST /v1/responses via OpenAI SDK with baseURL
 * - Standard default; Contributor (muse-spark-1.3-contributor) only when
 *   KAILASHE_ALLOW_CONTRIBUTOR_TIER=1 + printed warning, else refuse *-contributor
 * - Base URL and model configurable (KAILASHE_LLM_BASE_URL, KAILASHE_MODEL)
 * - 429 handling built into client layer
 * - Model budget per command run
 */

import type { LLMRequest, LLMResponse } from "./types.js";
import { normalizeInput } from "./types.js";
import { ModelBudget, resolveBudgetCap, estimateCostUsd, estimateTokens } from "./budget.js";
import { withBackoff } from "./backoff.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "muse-spark-1.3";
export const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
export const CONTRIBUTOR_SUFFIX = "-contributor";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LLMClient {
  respond(input: LLMRequest): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

export interface ResolvedLLMConfig {
  apiKey: string | undefined;
  baseURL: string;
  model: string;
  allowContributor: boolean;
  budgetCapUsd: number;
}

export function isContributorModel(model: string): boolean {
  return model.endsWith(CONTRIBUTOR_SUFFIX);
}

export function resolveLLMConfig(env: Record<string, string | undefined> = process.env): ResolvedLLMConfig {
  const baseURL = env["KAILASHE_LLM_BASE_URL"] || DEFAULT_BASE_URL;
  const model = env["KAILASHE_MODEL"] || DEFAULT_MODEL;
  const allowContributor = env["KAILASHE_ALLOW_CONTRIBUTOR_TIER"] === "1";
  const budgetCapUsd = resolveBudgetCap(env);
  const apiKey = env["MODEL_API_KEY"] || undefined;
  return { apiKey, baseURL, model, allowContributor, budgetCapUsd };
}

/**
 * Enforce contributor gate. Throws if model is contributor but not allowed.
 * Prints warning if contributor is allowed.
 */
export function assertContributorGate(model: string, allowContributor: boolean): void {
  if (isContributorModel(model)) {
    if (!allowContributor) {
      throw new Error(
        `Contributor model "${model}" requires KAILASHE_ALLOW_CONTRIBUTOR_TIER=1. ` +
          `Refusing to use a contributor-tier model without explicit opt-in.`,
      );
    }
    // Warning per SPEC §2.2 — every run that uses contributor prints it.
    console.warn(
      `[kailashe] Warning: using contributor tier model "${model}". ` +
        `Contributor tier data — prompts, code, files, context, and responses — may be used to improve Meta's products. ` +
        `See https://dev.meta.ai/help/policies-and-privacy/contributor-tier`,
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateLLMClientOptions {
  /** Override env resolution entirely. */
  config?: Partial<ResolvedLLMConfig>;
  /** Env object to read from (default process.env). Set to {} to use only config/defaults. */
  env?: Record<string, string | undefined>;
  /** Inject a pre-built OpenAI client (for tests). Must expose responses.create(). */
  openai?: {
    responses: { create: (args: Record<string, unknown>) => Promise<Record<string, unknown>> };
  };
  /** Inject or share a ModelBudget. */
  budget?: ModelBudget;
  /** Max 429 retries (default 5). */
  maxRetries?: number;
  /** Custom warn handler (default console.warn). */
  onBudgetWarn?: (spent: number, cap: number) => void;
}

export function createLLMClient(opts: CreateLLMClientOptions = {}): LLMClient & {
  config: ResolvedLLMConfig;
  budget: ModelBudget;
} {
  const env = opts.env ?? process.env;
  const resolved = opts.config ? { ...resolveLLMConfig(env), ...opts.config } : resolveLLMConfig(env);

  // Normalize baseURL — strip trailing slash
  if (resolved.baseURL.endsWith("/")) {
    resolved.baseURL = resolved.baseURL.replace(/\/+$/, "");
  }

  // Validate contributor gate eagerly so misconfiguration fails fast.
  assertContributorGate(resolved.model, resolved.allowContributor);

  const budget =
    opts.budget ??
    new ModelBudget({
      capUsd: resolved.budgetCapUsd,
      onWarn: opts.onBudgetWarn,
    });

  // Lazy OpenAI client — only created when first needed, so tests that
  // inject `openai` never need the SDK installed.
  let openaiClient: { responses: { create: (args: Record<string, unknown>) => Promise<Record<string, unknown>> } } | undefined =
    opts.openai as typeof openaiClient;

  async function getOpenAI(): Promise<NonNullable<typeof openaiClient>> {
    if (openaiClient) return openaiClient;
    // Dynamic import so the module can be used without `openai` installed (e.g. FakeLLM-only consumers).
    try {
      const mod = await import("openai");
      const OpenAI = (mod as unknown as { default: new (o: unknown) => typeof openaiClient }).default ?? (mod as unknown as new (o: unknown) => typeof openaiClient);
      openaiClient = new (OpenAI as unknown as new (o: Record<string, unknown>) => typeof openaiClient)({
        apiKey: resolved.apiKey,
        baseURL: resolved.baseURL,
      });
      return openaiClient!;
    } catch {
      throw new Error(
        `Missing "openai" package. Install it to use the default Meta Model API client: npm install openai`,
      );
    }
  }

  const client: LLMClient & { config: ResolvedLLMConfig; budget: ModelBudget } = {
    config: resolved,
    budget,

    async respond(request: LLMRequest): Promise<LLMResponse> {
      const model = request.model ?? resolved.model;
      assertContributorGate(model, resolved.allowContributor);

      const input = normalizeInput(request.input);

      const sdk = await getOpenAI();

      // Build the Responses API payload.
      const payload: Record<string, unknown> = {
        model,
        input,
      };
      if (request.tools && request.tools.length > 0) {
        payload["tools"] = request.tools;
      }

      const raw = await withBackoff(
        () => sdk.responses.create(payload),
        { maxRetries: opts.maxRetries },
      );

      // Map SDK response to LLMResponse.
      const response = mapSdkResponse(raw, model);

      // Budget accounting.
      if (response.usage) {
        const cost = estimateCostUsd(response.usage.input_tokens, response.usage.output_tokens);
        budget.addCost(cost);
      } else {
        // No usage — estimate from text.
        const text = response.output_text ?? "";
        const reqText = typeof request.input === "string" ? request.input : request.input.map((m) => m.content).join("\n");
        const tokens = estimateTokens(reqText + text);
        const cost = estimateCostUsd(Math.ceil(tokens / 2), Math.ceil(tokens / 2));
        budget.addCost(cost);
        // Mark as estimated on the response for callers.
        response.usage = {
          input_tokens: Math.ceil(tokens / 2),
          output_tokens: Math.ceil(tokens / 2),
          total_tokens: tokens,
          estimated: true,
        };
      }

      return response;
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// SDK response mapping
// ---------------------------------------------------------------------------

function mapSdkResponse(raw: Record<string, unknown>, fallbackModel: string): LLMResponse {
  const id = (raw["id"] as string) ?? `resp_${Date.now()}`;
  const model = (raw["model"] as string) ?? fallbackModel;

  // Responses API shape: { output: [{ type, content }], output_text, usage }
  let outputText = (raw["output_text"] as string) ?? "";
  const rawOutput = (raw["output"] as unknown[]) ?? [];
  const output: LLMResponse["output"] = [];

  for (const item of rawOutput) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = (o["type"] as string) ?? "text";

    if (type === "message") {
      // Nested content array
      const content = o["content"] as unknown[] | undefined;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== "object") continue;
          const p = part as Record<string, unknown>;
          if (p["type"] === "output_text" || p["type"] === "text") {
            const t = (p["text"] as string) ?? "";
            output.push({ type: "text", text: t });
            if (!outputText) outputText += t;
          }
        }
      }
    } else if (type === "function_call" || type === "tool_call") {
      output.push({
        type: "function_call",
        name: (o["name"] as string) ?? (o["function"] as string) ?? "unknown",
        arguments: typeof o["arguments"] === "string" ? (o["arguments"] as string) : JSON.stringify(o["arguments"] ?? {}),
        call_id: o["call_id"] as string | undefined,
      });
    } else if (type === "reasoning") {
      output.push({ type: "reasoning", text: (o["text"] as string) ?? "" });
    } else if (type === "text" || type === "output_text") {
      const t = (o["text"] as string) ?? (o["content"] as string) ?? "";
      output.push({ type: "text", text: t });
      if (!outputText) outputText += t;
    }
  }

  // If we built output but outputText is still empty, join text items.
  if (!outputText && output.length > 0) {
    outputText = output
      .filter((o) => o.type === "text")
      .map((o) => (o as { text: string }).text)
      .join("");
  }

  // Fallback: raw may have output_text directly but no output array
  if (output.length === 0 && outputText) {
    output.push({ type: "text", text: outputText });
  }

  const rawUsage = raw["usage"] as Record<string, unknown> | undefined;
  let usage: LLMResponse["usage"] | undefined;
  if (rawUsage) {
    const inputTok = rawUsage["input_tokens"] ?? rawUsage["prompt_tokens"];
    const outputTok = rawUsage["output_tokens"] ?? rawUsage["completion_tokens"];
    const totalTok = rawUsage["total_tokens"] ?? rawUsage["totalTokens"];
    if (typeof inputTok === "number" || typeof outputTok === "number") {
      usage = {
        input_tokens: (inputTok as number) ?? 0,
        output_tokens: (outputTok as number) ?? 0,
        total_tokens: (totalTok as number) ?? ((inputTok as number) ?? 0) + ((outputTok as number) ?? 0),
      };
    }
  }

  return { id, model, output_text: outputText, output, usage, raw };
}

// Re-export budget/backoff symbols that consumers often need alongside the client.
export { BudgetExceededError, EXIT_BUDGET_EXCEEDED } from "./budget.js";
export { isRateLimitError, getBackoffDelay, parseRetryAfter } from "./backoff.js";
