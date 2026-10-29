/**
 * Exit codes per SPEC §2.5 — locked for v0.1.
 *
 * | Code | Meaning                              |
 * |------|--------------------------------------|
 * | 0    | ok                                   |
 * | 1    | unexpected error                     |
 * | 2    | usage error (bad flags/args)         |
 * | 3    | needs input, or approval denied      |
 * | 4    | provider auth failed                 |
 * | 5    | deploy failed or partial             |
 * | 6    | validation failed                    |
 * | 7    | budget exceeded                      |
 * | 130  | interrupted (SIGINT)                 |
 */

/** All valid exit codes defined by SPEC §2.5. */
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

/** Human-readable name for each exit code. */
const EXIT_CODE_NAMES: Readonly<Record<ExitCode, string>> = {
  [ExitCode.Ok]: "ok",
  [ExitCode.Unexpected]: "unexpected error",
  [ExitCode.Usage]: "usage error",
  [ExitCode.NeedsInputOrDenied]: "needs input / approval denied",
  [ExitCode.ProviderAuth]: "provider auth failed",
  [ExitCode.DeployFailed]: "deploy failed",
  [ExitCode.Validation]: "validation failed",
  [ExitCode.BudgetExceeded]: "budget exceeded",
  [ExitCode.Interrupted]: "interrupted (SIGINT)",
};

/** All valid exit code numeric values. */
const VALID_CODES: ReadonlySet<number> = new Set<number>(
  Object.values(ExitCode) as number[],
);

/**
 * Return the human-readable name for an exit code, or undefined if unknown.
 */
export function exitCodeName(code: number): string | undefined {
  return (EXIT_CODE_NAMES as Record<number, string>)[code];
}

/**
 * Return true if the number is a defined exit code per SPEC §2.5.
 */
export function isValidExitCode(code: number): code is ExitCode {
  return VALID_CODES.has(code);
}

/**
 * Map a process signal to its corresponding exit code.
 * Currently only SIGINT → 130 is defined (SPEC §2.5).
 * Returns null for unmapped signals.
 */
export function signalToExitCode(signal: NodeJS.Signals | string): number | null {
  if (signal === "SIGINT") return ExitCode.Interrupted;
  return null;
}

// ---------------------------------------------------------------------------
// Typed errors that carry an exit code
// ---------------------------------------------------------------------------

/**
 * Base error for Kailashe — every thrown KailasheError carries the correct
 * exit code so the CLI can exit without re-classifying.
 */
export class KailasheError extends Error {
  public readonly exitCode: ExitCode;

  public constructor(message: string, exitCode: ExitCode, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    this.exitCode = exitCode;
  }
}

export class UsageError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.Usage, options);
  }
}

export class NeedsInputError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.NeedsInputOrDenied, options);
  }
}

export class ProviderAuthError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.ProviderAuth, options);
  }
}

export class DeployFailedError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.DeployFailed, options);
  }
}

export class ValidationError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.Validation, options);
  }
}

export class BudgetExceededError extends KailasheError {
  /** Amount spent when the budget stopped the run (USD); 0 when unknown. */
  public readonly spent: number;
  /** Budget cap that was exceeded (USD); 0 when unknown. */
  public readonly cap: number;

  public constructor(message: string, options?: ErrorOptions);
  public constructor(spent: number, cap: number, options?: ErrorOptions);
  public constructor(spentOrMessage: number | string, capOrOptions?: number | ErrorOptions, maybeOptions?: ErrorOptions) {
    if (typeof spentOrMessage === "string") {
      super(spentOrMessage, ExitCode.BudgetExceeded, capOrOptions as ErrorOptions | undefined);
      this.spent = 0;
      this.cap = 0;
    } else {
      const cap = typeof capOrOptions === "number" ? capOrOptions : 0;
      super(
        `Model budget exceeded: $${spentOrMessage.toFixed(4)} / $${cap.toFixed(2)} (exit 7)`,
        ExitCode.BudgetExceeded,
        maybeOptions,
      );
      this.spent = spentOrMessage;
      this.cap = cap;
    }
    this.name = "BudgetExceededError";
  }
}

export class UnexpectedError extends KailasheError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.Unexpected, options);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve any thrown value to an exit code.
 * - KailasheError → its exitCode
 * - Node.js ErrnoException with code SIGINT-like → 130
 * - Anything else → 1 (unexpected)
 */
export function resolveExitCode(error: unknown): ExitCode {
  if (error instanceof KailasheError) {
    return error.exitCode;
  }
  // Commander.js throws CommanderError with exitCode/code properties;
  // treat those as usage errors (exit 2) when they look like parse failures.
  if (isCommanderError(error)) {
    return ExitCode.Usage;
  }
  return ExitCode.Unexpected;
}

interface CommanderErrorShape {
  code?: string;
  exitCode?: number;
}

function isCommanderError(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const obj = value as CommanderErrorShape;
  // commander sets code like 'commander.invalidArgument', 'commander.unknownOption', etc.
  return typeof obj.code === "string" && obj.code.startsWith("commander.");
}

/**
 * Install a SIGINT handler that exits with code 130.
 * Call once at CLI startup. Returns a cleanup function.
 * The handler re-registers after firing to handle rapid double-SIGINT.
 */
export function installSigintHandler(
  exitFn: (code: number) => void = (code) => process.exit(code),
): () => void {
  const handler = (): void => {
    exitFn(ExitCode.Interrupted);
  };
  process.on("SIGINT", handler);
  return () => {
    process.off("SIGINT", handler);
  };
}
