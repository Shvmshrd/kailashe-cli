import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildOsc52Sequence,
  buildReadinessChecklist,
  createDefaultClipboardWriter,
  MAX_PROMPT_BYTES,
  parseEditorCommand,
  renderGateSummary,
  runGate,
  selectClipboardCommand,
  validatePromptContent,
  type ClipboardResult,
  type GateDecision,
} from "../src/gate.js";
import { createGateCommand } from "../src/commands/gate.js";
import { ExitCode, resolveExitCode } from "../src/exit-codes.js";

const VALID = `# Run my project: Demo

## Start here
Begin.

## 1. Operating rules
Rules.

## 2. Brief
What it is.

## 3. Market intelligence
Market.

## 4. Strategy and flow
Strategy.

## 5. Tools: setup checklist and routes
Tools.

## 6. Project HQ
HQ.

## 7. Backlog
Tasks.

## 8. Scheduled tasks to create
Schedule.

## 9. Playbooks
Playbooks.

## 10. Weekly report format
Report.

## 11. Autonomy, budget and approvals for this project
Budget and approvals.
`;

const SECRET = "AKIA1234567890ABCDEF";

let roots: string[] = [];
function tmpFile(content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kailashe-gate-"));
  roots.push(dir);
  const file = path.join(dir, "prompt.md");
  writeFileSync(file, content, "utf-8");
  return file;
}

beforeEach(() => {
  roots = [];
  process.exitCode = undefined;
});
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  roots = [];
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("renderGateSummary", () => {
  it("is <=12 lines and mentions project, file and the three decisions", () => {
    const summary = renderGateSummary({
      content: VALID,
      filePath: "/tmp/prompt.md",
      projectName: "Demo",
      archetype: "dev-tool",
      channels: ["seo", "directories"],
      taskCount: 12,
      unknowns: ["pricing"],
    });
    const lines = summary.split("\n");
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(summary).toContain("Demo");
    expect(summary).toContain("/tmp/prompt.md");
    expect(summary).toContain("Execute / Edit / Quit");
  });

  it("stays <=12 lines even with many channels and unknowns", () => {
    const summary = renderGateSummary({
      content: VALID,
      filePath: "prompt.md",
      channels: Array.from({ length: 30 }, (_, i) => `channel-${i}`),
      unknowns: Array.from({ length: 30 }, (_, i) => `unknown-${i}`),
    });
    expect(summary.split("\n").length).toBeLessThanOrEqual(12);
  });
});

describe("validatePromptContent", () => {
  it("accepts a complete prompt", () => {
    expect(validatePromptContent(VALID).ok).toBe(true);
  });

  it("fails on a missing required section", () => {
    const broken = VALID.replace("## 2. Brief\nWhat it is.\n", "");
    const result = validatePromptContent(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/brief/i);
  });

  it("fails on a secret without leaking the secret value", () => {
    const result = validatePromptContent(`${VALID}\nkey: ${SECRET}\n`);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).not.toContain(SECRET);
  });

  it("fails over the size limit", () => {
    const big = VALID + "x".repeat(MAX_PROMPT_BYTES);
    expect(validatePromptContent(big).ok).toBe(false);
  });

  it("fails on unfilled placeholders", () => {
    expect(validatePromptContent(`${VALID}\n{{project.name}}\n`).ok).toBe(false);
  });
});

