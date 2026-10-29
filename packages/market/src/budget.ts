/**
 * Market budget guard — SPEC F3.4 / §8 reliability.
 *
 * KAILASHE_MARKET_BUDGET_USD unset ⇒ no paid calls.
 * When set, estimate before calls, hard stop at cap (exit 7).
 */

export const MARKET_BUDGET_ENV = "KAILASHE_MARKET_BUDGET_USD";
export const EXIT_BUDGET_EXCEEDED = 7;

export const BUDGET_ENABLING_LINE =
  "Set KAILASHE_MARKET_BUDGET_USD=<amount> in .env to enable paid market research; free sources were used where possible.";

export class MarketBudgetExceededError extends Error {
  readonly exitCode = EXIT_BUDGET_EXCEEDED;
  readonly spent: number;
  readonly cap: number;
  constructor(spent: number, cap: number) {
    super(`Market budget exceeded: $${spent.toFixed(4)} / $${cap.toFixed(2)} (exit 7)`);
    this.name = "MarketBudgetExceededError";
    this.spent = spent;
    this.cap = cap;
  }
}

export function isBudgetUnset(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): boolean {
  const raw = env[MARKET_BUDGET_ENV];
  if (raw === undefined || raw === "") return true;
  // An invalid value (non-numeric, negative, non-finite) cannot authorise
  // paid calls: treat it as unset so the caller emits unknowns[] plus the
  // enabling line instead of crashing or spending without a cap.
  return resolveBudgetCap(env) === null;
}

export function resolveBudgetCap(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): number | null {
  const raw = env[MARKET_BUDGET_ENV];
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export class MarketBudget {
  readonly cap: number | null;
  private spent = 0;

  constructor(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>) {
    this.cap = resolveBudgetCap(env);
  }

  get totalSpent(): number {
    return this.spent;
  }

  get isUnset(): boolean {
    return this.cap === null;
  }

  get remaining(): number {
    if (this.cap === null) return 0;
    return Math.max(0, this.cap - this.spent);
  }

  /**
   * Check whether a projected cost would exceed the cap.
   * @throws MarketBudgetExceededError if cap would be exceeded (exit 7)
   */
  checkEstimate(estimatedCost: number): void {
    if (this.cap === null) return; // unset handled separately at orchestrator level
    if (this.spent + estimatedCost > this.cap) {
      throw new MarketBudgetExceededError(this.spent + estimatedCost, this.cap);
    }
  }

  /**
   * Record spend after a call. Throws if cap exceeded.
   */
  addCost(cost: number): void {
    if (!Number.isFinite(cost) || cost < 0) return;
    this.spent += cost;
    if (this.cap !== null && this.spent > this.cap) {
      throw new MarketBudgetExceededError(this.spent, this.cap);
    }
  }

  /**
   * Alias for checkEstimate that matches ModelBudget naming.
   */
  assertCanSpend(cost: number): void {
    this.checkEstimate(cost);
  }
}
