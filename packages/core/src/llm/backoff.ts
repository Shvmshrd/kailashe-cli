/**
 * 429 backoff — honor Retry-After, exponential with jitter starting ~500ms.
 *
 * SPEC §2.2: "Honor Retry-After; exponential backoff with jitter starting ~500 ms,
 * doubling per consecutive 429."
 */

export const INITIAL_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 5;

// ---------------------------------------------------------------------------
// Retry-After parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Retry-After header value to milliseconds.
 * Handles seconds ("120") and HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT").
 * Returns undefined if unparseable.
 */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Numeric seconds
  const secs = Number(trimmed);
  if (Number.isFinite(secs) && secs >= 0) {
    return secs * 1000;
  }

  // HTTP-date
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) return delta;
    return 0;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Delay calculation
// ---------------------------------------------------------------------------

/**
 * Compute backoff delay for the Nth consecutive 429 (0-indexed).
 * Doubles each attempt: 500, 1000, 2000, 4000, ...
 * Adds jitter in [0.8x, 1.2x]. When retryAfterMs is provided and larger,
 * it takes precedence (honor Retry-After).
 *
 * @param attempt - 0 for first 429, 1 for second consecutive, etc.
 * @param retryAfterMs - parsed Retry-After in ms, if present
 * @param jitter - set false for deterministic tests
 */
export function getBackoffDelay(
  attempt: number,
  retryAfterMs?: number,
  opts: { jitter?: boolean } = {},
): number {
  const jitter = opts.jitter ?? true;
  let base = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  base = Math.min(base, MAX_BACKOFF_MS);

  if (jitter) {
    // 0.8x – 1.2x
    const factor = 0.8 + Math.random() * 0.4;
    base = Math.round(base * factor);
  }

  if (retryAfterMs !== undefined && retryAfterMs > base) {
    return retryAfterMs;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/** Whether an error looks like a 429 rate-limit. */
export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e["status"] === 429) return true;
  if (e["statusCode"] === 429) return true;
  if (e["code"] === 429) return true;
  // OpenAI SDK errors expose `status`
  if (typeof e["message"] === "string" && /429|rate.?limit/i.test(e["message"])) {
    // Only treat as 429 if status is present or message explicitly mentions 429.
    // Avoid false positives on generic "rate limit" mentions.
    if (/429/.test(e["message"])) return true;
  }
  // Check nested error
  if (e["error"] && typeof e["error"] === "object") {
    return isRateLimitError(e["error"]);
  }
  return false;
}

/** Extract Retry-After ms from error headers, if any. */
export function getRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;

  // Common shapes: err.headers, err.response.headers, err.error.headers
  const candidates: unknown[] = [
    e["headers"],
    (e["response"] as Record<string, unknown>)?.["headers"],
    (e["error"] as Record<string, unknown>)?.["headers"],
  ];

  for (const h of candidates) {
    if (!h || typeof h !== "object") continue;
    const headers = h as Record<string, unknown>;
    // Case-insensitive lookup
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === "retry-after" && typeof v === "string") {
        const parsed = parseRetryAfter(v);
        if (parsed !== undefined) return parsed;
      }
    }
    // Headers may be a Headers-like object with .get()
    if (typeof (headers as { get?: unknown }).get === "function") {
      const v = (headers as { get: (k: string) => string | null }).get("retry-after");
      if (v) {
        const parsed = parseRetryAfter(v);
        if (parsed !== undefined) return parsed;
      }
      const v2 = (headers as { get: (k: string) => string | null }).get("Retry-After");
      if (v2) {
        const parsed = parseRetryAfter(v2);
        if (parsed !== undefined) return parsed;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Sleep + retry wrapper
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  maxRetries?: number;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  /** For tests — replace the actual sleep. */
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Execute fn with 429 backoff. Retries on rate-limit errors up to maxRetries.
 * Non-429 errors are rethrown immediately.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleepFn = opts.sleepFn ?? sleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err)) throw err;
      if (attempt === maxRetries) break;

      const retryAfterMs = getRetryAfterMs(err);
      const delay = getBackoffDelay(attempt, retryAfterMs);
      if (opts.onRetry) opts.onRetry(attempt, delay, err);
      await sleepFn(delay);
    }
  }
  throw lastErr;
}
