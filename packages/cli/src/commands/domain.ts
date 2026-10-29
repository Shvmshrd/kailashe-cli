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
import * as path from "node:path";
import { confirm as clackConfirm, text as clackText, isCancel } from "@clack/prompts";
import {
  CloudflareDnsProvider,
  FileTenantRegistry,
  TenantError,
  VercelDnsProvider,
  customDomainSettings,
  provisionSubdomain,
  releaseSubdomain,
  resolvePlatformDomain,
  validateSubdomainLabel,
  type CustomDomainSettings,
  type DnsProvider,
  type ProvisionSubdomainResult,
  type TenantRegistry,
} from "@kailashe/deploy";
import { ExitCode } from "../exit-codes.js";
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
// Tenant subdomains (platform domain, e.g. zi1.kailashe.tech) + custom domains
// ---------------------------------------------------------------------------

export interface TenancyDeps {
  registry?: TenantRegistry;
  dns?: DnsProvider;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

/** Registry persisted under <cwd>/.kailashe/tenants.json (claims survive runs). */
export function defaultTenantRegistry(cwd: string): TenantRegistry {
  return new FileTenantRegistry(path.join(cwd, ".kailashe", "tenants.json"));
}

/**
 * Real DNS only when the operator has configured tenant DNS for the
 * platform zone. Cloudflare wins when both are set:
 *   - CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID  -> proxied CNAME + Universal SSL
 *   - VERCEL_API_TOKEN (+ optional VERCEL_TEAM_ID) -> Vercel DNS + automatic TLS
 * Tokens are passed to the provider constructors and never logged.
 * Otherwise null, so the CLI asks for configuration instead of pretending
 * a record exists.
 */
export function dnsProviderFromEnv(env: Record<string, string | undefined>, platformDomain: string): DnsProvider | null {
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  const zoneId = env["CLOUDFLARE_ZONE_ID"];
  if (apiToken && zoneId) return new CloudflareDnsProvider({ apiToken, zoneId, platformDomain });
  const vercelToken = env["VERCEL_API_TOKEN"];
  if (vercelToken) {
    return new VercelDnsProvider({ apiToken: vercelToken, platformDomain, teamId: env["VERCEL_TEAM_ID"] });
  }
  return null;
}

const TENANT_DNS_NOT_CONFIGURED =
  "Tenant DNS is not configured: set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID (Cloudflare) " +
  "or VERCEL_API_TOKEN (Vercel DNS) in the environment";

export function formatCustomDomainSettings(settings: CustomDomainSettings): string[] {
  const lines = [`Connect ${settings.domain} to your deployed app:`, ""];
  for (const r of settings.records) {
    lines.push(`  ${r.type}  ${r.name}  ->  ${r.value}  (proxied: ${r.proxied}, TTL: ${r.ttl})`);
  }
  lines.push("");
  settings.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("", settings.httpsNote);
  return lines;
}

export function formatProvisionResult(result: ProvisionSubdomainResult): string[] {
  return [
    `Subdomain ready: ${result.url}`,
    `  ${result.fqdn}  ->  ${result.targetHost} (DNS record ${result.recordId})`,
    `  HTTPS: ${result.https.enabled ? "on" : "off"} (${result.https.mode}) — ${result.https.note}`,
  ];
}

export type DomainSetupResult =
  | { kind: "custom"; settings: CustomDomainSettings; exitCode: number }
  | { kind: "platform"; result: ProvisionSubdomainResult; exitCode: number }
  | { kind: "provider-domain"; providerId: string; url: string; exitCode: number }
  | { kind: "needs-input"; message: string; exitCode: number }
  | { kind: "error"; message: string; exitCode: number };

export function formatProviderDomain(result: { providerId: string; url: string }): string[] {
  return [
    `Deployed on Vercel: using your Vercel domain ${result.url}`,
    "No kailashe.tech subdomain is needed for Vercel deploys. To attach your own domain later: Vercel -> Project -> Settings -> Domains.",
  ];
}

/**
 * The `domain setup` decision + action, injectable for tests.
 * hasOwnDomain=true -> custom-domain settings (no DNS writes by Kailashe).
 * Otherwise a label is claimed: unique globally, one active label per user.
 */
export async function executeDomainSetup(
  deps: TenancyDeps,
  input: { userId?: string; targetHost?: string; ownDomain?: string; label?: string; platformDomain?: string; providerId?: string; deployedUrl?: string },
): Promise<DomainSetupResult> {
  const env = deps.env ?? process.env;
  // Vercel deploys use the Vercel domain itself: the whole domain step
  // (own domain? / kailashe.tech label) is skipped — hosting-flow rule.
  if (input.providerId === "vercel") {
    const deployed = input.deployedUrl ?? input.targetHost;
    if (!deployed) {
      return {
        kind: "needs-input",
        message: "Deployed on Vercel: pass --target <your-app>.vercel.app (the Vercel domain) and Kailashe uses it as-is.",
        exitCode: ExitCode.NeedsInputOrDenied,
      };
    }
    const host = deployed.trim().replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
    if (!host) {
      return { kind: "error", message: `Could not parse a host from ${JSON.stringify(deployed)}.`, exitCode: ExitCode.Validation };
    }
    return { kind: "provider-domain", providerId: "vercel", url: `https://${host}`, exitCode: ExitCode.Ok };
  }
  if (!input.targetHost) return { kind: "needs-input", message: "Pass --target <host> (the host your app was deployed to, e.g. my-app.vercel.app).", exitCode: ExitCode.NeedsInputOrDenied };
  if (input.ownDomain) {
    try {
      const settings = customDomainSettings({ domain: input.ownDomain, targetHost: input.targetHost, platformDomain: input.platformDomain });
      return { kind: "custom", settings, exitCode: ExitCode.Ok };
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err), exitCode: ExitCode.Validation };
    }
  }
  if (!input.label) return { kind: "needs-input", message: "No domain of your own? Pick a subdomain: pass --label <name> (e.g. --label zi1).", exitCode: ExitCode.NeedsInputOrDenied };
  if (!input.userId) return { kind: "needs-input", message: "Pass --user <id> so the subdomain is bound to exactly one user.", exitCode: ExitCode.NeedsInputOrDenied };
  const platformDomain = input.platformDomain ?? resolvePlatformDomain(env);
  const registry = deps.registry ?? defaultTenantRegistry(deps.cwd ?? process.cwd());
  const dns = deps.dns ?? dnsProviderFromEnv(env, platformDomain);
  if (!dns) {
    return {
      kind: "needs-input",
      message:
        `${TENANT_DNS_NOT_CONFIGURED} ` +
        `(for the ${platformDomain} zone), then re-run. No claim was made.`,
      exitCode: ExitCode.NeedsInputOrDenied,
    };
  }
  try {
    const result = await provisionSubdomain({ userId: input.userId, label: input.label, targetHost: input.targetHost, registry, dns, platformDomain });
    return { kind: "platform", result, exitCode: ExitCode.Ok };
  } catch (err) {
    const code = err instanceof TenantError ? ExitCode.Validation : ExitCode.Unexpected;
    return { kind: "error", message: err instanceof Error ? err.message : String(err), exitCode: code };
  }
}

