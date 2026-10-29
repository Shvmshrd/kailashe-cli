import { describe, it, expect } from "vitest";
import {
  TaskSchema,
  TaskJsonSchema,
  taskPriorityScore,
  ManifestSchema,
  ManifestJsonSchema,
  unknownCapabilityIds,
  ConnectorsRegistrySchema,
  ConnectorsRegistryJsonSchema,
  ArchetypesSchema,
  ArchetypeJsonSchema,
  ArchetypesJsonSchema,
  ComposeInputSchema,
  ComposeInputJsonSchema,
  ChannelMapSchema,
  ChannelMapJsonSchema,
  findMissingChannelIds,
} from "../src/schemas/index.js";
import { BudgetExceededError as BudgetFromBudget } from "../src/llm/budget.js";
import { BudgetExceededError as BudgetFromExitCodes, resolveExitCode } from "../src/exit-codes.js";
import * as core from "../src/index.js";

const validTask = {
  id: "T-014",
  title: "Submit to 10 relevant directories",
  goal: "Ten listings live",
  channel: "directories",
  route: "muse-browser + gmail",
  approval: "B",
  inputs: ["listing-kit"],
  steps: ["prepare kit", "submit in batches of 5"],
  success_check: "10 tracker rows live",
  kpi: "referring_domains",
  impact: 3,
  confidence: 4,
  effort: 3,
  depends_on: ["T-003"],
  status: "todo",
  evidence: [],
  notes: "",
};

describe("TaskSchema (SPEC 6.8)", () => {
  it("accepts a valid task and applies defaults", () => {
    const { notes: _n, status: _s, evidence: _e, depends_on: _d, ...rest } = validTask;
    const parsed = TaskSchema.parse(rest);
    expect(parsed.status).toBe("todo");
    expect(parsed.notes).toBe("");
    expect(parsed.evidence).toEqual([]);
  });
  it("rejects bad id, approval, status and out-of-range scores", () => {
    expect(TaskSchema.safeParse({ ...validTask, id: "X-1" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...validTask, id: "T-14" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...validTask, approval: "D" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...validTask, approval: "Never" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...validTask, status: "pending" }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...validTask, impact: 0 }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...validTask, confidence: 6 }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...validTask, effort: 2.5 }).success).toBe(false);
  });
  it("rejects missing required fields and unknown keys", () => {
    const { title: _t, ...noTitle } = validTask;
    expect(TaskSchema.safeParse(noTitle).success).toBe(false);
    expect(TaskSchema.safeParse({ ...validTask, extra: 1 }).success).toBe(false);
  });
  it("exports JSON Schema and computes priority per ops-loop section 3", () => {
    expect(JSON.stringify(TaskJsonSchema)).toContain("T-");
    expect(taskPriorityScore(validTask)).toBeCloseTo(4);
    expect(taskPriorityScore(validTask, { unlocksCount: 3 })).toBeCloseTo(6);
    expect(taskPriorityScore(validTask, { approvalOverdue: true })).toBeCloseTo(2);
  });
});

const validManifest = {
  project: "my-app",
  budget: { monthly_cap_usd: 50, per_action_cap_usd: 5 },
  capabilities: [
    { id: "seo.keywords", route: "dataforseo-mcp", allowed: ["labs_google_keyword_ideas"], class: "A", cost: "pay per call" },
    { id: "content.publish_repo", route: "muse:github", allowed: ["read_file", "open_pull_request"], class: "B", notes: "owner merges" },
  ],
};

describe("ManifestSchema (SPEC 6.9)", () => {
  it("accepts a valid manifest", () => {
    expect(ManifestSchema.parse(validManifest).capabilities).toHaveLength(2);
    expect(JSON.stringify(ManifestJsonSchema)).toContain("monthly_cap_usd");
  });
  it("rejects negative caps, bad class and missing budget", () => {
    expect(ManifestSchema.safeParse({ ...validManifest, budget: { monthly_cap_usd: -1, per_action_cap_usd: 5 } }).success).toBe(false);
    expect(ManifestSchema.safeParse({ project: "x", capabilities: [] }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...validManifest, capabilities: [{ id: "seo.keywords", route: "r", allowed: ["read"], class: "D" }] }).success).toBe(false);
  });
  it("rejects wildcard and admin allowed actions", () => {
    for (const allowed of [["*"], ["admin"], ["seo.*"], ["delete_admin"]]) {
      expect(ManifestSchema.safeParse({ ...validManifest, capabilities: [{ id: "seo.keywords", route: "r", allowed, class: "A" }] }).success, allowed.join()).toBe(false);
    }
  });
  it("finds capability ids missing from a registry", () => {
    expect(unknownCapabilityIds(ManifestSchema.parse(validManifest), ["seo.keywords"])).toEqual(["content.publish_repo"]);
    expect(unknownCapabilityIds(ManifestSchema.parse(validManifest), new Set(["seo.keywords", "content.publish_repo"]))).toEqual([]);
  });
});

