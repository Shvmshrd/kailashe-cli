/**
 * Archetype selection — detection hints + LLM tiebreak with evidence, user override.
 *
 * Resolution order:
 *  1. User override (explicit archetype id) wins immediately.
 *  2. Deterministic hint scoring — each archetype's `detect[]` phrases are matched
 *     against the supplied `profileHints` (app type, keywords, feature labels).
 *  3. If a single winner emerges, return it.
 *  4. If there is a tie (or all scores are 0), consult market evidence, then the
 *     LLM tiebreak if an LLMClient is available. Evidence is always cited.
 */

import type { LLMClient } from "@kailashe/core/llm/client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArchetypeId =
  | "dev-tool"
  | "b2b-saas"
  | "b2c-app"
  | "ai-tool"
  | "content-media"
  | "ecommerce"
  | "local-service"
  | "digital-product"
  | "free-utility";

export interface ArchetypeDefinition {
  id: ArchetypeId;
  name: string;
  detect: string[];
  audience: string;
  channels_ranked: string[];
  content_mix: { bottom: number; middle: number; top: number; proof: number };
  first_30_days: string[];
  flows: string[];
  kpis: string[];
  cautions: string[];
}

/** Hints derived from the project profile / brief. */
export interface ProfileHints {
  /** App type label from the profile detector (e.g. "static site", "saas", "api"). */
  appType?: string;
  /** Keywords / feature labels the brief mentions. */
  keywords?: string[];
  /** Feature flags: e.g. hasLogin, hasBilling, hasCart, hasModelCalls */
  hasFeature?: Record<string, boolean>;
}

/** Evidence forwarded from market research. */
export interface MarketEvidence {
  /** Trend findings that may hint at a market type. */
  trends?: Array<{ term: string; shape?: string; region?: string }>;
  /** Competitor audience labels. */
  competitorAudiences?: string[];
  /** Community fit hints. */
  communityHints?: string[];
}

export interface SelectArchetypeInput {
  profileHints: ProfileHints;
  marketEvidence?: MarketEvidence;
  /** User-specified override — always wins when present and valid. */
  archetypeOverride?: string;
}

export interface SelectArchetypeResult {
  id: ArchetypeId;
  reason: string;
}

// ---------------------------------------------------------------------------
// Static archetype registry (mirrors archetypes.yaml — canonical source)
// ---------------------------------------------------------------------------

