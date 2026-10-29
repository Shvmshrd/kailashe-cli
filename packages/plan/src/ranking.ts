/**
 * Channel ranking — archetype default order adjusted by market evidence
 * (trend regions, community fit). Produces channels_ranked with
 * why / first-3-actions / KPI / stop condition.
 */

import type { ArchetypeId } from "./archetype.js";
import { ARCHETYPES, getArchetype } from "./archetype.js";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface TrendEvidence {
  term: string;
  shape?: "rising" | "steady" | "seasonal" | "fading" | "spike" | string;
  region?: string;
  confidence?: string;
}

export interface CommunityEvidence {
  name: string;
  url?: string;
  fit: number; // 1–5
  rules?: string;
}

export interface MarketEvidenceForRanking {
  trends?: TrendEvidence[];
  communities?: CommunityEvidence[];
}

export interface RankedChannel {
  channel: string;
  why: string;
  firstActions: [string, string, string];
  kpi: string;
  stopIf: string;
}

export interface RankingResult {
  ranked: RankedChannel[];
  later: Array<{ channel: string; trigger: string }>;
}

// ---------------------------------------------------------------------------
// Per-channel metadata used to fill why/KPI/stopIf/firstActions
// ---------------------------------------------------------------------------

interface ChannelDetail {
  whyTemplate: string;
  kpi: string;
  stopIf: string;
  actions: [string, string, string];
}

