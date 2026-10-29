/**
 * Per-provider allowlist — binary + subcommand prefix matching.
 *
 * Args are NEVER shell-interpreted — only prefix matching on the args array.
 * SPEC §4.2, §F2a, §5.
 */

import type { Allowlist, AllowlistEntry, RiskClass } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type { Allowlist, AllowlistEntry } from "./types.js";

// ── Core matching ─────────────────────────────────────────────────────────

/**
 * Return true if `binary` + `args` is covered by any entry in `allowlist`.
 *
 * Matching rules:
 *  - binary must be an exact (case-sensitive) match of entry.binary
 *  - every token in entry.prefix must equal args[i] for i in 0..prefix.length-1
 *  - an empty prefix matches any args for that binary
 *  - trailing args (flags, values) beyond the prefix are allowed
 *
 * Example:
 *   isAllowed("aws", ["sts","get-caller-identity"], allowlist) // true if entry prefix is ["sts","get-caller-identity"]
 *   isAllowed("aws", ["ecr","describe-repositories","--region","us-east-1"], allowlist) // true if entry prefix is ["ecr","describe-repositories"]
 */
export function isAllowed(
  binary: string,
  args: readonly string[],
  allowlist: Allowlist,
): boolean {
  return getMatchingEntry(binary, args, allowlist) !== undefined;
}

/**
 * Return the first matching allowlist entry, or undefined if none matches.
 */
export function getMatchingEntry(
  binary: string,
  args: readonly string[],
  allowlist: Allowlist,
): AllowlistEntry | undefined {
  for (const entry of allowlist) {
    if (entry.binary !== binary) continue;
    if (prefixMatches(args, entry.prefix)) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Return the risk class for the matched entry, or undefined if not allowed.
 */
export function getRiskClass(
  binary: string,
  args: readonly string[],
  allowlist: Allowlist,
): RiskClass | undefined {
  return getMatchingEntry(binary, args, allowlist)?.riskClass;
}

function prefixMatches(
  args: readonly string[],
  prefix: readonly string[],
): boolean {
  if (prefix.length === 0) return true;
  if (prefix.length > args.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (args[i] !== prefix[i]) return false;
  }
  return true;
}

// ── Validation helpers ────────────────────────────────────────────────────

/**
 * Return true if the binary name looks like a bare binary name (no path separators,
 * no traversal, no shell metacharacters).
 */
export function isValidBinaryName(binary: string): boolean {
  if (binary.length === 0) return false;
  // Bare name: alphanumeric, dash, underscore, dot only (e.g. "aws", "doctl", "docker")
  return /^[a-zA-Z0-9._-]+$/.test(binary);
}

// ── Built-in allowlists ───────────────────────────────────────────────────

/**
 * Default allowlist covering the F2a AWS patterns plus common provider CLIs.
 * Consumers extend this or provide their own per-provider allowlist.
 *
 * Risk classes match SPEC F2a notes:
 *  - read: verify / describe / list / get-logs
 *  - create/modify/delete: resource creation / updates / teardown
 *  - iam-billing-network: IAM, ECR password, role/policy mutations
 */
export const DEFAULT_ALLOWLIST: Allowlist = [
  // ---- AWS — read ----
  { binary: "aws", prefix: ["sts", "get-caller-identity"], riskClass: "read" },
  { binary: "aws", prefix: ["ecr", "describe-repositories"], riskClass: "read" },
  { binary: "aws", prefix: ["ecr", "describe-images"], riskClass: "read" },
  { binary: "aws", prefix: ["ecs", "describe-express"], riskClass: "read" },
  { binary: "aws", prefix: ["ecs", "describe-services"], riskClass: "read" },
  { binary: "aws", prefix: ["ecs", "describe-tasks"], riskClass: "read" },
  { binary: "aws", prefix: ["lightsail", "get-container-services"], riskClass: "read" },
  { binary: "aws", prefix: ["lightsail", "get-container-service-deployments"], riskClass: "read" },
  { binary: "aws", prefix: ["iam", "get-role"], riskClass: "read" },
  { binary: "aws", prefix: ["iam", "list-roles"], riskClass: "read" },
  { binary: "aws", prefix: ["iam", "list-attached-role-policies"], riskClass: "read" },
  { binary: "aws", prefix: ["logs", "describe-log-groups"], riskClass: "read" },
  { binary: "aws", prefix: ["logs", "get-log-events"], riskClass: "read" },
  { binary: "aws", prefix: ["logs", "filter-log-events"], riskClass: "read" },

  // ---- AWS — create ----
  { binary: "aws", prefix: ["ecr", "create-repository"], riskClass: "create" },
  { binary: "aws", prefix: ["ecs", "create-express"], riskClass: "create" },
  { binary: "aws", prefix: ["lightsail", "create-container-service"], riskClass: "create" },
  { binary: "aws", prefix: ["lightsail", "push-container-image"], riskClass: "create" },
  { binary: "aws", prefix: ["lightsail", "create-container-service-deployment"], riskClass: "create" },

  // ---- AWS — modify ----
  { binary: "aws", prefix: ["ecs", "update-express"], riskClass: "modify" },

  // ---- AWS — delete (teardown only) ----
  { binary: "aws", prefix: ["ecs", "delete-express"], riskClass: "delete" },
  { binary: "aws", prefix: ["lightsail", "delete-container-service"], riskClass: "delete" },

  // ---- AWS — iam-billing-network (always ask) ----
  { binary: "aws", prefix: ["ecr", "get-login-password"], riskClass: "iam-billing-network" },
  { binary: "aws", prefix: ["iam", "create-role"], riskClass: "iam-billing-network" },
  { binary: "aws", prefix: ["iam", "create-policy"], riskClass: "iam-billing-network" },
  { binary: "aws", prefix: ["iam", "attach-role-policy"], riskClass: "iam-billing-network" },
  { binary: "aws", prefix: ["iam", "put-role-policy"], riskClass: "iam-billing-network" },

  // ---- Generic container CLIs ----
  { binary: "docker", prefix: ["build"], riskClass: "create" },
  { binary: "docker", prefix: ["push"], riskClass: "create" },
  { binary: "docker", prefix: ["login"], riskClass: "iam-billing-network" },
  { binary: "docker", prefix: ["images"], riskClass: "read" },
  { binary: "docker", prefix: ["ps"], riskClass: "read" },

  // ---- Other provider CLIs (examples) ----
  { binary: "doctl", prefix: [], riskClass: "read" },
  { binary: "vercel", prefix: [], riskClass: "read" },
  { binary: "wrangler", prefix: [], riskClass: "read" },
  { binary: "fly", prefix: [], riskClass: "read" },
  { binary: "git", prefix: [], riskClass: "read" },
] as const;
