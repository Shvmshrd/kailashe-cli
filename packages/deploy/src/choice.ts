/**
 * Provider-choice logic — SPEC F2.2 / Q3, S3.
 *
 * Pure function, no I/O. The user is ALWAYS asked and must confirm; this
 * only computes the single preselection (if any) plus the reason shown
 * next to it:
 *   - static site        -> Cloudflare (Pages: global static hosting)
 *   - SSR front end      -> Vercel (first-class SSR/Next.js-style hosting)
 *   - container + database -> DigitalOcean (App Platform / managed DB pairing)
 *   - AWS                -> never preselected; only when the user names it
 * Anything else gets no preselection — the question is asked plain.
 */

import type { Profile } from "@kailashe/core/schemas/profile.js";
import { findProvider, type Provider } from "./providers.js";

export interface ProviderChoiceInput {
  /** True for a purely static site (no server runtime). */
  isStatic?: boolean;
  /** True for a server-rendered front end (SSR framework / dynamic front end). */
  isSsr?: boolean;
  /** True when the app ships as a container image / Dockerfile. */
  hasContainer?: boolean;
  /** True when the app needs a database. */
  hasDatabase?: boolean;
  /** Provider id the user explicitly named, if any. Naming AWS counts. */
  userNamedProviderId?: string;
  /** Ids actually available in the registry; unknown names are not preselected. */
  availableProviderIds?: readonly string[];
}

export interface ProviderChoice {
  /** Always true: the user is asked in every case (Q3). */
  mustAsk: true;
  /** Always true: nothing acts on the preselection without confirmation. */
  requiresUserConfirmation: true;
  /** The single preselected provider id, or null when there is no safe default. */
  preselectedProviderId: string | null;
  /** Human-readable reason shown beside the preselection (or its absence). */
  reason: string;
}

const SSR_APP_TYPES = new Set(["nextjs", "remix", "nuxt", "sveltekit", "astro"]);

export function chooseProvider(input: ProviderChoiceInput): ProviderChoice {
  const base = { mustAsk: true as const, requiresUserConfirmation: true as const };
  const available = input.availableProviderIds;
  const isAvailable = (id: string): boolean => !available || available.includes(id);

  // AWS (and anything else) is preselected only when the user names it.
  if (input.userNamedProviderId) {
    const named = input.userNamedProviderId;
    if (isAvailable(named)) {
      return {
        ...base,
        preselectedProviderId: named,
        reason:
          named === "aws"
            ? "You named AWS, so it is preselected. AWS is never preselected on its own; confirmation is still required."
            : `You named ${named}, so it is preselected; confirmation is still required.`,
      };
    }
    return {
      ...base,
      preselectedProviderId: null,
      reason: `You named "${named}", which is not in the provider registry, so nothing is preselected. Please pick a provider.`,
    };
  }

  if (input.hasContainer && input.hasDatabase && isAvailable("digitalocean")) {
    return {
      ...base,
      preselectedProviderId: "digitalocean",
      reason:
        "This app is a container that needs a database, so DigitalOcean is preselected: its app hosting and managed databases pair cleanly. Confirmation is still required.",
    };
  }

  if (input.isStatic && isAvailable("cloudflare")) {
    return {
      ...base,
      preselectedProviderId: "cloudflare",
      reason:
        "This is a static site, so Cloudflare is preselected: Pages serves static sites globally with no server to manage. Confirmation is still required.",
    };
  }

  if (input.isSsr && isAvailable("vercel")) {
    return {
      ...base,
      preselectedProviderId: "vercel",
      reason:
        "This is an SSR front end, so Vercel is preselected: it hosts server-rendered front ends with the least configuration. Confirmation is still required.",
    };
  }

  return {
    ...base,
    preselectedProviderId: null,
    reason:
      "No provider fits the automatic rules for this profile, so nothing is preselected. Please pick a provider; AWS is available if you name it.",
  };
}

/** Adapter from the S2 Profile shape (every field wrapped in {value,...}). */
export function choiceInputFromProfile(profile: Profile): ProviderChoiceInput {
  const appType = profile.appType.value;
  const isStatic = profile.rendering.value === "static" || appType === "static";
  const isSsr = !isStatic && (profile.rendering.value === "dynamic" && SSR_APP_TYPES.has(appType));
  return {
    isStatic,
    isSsr: isSsr || undefined,
    hasContainer: profile.artifactKind.value === "image",
    hasDatabase: profile.resourceHints.value.some((h) => h.type === "database"),
  };
}

export function chooseProviderForProfile(
  profile: Profile,
  providers: readonly Provider[],
  userNamedProviderId?: string,
): ProviderChoice {
  return chooseProvider({
    ...choiceInputFromProfile(profile),
    userNamedProviderId,
    availableProviderIds: providers.map((p) => p.id),
  });
}

/** Resolve a choice's preselection to a registry entry (undefined if none). */
export function preselectedProvider(
  choice: ProviderChoice,
  providers: readonly Provider[],
): Provider | undefined {
  return choice.preselectedProviderId ? findProvider(providers, choice.preselectedProviderId) : undefined;
}
