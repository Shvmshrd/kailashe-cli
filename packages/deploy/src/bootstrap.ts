/**
 * Provider CLI bootstrap — SPEC F2.3/F2.4, §5, S3.
 *
 * Flow: check for the CLI -> if missing, surface the exact OS install
 * command from the provider YAML and run it ONLY after an explicit
 * confirmation flag -> resolve the binary to an absolute path -> refuse
 * binaries inside the project or any node_modules directory -> capture
 * ` --version` -> if unauthenticated, optionally run login (inherited
 * stdio is the injected exec's job) and then the verify command.
 *
 * The returned audit record carries provider id + resolved absolute path
 * + version, and nothing else about the user's account. This module never
 * opens any file on disk: resolution and execution happen exclusively
 * through the injected dependencies, so tests run with fakes and no real
 * subprocess.
 */

import { isAbsolute, relative, sep } from "node:path";
import type { OsName, Provider } from "./providers.js";

// ---------------------------------------------------------------------------
// Injected dependencies
// ---------------------------------------------------------------------------

export interface BootstrapExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Executes a binary with an args array (never a shell). Login uses inherited stdio in the real impl. */
export type BootstrapExec = (binary: string, args: readonly string[]) => Promise<BootstrapExecResult>;

/** Runs the verbatim install command from the provider YAML. Only called after confirmation. */
export type BootstrapInstallRunner = (command: string) => Promise<BootstrapExecResult>;

/** Resolves a bare binary name to an absolute path, or null when not found on PATH. */
export type BootstrapResolver = (binary: string) => Promise<string | null>;

export interface BootstrapDeps {
  exec: BootstrapExec;
  resolveBinary: BootstrapResolver;
  runInstall?: BootstrapInstallRunner;
  /** OS the install command is selected for. */
  os: OsName;
  /** Absolute project root; binaries under it (or under node_modules) are refused. */
  projectRoot: string;
}

export interface BootstrapOptions {
  /** Must be exactly true before any install command is run. */
  confirmedInstall?: boolean;
  /** When true and verify first fails, run the provider login then verify again. */
  attemptLogin?: boolean;
}

// ---------------------------------------------------------------------------
// Plan (pure)
// ---------------------------------------------------------------------------

export interface BootstrapPlan {
  providerId: string;
  cliBinary: string;
  os: OsName;
  installCommand: string | null;
  installSourceUrl: string | null;
  loginCommand: string;
  verifyCommand: string;
}

