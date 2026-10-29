import { describe, it, expect } from "vitest";
import type { Profile } from "@kailashe/core/schemas/profile.js";
import {
  assessVercelFit,
  assessVercelFitForProfile,
  resolveHostingFlow,
  type VercelFit,
} from "../src/hosting-flow.js";

const ELIGIBLE: VercelFit = assessVercelFit({ appType: "nextjs", artifactKind: "repo", rendering: "dynamic" });
const NOT_ELIGIBLE: VercelFit = assessVercelFit({ appType: "fastapi", artifactKind: "repo", rendering: "dynamic" });

describe("assessVercelFit", () => {
  it("offers Vercel for Next.js / SSR front ends and static output", () => {
    expect(ELIGIBLE.eligible).toBe(true);
    expect(ELIGIBLE.reasons.join(" ")).toMatch(/Vercel/);
    expect(assessVercelFit({ appType: "vite-spa", artifactKind: "static-dir", rendering: "static" }).eligible).toBe(true);
    expect(assessVercelFit({ appType: "static", artifactKind: "static-dir", rendering: "static" }).eligible).toBe(true);
  });

  it("blocks container images, GPU workloads, Python servers and long-running servers", () => {
    expect(assessVercelFit({ appType: "nextjs", artifactKind: "image", rendering: "dynamic" }).eligible).toBe(false);
    expect(assessVercelFit({ appType: "nextjs", artifactKind: "repo", rendering: "dynamic", needsGpu: true }).blockers.join(" ")).toMatch(/GPU/);
    expect(NOT_ELIGIBLE.eligible).toBe(false);
    expect(NOT_ELIGIBLE.blockers.join(" ")).toMatch(/Modal/);
    expect(assessVercelFit({ appType: "express", artifactKind: "repo", rendering: "dynamic" }).blockers.join(" ")).toMatch(/long-running/);
    expect(assessVercelFit({ appType: "unknown", artifactKind: "repo", rendering: "dynamic" }).eligible).toBe(false);
  });

  it("treats Node servers that only serve a static build as Vercel-eligible, with a functions caveat", () => {
    const fit = assessVercelFit({ appType: "express", artifactKind: "build-dir", rendering: "static" });
    expect(fit.eligible).toBe(true);
    expect(fit.blockers.join(" ")).not.toMatch(/long-running/);
    expect(fit.reasons.join(" ")).toMatch(/static/);
    expect(fit.notes.join(" ")).toMatch(/serverless functions/);
    // A real dynamic Express API stays blocked.
    expect(assessVercelFit({ appType: "express", artifactKind: "repo", rendering: "dynamic" }).eligible).toBe(false);
  });

  it("keeps the database external as a note, not a blocker", () => {
    const fit = assessVercelFit({ appType: "nextjs", artifactKind: "repo", rendering: "dynamic", hasDatabase: true });
    expect(fit.eligible).toBe(true);
    expect(fit.notes.join(" ")).toMatch(/environment variables/);
  });
});

function field<T>(value: T): { value: T; source: string; confidence: "high" } {
  return { value, source: "test", confidence: "high" };
}

describe("assessVercelFitForProfile", () => {
  it("adapts the core Profile shape", () => {
    const profile = {
      appType: field("nextjs"),
      framework: field("nextjs@15"),
      artifactKind: field("repo"),
      ports: field([3000]),
      buildCommand: field("next build"),
      startCommand: field("next start"),
      envVars: field(["DATABASE_URL"]),
      resourceHints: field([{ type: "database" as const, detail: "postgres", envVars: ["DATABASE_URL"] }]),
      rendering: field("dynamic"),
      notes: [],
      questions: [],
    } as unknown as Profile;
    const fit = assessVercelFitForProfile(profile);
    expect(fit.eligible).toBe(true);
    expect(fit.notes).toHaveLength(1);
  });

  it("detects GPU intent from env var names", () => {
    const profile = {
      appType: field("nextjs"),
      framework: field("nextjs@15"),
      artifactKind: field("repo"),
      ports: field([3000]),
      buildCommand: field("next build"),
      startCommand: field("next start"),
      envVars: field(["CUDA_VISIBLE_DEVICES"]),
      resourceHints: field([]),
      rendering: field("dynamic"),
      notes: [],
      questions: [],
    } as unknown as Profile;
    expect(assessVercelFitForProfile(profile).eligible).toBe(false);
  });
});

describe("resolveHostingFlow", () => {
  it("offers Vercel first when it fits and nothing is chosen yet", () => {
    expect(resolveHostingFlow({ vercelFit: ELIGIBLE })).toEqual({ kind: "offer-vercel", fit: ELIGIBLE });
    expect(resolveHostingFlow({ vercelFit: NOT_ELIGIBLE })).toEqual({ kind: "choose-provider", fit: NOT_ELIGIBLE });
  });

  it("uses the Vercel domain itself for Vercel deploys — no kailashe.tech step", () => {
    expect(
      resolveHostingFlow({ vercelFit: ELIGIBLE, chosenProviderId: "vercel", deployedUrl: "my-app.vercel.app" }),
    ).toEqual({ kind: "use-provider-domain", providerId: "vercel", url: "https://my-app.vercel.app" });
    expect(
      resolveHostingFlow({ vercelFit: ELIGIBLE, chosenProviderId: "vercel", deployedHost: "my-app.vercel.app" }),
    ).toEqual({ kind: "use-provider-domain", providerId: "vercel", url: "https://my-app.vercel.app" });
    expect(resolveHostingFlow({ vercelFit: ELIGIBLE, chosenProviderId: "vercel" })).toEqual({
      kind: "needs-deployed-url",
      providerId: "vercel",
    });
  });

  it("shows the domain question only for non-Vercel deploys", () => {
    const base = { vercelFit: NOT_ELIGIBLE, chosenProviderId: "modal", deployedHost: "zi1-app.modal.run" };
    expect(resolveHostingFlow(base)).toEqual({ kind: "ask-domain" });

    const custom = resolveHostingFlow({ ...base, hasOwnDomain: true, ownDomain: "mysite.com" });
    expect(custom.kind).toBe("custom-domain");
    if (custom.kind === "custom-domain") {
      expect(custom.settings.records[0]).toMatchObject({ name: "@", value: "zi1-app.modal.run" });
    }

    expect(resolveHostingFlow({ ...base, hasOwnDomain: false })).toEqual({ kind: "needs-label" });
    expect(resolveHostingFlow({ ...base, hasOwnDomain: false, label: "zi1" })).toEqual({
      kind: "claim-subdomain",
      label: "zi1",
      fqdn: "zi1.kailashe.tech",
      url: "https://zi1.kailashe.tech",
    });
  });
});
