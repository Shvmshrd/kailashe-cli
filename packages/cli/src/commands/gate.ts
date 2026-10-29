/**
 * `kailashe gate [prompt.md]` (S11, SPEC F3.3) — thin commander wiring over
 * the testable gate core in ../gate.ts.
 *
 * Interactive decisions come from @clack/prompts, but only when stdin is a
 * TTY; otherwise (piped / CI / tests without an injected prompt) the gate
 * reports "needs input" as exit 3 instead of blocking.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { isCancel, select } from "@clack/prompts";
import {
  createDefaultClipboardWriter,
  createDefaultEditorRunner,
  createDefaultUrlOpener,
  runGate,
  type ClipboardWriter,
  type EditorRunner,
  type GateDecision,
  type GatePromptFn,
  type UrlOpener,
} from "../gate.js";
import { ExitCode, resolveExitCode } from "../exit-codes.js";

export interface GateCommandDeps {
  clipboard?: ClipboardWriter;
  editor?: EditorRunner;
  openUrl?: UrlOpener;
  promptDecision?: GatePromptFn;
  /** Read the prompt file (tests); default reads from disk. */
  readFile?: (filePath: string) => string;
  cwd?: string;
}

interface GateFlags {
  yes?: boolean;
  json?: boolean;
  claudeUrl?: string;
}

function clackPromptDecision(): GatePromptFn {
  return async (): Promise<GateDecision | symbol> => {
    const value = await select<GateDecision>({
      message: "Execute this plan?",
      options: [
        { value: "execute", label: "Execute", hint: "copy prompt.md to the clipboard and open Muse" },
        { value: "edit", label: "Edit", hint: "open $EDITOR, then re-validate" },
        { value: "quit", label: "Quit", hint: "copy nothing" },
      ],
    });
    if (isCancel(value)) return value;
    return value;
  };
}

export function createGateCommand(deps: GateCommandDeps = {}): Command {
  const cmd = new Command("gate");
  cmd
    .description("review a composed prompt.md, then Execute / Edit / Quit")
    .argument("[file]", "prompt.md to gate", "prompt.md")
    .option("--yes", "non-interactive: execute without prompting")
    .option("--json", "emit a single JSON result object")
    .option("--claude-url <url>", "Muse URL to open on Execute (default: $KAILASHE_CLAUDE_URL or claude.ai)")
    .action(async (file: string, flags: GateFlags) => {
      const json = flags.json === true;
      const cwd = deps.cwd ?? process.cwd();
      const filePath = path.resolve(cwd, file);

      let content: string;
      try {
        content = deps.readFile ? deps.readFile(filePath) : readFileSync(filePath, "utf-8");
      } catch {
        const message = `gate: cannot read prompt file: ${filePath}`;
        if (json) console.log(JSON.stringify({ status: "error", error: message, exitCode: ExitCode.Validation }));
        else console.error(message);
        process.exitCode = ExitCode.Validation;
        return;
      }

      // Never block on stdin when there is no terminal to answer.
      const interactive = process.stdin.isTTY === true;
      const promptDecision: GatePromptFn | undefined =
        deps.promptDecision ?? (interactive && !flags.yes ? clackPromptDecision() : undefined);

      try {
        const result = await runGate({
          filePath,
          content,
          yes: flags.yes,
          json,
          claudeUrl: flags.claudeUrl,
          promptDecision,
          editor: deps.editor ?? createDefaultEditorRunner(),
          clipboard: deps.clipboard ?? createDefaultClipboardWriter(),
          openUrl: deps.openUrl ?? createDefaultUrlOpener(),
          output: (line) => console.log(line),
        });
        process.exitCode = result.exitCode;
        if (json) {
          console.log(
            JSON.stringify({
              status: result.status,
              exitCode: result.exitCode,
              filePath: result.filePath,
              claudeUrl: result.claudeUrl,
              summary: result.summary,
              checklist: result.checklist,
              clipboardMethod: result.clipboard?.method,
              edited: result.edited,
              warnings: result.warnings,
            }),
          );
        }
      } catch (err) {
        const code = resolveExitCode(err);
        const message = err instanceof Error ? err.message : String(err);
        if (json) {
          console.log(JSON.stringify({ status: "error", error: message, exitCode: code }));
        } else {
          console.error(message);
        }
        process.exitCode = code;
      }
    });
  cmd.exitOverride();
  return cmd;
}
