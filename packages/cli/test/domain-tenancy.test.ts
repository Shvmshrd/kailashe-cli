import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import {
  CloudflareDnsProvider,
  FakeDnsProvider,
  InMemoryTenantRegistry,
  VercelDnsProvider,
} from "@kailashe/deploy";
import {
  createDomainCommand,
  dnsProviderFromEnv,
  executeDomainSetup,
  formatProvisionResult,
} from "../src/commands/domain.js";
import { ExitCode } from "../src/exit-codes.js";

const TARGET = "zi1-app.modal.run";

function deps() {
  return { registry: new InMemoryTenantRegistry(), dns: new FakeDnsProvider(), env: {} as Record<string, string | undefined> };
}

describe("executeDomainSetup", () => {
  it("claims zi1 -> https://zi1.kailashe.tech with HTTPS on", async () => {
    const d = deps();
    const outcome = await executeDomainSetup(d, { userId: "user-a", targetHost: TARGET, label: "zi1" });
    expect(outcome.kind).toBe("platform");
    expect(outcome.exitCode).toBe(ExitCode.Ok);
    if (outcome.kind === "platform") {
      expect(outcome.result.url).toBe("https://zi1.kailashe.tech");
      expect(outcome.result.https.enabled).toBe(true);
      expect(formatProvisionResult(outcome.result).join("\n")).toContain("zi1.kailashe.tech");
    }
    expect(d.dns.records.has("zi1.kailashe.tech")).toBe(true);
  });

  it("a taken label is rejected for another user (can be used only once)", async () => {
    const d = deps();
    await executeDomainSetup(d, { userId: "user-a", targetHost: TARGET, label: "zi1" });
    const second = await executeDomainSetup(d, { userId: "user-b", targetHost: "other.modal.run", label: "zi1" });
    expect(second.kind).toBe("error");
    expect(second.exitCode).toBe(ExitCode.Validation);
  });

  it("shows custom-domain DNS settings when the user has a domain", async () => {
    const d = deps();
    const outcome = await executeDomainSetup(d, { userId: "user-a", targetHost: TARGET, ownDomain: "mysite.com" });
    expect(outcome.kind).toBe("custom");
    if (outcome.kind === "custom") {
      expect(outcome.settings.records).toEqual([
        { type: "CNAME", name: "@", value: TARGET, proxied: "recommended", ttl: "auto" },
        { type: "CNAME", name: "www", value: TARGET, proxied: "recommended", ttl: "auto" },
      ]);
    }
    // Custom domains never write DNS or claim labels.
    expect(d.registry.list()).toEqual([]);
    expect(d.dns.records.size).toBe(0);
  });

  it("skips the whole domain step for Vercel deploys (Vercel domain is used)", async () => {
    const d = deps();
    const outcome = await executeDomainSetup(d, { providerId: "vercel", targetHost: "my-app.vercel.app" });
    expect(outcome).toEqual({
      kind: "provider-domain",
      providerId: "vercel",
      url: "https://my-app.vercel.app",
      exitCode: ExitCode.Ok,
    });
    expect(d.registry.list()).toEqual([]);

    const missing = await executeDomainSetup(d, { providerId: "vercel" });
    expect(missing.kind).toBe("needs-input");
    expect(missing.exitCode).toBe(ExitCode.NeedsInputOrDenied);
  });

  it("refuses to claim anything when tenant DNS is not configured (no partial claim)", async () => {
    const d = deps();
    const outcome = await executeDomainSetup(
      { registry: d.registry, env: {} },
      { userId: "user-a", targetHost: TARGET, label: "zi1" },
    );
    expect(outcome.kind).toBe("needs-input");
    expect(outcome.exitCode).toBe(ExitCode.NeedsInputOrDenied);
    if (outcome.kind === "needs-input") {
      expect(outcome.message).toContain("VERCEL_API_TOKEN");
      expect(outcome.message).toContain("CLOUDFLARE_API_TOKEN");
      expect(outcome.message).toContain("No claim was made");
    }
    expect(d.registry.list()).toEqual([]);
  });

  it("asks for the missing pieces instead of guessing", async () => {
    const d = deps();
    expect((await executeDomainSetup(d, { userId: "user-a", label: "zi1" })).kind).toBe("needs-input");
    expect((await executeDomainSetup(d, { userId: "user-a", targetHost: TARGET })).kind).toBe("needs-input");
    expect((await executeDomainSetup(d, { targetHost: TARGET, label: "zi1" })).kind).toBe("needs-input");
  });
});

describe("dnsProviderFromEnv", () => {
  it("prefers Cloudflare, falls back to Vercel, otherwise null", () => {
    expect(dnsProviderFromEnv({}, "kailashe.tech")).toBeNull();
    expect(dnsProviderFromEnv({ CLOUDFLARE_API_TOKEN: "t" }, "kailashe.tech")).toBeNull();
    expect(dnsProviderFromEnv({ VERCEL_API_TOKEN: "t" }, "kailashe.tech")).toBeInstanceOf(VercelDnsProvider);
    expect(
      dnsProviderFromEnv({ VERCEL_API_TOKEN: "t", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ZONE_ID: "z" }, "kailashe.tech"),
    ).toBeInstanceOf(CloudflareDnsProvider);
  });
});

describe("domain command wiring", () => {
  beforeEach(() => { process.exitCode = undefined; });
  afterEach(() => { process.exitCode = undefined; vi.restoreAllMocks(); });

  function program(d: ReturnType<typeof deps>): Command {
    return new Command().addCommand(
      createDomainCommand({ tenancy: { registry: d.registry, dns: d.dns, env: {} } }),
    );
  }

  it("registers setup/check/custom/release next to add", () => {
    const names = createDomainCommand().commands.map((c) => c.name()).sort();
    expect(names).toEqual(["add", "check", "custom", "release", "setup"]);
  });

  it("setup claims a subdomain end to end through commander", async () => {
    const d = deps();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await program(d).parseAsync(["node", "kailashe", "domain", "setup", "--label", "zi1", "--target", TARGET, "--user", "user-a"]);
    expect(process.exitCode).toBe(ExitCode.Ok);
    expect(log.mock.calls.flat().join("\n")).toContain("https://zi1.kailashe.tech");
    expect(d.registry.getByLabel("zi1")).toMatchObject({ userId: "user-a", status: "active" });
  });

  it("check reports a claimed label as taken, usable only once", async () => {
    const d = deps();
    await executeDomainSetup(d, { userId: "user-a", targetHost: TARGET, label: "zi1" });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await program(d).parseAsync(["node", "kailashe", "domain", "check", "zi1"]);
    expect(log.mock.calls.flat().join("\n")).toContain("taken");
  });

  it("setup --provider vercel prints the Vercel domain and claims nothing", async () => {
    const d = deps();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await program(d).parseAsync([
      "node", "kailashe", "domain", "setup", "--provider", "vercel", "--target", "my-app.vercel.app",
    ]);
    expect(process.exitCode).toBe(ExitCode.Ok);
    expect(log.mock.calls.flat().join("\n")).toContain("https://my-app.vercel.app");
    expect(d.registry.list()).toEqual([]);
  });
});
