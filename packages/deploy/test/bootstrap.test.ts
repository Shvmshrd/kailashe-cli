import { describe, it, expect, vi } from "vitest";
import {
  bootstrapProvider,
  commandArgs,
  isUnsafeBinaryPath,
  planBootstrap,
  type BootstrapDeps,
  type BootstrapExecResult,
} from "../src/bootstrap.js";
import { getProvider, loadProviders, DEFAULT_PROVIDERS_DIR } from "../src/providers.js";
import type { Provider } from "../src/providers.js";

const PROJECT = "/work/my-project";
const SAFE = "/usr/local/bin/vercel";

async function vercel(): Promise<Provider> {
  return getProvider(await loadProviders(DEFAULT_PROVIDERS_DIR), "vercel");
}

function execMap(map: Record<string, BootstrapExecResult>) {
  return vi.fn(async (binary: string, args: readonly string[]): Promise<BootstrapExecResult> => {
    const key = `${binary} ${args.join(" ")}`;
    // Version is probed with the resolved absolute path.
    if (args.join(" ") === "--version" && map["--version"]) return map["--version"];
    const found = map[key] ?? map[args.join(" ")];
    if (found) return found;
    return { exitCode: 1, stdout: "", stderr: `unexpected exec: ${key}` };
  });
}

function deps(overrides: Partial<BootstrapDeps>): BootstrapDeps {
  return {
    exec: execMap({}),
    resolveBinary: async () => SAFE,
    os: "linux",
    projectRoot: PROJECT,
    ...overrides,
  };
}

const OK = (stdout = ""): BootstrapExecResult => ({ exitCode: 0, stdout, stderr: "" });
const FAIL: BootstrapExecResult = { exitCode: 1, stdout: "", stderr: "nope" };

describe("planBootstrap", () => {
  it("returns the exact OS install command and its official source", async () => {
    const plan = planBootstrap(await vercel(), "windows");
    expect(plan.installCommand).toBe("npm i -g vercel");
    expect(plan.installSourceUrl).toBe("https://vercel.com/docs/cli");
    expect(plan.verifyCommand).toBe("vercel whoami");
  });

  it("commandArgs strips the binary and rejects foreign commands", () => {
    expect(commandArgs("aws sts get-caller-identity", "aws")).toEqual(["sts", "get-caller-identity"]);
    expect(() => commandArgs("gcloud info", "aws")).toThrow(/does not start/);
  });
});

describe("bootstrapProvider with fake CLI", () => {
  it("success: present + authenticated returns audit path and version", async () => {
    const provider = await vercel();
    const result = await bootstrapProvider(
      provider,
      deps({ exec: execMap({ "--version": OK("vercel 39.0.0\n"), whoami: OK("someone\n") }) }),
    );
    expect(result.status).toBe("ready");
    expect(result.audit).toEqual({ providerId: "vercel", cliBinary: "vercel", resolvedPath: SAFE, version: "vercel 39.0.0" });
  });

  it("missing CLI without confirmation: returns the install command and runs nothing", async () => {
    const provider = await vercel();
    const runInstall = vi.fn(async () => OK());
    const exec = execMap({});
    const result = await bootstrapProvider(provider, deps({ resolveBinary: async () => null, exec, runInstall }));
    expect(result.status).toBe("install-confirmation-required");
    expect(result.installCommand).toBe("npm i -g vercel");
    expect(result.installSourceUrl).toBe("https://vercel.com/docs/cli");
    expect(runInstall).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("missing CLI with confirmation: installs, re-resolves, then verifies", async () => {
    const provider = await vercel();
    let installed = false;
    const runInstall = vi.fn(async () => {
      installed = true;
      return OK();
    });
    const result = await bootstrapProvider(
      provider,
      deps({
        runInstall,
        resolveBinary: async () => (installed ? SAFE : null),
        exec: execMap({ "--version": OK("1.2.3"), whoami: OK("me") }),
      }),
      { confirmedInstall: true },
    );
    expect(runInstall).toHaveBeenCalledWith("npm i -g vercel");
    expect(result.status).toBe("ready");
  });

  it("confirmed install that fails is reported, never retried silently", async () => {
    const provider = await vercel();
    const result = await bootstrapProvider(
      provider,
      deps({ resolveBinary: async () => null, runInstall: async () => FAIL }),
      { confirmedInstall: true },
    );
    expect(result.status).toBe("install-failed");
  });

  it("unauthenticated CLI without login attempt: login-required with the login command", async () => {
    const provider = await vercel();
    const exec = execMap({ "--version": OK("1.0.0"), whoami: FAIL });
    const result = await bootstrapProvider(provider, deps({ exec }));
    expect(result.status).toBe("login-required");
    expect(result.loginCommand).toBe("vercel login");
    expect(exec.mock.calls.map((c) => c[1].join(" "))).toEqual(["--version", "whoami"]);
  });

  it("login failure: login runs once, verify failure after login is login-failed", async () => {
    const provider = await vercel();
    const exec = execMap({ "--version": OK("1.0.0"), whoami: FAIL, login: FAIL });
    const result = await bootstrapProvider(provider, deps({ exec }), { attemptLogin: true });
    expect(result.status).toBe("login-failed");
  });

  it("login then verify failure is verify-failed; login then verify success is ready", async () => {
    const provider = await vercel();
    let whoamiCalls = 0;
    const exec = vi.fn(async (_binary: string, args: readonly string[]): Promise<BootstrapExecResult> => {
      const key = args.join(" ");
      if (key === "--version") return OK("1.0.0");
      if (key === "login") return OK();
      if (key === "whoami") {
        whoamiCalls += 1;
        return whoamiCalls === 1 ? FAIL : OK("me");
      }
      return FAIL;
    });
    const result = await bootstrapProvider(provider, deps({ exec }), { attemptLogin: true });
    expect(result.status).toBe("ready");
    expect(whoamiCalls).toBe(2);
  });

  it("refuses binaries inside the project or node_modules and never executes them", async () => {
    const provider = await vercel();
    for (const bad of [`${PROJECT}/tools/vercel`, `${PROJECT}/node_modules/.bin/vercel`, "/opt/x/node_modules/vercel", "relative/vercel"]) {
      const exec = execMap({});
      const result = await bootstrapProvider(provider, deps({ resolveBinary: async () => bad, exec }));
      expect(result.status, bad).toBe("refused-unsafe-path");
      expect(exec, bad).not.toHaveBeenCalled();
    }
    expect(isUnsafeBinaryPath(SAFE, PROJECT)).toBe(false);
  });
});
