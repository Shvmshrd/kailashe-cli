import { describe, it, expect } from "vitest";
import { generateCiWorkflow, validateSecretsByNameOnly, CiWorkflowError } from "../src/ci-workflow.js";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Structure — generated YAML is valid and has required top-level keys
// ---------------------------------------------------------------------------

describe("generateCiWorkflow — structure", () => {
  it("produces valid YAML for github + vercel", () => {
    const result = generateCiWorkflow({ provider: "vercel" });
    const doc = parseYaml(result.yaml) as Record<string, unknown>;
    expect(doc.name).toBeDefined();
    expect(doc.on).toBeDefined();
    expect((doc.on as Record<string, unknown>).push).toBeDefined();
    expect(doc.jobs).toBeDefined();
    const jobs = doc.jobs as Record<string, unknown>;
    expect(jobs.deploy).toBeDefined();
  });

  it("produces valid YAML for each provider", () => {
    for (const provider of ["vercel", "cloudflare", "fly", "digitalocean", "aws"] as const) {
      const result = generateCiWorkflow({ provider });
      const doc = parseYaml(result.yaml) as Record<string, unknown>;
      expect(doc, `provider ${provider} should produce valid YAML`).toBeDefined();
      expect((doc.jobs as Record<string, unknown>).deploy).toBeDefined();
    }
  });

  it("targets .github/workflows/deploy.yml", () => {
    const result = generateCiWorkflow({ provider: "vercel" });
    expect(result.path).toBe(".github/workflows/deploy.yml");
  });

  it("includes checkout + setup-node + install + build steps", () => {
    const result = generateCiWorkflow({ provider: "vercel" });
    expect(result.yaml).toContain("actions/checkout@v4");
    expect(result.yaml).toContain("actions/setup-node@v4");
    expect(result.yaml).toContain("pnpm install");
    expect(result.yaml).toContain("pnpm build");
  });

  it("respects deployBranch override", () => {
    const result = generateCiWorkflow({ provider: "vercel", deployBranch: "production" });
    expect(result.yaml).toContain("production");
  });

  it("respects nodeVersion override", () => {
    const result = generateCiWorkflow({ provider: "vercel", nodeVersion: "22" });
    expect(result.yaml).toContain("22");
  });

  it("respects workflowName override", () => {
    const result = generateCiWorkflow({ provider: "vercel", workflowName: "My Deploy" });
    expect(result.yaml).toContain("My Deploy");
  });

  it("includes non-secret env vars inline", () => {
    const result = generateCiWorkflow({
      provider: "vercel",
      env: { NODE_ENV: "production", AWS_REGION: "us-east-1" },
    });
    expect(result.yaml).toContain("NODE_ENV");
    expect(result.yaml).toContain("production");
  });

  it("uses minimal permissions (contents: read)", () => {
    const result = generateCiWorkflow({ provider: "vercel" });
    expect(result.yaml).toContain("contents: read");
  });

  it("pins action versions with @v", () => {
    const result = generateCiWorkflow({ provider: "vercel" });
    // Every `uses:` line should have a version pin
    const usesLines = result.yaml.split("\n").filter((l) => l.trim().startsWith("uses:"));
    for (const line of usesLines) {
      expect(line, `action pin missing in: ${line}`).toMatch(/@v\d+/);
    }
  });

  it("throws for unsupported ciHost", () => {
    expect(() => generateCiWorkflow({ provider: "vercel", ciHost: "gitlab" as never })).toThrow(CiWorkflowError);
  });
});

// ---------------------------------------------------------------------------
// Secrets — referenced by name only
// ---------------------------------------------------------------------------

describe("generateCiWorkflow — secrets by name only", () => {
  it("references secrets as ${{ secrets.NAME }} only", () => {
    const result = generateCiWorkflow({
      provider: "vercel",
      secrets: ["VERCEL_TOKEN", "MY_API_KEY"],
    });
    // Secrets must appear as ${{ secrets.NAME }}
    expect(result.yaml).toContain("${{ secrets.VERCEL_TOKEN }}");
    expect(result.yaml).toContain("${{ secrets.MY_API_KEY }}");
    // And the literal values must not appear (they were never provided — only names)
    // The generated YAML should not contain a line like `MY_API_KEY: some-value`
    expect(result.yaml).not.toMatch(/MY_API_KEY:\s*["']?[a-zA-Z0-9]{8,}/);
  });

  it("validateSecretsByNameOnly throws when a secret is inlined", () => {
    const badYaml = [
      "name: test",
      "jobs:",
      "  deploy:",
      "    env:",
      "      MY_SECRET: hunter2",
      "    steps:",
      "      - run: echo hi",
    ].join("\n");
    expect(() => validateSecretsByNameOnly(badYaml, ["MY_SECRET"])).toThrow(CiWorkflowError);
    expect(() => validateSecretsByNameOnly(badYaml, ["MY_SECRET"])).toThrow(/inlined/);
  });

  it("validateSecretsByNameOnly passes when secret is referenced correctly", () => {
    const goodYaml = [
      "name: test",
      "jobs:",
      "  deploy:",
      "    env:",
      "      MY_SECRET: ${{ secrets.MY_SECRET }}",
      "    steps:",
      "      - run: echo hi",
    ].join("\n");
    expect(() => validateSecretsByNameOnly(goodYaml, ["MY_SECRET"])).not.toThrow();
  });

  it("no secrets means no validation error", () => {
    const result = generateCiWorkflow({ provider: "vercel" });
    expect(() => validateSecretsByNameOnly(result.yaml, [])).not.toThrow();
  });

  it("generated workflow with secrets passes validateSecretsByNameOnly", () => {
    const secrets = ["VERCEL_TOKEN", "CLOUDFLARE_API_TOKEN"];
    const result = generateCiWorkflow({ provider: "vercel", secrets });
    expect(() => validateSecretsByNameOnly(result.yaml, secrets)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Provider-specific steps
// ---------------------------------------------------------------------------

describe("generateCiWorkflow — provider-specific deploy steps", () => {
  it("vercel uses vercel deploy", () => {
    const result = generateCiWorkflow({ provider: "vercel" });
    expect(result.yaml).toContain("vercel deploy");
  });

  it("cloudflare uses wrangler pages deploy", () => {
    const result = generateCiWorkflow({ provider: "cloudflare" });
    expect(result.yaml).toContain("wrangler pages deploy");
  });

  it("fly uses flyctl", () => {
    const result = generateCiWorkflow({ provider: "fly" });
    expect(result.yaml).toContain("flyctl deploy");
  });

  it("digitalocean uses doctl", () => {
    const result = generateCiWorkflow({ provider: "digitalocean" });
    expect(result.yaml).toContain("doctl");
  });

  it("aws uses configure-aws-credentials + ecr login", () => {
    const result = generateCiWorkflow({ provider: "aws" });
    expect(result.yaml).toContain("configure-aws-credentials");
    expect(result.yaml).toContain("ecr get-login-password");
  });
});
