import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROVIDERS_DIR,
  getProvider,
  loadProviders,
  patternCovers,
} from "../src/providers.js";

describe("cloudflare-workers provider", () => {
  it("registry loads it and it coexists with the Pages-focused cloudflare provider", async () => {
    const providers = await loadProviders(DEFAULT_PROVIDERS_DIR);
    const ids = providers.map((p) => p.id);

    // Another slice adds modal; do not pin the exact registry total.
    expect(providers.length).toBeGreaterThanOrEqual(6);
    expect(ids).toContain("cloudflare-workers");
    expect(ids).toContain("cloudflare");
    expect(new Set(ids).size).toBe(ids.length);

    const workers = getProvider(providers, "cloudflare-workers");
    const pages = getProvider(providers, "cloudflare");
    expect(workers.id).not.toBe(pages.id);
    expect(workers.name).toBe("Cloudflare Workers");
    expect(workers.cliBinary).toBe("wrangler");
    expect(pages.cliBinary).toBe("wrangler");
  });

  it("has per-OS install commands from the official Cloudflare docs domain", async () => {
    const workers = getProvider(await loadProviders(DEFAULT_PROVIDERS_DIR), "cloudflare-workers");

    expect(workers.install.map((i) => i.os).sort()).toEqual(["linux", "macos", "windows"]);
    for (const entry of workers.install) {
      expect(entry.command, entry.os).toBe("npm i -g wrangler");
      expect(entry.sourceUrl.startsWith("https://"), entry.os).toBe(true);
      expect(new URL(entry.sourceUrl).hostname, entry.os).toBe("developers.cloudflare.com");
    }
    expect(workers.docsDomains).toContain("developers.cloudflare.com");
    expect(workers.health?.path).toBe("/");
    expect(workers.tagging?.key).toBe("kailashe-project");
  });

  it("verify and login commands are covered by the allowlist", async () => {
    const workers = getProvider(await loadProviders(DEFAULT_PROVIDERS_DIR), "cloudflare-workers");
    const patterns = workers.allowedPatterns.map((a) => a.pattern);

    expect(workers.verify.command).toBe("wrangler whoami");
    expect(workers.verify.expectedExitCode).toBe(0);
    expect(patternCovers(patterns, workers.verify.command)).toBe(true);

    const verifyPattern = workers.allowedPatterns.find((a) => patternCovers([a.pattern], workers.verify.command));
    expect(verifyPattern?.class).toBe("read");

    expect(workers.login.command).toBe("wrangler login");
    expect(patternCovers(patterns, workers.login.command)).toBe(true);
    const loginPattern = workers.allowedPatterns.find((a) => patternCovers([a.pattern], workers.login.command));
    expect(loginPattern?.class).toBe("iam-billing-network");
  });

  it("classifies Workers deploy as create and delete as delete", async () => {
    const workers = getProvider(await loadProviders(DEFAULT_PROVIDERS_DIR), "cloudflare-workers");

    expect(workers.allowedPatterns.find((a) => a.pattern === "wrangler deploy")?.class).toBe("create");
    expect(workers.allowedPatterns.find((a) => a.pattern === "wrangler delete")?.class).toBe("delete");
    expect(workers.allowedPatterns.find((a) => a.pattern === "wrangler dev")?.class).toBe("modify");
    expect(workers.allowedPatterns.find((a) => a.pattern === "wrangler rollback")?.class).toBe("modify");
    expect(workers.allowedPatterns.find((a) => a.pattern === "wrangler tail")?.class).toBe("read");
    expect(workers.allowedPatterns.find((a) => a.pattern === "wrangler secret put")?.class).toBe(
      "iam-billing-network",
    );
    expect(workers.allowedPatterns.find((a) => a.pattern === "wrangler secret list")?.class).toBe("read");
  });

  it("is Workers-only: every pattern starts with wrangler and none use Pages", async () => {
    const workers = getProvider(await loadProviders(DEFAULT_PROVIDERS_DIR), "cloudflare-workers");

    for (const allowed of workers.allowedPatterns) {
      expect(allowed.pattern.startsWith("wrangler"), allowed.pattern).toBe(true);
      expect(allowed.pattern.includes("wrangler pages"), allowed.pattern).toBe(false);
      expect(allowed.pattern.startsWith("wrangler pages"), allowed.pattern).toBe(false);
    }
    expect(workers.allowedPatterns.some((a) => a.pattern.includes("pages"))).toBe(false);
  });
});
