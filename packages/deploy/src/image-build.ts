/**
 * Image build + registry push via Docker/BuildKit or Railpack.
 * All CLI invocations go through the Runner abstraction — no direct spawns.
 *
 * Static upload path (uploadStatic) covers Vercel/Cloudflare Pages/S3-style
 * providers where no container image is needed.
 */

// ---------------------------------------------------------------------------
// Runner abstraction
// ---------------------------------------------------------------------------

/** Result of a single runner invocation. */
export interface RunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Options forwarded to the runner for a single command. */
export interface RunnerRunOptions {
  /** Binary name, e.g. "docker" */
  bin: string;
  /** Argument array — never shell-interpreted */
  args: readonly string[];
  /** Working directory for the command */
  cwd?: string;
  /** Timeout in ms (0 = no timeout) */
  timeoutMs?: number;
  /** Extra env vars (merged onto process env) */
  env?: Record<string, string>;
}

/**
 * Minimal runner interface. Production impl delegates to the core safe-runner
 * (allowlist, redaction, audit); tests supply a fake that records calls.
 */
export interface Runner {
  run(opts: RunnerRunOptions): Promise<RunnerResult>;
}

// ---------------------------------------------------------------------------
// Image build
// ---------------------------------------------------------------------------

export type BuildEngine = "docker" | "buildkit" | "railpack";

export interface BuildImageOptions {
  /** Absolute or project-relative path to the Dockerfile (default: "Dockerfile") */
  dockerfile?: string;
  /** Build context directory (default: ".") */
  context?: string;
  /** Target image tag, e.g. "my-app:latest" or "123.dkr.ecr.us-east-1.amazonaws.com/my-app:abc123" */
  tag: string;
  /** Extra --build-arg entries */
  buildArgs?: Record<string, string>;
  /** Platform, e.g. "linux/amd64" */
  platform?: string;
  /** Which engine to use (default: "docker") */
  engine?: BuildEngine;
  /** Working directory for the build command */
  cwd?: string;
  /** Extra docker build flags (advanced) */
  extraArgs?: string[];
}

export interface BuildImageResult {
  ok: boolean;
  tag: string;
  engine: BuildEngine;
  stdout: string;
  stderr: string;
}

/**
 * Build a container image via Docker / BuildKit / Railpack.
 * Throws KailasheError on non-zero exit.
 */
