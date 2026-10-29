/**
 * Append-only audit log writer — .kailashe/audit.jsonl (redacted).
 * SPEC §4.2, §5.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RiskClass } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * One entry in the audit log. All string fields are already redacted
 * before being passed here (runner does the redaction).
 */
export interface AuditEntry {
  /** ISO-8601 timestamp (UTC). */
  readonly timestamp: string;
  /** Binary name, e.g. "aws". */
  readonly binary: string;
  /** Args array (redacted). */
  readonly args: readonly string[];
  /** Resolved absolute path to the binary. */
  readonly resolvedPath: string;
  /** CLI version string, if available. */
  readonly version?: string;
  /** Risk class of the command. */
  readonly riskClass: RiskClass;
  /** Process exit code. */
  readonly exitCode: number;
  /** Wall-clock duration (ms). */
  readonly durationMs: number;
  /** Working directory. */
  readonly cwd?: string;
  /** True if the process timed out. */
  readonly timedOut?: boolean;
  /** True if output was truncated. */
  readonly truncated?: boolean;
  /** Human-readable redacted command string. */
  readonly command: string;
}

// ── Path helpers ──────────────────────────────────────────────────────────

/**
 * Default audit log path: <projectRoot>/.kailashe/audit.jsonl
 */
export function getAuditLogPath(projectRoot: string): string {
  return path.join(projectRoot, ".kailashe", "audit.jsonl");
}

// ── Writer ────────────────────────────────────────────────────────────────

/**
 * Append a single audit entry as a JSON line to the audit log.
 *
 * - Creates the .kailashe directory if it does not exist.
 * - Never truncates or overwrites — append-only.
 * - Failures to write the audit log are swallowed (logged to stderr) so
 *   they never break the main command flow.
 *
 * @param entry - redacted audit entry
 * @param auditLogPath - absolute path to the jsonl file (resolved by caller)
 */
export async function appendAuditLog(
  entry: AuditEntry,
  auditLogPath: string,
): Promise<void> {
  const line = JSON.stringify(entry) + "\n";
  try {
    const dir = path.dirname(auditLogPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.appendFile(auditLogPath, line, "utf-8");
  } catch (err) {
    // Audit write failure must not crash the runner — warn on stderr.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[audit] failed to append to ${auditLogPath}: ${msg}\n`);
  }
}

/**
 * Synchronous variant for use in signal handlers / cleanup where async
 * is not possible. Uses appendFileSync.
 */
export function appendAuditLogSync(
  entry: AuditEntry,
  auditLogPath: string,
): void {
  const line = JSON.stringify(entry) + "\n";
  try {
    const dir = path.dirname(auditLogPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(auditLogPath, line, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[audit] failed to append to ${auditLogPath}: ${msg}\n`);
  }
}

/**
 * Format an entry as a single JSONL line (without writing).
 * Useful for testing.
 */
export function formatAuditEntry(entry: AuditEntry): string {
  return JSON.stringify(entry);
}

/**
 * Parse a JSONL file into entries. Useful for verifying audit contents in tests.
 */
export function parseAuditLog(content: string): AuditEntry[] {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  return lines.map((l) => JSON.parse(l) as AuditEntry);
}
