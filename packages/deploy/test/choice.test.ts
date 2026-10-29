import { describe, it, expect } from "vitest";
import { choiceInputFromProfile, chooseProvider, chooseProviderForProfile } from "../src/choice.js";
import { loadProviders, DEFAULT_PROVIDERS_DIR } from "../src/providers.js";
import type { Profile } from "@kailashe/core/schemas/profile.js";

const AVAILABLE = ["aws", "cloudflare", "digitalocean", "fly", "vercel"];

describe("chooseProvider matrix (SPEC F2.2 / Q3)", () => {
  it("always asks and always requires confirmation", () => {
    for (const input of [{}, { isStatic: true }, { hasContainer: true, hasDatabase: true }, { userNamedProviderId: "aws" }]) {
      const choice = chooseProvider({ ...input, availableProviderIds: AVAILABLE });
      expect(choice.mustAsk).toBe(true);
      expect(choice.requiresUserConfirmation).toBe(true);
      expect(choice.reason.length).toBeGreaterThan(10);
    }
  });

  it("static -> Cloudflare, preselected with a reason", () => {
    const c = chooseProvider({ isStatic: true, availableProviderIds: AVAILABLE });
    expect(c.preselectedProviderId).toBe("cloudflare");
    expect(c.reason).toMatch(/static/i);
  });

  it("SSR -> Vercel, preselected with a reason", () => {
    const c = chooseProvider({ isSsr: true, availableProviderIds: AVAILABLE });
    expect(c.preselectedProviderId).toBe("vercel");
    expect(c.reason).toMatch(/SSR/);
  });

  it("container + database -> DigitalOcean", () => {
    const c = chooseProvider({ hasContainer: true, hasDatabase: true, availableProviderIds: AVAILABLE });
    expect(c.preselectedProviderId).toBe("digitalocean");
    expect(c.reason).toMatch(/container/i);
  });

  it("container without a database gets no automatic preselection", () => {
    const c = chooseProvider({ hasContainer: true, hasDatabase: false, availableProviderIds: AVAILABLE });
    expect(c.preselectedProviderId).toBeNull();
  });

  it("AWS is never preselected by any profile rule", () => {
    const inputs = [
      { isStatic: true },
      { isSsr: true },
      { hasContainer: true, hasDatabase: true },
      { hasContainer: true, hasDatabase: false },
      { isStatic: true, hasContainer: true, hasDatabase: true },
      {},
    ];
    for (const input of inputs) {
      expect(chooseProvider({ ...input, availableProviderIds: AVAILABLE }).preselectedProviderId).not.toBe("aws");
    }
  });

  it("AWS is preselected only when the user names it", () => {
    const c = chooseProvider({ userNamedProviderId: "aws", isStatic: true, availableProviderIds: AVAILABLE });
    expect(c.preselectedProviderId).toBe("aws");
    expect(c.reason).toMatch(/named AWS/);
    expect(c.requiresUserConfirmation).toBe(true);
  });

  it("a user-named provider wins over profile rules", () => {
    const c = chooseProvider({ userNamedProviderId: "fly", isStatic: true, availableProviderIds: AVAILABLE });
    expect(c.preselectedProviderId).toBe("fly");
  });

  it("an unknown user-named provider is not preselected", () => {
    const c = chooseProvider({ userNamedProviderId: "not-a-provider", availableProviderIds: AVAILABLE });
    expect(c.preselectedProviderId).toBeNull();
    expect(c.reason).toMatch(/not in the provider registry/);
  });

  it("no rule match -> ask plainly with nothing preselected", () => {
    const c = chooseProvider({ availableProviderIds: AVAILABLE });
    expect(c.preselectedProviderId).toBeNull();
    expect(c.mustAsk).toBe(true);
  });
});

function field<T>(value: T): { value: T; source: string; confidence: "high" } {
  return { value, source: "test", confidence: "high" };
}

function profile(overrides: Partial<Profile>): Profile {
  return {
    appType: field("nextjs"),
    framework: field("nextjs@14"),
    artifactKind: field("repo"),
    ports: field([3000]),
    buildCommand: field("npm run build"),
    startCommand: field("npm start"),
    envVars: field([]),
    resourceHints: field([]),
    rendering: field("dynamic"),
    notes: [],
    questions: [],
    ...overrides,
  } as Profile;
}

describe("profile adapter", () => {
  it("maps a static profile to Cloudflare and a container+DB profile to DigitalOcean", async () => {
    const providers = await loadProviders(DEFAULT_PROVIDERS_DIR);
    const staticChoice = chooseProviderForProfile(
      profile({ rendering: field("static"), appType: field("static"), artifactKind: field("static-dir") }),
      providers,
    );
    expect(staticChoice.preselectedProviderId).toBe("cloudflare");

    const containerDb = chooseProviderForProfile(
      profile({
        artifactKind: field("image"),
        resourceHints: field([{ type: "database", detail: "postgres", envVars: ["DATABASE_URL"] }]),
      }),
      providers,
    );
    expect(containerDb.preselectedProviderId).toBe("digitalocean");
    expect(choiceInputFromProfile(profile({})).isSsr).toBe(true);
  });
});
