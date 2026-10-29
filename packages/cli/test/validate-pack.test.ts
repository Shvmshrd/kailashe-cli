import { describe, it, expect, vi, afterEach } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack } from "../src/validate-pack.js";
import { runValidatePack } from "../src/commands/validate-pack.js";
import { parse } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const realPack = path.resolve(here, "../../../skill/kailashe-operator");

const goodConnectors = { version: 1, capabilities: { "code.pr": {} } };

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  delete process.env.CI;
});

describe("validatePack", () => {
  it("passes on the real pack (channel-map check is real, no TODO warning)", () => {
    const result = validatePack({ packDir: realPack });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(result.issues.some((i) => i.code === "channel-map-todo")).toBe(false);
    expect(result.issues.some((i) => i.code === "dangling-channel-id")).toBe(false);
  });

  it("hard-fails on dangling channel id (string form)", () => {
    const result = validatePack({
      fixtures: {
        archetypes: {
          archetypes: [
            { id: "x", name: "X", channels_ranked: ["directories", "not-a-channel"], flows: [] },
          ],
        },
        connectors: goodConnectors,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(6);
    expect(result.issues.some((i) => i.code === "dangling-channel-id" && i.level === "error" && i.message.includes("not-a-channel"))).toBe(true);
  });

  it("hard-fails on dangling channel id ({channel} form)", () => {
    const result = validatePack({
      fixtures: {
        archetypes: {
          archetypes: [
            { id: "x", name: "X", channels_ranked: [{ channel: "directories" }, { channel: "nope-channel" }], flows: [] },
          ],
        },
        connectors: goodConnectors,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "dangling-channel-id" && i.message.includes("nope-channel"))).toBe(true);
    expect(result.issues.filter((i) => i.code === "dangling-channel-id")).toHaveLength(1);
  });

  it("passes when every channels_ranked id is in the channel map", () => {
    const result = validatePack({
      fixtures: {
        archetypes: {
          archetypes: [
            { id: "x", name: "X", channels_ranked: ["directories", { channel: "communities" }], flows: [] },
          ],
        },
        connectors: goodConnectors,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.code === "dangling-channel-id")).toBe(false);
  });

  it("--lenient downgrades dangling channel ids to warnings", () => {
    const result = validatePack({
      lenient: true,
      fixtures: {
        archetypes: {
          archetypes: [
            { id: "x", name: "X", channels_ranked: ["not-a-channel"], flows: [] },
          ],
        },
        connectors: goodConnectors,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.code === "dangling-channel-id" && i.level === "warning")).toBe(true);
  });

  it("hard-fails on unknown (dangling) flow id", () => {
    const result = validatePack({
      fixtures: {
        archetypes: {
          archetypes: [
            { id: "x", name: "X", channels_ranked: ["a"], flows: ["not-a-real-flow"] },
          ],
        },
        connectors: goodConnectors,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(6);
    expect(result.issues.some((i) => i.code === "dangling-flow-id" && i.level === "error")).toBe(true);
  });

  it("hard-fails on missing required field", () => {
    const result = validatePack({
      fixtures: {
        archetypes: { archetypes: [{ id: "x" }] },
        connectors: goodConnectors,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "missing-field" && i.level === "error")).toBe(true);
  });

  it("--lenient downgrades errors to warnings locally", () => {
    const result = validatePack({
      lenient: true,
      fixtures: {
        archetypes: { archetypes: [{ id: "x", flows: ["nope"] }] },
        connectors: goodConnectors,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.issues.some((i) => i.code === "dangling-flow-id" && i.level === "warning")).toBe(true);
  });

  it("--lenient is never allowed in CI", () => {
    process.env.CI = "1";
    const result = validatePack({
      lenient: true,
      fixtures: { archetypes: { archetypes: [] }, connectors: goodConnectors },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "lenient-in-ci")).toBe(true);
  });

  it("CLI wrapper passes on the real pack and sets exit 0", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runValidatePack({ packDir: realPack })).toBe(0);
    expect(process.exitCode).toBe(0);
    process.exitCode = undefined;
    await parse(["node", "kailashe", "validate-pack", "--pack-dir", realPack]);
    expect(process.exitCode ?? 0).toBe(0);
  });
});
