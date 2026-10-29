import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  DEFAULT_PROVIDERS_DIR,
  ProviderSchema,
  getProvider,
  loadProviders,
  parseProviderYaml,
  patternCovers,
} from "../src/providers.js";

// Built dynamically so this test file is not itself a credential-path hit.
const CREDENTIAL_FILE_FRAGMENTS = [
  [".mo", "dal.toml"].join(""),
  ["modal", ".toml"].join(""),
  ["~/", ".modal"].join(""),
  ["/.mo", "dal/"].join(""),
  [".to", "ml"].join(""),
];

describe("Modal provider (providers/modal.yaml)", () => {
  it("is present in the real registry and validates against ProviderSchema", async () => {
    const providers = await loadProviders(DEFAULT_PROVIDERS_DIR);
    const modal = getProvider(providers, "modal");
    expect(modal.id).toBe("modal");
    expect(modal.name).toBe("Modal");
    expect(modal.cliBinary).toBe("modal");
    expect(ProviderSchema.safeParse(modal).success).toBe(true);
  });

  it("file id matches filename modal.yaml", async () => {
    const file = join(DEFAULT_PROVIDERS_DIR, "modal.yaml");
    expect(basename(file)).toBe("modal.yaml");
    const content = await readFile(file, "utf8");
    const parsed = parseProviderYaml(content, "modal.yaml");
    expect(parsed.id).toBe("modal");
    expect(`${parsed.id}.yaml`).toBe(basename(file));
  });

  it("has per-OS pip installs from the official Modal docs domain", async () => {
    const modal = getProvider(await loadProviders(DEFAULT_PROVIDERS_DIR), "modal");
    expect(modal.install.map((i) => i.os).sort()).toEqual(["linux", "macos", "windows"]);
    for (const entry of modal.install) {
      expect(entry.command, entry.os).toContain("pip install modal");
      expect(entry.sourceUrl.startsWith("https://"), entry.os).toBe(true);
      const host = new URL(entry.sourceUrl).hostname;
      expect(["modal.com", "docs.modal.com"], `${entry.os}: ${entry.sourceUrl}`).toContain(host);
    }
    expect(modal.docsDomains).toContain("modal.com");
    expect(modal.health?.path).toBe("/");
    expect(modal.tagging?.key).toBe("kailashe-project");
  });

  it("login is covered and verify is covered as read", async () => {
    const modal = getProvider(await loadProviders(DEFAULT_PROVIDERS_DIR), "modal");
    expect(modal.login.command).toBe("modal token new");
    expect(modal.login.helpText).toMatch(/never reads the token/i);
    expect(patternCovers(modal.allowedPatterns.map((a) => a.pattern), modal.login.command)).toBe(true);
    const loginPattern = modal.allowedPatterns.find((a) => patternCovers([a.pattern], modal.login.command));
    expect(loginPattern?.class).toBe("iam-billing-network");

    expect(modal.verify.command).toBe("modal profile current");
    expect(modal.verify.expectedExitCode).toBe(0);
    expect(patternCovers(modal.allowedPatterns.map((a) => a.pattern), modal.verify.command)).toBe(true);
    const verifyPattern = modal.allowedPatterns.find((a) => patternCovers([a.pattern], modal.verify.command));
    expect(verifyPattern?.class).toBe("read");
  });

  it("all patterns start with the modal binary and deploy requires class create", async () => {
    const modal = getProvider(await loadProviders(DEFAULT_PROVIDERS_DIR), "modal");
    for (const a of modal.allowedPatterns) {
      expect(a.pattern === "modal" || a.pattern.startsWith("modal "), a.pattern).toBe(true);
      expect(["read", "create", "modify", "delete", "iam-billing-network"]).toContain(a.class);
    }
    expect(modal.allowedPatterns.find((a) => a.pattern === "modal deploy")?.class).toBe("create");
    expect(modal.allowedPatterns.find((a) => a.pattern === "modal serve")?.class).toBe("modify");
    expect(modal.allowedPatterns.find((a) => a.pattern === "modal run")?.class).toBe("create");
    expect(modal.allowedPatterns.find((a) => a.pattern === "modal app stop")?.class).toBe("delete");
    expect(modal.allowedPatterns.find((a) => a.pattern === "modal volume delete")?.class).toBe("delete");
    const secretList = modal.allowedPatterns.find((a) => a.pattern === "modal secret list");
    expect(secretList?.class).toBe("read");
    expect(secretList?.notes).toMatch(/names only/i);
    expect(modal.allowedPatterns.find((a) => a.pattern === "modal secret create")?.class).toBe(
      "iam-billing-network",
    );
  });

  it("no pattern or command reads credential files", async () => {
    const modal = getProvider(await loadProviders(DEFAULT_PROVIDERS_DIR), "modal");
    const surfaces = [
      ...modal.allowedPatterns.map((a) => a.pattern),
      ...modal.allowedPatterns.map((a) => a.notes ?? ""),
      modal.login.command,
      modal.verify.command,
      ...modal.install.map((i) => i.command),
    ];
    for (const surface of surfaces) {
      for (const fragment of CREDENTIAL_FILE_FRAGMENTS) {
        expect(surface.includes(fragment), `${surface} must not mention ${fragment}`).toBe(false);
      }
    }
    const raw = await readFile(join(DEFAULT_PROVIDERS_DIR, "modal.yaml"), "utf8");
    for (const fragment of CREDENTIAL_FILE_FRAGMENTS) {
      expect(raw.includes(fragment), `modal.yaml must not mention ${fragment}`).toBe(false);
    }
  });

  it("positions Modal as serverless Python/GPU via pip (checked in the raw YAML)", async () => {
    const raw = await readFile(join(DEFAULT_PROVIDERS_DIR, "modal.yaml"), "utf8");
    expect(raw).toContain("python -m pip install modal");
    expect(raw.toLowerCase()).toContain("python");
    expect(raw.toLowerCase()).toContain("gpu");
  });
});
