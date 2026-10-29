/**
 * Secret redaction — applied to every output path (logs, model input,
 * audit, state, stdout). SPEC §4.2, §5.
 *
 * Given a set of secrets, redact all occurrences in text.
 * Handles env values, token patterns, and the ECR password flow.
 */

const REDACTED = "[REDACTED]";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Escape a string for use in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a redactor function for a given set of secrets.
 *
 * Secrets shorter than 3 characters are ignored (too many false positives;
 * real tokens/passwords are longer). Empty strings are ignored.
 */
export function createRedactor(
  secrets: ReadonlySet<string> | readonly string[],
): (text: string) => string {
  const list = normalizeSecrets(secrets);
  // Even with no known secrets, well-known token patterns are still redacted.
  if (list.length === 0) return (t: string) => redactTokenPatterns(t);

  // Sort longest first so "foobar" is replaced before "foo" leaving no fragment.
  list.sort((a, b) => b.length - a.length);

  const pattern = list.map(escapeRegExp).join("|");
  const re = new RegExp(pattern, "g");

  return (text: string): string => {
    if (text.length === 0) return text;
    let result = text.replace(re, REDACTED);
    result = redactTokenPatterns(result);
    return result;
  };
}

/**
 * Redact all occurrences of secrets in `text`.
 * Convenience wrapper over createRedactor.
 */
export function redact(
  text: string,
  secrets: ReadonlySet<string> | readonly string[],
): string {
  return createRedactor(secrets)(text);
}

/**
 * Normalize secrets: deduplicate, drop empty / too-short values.
 */
function normalizeSecrets(
  secrets: ReadonlySet<string> | readonly string[],
): string[] {
  const arr = Array.isArray(secrets) ? secrets : [...secrets];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (typeof s !== "string") continue;
    const trimmed = s.trim();
    if (trimmed.length < 3) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// ── Generic token-pattern redaction ─────────────────────────────────────

/**
 * Redact well-known token patterns even when the exact secret value
 * is not in the secrets set (defence in depth).
 *
 * Covers:
 *  - AWS access keys: AKIA... / ASIA...
 *  - AWS secret keys: 40-char base64-ish after aws_secret_access_key
 *  - GitHub tokens: ghp_ / gho_ / github_pat_
 *  - Generic bearer tokens in Authorization headers
 *  - Long base64-like ECR passwords (>= 400 chars of base64)
 */
const TOKEN_PATTERNS: readonly RegExp[] = [
  // AWS access key ID: AKIA or ASIA + 16 alphanum
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // aws_secret_access_key value (40 base64 chars)
  /(aws_secret_access_key["'=\s:]+)[A-Za-z0-9/+=]{30,}/gi,
  // GitHub PATs
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgho_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Bearer tokens in headers
  /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g,
  // Generic long base64-like credential blobs (>= 400 chars) — ECR passwords etc.
  // Use word boundary to avoid eating surrounding text
  /[A-Za-z0-9+/=]{400,}/g,
];

function redactTokenPatterns(text: string): string {
  let result = text;
  for (const pat of TOKEN_PATTERNS) {
    // Reset lastIndex for global patterns
    pat.lastIndex = 0;
    result = result.replace(pat, (match, group?: string) => {
      // For Bearer pattern with capture group, keep the prefix, redact the token
      if (group !== undefined && typeof group === "string" && match.startsWith(group)) {
        return group + REDACTED;
      }
      // For aws_secret_access_key pattern
      if (group !== undefined && match.includes("aws_secret")) {
        return group + REDACTED;
      }
      return REDACTED;
    });
  }
  return result;
}

// ── ECR password helper ──────────────────────────────────────────────────

/**
 * Check if a command is the ECR get-login-password flow.
 * Its stdout is a credential and must be treated as a secret.
 */
export function isEcrPasswordCommand(
  binary: string,
  args: readonly string[],
): boolean {
  return (
    binary === "aws" &&
    args.length >= 2 &&
    args[0] === "ecr" &&
    args[1] === "get-login-password"
  );
}

// ── Redact args / command display ───────────────────────────────────────

/**
 * Redact secrets inside an args array (for logging / audit display).
 * Returns a new array — original is not mutated.
 */
export function redactArgs(
  args: readonly string[],
  secrets: ReadonlySet<string> | readonly string[],
): string[] {
  const fn = createRedactor(secrets);
  return args.map((a) => fn(a));
}

/**
 * Build a display string for a command with redacted args.
 */
export function redactCommand(
  binary: string,
  args: readonly string[],
  secrets: ReadonlySet<string> | readonly string[],
): string {
  const redactedArgs = redactArgs(args, secrets);
  return [binary, ...redactedArgs].join(" ");
}

// ── For testing / property tests ────────────────────────────────────────

/**
 * Return the placeholder used for redaction.
 */
export function redactedPlaceholder(): string {
  return REDACTED;
}
