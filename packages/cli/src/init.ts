/**
 * `kailashe init` (S1) — install the skill pack into a target project.
 *
 * Installs skill/kailashe-operator/ to both
 *   .agents/skills/kailashe-operator/  and  .claude/skills/kailashe-operator/
 * and adds a short pointer to AGENTS.md (creating it if missing).
 *
 * Rules:
 *  - --dry-run prints every intended write and writes nothing.
 *  - Hash-diff: a destination file whose content differs from the pack is
 *    treated as user-edited and is never overwritten without --force.
 *  - Idempotent: a second run reports everything unchanged and writes nothing.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { z } from "zod";

export const AGENTS_POINTER_MARKER = ".agents/skills/kailashe-operator/SKILL.md";
export const AGENTS_POINTER = [
  "## Kailashe operator",
  "",
  "Use the Kailashe operator skill installed at `.agents/skills/kailashe-operator/`",
  "(mirrored to `.claude/skills/kailashe-operator/`). Read",
  "`.agents/skills/kailashe-operator/SKILL.md` before operating this project.",
  "",
].join("\n");

const DEST_ROOTS = [".agents/skills/kailashe-operator", ".claude/skills/kailashe-operator"] as const;

export const initOptionsSchema = z.object({
  targetDir: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  sourceDir: z.string().min(1).optional(),
  packDir: z.string().min(1).optional(),
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
});
export type InitOptions = z.infer<typeof initOptionsSchema>;

export interface InitResult {
  ok: boolean;
  dryRun: boolean;
  force: boolean;
  targetDir: string;
  sourceDir: string;
  /** Target-relative paths written (or that would be written in dry-run). */
  written: string[];
  unchanged: string[];
  /** Target-relative paths skipped because they differ (user edits) and --force was not given. */
  skipped: string[];
  /** Alias for skipped, for readability at call sites. */
  conflicts: string[];
  lines: string[];
}

function hash(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

export function findPackDir(explicit?: string, cwd: string = process.cwd()): string {
  if (explicit) {
    const resolved = path.resolve(cwd, explicit);
    if (!existsSync(resolved)) throw new Error(`Pack directory not found: ${resolved}`);
    return resolved;
  }
  const here = import.meta.dirname ?? ".";
  const candidates = [
    path.resolve(cwd, "skill/kailashe-operator"),
    path.resolve(here, "../../../skill/kailashe-operator"),
    path.resolve(here, "../../skill/kailashe-operator"),
    path.resolve(here, "../skill/kailashe-operator"),
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "SKILL.md")) || existsSync(path.join(c, "assets/archetypes.yaml"))) {
      return c;
    }
  }
  throw new Error(
    `Could not find skill pack (skill/kailashe-operator). Searched: ${candidates.join(", ")}`,
  );
}

function listPackFiles(sourceDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(toPosix(path.relative(sourceDir, full)));
    }
  };
  walk(sourceDir);
  return out.sort();
}

export function runInit(rawOpts: InitOptions = {}, log?: (line: string) => void): InitResult {
  const opts = initOptionsSchema.parse(rawOpts);
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;
  const cwd = opts.cwd ?? process.cwd();
  const targetDir = path.resolve(cwd, opts.targetDir ?? cwd);
  const sourceDir = findPackDir(opts.sourceDir ?? opts.packDir, cwd);

  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`Pack directory not found: ${sourceDir}`);
  }
  const files = listPackFiles(sourceDir);
  if (files.length === 0) throw new Error(`Pack directory is empty: ${sourceDir}`);

  const written: string[] = [];
  const unchanged: string[] = [];
  const skipped: string[] = [];
  const lines: string[] = [];
  const emit = (line: string): void => {
    lines.push(line);
    log?.(line);
  };
  const prefix = dryRun ? "[dry-run] would write" : "write";

  const installOne = (relTarget: string, content: Buffer): void => {
    const dest = path.join(targetDir, ...relTarget.split("/"));
    if (!existsSync(dest)) {
      emit(`${prefix} ${relTarget}`);
      written.push(relTarget);
      if (!dryRun) {
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, content);
      }
      return;
    }
    const existing = readFileSync(dest);
    if (hash(existing) === hash(content)) {
      unchanged.push(relTarget);
      emit(`unchanged ${relTarget}`);
      return;
    }
    if (!force) {
      skipped.push(relTarget);
      emit(`skip ${relTarget} (modified; use --force to overwrite)`);
      return;
    }
    emit(`${prefix} ${relTarget} (force)`);
    written.push(relTarget);
    if (!dryRun) {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
  };

  for (const rel of files) {
    const content = readFileSync(path.join(sourceDir, ...rel.split("/")));
    for (const root of DEST_ROOTS) {
      installOne(`${root}/${rel}`, content);
    }
  }

  // AGENTS.md pointer
  const agentsRel = "AGENTS.md";
  const agentsPath = path.join(targetDir, agentsRel);
  if (!existsSync(agentsPath)) {
    const content = Buffer.from(`# AGENTS.md\n\n${AGENTS_POINTER}`, "utf-8");
    emit(`${prefix} ${agentsRel}`);
    written.push(agentsRel);
    if (!dryRun) {
      mkdirSync(path.dirname(agentsPath), { recursive: true });
      writeFileSync(agentsPath, content);
    }
  } else {
    const existingText = readFileSync(agentsPath, "utf-8");
    if (existingText.includes(AGENTS_POINTER_MARKER)) {
      unchanged.push(agentsRel);
      emit(`unchanged ${agentsRel}`);
    } else {
      // Append-only: never overwrite user content in AGENTS.md.
      const sep = existingText.endsWith("\n") || existingText.length === 0 ? "" : "\n";
      const content = Buffer.from(`${existingText}${sep}\n${AGENTS_POINTER}`, "utf-8");
      emit(`${prefix} ${agentsRel} (append pointer)`);
      written.push(agentsRel);
      if (!dryRun) writeFileSync(agentsPath, content);
    }
  }

  return {
    ok: true,
    dryRun,
    force,
    targetDir,
    sourceDir,
    written,
    unchanged,
    skipped,
    conflicts: skipped,
    lines,
  };
}
