import { describe, it, expect } from "vitest";
import {
  ARCHETYPES,
  allArchetypeIds,
  assertChannelMapValid,
  assertManifestValid,
  buildChecklist,
  buildManifest,
  generateBacklog,
  planSync,
  priorityScore,
  selectArchetype,
  sortByPriority,
  validateChannelMap,
  validateManifest,
  DEFAULT_REGISTRY,
  type Task,
} from "../src/index.js";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "T-001",
    title: "task",
    goal: "goal",
    channel: "communities",
    route: "muse:github",
    approval: "A",
    inputs: [],
    steps: [],
    success_check: "ok",
    kpi: "signups",
    impact: 3,
    confidence: 3,
    effort: 3,
    depends_on: [],
    status: "todo",
    evidence: [],
    notes: "",
    ...overrides,
  };
}

describe("archetype selection", () => {
  it("user override wins over hints", async () => {
    const result = await selectArchetype(
      { appType: "api", keywords: ["CLI", "SDK"] },
      undefined,
      undefined,
      "ecommerce",
    );
    expect(result.id).toBe("ecommerce");
    expect(result.reason).toContain("User override");
  });

  it("deterministic hints select dev-tool for CLI/SDK projects", async () => {
    const result = await selectArchetype({
      keywords: ["CLI or SDK or API", "README-led repo", "docs site"],
    });
    expect(result.id).toBe("dev-tool");
    expect(result.reason).toMatch(/Detection hints matched/);
  });

  it("empty hints default to free-utility", async () => {
    const result = await selectArchetype({});
    expect(result.id).toBe("free-utility");
  });

  it("exposes all 9 archetypes", () => {
    expect(allArchetypeIds()).toHaveLength(9);
    expect(ARCHETYPES).toHaveLength(9);
  });
});

describe("channel-map validation", () => {
  it("all built-in archetype channels exist in CHANNEL_MAP", () => {
    const input = ARCHETYPES.map((a) => ({
      archetypeId: a.id,
      channels: [...a.channels_ranked],
    }));
    expect(validateChannelMap(input)).toEqual([]);
    expect(() => assertChannelMapValid(input)).not.toThrow();
  });

  it("dangling channel fails validation and assertion", () => {
    const input = [{ archetypeId: "dev-tool", channels: ["no-such-channel"] }];
    const issues = validateChannelMap(input);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.channelId).toBe("no-such-channel");
    expect(() => assertChannelMapValid(input)).toThrow(/no-such-channel/);
  });
});

describe("manifest capability registry", () => {
  it("built manifest only contains capability ids present in the registry", () => {
    for (const id of allArchetypeIds()) {
      const manifest = buildManifest({ project: "demo", archetypeId: id });
      expect(manifest.capabilities.length).toBeGreaterThan(0);
      expect(validateManifest(manifest, DEFAULT_REGISTRY)).toEqual({ valid: true });
      for (const cap of manifest.capabilities) {
        expect(DEFAULT_REGISTRY.capabilities[cap.id]).toBeDefined();
      }
    }
  });

  it("dangling capability id fails validation and assertion", () => {
    const manifest = buildManifest({ project: "demo", archetypeId: "dev-tool" });
    const bad = {
      ...manifest,
      capabilities: [
        ...manifest.capabilities,
        { id: "bogus.capability", route: "unknown", allowed: ["read"], class: "A" },
      ],
    };
    const result = validateManifest(bad, DEFAULT_REGISTRY);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.unknownIds).toEqual(["bogus.capability"]);
    expect(() => assertManifestValid(bad, DEFAULT_REGISTRY)).toThrow(/bogus\.capability/);
  });
});

