/**
 * Registrar interface + Cloudflare stub implementation.
 *
 * SPEC Q5: Cloudflare is the only impl at launch. The Registrar API is in
 * beta — S6 must verify beta status and TLD coverage from Cloudflare's
 * official docs before building on it (URL+date in slice report).
 *
 * Runtime rule: registrar flows are OFF unless the user explicitly asks
 * (e.g. `kailashe domain add --register`). Recording a provider URL
 * (`kailashe domain add <name> --provider-url <url>`) does not touch the
 * registrar at all.
 *
 * All purchases require an explicit typed price confirmation (see
 * assertPriceConfirmation).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DomainSearchResult {
  domain: string;
  available: boolean;
  price?: DomainPrice;
  message?: string;
}

export interface DomainPrice {
  /** ISO 4217 currency code, e.g. "USD" */
  currency: string;
  /** Total price for the registration period (major units, e.g. 9.99) */
  amount: number;
  /** Registration period in years */
  periodYears: number;
}

export interface RegisterDomainOptions {
  domain: string;
  /** Period in years (1–10, provider-dependent) */
  periodYears?: number;
  /** Auto-renew flag forwarded to the registrar */
  autoRenew?: boolean;
  /**
   * Typed confirmation string supplied by the user.
   * Must exactly equal the expected price string (see assertPriceConfirmation).
   * The CLI is responsible for collecting this from the user; this layer
   * enforces it and never bypasses it.
   */
  priceConfirmation: string;
}

export interface RegisterDomainResult {
  domain: string;
  price: DomainPrice;
  status: "registered" | "pending";
}

// ---------------------------------------------------------------------------
// Helpers — price confirmation gate
// ---------------------------------------------------------------------------

/**
 * Format a DomainPrice as the exact string the user must type to confirm.
 * Example: { currency:"USD", amount:9.99, periodYears:1 } → "USD 9.99"
 *
 * The confirmation string is the currency + amount with two decimals.
 * This is what the CLI prompts the user to type verbatim.
 */
export function formatPriceConfirmation(price: DomainPrice): string {
  return `${price.currency} ${price.amount.toFixed(2)}`;
}

/**
 * Assert that `typed` exactly equals the expected confirmation for `price`.
 * Throws RegistrarError if it does not match — the caller must surface this
 * to the user and must NOT retry with a corrected value on the user's behalf.
 */