const validRegistry = {
  version: 1,
  verified: "2026-10-13",
  status_values: { live: "built in", custom: "custom connector", hub: "via hub", browser: "browser", manual: "owner does it" },
  approval_classes: { A: "auto", B: "batch", C: "ask each time" },
  hubs: {
    zapier: { kind: "muse-builtin", reach: "9,000+ apps", setup: "Settings, Connectors", auth: "zapier-account", license: "closed" },
    n8n: { kind: "custom-connector", url_self_hosted: "https://<host>/mcp-server/http", auth: ["oauth", "access-token"], license: "Sustainable Use" },
  },
  capabilities: {
    "seo.keywords": { purpose: "Volume and difficulty", routes: [{ via: "custom", tool: "dataforseo", status: "custom", class: "A", note: "pay per call" }] },
    "code.deploy_status": { purpose: "Check deploys", routes: [{ via: "github-actions-status", status: "live", class: "A" }] },
  },
};

describe("ConnectorsRegistrySchema (SPEC 6.10)", () => {
  it("accepts a registry mirroring connectors.yaml (tool optional, auth array)", () => {
    const parsed = ConnectorsRegistrySchema.parse(validRegistry);
    expect(parsed.hubs["n8n"]?.auth).toEqual(["oauth", "access-token"]);
    expect(JSON.stringify(ConnectorsRegistryJsonSchema)).toContain("capabilities");
  });
  it("strips extra route keys produced by unquoted flow-style YAML notes", () => {
    const quirky = structuredClone(validRegistry);
    (quirky.capabilities["seo.keywords"]!.routes[0] as Record<string, unknown>)["pay per call"] = null;
    expect(ConnectorsRegistrySchema.safeParse(quirky).success).toBe(true);
  });
  it("rejects bad verified date, status, class and empty routes", () => {
    expect(ConnectorsRegistrySchema.safeParse({ ...validRegistry, verified: "13 Oct 2026" }).success).toBe(false);
    expect(ConnectorsRegistrySchema.safeParse({ ...validRegistry, version: "1" }).success).toBe(false);
    const badStatus = structuredClone(validRegistry);
    badStatus.capabilities["seo.keywords"]!.routes[0]!.status = "unknown" as never;
    expect(ConnectorsRegistrySchema.safeParse(badStatus).success).toBe(false);
    const noRoutes = structuredClone(validRegistry);
    noRoutes.capabilities["seo.keywords"]!.routes = [];
    expect(ConnectorsRegistrySchema.safeParse(noRoutes).success).toBe(false);
  });
});

function archetype(id: string) {
  return {
    id, name: `${id} name`, detect: ["signal"], audience: "someone",
    channels_ranked: ["directories"], content_mix: { bottom: 20, middle: 50, top: 15, proof: 15 },
    first_30_days: ["seo-basics"], flows: ["uptime-alert"], kpis: ["signups"], cautions: ["careful"],
  };
}
const nineIds = ["dev-tool", "b2b-saas", "b2c-app", "ai-tool", "content-media", "ecommerce", "local-service", "digital-product", "free-utility"];

describe("ArchetypesSchema (SPEC 6.11)", () => {
  it("accepts exactly the 9 archetypes", () => {
    expect(ArchetypesSchema.parse({ version: 1, archetypes: nineIds.map(archetype) }).archetypes).toHaveLength(9);
    expect(ArchetypeJsonSchema).toBeDefined();
    expect(JSON.stringify(ArchetypesJsonSchema)).toContain("content_mix");
  });
  it("rejects wrong count, unknown or duplicate ids, and mix not summing to 100", () => {
    expect(ArchetypesSchema.safeParse({ version: 1, archetypes: nineIds.slice(0, 8).map(archetype) }).success).toBe(false);
    expect(ArchetypesSchema.safeParse({ version: 1, archetypes: [...nineIds.slice(0, 8), "nope"].map(archetype) }).success).toBe(false);
    const dup = nineIds.map(archetype); dup[8] = archetype("dev-tool");
    expect(ArchetypesSchema.safeParse({ version: 1, archetypes: dup }).success).toBe(false);
    const badMix = nineIds.map(archetype); badMix[0] = { ...archetype("dev-tool"), content_mix: { bottom: 1, middle: 1, top: 1, proof: 1 } };
    expect(ArchetypesSchema.safeParse({ version: 1, archetypes: badMix }).success).toBe(false);
  });
});

