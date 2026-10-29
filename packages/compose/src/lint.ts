/**
 * Lint helpers: placeholder lint + secret scan.
 */

// ---------------------------------------------------------------------------
// Placeholder lint
// ---------------------------------------------------------------------------

/** Regex matching unfilled Mustache-style placeholders: {{...}} */
export const PLACEHOLDER_RE = /\{\{[^}]+\}\}/g;

/**
 * Return all unfilled placeholders found in text, or empty array if clean.
 */
export function findPlaceholders(text: string): string[] {
  const matches = text.match(PLACEHOLDER_RE);
  return matches ? [...matches] : [];
}

/**
 * True if text has no unfilled placeholders.
 */
export function hasNoPlaceholders(text: string): boolean {
  return findPlaceholders(text).length === 0;
}

// ---------------------------------------------------------------------------
// Secret scan
// ---------------------------------------------------------------------------

/**
 * Patterns that look like secrets. Fails closed — any match is a violation.
 * Covers: generic API keys/tokens, AWS keys, private keys, bearer tokens, etc.
 */
export const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/g },
  { name: "aws-secret-key", re: /aws_secret_access_key\s*[:=]\s*\S+/gi },
  { name: "generic-api-key", re: /\b(api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}["']?/gi },
  { name: "generic-secret", re: /\b(secret|client_secret)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}["']?/gi },
  { name: "bearer-token", re: /bearer\s+[A-Za-z0-9_-]{16,}/gi },
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "generic-token", re: /\b(token|access_token|auth_token)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}["']?/gi },
  { name: "password-assignment", re: /\bpassword\s*[:=]\s*["']?[^\s"']{8,}["']?/gi },
  { name: "sk-live", re: /\bsk[_-](?:live|test)[_0-9A-Za-z-]{10,}/g },
  { name: "openai-style-key", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{20,}/g },
  { name: "gh-token", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}/g },
];

export interface SecretFinding {
  pattern: string;
  match: string;
}

/**
 * Scan text for secret-like patterns.
 * Returns findings (empty = clean).
 */
export function scanSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      findings.push({ pattern: name, match: m[0].slice(0, 80) });
      // Avoid infinite loop on zero-length matches
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return findings;
}

/**
 * True if text contains no secrets.
 */
export function hasNoSecrets(text: string): boolean {
  return scanSecrets(text).length === 0;
}

// ---------------------------------------------------------------------------
// Third-party text blocks
// ---------------------------------------------------------------------------

import { THIRD_PARTY_BLOCK_MAX } from "./types.js";

/**
 * Wrap third-party text in a labeled, length-capped block.
 * Per SPEC §4.3: data is never bare — always delimited and capped.
 */
export function wrapThirdPartyBlock(label: string, text: string, maxLen: number = THIRD_PARTY_BLOCK_MAX): string {
  // Labels and bodies must never be able to forge a delimiter: strip comment
  // open/close sequences so a forged END marker in the data stays data.
  const safeLabel = label.replace(/<!--/g, "").replace(/-->/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "unknown source";
  const capped = text.length > maxLen ? text.slice(0, maxLen) + "\n[...truncated]" : text;
  const safeText = capped.replace(/<!--/g, "< !--").replace(/-->/g, "-- >");
  return `<!-- BEGIN third-party data: ${safeLabel} -->\n${safeText}\n<!-- END third-party data: ${safeLabel} -->`;
}