export function assertPriceConfirmation(price: DomainPrice, typed: string): void {
  const expected = formatPriceConfirmation(price);
  if (typed !== expected) {
    throw new RegistrarError(
      `Price confirmation mismatch: expected "${expected}", got "${typed}". ` +
        `Type the exact price to confirm the purchase.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Registrar interface
// ---------------------------------------------------------------------------

export interface Registrar {
  /** Human-readable provider name, e.g. "cloudflare" */
  readonly provider: string;

  /**
   * Check if a domain is available for registration.
   * Returns availability + price when available.
   */
  searchDomain(domain: string): Promise<DomainSearchResult>;

  /** Fetch the current registration price for a domain (without availability). */
  getPrice(domain: string): Promise<DomainPrice>;

  /**
   * Register a domain. Requires a typed price confirmation (see
   * assertPriceConfirmation). Throws if the confirmation is missing or wrong.
   *
   * Implementations must call assertPriceConfirmation before making any
   * network request that would create a charge.
   */
  registerDomain(opts: RegisterDomainOptions): Promise<RegisterDomainResult>;
}

// ---------------------------------------------------------------------------
// Gate — OFF unless explicitly enabled
// ---------------------------------------------------------------------------

let registrarEnabled = false;

/** Enable registrar flows (called only when the user explicitly asks). */
export function enableRegistrar(): void {
  registrarEnabled = true;
}

/** Disable registrar flows (default). */
export function disableRegistrar(): void {
  registrarEnabled = false;
}

/** Whether registrar flows are currently enabled. */
export function isRegistrarEnabled(): boolean {
  return registrarEnabled;
}

/**
 * Throw if the registrar is not enabled. Call at the top of any registrar
 * code path that could result in a charge.
 */
export function requireRegistrarEnabled(): void {
  if (!registrarEnabled) {
    throw new RegistrarError(
      "Registrar flows are off. The user must explicitly request domain registration " +
        "(e.g. `kailashe domain add --register`).",
    );
  }
}

// ---------------------------------------------------------------------------
// Cloudflare stub implementation
// ---------------------------------------------------------------------------

/**
 * Cloudflare Registrar implementation (stub).
 *
 * BETA STATUS CHECK REQUIRED (S6 task — record in slice report):
 *   URL:  https://developers.cloudflare.com/registrar/
 *   Date: 2026-10-29 (re-verify before shipping; the API is in beta — see
 *         https://developers.cloudflare.com/api/resources/domains/ and
 *         https://developers.cloudflare.com/registrar/get-started/ )
 *   What to verify:
 *     - Whether the Registrar API is still in beta and what the beta terms
 *       say about programmatic registration (rate limits, allowed TLDs).
 *     - TLD coverage — Cloudflare Registrar does not support all TLDs;
 *       list the supported TLDs or link to the coverage page and note any
 *       gaps relevant to Kailashe users.
 *   Action if beta terms block the flow: stop and ask the lead before
 *   building on the API.
 *
 * Actual API docs (to verify):
 *   - https://developers.cloudflare.com/api/resources/registrar/
 *   - https://developers.cloudflare.com/registrar/
 *   Verify the exact endpoint paths, auth (API token with Zone:Read,
 *   Account access), and request/response shapes; update this stub when
 *   the S6 verification is done.
 *
 * This stub implements the Registrar interface but delegates HTTP to an
 * injected fetch function so it can be tested without network access.
 */

export interface CloudflareRegistrarOptions {
  /** Cloudflare API token (Zone:Read + account registrar scope) */
  apiToken: string;
  /** Account ID that owns the registration */
  accountId: string;
  /** Override fetch for testing */
  fetchFn?: typeof fetch;
  /** Override API base URL (default: https://api.cloudflare.com/client/v4) */
  apiBaseUrl?: string;
}

export class CloudflareRegistrar implements Registrar {
  readonly provider = "cloudflare";

  private readonly apiToken: string;
  private readonly accountId: string;
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;

  constructor(opts: CloudflareRegistrarOptions) {
    if (!opts.apiToken) throw new RegistrarError("CloudflareRegistrar: apiToken is required");
    if (!opts.accountId) throw new RegistrarError("CloudflareRegistrar: accountId is required");
    this.apiToken = opts.apiToken;
    this.accountId = opts.accountId;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.apiBaseUrl = opts.apiBaseUrl ?? "https://api.cloudflare.com/client/v4";
  }

  async searchDomain(domain: string): Promise<DomainSearchResult> {
    requireRegistrarEnabled();
    validateDomain(domain);

    // Cloudflare Registrar search — endpoint to verify in S6 docs check:
    //   GET /accounts/{account_id}/registrar/domains/{domain}/check
    // Response shape is illustrative; update after docs verification.
    const url = `${this.apiBaseUrl}/accounts/${this.accountId}/registrar/domains/${encodeURIComponent(domain)}/check`;

    const res = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" },
    });

    if (!res.ok) {
      throw new RegistrarError(`Cloudflare domain check failed for ${domain}: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as CloudflareCheckResponse;

    if (!body.available) {
      return { domain, available: false, message: body.message };
    }

    const price: DomainPrice = {
      currency: body.price_currency ?? "USD",
      amount: body.price ?? 0,
      periodYears: body.period_years ?? 1,
    };

    return { domain, available: true, price };
  }

  async getPrice(domain: string): Promise<DomainPrice> {
    requireRegistrarEnabled();
    validateDomain(domain);

    // Reuse searchDomain for pricing — Cloudflare returns price alongside availability.
    // A dedicated price endpoint may exist; verify in S6 docs check.
    const result = await this.searchDomain(domain);
    if (!result.price) {
      throw new RegistrarError(`No price available for ${domain}`);
    }
    return result.price;
  }

  async registerDomain(opts: RegisterDomainOptions): Promise<RegisterDomainResult> {
    requireRegistrarEnabled();
    validateDomain(opts.domain);

    // 1. Fetch current price and enforce typed confirmation BEFORE any charge.
    const price = await this.getPrice(opts.domain);
    assertPriceConfirmation(price, opts.priceConfirmation);

    // 2. Create registration — endpoint to verify in S6 docs check:
    //   POST /accounts/{account_id}/registrar/domains/{domain}
    const url = `${this.apiBaseUrl}/accounts/${this.accountId}/registrar/domains/${encodeURIComponent(opts.domain)}`;

    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: opts.domain,
        period_years: opts.periodYears ?? 1,
        auto_renew: opts.autoRenew ?? true,
      }),
    });

    if (!res.ok) {
      throw new RegistrarError(`Cloudflare domain registration failed for ${opts.domain}: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as CloudflareRegisterResponse;

    return {
      domain: opts.domain,
      price,
      status: body.status === "pending" ? "pending" : "registered",
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validateDomain(domain: string): void {
  if (!domain || typeof domain !== "string" || !domain.includes(".")) {
    throw new RegistrarError(`Invalid domain: ${JSON.stringify(domain)}`);
  }
}

// Minimal response shapes — update after S6 docs verification.
interface CloudflareCheckResponse {
  available: boolean;
  price?: number;
  price_currency?: string;
  period_years?: number;
  message?: string;
}

interface CloudflareRegisterResponse {
  status?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RegistrarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrarError";
  }
}
