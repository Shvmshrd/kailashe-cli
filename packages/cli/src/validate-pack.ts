import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { allChannelIds } from "@kailashe/plan/channel-map.js";
import { ExitCode } from "./exit-codes.js";

export interface ValidatePackOptions {
  packDir?: string;
  lenient?: boolean;
  /** Inject fixtures for testing — overrides file reads */
  fixtures?: {
    archetypes?: unknown;
    connectors?: unknown;
  };
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface ValidatePackResult {
  ok: boolean;
  issues: ValidationIssue[];
  exitCode: number;
}

// Valid flow ids from tool-hubs.md §7
export const VALID_FLOW_IDS = new Set([
  "signup-welcome",
  "content-to-social",
  "gsc-weekly",
  "mentions-watch",
  "payment-events",
  "support-triage",
  "directory-check",
  "uptime-alert",
  "review-request",
  "lead-route",
  "release-to-social",
  "github-star-alerts",
  "abandoned-cart",
  "newsletter-pipeline",
  "local-review-request",
]);

function defaultPackDir(): string {
  // Walk up from this file to find skill/kailashe-operator
  // In built output, also check relative to repo root
  const candidates = [
    path.resolve(process.cwd(), "skill/kailashe-operator"),
    path.resolve(import.meta.dirname ?? ".", "../../../skill/kailashe-operator"),
    path.resolve(import.meta.dirname ?? ".", "../../skill/kailashe-operator"),
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "assets/archetypes.yaml"))) return c;
  }
  return candidates[0]!;
}

function loadYamlFile(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf-8");
  return parseYaml(raw);
}

export function validatePack(opts: ValidatePackOptions = {}): ValidatePackResult {
  const issues: ValidationIssue[] = [];
  const lenient = opts.lenient ?? false;

  // In CI, lenient is never allowed
  if (lenient && process.env.CI) {
    issues.push({
      level: "error",
      code: "lenient-in-ci",
      message: "--lenient is not allowed in CI",
    });
    return { ok: false, issues, exitCode: ExitCode.Validation };
  }

  let archetypesData: unknown;
  let connectorsData: unknown;

  if (opts.fixtures?.archetypes !== undefined) {
    archetypesData = opts.fixtures.archetypes;
  } else {
    const packDir = opts.packDir ?? defaultPackDir();
    const p = path.join(packDir, "assets/archetypes.yaml");
    if (!existsSync(p)) {
      issues.push({ level: "error", code: "missing-file", message: `Missing archetypes.yaml at ${p}` });
    } else {
      try {
        archetypesData = loadYamlFile(p);
      } catch (e) {
        issues.push({ level: "error", code: "parse-error", message: `Failed to parse archetypes.yaml: ${e}` });
      }
    }
  }

  if (opts.fixtures?.connectors !== undefined) {
    connectorsData = opts.fixtures.connectors;
  } else {
    const packDir = opts.packDir ?? defaultPackDir();
    const p = path.join(packDir, "assets/connectors.yaml");
    if (!existsSync(p)) {
      issues.push({ level: "error", code: "missing-file", message: `Missing connectors.yaml at ${p}` });
    } else {
      try {
        connectorsData = loadYamlFile(p);
      } catch (e) {
        issues.push({ level: "error", code: "parse-error", message: `Failed to parse connectors.yaml: ${e}` });
      }
    }
  }

  if (archetypesData) validateArchetypes(archetypesData, issues, lenient);
  if (connectorsData) validateConnectors(connectorsData, issues, lenient);

  // Cross-check: dangling flow ids
  if (archetypesData) {
    checkDanglingFlows(archetypesData, issues, lenient);
  }

  // Cross-check: dangling channel ids against the plan channel map (S9/S9b)
  if (archetypesData) {
    checkChannelMap(archetypesData, issues, lenient);
  }

  const errors = issues.filter((i) => i.level === "error");
  const ok = errors.length === 0;
  return { ok, issues, exitCode: ok ? ExitCode.Ok : ExitCode.Validation };
}

function validateArchetypes(data: unknown, issues: ValidationIssue[], lenient: boolean): void {
  const level = lenient ? "warning" as const : "error" as const;
  if (!data || typeof data !== "object") {
    issues.push({ level, code: "missing-field", message: "archetypes.yaml: top-level must be an object" });
    return;
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.archetypes)) {
    issues.push({ level, code: "missing-field", message: "archetypes.yaml: missing required field 'archetypes'" });
    return;
  }
  for (let idx = 0; idx < obj.archetypes.length; idx++) {
    const a = obj.archetypes[idx] as Record<string, unknown>;
    if (!a || typeof a !== "object") {
      issues.push({ level, code: "missing-field", message: `archetypes[${idx}]: must be an object` });
      continue;
    }
    for (const field of ["id", "name", "channels_ranked", "flows"]) {
      if (a[field] === undefined || a[field] === null) {
        issues.push({ level, code: "missing-field", message: `archetypes[${idx}]: missing required field '${field}'` });
      }
    }
  }
}

function validateConnectors(data: unknown, issues: ValidationIssue[], lenient: boolean): void {
  const level = lenient ? "warning" as const : "error" as const;
  if (!data || typeof data !== "object") {
    issues.push({ level, code: "missing-field", message: "connectors.yaml: top-level must be an object" });
    return;
  }
  const obj = data as Record<string, unknown>;
  if (obj.version === undefined) {
    issues.push({ level, code: "missing-field", message: "connectors.yaml: missing required field 'version'" });
  }
  if (!obj.capabilities || typeof obj.capabilities !== "object") {
    issues.push({ level, code: "missing-field", message: "connectors.yaml: missing required field 'capabilities'" });
  }
}

function checkDanglingFlows(archetypesData: unknown, issues: ValidationIssue[], lenient: boolean): void {
  const level = lenient ? "warning" as const : "error" as const;
  const obj = archetypesData as Record<string, unknown>;
  const list = obj.archetypes as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(list)) return;
  for (const a of list) {
    const flows = a.flows as string[] | undefined;
    if (!Array.isArray(flows)) continue;
    for (const fid of flows) {
      if (!VALID_FLOW_IDS.has(fid)) {
        issues.push({ level, code: "dangling-flow-id", message: `Unknown flow id '${fid}' in archetype '${a.id}'` });
      }
    }
  }
}

function checkChannelMap(archetypesData: unknown, issues: ValidationIssue[], lenient: boolean): void {
  const level = lenient ? "warning" as const : "error" as const;
  const known = new Set(allChannelIds());
  const obj = archetypesData as Record<string, unknown>;
  const list = obj.archetypes as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(list)) return;
  for (const a of list) {
    const ranked = a.channels_ranked;
    if (!Array.isArray(ranked)) continue;
    for (const entry of ranked) {
      let channelId: string | undefined;
      if (typeof entry === "string") {
        channelId = entry;
      } else if (entry && typeof entry === "object") {
        const channel = (entry as Record<string, unknown>).channel;
        if (typeof channel === "string") channelId = channel;
      }
      if (channelId !== undefined && !known.has(channelId)) {
        issues.push({
          level,
          code: "dangling-channel-id",
          message: `Unknown channel id '${channelId}' in archetype '${a.id}'`,
        });
      }
    }
  }
}
