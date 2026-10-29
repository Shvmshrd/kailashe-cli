/**
 * `kailashe gate` — the S11 / SPEC F3.3 approval gate for a composed prompt.md.
 *
 * Pure-ish core: every side effect (decision prompt, $EDITOR, clipboard,
 * opening the Muse URL, re-reading the file after an edit) is injected, so
 * tests never block on stdin and never touch a real clipboard or editor.
 *
 * Rules enforced here:
 *  - Summary is at most 12 lines (SPEC F3.3 / TASKS S11).
 *  - A prompt is validated before it is shown, and re-validated after every
 *    Edit: required sections present, no secrets, no unfilled placeholders,
 *    within the size limit. Validation failures are exit 6.
 *  - Quit / denied / no usable input is exit 3; Execute is exit 0
 *    (SPEC §2.5, via exit-codes.ts).
 *  - The secret scan never echoes a matched value — findings carry only the
 *    pattern name, so secrets cannot leak into logs, stdout, or errors.
 *  - Subprocesses (editor, clipboard, URL opener) run as an args array with
 *    `shell: false`. Third-party / clipboard tools are never shell strings.
 */

import { spawn } from "node:child_process";
import { readFile as fsReadFile } from "node:fs/promises";
import { z } from "zod";
import {
  ExitCode,
  NeedsInputError,
  ValidationError,
  type ExitCode as ExitCodeValue,
} from "./exit-codes.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_CLAUDE_URL = "https://claude.ai/new";
export const CLAUDE_URL_ENV = "KAILASHE_CLAUDE_URL";

/** Hard size cap for a prompt.md handed to Muse (bytes, UTF-8). */
export const MAX_PROMPT_BYTES = 256 * 1024;

/** At most this many Edit round-trips per gate run. */
export const MAX_EDIT_LOOPS = 5;

/**
 * Sections a composed prompt.md must carry (heading substring match,
 * case-insensitive). Mirrors the prompt.template.md section titles.
 */
export const REQUIRED_SECTIONS = [
  "Start here",
  "Operating rules",
  "Brief",
  "Market intelligence",
  "Strategy",
  "Tools",
  "Backlog",
  "Autonomy, budget and approvals",
] as const;

// ---------------------------------------------------------------------------
// Zod boundary schemas (AGENTS.md: validate every external input with Zod)
// ---------------------------------------------------------------------------

export const gatePlanInputSchema = z.object({
  projectName: z.string().min(1).max(200).optional(),
  archetype: z.string().min(1).max(200).optional(),
  channels: z.array(z.string().min(1).max(200)).max(50).optional(),
  taskCount: z.number().int().nonnegative().optional(),
  unknowns: z
    .union([z.number().int().nonnegative(), z.array(z.string().max(500)).max(100)])
    .optional(),
  claudeUrl: z.string().url().optional(),
  checklist: z.array(z.string().min(1).max(500)).max(20).optional(),
});
export type GatePlanInput = z.infer<typeof gatePlanInputSchema>;

export const gateFileOptionsSchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
  yes: z.boolean().optional(),
  json: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface GateSummaryInput extends GatePlanInput {
  content: string;
  filePath: string;
}

function truncate(line: string, max = 140): string {
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function titleFromContent(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const m = /^#\s+(.+)$/.exec(line.trim());
    if (m?.[1]) return m[1].replace(/^Run my project:\s*/i, "").trim();
  }
  return undefined;
}

function headingCount(content: string): number {
  return content.split(/\r?\n/).filter((l) => /^#{1,6}\s+/.test(l.trim())).length;
}

function wordCount(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean);
  return content.trim() === "" ? 0 : words.length;
}

/**
 * Render the ≤12-line plan summary shown at the gate (SPEC F3.3).
 * Extra plan data is folded into existing lines, never extra lines.
 */