const CHANNEL_DETAILS: Record<string, ChannelDetail> = {
  // dev-tool
  "docs-and-readme": {
    whyTemplate: "Docs are the #1 developer acquisition surface; quality docs drive installs and SEO.",
    kpi: "docs_visits, installs",
    stopIf: "Docs visits flat for 4 weeks despite new content — revisit structure and search console.",
    actions: ["Audit docs for missing getting-started and API reference", "Polish README with quick-start snippet and badges", "Add docs QA checklist and fix top 5 gaps"],
  },
  "hacker-news": {
    whyTemplate: "Developer audience congregates here; a strong Show HN can drive early adoption.",
    kpi: "referring_domains, signups",
    stopIf: "Show HN post receives <10 points or <5 comments — revisit positioning before reposting.",
    actions: ["Draft Show HN post (plain title + first comment with demo link)", "Prepare answers to likely HN critiques", "Schedule around owner availability for live replies"],
  },
  "communities": {
    whyTemplate: "Target communities are where the audience asks for help — high-intent discovery.",
    kpi: "referral_visits, saved leads",
    stopIf: "No referral visits after 4 weeks of weekly participation — re-evaluate community fit.",
    actions: ["Research top 5 target communities: rules, tone, what works", "Prepare 3 genuinely helpful replies per week (no pitch)", "After participation, draft one honest launch post per community"],
  },
  "social-dev": {
    whyTemplate: "Dev social (X, etc.) amplifies releases and builds in public — low effort, steady reach.",
    kpi: "profile_visits, link clicks",
    stopIf: "Engagement <1% after 4 weeks of 3 posts/week — refresh pillars or platform.",
    actions: ["Define 3 content pillars (build in public, how-to tips, demos)", "Plan first week: 5 posts mixing threads, screenshots, polls", "Set up engagement routine: reply to relevant threads daily"],
  },
  "directories": {
    whyTemplate: "Directory listings drive early referring domains and discovery.",
    kpi: "live_listings, referring_domains",
    stopIf: "Batch approval unanswered 3 days — priority drops per ops-loop §3; follow up once.",
    actions: ["Build listing kit (taglines, descriptions, assets, links)", "Submit first batch of 5 directories (tracker updated)", "Schedule weekly recheck for pending listings"],
  },
  "newsletters-and-podcasts": {
    whyTemplate: "Curated newsletters and podcasts bring qualified dev audiences.",
    kpi: "referral_visits, mentions",
    stopIf: "Zero replies after 20 targeted pitches over 4 weeks — refine angle or list.",
    actions: ["Build target list of 15 newsletters/podcasts with audience fit", "Draft short, specific pitches with one clear offer", "Log outreach in CRM and follow up once after 5–7 days"],
  },
  "integrations-and-awesome-lists": {
    whyTemplate: "Ecosystem integrations and awesome-lists create durable backlinks and discovery.",
    kpi: "referring_domains, installs",
    stopIf: "No backlinks after 8 weeks — reprioritise to higher-yield channel.",
    actions: ["Identify top 5 integration opportunities and awesome-lists to target", "Prepare integration PR or listing submission kit", "Submit first 3 and track status"],
  },
  "seo-comparisons": {
    whyTemplate: "Comparison and alternatives pages capture high-intent bottom-funnel searches.",
    kpi: "organic_visits, demo_requests",
    stopIf: "Pages not indexed after 2 weeks — fix internal links and request indexing.",
    actions: ["Research head competitor terms and SERP gaps", "Draft first 3 comparison/alternatives pages (one element original each)", "Publish by PR, verify indexing and internal links"],
  },

  // b2b-saas
  "seo-bottom-funnel": {
    whyTemplate: "Bottom-funnel SEO (alternatives, vs, best-for) captures buyers ready to choose.",
    kpi: "qualified_visits, demo_requests",
    stopIf: "Pages not indexed after 2 weeks — fix internal links and improve content depth.",
    actions: ["Map competitor alternatives and comparison keywords to SERP gaps", "Draft 3 alternatives/comparison pages with sourced claims", "Publish first batch and set up GSC tracking for impressions"],
  },
  "directories-and-review-sites": {
    whyTemplate: "Review sites (G2, Capterra) and B2B directories drive qualified pipeline.",
    kpi: "referring_domains, trials",
    stopIf: "Profiles live but no referral clicks after 4 weeks — improve descriptions and categories.",
    actions: ["Create listing kit and review-site profiles (G2, Capterra, etc.)", "Request first 5 customer reviews with direct links", "Schedule weekly tracker update for pending listings"],
  },
  "linkedin": {
    whyTemplate: "LinkedIn reaches teams, managers, and operators — ideal B2B thought-leadership surface.",
    kpi: "profile_visits, pipeline",
    stopIf: "Engagement from target personas <1% after 4 weeks — adjust pillars and cadence.",
    actions: ["Define LinkedIn content pillars (product insights, customer stories, how-tos)", "Publish 3 posts in week 1 and engage with 5 relevant conversations", "Invite early users to connect and share feedback posts"],
  },
  "email-and-outreach": {
    whyTemplate: "Email nurture and targeted outreach convert qualified visits into trials.",
    kpi: "trials, pipeline",
    stopIf: "Open rate <15% or reply rate <2% after 4 weeks — revise subject, list, or offer.",
    actions: ["Build welcome sequence (5 emails over 14 days, one CTA each)", "Compile outreach target list (10 contacts with personal detail each)", "Draft first 5 outreach emails — specific, short, one next step"],
  },
  "launch-platforms": {
    whyTemplate: "Launch platforms (Product Hunt, etc.) create awareness spikes and social proof.",
    kpi: "signups, referring_domains",
    stopIf: "Launch day <50 upvotes or <10 signups — analyse feedback, reposition, retry one channel.",
    actions: ["Build launch kit: tagline, gallery, demo link, FAQ, founder story", "Line up supporters and do dry run (signup, analytics, capacity)", "Post on launch day — answer every comment for the first hours"],
  },

  // b2c-app
  "short-video-and-social": {
    whyTemplate: "Short video and social drive consumer discovery — highest reach for B2C apps.",
    kpi: "installs_or_signups, share_rate",
    stopIf: "Watch time or share rate flat for 4 weeks — test new hooks and formats.",
    actions: ["Define 3 content pillars and plan first 10 short videos/posts", "Record and edit first 5 videos (hook in first 3 seconds)", "Post on 3-per-week cadence and track share rate"],
  },
  "app-store-or-seo": {
    whyTemplate: "App-store visibility or organic SEO is the durable acquisition engine for consumer apps.",
    kpi: "installs_or_signups, organic_visits",
    stopIf: "Store ranking or organic impressions flat for 4 weeks — refresh copy and keywords.",
    actions: ["Optimise store listing (title, screenshots, description, keywords)", "Map organic keywords to SERP gaps for app-relevant queries", "Update listing and add 2 supporting content pages"],
  },
  "email": {
    whyTemplate: "Email retains and reactivates users — essential for day-7 retention.",
    kpi: "day_7_retention, share_rate",
    stopIf: "Retention or email engagement flat — revisit onboarding and content relevance.",
    actions: ["Build welcome + activation email sequence (5 emails over 14 days)", "Add in-app prompts to capture email at the right moment", "Track opens (weak) and clicks/replies (strong) weekly"],
  },
  "influencers-and-creators": {
    whyTemplate: "Creators bring trusted audiences — highest conversion for niche consumer apps.",
    kpi: "installs_or_signups, cost_per_signup",
    stopIf: "Cost per signup exceeds target by 2× after 4 weeks — renegotiate or pause.",
    actions: ["Shortlist 10 creators by audience overlap and engagement rate", "Draft specific pitch per creator with one clear offer", "Send first 5 pitches and track reply and conversion rates"],
  },
  "referral-loops": {
    whyTemplate: "Referral loops turn users into distributors — lowest marginal acquisition cost.",
    kpi: "share_rate, installs_or_signups",
    stopIf: "Referral share rate <2% after 4 weeks — simplify reward or flow.",
    actions: ["Design referral reward (shareable output, badge, or credit)", "Implement opt-in referral invite in the product", "Test and measure share rate with first 50 users"],
  },

  // ai-tool
  "directories-ai": {
    whyTemplate: "AI directories bring early-adopter traffic specifically looking for new AI tools.",
    kpi: "directory_listings_live, signups",
    stopIf: "No listings live after 2 batches — follow up once, then escalate listing quality.",
    actions: ["Build listing kit tailored to AI directories (demo, use cases, limits)", "Submit first batch of 5 AI directories", "Submit second batch and verify first-batch status"],
  },
  "social-x-and-linkedin": {
    whyTemplate: "X and LinkedIn are where AI builders and early adopters discover new tools.",
    kpi: "signups, mentions",
    stopIf: "Mention volume or signups from social flat for 4 weeks — test demo-led content.",
    actions: ["Define builder-focused content pillars (demos, use cases, behind-the-scenes)", "Record 60-second demo video and cut for X and LinkedIn", "Post 3×/week and engage with 5 relevant AI threads daily"],
  },
  "seo-how-to-and-templates": {
    whyTemplate: "How-to and template pages capture specific use-case searches — strongest SEO for AI tools.",
    kpi: "organic_visits, activation",
    stopIf: "Pages not indexed or no impressions after 4 weeks — revisit keyword and content depth.",
    actions: ["Map top 8 use-case keywords to SERP gaps", "Draft 3 use-case/how-to pages with real demos", "Publish first 3 and wire up GSC tracking"],
  },
  "integrations-and-mcp-listings": {
    whyTemplate: "MCP and integration listings put the tool inside other products' ecosystems.",
    kpi: "referring_domains, activation",
    stopIf: "No ecosystem referrals after 6 weeks — check listing approval status and retry.",
    actions: ["Prepare MCP/integration listing (manifest, description, demo)", "Submit to first 3 integration marketplaces", "Add integration docs and announce to community"],
  },

  // content-media
  "seo-informational": {
    whyTemplate: "Informational SEO (explainers, guides) is the #1 channel for media and communities.",
    kpi: "search_clicks, subscribers",
    stopIf: "Pages not indexed after 2 weeks or no impressions at 4 weeks — improve depth and internal links.",
    actions: ["Draft 12-week content calendar (1–3 pieces/week, one original element each)", "Write 3 pillar pages targeting core informational queries", "Create lead magnet and subscribe flow for email capture"],
  },
  "newsletter-swaps-and-mentions": {
    whyTemplate: "Newsletter swaps bring pre-qualified readers who already trust the recommending source.",
    kpi: "subscribers, open_and_click_rate",
    stopIf: "Swap reply rate <5% or no subscriber lift after 4 swaps — refine target list or offer.",
    actions: ["Build list of 20 newsletters in adjacent topics for swap pitches", "Draft short, specific swap pitch per target with audience overlap note", "Send first 5 pitches and track subscriber lift"],
  },
  "social": {
    whyTemplate: "Social distributes content and builds the editor's audience — steady compounding.",
    kpi: "returning_readers, search_clicks",
    stopIf: "Social clicks <2% of impressions after 4 weeks — adjust pillars and native formatting.",
    actions: ["Define social content pillars and plan first 10 posts", "Repurpose pillar pages into native social posts (not copy-paste)", "Post 3–5×/week and engage with 3 relevant conversations daily"],
  },
  "search-and-discover-feeds": {
    whyTemplate: "Discover feeds multiply reach beyond search — RSS, Substack, platform discovery.",
    kpi: "returning_readers, sponsor_interest",
    stopIf: "Feed subscribers flat after 6 weeks — revisit distribution and content cadence.",
    actions: ["Set up RSS/feed with correct metadata and submit to feed directories", "Optimise titles and OG images for feed presentation", "Pitch to 3 content aggregators or curation newsletters"],
  },
  "partnerships": {
    whyTemplate: "Partnerships with adjacent media and communities multiply reach at low marginal cost.",
    kpi: "subscribers, returning_readers",
    stopIf: "No partnership replies after 15 pitches — revisit target relevance.",
    actions: ["Map 10 potential media/community partners by audience fit", "Draft partnership pitch (co-created content, swap, or bundle)", "Send first 5 pitches and log outcomes in CRM"],
  },

  // ecommerce
  "seo-product-and-category": {
    whyTemplate: "Product and category SEO captures high-intent shoppers ready to buy.",
    kpi: "conversion_rate, revenue_per_visit",
    stopIf: "Category pages not indexed or no clicks after 4 weeks — improve internal links and page quality.",
    actions: ["Audit product pages for SEO (titles, descriptions, schema, speed)", "Create 3 optimised category pages with clear buying guides", "Add internal links from top-traffic pages to new category pages"],
  },
  "email-lifecycle": {
    whyTemplate: "Lifecycle email (welcome, cart, repeat) drives the highest ROI in ecommerce.",
    kpi: "email_revenue_share, repeat_rate",
    stopIf: "Email revenue share <5% after 6 weeks — revise sequences and segmentation.",
    actions: ["Build welcome + browse-abandon + cart-abandon email sequences", "Add review collection email 7 days post-purchase", "Set up revenue attribution for each sequence"],
  },
  "social-and-short-video": {
    whyTemplate: "Social and short video showcase products visually — proven for ecommerce discovery.",
    kpi: "conversion_rate, reviews",
    stopIf: "Social traffic bounces >85% or 0 conversions after 4 weeks — rework product match.",
    actions: ["Shoot 10 product photos and 3 short demo videos", "Plan first month social calendar (4 posts/week, product-led)", "Connect social shop/Meta catalogue if applicable"],
  },
  "marketplaces": {
    whyTemplate: "Marketplaces (Amazon, Etsy, etc.) bring buyers already in purchase mode.",
    kpi: "conversion_rate, revenue_per_visit",
    stopIf: "Marketplace sales <5% of revenue after 8 weeks — check listing visibility and pricing.",
    actions: ["Shortlist marketplaces by niche fit and fee structure", "Create optimised marketplace listings (copy marketplace format exactly)", "Launch on first marketplace and track attribution"],
  },
  "creators-and-affiliates": {
    whyTemplate: "Creator affiliates turn trusted voices into a scalable acquisition channel.",
    kpi: "revenue_per_visit, repeat_rate",
    stopIf: "Affiliate revenue <3% after 8 weeks — revisit commission and creator fit.",
    actions: ["Define affiliate offer (commission, cookie window, assets)", "Shortlist 10 creators by audience and engagement fit", "Onboard first 3 affiliates and supply product for review"],
  },
  "paid-after-proof": {
    whyTemplate: "Paid is proven only after product pages convert — then it scales what already works.",
    kpi: "conversion_rate, revenue_per_visit",
    stopIf: "Cost per conversion exceeds margin after test budget — pause and optimise pages first.",
    actions: ["Wait for conversion proof (≥2% product-page conversion rate)", "Define daily cap and kill switch with owner approval", "Launch one small test campaign on the best-proven channel"],
  },

  // local-service
  "local-seo-and-maps-profile": {
    whyTemplate: "Local SEO and maps profile are the #1 discovery surface for nearby customers.",
    kpi: "map_views, bookings",
    stopIf: "Map views flat for 4 weeks despite optimisation — audit NAP consistency and photo quality.",
    actions: ["Complete maps profile (NAP, hours, services, photos, Q&A)", "Create location pages for each service area with local keywords", "Add schema (LocalBusiness) and verify NAP identical everywhere"],
  },
  "reviews": {
    whyTemplate: "Reviews and ratings are the primary trust signal for local services — they drive bookings.",
    kpi: "reviews_and_rating, bookings",
    stopIf: "No new reviews after 2 weeks of collection — check timing and ease of review link.",
    actions: ["Set up review request flow (7-day post-service trigger, direct link)", "Ask first 10 satisfied customers for reviews", "Reply to every review (good and bad) within 2 days"],
  },
  "social-and-visual": {
    whyTemplate: "Visual social (photos, tours) showcase the service and build local trust.",
    kpi: "map_views, calls_or_messages",
    stopIf: "Social engagement from local audience flat — increase geo-tagged, local-relevant content.",
    actions: ["Shoot 20 high-quality photos and 2 short videos of the service in action", "Plan visual social calendar (3 posts/week, geo-tagged)", "Engage with local community pages and geo-tagged conversations"],
  },
  "partnerships-and-referrals": {
    whyTemplate: "Local partnerships and referrals bring pre-trusted customers at low cost.",
    kpi: "bookings, repeat_or_referral_rate",
    stopIf: "No referrals after 4 weeks — revisit partner relevance and incentive clarity.",
    actions: ["Map 10 local partner opportunities (hotels, agencies, complementary services)", "Create referral offer and one-page partner sheet", "Pitch first 5 partners and log outcomes"],
  },
  "email-and-chat": {
    whyTemplate: "Email and chat keep past customers engaged and drive repeat and referral bookings.",
    kpi: "repeat_or_referral_rate, bookings",
    stopIf: "Email/chat open or reply rate <10% — refine timing and personalisation.",
    actions: ["Build post-service follow-up sequence (thank you + review + referral invite)", "Set up chat widget with clear booking CTA", "Send first 3 follow-up batches and track repeat rate"],
  },
  "directories-and-travel-sites": {
    whyTemplate: "Travel and local directories bring visitors planning trips — high-intent local discovery.",
    kpi: "map_views, calls_or_messages",
    stopIf: "No directory referral clicks after 6 weeks — check listing visibility and category fit.",
    actions: ["Research travel and local directories by niche and quality", "Submit first batch of 5 directory listings", "Verify first-batch listings and schedule weekly recheck"],
  },

  // digital-product
  "seo-templates-and-how-to": {
    whyTemplate: "Template and how-to SEO captures creators searching for shortcuts — strongest channel.",
    kpi: "sales, conversion_rate",
    stopIf: "Template pages not indexed or no sales after 6 weeks — revisit keyword fit and previews.",
    actions: ["Map template/how-to keywords to SERP gaps", "Create 3 preview-rich template pages with honest previews", "Add free sample download with email capture to each page"],
  },
  "marketplaces-and-directories": {
    whyTemplate: "Marketplaces (Gumroad, Creative Market, etc.) bring buyers already searching for your asset type.",
    kpi: "sales, free_sample_downloads",
    stopIf: "Marketplace sales flat after 6 weeks — refresh listings and preview quality.",
    actions: ["Shortlist marketplaces by asset-type fit and fee structure", "Create optimised listings with preview galleries and honest descriptions", "Publish on first marketplace and verify search visibility"],
  },
  "email-and-lead-magnet": {
    whyTemplate: "Lead magnets turn browsers into buyers — nurturing converts free users to paid.",
    kpi: "email_signups, conversion_rate",
    stopIf: "Lead-magnet conversion <2% after 4 weeks — rework offer and placement.",
    actions: ["Create lead magnet (free sample, template, or mini-course)", "Build welcome/nurture email sequence (5 emails, one CTA each)", "Add lead magnet CTA to top 3 traffic pages"],
  },

  // free-utility
  "seo-tool-pages": {
    whyTemplate: "Tool pages capture high search intent — users who need a quick answer now.",
    kpi: "organic_visits, tool_uses",
    stopIf: "Tool page not indexed after 2 weeks or no tool uses — fix speed, schema, and internal links.",
    actions: ["Optimise tool page: speed, accuracy, schema markup, internal links", "Create 3 explainer pages targeting tool-adjacent queries", "Verify indexing and add tool to sitemap with priority"],
  },
  "embeds-and-backlinks": {
    whyTemplate: "Embeds let other sites distribute your tool — each embed is a backlink and referral.",
    kpi: "share_or_embed_rate, referring_domains",
    stopIf: "Embed adoption <2% of tool users after 6 weeks — simplify embed code and pitch.",
    actions: ["Build embeddable widget with built-in attribution link", "Add embed/share CTA to the tool page (non-intrusive)", "Pitch embed to 5 sites in the tool's niche"],
  },
  "email-capture": {
    whyTemplate: "Email capture turns free-tool traffic into an owned audience for future offers.",
    kpi: "email_signups, organic_visits",
    stopIf: "Email capture rate <1% after 4 weeks — rework offer and placement.",
    actions: ["Add non-intrusive email capture to the tool page (e.g., save results)", "Create one lead magnet relevant to tool users", "Test capture placement (below tool output vs. modal) for conversion"],
  },
};

