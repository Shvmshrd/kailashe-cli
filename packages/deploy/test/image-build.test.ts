import { describe, it, expect, vi } from "vitest";
import {
  buildImage,
  pushImage,
  uploadStatic,
  ImageBuildError,
  type Runner,
  type RunnerResult,
} from "../src/image-build.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunner(overrides: Partial<RunnerResult> = {}): Runner & { calls: Array<{ bin: string; args: readonly string[] }> } {
  const calls: Array<{ bin: string; args: readonly string[] }> = [];
  return {
    calls,
    run: vi.fn(async (opts: { bin: string; args: readonly string[] }): Promise<RunnerResult> => {
      calls.push({ bin: opts.bin, args: opts.args });
      return { exitCode: 0, stdout: "ok", stderr: "", ...overrides };
    }),
  };
}

// ---------------------------------------------------------------------------
// buildImage
// ---------------------------------------------------------------------------

describe("buildImage", () => {
  it("builds via docker with default options", async () => {
    const runner = makeRunner();
    const result = await buildImage(runner, { tag: "my-app:latest" });
    expect(result.ok).toBe(true);
    expect(result.tag).toBe("my-app:latest");
    expect(result.engine).toBe("docker");
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.bin).toBe("docker");
    expect(runner.calls[0]!.args).toContain("build");
    expect(runner.calls[0]!.args).toContain("my-app:latest");
  });

  it("uses BuildKit engine (still docker binary)", async () => {
    const runner = makeRunner();
    await buildImage(runner, { tag: "my-app:v1", engine: "buildkit" });
    expect(runner.calls[0]!.bin).toBe("docker");
  });

  it("uses railpack binary for railpack engine", async () => {
    const runner = makeRunner();
    await buildImage(runner, { tag: "my-app:v1", engine: "railpack" });
    expect(runner.calls[0]!.bin).toBe("railpack");
    expect(runner.calls[0]!.args).toContain("build");
    expect(runner.calls[0]!.args).toContain("my-app:v1");
  });

  it("passes dockerfile, platform, buildArgs, and extraArgs", async () => {
    const runner = makeRunner();
    await buildImage(runner, {
      tag: "my-app:v2",
      dockerfile: "Dockerfile.prod",
      platform: "linux/amd64",
      buildArgs: { NODE_ENV: "production" },
      extraArgs: ["--no-cache"],
    });
    const args = runner.calls[0]!.args;
    expect(args).toContain("Dockerfile.prod");
    expect(args).toContain("linux/amd64");
    expect(args).toContain("NODE_ENV=production");
    expect(args).toContain("--no-cache");
  });

  it("throws ImageBuildError on non-zero exit", async () => {
    const runner = makeRunner({ exitCode: 1, stderr: "Dockerfile not found" });
    await expect(buildImage(runner, { tag: "my-app:latest" })).rejects.toThrow(ImageBuildError);
  });

  it("never spawns a shell — args are passed as array", async () => {
    const runner = makeRunner();
    await buildImage(runner, { tag: "my-app:latest" });
    // Verify args do not contain shell metacharacters joined into a string
    const args = runner.calls[0]!.args;
    for (const a of args) {
      expect(a).not.toContain("&&");
      expect(a).not.toContain(";");
      expect(a).not.toContain("|");
    }
  });
});

// ---------------------------------------------------------------------------
// pushImage
// ---------------------------------------------------------------------------

describe("pushImage", () => {
  it("pushes via docker push", async () => {
    const runner = makeRunner({ stdout: "pushed" });
    const result = await pushImage(runner, { tag: "my-app:latest" });
    expect(result.ok).toBe(true);
    expect(result.tag).toBe("my-app:latest");
    expect(runner.calls[0]!.bin).toBe("docker");
    expect(runner.calls[0]!.args).toEqual(["push", "my-app:latest"]);
  });

  it("throws on push failure", async () => {
    const runner = makeRunner({ exitCode: 1, stderr: "unauthorized" });
    await expect(pushImage(runner, { tag: "my-app:latest" })).rejects.toThrow(ImageBuildError);
  });
});

// ---------------------------------------------------------------------------
// uploadStatic
// ---------------------------------------------------------------------------

describe("uploadStatic", () => {
  it("uploads to vercel via vercel deploy", async () => {
    const runner = makeRunner({ stdout: "https://my-app.vercel.app" });
    const result = await uploadStatic(runner, { provider: "vercel", buildDir: "./dist" });
    expect(result.ok).toBe(true);
    expect(runner.calls[0]!.bin).toBe("vercel");
    expect(runner.calls[0]!.args).toContain("./dist");
    expect(result.url).toBe("https://my-app.vercel.app");
  });

  it("uploads to cloudflare via wrangler pages deploy", async () => {
    const runner = makeRunner({ stdout: "https://my-app.pages.dev" });
    const result = await uploadStatic(runner, {
      provider: "cloudflare",
      buildDir: "./dist",
      projectName: "my-app",
    });
    expect(runner.calls[0]!.bin).toBe("wrangler");
    expect(runner.calls[0]!.args).toContain("pages");
    expect(result.url).toBe("https://my-app.pages.dev");
  });

  it("uploads to s3 via aws s3 sync", async () => {
    const runner = makeRunner();
    await uploadStatic(runner, { provider: "s3", buildDir: "./dist", projectName: "my-bucket" });
    expect(runner.calls[0]!.bin).toBe("aws");
    expect(runner.calls[0]!.args).toContain("s3");
    expect(runner.calls[0]!.args).toContain("s3://my-bucket/");
  });

  it("throws for s3 without projectName", async () => {
    const runner = makeRunner();
    await expect(uploadStatic(runner, { provider: "s3", buildDir: "./dist" })).rejects.toThrow(ImageBuildError);
  });

  it("throws for unknown provider", async () => {
    const runner = makeRunner();
    await expect(uploadStatic(runner, { provider: "unknown-xyz", buildDir: "./dist" })).rejects.toThrow(ImageBuildError);
  });

  it("throws on non-zero exit", async () => {
    const runner = makeRunner({ exitCode: 1, stderr: "not logged in" });
    await expect(uploadStatic(runner, { provider: "vercel", buildDir: "./dist" })).rejects.toThrow(ImageBuildError);
  });

  it("all upload commands go through the runner (no direct spawn)", async () => {
    const runner = makeRunner();
    await uploadStatic(runner, { provider: "vercel", buildDir: "./dist" });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });
});
