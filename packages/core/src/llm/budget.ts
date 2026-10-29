/**
 * Model budget tracking — per command run.
 *
 * SPEC §2.2 (Q8): KAILASHE_MODEL_BUDGET_USD, default $3/run, warn 80%, stop 100% → exit 7.
 * Usage accrues from API usage fields; when the endpoint reports no usage,
 * estimate from token counts and label it an estimate.
 */

// The canonical BudgetExceededError lives in exit-codes.ts (exit 7, SPEC §2.5).
// Re-exported here so existing llm/budget imports keep working with one class identity.
export { BudgetExceededError } from "../exit-codes.js";
import { BudgetExceededError } from "../exit-codes.js";

export const DEFAULT_MODEL_BUDGET_USD = 3;
export const BUDGET_WARN_RATIO = 0.8;
export const BUDGET_STOP_RATIO = 1.0;

/** Exit code for budget exceeded (SPEC §2.5). */
export const EXIT_BUDGET_EXCEEDED = 7;

// ---------------------------------------------------------------------------
// Pricing — used when we must estimate cost from token counts.
// These are placeholder rates; real Meta pricing is read from the API
// cost fields when available. Consumers may inject custom rates.
// ---------------------------------------------------------------------------

/** Cost per 1M tokens (USD) — placeholder matching typical Muse Spark pricing. */
export const DEFAULT_INPUT_COST_PER_M = 0.5;
export const DEFAULT_OUTPUT_COST_PER_M = 0.5;

export interface BudgetRates {
  inputPerM: number;
  outputPerM: number;
}

export const DEFAULT_RATES: BudgetRates = {
  inputPerM: DEFAULT_INPUT_COST_PER_M,
  outputPerM: DEFAULT_OUTPUT_COST_PER_M,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve budget cap from env (or return default). */
export function resolveBudgetCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env["KAILASHE_MODEL_BUDGET_USD"];
  if (raw === undefined || raw === "") return DEFAULT_MODEL_BUDGET_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MODEL_BUDGET_USD;
  return n;
}

/** Estimate tokens from text length (~4 chars per token). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Estimate cost (USD) from token counts using the given rates. */
export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  rates: BudgetRates = DEFAULT_RATES,
): number {
  return (inputTokens / 1_000_000) * rates.inputPerM + (outputTokens / 1_000_000) * rates.outputPerM;
}

// ---------------------------------------------------------------------------
// Budget class
// ---------------------------------------------------------------------------

export interface BudgetOptions {
  capUsd?: number;
  rates?: BudgetRates;
  /** Called when spend crosses warn threshold (80%). */
  onWarn?: (spent: number, cap: number) => void;
  /** Called when spend hits stop threshold (100%) — before throwing. */
  onExceed?: (spent: number, cap: number) => void;
}

export class ModelBudget {
  readonly cap: number;
  readonly rates: BudgetRates;
  private spent = 0;
  private warned = false;
  private readonly onWarn?: (spent: number, cap: number) => void;
  private readonly onExceed?: (spent: number, cap: number) => void;

  constructor(opts: BudgetOptions = {}) {
    this.cap = opts.capUsd ?? resolveBudgetCap();
    this.rates = opts.rates ?? DEFAULT_RATES;
    this.onWarn = opts.onWarn;
    this.onExceed = opts.onExceed;
  }

  get totalSpent(): number {
    return this.spent;
  }

  get remaining(): number {
    return Math.max(0, this.cap - this.spent);
  }

  get hasWarned(): boolean {
    return this.warned;
  }

  get isExceeded(): boolean {
    return this.spent >= this.cap;
  }

  /** Fraction spent (0–∞). */
  get ratio(): number {
    if (this.cap === 0) return this.spent > 0 ? Infinity : 0;
    return this.spent / this.cap;
  }

  /**
   * Record spend and enforce warn/stop.
   * @param costUsd - cost in USD for this call
   * @throws BudgetExceededError if cap reached (exit 7)
   */
  addCost(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd < 0) return;
    this.spent += costUsd;

    if (!this.warned && this.spent >= this.cap * BUDGET_WARN_RATIO) {
      this.warned = true;
      if (this.onWarn) this.onWarn(this.spent, this.cap);
      else console.warn(`[kailashe] Model budget warning: $${this.spent.toFixed(4)} / $${this.cap.toFixed(2)} (80% of $${this.cap.toFixed(2)} cap)`);
    }

    if (this.spent >= this.cap * BUDGET_STOP_RATIO) {
      if (this.onExceed) this.onExceed(this.spent, this.cap);
      throw new BudgetExceededError(this.spent, this.cap);
    }
  }

  /**
   * Record usage from API fields, or estimate if missing.
   * Returns the cost that was added.
   */
  addUsage(usage: { input_tokens?: number; output_tokens?: number } | undefined, fallbackText?: string): number {
    let cost: number;
    if (usage && typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number") {
      cost = estimateCostUsd(usage.input_tokens, usage.output_tokens, this.rates);
    } else if (fallbackText) {
      const tokens = estimateTokens(fallbackText);
      // Split roughly 50/50 between input/output when we have no breakdown.
      cost = estimateCostUsd(Math.ceil(tokens / 2), Math.ceil(tokens / 2), this.rates);
    } else {
      return 0;
    }
    this.addCost(cost);
    return cost;
  }

  /** Reset for testing. */
  reset(): void {
    this.spent = 0;
    this.warned = false;
  }
}