export function renderGateSummary(input: GateSummaryInput): string {
  const project = input.projectName ?? titleFromContent(input.content) ?? "this project";
  const lines: string[] = [];
  lines.push(truncate(`Plan ready: ${project}`));
  lines.push(
    truncate(
      `File: ${input.filePath} (${wordCount(input.content)} words, ${headingCount(input.content)} headings)`,
    ),
  );
  if (input.archetype) lines.push(truncate(`Archetype: ${input.archetype}`));
  if (input.channels && input.channels.length > 0) {
    lines.push(truncate(`Channels: ${input.channels.join(", ")}`));
  }
  if (typeof input.taskCount === "number") lines.push(`Backlog tasks: ${input.taskCount}`);
  const unknownCount = Array.isArray(input.unknowns)
    ? input.unknowns.length
    : (input.unknowns ?? 0);
  lines.push(
    unknownCount > 0
      ? `Unknowns: ${unknownCount} (listed in prompt.md)`
      : "Unknowns: none recorded",
  );
  lines.push(truncate(`Muse: ${input.claudeUrl ?? DEFAULT_CLAUDE_URL}`));
  lines.push("Review the file, then choose:");
  lines.push("Execute / Edit / Quit");
  return lines.slice(0, 12).join("\n");
}

// ---------------------------------------------------------------------------
// Validation (required sections, no secrets, size, placeholders)
// ---------------------------------------------------------------------------

interface SecretPattern {
  name: string;
  re: RegExp;
}

/** Simple fail-closed secret patterns. Match values are never reported. */
const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: "private-key-block", re: /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "stripe-key", re: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}\b/ },
  { name: "api-key-style", re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i },
  {
    name: "secret-assignment",
    re: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret|password|passwd)\s*[:=]\s*["']?[^\s"']{8,}["']?/i },
  {
    name: "env-secret-assignment",
    re: /\b[A-Z][A-Z0-9_]{2,}_(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*\S{8,}/,
  },
];

export interface GateValidationResult {
  ok: boolean;
  errors: string[];
}

/** Pattern names of secret-like matches. Never returns matched text. */
export function findSecretPatterns(content: string): string[] {
  const found: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(content) && !found.includes(name)) found.push(name);
  }
  return found;
}

export interface ValidatePromptOptions {
  maxBytes?: number;
  requiredSections?: readonly string[];
}

export function validatePromptContent(
  content: string,
  opts: ValidatePromptOptions = {},
): GateValidationResult {
  const errors: string[] = [];
  const maxBytes = opts.maxBytes ?? MAX_PROMPT_BYTES;
  const required = opts.requiredSections ?? REQUIRED_SECTIONS;

  if (content.trim() === "") {
    return { ok: false, errors: ["prompt is empty"] };
  }
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > maxBytes) {
    errors.push(`prompt is ${bytes} bytes, over the ${maxBytes}-byte limit`);
  }

  const headings = content
    .split(/\r?\n/)
    .map((l) => /^#{1,6}\s+(.+)$/.exec(l.trim())?.[1]?.toLowerCase())
    .filter((h): h is string => typeof h === "string");
  for (const section of required) {
    const needle = section.toLowerCase();
    if (!headings.some((h) => h.includes(needle))) {
      errors.push(`missing required section: ${section}`);
    }
  }

  for (const name of findSecretPatterns(content)) {
    errors.push(`possible secret detected (${name}); remove it before executing`);
  }

  const placeholders = content.match(/\{\{[^}]+\}\}/g);
  if (placeholders && placeholders.length > 0) {
    errors.push(`unfilled placeholder(s) remain: ${placeholders.length}`);
  }

  return { ok: errors.length === 0, errors };
}

