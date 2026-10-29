import { formatDoctorOutput, runDoctorChecks } from "../doctor.js";

export { runDoctorChecks, formatDoctorOutput } from "../doctor.js";
export type { DoctorCheck } from "../doctor.js";

export function runDoctor(): void {
  const checks = runDoctorChecks();
  console.log(formatDoctorOutput(checks));
  console.log(`  cwd: ${process.cwd()}`);
  process.exitCode = 0;
}
