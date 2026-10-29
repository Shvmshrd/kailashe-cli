/**
 * `kailashe domain add` â€” record a provider URL or search+register via Registrar.
 *
 * SPEC Q5 / S6:
 *   - `kailashe domain add <domain> --provider-url <url>` records the provider URL (no registrar).
 *   - `kailashe domain add <domain> --register` searches the registrar and, if
 *     available, registers after an explicit typed price confirmation.
 *   - Registrar flows are OFF unless the user passes --register.
 *   - Refuses to buy without the typed confirmation (exact match).
 */

import { Command } from "commander";
import {
  enableRegistrar,
  formatPriceConfirmation,
  assertPriceConfirmation,
  isRegistrarEnabled,
  type Registrar,
} from "../registrar.js";

// ---------------------------------------------------------------------------
// Pure helpers (testable without commander / I/O)
// ---------------------------------------------------------------------------

/** What `kailashe domain add` should do, derived from parsed flags. */
export type DomainAddAction =
  | { kind: "record-url"; domain: string; providerUrl: string }
  | { kind: "register"; domain: string; priceConfirmation?: string }
  | { kind: "error"; message: string };

/**
 * Decide the action for `domain add` from parsed inputs.
 * No I/O â€” pure function for tests and CLI wiring.
 */
export function resolveDomainAddAction(opts: {
  domain?: string;
  providerUrl?: string;
  register?: boolean;
  priceConfirmation?: string;
}): DomainAddAction {
  if (!opts.domain) {
    return { kind: "error", message: "domain is required: kailashe domain add <domain>" };
  }

  if (opts.register) {
    return { kind: "register", domain: opts.domain, priceConfirmation: opts.priceConfirmation };
  }

  if (opts.providerUrl) {
    return { kind: "record-url", domain: opts.domain, providerUrl: opts.providerUrl };
  }

  // No flags: ambiguous â€” guide the user.
  return {
    kind: "error",
    message:
      "Specify --provider-url <url> to record a provider URL, or --register to search and register via the registrar.",
  };
}

/**
 * Execute a register flow against a Registrar instance.
 * Enforces the typed price confirmation gate â€” throws if missing or wrong.
 *
 * Steps:
 *  1. Enable the registrar (OFF by default).
 *  2. searchDomain â†’ check availability.
 *  3. If available, require priceConfirmation and verify it before registerDomain.
 */
export async function executeDomainRegister(
  registrar: Registrar,
  domain: string,
  priceConfirmation: string | undefined,
): Promise<{ domain: string; price: string; status: string }> {
  // OFF unless user asked â€” this function is only called from --register.
  enableRegistrar();

  const search = await registrar.searchDomain(domain);
  if (!search.available) {
    throw new DomainError(`Domain ${domain} is not available${search.message ? `: ${search.message}` : ""}`);
  }

  if (!search.price) {
    throw new DomainError(`No price returned for ${domain}. Cannot proceed with registration.`);
  }

  if (!priceConfirmation) {
    const expected = formatPriceConfirmation(search.price);
    throw new DomainError(
      `Typed price confirmation required. The price for ${domain} is ${expected}. ` +
        `Re-run with --price-confirmation "${expected}" to confirm the purchase.`,
    );
  }

  // Gate: exact match, enforced inside the registrar as well.
  assertPriceConfirmation(search.price, priceConfirmation);

  const result = await registrar.registerDomain({
    domain,
    priceConfirmation,
  });

  return {
    domain: result.domain,
    price: formatPriceConfirmation(result.price),
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// Commander wiring
// ---------------------------------------------------------------------------

/** Build the `domain` subcommand tree (call from src/index.ts). */
export function createDomainCommand(opts?: {
  /** Inject a Registrar factory for --register (tests / wiring). */
  makeRegistrar?: () => Registrar;
}): Command {
  const domainCmd = new Command("domain").description("manage domains");

  domainCmd
    .command("add")
    .description("record a provider URL or register a domain via the registrar")
    .argument("<domain>", "domain name, e.g. example.com")
    .option("--provider-url <url>", "record the provider deployment URL for this domain")
    .option("--register", "search and register via the registrar (requires price confirmation)")
    .option(
      "--price-confirmation <price>",
      'typed price confirmation, e.g. "USD 9.99" (required with --register when available)',
    )
    .action(async (domain: string, cmdOpts: { providerUrl?: string; register?: boolean; priceConfirmation?: string }) => {
      const action = resolveDomainAddAction({
        domain,
        providerUrl: cmdOpts.providerUrl,
        register: cmdOpts.register,
        priceConfirmation: cmdOpts.priceConfirmation,
      });

      if (action.kind === "error") {
        console.error(action.message);
        process.exitCode = 2;
        return;
      }

      if (action.kind === "record-url") {
        // Record provider URL â€” no registrar involvement.
        console.log(`Recorded domain ${action.domain} -> ${action.providerUrl}`);
        console.log(`(Persist to .kailashe/deploy-state.json in a later step.)`);
        return;
      }

      // action.kind === "register"
      // Guard: ensure we are in an explicitly requested registrar flow.
      if (!cmdOpts.register) {
        console.error("Registrar flows are off unless --register is passed.");
        process.exitCode = 2;
        return;
      }

      if (!opts?.makeRegistrar) {
        console.error("No registrar configured. Provide a Registrar via makeRegistrar.");
        process.exitCode = 1;
        return;
      }

      const registrar = opts.makeRegistrar();

      if (!isRegistrarEnabled()) {
        // enableRegistrar() will be called inside executeDomainRegister,
        // but we log for visibility.
      }

      try {
        const result = await executeDomainRegister(registrar, action.domain, action.priceConfirmation);
        console.log(`Registered ${result.domain} for ${result.price} â€” status: ${result.status}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(msg);
        // Distinguish price-confirmation failures (exit 2 / usage) from other errors.
        if (msg.includes("Price confirmation") || msg.includes("confirmation required")) {
          process.exitCode = 3;
        } else {
          process.exitCode = 1;
        }
      }
    });

  return domainCmd;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