function channelDetail(channelId: string): ChannelDetail {
  const d = CHANNEL_DETAILS[channelId];
  if (d) return d;
  // Should not happen — CHANNEL_MAP guarantees coverage. Fallback for safety.
  return {
    whyTemplate: `Core channel for this archetype's go-to-market — high fit for this audience.`,
    kpi: "organic_visits",
    stopIf: "No signal after 4 weeks of consistent, quality effort — stop or change tactic (ops-loop §9).",
    actions: ["Research audience and channel fit", "Launch first 3 actions for this channel", "Track KPI weekly and review at week 4"],
  };
}

function communityBoost(
  channelId: string,
  communities: CommunityEvidence[] | undefined,
): number {
  if (!communities?.length) return 0;
  // Channels that benefit most from strong community fit
  const communitySensitive = new Set([
    "communities",
    "social-dev",
    "social-x-and-linkedin",
    "social",
    "hacker-news",
    "social-and-visual",
    "social-and-short-video",
    "short-video-and-social",
  ]);
  if (!communitySensitive.has(channelId)) return 0;
  const maxFit = Math.max(...communities.map((c) => c.fit));
  // fit 4–5 → boost 2; fit 3 → boost 1; else 0
  if (maxFit >= 4) return 2;
  if (maxFit === 3) return 1;
  return 0;
}