describe("clipboard selection and OSC 52", () => {
  it("selects pbcopy / clip / wl-copy / xclip by platform and env", () => {
    expect(selectClipboardCommand("darwin", {})).toEqual({ command: "pbcopy", args: [] });
    expect(selectClipboardCommand("win32", {})).toEqual({ command: "clip", args: [] });
    expect(selectClipboardCommand("linux", { WAYLAND_DISPLAY: "wayland-1" })).toEqual({
      command: "wl-copy",
      args: [],
    });
    expect(selectClipboardCommand("linux", { DISPLAY: ":0" })).toEqual({
      command: "xclip",
      args: ["-selection", "clipboard"],
    });
  });

  it("falls back to OSC 52 on headless Linux and over SSH", () => {
    expect(selectClipboardCommand("linux", {})).toBeNull();
    expect(selectClipboardCommand("darwin", { SSH_CONNECTION: "1 2 3 4" })).toBeNull();
  });

  it("builds an OSC 52 sequence carrying the base64 payload", () => {
    const seq = buildOsc52Sequence("hello gate");
    expect(seq.startsWith("\x1b]52;c;")).toBe(true);
    expect(seq.endsWith("\x07")).toBe(true);
    const payload = seq.slice("\x1b]52;c;".length, -1);
    expect(Buffer.from(payload, "base64").toString("utf-8")).toBe("hello gate");
  });

  it("default clipboard writer runs the selected command once with the text as input", async () => {
    const runner = vi.fn(async () => undefined);
    const writer = createDefaultClipboardWriter({ platform: "darwin", env: {}, runner });
    const result = await writer("copied text");
    expect(result.method).toBe("pbcopy");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("pbcopy", [], "copied text");
  });

  it("default clipboard writer returns OSC 52 when no command applies", async () => {
    const runner = vi.fn(async () => undefined);
    const writer = createDefaultClipboardWriter({ platform: "linux", env: {}, runner });
    const result = await writer("ssh text");
    expect(result.method).toBe("osc52");
    expect(result.osc52).toBe(buildOsc52Sequence("ssh text"));
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("editor command parsing", () => {
  it("parses $EDITOR with args as an args array (no shell)", () => {
    expect(parseEditorCommand("code --wait", "/tmp/prompt.md")).toEqual({
      command: "code",
      args: ["--wait", "/tmp/prompt.md"],
    });
    expect(parseEditorCommand('"my editor" --flag', "f.md")).toEqual({
      command: "my editor",
      args: ["--flag", "f.md"],
    });
  });
});

describe("runGate", () => {
  function clipboardSpy(): { fn: (t: string) => Promise<ClipboardResult>; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      fn: async (t: string) => {
        calls.push(t);
        return { method: "pbcopy", command: "pbcopy" };
      },
    };
  }

  it("--yes executes: clipboard once, opener called, checklist printed", async () => {
    const clip = clipboardSpy();
    const opener = vi.fn(async () => undefined);
    const lines: string[] = [];
    const result = await runGate({
      filePath: "/tmp/prompt.md",
      content: VALID,
      yes: true,
      clipboard: clip.fn,
      openUrl: opener,
      output: (l) => lines.push(l),
    });
    expect(result.status).toBe("executed");
    expect(result.exitCode).toBe(ExitCode.Ok);
    expect(clip.calls).toEqual([VALID]);
    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener).toHaveBeenCalledWith(result.claudeUrl);
    expect(result.filePath).toBe("/tmp/prompt.md");
    expect(result.claudeUrl).toContain("https://");
    expect(result.checklist.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain("Readiness checklist");
    expect(lines.join("\n")).toContain("/tmp/prompt.md");
    // Summary printed before executing is within the line budget itself.
    expect(result.summary.split("\n").length).toBeLessThanOrEqual(12);
  });

  it("quit returns exit 3 and never touches the clipboard", async () => {
    const clip = clipboardSpy();
    const result = await runGate({
      filePath: "/tmp/prompt.md",
      content: VALID,
      promptDecision: async () => "quit" as GateDecision,
      clipboard: clip.fn,
    });
    expect(result.status).toBe("quit");
    expect(result.exitCode).toBe(ExitCode.NeedsInputOrDenied);
    expect(result.exitCode).toBe(3);
    expect(clip.calls).toEqual([]);
  });

  it("no input (no --yes, no prompt) rejects with exit 3", async () => {
    const clip = clipboardSpy();
    await expect(
      runGate({ filePath: "/tmp/prompt.md", content: VALID, clipboard: clip.fn }),
    ).rejects.toMatchObject({ exitCode: 3 });
    expect(clip.calls).toEqual([]);
  });

  it("a cancelled prompt rejects with exit 3", async () => {
    const err: unknown = await runGate({
      filePath: "/tmp/prompt.md",
      content: VALID,
      promptDecision: async () => Symbol("cancel"),
      clipboard: clipboardSpy().fn,
    }).catch((e: unknown) => e);
    expect(resolveExitCode(err)).toBe(3);
  });

  it("edit re-reads, re-validates and then executes the edited content", async () => {
    const clip = clipboardSpy();
    const edited = VALID.replace("What it is.", "What it is, edited.");
    const editor = vi.fn(async () => undefined);
    const decisions: GateDecision[] = ["edit", "execute"];
    const result = await runGate({
      filePath: "/tmp/prompt.md",
      content: VALID,
      promptDecision: async () => decisions.shift() ?? "quit",
      editor,
      readFile: async () => edited,
      clipboard: clip.fn,
    });
    expect(editor).toHaveBeenCalledTimes(1);
    expect(editor).toHaveBeenCalledWith("/tmp/prompt.md");
    expect(result.edited).toBe(true);
    expect(result.status).toBe("executed");
    expect(clip.calls).toEqual([edited]);
  });

  it("edit that introduces a secret fails validation (exit 6), clipboard untouched, no leak", async () => {
    const clip = clipboardSpy();
    const err: unknown = await runGate({
      filePath: "/tmp/prompt.md",
      content: VALID,
      promptDecision: async () => "edit",
      editor: async () => undefined,
      readFile: async () => `${VALID}\napi_key = ${SECRET}\n`,
      clipboard: clip.fn,
    }).catch((e: unknown) => e);
    expect(resolveExitCode(err)).toBe(ExitCode.Validation);
    expect(resolveExitCode(err)).toBe(6);
    expect(err instanceof Error ? err.message : "").not.toContain(SECRET);
    expect(clip.calls).toEqual([]);
  });

  it("edit that removes a required section fails validation (exit 6)", async () => {
    const clip = clipboardSpy();
    const err: unknown = await runGate({
      filePath: "/tmp/prompt.md",
      content: VALID,
      promptDecision: async () => "edit",
      editor: async () => undefined,
      readFile: async () => VALID.replace("## 2. Brief\nWhat it is.\n", ""),
      clipboard: clip.fn,
    }).catch((e: unknown) => e);
    expect(resolveExitCode(err)).toBe(6);
    expect(clip.calls).toEqual([]);
  });

  it("initial secret content fails validation (exit 6) before any prompt or clipboard", async () => {
    const clip = clipboardSpy();
    const prompt = vi.fn(async () => "execute" as GateDecision);
    const err: unknown = await runGate({
      filePath: "/tmp/prompt.md",
      content: `${VALID}\ntoken: ${SECRET}\n`,
      promptDecision: prompt,
      clipboard: clip.fn,
    }).catch((e: unknown) => e);
    expect(resolveExitCode(err)).toBe(6);
    expect(prompt).not.toHaveBeenCalled();
    expect(clip.calls).toEqual([]);
  });
});

describe("readiness checklist", () => {
  it("mentions the Muse URL, paste step and the file path", () => {
    const list = buildReadinessChecklist({ filePath: "/tmp/prompt.md", claudeUrl: "https://claude.ai/new" });
    const text = list.join("\n");
    expect(text).toContain("https://claude.ai/new");
    expect(text).toContain("/tmp/prompt.md");
    expect(text).toMatch(/paste/i);
  });
});

describe("gate command wiring", () => {
  it("--yes executes through injected clipboard and sets exit 0", async () => {
    const file = tmpFile(VALID);
    const clip = vi.fn(async (): Promise<ClipboardResult> => ({ method: "clip", command: "clip" }));
    const opener = vi.fn(async () => undefined);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cmd = createGateCommand({ clipboard: clip, openUrl: opener });
    await cmd.parseAsync([file, "--yes"], { from: "user" });
    expect(process.exitCode ?? 0).toBe(0);
    expect(clip).toHaveBeenCalledTimes(1);
    expect(opener).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain("Readiness checklist");
  });

  it("--json --yes emits one JSON object with file path, Muse URL and checklist", async () => {
    const file = tmpFile(VALID);
    const clip = vi.fn(async (): Promise<ClipboardResult> => ({ method: "pbcopy", command: "pbcopy" }));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cmd = createGateCommand({ clipboard: clip, openUrl: async () => undefined });
    await cmd.parseAsync([file, "--yes", "--json"], { from: "user" });
    expect(process.exitCode ?? 0).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      status: string;
      filePath: string;
      claudeUrl: string;
      checklist: string[];
    };
    expect(parsed.status).toBe("executed");
    expect(parsed.filePath).toBe(file);
    expect(parsed.claudeUrl).toContain("https://");
    expect(parsed.checklist.length).toBeGreaterThan(0);
    expect(clip).toHaveBeenCalledTimes(1);
  });

  it("quit via prompt sets exit 3", async () => {
    const file = tmpFile(VALID);
    const clip = vi.fn(async (): Promise<ClipboardResult> => ({ method: "pbcopy" }));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cmd = createGateCommand({
      clipboard: clip,
      promptDecision: async () => "quit",
      openUrl: async () => undefined,
    });
    await cmd.parseAsync([file], { from: "user" });
    expect(process.exitCode).toBe(3);
    expect(clip).not.toHaveBeenCalled();
  });

  it("--json with a secret in the file exits 6 and does not leak the secret", async () => {
    const file = tmpFile(`${VALID}\napi_key = ${SECRET}\n`);
    const clip = vi.fn(async (): Promise<ClipboardResult> => ({ method: "pbcopy" }));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cmd = createGateCommand({ clipboard: clip, openUrl: async () => undefined });
    await cmd.parseAsync([file, "--yes", "--json"], { from: "user" });
    expect(process.exitCode).toBe(6);
    expect(clip).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain(SECRET);
  });
});
