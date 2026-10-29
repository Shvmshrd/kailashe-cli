import { Command } from "commander";
import { runInit, type InitResult } from "../init.js";
import { ExitCode } from "../exit-codes.js";

export { runInit } from "../init.js";
export type { InitOptions, InitResult } from "../init.js";

/** CLI wrapper for init. Returns (and sets) the exit code; never calls process.exit. */
export function runInitCommand(opts: {
  dryRun?: boolean;
  force?: boolean;
  targetDir?: string;
  packDir?: string;
  cwd?: string;
}): InitResult {
  const result = runInit(
    {
      dryRun: opts.dryRun,
      force: opts.force,
      targetDir: opts.targetDir,
      packDir: opts.packDir,
      cwd: opts.cwd,
    },
    (line) => console.log(line),
  );
  if (result.skipped.length > 0) {
    console.log(
      `init: skipped ${result.skipped.length} modified file(s) (use --force to overwrite)`,
    );
  }
  console.log(
    result.dryRun
      ? `init (dry-run): ${result.written.length} write(s) planned, ${result.unchanged.length} unchanged, ${result.skipped.length} skipped`
      : `init: ${result.written.length} written, ${result.unchanged.length} unchanged, ${result.skipped.length} skipped`,
  );
  process.exitCode = ExitCode.Ok;
  return result;
}

export function createInitCommand(): Command {
  const cmd = new Command("init");
  cmd
    .description("install the kailashe-operator skill pack into this project")
    .option("--dry-run", "print every intended write, write nothing")
    .option("--force", "overwrite files that differ from the pack (user edits)")
    .option("--target-dir <dir>", "project directory to install into (default: cwd)")
    .option("--pack-dir <dir>", "skill pack directory override")
    .action((opts: { dryRun?: boolean; force?: boolean; targetDir?: string; packDir?: string }) => {
      try {
        runInitCommand(opts);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = ExitCode.Unexpected;
      }
    });
  return cmd;
}
