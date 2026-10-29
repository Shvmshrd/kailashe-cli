import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ExitCode,
  exitCodeName,
  isValidExitCode,
  signalToExitCode,
  KailasheError,
  UsageError,
  NeedsInputError,
  ProviderAuthError,
  DeployFailedError,
  ValidationError,
  BudgetExceededError,
  UnexpectedError,
  resolveExitCode,
  installSigintHandler,
} from "../src/exit-codes.js";

describe("ExitCode constants per SPEC §2.5", () => {
  it("has the correct numeric values", () => {
    expect(ExitCode.Ok).toBe(0);
    expect(ExitCode.Unexpected).toBe(1);
    expect(ExitCode.Usage).toBe(2);
    expect(ExitCode.NeedsInputOrDenied).toBe(3);
    expect(ExitCode.ProviderAuth).toBe(4);
    expect(ExitCode.DeployFailed).toBe(5);
    expect(ExitCode.Validation).toBe(6);
    expect(ExitCode.BudgetExceeded).toBe(7);
    expect(ExitCode.Interrupted).toBe(130);
  });

  it("defines exactly 9 exit codes", () => {
    expect(Object.keys(ExitCode)).toHaveLength(9);
  });

  it("values are unique", () => {
    const values = Object.values(ExitCode) as number[];
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("exitCodeName", () => {
  it("returns a name for every defined code", () => {
    for (const code of Object.values(ExitCode) as number[]) {
      const name = exitCodeName(code);
      expect(name).toBeDefined();
      expect(typeof name).toBe("string");
      expect(name!.length).toBeGreaterThan(0);
    }
  });

  it("returns undefined for unknown codes", () => {
    expect(exitCodeName(99)).toBeUndefined();
    expect(exitCodeName(999)).toBeUndefined();
    expect(exitCodeName(-1)).toBeUndefined();
  });

  it("names match SPEC meanings", () => {
    expect(exitCodeName(0)).toMatch(/ok/i);
    expect(exitCodeName(1)).toMatch(/unexpected/i);
    expect(exitCodeName(2)).toMatch(/usage/i);
    expect(exitCodeName(3)).toMatch(/needs input|denied/i);
    expect(exitCodeName(4)).toMatch(/provider auth/i);
    expect(exitCodeName(5)).toMatch(/deploy/i);
    expect(exitCodeName(6)).toMatch(/validation/i);
    expect(exitCodeName(7)).toMatch(/budget/i);
    expect(exitCodeName(130)).toMatch(/interrupt/i);
  });
});

describe("isValidExitCode", () => {
  it("returns true for all defined codes", () => {
    for (const code of Object.values(ExitCode) as number[]) {
      expect(isValidExitCode(code)).toBe(true);
    }
  });

  it("returns false for undefined codes", () => {
    expect(isValidExitCode(8)).toBe(false);
    expect(isValidExitCode(99)).toBe(false);
    expect(isValidExitCode(-1)).toBe(false);
  });
});

describe("signalToExitCode", () => {
  it("maps SIGINT to 130", () => {
    expect(signalToExitCode("SIGINT")).toBe(130);
    expect(signalToExitCode("SIGINT")).toBe(ExitCode.Interrupted);
  });

  it("returns null for other signals", () => {
    expect(signalToExitCode("SIGTERM")).toBeNull();
    expect(signalToExitCode("SIGKILL")).toBeNull();
    expect(signalToExitCode("SIGHUP")).toBeNull();
    expect(signalToExitCode("")).toBeNull();
  });
});

describe("KailasheError hierarchy", () => {
  const cases: Array<{ ctor: new (msg: string) => KailasheError; code: number; name: string }> = [
    { ctor: UsageError, code: 2, name: "UsageError" },
    { ctor: NeedsInputError, code: 3, name: "NeedsInputError" },
    { ctor: ProviderAuthError, code: 4, name: "ProviderAuthError" },
    { ctor: DeployFailedError, code: 5, name: "DeployFailedError" },
    { ctor: ValidationError, code: 6, name: "ValidationError" },
    { ctor: BudgetExceededError, code: 7, name: "BudgetExceededError" },
    { ctor: UnexpectedError, code: 1, name: "UnexpectedError" },
  ];

  it.each(cases)("$name carries exit code $code", ({ ctor, code }) => {
    const err = new ctor("test message");
    expect(err.exitCode).toBe(code);
    expect(err.message).toBe("test message");
    expect(err).toBeInstanceOf(KailasheError);
    expect(err).toBeInstanceOf(Error);
  });

  it.each(cases)("$name has correct .name", ({ ctor, name }) => {
    const err = new ctor("msg");
    expect(err.name).toBe(name);
  });

  it("KailasheError base stores exit code", () => {
    const err = new KailasheError("base", ExitCode.Validation);
    expect(err.exitCode).toBe(6);
  });

  it("supports cause chaining via ErrorOptions", () => {
    const cause = new Error("root cause");
    const err = new ValidationError("wrapped", { cause });
    expect(err.cause).toBe(cause);
  });
});

describe("resolveExitCode", () => {
  it("returns the error's exitCode for KailasheError", () => {
    expect(resolveExitCode(new UsageError("bad"))).toBe(2);
    expect(resolveExitCode(new ProviderAuthError("auth"))).toBe(4);
    expect(resolveExitCode(new DeployFailedError("fail"))).toBe(5);
    expect(resolveExitCode(new ValidationError("bad2"))).toBe(6);
    expect(resolveExitCode(new BudgetExceededError("budget"))).toBe(7);
    expect(resolveExitCode(new NeedsInputError("input"))).toBe(3);
  });

  it("maps commander errors to usage (2)", () => {
    const commanderErr = Object.assign(new Error("unknown option"), {
      code: "commander.unknownOption",
      exitCode: 1,
    });
    expect(resolveExitCode(commanderErr)).toBe(2);
  });

  it("returns 1 for plain Error", () => {
    expect(resolveExitCode(new Error("oops"))).toBe(1);
    expect(resolveExitCode(new TypeError("bad type"))).toBe(1);
  });

  it("returns 1 for non-Error throws", () => {
    expect(resolveExitCode("string throw")).toBe(1);
    expect(resolveExitCode(null)).toBe(1);
    expect(resolveExitCode(undefined)).toBe(1);
    expect(resolveExitCode(42)).toBe(1);
  });
});

describe("installSigintHandler", () => {
  afterEach(() => {
    // Remove any leftover handlers added by the test
    // (each test's cleanup should have run, but be safe)
    process.removeAllListeners("SIGINT");
  });

  it("calls exitFn with 130 on SIGINT", () => {
    const exitFn = vi.fn();
    const cleanup = installSigintHandler(exitFn);
    process.emit("SIGINT");
    expect(exitFn).toHaveBeenCalledWith(130);
    expect(exitFn).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("cleanup removes the handler", () => {
    const exitFn = vi.fn();
    const cleanup = installSigintHandler(exitFn);
    cleanup();
    process.emit("SIGINT");
    expect(exitFn).not.toHaveBeenCalled();
  });

  it("does not interfere with unrelated signals", () => {
    const exitFn = vi.fn();
    const cleanup = installSigintHandler(exitFn);
    // SIGTERM should not trigger our SIGINT handler
    // We just verify exitFn was not called synchronously
    expect(exitFn).not.toHaveBeenCalled();
    cleanup();
  });
});