function assertValid(content: string, opts: ValidatePromptOptions | undefined): GateValidationResult {
  const result = validatePromptContent(content, opts);
  if (!result.ok) {
    throw new ValidationError(`prompt.md failed validation: ${result.errors.join("; ")}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Clipboard: selection, OSC 52, default writer
// ---------------------------------------------------------------------------

export type ClipboardMethod = "pbcopy" | "clip" | "wl-copy" | "xclip" | "osc52";

export interface ClipboardCommand {
  command: string;
  args: string[];
}

export interface ClipboardResult {
  method: ClipboardMethod;
  command?: string;
  /** Set when method is "osc52": the escape sequence for the terminal. */
  osc52?: string;
}

/**
 * Pick the platform clipboard command, or null for the OSC 52 fallback
 * (headless Linux, or any platform over SSH — SPEC S11).
 */
export function selectClipboardCommand(
  platform: string,
  env: NodeJS.ProcessEnv,
): ClipboardCommand | null {
  if (env.SSH_CONNECTION || env.SSH_TTY) return null;
  if (platform === "darwin") return { command: "pbcopy", args: [] };
  if (platform === "win32") return { command: "clip", args: [] };
  if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
    if (env.WAYLAND_DISPLAY || env.XDG_SESSION_TYPE === "wayland") {
      return { command: "wl-copy", args: [] };
    }
    if (env.DISPLAY) return { command: "xclip", args: ["-selection", "clipboard"] };
    return null;
  }
  return null;
}

/** OSC 52 escape sequence that asks the terminal to set the clipboard. */
export function buildOsc52Sequence(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, "utf-8").toString("base64")}\x07`;
}

export type ClipboardWriter = (text: string) => Promise<ClipboardResult>;
export type ProcessRunner = (command: string, args: string[], input: string) => Promise<void>;

const execFileRunner: ProcessRunner = (command, args, input) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ["pipe", "ignore", "pipe"] });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });

function methodForCommand(command: string): ClipboardMethod {
  if (command === "pbcopy") return "pbcopy";
  if (command === "clip") return "clip";
  if (command === "wl-copy") return "wl-copy";
  return "xclip";
}

export function createDefaultClipboardWriter(deps: {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
} = {}): ClipboardWriter {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const runner = deps.runner ?? execFileRunner;
  return async (text: string): Promise<ClipboardResult> => {
    const selected = selectClipboardCommand(platform, env);
    if (!selected) return { method: "osc52", osc52: buildOsc52Sequence(text) };
    await runner(selected.command, selected.args, text);
    return { method: methodForCommand(selected.command), command: selected.command };
  };
}

// ---------------------------------------------------------------------------
// Editor: $EDITOR parsing + default runner
// ---------------------------------------------------------------------------

export type EditorRunner = (filePath: string) => Promise<void>;

/** Split an $EDITOR value into command + args without invoking a shell. */
export function parseEditorCommand(editorValue: string, filePath: string): ClipboardCommand {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let hasCurrent = false;
  for (const ch of editorValue.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasCurrent = true;
    } else if (/\s/.test(ch)) {
      if (hasCurrent || current.length > 0) {
        tokens.push(current);
        current = "";
        hasCurrent = false;
      }
    } else {
      current += ch;
    }
  }
  if (hasCurrent || current.length > 0) tokens.push(current);
  const command = tokens[0] ?? "";
  return { command, args: [...tokens.slice(1), filePath] };
}

export function resolveEditorValue(env: NodeJS.ProcessEnv, platform: string): string {
  const fromEnv = env.EDITOR?.trim() || env.VISUAL?.trim();
  if (fromEnv) return fromEnv;
  return platform === "win32" ? "notepad" : "vi";
}

export function createDefaultEditorRunner(deps: {
  platform?: string;
  env?: NodeJS.ProcessEnv;
} = {}): EditorRunner {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  return (filePath: string) =>
    new Promise<void>((resolve, reject) => {
      const { command, args } = parseEditorCommand(resolveEditorValue(env, platform), filePath);
      if (!command) {
        reject(new NeedsInputError("no editor configured (set $EDITOR)"));
        return;
      }
      const child = spawn(command, args, { stdio: "inherit", shell: false, windowsHide: false });
      child.on("error", (err) => reject(err));
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`editor exited with code ${code ?? "unknown"}`));
      });
    });
}