export async function buildImage(
  runner: Runner,
  opts: BuildImageOptions,
): Promise<BuildImageResult> {
  const engine: BuildEngine = opts.engine ?? "docker";
  const dockerfile = opts.dockerfile ?? "Dockerfile";
  const context = opts.context ?? ".";

  const args = buildArgsForEngine(engine, dockerfile, context, opts);

  const result = await runner.run({ bin: engineBinary(engine), args, cwd: opts.cwd });

  if (result.exitCode !== 0) {
    throw new ImageBuildError(
      `Image build failed (engine=${engine}, exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  }

  return { ok: true, tag: opts.tag, engine, stdout: result.stdout, stderr: result.stderr };
}

function engineBinary(engine: BuildEngine): string {
  // railpack is its own binary; docker/buildkit both use the "docker" binary
  if (engine === "railpack") return "railpack";
  return "docker";
}

function buildArgsForEngine(
  engine: BuildEngine,
  dockerfile: string,
  context: string,
  opts: BuildImageOptions,
): string[] {
  if (engine === "railpack") {
    // railpack build --tag <tag> [context]
    const args: string[] = ["build", "--tag", opts.tag];
    if (opts.platform) args.push("--platform", opts.platform);
    if (opts.buildArgs) {
      for (const [k, v] of Object.entries(opts.buildArgs)) args.push("--build-arg", `${k}=${v}`);
    }
    args.push(context);
    return args;
  }

  // docker / buildkit path: docker build [flags] <context>
  const args: string[] = ["build", "-f", dockerfile, "-t", opts.tag];
  if (opts.platform) args.push("--platform", opts.platform);
  if (opts.buildArgs) {
    for (const [k, v] of Object.entries(opts.buildArgs)) args.push("--build-arg", `${k}=${v}`);
  }
  if (opts.extraArgs) args.push(...opts.extraArgs);
  args.push(context);
  return args;
}

// ---------------------------------------------------------------------------
// Registry push
// ---------------------------------------------------------------------------

export interface PushImageOptions {
  /** Image tag to push (must match the tag used in buildImage) */
  tag: string;
  /** Working directory */
  cwd?: string;
}

export interface PushImageResult {
  ok: boolean;
  tag: string;
  stdout: string;
  stderr: string;
}

/**
 * Push a previously-built image to its registry via `docker push`.
 * Credentials are assumed to be configured externally (docker login / ECR login
 * via the runner allowlist flow — never passed as args here).
 */
export async function pushImage(
  runner: Runner,
  opts: PushImageOptions,
): Promise<PushImageResult> {
  const result = await runner.run({ bin: "docker", args: ["push", opts.tag], cwd: opts.cwd });
  if (result.exitCode !== 0) {
    throw new ImageBuildError(
      `Image push failed for ${opts.tag} (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  }
  return { ok: true, tag: opts.tag, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// Static upload
// ---------------------------------------------------------------------------

export interface UploadStaticOptions {
  /** Provider id: "vercel" | "cloudflare" | "s3" etc. */
  provider: string;
  /** Local directory containing the built static site */
  buildDir: string;
  /** Project name / site name on the provider */
  projectName?: string;
  /** Working directory for the CLI command */
  cwd?: string;
}

export interface UploadStaticResult {
  ok: boolean;
  url?: string;
  stdout: string;
  stderr: string;
}

/**
 * Upload a static build directory to a hosting provider via its CLI.
 * The actual CLI command is chosen by provider id; all invocations go
 * through the runner (so allowlist + audit apply).
 *
 * Supported providers in S6:
 *   - vercel  → `vercel deploy <buildDir> --prod --yes`
 *   - cloudflare → `wrangler pages deploy <buildDir> --project-name <name>`
 *   - s3      → `aws s3 sync <buildDir> s3://<projectName>/`
 */
export async function uploadStatic(
  runner: Runner,
  opts: UploadStaticOptions,
): Promise<UploadStaticResult> {
  const { bin, args } = staticCommandForProvider(opts);

  const result = await runner.run({ bin, args, cwd: opts.cwd });
  if (result.exitCode !== 0) {
    throw new ImageBuildError(
      `Static upload failed (provider=${opts.provider}, exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  }

  // Try to extract a deployed URL from stdout (best-effort; provider-specific)
  const url = extractUrl(result.stdout);

  return { ok: true, url, stdout: result.stdout, stderr: result.stderr };
}

function staticCommandForProvider(
  opts: UploadStaticOptions,
): { bin: string; args: string[] } {
  switch (opts.provider) {
    case "vercel":
      return { bin: "vercel", args: ["deploy", opts.buildDir, "--prod", "--yes"] };
    case "cloudflare":
      return {
        bin: "wrangler",
        args: [
          "pages",
          "deploy",
          opts.buildDir,
          ...(opts.projectName ? ["--project-name", opts.projectName] : []),
        ],
      };
    case "s3":
      if (!opts.projectName) throw new ImageBuildError("s3 upload requires projectName (bucket name)");
      return { bin: "aws", args: ["s3", "sync", opts.buildDir, `s3://${opts.projectName}/`] };
    default:
      throw new ImageBuildError(`Unsupported static provider: ${opts.provider}`);
  }
}

function extractUrl(stdout: string): string | undefined {
  // Match https://... URLs — return the last one (usually the deployed URL)
  const re = /https:\/\/\S+/g;
  const matches = stdout.match(re);
  return matches?.[matches.length - 1];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ImageBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageBuildError";
  }
}