export const ARCHETYPES: readonly ArchetypeDefinition[] = [
  {
    id: "dev-tool",
    name: "Developer tool or open source project",
    detect: ["package manifest with a bin or exports", "CLI or SDK or API", "README-led repo", "docs site"],
    audience: "developers and technical founders",
    channels_ranked: ["docs-and-readme", "hacker-news", "communities", "social-dev", "directories", "newsletters-and-podcasts", "integrations-and-awesome-lists", "seo-comparisons"],
    content_mix: { bottom: 20, middle: 50, top: 15, proof: 15 },
    first_30_days: ["seo-basics", "docs-quality-pass", "listing-kit", "directories-batch-1", "show-hn-draft", "three-how-to-guides", "github-readme-polish"],
    flows: ["github-star-alerts", "release-to-social", "mentions-watch", "gsc-weekly", "uptime-alert"],
    kpis: ["github_stars", "installs", "docs_visits", "signups", "referring_domains"],
    cautions: ["Developer communities punish marketing tone. Lead with the problem and the code.", "Docs quality is the best SEO. Fix docs before writing blog posts."],
  },
  {
    id: "b2b-saas",
    name: "B2B software as a service",
    detect: ["login and billing", "team or workspace features", "pricing page with tiers", "integrations"],
    audience: "teams, managers, operators",
    channels_ranked: ["seo-bottom-funnel", "directories-and-review-sites", "communities", "linkedin", "email-and-outreach", "partnerships", "launch-platforms"],
    content_mix: { bottom: 40, middle: 35, top: 10, proof: 15 },
    first_30_days: ["seo-basics", "listing-kit", "alternatives-pages", "comparison-pages", "review-site-profiles", "welcome-sequence", "three-case-notes"],
    flows: ["lead-route", "signup-welcome", "payment-events", "review-request", "support-triage", "gsc-weekly", "mentions-watch"],
    kpis: ["demo_requests", "trials", "activation_rate", "qualified_visits", "pipeline", "referring_domains"],
    cautions: ["Cold outreach is class C per recipient. Keep batches small and specific.", "Claims about competitors need a link and a date."],
  },
  {
    id: "b2c-app",
    name: "Consumer web or mobile app",
    detect: ["consumer signup", "mobile or PWA", "social login", "free tier", "app store links"],
    audience: "general consumers or a clear niche",
    channels_ranked: ["short-video-and-social", "communities", "app-store-or-seo", "directories", "email", "influencers-and-creators", "referral-loops"],
    content_mix: { bottom: 15, middle: 35, top: 30, proof: 20 },
    first_30_days: ["seo-basics", "listing-kit", "store-listing-pass", "content-pillars", "first-20-posts", "community-research", "referral-idea"],
    flows: ["signup-welcome", "review-request", "mentions-watch", "uptime-alert", "content-to-social"],
    kpis: ["installs_or_signups", "day_7_retention", "share_rate", "reviews", "cost_per_signup"],
    cautions: ["Retention beats installs. Report activation and day-7 retention next to signups.", "Respect platform rules on incentives for reviews and follows."],
  },
  {
    id: "ai-tool",
    name: "AI-powered app or agent",
    detect: ["model API calls", "prompt files", "chat or agent interface", "agent or MCP integration"],
    audience: "builders, creators, operators, early adopters",
    channels_ranked: ["directories-ai", "launch-platforms", "communities", "social-x-and-linkedin", "seo-how-to-and-templates", "newsletters-and-podcasts", "integrations-and-mcp-listings"],
    content_mix: { bottom: 20, middle: 45, top: 15, proof: 20 },
    first_30_days: ["seo-basics", "listing-kit", "directories-batch-1", "directories-batch-2", "demo-video", "three-use-case-pages", "show-hn-or-launch-draft", "mcp-or-integration-listing"],
    flows: ["signup-welcome", "mentions-watch", "content-to-social", "gsc-weekly", "uptime-alert", "github-star-alerts"],
    kpis: ["signups", "activation", "weekly_active_users", "directory_listings_live", "referring_domains", "mentions"],
    cautions: ["The category is crowded. Specific use cases and real demos beat generic claims.", "State model limits and data handling plainly. Never overclaim accuracy."],
  },
  {
    id: "content-media",
    name: "Newsletter, blog, media or community",
    detect: ["editorial content", "subscribe forms", "archive pages", "RSS"],
    audience: "readers in a defined topic",
    channels_ranked: ["seo-informational", "newsletter-swaps-and-mentions", "social", "communities", "search-and-discover-feeds", "partnerships"],
    content_mix: { bottom: 5, middle: 40, top: 40, proof: 15 },
    first_30_days: ["seo-basics", "subscribe-flow", "content-calendar-12-weeks", "lead-magnet", "three-pillar-pages", "outreach-list"],
    flows: ["newsletter-pipeline", "content-to-social", "gsc-weekly", "mentions-watch"],
    kpis: ["subscribers", "open_and_click_rate", "returning_readers", "search_clicks", "sponsor_interest"],
    cautions: ["Quality and originality are the whole game. Do not scale volume past what the owner can stand behind.", "Disclose sponsorships and affiliate links."],
  },
  {
    id: "ecommerce",
    name: "Online store or marketplace",
    detect: ["cart and checkout", "product catalog", "shipping and returns pages", "store platform"],
    audience: "shoppers in a niche",
    channels_ranked: ["seo-product-and-category", "email-lifecycle", "social-and-short-video", "marketplaces", "creators-and-affiliates", "paid-after-proof"],
    content_mix: { bottom: 45, middle: 30, top: 10, proof: 15 },
    first_30_days: ["seo-basics", "product-page-pass", "category-pages", "welcome-and-cart-sequences", "review-collection", "listing-kit", "creator-shortlist"],
    flows: ["abandoned-cart", "review-request", "payment-events", "support-triage", "gsc-weekly"],
    kpis: ["conversion_rate", "revenue_per_visit", "email_revenue_share", "repeat_rate", "reviews"],
    cautions: ["Paid stays off until the product pages convert. Spend needs class C approval and a cap.", "Follow advertising and consumer-protection rules for claims and promotions."],
  },
  {
    id: "local-service",
    name: "Local or travel service business",
    detect: ["bookings", "location pages", "reviews matter", "tours or appointments", "a service area"],
    audience: "nearby customers or visiting travelers",
    channels_ranked: ["local-seo-and-maps-profile", "reviews", "social-and-visual", "partnerships-and-referrals", "email-and-chat", "directories-and-travel-sites"],
    content_mix: { bottom: 40, middle: 30, top: 15, proof: 15 },
    first_30_days: ["seo-basics", "maps-profile-pass", "location-pages", "review-collection", "photo-and-video-plan", "partner-list", "booking-flow-check"],
    flows: ["local-review-request", "support-triage", "mentions-watch", "uptime-alert"],
    kpis: ["bookings", "calls_or_messages", "reviews_and_rating", "map_views", "repeat_or_referral_rate"],
    cautions: ["Reviews and photos carry the business. Never fake either.", "Keep name, address and phone details identical everywhere."],
  },
  {
    id: "digital-product",
    name: "Templates, assets, courses or digital downloads",
    detect: ["downloads", "checkout for a product", "licence or usage terms", "preview galleries"],
    audience: "creators and professionals who want a shortcut",
    channels_ranked: ["seo-templates-and-how-to", "marketplaces-and-directories", "social-and-short-video", "communities", "email-and-lead-magnet", "creators-and-affiliates"],
    content_mix: { bottom: 35, middle: 40, top: 10, proof: 15 },
    first_30_days: ["seo-basics", "listing-kit", "free-sample", "preview-pages", "marketplace-listings", "welcome-sequence", "affiliate-offer"],
    flows: ["signup-welcome", "payment-events", "review-request", "newsletter-pipeline", "gsc-weekly"],
    kpis: ["sales", "free_sample_downloads", "email_signups", "conversion_rate", "refund_rate"],
    cautions: ["Give honest previews. Refunds and complaints hurt more than missed sales.", "Check licence terms before listing on marketplaces."],
  },
  {
    id: "free-utility",
    name: "Free tool, calculator or converter",
    detect: ["single-purpose page", "no login", "input and output", "high search intent"],
    audience: "people who search for a quick answer",
    channels_ranked: ["seo-tool-pages", "directories", "communities", "embeds-and-backlinks", "social", "email-capture"],
    content_mix: { bottom: 20, middle: 55, top: 15, proof: 10 },
    first_30_days: ["seo-basics", "tool-page-pass", "explainer-pages", "schema-and-speed-pass", "directories-batch-1", "embed-or-share-feature", "email-capture"],
    flows: ["uptime-alert", "gsc-weekly", "mentions-watch", "content-to-social"],
    kpis: ["organic_visits", "tool_uses", "share_or_embed_rate", "email_signups", "referring_domains"],
    cautions: ["Speed and accuracy are the product. Monitor uptime and wrong-result reports.", "Ads and signups must not block the tool."],
  },
] as const;

