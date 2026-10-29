/**
 * ComposeInput — SPEC §6.12
 * Every placeholder in skill/kailashe-operator/assets/prompt.template.md.
 */

export interface ComposeInput {
  project: {
    name: string;
    url: string;
    repo: string;
  };
  date: string;
  plan: {
    version: string;
  };
  brief: {
    what: string;
    audience: string;
    problem: string;
    features: string;
    pricing: string;
    limits: string;
    voice: string;
    donotsay: string;
    links: string;
    owner: string;
  };
  market: {
    date: string;
    archetype: string;
    archetype_reason: string;
    trends_table: string;
    clusters_table: string;
    gaps: string;
    competitors_table: string;
    communities_table: string;
    unknowns: string;
    json_ref: string;
  };
  goals: {
    ninety: string;
  };
  kpi_table: string;
  channels_ranked: string;
  content_plan: string;
  flows: string;
  later_list: string;
  checklist: string;
  tool_manifest_yaml: string;
  hubs_in_use: string;
  backlog_yaml: string;
  owner: {
    tz: string;
    contact: string;
  };
  budget: {
    cap: string;
    paid: string;
  };
  preapproved: string;
  never: string;
  playbooks_included: string;
}

/**
 * Result of composing prompt.md.
 */
export interface ComposeResult {
  /** Main prompt content (budget-capped at ~4000 words). */
  prompt: string;
  /** Overflow appendix files when budget exceeded: filename -> content. */
  appendix: Record<string, string>;
}

/**
 * Options for compose().
 */
export interface ComposeOptions {
  /** Word budget for the main prompt file (default 4000). */
  wordBudget?: number;
  /** SKILL.md body text (from "Start of every session" to "Style of your output"). */
  skillBody?: string;
  /** Template text override (defaults to reading prompt.template.md). */
  template?: string;
  /** ops-loop.md section 1 text (Project HQ layout) for template section 6. */
  hqSection?: string;
  /** ops-loop.md section 7 text (weekly report format) for template section 10. */
  weeklyReportSection?: string;
}

/** Default word budget per SPEC §6.10 / template comment. */
export const WORD_BUDGET_DEFAULT = 4000;

/** Maximum length of a third-party text block (chars). */
export const THIRD_PARTY_BLOCK_MAX = 4000;
