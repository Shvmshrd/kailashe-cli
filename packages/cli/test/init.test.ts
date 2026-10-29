import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runInit } from "../src/init.js";
import { parse } from "../src/index.js";

let roots: string[] = [];

function tmp(prefix: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(d);
  return d;
}

function makePack(): string {
  const pack = tmp("kailashe-pack-");
  mkdirSync(path.join(pack, "assets"), { recursive: true });
  mkdirSync(path.join(pack, "references"), { recursive: true });
  writeFileSync(path.join(pack, "SKILL.md"), "# Skill\nhello\n");
  writeFileSync(path.join(pack, "assets/archetypes.yaml"), "version: 1\narchetypes: []\n");
  writeFileSync(path.join(pack, "references/tool-hubs.md"), "# hubs\n");
  return pack;
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else out.push(path.relative(dir, f));
    }
  };
  walk(dir);
  return out;
}

beforeEach(() => { roots = []; process.exitCode = undefined; });
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  roots = [];
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("kailashe init", () => {
  it("installs pack to both .agents and .claude and creates AGENTS.md pointer", () => {
    const pack = makePack();
    const target = tmp("kailashe-target-");
    const result = runInit({ targetDir: target, sourceDir: pack });
    expect(result.written).toContain(".agents/skills/kailashe-operator/SKILL.md");
    expect(result.written).toContain(".claude/skills/kailashe-operator/SKILL.md");
    expect(readFileSync(path.join(target, ".agents/skills/kailashe-operator/SKILL.md"), "utf-8")).toContain("hello");
    expect(readFileSync(path.join(target, ".claude/skills/kailashe-operator/SKILL.md"), "utf-8")).toContain("hello");
    const agents = readFileSync(path.join(target, "AGENTS.md"), "utf-8");
    expect(agents).toContain(".agents/skills/kailashe-operator/SKILL.md");
  });

  it("--dry-run prints intended writes and writes nothing", () => {
    const pack = makePack();
    const target = tmp("kailashe-target-");
    const lines: string[] = [];
    const result = runInit({ targetDir: target, sourceDir: pack, dryRun: true }, (l) => lines.push(l));
    expect(result.dryRun).toBe(true);
    expect(result.written.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("would write");
    expect(lines.join("\n")).toContain(".agents/skills/kailashe-operator/SKILL.md");
    expect(listFiles(target)).toEqual([]);
    expect(existsSync(path.join(target, "AGENTS.md"))).toBe(false);
  });

  it("second run is idempotent (no changes)", () => {
    const pack = makePack();
    const target = tmp("kailashe-target-");
    runInit({ targetDir: target, sourceDir: pack });
    const before = listFiles(target).map((f) => [f, readFileSync(path.join(target, f), "utf-8")] as const);
    const second = runInit({ targetDir: target, sourceDir: pack });
    expect(second.written).toEqual([]);
    expect(second.skipped).toEqual([]);
    expect(second.unchanged.length).toBeGreaterThan(0);
    const after = listFiles(target).map((f) => [f, readFileSync(path.join(target, f), "utf-8")] as const);
    expect(after).toEqual(before);
  });

  it("never overwrites user edits without --force, overwrites with --force", () => {
    const pack = makePack();
    const target = tmp("kailashe-target-");
    runInit({ targetDir: target, sourceDir: pack });
    const edited = path.join(target, ".agents/skills/kailashe-operator/SKILL.md");
    writeFileSync(edited, "my user edit\n");

    const noForce = runInit({ targetDir: target, sourceDir: pack });
    expect(noForce.skipped).toContain(".agents/skills/kailashe-operator/SKILL.md");
    expect(readFileSync(edited, "utf-8")).toBe("my user edit\n");
    // The untouched mirror remains unchanged, not rewritten.
    expect(noForce.written).toEqual([]);

    const forced = runInit({ targetDir: target, sourceDir: pack, force: true });
    expect(forced.written).toContain(".agents/skills/kailashe-operator/SKILL.md");
    expect(readFileSync(edited, "utf-8")).toContain("hello");
  });

  it("appends pointer to an existing AGENTS.md without overwriting its content", () => {
    const pack = makePack();
    const target = tmp("kailashe-target-");
    writeFileSync(path.join(target, "AGENTS.md"), "# My project\ncustom rules\n");
    runInit({ targetDir: target, sourceDir: pack });
    const agents = readFileSync(path.join(target, "AGENTS.md"), "utf-8");
    expect(agents).toContain("custom rules");
    expect(agents).toContain(".agents/skills/kailashe-operator/SKILL.md");
    // And a second run does not duplicate the pointer.
    runInit({ targetDir: target, sourceDir: pack });
    const again = readFileSync(path.join(target, "AGENTS.md"), "utf-8");
    expect(again).toBe(agents);
  });

  it("CLI init --dry-run writes nothing; CLI init installs (real pack discovery)", async () => {
    const target = tmp("kailashe-target-");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(target);
    try {
      await parse(["node", "kailashe", "init", "--dry-run"]);
      expect(process.exitCode ?? 0).toBe(0);
      expect(listFiles(target)).toEqual([]);

      await parse(["node", "kailashe", "init"]);
      expect(existsSync(path.join(target, ".agents/skills/kailashe-operator/SKILL.md"))).toBe(true);
      expect(existsSync(path.join(target, ".claude/skills/kailashe-operator/SKILL.md"))).toBe(true);
      expect(readFileSync(path.join(target, "AGENTS.md"), "utf-8")).toContain("kailashe-operator");
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