export function planBootstrap(provider: Provider, os: OsName): BootstrapPlan {
  const install = provider.install.find((entry) => entry.os === os);
  return {
    providerId: provider.id,
    cliBinary: provider.cliBinary,
    os,
    installCommand: install?.command ?? null,
    installSourceUrl: install?.sourceUrl ?? null,
    loginCommand: provider.login.command,
    verifyCommand: provider.verify.command,
  };
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type BootstrapStatus =
  | "ready"
  | "install-confirmation-required"
  | "install-unavailable"
  | "install-failed"
  | "cli-not-found"
  | "refused-unsafe-path"
  | "version-failed"
  | "login-required"
  | "login-failed"
  | "verify-failed";

export interface BootstrapAudit {
  providerId: string;
  cliBinary: string;
  resolvedPath?: string;
  version?: string;
}

export interface BootstrapResult {
  status: BootstrapStatus;
  providerId: string;
  /** Set on install-confirmation-required so the caller can ask, showing the exact command. */
  installCommand?: string;
  installSourceUrl?: string;
  /** Set on login-required so the caller can re-print the login command / help text. */
  loginCommand?: string;
  loginHelpText?: string;
  message: string;
  audit: BootstrapAudit;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a simple registry command ("aws sts get-caller-identity") into args after the binary. */
export function commandArgs(command: string, cliBinary: string): string[] {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens[0] !== cliBinary) {
    throw new Error(`command "${command}" does not start with expected binary "${cliBinary}"`);
  }
  return tokens.slice(1);
}

export function isPathInsideDir(candidate: string, dir: string): boolean {
  const rel = relative(dir, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Refusal rule (SPEC §5): no binaries from inside the project or node_modules. */
export function isUnsafeBinaryPath(resolvedPath: string, projectRoot: string): boolean {
  if (!isAbsolute(resolvedPath)) return true;
  if (resolvedPath.split(/[\\/]/).includes("node_modules")) return true;
  if (isPathInsideDir(resolvedPath, projectRoot)) return true;
  return false;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function bootstrapProvider(
  provider: Provider,
  deps: BootstrapDeps,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const plan = planBootstrap(provider, deps.os);
  const audit: BootstrapAudit = { providerId: provider.id, cliBinary: provider.cliBinary };
  const base = { providerId: provider.id, audit };

  let resolved = await deps.resolveBinary(provider.cliBinary);

  if (resolved === null) {
    if (!plan.installCommand) {
      return {
        ...base,
        status: "install-unavailable",
        message: `${provider.cliBinary} is not installed and the ${provider.id} registry entry has no install command for ${deps.os}.`,
      };
    }
    if (options.confirmedInstall !== true) {
      return {
        ...base,
        status: "install-confirmation-required",
        installCommand: plan.installCommand,
        ...(plan.installSourceUrl ? { installSourceUrl: plan.installSourceUrl } : {}),
        message: `${provider.cliBinary} is not installed. Confirm to run the install command from ${plan.installSourceUrl ?? "the provider registry"}.`,
      };
    }
    if (!deps.runInstall) {
      return {
        ...base,
        status: "install-failed",
        installCommand: plan.installCommand,
        message: "Install was confirmed but no install runner was provided.",
      };
    }
    const installResult = await deps.runInstall(plan.installCommand);
    if (installResult.exitCode !== 0) {
      return {
        ...base,
        status: "install-failed",
        installCommand: plan.installCommand,
        message: `Install command failed with exit code ${installResult.exitCode}.`,
      };
    }
    resolved = await deps.resolveBinary(provider.cliBinary);
    if (resolved === null) {
      return {
        ...base,
        status: "cli-not-found",
        message: `${provider.cliBinary} is still not resolvable after install.`,
      };
    }
  }

  if (isUnsafeBinaryPath(resolved, deps.projectRoot)) {
    return {
      ...base,
      status: "refused-unsafe-path",
      message: `Refusing to use ${provider.cliBinary} at ${resolved}: binaries inside the project or node_modules are not trusted.`,
    };
  }
  audit.resolvedPath = resolved;

  const versionResult = await deps.exec(resolved, ["--version"]);
  const version = firstLine(versionResult.stdout) || firstLine(versionResult.stderr);
  if (versionResult.exitCode !== 0 || !version) {
    return {
      ...base,
      status: "version-failed",
      message: `Could not read a version from ${resolved} --version (exit ${versionResult.exitCode}).`,
    };
  }
  audit.version = version;

  const verifyArgs = commandArgs(provider.verify.command, provider.cliBinary);
  const expected = provider.verify.expectedExitCode ?? 0;
  const verifyResult = await deps.exec(resolved, verifyArgs);
  if (verifyResult.exitCode === expected) {
    return { ...base, status: "ready", message: `${provider.name} CLI is installed and authenticated.` };
  }

  if (options.attemptLogin !== true) {
    return {
      ...base,
      status: "login-required",
      loginCommand: provider.login.command,
      ...(provider.login.helpText ? { loginHelpText: provider.login.helpText } : {}),
      message: `${provider.cliBinary} is installed but not authenticated. Run: ${provider.login.command}`,
    };
  }

  const loginArgs = commandArgs(provider.login.command, provider.cliBinary);
  const loginResult = await deps.exec(resolved, loginArgs);
  if (loginResult.exitCode !== 0) {
    return {
      ...base,
      status: "login-failed",
      loginCommand: provider.login.command,
      message: `Login failed with exit code ${loginResult.exitCode}.`,
    };
  }

  const reverify = await deps.exec(resolved, verifyArgs);
  if (reverify.exitCode !== expected) {
    return {
      ...base,
      status: "verify-failed",
      message: `Verify command failed with exit code ${reverify.exitCode} after login.`,
    };
  }
  return { ...base, status: "ready", message: `${provider.name} CLI is installed and authenticated.` };
}
