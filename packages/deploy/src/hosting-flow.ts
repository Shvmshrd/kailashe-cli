/**
 * Hosting-flow decisions — the order of questions after Kailashe has read
 * the project (detector profile + project graph):
 *
 *   1. Can this project deploy on Vercel? If yes, OFFER Vercel first.
 *      The user still chooses (SPEC Q3: always ask) — declining is normal.
 *   2. Deployed on Vercel -> use the Vercel domain itself. The kailashe.tech
 *      subdomain step is skipped entirely; there is nothing to connect.
 *   3. Deployed anywhere else (Cloudflare Workers, Modal, Fly, ...) ->
 *      only then does the domain step appear: own domain (show the DNS
 *      settings) or a unique label on the platform domain (kailashe.tech),
 *      provisioned via tenancy.ts.
 *
 * Pure functions, no I/O. The profile adapter mirrors choice.ts so both
 * layers read the same signals the same way.
 */

import type { Profile } from "@kailashe/core/schemas/profile.js";
import { resolveDomainOnboarding, type CustomDomainSettings } from "./tenancy.js";

// ---------------------------------------------------------------------------
// Vercel fit
// ---------------------------------------------------------------------------

export interface VercelFitInput {
  appType: string;
  artifactKind: string;
  rendering: string;
  needsGpu?: boolean;
  hasDatabase?: boolean;
}

export interface VercelFit {
  eligible: boolean;
  /** Why Vercel fits (shown next to the offer). */
  reasons: string[];
  /** Why Vercel does not fit (shown when another provider is suggested). */
  blockers: string[];
  /** Non-blocking notes (e.g. database stays external). */
  notes: string[];
}

const VERCEL_NATIVE_APP_TYPES = new Set(["nextjs", "remix", "nuxt", "sveltekit", "astro", "vite-spa"]);
const PYTHON_SERVER_APP_TYPES = new Set(["fastapi", "django", "flask"]);
const LONG_RUNNING_SERVER_APP_TYPES = new Set(["express", "fastify", "nestjs", "rails", "laravel", "go", "rust"]);

export function assessVercelFit(input: VercelFitInput): VercelFit {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const notes: string[] = [];

  if (input.artifactKind === "image") {
    blockers.push("This project ships as a container image (Dockerfile); Vercel does not run container images — a container host fits better.");
  }
  if (input.needsGpu) {
    blockers.push("This project needs a GPU; Vercel has no GPU runtime — Modal fits (GPU serverless).");
  }
  if (PYTHON_SERVER_APP_TYPES.has(input.appType)) {
    blockers.push(`This is a Python server app (${input.appType}); Vercel is not its native fit — Modal runs Python functions, APIs and jobs natively.`);
  }
  if (LONG_RUNNING_SERVER_APP_TYPES.has(input.appType)) {
    blockers.push(`This is a long-running server (${input.appType}); Vercel runs short-lived serverless functions, not a persistent server process.`);
  }
  if (input.appType === "unknown") {
    blockers.push("The project type could not be determined, so Vercel fit cannot be confirmed automatically.");
  }

  if (VERCEL_NATIVE_APP_TYPES.has(input.appType)) {
    reasons.push(`${input.appType} is a first-class Vercel framework: zero-config builds, previews and edge delivery.`);
  }
  if (input.appType === "static" || input.rendering === "static") {
    reasons.push("The output is static, which Vercel serves globally with HTTPS included.");
  }
  if (input.hasDatabase) {
    notes.push("The database stays external (e.g. Neon, Supabase, PlanetScale): connect it to Vercel with environment variables.");
  }

  return { eligible: blockers.length === 0 && reasons.length > 0, reasons, blockers, notes };
}

/** Adapter from the core Profile shape (fields wrapped in {value,...}). */
export function vercelFitInputFromProfile(profile: Profile): VercelFitInput {
  const envNames = profile.envVars.value ?? [];
  return {
    appType: profile.appType.value,
    artifactKind: profile.artifactKind.value,
    rendering: profile.rendering.value,
    needsGpu: envNames.some((n) => /GPU|CUDA|MODEL|INFERENCE/i.test(n)) || undefined,
    hasDatabase: profile.resourceHints.value.some((h) => h.type === "database") || undefined,
  };
}