// ---------------------------------------------------------------------------
// URL opener (default) — args array, never a shell
// ---------------------------------------------------------------------------

export type UrlOpener = (url: string) => Promise<void>;

export function openerCommandFor(platform: string, url: string): ClipboardCommand {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

export function createDefaultUrlOpener(deps: { platform?: string } = {}): UrlOpener {
  const platform = deps.platform ?? process.platform;
  return async (url: string): Promise<void> => {
    const { command, args } = openerCommandFor(platform, url);
    await execFileRunner(command, args, "");
  };
}

// ---------------------------------------------------------------------------
// Readiness checklist
// ---------------------------------------------------------------------------

export function buildReadinessChecklist(input: {
  filePath: string;
  claudeUrl: string;
}): string[] {
  return [
    `Open Muse: ${input.claudeUrl}`,
    "Paste the prompt (already on your clipboard) as the first message.",
    `If paste fails, open and copy manually: ${input.filePath}`,
    "In Muse, confirm the tools check: working / missing but needed / optional.",
    "Confirm the Project HQ and scheduled tasks were created.",
    "Review approvals waiting before anything is published, sent, or spent.",
  ];
}

// ---------------------------------------------------------------------------
// The gate itself
// ---------------------------------------------------------------------------

export type GateDecision = "execute" | "edit" | "quit";

/** Injected decision prompt. Return a GateDecision, or anything else / a
 *  symbol (e.g. a clack cancel) to signal "no usable input" (exit 3). */
export type GatePromptFn = (
  summary: string,
) => Promise<GateDecision | string | symbol | null | undefined>;

export interface GateOptions extends GatePlanInput {
  filePath: string;
  content: string;
  /** Non-interactive: skip the prompt and Execute. */
  yes?: boolean;
  /** Suppress human output (the command emits one JSON object instead). */
  json?: boolean;
  env?: NodeJS.ProcessEnv;
  maxBytes?: number;
  requiredSections?: readonly string[];
  promptDecision?: GatePromptFn;
  editor?: EditorRunner;
  clipboard?: ClipboardWriter;
  readFile?: (filePath: string) => Promise<string>;
  openUrl?: UrlOpener;
  output?: (line: string) => void;
}

export interface GateResult {
  status: "executed" | "quit";
  decision: GateDecision;
  exitCode: ExitCodeValue;
  filePath: string;
  claudeUrl: string;
  summary: string;
  checklist: string[];
  clipboard?: ClipboardResult;
  edited: boolean;
  validation: GateValidationResult;
  /** Every line emitted (or that would be emitted when json is set). */
  output: string[];
  warnings: string[];
}

function normalizeDecision(raw: GateDecision | string | symbol | null | undefined): GateDecision {
  if (raw === "execute" || raw === "edit" || raw === "quit") return raw;
  throw new NeedsInputError("gate: no decision given (approval denied or input unavailable)");
}

function parsePlan(opts: GateOptions): GatePlanInput {
  const parsed = gatePlanInputSchema.safeParse({
    projectName: opts.projectName,
    archetype: opts.archetype,
    channels: opts.channels,
    taskCount: opts.taskCount,
    unknowns: opts.unknowns,
    claudeUrl: opts.claudeUrl,
    checklist: opts.checklist,
  });
  if (!parsed.success) throw new ValidationError("gate: invalid plan input");
  return parsed.data;
}

function resolveClaudeUrl(opts: GateOptions, plan: GatePlanInput): string {
  const envUrl = opts.env?.[CLAUDE_URL_ENV] ?? process.env[CLAUDE_URL_ENV];
  const candidate = plan.claudeUrl ?? (envUrl?.trim() ? envUrl.trim() : DEFAULT_CLAUDE_URL);
  if (!z.string().url().safeParse(candidate).success) {
    throw new ValidationError(`gate: configured Muse URL is not a valid URL (${CLAUDE_URL_ENV})`);
  }
  return candidate;
}

export async function runGate(rawOpts: GateOptions): Promise<GateResult> {
  const fileOpts = gateFileOptionsSchema.safeParse({
    filePath: rawOpts.filePath,
    content: rawOpts.content,
    yes: rawOpts.yes,
    json: rawOpts.json,
  });
  if (!fileOpts.success) throw new ValidationError("gate: a prompt file path and content are required");
  const plan = parsePlan(rawOpts);
  const claudeUrl = resolveClaudeUrl(rawOpts, plan);
  const validateOpts: ValidatePromptOptions = {
    maxBytes: rawOpts.maxBytes,
    requiredSections: rawOpts.requiredSections,
  };

  // Validate before the user is ever asked to approve anything.
  let validation = assertValid(rawOpts.content, validateOpts);
  let currentContent = rawOpts.content;

  const clipboard: ClipboardWriter =
    rawOpts.clipboard ?? createDefaultClipboardWriter({ env: rawOpts.env });
  const editor: EditorRunner = rawOpts.editor ?? createDefaultEditorRunner({ env: rawOpts.env });
  const readFile: (p: string) => Promise<string> =
    rawOpts.readFile ?? ((p: string) => fsReadFile(p, "utf-8"));

  const outputLines: string[] = [];
  const emit = (line: string): void => {
    outputLines.push(line);
    if (!rawOpts.json) rawOpts.output?.(line);
  };

  let edited = false;
  let editCount = 0;
  let summary = "";

  for (;;) {
    summary = renderGateSummary({
      ...plan,
      content: currentContent,
      filePath: rawOpts.filePath,
      claudeUrl,
    });
    for (const line of summary.split("\n")) emit(line);

    const decision: GateDecision = rawOpts.yes
      ? "execute"
      : normalizeDecision(
          rawOpts.promptDecision ? await rawOpts.promptDecision(summary) : undefined,
        );

    if (decision === "quit") {
      emit("Gate: quit. Nothing was copied to the clipboard.");
      return {
        status: "quit",
        decision,
        exitCode: ExitCode.NeedsInputOrDenied,
        filePath: rawOpts.filePath,
        claudeUrl,
        summary,
        checklist: [],
        edited,
        validation,
        output: outputLines,
        warnings: [],
      };
    }

    if (decision === "edit") {
      editCount += 1;
      if (editCount > MAX_EDIT_LOOPS) {
        throw new NeedsInputError(`gate: too many edits (max ${MAX_EDIT_LOOPS})`);
      }
      await editor(rawOpts.filePath);
      currentContent = await readFile(rawOpts.filePath);
      // Re-validate after every edit; this throws exit 6 on secrets,
      // missing sections, placeholders, or an oversized file.
      validation = assertValid(currentContent, validateOpts);
      edited = true;
      emit("Gate: edited prompt re-validated.");
      continue;
    }

    // decision === "execute"
    const clipboardResult = await clipboard(currentContent);
    if (clipboardResult.osc52) emit(clipboardResult.osc52);

    const warnings: string[] = [];
    if (rawOpts.openUrl) {
      try {
        await rawOpts.openUrl(claudeUrl);
      } catch {
        warnings.push(`could not open the Muse URL automatically; open it manually: ${claudeUrl}`);
      }
    }

    const checklist = plan.checklist ?? buildReadinessChecklist({ filePath: rawOpts.filePath, claudeUrl });
    emit(`Execute: copied prompt to clipboard (${clipboardResult.method}).`);
    emit(`File: ${rawOpts.filePath}`);
    emit(`Muse: ${claudeUrl}`);
    emit("Readiness checklist:");
    for (const item of checklist) emit(`[ ] ${item}`);
    for (const w of warnings) emit(`Warning: ${w}`);

    return {
      status: "executed",
      decision,
      exitCode: ExitCode.Ok,
      filePath: rawOpts.filePath,
      claudeUrl,
      summary,
      checklist,
      clipboard: clipboardResult,
      edited,
      validation,
      output: outputLines,
      warnings,
    };
  }
}
