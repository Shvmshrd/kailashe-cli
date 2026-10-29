/**
 * Directories + listing kit — S9c (channels.md §2).
 *
 * Q7 license note: the ai-directories / OpenLaunch list licenses cannot be
 * verified offline, so NO rows are copied here. This module ships only:
 *   - vetDirectories: pure vetting/scoring of caller-supplied rows,
 *   - importDirectories: a Zod-validated CSV importer,
 *   - renderDirectoriesSeedCsv: an EMPTY (header-only) seed,
 *   - buildListingKit: the channels.md §2 listing kit built from a brief.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Directory rows
// ---------------------------------------------------------------------------

export const DirectoryPricingSchema = z.enum(["free", "paid", "freemium", "pay-to-list", "unknown"]);

export type DirectoryPricing = z.infer<typeof DirectoryPricingSchema>;

export const DirectoryRowSchema = z.object({
  name: z.string().min(1, "name is required"),
  url: z.string().url("url must be a valid URL"),
  category: z.string().optional(),
  pricing: DirectoryPricingSchema.optional(),
  notes: z.string().optional(),
  dead: z.boolean().optional(),
  linkFarm: z.boolean().optional(),
  payToList: z.boolean().optional(),
  sellsLinks: z.boolean().optional(),
  sellsFakeReviews: z.boolean().optional(),
  /** 0-5, higher is more relevant. */
  relevance: z.number().min(0).max(5).optional(),
  /** 0-5, higher is higher quality. */
  quality: z.number().min(0).max(5).optional(),
});

export type DirectoryRow = z.infer<typeof DirectoryRowSchema>;

export interface VettedDirectory extends DirectoryRow {
  /** 0-100 vetting score; higher ranks first. */
  score: number;
}

/** True when a row must be dropped per channels.md §2 step 1. */
function isDropped(row: DirectoryRow): boolean {
  return Boolean(
    row.dead ||
      row.linkFarm ||
      row.payToList ||
      row.sellsLinks ||
      row.sellsFakeReviews ||
      row.pricing === "pay-to-list",
  );
}

