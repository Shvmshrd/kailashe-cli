/**
 * `kailashe graph [dir]` — read the project and understand it before any
 * deploy question is asked.
 *
 *   1. Detect the stack (deterministic detector, no LLM).
 *   2. Build the project graph: Graphify's graphify-out/graph.json when the
 *      user has built one (richer: code + docs + inferred relations),
 *      otherwise Kailashe's built-in graph (files, packages, imports).
 *   3. Decide the first hosting question via the deploy hosting-flow:
 *      Vercel fits -> offer Vercel (its domain is used, no kailashe.tech
 *      step); otherwise the user picks a host and only then sees the
 *      domain options.
 */

import { Command } from "commander";
import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  buildProjectGraph,
  detectProjectProfile,
  graphifySetupLines,
  loadGraphifyGraph,
  summarizeGraphifyGraph,
  summarizeProjectGraph,
  type DetectedProfile,
  type GraphifyGraphSummary,
  type ProjectGraphSummary,
} from "@kailashe/scan";
import {
  assessVercelFit,
  resolveHostingFlow,
  type HostingFlowStep,
  type VercelFit,
  type VercelFitInput,
} from "@kailashe/deploy";
import { ExitCode } from "../exit-codes.js";

export interface GraphReport {
  dir: string;
  profile: {
    appType: string;
    framework: string | null;
    artifactKind: string;
    rendering: string;
    ports: number[];
  };
  graphSource: "graphify" | "builtin";
  graphify: GraphifyGraphSummary | null;
  builtin: ProjectGraphSummary | null;
  vercelFit: VercelFit;
  nextStep: HostingFlowStep;
}

/** Adapter from the scan DetectedProfile shape (fields wrapped in {value,...}). */
export function vercelFitInputFromDetected(profile: DetectedProfile): VercelFitInput {
  const envNames = profile.envVars.value ?? [];
  return {
    appType: profile.appType.value,
    artifactKind: profile.artifactKind.value,
    rendering: profile.rendering.value,
    needsGpu: envNames.some((n) => /GPU|CUDA|MODEL|INFERENCE/i.test(n)) || undefined,
    hasDatabase: profile.resourceHints.value.some((h) => h.type === "database") || undefined,
  };
}

export async function buildGraphReport(dir: string): Promise<GraphReport> {
  const root = path.resolve(dir);
  if (!existsSync(root)) throw new Error(`Directory not found: ${root}`);

  const profile = await detectProjectProfile(root);
  const graphifyGraph = await loadGraphifyGraph(root);

  let graphSource: GraphReport["graphSource"];
  let graphify: GraphifyGraphSummary | null = null;
  let builtin: ProjectGraphSummary | null = null;
  if (graphifyGraph) {
    graphSource = "graphify";
    graphify = summarizeGraphifyGraph(graphifyGraph);
  } else {
    graphSource = "builtin";
    const graph = await buildProjectGraph(root, {
      appType: profile.appType.value,
      framework: profile.framework.value,
    });
    builtin = summarizeProjectGraph(graph);
  }

  const vercelFit = assessVercelFit(vercelFitInputFromDetected(profile));
  return {
    dir: root,
    profile: {
      appType: profile.appType.value,
      framework: profile.framework.value,
      artifactKind: profile.artifactKind.value,
      rendering: profile.rendering.value,
      ports: profile.ports.value,
    },
    graphSource,
    graphify,
    builtin,
    vercelFit,
    nextStep: resolveHostingFlow({ vercelFit }),
  };
}

export function formatGraphReport(report: GraphReport): string[] {
  const lines: string[] = [];
  const p = report.profile;
  lines.push(`Project: ${report.dir}`);
  lines.push(
    `App: ${p.appType}${p.framework ? ` (${p.framework})` : ""} - ${p.rendering} - artifact: ${p.artifactKind}` +
      (p.ports.length > 0 ? ` - ports: ${p.ports.join(", ")}` : ""),
  );
  lines.push("");

  if (report.graphify) {
    const g = report.graphify;
    const types = Object.entries(g.byFileType).map(([k, v]) => `${k}: ${v}`).join(", ");
    lines.push(`Project graph (Graphify - graphify-out/graph.json): ${g.nodes} nodes, ${g.links} links`);
    lines.push(`  node types: ${types}`);
    if (g.extractedShare !== null) {
      lines.push(`  relations extracted from source: ${Math.round(g.extractedShare * 100)}% (rest inferred)`);
    }
    if (g.godNodes.length > 0) {
      lines.push(`  key concepts: ${g.godNodes.map((n) => `${n.label} (${n.degree})`).join(", ")}`);
    }
    if (g.keyFiles.length > 0) lines.push(`  key files: ${g.keyFiles.join(", ")}`);
  } else if (report.builtin) {
    const g = report.builtin;
    lines.push("Project graph (built-in fallback - no graphify-out/graph.json found):");
    lines.push(`  ${g.files} files - ${g.directories} directories - ${g.packages} packages - ${g.importEdges} import edges`);
    if (g.entrypoints.length > 0) lines.push(`  entrypoints: ${g.entrypoints.join(", ")}`);
    if (g.topConnected.length > 0) {
      lines.push(`  most connected: ${g.topConnected.map((n) => `${n.label} (${n.kind}, ${n.degree})`).join(", ")}`);
    }
  }
  lines.push("");

  const fit = report.vercelFit;
  if (fit.eligible) {
    lines.push("Vercel fit: YES");
    for (const reason of fit.reasons) lines.push(`  - ${reason}`);
    for (const note of fit.notes) lines.push(`  - note: ${note}`);
    lines.push("Next step: Kailashe offers Vercel deploy first. A Vercel deploy uses the Vercel domain itself -");
    lines.push("the kailashe.tech subdomain step is skipped. Declining Vercel is fine: pick another host,");
    lines.push("then choose your own domain or a free <label>.kailashe.tech subdomain.");
  } else {
    lines.push("Vercel fit: NO");
    for (const blocker of fit.blockers) lines.push(`  - ${blocker}`);
    lines.push("Next step: pick where to deploy (Cloudflare Workers, Modal, Fly, DigitalOcean, ...).");
    lines.push("Your provider account stays yours - log in with that provider's own CLI; Kailashe never");
    lines.push("takes provider credentials. After the deploy, choose your own domain or a free");
    lines.push("<label>.kailashe.tech subdomain.");
  }

  if (report.graphSource === "builtin") {
    lines.push("");
    lines.push(...graphifySetupLines());
  }
  return lines;
}

export function createGraphCommand(): Command {
  return new Command("graph")
    .description("read and graph the project (Graphify when available), then show the first hosting step")
    .argument("[dir]", "project directory (default: current directory)")
    .option("--json", "emit the full report as one JSON object")
    .action(async (dir: string | undefined, flags: { json?: boolean }) => {
      try {
        const report = await buildGraphReport(dir ?? process.cwd());
        if (flags.json) console.log(JSON.stringify(report, null, 2));
        else for (const line of formatGraphReport(report)) console.log(line);
        process.exitCode = ExitCode.Ok;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = ExitCode.Validation;
      }
    });
}
