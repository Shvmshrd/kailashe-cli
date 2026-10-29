/**
 * Recipe save / replay — SPEC S5
 *
 * A Recipe captures the minimal facts to replay a successful deploy without
 * re-running the LLM: provider, app type, exact commands, and doc fetch dates.
 * On the next deploy the agent replays the recipe first and only falls back to
 * the LLM loop when a step fails.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { type Recipe, RecipeSchema } from "./types.js";

// ── Paths ────────────────────────────────────────────────────────────────

export const RECIPE_DIR = ".kailashe/recipes";
export const RECIPE_FILE = ".kailashe/recipe.json";

export function recipePath(projectRoot: string, recipeFile = RECIPE_FILE): string {
  return path.join(path.resolve(projectRoot), recipeFile);
}

export function recipePathForProvider(projectRoot: string, provider: string): string {
  return path.join(path.resolve(projectRoot), RECIPE_DIR, `${provider}.json`);
}

// ── Save / load ──────────────────────────────────────────────────────────

export async function saveRecipe(projectRoot: string, recipe: Recipe): Promise<string> {
  const validated = RecipeSchema.parse(recipe);
  const dest = recipePath(projectRoot);
  const alt = recipePathForProvider(projectRoot, validated.provider);

  const json = JSON.stringify(validated, null, 2) + "\n";
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, json, "utf-8");
  await fs.promises.mkdir(path.dirname(alt), { recursive: true });
  await fs.promises.writeFile(alt, json, "utf-8");

  return dest;
}

export async function loadRecipe(projectRoot: string, recipeFile?: string): Promise<Recipe | null> {
  const p = recipeFile ? path.join(path.resolve(projectRoot), recipeFile) : recipePath(projectRoot);
  try {
    const raw = await fs.promises.readFile(p, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = RecipeSchema.safeParse(parsed);
    if (validated.success) return validated.data;
    // Loose fallback: return even if an optional field is odd (backward compat)
    return parsed as Recipe;
  } catch {
    return null;
  }
}

export async function loadRecipeForProvider(projectRoot: string, provider: string): Promise<Recipe | null> {
  return loadRecipe(projectRoot, path.join(RECIPE_DIR, `${provider}.json`));
}

export function buildRecipe(opts: {
  provider: string;
  appType: string;
  artifactKind?: string;
  commands: Array<{ binary: string; args: string[]; riskClass?: string }>;
  docsUrls: string[];
  docsDate: string;
  projectId?: string;
  awsPath?: "ecs-express" | "lightsail" | "none";
}): Recipe {
  return RecipeSchema.parse({
    version: 1,
    provider: opts.provider,
    appType: opts.appType,
    artifactKind: opts.artifactKind,
    commands: opts.commands.map((c) => ({
      binary: c.binary,
      args: [...c.args],
      riskClass: c.riskClass,
    })),
    docsUrls: [...opts.docsUrls],
    docsDate: opts.docsDate,
    createdAt: new Date().toISOString(),
    projectId: opts.projectId,
    awsPath: opts.awsPath ?? "none",
  });
}

// ── Replay ───────────────────────────────────────────────────────────────

export interface RecipeRunner {
  run(opts: { binary: string; args: readonly string[]; cwd?: string }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export interface ReplayRecipeOptions {
  projectRoot: string;
  runner: RecipeRunner;
  /** Called after each successful step with the updated state payload (caller persists). */
  onStepOk?: (stepIndex: number, cmd: Recipe["commands"][number], result: { stdout: string; stderr: string }) => void;
  /** Called on failure — return true to stop replay and fall back to agent. */
  onStepFail?: (stepIndex: number, cmd: Recipe["commands"][number], result: { exitCode: number; stdout: string; stderr: string }) => void;
}

export interface ReplayRecipeResult {
  ok: boolean;
  completedSteps: number;
  failedStepIndex: number | null;
  failedStepError?: string;
  /** True when at least one step failed — the caller should fall back to the deploy agent. */
  shouldFallback: boolean;
}

/**
 * Replay a saved recipe step by step through the runner.
 *
 * Stops on the first non-zero exit code and returns shouldFallback=true so
 * the caller can fall back to the LLM agent for that step.
 */
export async function replayRecipe(
  recipe: Recipe,
  opts: ReplayRecipeOptions,
): Promise<ReplayRecipeResult> {
  for (let i = 0; i < recipe.commands.length; i++) {
    const cmd = recipe.commands[i]!;
    const result = await opts.runner.run({
      binary: cmd.binary,
      args: cmd.args,
      cwd: opts.projectRoot,
    });

    if (result.exitCode !== 0) {
      const errorMsg = `Recipe step ${i} failed: ${cmd.binary} ${cmd.args.join(" ")} (exit ${result.exitCode}): ${result.stderr || result.stdout}`;
      if (opts.onStepFail) opts.onStepFail(i, cmd, result);
      return {
        ok: false,
        completedSteps: i,
        failedStepIndex: i,
        failedStepError: errorMsg,
        shouldFallback: true,
      };
    }

    if (opts.onStepOk) opts.onStepOk(i, cmd, result);
  }

  return {
    ok: true,
    completedSteps: recipe.commands.length,
    failedStepIndex: null,
    shouldFallback: false,
  };
}