// ---------------------------------------------------------------------------
// Commander wiring
// ---------------------------------------------------------------------------

/** Build the `domain` subcommand tree (call from src/index.ts). */
export function createDomainCommand(opts?: {
  /** Inject a Registrar factory for --register (tests / wiring). */
  makeRegistrar?: () => Registrar;
  tenancy?: TenancyDeps;
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

  domainCmd
    .command("setup")
    .description("connect a domain to your deployed app: your own domain (settings) or a free <label>.kailashe.tech subdomain")
    .option("--target <host>", "host your app was deployed to, e.g. my-app.vercel.app")
    .option("--provider <id>", "provider you deployed to (vercel = use the Vercel domain, skip the domain step)")
    .option("--user <id>", "user id the subdomain is bound to (one active subdomain per user)")
    .option("--own-domain <domain>", "you have your own domain: print the DNS settings to connect it")
    .option("--label <label>", "subdomain label on the platform domain, e.g. zi1 -> zi1.kailashe.tech")
    .option("--platform-domain <domain>", "platform domain (default: $KAILASHE_PLATFORM_DOMAIN or kailashe.tech)")
    .option("--json", "emit a single JSON result object")
    .action(async (flags: { target?: string; provider?: string; user?: string; ownDomain?: string; label?: string; platformDomain?: string; json?: boolean }) => {
      let { ownDomain, label } = flags;
      // Interactive ask-flow only on a real terminal, and only when the
      // caller did not already answer with flags. Vercel deploys skip the
      // domain question entirely (they use the Vercel domain).
      if (!ownDomain && !label && flags.provider !== "vercel" && process.stdin.isTTY) {
        const hasOwn = await clackConfirm({ message: "Do you have a domain?" });
        if (isCancel(hasOwn)) { process.exitCode = ExitCode.NeedsInputOrDenied; return; }
        if (hasOwn) {
          const d = await clackText({ message: "Your domain (e.g. example.com):" });
          if (isCancel(d)) { process.exitCode = ExitCode.NeedsInputOrDenied; return; }
          ownDomain = String(d);
        } else {
          const l = await clackText({ message: "Pick a subdomain label (e.g. zi1):" });
          if (isCancel(l)) { process.exitCode = ExitCode.NeedsInputOrDenied; return; }
          label = String(l);
        }
      }
      const outcome = await executeDomainSetup(opts?.tenancy ?? {}, {
        userId: flags.user, targetHost: flags.target, ownDomain, label, platformDomain: flags.platformDomain, providerId: flags.provider,
      });
      process.exitCode = outcome.exitCode;
      if (flags.json) {
        console.log(JSON.stringify(outcome.kind === "platform" ? { kind: outcome.kind, ...outcome.result } : outcome));
        return;
      }
      if (outcome.kind === "custom") for (const line of formatCustomDomainSettings(outcome.settings)) console.log(line);
      else if (outcome.kind === "platform") for (const line of formatProvisionResult(outcome.result)) console.log(line);
      else if (outcome.kind === "provider-domain") for (const line of formatProviderDomain(outcome)) console.log(line);
      else console.error(outcome.message);
    });

  domainCmd
    .command("check")
    .description("check whether a subdomain label is still available")
    .argument("<label>", "subdomain label, e.g. zi1")
    .option("--platform-domain <domain>", "platform domain (default: $KAILASHE_PLATFORM_DOMAIN or kailashe.tech)")
    .option("--json", "emit a single JSON result object")
    .action((label: string, flags: { platformDomain?: string; json?: boolean }) => {
      const checked = validateSubdomainLabel(label);
      if (!checked.ok) {
        console.error(`Invalid label: ${checked.reason}`);
        process.exitCode = ExitCode.Validation;
        return;
      }
      const platformDomain = flags.platformDomain ?? resolvePlatformDomain();
      const registry = opts?.tenancy?.registry ?? defaultTenantRegistry(opts?.tenancy?.cwd ?? process.cwd());
      const existing = registry.getByLabel(checked.label);
      const available = !existing;
      const fqdn = `${checked.label}.${platformDomain}`;
      if (flags.json) console.log(JSON.stringify({ label: checked.label, fqdn, available, status: existing?.status ?? null }));
      else console.log(available ? `${fqdn} is available` : `${fqdn} is taken (${existing!.status}, owner ${existing!.userId}) — each subdomain can be used only once`);
      process.exitCode = ExitCode.Ok;
    });

  domainCmd
    .command("custom")
    .description("show the DNS settings to connect your own domain to your deployed app")
    .argument("<domain>", "your domain, e.g. example.com")
    .requiredOption("--target <host>", "host your app was deployed to, e.g. my-app.vercel.app")
    .option("--json", "emit a single JSON result object")
    .action((domain: string, flags: { target: string; json?: boolean }) => {
      try {
        const settings = customDomainSettings({ domain, targetHost: flags.target });
        if (flags.json) console.log(JSON.stringify(settings));
        else for (const line of formatCustomDomainSettings(settings)) console.log(line);
        process.exitCode = ExitCode.Ok;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = ExitCode.Validation;
      }
    });

  domainCmd
    .command("release")
    .description("release your subdomain (the label stays reserved for you and cannot be taken by anyone else)")
    .argument("<label>", "subdomain label, e.g. zi1")
    .requiredOption("--user <id>", "user id that owns the subdomain")
    .option("--platform-domain <domain>", "platform domain (default: $KAILASHE_PLATFORM_DOMAIN or kailashe.tech)")
    .action(async (label: string, flags: { user: string; platformDomain?: string }) => {
      const platformDomain = flags.platformDomain ?? resolvePlatformDomain();
      const registry = opts?.tenancy?.registry ?? defaultTenantRegistry(opts?.tenancy?.cwd ?? process.cwd());
      const dns = opts?.tenancy?.dns ?? dnsProviderFromEnv(opts?.tenancy?.env ?? process.env, platformDomain);
      if (!dns) {
        console.error(`${TENANT_DNS_NOT_CONFIGURED}, then re-run.`);
        process.exitCode = ExitCode.NeedsInputOrDenied;
        return;
      }
      try {
        const r = await releaseSubdomain({ userId: flags.user, label, registry, dns });
        console.log(`Released ${r.fqdn}. The label remains reserved for ${flags.user}.`);
        process.exitCode = ExitCode.Ok;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = ExitCode.Validation;
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