const ARCHETYPE_BY_ID = new Map<string, ArchetypeDefinition>(
  ARCHETYPES.map((a) => [a.id, a as ArchetypeDefinition]),
);

export function getArchetype(id: string): ArchetypeDefinition | undefined {
  return ARCHETYPE_BY_ID.get(id);
}

export function allArchetypeIds(): ArchetypeId[] {
  return ARCHETYPES.map((a) => a.id);
}

// ---------------------------------------------------------------------------
// Deterministic scoring
// ---------------------------------------------------------------------------

function normalise(s: string): string {
  return s.toLowerCase().trim();
}

function hintCorpus(hints: ProfileHints): string {
  const parts: string[] = [];
  if (hints.appType) parts.push(hints.appType);
  if (hints.keywords) parts.push(...hints.keywords);
  if (hints.hasFeature) {
    for (const [k, v] of Object.entries(hints.hasFeature)) {
      if (v) parts.push(k);
    }
  }
  return parts.map(normalise).join(" ");
}

function scoreArchetype(archetype: ArchetypeDefinition, corpus: string): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;
  for (const phrase of archetype.detect) {
    const words = normalise(phrase).split(/\s+/).filter(Boolean);
    // Score: fraction of words from this detect phrase found in corpus
    const hits = words.filter((w) => corpus.includes(w)).length;
    if (hits > 0) {
      // Weight by hit ratio but require at least half the words
      if (hits / words.length >= 0.4) {
        score += hits / words.length;
        matched.push(phrase);
      }
    }
  }
  return { score, matched };
}

