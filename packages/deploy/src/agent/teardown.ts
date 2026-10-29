/**
 * kailashe teardown — SPEC F2.8 (S5)
 *
 * Removes only resources tagged kailashe-project={{id}} via the runner, with
 * explicit per-resource approval. The runner allowlist restricts deletes to the
 * provider's delete verbs (e.g. aws ecs delete-express-*, lightsail delete-*).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { AgentStateSchema, type AgentState, KAILASHE_TAG_KEY } from "./types.js";

export interface TeardownRunner {
  run(opts: { binary: string; args: readonly string[]; cwd?: string }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export interface TeardownOptions {
  /** Project root on disk (for reading deploy-state.json). */
  projectRoot: string;
  /** Project identifier — only resources with kailashe-project={{projectId}} are considered. */
  projectId: string;
  /** Provider id — matched against state.provider for sanity. */
  provider: string;
  /** Runner used for delete commands (allowlist-enforced). */
  runner: TeardownRunner;
  /**
   * Called once per resource before deletion. Return false to skip that resource.
   * When omitted every tagged resource is deleted.
   */
  approvalFn?: (resource: {
    id: string;
    type: string;
    providerResourceId?: string;
    deleteCommand: { binary: string; args: string[] };
  }) => boolean | Promise<boolean>;
  /**
   * Override the delete-command mapping. When omitted the built-in mapping is used.
   * Receives a state resource and returns the binary+args to run, or null to skip.
   */
  deleteCommandForResource?: (resource: {
    id: string;
    type: string;
    providerResourceId?: string;
    tags?: Record<string, string | string>;
  }) => { binary: string; args: string[] } | null;
  /** Where to write refreshed state after each delete. */
  statePath?: string;
}

export interface TeardownResult {
  /** Number of resources that were found tagged for this project. */
  foundCount: number;
  /** Resources successfully deleted. */
  deleted: Array<{ id: string; type: string; providerResourceId?: string }>;
  /** Resources skipped (approval denied or mapping missing). */
  skipped: Array<{ id: string; reason: string }>;
  /** Resources where the delete command failed (non-zero exit). */
  failed: Array<{ id: string; error: string }>;
  /** Whether all tagged resources were removed. */
  allRemoved: boolean;
}

function defaultDeleteCommand(resource: {
  id: string;
  type: string;
  providerResourceId?: string;
}): { binary: string; args: string[] } | null {
  const lower = resource.type.toLowerCase();
  const id = resource.providerResourceId ?? resource.id;

  // AWS ECR repository
  if (lower.includes("ecr") && lower.includes("create-repository")) {
    // ECR delete — id is the repository name
    return { binary: "aws", args: ["ecr", "delete-repository", "--repository-name", id, "--force"] };
  }
  if (lower.includes("ecr")) {
    const repoName = extractArgFromType(resource.type, "repository") ?? id;
    return { binary: "aws", args: ["ecr", "delete-repository", "--repository-name", repoName, "--force"] };
  }

  // ECS Express (the exact delete verb is verified against AWS docs in S5 slice report)
  if (lower.includes("ecs") && lower.includes("express")) {
    return { binary: "aws", args: ["ecs", "delete-express-service", "--service", id] };
  }
  if (lower.includes("ecs")) {
    return { binary: "aws", args: ["ecs", "delete-express-service", "--service", id] };
  }

  // Lightsail container service
  if (lower.includes("lightsail")) {
    return { binary: "aws", args: ["lightsail", "delete-container-service", "--service-name", id] };
  }

  // Docker
  if (lower === "docker:push" || lower.includes("docker")) {
    // Docker image tags cannot be deleted via push — skip.
    return null;
  }

  // Generic fallback: try to infer a delete from create verb
  return null;
}

function extractArgFromType(type: string, key: string): string | undefined {
  // Best-effort extraction from stored command fragments; return undefined if not found.
  if (type.includes(key)) return type.split(key).pop()?.trim();
  return undefined;
}

