import { describe, it, expect, beforeEach } from "vitest";
import {
  CloudflareRegistrar,
  formatPriceConfirmation,
  assertPriceConfirmation,
  enableRegistrar,
  disableRegistrar,
  isRegistrarEnabled,
  requireRegistrarEnabled,
  RegistrarError,
  type Registrar,
  type DomainSearchResult,
  type DomainPrice,
} from "../src/registrar.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchMock(
  responses: Record<string, { ok: boolean; status: number; statusText: string; body: unknown }>,
): typeof fetch {
  return async (url: string | URL | Request): Promise<Response> => {
    const key = typeof url === "string" ? url : url.toString();
    // Match by substring (domain name in URL)
    for (const [pattern, resp] of Object.entries(responses)) {
      if (key.includes(pattern)) {
        return {
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          json: async () => resp.body,
        } as unknown as Response;
      }
    }
    return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) } as unknown as Response;
  };
}

const PRICE: DomainPrice = { currency: "USD", amount: 9.99, periodYears: 1 };

// ---------------------------------------------------------------------------
// Gate — OFF by default
// ---------------------------------------------------------------------------

describe("registrar gate (OFF unless user asks)", () => {
  beforeEach(() => disableRegistrar());

  it("is disabled by default", () => {
    expect(isRegistrarEnabled()).toBe(false);
  });

  it("requireRegistrarEnabled throws when disabled", () => {
    expect(() => requireRegistrarEnabled()).toThrow(RegistrarError);
    expect(() => requireRegistrarEnabled()).toThrow(/Registrar flows are off/);
  });

  it("is enabled after enableRegistrar()", () => {
    enableRegistrar();
    expect(isRegistrarEnabled()).toBe(true);
    disableRegistrar();
  });

  it("CloudflareRegistrar.searchDomain throws when gate is off", async () => {
    const r = new CloudflareRegistrar({
      apiToken: "tok",
      accountId: "acct",
      fetchFn: makeFetchMock({}),
    });
    await expect(r.searchDomain("example.com")).rejects.toThrow(RegistrarError);
  });

  it("CloudflareRegistrar.registerDomain throws when gate is off", async () => {
    const r = new CloudflareRegistrar({
      apiToken: "tok",
      accountId: "acct",
      fetchFn: makeFetchMock({}),
    });
    await expect(r.registerDomain({ domain: "example.com", priceConfirmation: "USD 9.99" })).rejects.toThrow(
      RegistrarError,
    );
  });

  it("CloudflareRegistrar.getPrice throws when gate is off", async () => {
    const r = new CloudflareRegistrar({
      apiToken: "tok",
      accountId: "acct",
      fetchFn: makeFetchMock({}),
    });
    await expect(r.getPrice("example.com")).rejects.toThrow(RegistrarError);
  });
});

// ---------------------------------------------------------------------------
// Typed price confirmation gate
// ---------------------------------------------------------------------------

