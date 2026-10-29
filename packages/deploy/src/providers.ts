/**
 * Provider registry loader + validator — SPEC §6.2 / S3.
 *
 * Loads providers/*.yaml, parses YAML, and validates every file with the
 * core Provider schema (Zod at the boundary; no `any`). Only *.yaml / *.yml
 * files in the given directory are read — nothing else on disk is touched,
 * and no provider auth material is ever opened by this module.
 *
 * Core-export note: @kailashe/core now ships an `exports` map with a
 * `./schemas/*.js` subpath, so the canonical import below resolves to the
 * core Provider schema for both typecheck and runtime. (Earlier in this
 * slice it did not; that blocker is resolved — no local schema copy.)
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { ProviderSchema, type Provider } from "@kailashe/core/schemas/provider.js";

export type { Provider, OsName, RiskClass } from "@kailashe/core/schemas/provider.js";
export { ProviderSchema } from "@kailashe/core/schemas/provider.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRegistryError";
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Repo-root providers/ directory (same relative depth from src/ and dist/). */
export const DEFAULT_PROVIDERS_DIR = fileURLToPath(new URL("../../../providers", import.meta.url));

const PROVIDER_FILE_RE = /^[a-z][a-z0-9-]*\.ya?ml$/;

// ---------------------------------------------------------------------------
// Injected filesystem (tests pass fakes; production uses node:fs/promises)
// ---------------------------------------------------------------------------

export interface ProviderFs {
  readdir(dir: string): Promise<string[]>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

const nodeFs: ProviderFs = {
  readdir: (dir) => readdir(dir),
  readFile: (path, encoding) => readFile(path, encoding),
};

// ---------------------------------------------------------------------------
// Single-document validation
// ---------------------------------------------------------------------------

/** Parse + validate one YAML document. Throws ProviderRegistryError. */
export function parseProviderYaml(content: string, sourceName = "<inline>"): Provider {
  let raw: unknown;
  try {
    raw = parse(content);
  } catch (err) {
    throw new ProviderRegistryError(
      `${sourceName}: YAML parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = ProviderSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ProviderRegistryError(`${sourceName}: invalid provider: ${issues}`);
  }
  return parsed.data;
}

/** True when an allowlist pattern covers a command (prefix match, SPEC §F2a). */
export function patternCovers(patterns: readonly string[], command: string): boolean {
  const normalized = command.trim().split(/\s+/).join(" ");
  return patterns.some(
    (pat) => normalized === pat || normalized.startsWith(`${pat} `) || normalized.startsWith(`${pat} --`),
  );
}

/** Extra registry invariants beyond the Zod schema. Throws on violation. */
export function assertProviderInvariants(provider: Provider, sourceName: string): void {
  const patterns = provider.allowedPatterns.map((p) => p.pattern);
  if (!patterns.every((p) => p === provider.cliBinary || p.startsWith(`${provider.cliBinary} `) || isAliasPattern(provider, p))) {
    throw new ProviderRegistryError(
      `${sourceName}: every allowedPatterns entry must start with cliBinary "${provider.cliBinary}"`,
    );
  }
  if (!patternCovers(patterns, provider.verify.command)) {
    throw new ProviderRegistryError(
      `${sourceName}: verify command "${provider.verify.command}" is not covered by allowedPatterns`,
    );
  }
  if (!patternCovers(patterns, provider.login.command)) {
    throw new ProviderRegistryError(
      `${sourceName}: login command "${provider.login.command}" is not covered by allowedPatterns`,
    );
  }
  const osSeen = new Set<string>();
  for (const entry of provider.install) {
    if (osSeen.has(entry.os)) {
      throw new ProviderRegistryError(`${sourceName}: duplicate install entry for os "${entry.os}"`);
    }
    osSeen.add(entry.os);
    if (!entry.sourceUrl.startsWith("https://")) {
      throw new ProviderRegistryError(`${sourceName}: install sourceUrl for ${entry.os} must be https`);
    }
  }
}

function isAliasPattern(provider: Provider, pattern: string): boolean {
  // flyctl ships a `fly` alias; that is the one sanctioned alias prefix.
  return provider.id === "fly" && (pattern === "fly" || pattern.startsWith("fly "));
}

// ---------------------------------------------------------------------------
// Directory loading
// ---------------------------------------------------------------------------

export async function loadProviders(dir: string = DEFAULT_PROVIDERS_DIR, fs: ProviderFs = nodeFs): Promise<Provider[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    throw new ProviderRegistryError(
      `providers directory unreadable (${dir}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const files = entries
    .filter((name) => [".yaml", ".yml"].includes(extname(name).toLowerCase()))
    .sort();

  if (files.length === 0) {
    throw new ProviderRegistryError(`no provider YAML files found in ${dir}`);
  }

  const providers: Provider[] = [];
  const seenIds = new Map<string, string>();
  for (const file of files) {
    if (!PROVIDER_FILE_RE.test(file)) {
      throw new ProviderRegistryError(`${file}: provider filename must match ${PROVIDER_FILE_RE.source}`);
    }
    const content = await fs.readFile(join(dir, file), "utf8");
    const provider = parseProviderYaml(content, file);
    assertProviderInvariants(provider, file);
    const expectedFile = `${provider.id}${extname(file).toLowerCase()}`;
    if (basename(file) !== expectedFile) {
      throw new ProviderRegistryError(`${file}: provider id "${provider.id}" must match filename "${expectedFile}"`);
    }
    const prior = seenIds.get(provider.id);
    if (prior) {
      throw new ProviderRegistryError(`duplicate provider id "${provider.id}" in ${prior} and ${file}`);
    }
    seenIds.set(provider.id, file);
    providers.push(provider);
  }
  return providers.sort((a, b) => a.id.localeCompare(b.id));
}

export function getProvider(providers: readonly Provider[], id: string): Provider {
  const found = providers.find((p) => p.id === id);
  if (!found) {
    throw new ProviderRegistryError(
      `unknown provider "${id}". Known: ${providers.map((p) => p.id).join(", ") || "(none)"}`,
    );
  }
  return found;
}

export function findProvider(providers: readonly Provider[], id: string): Provider | undefined {
  return providers.find((p) => p.id === id);
}