function scoreRow(row: DirectoryRow): number {
  const relevance = row.relevance ?? 3;
  const quality = row.quality ?? 3;
  let score = ((relevance * 0.6 + quality * 0.4) / 5) * 100;
  if (row.pricing === "paid") score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Vet caller-supplied directory rows: drop dead, link-farm, pay-to-list,
 * link-selling and fake-review-selling rows, score the rest (0-100) and
 * return them best-first. Pure: input rows are not mutated.
 */
export function vetDirectories(rows: readonly DirectoryRow[]): VettedDirectory[] {
  const parsed = z.array(DirectoryRowSchema).parse(rows);
  return parsed
    .filter((row) => !isDropped(row))
    .map((row) => ({ ...row, score: scoreRow(row) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// CSV importer (empty seed — no rows are bundled, see Q7 note above)
// ---------------------------------------------------------------------------

export const DIRECTORY_SEED_COLUMNS = [
  "name",
  "url",
  "category",
  "pricing",
  "notes",
  "dead",
  "link_farm",
  "pay_to_list",
  "sells_links",
  "sells_fake_reviews",
  "relevance",
  "quality",
] as const;

/** Empty seed CSV: header row only, no directory rows (Q7). */
export function renderDirectoriesSeedCsv(): string {
  return DIRECTORY_SEED_COLUMNS.join(",");
}

/** Minimal RFC-4180-style CSV parser (quoted cells, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const pushCell = (): void => {
    row.push(cell);
    cell = "";
  };
  const pushRow = (): void => {
    pushCell();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      pushCell();
      i += 1;
    } else if (ch === "\n") {
      pushRow();
      i += 1;
    } else if (ch === "\r") {
      i += 1;
    } else {
      cell += ch;
      i += 1;
    }
  }
  if (inQuotes) throw new Error("Invalid CSV: unterminated quoted cell");
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

function parseBool(value: string | undefined, field: string, rowNum: number): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  const lower = value.toLowerCase();
  if (["true", "yes", "1"].includes(lower)) return true;
  if (["false", "no", "0"].includes(lower)) return false;
  throw new Error(`Invalid directory row ${rowNum}: ${field} must be true/false, got "${value}"`);
}

function parseScore(value: string | undefined, field: string, rowNum: number): number | undefined {
  if (value === undefined || value === "") return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid directory row ${rowNum}: ${field} must be a number, got "${value}"`);
  }
  return num;
}

const PricingInputSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(DirectoryPricingSchema);

/**
 * Parse directory CSV text (header + rows) into Zod-validated rows.
 * Throws on a missing/unknown header, malformed CSV or any invalid row —
 * bad rows are rejected, never silently dropped.
 */
export function importDirectories(csvText: string): DirectoryRow[] {
  const text = z.string().parse(csvText);
  const rawRows = parseCsv(text).filter(
    (r) => !(r.length === 1 && r[0]!.trim() === ""),
  );
  if (rawRows.length === 0) throw new Error("Invalid directory CSV: missing header row");

  const header = rawRows[0]!.map((h) => h.trim());
  const known = new Set<string>(DIRECTORY_SEED_COLUMNS);
  for (const col of header) {
    if (!known.has(col)) throw new Error(`Invalid directory CSV: unknown column "${col}"`);
  }
  for (const required of ["name", "url"] as const) {
    if (!header.includes(required)) {
      throw new Error(`Invalid directory CSV: missing required column "${required}"`);
    }
  }

  const out: DirectoryRow[] = [];
  for (let idx = 1; idx < rawRows.length; idx++) {
    const rowNum = idx + 1; // 1-based, counting the header
    const cells = rawRows[idx]!;
    if (cells.length > header.length) {
      throw new Error(`Invalid directory row ${rowNum}: expected ${header.length} cells, got ${cells.length}`);
    }
    const byColumn = new Map<string, string>();
    header.forEach((col, colIdx) => byColumn.set(col, (cells[colIdx] ?? "").trim()));

    const candidate: Record<string, unknown> = {
      name: byColumn.get("name") ?? "",
      url: byColumn.get("url") ?? "",
    };
    const category = byColumn.get("category");
    if (category) candidate.category = category;
    const notes = byColumn.get("notes");
    if (notes) candidate.notes = notes;
    const pricingRaw = byColumn.get("pricing");
    if (pricingRaw) {
      const pricing = PricingInputSchema.safeParse(pricingRaw);
      if (!pricing.success) {
        throw new Error(`Invalid directory row ${rowNum}: pricing must be free, paid, freemium, pay-to-list or unknown`);
      }
      candidate.pricing = pricing.data;
    }
    const dead = parseBool(byColumn.get("dead"), "dead", rowNum);
    if (dead !== undefined) candidate.dead = dead;
    const linkFarm = parseBool(byColumn.get("link_farm"), "link_farm", rowNum);
    if (linkFarm !== undefined) candidate.linkFarm = linkFarm;
    const payToList = parseBool(byColumn.get("pay_to_list"), "pay_to_list", rowNum);
    if (payToList !== undefined) candidate.payToList = payToList;
    const sellsLinks = parseBool(byColumn.get("sells_links"), "sells_links", rowNum);
    if (sellsLinks !== undefined) candidate.sellsLinks = sellsLinks;
    const sellsFakeReviews = parseBool(byColumn.get("sells_fake_reviews"), "sells_fake_reviews", rowNum);
    if (sellsFakeReviews !== undefined) candidate.sellsFakeReviews = sellsFakeReviews;
    const relevance = parseScore(byColumn.get("relevance"), "relevance", rowNum);
    if (relevance !== undefined) candidate.relevance = relevance;
    const quality = parseScore(byColumn.get("quality"), "quality", rowNum);
    if (quality !== undefined) candidate.quality = quality;

    const result = DirectoryRowSchema.safeParse(candidate);
    if (!result.success) {
      const detail = result.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ");
      throw new Error(`Invalid directory row ${rowNum}: ${detail}`);
    }
    out.push(result.data);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Listing kit (channels.md §2)
// ---------------------------------------------------------------------------

export const ListingKitBriefSchema = z
  .object({
    name: z.string().min(1, "name is required"),
    tagline: z.string().optional(),
    description: z.string().optional(),
    what: z.string().optional(),
    audience: z.string().optional(),
    problem: z.string().optional(),
    features: z.array(z.string().min(1)).optional(),
    pricing: z.string().optional(),
    categories: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
    links: z
      .object({
        site: z.string().url().optional(),
        docs: z.string().url().optional(),
        repo: z.string().url().optional(),
        demoVideo: z.string().url().optional(),
      })
      .optional(),
    founderBio: z.string().optional(),
    supportEmail: z.string().email().optional(),
    socialHandles: z.array(z.string().min(1)).optional(),
    assets: z
      .object({
        logoSquare: z.string().optional(),
        logoWide: z.string().optional(),
        screenshots: z.array(z.string()).optional(),
        demoVideo: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((brief, ctx) => {
    if (!brief.tagline && !brief.description && !brief.what) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "brief needs a tagline, description or what to build an honest kit from",
      });
    }
  });

export type ListingKitBrief = z.infer<typeof ListingKitBriefSchema>;

export interface ListingKitAssetCheck {
  item: string;
  ready: boolean;
  detail?: string;
}

export interface ListingKit {
  name: string;
  /** Exactly 3 tagline variants, all derived from the brief. */
  taglines: [string, string, string];
  descriptions: {
    /** ~160 characters. */
    short: string;
    /** ~300 characters. */
    medium: string;
    /** ~500 characters. */
    long: string;
  };
  categories: string[];
  tags: string[];
  pricingSummary: string;
  links: { site?: string; docs?: string; repo?: string; demoVideo?: string };
  founderBio: string;
  supportEmail: string;
  socialHandles: string[];
  assetChecklist: ListingKitAssetCheck[];
}

function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const cut = trimmed.search(/[.!?]\s/);
  return (cut === -1 ? trimmed : trimmed.slice(0, cut + 1)).trim();
}

function ensureSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Fit brief-derived fragments to ~target chars: truncate, or pad by reusing only brief fragments. */
function fitDescription(fragments: readonly string[], target: number): string {
  const clean = fragments.map((f) => f.trim()).filter((f) => f.length > 0);
  if (clean.length === 0) return "";
  let text = "";
  let idx = 0;
  while (text.length < target) {
    const next = clean[idx % clean.length]!;
    text = text ? `${text} ${next}` : next;
    idx += 1;
    if (idx > clean.length * 4 && text.length >= target) break;
    if (idx > 100) break;
  }
  if (text.length <= target) return text;
  const cut = text.slice(0, target);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > target * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Build the channels.md §2 listing kit from a brief. Taglines (exactly 3)
 * and descriptions (~160/300/500 chars) are derived only from brief text —
 * truncated or padded by reusing brief fragments, never invented claims.
 */
export function buildListingKit(briefInput: ListingKitBrief): ListingKit {
  const brief = ListingKitBriefSchema.parse(briefInput);

  const mainText = brief.description ?? brief.what ?? brief.tagline!;
  const baseTagline = firstSentence(brief.tagline ?? mainText);

  const taglineCandidates: string[] = [baseTagline];
  if (brief.features && brief.features.length > 0) {
    taglineCandidates.push(`${brief.name} — ${brief.features[0]!}`);
  }
  if (brief.audience) {
    taglineCandidates.push(`${baseTagline} for ${brief.audience}`);
  }
  if (!baseTagline.toLowerCase().startsWith(brief.name.toLowerCase())) {
    taglineCandidates.push(`${brief.name} — ${baseTagline}`);
  }
  taglineCandidates.push(brief.name);
  const taglines: string[] = [];
  for (const candidate of taglineCandidates) {
    const cleaned = candidate.trim().replace(/\s+/g, " ");
    if (cleaned && !taglines.includes(cleaned)) taglines.push(cleaned);
    if (taglines.length === 3) break;
  }
  while (taglines.length < 3) taglines.push(brief.name);

  const fragments: string[] = [ensureSentence(mainText)];
  if (brief.tagline && brief.description) fragments.push(ensureSentence(brief.tagline));
  if (brief.problem) fragments.push(ensureSentence(brief.problem));
  if (brief.audience) fragments.push(`Made for ${brief.audience}.`);
  if (brief.features && brief.features.length > 0) {
    fragments.push(`Features include ${brief.features.join(", ")}.`);
    for (const feature of brief.features) fragments.push(`Includes ${feature}.`);
  }
  if (brief.pricing) fragments.push(`Pricing: ${brief.pricing}.`.replace(/\.\.$/, "."));
  const categories = brief.categories ?? [];
  if (categories.length > 0) fragments.push(`Categories: ${categories.join(", ")}.`);
  fragments.push(`${brief.name}.`);

  const screenshots = brief.assets?.screenshots ?? [];
  const demoVideo = brief.links?.demoVideo ?? brief.assets?.demoVideo;
  const assetChecklist: ListingKitAssetCheck[] = [
    { item: "Logo (square)", ready: Boolean(brief.assets?.logoSquare), detail: brief.assets?.logoSquare },
    { item: "Logo (wide)", ready: Boolean(brief.assets?.logoWide), detail: brief.assets?.logoWide },
    {
      item: "Screenshots (3 to 5)",
      ready: screenshots.length >= 3 && screenshots.length <= 5,
      detail: screenshots.length > 0 ? `${screenshots.length} provided` : undefined,
    },
    { item: "Short demo video link", ready: Boolean(demoVideo), detail: demoVideo },
    { item: "Founder bio", ready: Boolean(brief.founderBio) },
    { item: "Support email that works", ready: Boolean(brief.supportEmail), detail: brief.supportEmail },
    { item: "Pricing summary", ready: Boolean(brief.pricing), detail: brief.pricing },
    {
      item: "Social handles",
      ready: (brief.socialHandles ?? []).length > 0,
      detail: brief.socialHandles?.join(", "),
    },
  ];

  return {
    name: brief.name,
    taglines: [taglines[0]!, taglines[1]!, taglines[2]!],
    descriptions: {
      short: fitDescription(fragments, 160),
      medium: fitDescription(fragments, 300),
      long: fitDescription(fragments, 500),
    },
    categories: [...categories],
    tags: [...(brief.tags ?? [])],
    pricingSummary: brief.pricing ?? "",
    links: { ...(brief.links ?? {}) },
    founderBio: brief.founderBio ?? "",
    supportEmail: brief.supportEmail ?? "",
    socialHandles: [...(brief.socialHandles ?? [])],
    assetChecklist,
  };
}