describe("typed price confirmation gate", () => {
  it("formatPriceConfirmation produces exact string", () => {
    expect(formatPriceConfirmation({ currency: "USD", amount: 9.99, periodYears: 1 })).toBe("USD 9.99");
    expect(formatPriceConfirmation({ currency: "USD", amount: 10, periodYears: 1 })).toBe("USD 10.00");
    expect(formatPriceConfirmation({ currency: "EUR", amount: 0.5, periodYears: 1 })).toBe("EUR 0.50");
  });

  it("assertPriceConfirmation passes on exact match", () => {
    expect(() => assertPriceConfirmation(PRICE, "USD 9.99")).not.toThrow();
  });

  it("assertPriceConfirmation throws on mismatch", () => {
    expect(() => assertPriceConfirmation(PRICE, "USD 9.98")).toThrow(RegistrarError);
    expect(() => assertPriceConfirmation(PRICE, "USD 9.99 ")).toThrow(RegistrarError); // trailing space
    expect(() => assertPriceConfirmation(PRICE, "usd 9.99")).toThrow(RegistrarError); // wrong case
    expect(() => assertPriceConfirmation(PRICE, "")).toThrow(RegistrarError);
    expect(() => assertPriceConfirmation(PRICE, "9.99")).toThrow(RegistrarError);
  });

  it("registerDomain refuses to buy without typed confirmation", async () => {
    enableRegistrar();
    try {
      const fetchFn = makeFetchMock({
        "example.com/check": {
          ok: true,
          status: 200,
          statusText: "OK",
          body: { available: true, price: 9.99, price_currency: "USD", period_years: 1 },
        },
        "example.com": {
          ok: true,
          status: 200,
          statusText: "OK",
          body: { status: "registered" },
        },
      });
      const r = new CloudflareRegistrar({ apiToken: "tok", accountId: "acct", fetchFn });

      // Wrong price string — must throw before any POST that charges.
      await expect(r.registerDomain({ domain: "example.com", priceConfirmation: "USD 1.00" })).rejects.toThrow(
        RegistrarError,
      );
      await expect(r.registerDomain({ domain: "example.com", priceConfirmation: "" })).rejects.toThrow(RegistrarError);

      // Correct price string — should succeed (mock returns registered).
      const result = await r.registerDomain({ domain: "example.com", priceConfirmation: "USD 9.99" });
      expect(result.status).toBe("registered");
    } finally {
      disableRegistrar();
    }
  });

  it("registerDomain with confirmation mismatch does not make the POST", async () => {
    enableRegistrar();
    try {
      let postCalled = false;
      const fetchFn: typeof fetch = async (url: string | URL | Request, init?: RequestInit) => {
        const key = typeof url === "string" ? url : url.toString();
        if (init?.method === "POST") {
          postCalled = true;
        }
        // GET check
        if (!init?.method || init.method === "GET") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({ available: true, price: 9.99, price_currency: "USD", period_years: 1 }),
          } as unknown as Response;
        }
        return { ok: true, status: 200, statusText: "OK", json: async () => ({ status: "registered" }) } as unknown as Response;
      };
      const r = new CloudflareRegistrar({ apiToken: "tok", accountId: "acct", fetchFn });

      await expect(r.registerDomain({ domain: "example.com", priceConfirmation: "WRONG" })).rejects.toThrow(
        RegistrarError,
      );
      expect(postCalled).toBe(false);
    } finally {
      disableRegistrar();
    }
  });
});

// ---------------------------------------------------------------------------
// CloudflareRegistrar — search + getPrice (with gate enabled)
// ---------------------------------------------------------------------------

describe("CloudflareRegistrar search/getPrice", () => {
  beforeEach(() => enableRegistrar());
  // Reset after
  // (each test that needs disabled state disables itself)

  it("searchDomain returns available + price when domain is free", async () => {
    const fetchFn = makeFetchMock({
      "example.com": {
        ok: true,
        status: 200,
        statusText: "OK",
        body: { available: true, price: 9.99, price_currency: "USD", period_years: 1 },
      },
    });
    const r = new CloudflareRegistrar({ apiToken: "tok", accountId: "acct", fetchFn });
    const result = await r.searchDomain("example.com");
    expect(result.available).toBe(true);
    expect(result.price).toEqual({ currency: "USD", amount: 9.99, periodYears: 1 });
  });

  it("searchDomain returns unavailable when domain is taken", async () => {
    const fetchFn = makeFetchMock({
      "taken.com": {
        ok: true,
        status: 200,
        statusText: "OK",
        body: { available: false, message: "Already registered" },
      },
    });
    const r = new CloudflareRegistrar({ apiToken: "tok", accountId: "acct", fetchFn });
    const result = await r.searchDomain("taken.com");
    expect(result.available).toBe(false);
  });

  it("getPrice returns price from search", async () => {
    const fetchFn = makeFetchMock({
      "example.com": {
        ok: true,
        status: 200,
        statusText: "OK",
        body: { available: true, price: 12.0, price_currency: "USD", period_years: 1 },
      },
    });
    const r = new CloudflareRegistrar({ apiToken: "tok", accountId: "acct", fetchFn });
    const price = await r.getPrice("example.com");
    expect(price.amount).toBe(12.0);
  });

  it("throws on invalid domain", async () => {
    const r = new CloudflareRegistrar({ apiToken: "tok", accountId: "acct", fetchFn: makeFetchMock({}) });
    await expect(r.searchDomain("not-a-domain")).rejects.toThrow(RegistrarError);
    await expect(r.searchDomain("")).rejects.toThrow(RegistrarError);
  });

  it("throws when Cloudflare API returns non-ok", async () => {
    const fetchFn = makeFetchMock({
      "example.com": { ok: false, status: 429, statusText: "Too Many Requests", body: {} },
    });
    const r = new CloudflareRegistrar({ apiToken: "tok", accountId: "acct", fetchFn });
    await expect(r.searchDomain("example.com")).rejects.toThrow(RegistrarError);
  });

  it("provider is cloudflare", () => {
    const r = new CloudflareRegistrar({ apiToken: "tok", accountId: "acct" });
    expect(r.provider).toBe("cloudflare");
  });
});
