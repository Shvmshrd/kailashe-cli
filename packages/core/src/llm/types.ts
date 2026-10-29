/**
 * LLM types — Responses-API shaped.
 *
 * Follows OpenAI SDK client.responses.create({ model, input }) with baseURL,
 * as verified against https://dev.meta.ai/docs/quickstart (2026-10-29).
 * Base URL https://api.meta.ai/v1, endpoint POST /v1/responses.
 *
 * The Responses API input is a list of messages; output is a list of
 * output items (text, function_call, etc.). These local types mirror that
 * shape without importing the SDK, so FakeLLM and consumers stay decoupled.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type LLMRole = "system" | "user" | "assistant" | "developer";

/** A single input message in the Responses API. */
export interface LLMInputItem {
  role: LLMRole;
  content: string;
}

/** Tool definition passed to the Responses API. */
export interface LLMToolDefinition {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface LLMRequest {
  /** Primary input — a plain string or a structured message list. */
  input: string | LLMInputItem[];
  /** Optional tool definitions for a tool loop. */
  tools?: LLMToolDefinition[];
  /** Per-request model override (otherwise the client's configured model). */
  model?: string;
  /** Hint for max output tokens. */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Token usage returned by the API (or estimated locally). */
export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  /** True when values were estimated (no API usage fields). */
  estimated?: boolean;
}

/** A single output item — text or tool call. */
export type LLMOutputItem =
  | { type: "text"; text: string }
  | { type: "function_call"; name: string; arguments: string; call_id?: string }
  | { type: "reasoning"; text: string };

export interface LLMResponse {
  /** Provider-assigned response id. */
  id: string;
  /** Convenience: concatenated text outputs. */
  output_text: string;
  /** Structured output items. */
  output: LLMOutputItem[];
  /** Model that produced the response. */
  model: string;
  /** Token usage, if available. */
  usage?: LLMUsage;
  /** Raw provider response (for debugging, not logged by default). */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a simple text-only response (useful for fakes/tests). */
export function textResponse(
  text: string,
  opts: Partial<Pick<LLMResponse, "id" | "model" | "usage">> = {},
): LLMResponse {
  return {
    id: opts.id ?? `resp_${Math.random().toString(36).slice(2, 10)}`,
    model: opts.model ?? "muse-spark-1.3",
    output_text: text,
    output: [{ type: "text", text }],
    usage: opts.usage,
  };
}

/** Normalize LLMRequest.input to LLMInputItem[] for Responses API. */
export function normalizeInput(input: LLMRequest["input"]): LLMInputItem[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }
  return input;
}
