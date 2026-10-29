export { validatePack, VALID_FLOW_IDS } from "../validate-pack.js";
export type { ValidatePackOptions, ValidationIssue, ValidatePackResult } from "../validate-pack.js";
import { validatePack } from "../validate-pack.js";
import { ExitCode } from "../exit-codes.js";

/** CLI wrapper for validate-pack. Returns (and sets) the process exit code; never calls process.exit. */
export function runValidatePack(opts: { lenient?: boolean; packDir?: string }): number {
  // --lenient never in CI
  if (opts.lenient && process.env.CI) {
    console.error("error: --lenient is not allowed in CI");
    process.exitCode = ExitCode.Validation;
    return ExitCode.Validation;
  }

  const result = validatePack({ packDir: opts.packDir, lenient: opts.lenient });

  for (const issue of result.issues) {
    const prefix = issue.level === "error" ? "error" : "warn";
    const line = `${prefix} [${issue.code}] ${issue.message}`;
    if (issue.level === "error") console.error(line);
    else console.warn(line);
  }

  if (result.ok) {
    console.log("validate-pack: ok");
  } else {
    console.error(`validate-pack: ${result.issues.filter((i) => i.level === "error").length} error(s)`);
  }

  process.exitCode = result.exitCode;
  return result.exitCode;
}
