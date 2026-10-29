import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HQ_TEMPLATES, renderHqCsv, writeHqTemplates } from "../src/index.js";

const EXPECTED: Record<string, string[]> = {
  backlog: [
    "id", "title", "goal", "channel", "route", "approval", "inputs", "steps",
    "success_check", "kpi", "impact", "confidence", "effort", "depends_on",
    "status", "evidence", "notes",
  ],
  "content-calendar": ["piece", "keyword", "intent", "stage", "dates", "url", "results"],
  "directory-tracker": ["directory", "submit_url", "submitted", "status", "listing_url", "notes"],
  "outreach-crm": ["target", "type", "contact_route", "status", "last_touch", "next_step"],
  "flows-registry": ["flow", "tool", "trigger", "purpose", "last_run", "alert_target"],
};

describe("HQ templates (ops-loop §1)", () => {
  it("exposes exactly the 5 templates with §1/§2 headers and descriptions", () => {
    expect(Object.keys(HQ_TEMPLATES).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [name, columns] of Object.entries(EXPECTED)) {
      const template = HQ_TEMPLATES[name as keyof typeof HQ_TEMPLATES];
      expect(template.columns).toEqual(columns);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.fileName).toBe(`${name}.csv`);
    }
  });

  it("renderHqCsv returns the header row only", () => {
    for (const [name, columns] of Object.entries(EXPECTED)) {
      expect(renderHqCsv(name as keyof typeof HQ_TEMPLATES)).toBe(columns.join(","));
    }
    expect(() => renderHqCsv("nope" as never)).toThrow();
  });

  it("writeHqTemplates creates all 5 files with correct headers and is idempotent", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kailashe-hq-"));
    try {
      const nested = path.join(dir, "nested", ".kailashe", "hq");
      const written = await writeHqTemplates(nested);
      expect(written).toHaveLength(5);
      for (const [name, columns] of Object.entries(EXPECTED)) {
        const content = await fs.readFile(path.join(nested, `${name}.csv`), "utf-8");
        expect(content).toBe(`${columns.join(",")}\n`);
      }
      // Idempotent: second run over existing files yields identical bytes.
      const again = await writeHqTemplates(nested);
      expect(again).toEqual(written);
      for (const [name, columns] of Object.entries(EXPECTED)) {
        const content = await fs.readFile(path.join(nested, `${name}.csv`), "utf-8");
        expect(content).toBe(`${columns.join(",")}\n`);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