function trendBoost(
  channelId: string,
  trends: TrendEvidence[] | undefined,
): number {
  if (!trends?.length) return 0;
  const rising = trends.filter((t) => t.shape === "rising").length;
  // Rising trends boost SEO/content channels
  const seoChannels = new Set([
    "seo-bottom-funnel",
    "seo-comparisons",
    "seo-product-and-category",
    "seo-informational",
    "seo-templates-and-how-to",
    "seo-tool-pages",
    "seo-how-to-and-templates",
    "seo-informational",
  ]);
  if (seoChannels.has(channelId) && rising >= 2) return 1;
  if (seoChannels.has(channelId) && rising >= 1) return 0.5;
  return 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rank channels for an archetype, adjusted by market evidence.
 *
 * - Starts from the archetype's default channels_ranked order.
 * - Applies community-fit and trend-region adjustments (market-research §10).
 * - Returns all channels ranked with why/first-3-actions/KPI/stop condition,
 *   plus a "later" list with triggers for lower-ranked channels.
 */
export function rankChannels(
  archetypeId: ArchetypeId | string,
  marketEvidence?: MarketEvidenceForRanking,
): RankingResult {
  const archetype = getArchetype(archetypeId);
  if (!archetype) {
    throw new Error(`Unknown archetype "${archetypeId}" — valid ids: ${ARCHETYPES.map((a) => a.id).join(", ")}`);
  }

  // Score each channel: base rank (lower index = higher base) + boosts
  const scored = archetype.channels_ranked.map((ch, idx) => {
    const baseScore = archetype.channels_ranked.length - idx; // first = highest
    const cBoost = communityBoost(ch, marketEvidence?.communities);
    const tBoost = trendBoost(ch, marketEvidence?.trends);
    const total = baseScore + cBoost + tBoost;
    return { channel: ch, baseScore, cBoost, tBoost, total, originalIndex: idx };
  });

  // Stable sort by total descending (boosts can reorder, but ties keep original order)
  scored.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.originalIndex - b.originalIndex;
  });

  // Build ranked output — all channels ranked, split into primary (top 4) and later
  const PRIMARY_COUNT = 4;

  const ranked: RankedChannel[] = scored.map((s) => {
    const detail = channelDetail(s.channel);
    // Annotate why with market-evidence reasoning when it caused a boost
    let why = detail.whyTemplate;
    if (s.cBoost > 0) {
      const maxFit = Math.max(...(marketEvidence?.communities?.map((c) => c.fit) ?? [0]));
      why += ` Market evidence: strong community fit (fit ${maxFit}/5) supports prioritising this channel.`;
    }
    if (s.tBoost > 0) {
      const risingTerms = (marketEvidence?.trends ?? []).filter((t) => t.shape === "rising").map((t) => t.term);
      if (risingTerms.length) {
        why += ` Trend evidence: rising interest in ${risingTerms.slice(0, 3).join(", ")} favours SEO investment.`;
      }
    }

    return {
      channel: s.channel,
      why,
      firstActions: detail.actions,
      kpi: detail.kpi,
      stopIf: detail.stopIf,
    };
  });

  // The orchestrator decides how many to show as primary vs later, but we
  // provide the split here for convenience — both carry the same RankedChannel shape.
  // "later" entries include a trigger description.
  const laterTriggers: Record<string, string> = {
    "newsletters-and-podcasts": "after 10 indexed pages and first 500 visits",
    "integrations-and-awesome-lists": "after first 100 users or 50 stars",
    "seo-comparisons": "after 5 how-to guides are indexed",
    "partnerships": "after first 200 users or 3 review-site profiles live",
    "launch-platforms": "after listing kit and first 5 content pieces are live",
    "influencers-and-creators": "after 100 users — then pilot with 3 creators",
    "referral-loops": "after first 100 active users and 20% week-1 retention",
    "newsletters-and-podcasts-later": "after 10 indexed pages",
    "integrations-and-mcp-listings": "after first 200 signups and stable uptime",
    "search-and-discover-feeds": "after 12-week content calendar is published",
    "marketplaces": "after product pages convert at ≥2%",
    "creators-and-affiliates": "after first 100 sales and refund rate <5%",
    "paid-after-proof": "only after product pages convert — owner sets cap, class C",
    "partnerships-and-referrals": "after maps profile and 10 reviews are live",
    "email-and-chat": "after maps profile and first 5 reviews",
    "directories-and-travel-sites": "after maps profile pass and location pages",
    "marketplaces-and-directories": "after 3 SEO pages are indexed",
    "creators-and-affiliates-dp": "after first 50 sales",
    "embeds-and-backlinks": "after tool page indexed and 500 visits",
    "email-capture": "after tool page indexed and 200 uses",
    "app-store-or-seo": "after first 20 social posts and community validation",
    "email": "after first 100 signups and welcome sequence live",
  };

  const defaultTrigger = "after foundations (SEO basics, listing kit, first content) are done";

  // For snapshot compatibility, return ALL ranked; caller slices to primary/later
  const later: Array<{ channel: string; trigger: string }> = scored.slice(PRIMARY_COUNT).map((s) => ({
    channel: s.channel,
    trigger: laterTriggers[s.channel] ?? defaultTrigger,
  }));

  return { ranked, later };
}

/**
 * The RankedChannel shape expected inside the Plan (SPEC §6.7 + market-research §10).
 * Convenience to produce the market.json-compatible form.
 */
export function toMarketJsonChannels(ranked: RankedChannel[]): Array<{ channel: string; why: string; kpi: string; stop_if: string }> {
  return ranked.map((r) => ({
    channel: r.channel,
    why: r.why,
    kpi: r.kpi,
    stop_if: r.stopIf,
  }));
}