const validCompose = {
  project: { name: "App", url: "https://example.com", repo: "https://github.com/a/b" },
  date: "2026-10-29",
  plan: { version: "1" },
  brief: { what: "w", audience: "a", problem: "p", features: "f", pricing: "free", limits: "l", voice: "v", donotsay: "d", links: "li", owner: "o" },
  market: { date: "2026-10-29", archetype: "dev-tool", archetype_reason: "r", trends_table: "t", clusters_table: "c", gaps: "g", competitors_table: "co", communities_table: "cm", unknowns: "u", json_ref: "market.json" },
  goals: { ninety: "100 users" },
  kpi_table: "k", channels_ranked: "ch", content_plan: "cp", flows: "fl", later_list: "la",
  checklist: "check", tool_manifest_yaml: "project: app", hubs_in_use: "zapier", backlog_yaml: "[]",
  owner: { tz: "UTC", contact: "owner@example.com" },
  budget: { cap: "50", paid: "off" },
  preapproved: "none", never: "spend", playbooks_included: "channels",
};

describe("ComposeInputSchema (SPEC 6.12)", () => {
  it("accepts every prompt.template.md placeholder group", () => {
    expect(ComposeInputSchema.parse(validCompose).project.name).toBe("App");
    expect(JSON.stringify(ComposeInputJsonSchema)).toContain("tool_manifest_yaml");
  });
  it("rejects missing placeholders and unknown keys", () => {
    const { never: _n, ...missing } = validCompose;
    expect(ComposeInputSchema.safeParse(missing).success).toBe(false);
    const { donotsay: _d, ...badBrief } = validCompose.brief;
    expect(ComposeInputSchema.safeParse({ ...validCompose, brief: badBrief }).success).toBe(false);
    expect(ComposeInputSchema.safeParse({ ...validCompose, bogus: "x" }).success).toBe(false);
    expect(ComposeInputSchema.safeParse({ ...validCompose, plan: { version: 1 } }).success).toBe(false);
  });
});

describe("ChannelMapSchema (SPEC 6.13)", () => {
  const map = { directories: { file: "channels.md", heading: "Directories and listings" }, social: { file: "channels.md", heading: "Social", description: "Social posts" } };
  it("accepts channel id to file+heading entries", () => {
    expect(ChannelMapSchema.parse(map)["directories"]?.heading).toContain("Directories");
    expect(JSON.stringify(ChannelMapJsonSchema)).toContain("heading");
  });
  it("rejects empty map and entries missing file or heading", () => {
    expect(ChannelMapSchema.safeParse({}).success).toBe(false);
    expect(ChannelMapSchema.safeParse({ x: { file: "channels.md" } }).success).toBe(false);
    expect(ChannelMapSchema.safeParse({ x: { heading: "Social" } }).success).toBe(false);
  });
  it("findMissingChannelIds reports dangling archetype channels", () => {
    expect(findMissingChannelIds(["directories", "paid"], ChannelMapSchema.parse(map))).toEqual(["paid"]);
  });
});

describe("budget error reconciliation and barrel exports", () => {
  it("budget BudgetExceededError is the canonical exit-codes class", () => {
    expect(BudgetFromBudget).toBe(BudgetFromExitCodes);
    const err = new BudgetFromBudget(3.5, 3);
    expect(err).toBeInstanceOf(BudgetFromExitCodes);
    expect(err.spent).toBe(3.5);
    expect(err.cap).toBe(3);
    expect(resolveExitCode(err)).toBe(7);
    expect(new BudgetFromBudget("budget").message).toBe("budget");
  });
  it("root barrel exports schemas and llm without ambiguity", () => {
    expect(core.TaskSchema).toBe(TaskSchema);
    expect(core.ManifestSchema).toBe(ManifestSchema);
    expect(core.BudgetExceededError).toBe(BudgetFromExitCodes);
    expect(core.FakeLLM).toBeDefined();
    expect(core.ExitCode.BudgetExceeded).toBe(7);
  });
});