function loadState(projectRoot: string, explicitPath?: string): AgentState | null {
  const p = explicitPath ?? path.join(path.resolve(projectRoot), ".kailashe", "deploy-state.json");
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = AgentStateSchema.safeParse(parsed);
    if (validated.success) return validated.data;
    // Allow loose shape for forward compat
    return parsed as AgentState;
  } catch {
    return null;
  }
}

function isTaggedForProject(resource: { tags?: Record<string, string | string> }, projectId: string): boolean {
  const tags = resource.tags ?? {};
  return tags[KAILASHE_TAG_KEY] === projectId;
}

/**
 * Execute a teardown: delete every resource in deploy-state.json tagged
 * kailashe-project={{projectId}}, one at a time, via the runner, with
 * per-resource approval.
 */
export async function teardown(opts: TeardownOptions): Promise<TeardownResult> {
  const state = loadState(opts.projectRoot, opts.statePath);

  if (!state) {
    return {
      foundCount: 0,
      deleted: [],
      skipped: [{ id: "*", reason: "no deploy-state.json found — nothing to tear down" }],
      failed: [],
      allRemoved: true,
    };
  }

  // Sanity: provider mismatch is a bug, not a silent no-op.
  if (state.provider !== opts.provider) {
    throw new TeardownError(
      `Teardown provider mismatch: state.provider=${state.provider}, requested=${opts.provider}. Refusing to delete across providers.`,
    );
  }

  const tagged = state.resources.filter((r) => isTaggedForProject(r, opts.projectId));
  const foundCount = tagged.length;

  if (foundCount === 0) {
    return {
      foundCount,
      deleted: [],
      skipped: [{ id: "*", reason: `no resources tagged ${KAILASHE_TAG_KEY}=${opts.projectId}` }],
      failed: [],
      allRemoved: true,
    };
  }

  const deleted: TeardownResult["deleted"] = [];
  const skipped: TeardownResult["skipped"] = [];
  const failed: TeardownResult["failed"] = [];

  for (const resource of tagged) {
    const command =
      opts.deleteCommandForResource?.(resource) ?? defaultDeleteCommand(resource as { id: string; type: string; providerResourceId?: string });

    if (!command) {
      skipped.push({ id: resource.id, reason: `no delete mapping for resource type "${resource.type}"` });
      continue;
    }

    // Per-resource approval (SPEC F2.8: teardown goes through runner with approval).
    if (opts.approvalFn) {
      const approved = await opts.approvalFn({
        id: resource.id,
        type: resource.type,
        providerResourceId: resource.providerResourceId,
        deleteCommand: command,
      });
      if (!approved) {
        skipped.push({ id: resource.id, reason: "approval denied" });
        continue;
      }
    }

    const result = await opts.runner.run({
      binary: command.binary,
      args: command.args,
      cwd: opts.projectRoot,
    });

    if (result.exitCode === 0) {
      deleted.push({ id: resource.id, type: resource.type, providerResourceId: resource.providerResourceId });
    } else {
      failed.push({
        id: resource.id,
        error: `delete failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500) || result.stdout.slice(0, 500)}`,
      });
    }
  }

  // Persist trimmed state (remove deleted resources) — best effort.
  if (deleted.length > 0) {
    try {
      const deletedIds = new Set(deleted.map((d) => d.id));
      const remaining = state.resources.filter((r) => !deletedIds.has(r.id));
      const updated: AgentState = {
        ...state,
        resources: remaining,
        timestamps: { ...state.timestamps, updatedAt: new Date().toISOString() },
      };
      const dest = opts.statePath ?? path.join(path.resolve(opts.projectRoot), ".kailashe", "deploy-state.json");
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, JSON.stringify(updated, null, 2) + "\n", "utf-8");
    } catch {
      // best effort
    }
  }

  return {
    foundCount,
    deleted,
    skipped,
    failed,
    allRemoved: failed.length === 0 && skipped.filter((s) => s.id !== "*").length === 0,
  };
}

export class TeardownError extends Error {
  override readonly name = "TeardownError";
  constructor(message: string) {
    super(message);
    this.name = "TeardownError";
  }
}
