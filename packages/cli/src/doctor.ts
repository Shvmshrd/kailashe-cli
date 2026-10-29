/**
 * `kailashe doctor` — environment diagnostics (stub for S0/S1).
 * Checks node / pnpm / git and reports them. The doctor command always
 * exits 0 (stub); individual checks may report `ok: false` (e.g. a tool
 * missing) without failing the command.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function findOnPath(name: string): string | undefined {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (existsSync(candidate)) return candidate;
      const upper = path.join(dir, name + ext.toUpperCase());
      if (existsSync(upper)) return upper;
    }
    const bare = path.join(dir, name);
    if (existsSync(bare)) return bare;
  }
  return undefined;
}

function checkBinary(name: string): DoctorCheck {
  try {
    const out = execFileSync(name, ["--version"], {
      timeout: 5000,
      encoding: "utf-8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = out.split(/\r?\n/)[0]?.trim() ?? "";
    return { name, ok: true, detail: first || `${name} available` };
  } catch {
    // On Windows, pnpm/git shims (.cmd) often cannot be spawned without a
    // shell (which we never use). Fall back to a PATH presence check.
    const found = findOnPath(name);
    if (found) return { name, ok: true, detail: `found at ${found}` };
    return { name, ok: false, detail: `${name} not found on PATH` };
  }
}

export function runDoctorChecks(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: major >= 20,
    detail: `node ${process.versions.node} ${major >= 20 ? "ok" : "requires >=20"}`,
  });
  checks.push(checkBinary("pnpm"));
  checks.push(checkBinary("git"));
  checks.push({
    name: "platform",
    ok: true,
    detail: `${process.platform} ${process.arch}`,
  });
  return checks;
}

export function formatDoctorOutput(checks: DoctorCheck[]): string {
  const lines: string[] = ["kailashe doctor — environment check", ""];
  for (const c of checks) {
    const icon = c.ok ? "ok" : "fail";
    lines.push(`  [${icon}] ${c.name}: ${c.detail}`);
  }
  return lines.join("\n");
}