describe("backlog priority", () => {
  it("priorityScore is (impact * confidence) / effort", () => {
    expect(priorityScore({ impact: 5, confidence: 4, effort: 2 })).toBe(10);
    expect(priorityScore({ impact: 3, confidence: 3, effort: 3 })).toBe(3);
    expect(priorityScore({ impact: 1, confidence: 1, effort: 5 })).toBeCloseTo(0.2);
  });

  it("priorityScore applies unlock bonus and overdue penalty", () => {
    const task = { impact: 4, confidence: 4, effort: 2 }; // 8
    expect(priorityScore(task, { unlocksCount: 3 })).toBe(10);
    expect(priorityScore(task, { unlocksCount: 2 })).toBe(8);
    expect(priorityScore(task, { approvalOverdue: true })).toBe(6);
  });

  it("sortByPriority orders highest score first, stably", () => {
    const low = makeTask({ id: "T-001", impact: 1, confidence: 1, effort: 5 });
    const high = makeTask({ id: "T-002", impact: 5, confidence: 5, effort: 1 });
    const mid = makeTask({ id: "T-003", impact: 3, confidence: 3, effort: 3 });
    const sorted = sortByPriority([low, high, mid]);
    expect(sorted.map((t) => t.id)).toEqual(["T-002", "T-003", "T-001"]);
    // input not mutated in order
    expect([low, high, mid].map((t) => t.id)).toEqual(["T-001", "T-002", "T-003"]);
  });

  it("sortByPriority boosts tasks unlocking 3+ others", () => {
    const unlocker = makeTask({ id: "T-001", impact: 2, confidence: 2, effort: 2 }); // 2, +2 = 4
    const plain = makeTask({ id: "T-005", impact: 3, confidence: 3, effort: 3 }); // 3
    const dependents = ["T-002", "T-003", "T-004"].map((id) =>
      makeTask({ id, impact: 1, confidence: 1, effort: 5, depends_on: ["T-001"] }),
    );
    const sorted = sortByPriority([plain, unlocker, ...dependents]);
    expect(sorted[0]?.id).toBe("T-001");
  });

  it("generateBacklog emits sequential ids and todo tasks", () => {
    const backlog = generateBacklog({ archetypeId: "dev-tool" });
    expect(backlog.length).toBeGreaterThan(0);
    expect(backlog[0]?.id).toBe("T-001");
    backlog.forEach((t, i) => {
      expect(t.id).toBe(`T-${String(i + 1).padStart(3, "0")}`);
      expect(t.status).toBe("todo");
      expect(t.effort).toBeGreaterThan(0);
    });
    expect(() => generateBacklog({ archetypeId: "nope" })).toThrow(/Unknown archetype/);
  });
});

describe("checklist generation", () => {
  it("generates numbered steps mentioning connectors for a real manifest", () => {
    const manifest = buildManifest({ project: "demo", archetypeId: "dev-tool" });
    const checklist = buildChecklist({ manifest });
    const lines = checklist.split("\n");
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((line, i) => {
      expect(line).toMatch(new RegExp(`^${i + 1}\\. `));
    });
    expect(checklist).toMatch(/Connect in Muse Settings, Connectors:/);
  });

  it("empty manifest yields the no-connectors step", () => {
    const checklist = buildChecklist({
      manifest: {
        project: "demo",
        budget: { monthly_cap_usd: 0, per_action_cap_usd: 0 },
        capabilities: [],
      },
    });
    expect(checklist).toMatch(/^1\. No additional connectors needed/);
  });

  it("includes budget step only when a cap is set", () => {
    const manifest = buildManifest({
      project: "demo",
      archetypeId: "dev-tool",
      monthlyCapUsd: 25,
      perActionCapUsd: 2,
    });
    expect(buildChecklist({ manifest })).toContain("monthly cap $25.00");
  });
});

describe("planSync orchestrator (snapshot-style, all archetypes)", () => {
  it("produces a coherent plan for each of the 9 archetypes", () => {
    for (const id of allArchetypeIds()) {
      const result = planSync({ profile: {}, archetypeOverride: id, projectSlug: "demo" });
      expect(result.archetype.id).toBe(id);
      expect(result.plan.archetype).toBe(id);
      expect(result.plan.channelsRanked.length).toBeGreaterThan(0);
      expect(result.backlog.length).toBeGreaterThan(0);
      expect(validateManifest(result.manifest, DEFAULT_REGISTRY)).toEqual({ valid: true });
      expect(result.checklist).toMatch(/^1\. /);
      // every ranked channel must exist in the channel map
      expect(
        validateChannelMap([
          { archetypeId: id, channels: result.plan.channelsRanked.map((c) => c.channel) },
        ]),
      ).toEqual([]);
    }
  });

  it("planSync requires a valid override", () => {
    expect(() => planSync({ profile: {} })).toThrow(/planSync requires/);
  });
});