export function assessVercelFitForProfile(profile: Profile): VercelFit {
  return assessVercelFit(vercelFitInputFromProfile(profile));
}

// ---------------------------------------------------------------------------
// The flow itself
// ---------------------------------------------------------------------------

export interface HostingFlowInput {
  vercelFit: VercelFit;
  /** Provider the user picked; undefined when nothing is chosen yet. */
  chosenProviderId?: string;
  /** Where the app ended up (host or full URL), for the domain decision. */
  deployedHost?: string;
  deployedUrl?: string;
  /** Domain answers; undefined until the user is asked. */
  hasOwnDomain?: boolean;
  ownDomain?: string;
  label?: string;
  platformDomain?: string;
}

export type HostingFlowStep =
  /** Vercel fits and nothing is chosen: offer Vercel first. */
  | { kind: "offer-vercel"; fit: VercelFit }
  /** Vercel does not fit (or was declined): the user picks a provider. */
  | { kind: "choose-provider"; fit: VercelFit }
  /** Deployed on Vercel: use its domain; the domain step is skipped. */
  | { kind: "use-provider-domain"; providerId: "vercel"; url: string }
  /** Vercel chosen but we don't know the deployment URL yet. */
  | { kind: "needs-deployed-url"; providerId: "vercel" }
  /** Deployed elsewhere: ask "do you have a domain?" */
  | { kind: "ask-domain" }
  /** Own domain: show these DNS settings (nothing for Kailashe to write). */
  | { kind: "custom-domain"; settings: CustomDomainSettings }
  /** Platform subdomain: claim this unique label via tenancy.provisionSubdomain. */
  | { kind: "claim-subdomain"; label: string; fqdn: string; url: string }
  /** Platform subdomain chosen but no label picked yet. */
  | { kind: "needs-label" };

export function resolveHostingFlow(input: HostingFlowInput): HostingFlowStep {
  // Nothing chosen yet: Vercel first when it fits, otherwise open choice.
  if (!input.chosenProviderId) {
    return input.vercelFit.eligible
      ? { kind: "offer-vercel", fit: input.vercelFit }
      : { kind: "choose-provider", fit: input.vercelFit };
  }

  // Vercel deployments use the Vercel domain itself — no kailashe.tech step.
  if (input.chosenProviderId === "vercel") {
    const url = deployedUrlOf(input);
    return url
      ? { kind: "use-provider-domain", providerId: "vercel", url }
      : { kind: "needs-deployed-url", providerId: "vercel" };
  }

  // Any other provider: now the domain question appears.
  if (input.hasOwnDomain === undefined) return { kind: "ask-domain" };

  const targetHost = input.deployedHost ?? hostOfUrl(input.deployedUrl);
  if (!targetHost) return { kind: "ask-domain" };

  const onboarding = resolveDomainOnboarding({
    hasOwnDomain: input.hasOwnDomain,
    ownDomain: input.ownDomain,
    label: input.label,
    targetHost,
    platformDomain: input.platformDomain,
  });
  if (onboarding.kind === "custom") return { kind: "custom-domain", settings: onboarding.settings };
  if (onboarding.kind === "platform") {
    return { kind: "claim-subdomain", label: onboarding.label, fqdn: onboarding.fqdn, url: onboarding.url };
  }
  return { kind: "needs-label" };
}

function hostOfUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (trimmed === "") return undefined;
  return trimmed.replace(/^https?:\/\//i, "").split(/[/?#]/, 1)[0] || undefined;
}

function deployedUrlOf(input: HostingFlowInput): string | undefined {
  if (input.deployedUrl && input.deployedUrl.trim() !== "") {
    const url = input.deployedUrl.trim();
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }
  const host = input.deployedHost?.trim();
  return host ? `https://${host}` : undefined;
}