// ---------------------------------------------------------------------------
// LLM tiebreak
// ---------------------------------------------------------------------------

async function llmTiebreak(
  tiedIds: ArchetypeId[],
  hints: ProfileHints,
  marketEvidence: MarketEvidence | undefined,
  llmClient: LLMClient,
): Promise<{ id: ArchetypeId; reason: string } | null> {
  const prompt = [
    "You are picking the best go-to-market archetype for a project.",
    `Candidates (tied): ${tiedIds.join(", ")}`,
    `Profile hints: ${JSON.stringify(hints)}`,
    `Market evidence: ${JSON.stringify(marketEvidence ?? {})}`,
    "Reply with a single JSON object: {\"id\": \"<one of the candidates>\", \"reason\": \"<one sentence with evidence>\"}",
    "Only choose from the candidate list. Cite the strongest piece of evidence.",
  ].join("\n");

  try {
    const res = await llmClient.respond({ input: prompt });
    const text = res.output_text.trim();
    // Extract JSON — LLMs sometimes wrap it
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { id?: unknown; reason?: unknown };
    if (typeof parsed.id === "string" && tiedIds.includes(parsed.id as ArchetypeId)) {
      return {
        id: parsed.id as ArchetypeId,
        reason: typeof parsed.reason === "string" ? parsed.reason : `LLM tiebreak: selected ${parsed.id} from ${tiedIds.join(", ")}`,
      };
    }
  } catch {
    // fall through to deterministic fallback
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select the best archetype for a project.
 *
 * Resolution order:
 *  1. User override (if valid).
 *  2. Deterministic hint scoring.
 *  3. Market-evidence tiebreak / LLM tiebreak if available.
 *  4. Deterministic fallback (first tied id alphabetically).
 */
export async function selectArchetype(
  profileHints: ProfileHints,
  marketEvidence?: MarketEvidence,
  llmClient?: LLMClient,
  archetypeOverride?: string,
): Promise<SelectArchetypeResult> {
  // --- 1. User override ---
  if (archetypeOverride) {
    const override = normalise(archetypeOverride);
    const found = ARCHETYPE_BY_ID.get(override);
    if (found) {
      return {
        id: found.id,
        reason: `User override: archetype explicitly set to "${found.id}" (${found.name})`,
      };
    }
    // Invalid override — fall through with a note (don't throw; be resilient)
  }

  const corpus = hintCorpus(profileHints);

  // --- 2. Deterministic scoring ---
  const scored = ARCHETYPES.map((a) => {
    const { score, matched } = scoreArchetype(a as ArchetypeDefinition, corpus);
    return { archetype: a as ArchetypeDefinition, score, matched };
  });

  scored.sort((a, b) => b.score - a.score);

  const topScore = scored[0]?.score ?? 0;

  // Single clear winner with non-zero score
  if (topScore > 0) {
    const winners = scored.filter((s) => s.score === topScore);
    if (winners.length === 1) {
      const w = winners[0]!;
      return {
        id: w.archetype.id,
        reason: `Detection hints matched "${w.matched.join("; ")}" (score ${w.score.toFixed(2)}) — archetype "${w.archetype.id}" (${w.archetype.name})`,
      };
    }

    // --- 3. Tie among non-zero scorers → LLM or fallback ---
    const tiedIds = winners.map((w) => w.archetype.id);
    if (llmClient) {
      const llmResult = await llmTiebreak(tiedIds, profileHints, marketEvidence, llmClient);
      if (llmResult) return llmResult;
    }
    // Market-evidence hint: prefer the one whose audience appears in competitor audiences
    if (marketEvidence?.competitorAudiences?.length) {
      const audienceCorpus = marketEvidence.competitorAudiences.map(normalise).join(" ");
      for (const w of winners) {
        const audienceWords = normalise(w.archetype.audience).split(/\s+/);
        if (audienceWords.some((aw) => audienceCorpus.includes(aw))) {
          return {
            id: w.archetype.id,
            reason: `Tiebreak by market evidence: competitor audience matches "${w.archetype.audience}" for archetype "${w.archetype.id}"`,
          };
        }
      }
    }
    // Deterministic fallback: alphabetical first
    const fallback = [...tiedIds].sort()[0]!;
    return {
      id: fallback,
      reason: `Tiebreak (deterministic): ${tiedIds.join(", ")} tied at ${topScore.toFixed(2)} — selected "${fallback}" alphabetically`,
    };
  }

  // --- 4. No hints matched → try market evidence, then LLM, then default ---
  if (marketEvidence?.trends?.length || marketEvidence?.competitorAudiences?.length) {
    // Heuristic: if community hints are present, lean content-media/b2c-app; otherwise default
    if (marketEvidence.competitorAudiences?.length) {
      // Try to match audience words
      for (const a of ARCHETYPES) {
        const audienceWords = normalise((a as ArchetypeDefinition).audience).split(/\s+/);
        const compCorpus = marketEvidence.competitorAudiences.map(normalise).join(" ");
        if (audienceWords.some((w) => w.length > 3 && compCorpus.includes(w))) {
          return {
            id: (a as ArchetypeDefinition).id,
            reason: `No detection hints matched; market evidence competitor audience aligns with "${(a as ArchetypeDefinition).audience}" → "${(a as ArchetypeDefinition).id}"`,
          };
        }
      }
    }
  }

  if (llmClient) {
    const allIds = ARCHETYPES.map((a) => (a as ArchetypeDefinition).id);
    const llmResult = await llmTiebreak(allIds, profileHints, marketEvidence, llmClient);
    if (llmResult) return llmResult;
  }

  // Final default: b2b-saas is a safe generic (covers the broadest SaaS case)
  // But for truly empty hints, free-utility vs content-media split — pick free-utility
  // if corpus is empty, else b2b-saas
  if (!corpus.trim()) {
    return {
      id: "free-utility",
      reason: "No detection hints or market evidence provided — defaulting to free-utility (single-purpose page baseline)",
    };
  }
  return {
    id: "b2b-saas",
    reason: "No clear detection match; defaulting to b2b-saas (broadest B2B baseline) — provide more hints or an override",
  };
}

/** Synchronous convenience for code that already resolved the override externally. */
export function resolveArchetypeSync(
  archetypeOverride: string | undefined,
  profileHints: ProfileHints,
  marketEvidence?: MarketEvidence,
): SelectArchetypeResult | null {
  if (archetypeOverride) {
    const key = normalise(archetypeOverride);
    const found = ARCHETYPE_BY_ID.get(key);
    if (found) {
      return { id: found.id, reason: `User override: "${found.id}"` };
    }
  }
  // Only handles override; full selection is async for LLM tiebreak.
  void profileHints;
  void marketEvidence;
  return null;
}
