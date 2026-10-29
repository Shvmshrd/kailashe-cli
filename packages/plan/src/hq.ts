/**
 * HQ CSV templates — S9b (ops-loop.md §1).
 *
 * One CSV per HQ table/sheet named in ops-loop §1:
 *   02 Backlog (§2 task schema), 03 Content calendar,
 *   04 Directory tracker, 05 Outreach CRM, 06 Flows registry.
 *
 * Templates are header-only: the operator fills rows in. Column names
 * are the snake_case form of the shapes spelled out in ops-loop §1/§2.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

export const HqTemplateNameSchema = z.enum([
  "backlog",
  "content-calendar",
  "directory-tracker",
  "outreach-crm",
  "flows-registry",
]);

export type HqTemplateName = z.infer<typeof HqTemplateNameSchema>;

export interface HqTemplate {
  /** Stable template id. */
  name: HqTemplateName;
  /** File written by writeHqTemplates for this template. */
  fileName: string;
  /** Header columns, in order. */
  columns: readonly string[];
  /** What the table holds (ops-loop §1 wording). */
  description: string;
}

export const HQ_TEMPLATES: Readonly<Record<HqTemplateName, HqTemplate>> = {
  // ops-loop §2: every backlog row has these fields.
  backlog: {
    name: "backlog",
    fileName: "backlog.csv",
    columns: [
      "id",
      "title",
      "goal",
      "channel",
      "route",
      "approval",
      "inputs",
      "steps",
      "success_check",
      "kpi",
      "impact",
      "confidence",
      "effort",
      "depends_on",
      "status",
      "evidence",
      "notes",
    ],
    description: "One row per task. Schema in ops-loop section 2.",
  },
  // ops-loop §1: "Piece, keyword, intent, stage, dates, URL, results."
  "content-calendar": {
    name: "content-calendar",
    fileName: "content-calendar.csv",
    columns: ["piece", "keyword", "intent", "stage", "dates", "url", "results"],
    description: "Piece, keyword, intent, stage, dates, URL, results.",
  },
  // ops-loop §1: "Directory, submit URL, submitted, status, listing URL, notes."
  "directory-tracker": {
    name: "directory-tracker",
    fileName: "directory-tracker.csv",
    columns: ["directory", "submit_url", "submitted", "status", "listing_url", "notes"],
    description: "Directory, submit URL, submitted, status, listing URL, notes.",
  },
  // ops-loop §1: "Target, type, contact route, status, last touch, next step."
  "outreach-crm": {
    name: "outreach-crm",
    fileName: "outreach-crm.csv",
    columns: ["target", "type", "contact_route", "status", "last_touch", "next_step"],
    description: "Target, type, contact route, status, last touch, next step.",
  },
  // ops-loop §1: "Flow, tool, trigger, purpose, last run, alert target."
  "flows-registry": {
    name: "flows-registry",
    fileName: "flows-registry.csv",
    columns: ["flow", "tool", "trigger", "purpose", "last_run", "alert_target"],
    description: "Flow, tool, trigger, purpose, last run, alert target.",
  },
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeCsvCell(cell: string): string {
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/** Render the header row for one HQ template (no trailing newline). */
export function renderHqCsv(name: HqTemplateName): string {
  const parsed = HqTemplateNameSchema.parse(name);
  return HQ_TEMPLATES[parsed].columns.map(escapeCsvCell).join(",");
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const WriteDirSchema = z.string().min(1, "dir must be a non-empty path");

/**
 * Write all five HQ CSV templates (header row + newline) under `dir`,
 * creating directories as needed. Idempotent: re-running overwrites each
 * file with the same header-only content. Returns the written paths in
 * HQ_TEMPLATES order.
 */
export async function writeHqTemplates(dir: string): Promise<string[]> {
  const parsedDir = WriteDirSchema.parse(dir);
  await fs.mkdir(parsedDir, { recursive: true });
  const written: string[] = [];
  for (const template of Object.values(HQ_TEMPLATES)) {
    const filePath = path.join(parsedDir, template.fileName);
    await fs.writeFile(filePath, `${renderHqCsv(template.name)}\n`, "utf-8");
    written.push(filePath);
  }
  return written;
}
