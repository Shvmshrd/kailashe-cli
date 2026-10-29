/**
 * Local mirror of SPEC §2.5 exit codes.
 *
 * NOTE(upstream): `@kailashe/core` currently exposes no `main`/`exports`
 * in its package.json, so `@kailashe/core/exit-codes.js` cannot be resolved
 * by TypeScript (NodeNext) or Node from this package. That breakage lives
 * in packages/core (out of scope here), so the CLI keeps a local copy of
 * the locked SPEC §2.5 mapping. Keep these values in sync with
 * packages/core/src/exit-codes.ts.
 */
export const ExitCode = {
  Ok: 0,
  Unexpected: 1,
  Usage: 2,
  NeedsInputOrDenied: 3,
  ProviderAuth: 4,
  DeployFailed: 5,
  Validation: 6,
  BudgetExceeded: 7,
  Interrupted: 130,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export class KailasheError extends Error {
  public readonly exitCode: ExitCode;
  public constructor(message: string, exitCode: ExitCode, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    this.exitCode = exitCode;
  }
}
export class UsageError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) { super(message, ExitCode.Usage, options); }
}
export class NeedsInputError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) { super(message, ExitCode.NeedsInputOrDenied, options); }
}
export class ProviderAuthError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) { super(message, ExitCode.ProviderAuth, options); }
}
export class DeployFailedError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) { super(message, ExitCode.DeployFailed, options); }
}
export class ValidationError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) { super(message, ExitCode.Validation, options); }
}
export class BudgetExceededError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) { super(message, ExitCode.BudgetExceeded, options); }
}
export class UnexpectedError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) { super(message, ExitCode.Unexpected, options); }
}

export function signalToExitCode(signal: NodeJS.Signals | string): number | null {
  if (signal === "SIGINT") return ExitCode.Interrupted;
  return null;
}

interface CommanderErrorShape { code?: string; exitCode?: number }
function isCommanderError(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const obj = value as CommanderErrorShape;
  return typeof obj.code === "string" && obj.code.startsWith("commander.");
}
export function isCommanderSuccess(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const code = (value as CommanderErrorShape).code;
  return code === "commander.version" || code === "commander.helpDisplayed" || code === "commander.help";
}

export function resolveExitCode(error: unknown): ExitCode {
  if (error instanceof KailasheError) return error.exitCode;
  // Also honour foreign KailasheError-shaped errors (e.g. from @kailashe/core),
  // but only for our typed error names — commander errors also carry an
  // `exitCode` (1) and must fall through to the commander check below.
  if (error !== null && typeof error === "object") {
    const maybe = error as { exitCode?: unknown; name?: unknown };
    const knownNames = new Set([
      "KailasheError", "UsageError", "NeedsInputError", "ProviderAuthError",
      "DeployFailedError", "ValidationError", "BudgetExceededError", "UnexpectedError",
    ]);
    if (
      typeof maybe.name === "string" && knownNames.has(maybe.name) &&
      typeof maybe.exitCode === "number" && Object.values(ExitCode).includes(maybe.exitCode as ExitCode)
    ) {
      return maybe.exitCode as ExitCode;
    }
  }
  if (isCommanderError(error)) return ExitCode.Usage;
  return ExitCode.Unexpected;
}

export function installSigintHandler(
  exitFn: (code: number) => void = (code) => process.exit(code),
): () => void {
  const handler = (): void => { exitFn(ExitCode.Interrupted); };
  process.on("SIGINT", handler);
  return () => { process.off("SIGINT", handler); };
}
