/**
 * Backlog generator — emits valid Task objects (SPEC §6.8, ops-loop §§2–3).
 *
 * Priority formula (ops-loop §3):  score = (impact × confidence) / effort
 *   +2 if the task unlocks 3+ others; −2 if approval unanswered 3 days.
 *   Ties: more evidence wins.
 */

import type { ArchetypeId } from "./archetype.js";
import { getArchetype } from "./archetype.js";
import type { RankedChannel } from "./ranking.js";

// ---------------------------------------------------------------------------
// Task type (SPEC §6.8 / ops-loop §2)
// ---------------------------------------------------------------------------

export type TaskApproval = "A" | "B" | "C";
export type TaskStatus = "todo" | "doing" | "waiting-approval" | "blocked" | "done";

export interface Task {
  id: string; // T-NNN
  title: string;
  goal: string;
  channel: string;
  route: string;
  approval: TaskApproval;
  inputs: string[];
  steps: string[];
  success_check: string;
  kpi: string;
  impact: number; // 1–5
  confidence: number; // 1–5
  effort: number; // 1–5, lower is easier
  depends_on: string[];
  status: TaskStatus;
  evidence: string[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Task blueprints per first_30_days id
// ---------------------------------------------------------------------------

interface TaskBlueprint {
  id: string;
  title: string;
  goal: string;
  channel: string;
  route: string;
  approval: TaskApproval;
  inputs: string[];
  steps: string[];
  success_check: string;
  kpi: string;
  impact: number;
  confidence: number;
  effort: number;
  depends_on: string[];
  notes: string;
}

const BLUEPRINTS: Record<string, Omit<TaskBlueprint, "id">> = {
  "seo-basics": {
    title: "SEO basics pass — sitemap, canonical, title, meta, robots, OG",
    goal: "Every live page has a sitemap entry, canonical, title <60ch, meta ~150ch, OG image, and valid robots.txt",
    channel: "seo-bottom-funnel",
    route: "muse:github + browser-and-lighthouse-via-site",
    approval: "B",
    inputs: ["live URL", "repo"],
    steps: ["Crawl live URL for title/meta/canonical/robots/sitemap/OG", "Fix missing titles, metas, canonicals via PR", "Submit sitemap to Search Console", "Verify indexed pages count"],
    success_check: "Sitemap valid, every live page has title/meta/canonical/OG, no indexing errors in GSC",
    kpi: "pages_indexed",
    impact: 5,
    confidence: 5,
    effort: 2,
    depends_on: [],
    notes: "Do this first — foundations unlock everything else.",
  },
  "docs-quality-pass": {
    title: "Docs quality pass — getting started, API reference, examples",
    goal: "Docs site covers install, quick-start, API reference, 3 worked examples, and FAQ",
    channel: "docs-and-readme",
    route: "muse:github",
    approval: "A",
    inputs: ["repo", "docs site"],
    steps: ["Audit docs for coverage gaps", "Write or fix getting-started and API reference", "Add 3 copy-paste examples", "Check docs build and search"],
    success_check: "Docs build passes, all examples run, GSC shows docs pages indexed",
    kpi: "docs_visits",
    impact: 5,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Docs quality is the best SEO for dev-tools.",
  },
  "listing-kit": {
    title: "Build listing kit — taglines, descriptions, assets, links",
    goal: "Listing kit ready in HQ with 3 taglines, descriptions at 160/300/500 chars, 5 screenshots, logo, founder bio, pricing, links",
    channel: "directories",
    route: "muse:google-docs-and-sheets",
    approval: "A",
    inputs: ["brief"],
    steps: ["Draft 3 tagline variants from the brief", "Write descriptions at 160, 300, and 500 chars", "Gather logo, screenshots, pricing, links", "Save kit in HQ under Plan"],
    success_check: "Kit document in HQ with all required fields filled",
    kpi: "referring_domains",
    impact: 4,
    confidence: 5,
    effort: 1,
    depends_on: [],
    notes: "Unlocks all directory tasks.",
  },
  "directories-batch-1": {
    title: "Submit first directory batch (5 listings)",
    goal: "5 listings submitted and tracked in Directory tracker",
    channel: "directories",
    route: "muse-browser + gmail (verification emails)",
    approval: "B",
    inputs: ["listing-kit", "directory-tracker"],
    steps: ["Pick 5 relevant, quality directories", "Submit in batch via browser/API", "Verify emails via Gmail connector", "Record URLs and statuses in tracker"],
    success_check: "5 tracker rows with status submitted or live and listing URLs where available",
    kpi: "live_listings",
    impact: 4,
    confidence: 4,
    effort: 3,
    depends_on: ["T-001"],
    notes: "Batch of 5 — quality beats count. Owner approves the batch.",
  },
  "directories-batch-2": {
    title: "Submit second directory batch (5 listings)",
    goal: "10 total listings tracked, 5 from each batch",
    channel: "directories",
    route: "muse-browser + gmail (verification emails)",
    approval: "B",
    inputs: ["listing-kit", "directory-tracker"],
    steps: ["Pick next 5 relevant directories", "Submit via browser/API", "Verify emails, record in tracker", "Follow up on batch 1 pending listings"],
    success_check: "10 tracker rows, ≥3 live listings with URLs",
    kpi: "live_listings",
    impact: 3,
    confidence: 4,
    effort: 3,
    depends_on: ["T-001"],
    notes: "Second batch — space submissions out by a week.",
  },
  "show-hn-draft": {
    title: "Draft Show HN post (+ first comment)",
    goal: "Show HN draft ready with plain title, founder first-comment, demo link, and FAQ",
    channel: "hacker-news",
    route: "muse:github + browser (HN posting)",
    approval: "C",
    inputs: ["brief", "live URL"],
    steps: ["Write plain HN title (what it does, no hype)", "Draft founder first comment (why built, what is rough, how to try without signup)", "Prepare answers to likely HN questions", "Owner posts; monitor first hours"],
    success_check: "Show HN posted, first comment live, owner available to reply for 3 hours",
    kpi: "referring_domains",
    impact: 4,
    confidence: 3,
    effort: 2,
    depends_on: [],
    notes: "No marketing tone; no vote requests. Class C.",
  },
  "show-hn-or-launch-draft": {
    title: "Draft Show HN or launch-platform post",
    goal: "Launch post draft ready with title, gallery, first comment, demo, FAQ",
    channel: "launch-platforms",
    route: "muse:github + browser",
    approval: "C",
    inputs: ["brief", "live URL"],
    steps: ["Build launch kit: tagline, gallery, demo link, FAQ, founder story", "Draft platform-specific post (title + first comment)", "Dry run: signup, pricing page, analytics, support inbox", "Owner posts; monitor and reply"],
    success_check: "Launch post live with founder comment, owner monitoring",
    kpi: "signups",
    impact: 4,
    confidence: 3,
    effort: 3,
    depends_on: [],
    notes: "Post in one place well; do not cross-post identical text.",
  },
  "three-how-to-guides": {
    title: "Write 3 how-to guides (middle-funnel, product-led)",
    goal: "3 how-to guides published via PR, each with one original element",
    channel: "seo-how-to-and-templates",
    route: "muse:github",
    approval: "B",
    inputs: ["brief", "clusters", "serp-gaps"],
    steps: ["Pick 3 keyword clusters with clear intent and SERP gaps", "Draft briefs (keyword, angle, outline, original element)", "Write, fact-check, optimise, publish by PR", "Verify indexing and internal links"],
    success_check: "3 pages live, indexed, each linked from 2 existing pages, 1 original element each",
    kpi: "organic_visits",
    impact: 5,
    confidence: 4,
    effort: 4,
    depends_on: [],
    notes: "Fewer, better pages — one original element per piece.",
  },
  "github-readme-polish": {
    title: "Polish GitHub README — quick-start, badges, examples",
    goal: "README has a 30-second quick-start, install, usage example, badges, and links",
    channel: "docs-and-readme",
    route: "muse:github",
    approval: "A",
    inputs: ["repo"],
    steps: ["Audit README for quick-start, install, usage", "Add badges (build, version, licence)", "Add copy-paste example and links to docs", "Verify README renders correctly on GitHub"],
    success_check: "README renders cleanly with quick-start, badges, and working links",
    kpi: "github_stars",
    impact: 4,
    confidence: 5,
    effort: 1,
    depends_on: [],
    notes: "README is the storefront — quality over volume.",
  },
  "alternatives-pages": {
    title: "Create alternatives pages for top 3 competitors",
    goal: "3 alternatives pages live (e.g. 'Alternatives to X') with honest, sourced claims",
    channel: "seo-bottom-funnel",
    route: "muse:github",
    approval: "B",
    inputs: ["competitors", "serp-gaps"],
    steps: ["Pick 3 competitors with the strongest search demand", "Research each competitor's positioning and pricing (source + date)", "Draft pages with honest comparisons and migration notes", "Publish by PR, verify indexing"],
    success_check: "3 alternatives pages live, indexed, competitor claims sourced with URL+date",
    kpi: "qualified_visits",
    impact: 5,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Never overclaim — every competitor statement needs a link and a date.",
  },
  "comparison-pages": {
    title: "Create comparison pages (X vs us)",
    goal: "2 comparison pages live, fair, sourced, with clear migration guidance",
    channel: "seo-bottom-funnel",
    route: "muse:github",
    approval: "B",
    inputs: ["competitors", "brief"],
    steps: ["Pick 2 head-to-head comparisons with strong search intent", "Research and source competitor facts", "Draft pages with feature table and honest positioning", "Publish by PR, verify indexing"],
    success_check: "2 comparison pages live, indexed, feature claims sourced",
    kpi: "qualified_visits",
    impact: 4,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Fair comparisons build trust — show where competitors win too.",
  },
  "review-site-profiles": {
    title: "Create review-site profiles (G2, Capterra, etc.)",
    goal: "Profiles live on 2 review sites with complete info and first review requests sent",
    channel: "directories-and-review-sites",
    route: "muse-browser + gmail",
    approval: "B",
    inputs: ["listing-kit"],
    steps: ["Create profiles on G2 and one other relevant review site", "Fill descriptions, pricing, links, screenshots", "Send review requests to 5 early users with direct links", "Schedule weekly tracking of profile views"],
    success_check: "2 profiles live with complete info, 5 review requests sent",
    kpi: "trials",
    impact: 4,
    confidence: 4,
    effort: 2,
    depends_on: ["T-001"],
    notes: "Reviews drive B2B trust — ask at the right moment (after a win).",
  },
  "welcome-sequence": {
    title: "Build welcome email sequence (5 emails over 14 days)",
    goal: "Welcome sequence live: 5 plain-text emails, one CTA each, with unsubscribe",
    channel: "email-and-outreach",
    route: "muse:klaviyo",
    approval: "C",
    inputs: ["brief"],
    steps: ["Draft 5 emails: welcome + quick win, core use case, story/proof, tip, upgrade invite", "Set up in Klaviyo (or owner-approved email platform)", "Add capture form with consent text and unsubscribe", "Test and get owner approval for first send"],
    success_check: "Sequence active, capture form live, first-email template approved by owner",
    kpi: "trials",
    impact: 4,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "First send of each template is class C.",
  },
  "three-case-notes": {
    title: "Write 3 case notes / proof pieces",
    goal: "3 case notes live with customer quotes (permission) and real numbers",
    channel: "seo-bottom-funnel",
    route: "muse:github",
    approval: "B",
    inputs: ["brief", "customer-feedback"],
    steps: ["Identify 3 customers willing to share their story", "Interview and draft case notes (problem, solution, result)", "Get customer approval and publish via PR", "Add to proof library in HQ"],
    success_check: "3 case notes live with permission, quotes, and evidence links",
    kpi: "pipeline",
    impact: 3,
    confidence: 3,
    effort: 3,
    depends_on: [],
    notes: "Real wins with permission — never fake testimonials.",
  },
  "store-listing-pass": {
    title: "Optimise app-store listing (title, screenshots, keywords)",
    goal: "Store listing has optimised title, 5 screenshots, keyword-rich description, and correct category",
    channel: "app-store-or-seo",
    route: "muse-browser",
    approval: "B",
    inputs: ["brief", "listing-kit"],
    steps: ["Audit listing against store guidelines", "Write optimised title, description, and keywords", "Create 5 fresh screenshots and update listing", "Verify live listing and category"],
    success_check: "Store listing updated with optimised title, description, and 5 screenshots",
    kpi: "installs_or_signups",
    impact: 5,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "Store listing is the storefront — polish first.",
  },
  "content-pillars": {
    title: "Define content pillars and 12-week calendar",
    goal: "3 content pillars defined and first 4 weeks scheduled",
    channel: "short-video-and-social",
    route: "muse:google-docs-and-sheets",
    approval: "A",
    inputs: ["brief", "market"],
    steps: ["Define 3 content pillars from the brief and market gaps", "Create 12-week calendar (3–5 posts/week per network)", "Plan first 10 posts with native formats", "Save calendar in HQ"],
    success_check: "Pillars and 12-week calendar in HQ with first 10 posts planned",
    kpi: "share_rate",
    impact: 4,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "One plan, native execution per network — no copy-paste.",
  },
  "first-20-posts": {
    title: "Create first 20 social posts (week 1–4 batch)",
    goal: "20 posts prepared natively per network with mixed formats and UTM links",
    channel: "short-video-and-social",
    route: "muse:canva + muse:github",
    approval: "B",
    inputs: ["content-pillars", "brief"],
    steps: ["Draft 20 posts across pillars (text, threads, screenshots, video, polls)", "Create visuals in Canva where needed", "Add UTM links to every outbound link", "Queue for batch approval"],
    success_check: "20 posts with UTMs, batch approved, first week scheduled",
    kpi: "profile_visits",
    impact: 4,
    confidence: 3,
    effort: 4,
    depends_on: [],
    notes: "Scheduled posts from an approved calendar are class B.",
  },
  "community-research": {
    title: "Research target communities (rules, top posts, fit)",
    goal: "5 target communities documented with rules summary, fit score, and what-works notes",
    channel: "communities",
    route: "muse:web-search-and-browser",
    approval: "A",
    inputs: ["market"],
    steps: ["Read rules and last 30 days of top posts per community", "Write rule summary and what-works-here in HQ", "Score fit 1–5 and log in Directory tracker", "Skip communities that ban promotion with no standing"],
    success_check: "5 community docs in HQ with rules, fit scores, and what-works notes",
    kpi: "referral_visits",
    impact: 3,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "Read before you write — unsure means ask.",
  },
  "referral-idea": {
    title: "Design referral mechanic (shareable output or badge)",
    goal: "Referral mechanic designed, scoped, and logged for future build",
    channel: "referral-loops",
    route: "muse:github",
    approval: "A",
    inputs: ["brief", "repo"],
    steps: ["Propose 2 referral ideas (e.g., shareable result, badge, invite link)", "Scope the minimal build: trigger, reward, tracking", "Get owner approval before building", "Log in backlog for month 2"],
    success_check: "Design doc in HQ with owner sign-off on chosen mechanic",
    kpi: "share_rate",
    impact: 3,
    confidence: 3,
    effort: 3,
    depends_on: [],
    notes: "Propose, do not build without approval.",
  },
  "demo-video": {
    title: "Record 2-minute demo video (use-case led)",
    goal: "Demo video recorded with real product, clear narration, and thumbnail",
    channel: "short-video-and-social",
    route: "muse:canva + browser",
    approval: "B",
    inputs: ["brief", "live URL"],
    steps: ["Script a 2-minute demo of the top use case", "Record with real product (no mockups)", "Edit, add thumbnail, upload", "Prepare cut-down versions for social channels"],
    success_check: "Demo video live with thumbnail, social cut-downs ready",
    kpi: "signups",
    impact: 4,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "Real product, plain language — no hype.",
  },
  "three-use-case-pages": {
    title: "Build 3 use-case pages with real demos",
    goal: "3 use-case pages live, each with a demo, gap angle, and honest limits",
    channel: "seo-how-to-and-templates",
    route: "muse:github",
    approval: "B",
    inputs: ["brief", "clusters"],
    steps: ["Pick 3 use-case keywords with SERP gaps", "Draft pages with real product demos and honest limits", "Optimise on-page SEO and publish by PR", "Verify indexing and internal links"],
    success_check: "3 use-case pages live, indexed, with real demos and limits noted",
    kpi: "activation",
    impact: 5,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Specific use cases beat generic claims — show, do not claim.",
  },
  "mcp-or-integration-listing": {
    title: "Prepare MCP / integration marketplace listing",
    goal: "Listing prepared with manifest, description, demo link, and submitted",
    channel: "integrations-and-mcp-listings",
    route: "muse:github + composio",
    approval: "A",
    inputs: ["repo", "listing-kit"],
    steps: ["Prepare MCP manifest or integration description", "Record demo and write listing copy", "Submit to first 3 marketplaces", "Track approval status weekly"],
    success_check: "Listings submitted to 3 marketplaces with complete kits",
    kpi: "referring_domains",
    impact: 3,
    confidence: 3,
    effort: 3,
    depends_on: [],
    notes: "MCP listings need a recent integration catalogue review.",
  },
  "subscribe-flow": {
    title: "Build subscribe flow — form, consent, double opt-in",
    goal: "Subscribe form live with clear promise, consent text, unsubscribe, and double opt-in where required",
    channel: "seo-informational",
    route: "muse:klaviyo + muse:github",
    approval: "C",
    inputs: ["brief"],
    steps: ["Design subscribe form with promise, consent, and unsubscribe", "Wire double opt-in where required by tool or law", "Test form end-to-end (subscribe → confirm → welcome)", "Get owner approval for first send"],
    success_check: "Subscribe form live, tested, double opt-in working, owner approved",
    kpi: "subscribers",
    impact: 5,
    confidence: 5,
    effort: 2,
    depends_on: [],
    notes: "Consent matters — follow applicable law.",
  },
  "content-calendar-12-weeks": {
    title: "Create 12-week content calendar (1–3 pieces/week)",
    goal: "12-week calendar in HQ with piece, keyword, intent, stage, dates, and URL stubs",
    channel: "seo-informational",
    route: "muse:google-docs-and-sheets",
    approval: "A",
    inputs: ["clusters", "market"],
    steps: ["Map keyword clusters to calendar slots by priority score", "Assign intent and stage per piece", "Add dates and URL stubs", "Save calendar in HQ"],
    success_check: "12-week calendar in HQ with keyword, intent, and dates per row",
    kpi: "search_clicks",
    impact: 4,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "1–3 pieces/week — raise only after indexing and impressions.",
  },
  "lead-magnet": {
    title: "Create lead magnet (free template, checklist, or guide)",
    goal: "Lead magnet live with preview, download gate, and nurture entry",
    channel: "email-and-lead-magnet",
    route: "muse:github + muse:canva",
    approval: "B",
    inputs: ["brief", "market"],
    steps: ["Pick lead-magnet idea with strong product fit", "Create magnet (template, checklist, or guide) with honest preview", "Add gated download with email capture", "Wire magnet to welcome sequence"],
    success_check: "Lead magnet live with preview and gated download, capture rate tracked",
    kpi: "email_signups",
    impact: 4,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Honest preview — what they see is what they get.",
  },
  "three-pillar-pages": {
    title: "Write 3 pillar content pages (informational, original element each)",
    goal: "3 pillar pages live, each covering an informational query with an original element",
    channel: "seo-informational",
    route: "muse:github",
    approval: "B",
    inputs: ["clusters", "serp-gaps"],
    steps: ["Brief 3 pillar pages (keyword, angle, original element, outline)", "Draft, fact-check, optimise, publish by PR", "Verify indexing and internal links", "Schedule for distribution kit"],
    success_check: "3 pillar pages live, indexed, with one original element each",
    kpi: "search_clicks",
    impact: 5,
    confidence: 4,
    effort: 4,
    depends_on: [],
    notes: "Quality and originality are the whole game.",
  },
  "outreach-list": {
    title: "Build outreach target list (20 newsletters/blogs/podcasts)",
    goal: "Outreach list of 20 targets with name, audience, why relevant, contact route, and personal detail",
    channel: "newsletter-swaps-and-mentions",
    route: "muse:google-sheets + web-search-and-browser",
    approval: "A",
    inputs: ["market"],
    steps: ["Search for newsletters, blogs, and podcasts by audience overlap", "Record name, audience, why relevant, contact route, one personal detail", "Score relevance 1–5", "Save list in Outreach CRM"],
    success_check: "CRM has 20 targets with all required fields",
    kpi: "subscribers",
    impact: 3,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "No bulk generic blasts — one specific pitch at a time.",
  },
  "product-page-pass": {
    title: "Optimise product pages (titles, descriptions, images, schema)",
    goal: "Top 5 product pages have optimised titles, descriptions, images, schema, and speed",
    channel: "seo-product-and-category",
    route: "muse:github + browser-and-lighthouse-via-site",
    approval: "B",
    inputs: ["live URL", "repo"],
    steps: ["Audit top 5 product pages for SEO and speed", "Fix titles, meta, schema, images via PR", "Check Core Web Vitals and fix critical issues", "Verify pages indexed and in sitemap"],
    success_check: "5 product pages with optimised titles/meta/schema, Core Web Vitals passing",
    kpi: "conversion_rate",
    impact: 5,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Paid stays off until product pages convert.",
  },
  "category-pages": {
    title: "Create optimised category pages (buying guides)",
    goal: "3 category pages live with buying guides, filters, and clear CTAs",
    channel: "seo-product-and-category",
    route: "muse:github",
    approval: "B",
    inputs: ["brief", "clusters"],
    steps: ["Map category keywords to SERP gaps", "Draft category pages with buying guides and CTAs", "Optimise on-page SEO and publish via PR", "Verify indexing and internal links"],
    success_check: "3 category pages live, indexed, linked from homepage and nav",
    kpi: "revenue_per_visit",
    impact: 4,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Category pages are shop windows — make them shoppable.",
  },
  "welcome-and-cart-sequences": {
    title: "Build welcome and abandoned-cart email sequences",
    goal: "Welcome (5 emails) and cart-abandon (3 emails) sequences live, with revenue attribution",
    channel: "email-lifecycle",
    route: "muse:klaviyo",
    approval: "C",
    inputs: ["brief"],
    steps: ["Draft welcome sequence (5 emails) and cart-abandon sequence (3 emails)", "Set up in Klaviyo with owner-approved templates", "Wire triggers (signup, cart abandon) and attribution", "Test and get owner approval for first sends"],
    success_check: "Both sequences active, triggers tested, owner approved first sends",
    kpi: "email_revenue_share",
    impact: 5,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "First send of each template is class C.",
  },
  "review-collection": {
    title: "Set up review collection (post-purchase trigger, direct link)",
    goal: "Review request triggered 7 days after purchase with direct link, owner-approved template",
    channel: "reviews",
    route: "muse:klaviyo + muse:google-sheets",
    approval: "C",
    inputs: ["brief"],
    steps: ["Create review request email (7 days after purchase)", "Add direct review link for ease", "Get owner approval for template", "Log reviews in tracker weekly"],
    success_check: "Review request sequence live, first batch sent, tracker active",
    kpi: "reviews",
    impact: 4,
    confidence: 4,
    effort: 1,
    depends_on: [],
    notes: "Ask at a good moment — after a win. Never pay for reviews.",
  },
  "creator-shortlist": {
    title: "Shortlist 10 creators for affiliate/gifted collabs",
    goal: "10 creators shortlisted with audience, format, contact route, and fit score",
    channel: "creators-and-affiliates",
    route: "muse:google-sheets + web-search-and-browser",
    approval: "A",
    inputs: ["market"],
    steps: ["Research creators by audience overlap and engagement", "Record audience, format, contact route, fit score", "Rank by fit and cost", "Save shortlist in Outreach CRM"],
    success_check: "Shortlist of 10 creators in CRM with audience and fit scores",
    kpi: "revenue_per_visit",
    impact: 3,
    confidence: 3,
    effort: 2,
    depends_on: [],
    notes: "Creators are for month 2 — shortlist now, pilot after product pages convert.",
  },
  "maps-profile-pass": {
    title: "Complete Google Business / maps profile pass",
    goal: "Maps profile 100% complete — NAP, hours, services, photos, Q&A, schema",
    channel: "local-seo-and-maps-profile",
    route: "muse:google-sheets + browser",
    approval: "A",
    inputs: ["brief"],
    steps: ["Fill NAP, hours, service area, attributes in maps profile", "Upload 20 high-quality photos (service, team, location)", "Add Q&A and verify schema LocalBusiness on site", "Check NAP identical everywhere"],
    success_check: "Maps profile complete with photos, Q&A, LocalBusiness schema verified",
    kpi: "map_views",
    impact: 5,
    confidence: 5,
    effort: 2,
    depends_on: [],
    notes: "Reviews and photos carry the business — keep NAP identical everywhere.",
  },
  "location-pages": {
    title: "Create location / service-area pages",
    goal: "3 location pages live with local keywords, NAP, map embed, and booking CTA",
    channel: "local-seo-and-maps-profile",
    route: "muse:github",
    approval: "B",
    inputs: ["brief", "clusters"],
    steps: ["Map local keywords to service areas", "Draft location pages (local content, NAP, map, booking CTA)", "Optimise on-page SEO and publish via PR", "Verify indexing and internal links"],
    success_check: "3 location pages live, indexed, with local keywords and booking CTAs",
    kpi: "bookings",
    impact: 4,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Each location page is a local storefront — make it findable.",
  },
  "photo-and-video-plan": {
    title: "Create photo and video plan for the service",
    goal: "Shot list of 20 photos + 2 short videos prepared, scheduled, and first batch shot",
    channel: "social-and-visual",
    route: "muse:google-docs-and-sheets + muse:canva",
    approval: "A",
    inputs: ["brief"],
    steps: ["Create shot list (20 photos: service, team, location; 2 short videos)", "Schedule shoot and assign responsibilities", "Shoot first batch (10 photos + 1 video)", "Upload and optimise for web/social"],
    success_check: "Shot list done, first batch shot and live on site/social",
    kpi: "map_views",
    impact: 4,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "Real photos — never stock or fake.",
  },
  "partner-list": {
    title: "Build partner list (10 local partnerships)",
    goal: "10 local partner opportunities mapped with audience, contact, and mutual value",
    channel: "partnerships-and-referrals",
    route: "muse:google-sheets + web-search-and-browser",
    approval: "A",
    inputs: ["market"],
    steps: ["Research local partners (hotels, agencies, complementary services)", "Record name, audience, contact route, mutual value", "Create one-page partner sheet", "Save list in Outreach CRM"],
    success_check: "Partner list of 10 in CRM with audience and mutual value",
    kpi: "bookings",
    impact: 3,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "Local partnerships are month 1 foundations — low cost, high trust.",
  },
  "booking-flow-check": {
    title: "Audit and fix booking flow (conversion check)",
    goal: "Booking flow audited end-to-end with conversion fixes applied",
    channel: "local-seo-and-maps-profile",
    route: "muse:github + browser",
    approval: "A",
    inputs: ["live URL", "repo"],
    steps: ["Walk through booking flow manually, note friction points", "Fix top 3 conversion blockers via PR", "Test on mobile and desktop", "Verify booking confirmation and notification"],
    success_check: "Booking flow fixed, tested on mobile+desktop, confirmation working",
    kpi: "bookings",
    impact: 5,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "Booking flow is the conversion engine — fix it first.",
  },
  "free-sample": {
    title: "Create free sample / free tier asset",
    goal: "Free sample live with preview, honest limits, and gated download or email capture",
    channel: "seo-templates-and-how-to",
    route: "muse:github + muse:canva",
    approval: "B",
    inputs: ["brief", "market"],
    steps: ["Pick best-selling asset type for the free sample", "Create free sample with honest preview and limits", "Add gated download with email capture", "Publish and track downloads"],
    success_check: "Free sample live with preview, gated download, capture tracked",
    kpi: "free_sample_downloads",
    impact: 4,
    confidence: 4,
    effort: 2,
    depends_on: [],
    notes: "Free sample is the product's best ad — make it genuinely useful.",
  },
  "preview-pages": {
    title: "Build preview-rich product pages (3 assets)",
    goal: "3 product pages with preview galleries, honest descriptions, and licence terms",
    channel: "seo-templates-and-how-to",
    route: "muse:github",
    approval: "B",
    inputs: ["brief", "clusters"],
    steps: ["Pick 3 hero assets with strongest market evidence", "Build preview pages (gallery, description, licence, CTA)", "Optimise on-page SEO and publish via PR", "Verify indexing and internal links"],
    success_check: "3 product pages live, indexed, with previews and licence terms",
    kpi: "sales",
    impact: 5,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Give honest previews — refunds hurt more than missed sales.",
  },
  "marketplace-listings": {
    title: "Create marketplace listings (3 marketplaces)",
    goal: "Listings live on 3 marketplaces with optimised copy, previews, and licence terms",
    channel: "marketplaces-and-directories",
    route: "muse-browser + muse:canva",
    approval: "B",
    inputs: ["listing-kit", "brief"],
    steps: ["Shortlist marketplaces by asset-type fit and fee structure", "Create listings (copy, previews, licence)", "Submit and verify live", "Track sales attribution per marketplace"],
    success_check: "3 marketplace listings live with complete info and previews",
    kpi: "sales",
    impact: 4,
    confidence: 3,
    effort: 3,
    depends_on: ["T-001"],
    notes: "Check licence terms before listing on marketplaces.",
  },
  "affiliate-offer": {
    title: "Create affiliate offer (commission, cookie window, assets)",
    goal: "Affiliate programme defined with commission, cookie window, and promo assets",
    channel: "creators-and-affiliates",
    route: "muse:google-docs-and-sheets",
    approval: "A",
    inputs: ["brief"],
    steps: ["Define commission rate, cookie window, and payout rules", "Create affiliate promo assets (banners, copy, links)", "Write affiliate programme page", "Save in HQ and queue for month 2 launch"],
    success_check: "Affiliate programme doc in HQ with commission, window, and assets",
    kpi: "sales",
    impact: 3,
    confidence: 3,
    effort: 2,
    depends_on: [],
    notes: "Affiliates are month 2 — define now, launch after first traction.",
  },
  "tool-page-pass": {
    title: "Optimise tool page — speed, accuracy, schema, internal links",
    goal: "Tool page scores 90+ on Lighthouse performance, has correct schema, and is linked from 2 pages",
    channel: "seo-tool-pages",
    route: "muse:github + browser-and-lighthouse-via-site",
    approval: "B",
    inputs: ["live URL", "repo"],
    steps: ["Audit tool page for speed, accuracy, schema, and UX", "Fix critical performance issues and add SoftwareApplication schema", "Add internal links from 2 existing pages", "Verify indexing and Core Web Vitals"],
    success_check: "Tool page 90+ Lighthouse, schema valid, 2 internal links, indexed",
    kpi: "organic_visits",
    impact: 5,
    confidence: 5,
    effort: 2,
    depends_on: [],
    notes: "Speed and accuracy are the product — measure both.",
  },
  "explainer-pages": {
    title: "Create 3 explainer pages (tool-adjacent queries)",
    goal: "3 explainer pages live covering tool-adjacent how-to queries with SERP gaps",
    channel: "seo-tool-pages",
    route: "muse:github",
    approval: "B",
    inputs: ["clusters", "serp-gaps"],
    steps: ["Pick 3 tool-adjacent keywords with SERP gaps", "Draft explainer pages (how-to, examples, original angle)", "Optimise on-page SEO and publish via PR", "Verify indexing and internal links"],
    success_check: "3 explainer pages live, indexed, linked from tool page",
    kpi: "tool_uses",
    impact: 4,
    confidence: 4,
    effort: 3,
    depends_on: [],
    notes: "Explainer pages funnel intent into the tool.",
  },
  "schema-and-speed-pass": {
    title: "Schema and speed pass — structured data, Core Web Vitals",
    goal: "All live pages have correct schema (Article/SoftwareApplication/BreadcrumbList) and Core Web Vitals passing",
    channel: "seo-tool-pages",
    route: "muse:github + browser-and-lighthouse-via-site",
    approval: "A",
    inputs: ["live URL", "repo"],
    steps: ["Audit schema on every live page", "Fix schema errors and add missing structured data", "Run Lighthouse on top 5 pages and fix critical issues", "Verify schema in Google Rich Results Test"],
    success_check: "Schema valid on all pages, no Core Web Vitals failures",
    kpi: "organic_visits",
    impact: 4,
    confidence: 5,
    effort: 2,
    depends_on: [],
    notes: "Schema helps Google understand tool pages — required.",
  },
  "embed-or-share-feature": {
    title: "Build embed/share feature (widget with attribution link)",
    goal: "Embed widget live with attribution link and share CTA — non-intrusive",
    channel: "embeds-and-backlinks",
    route: "muse:github",
    approval: "A",
    inputs: ["repo", "live URL"],
    steps: ["Design embeddable widget with built-in attribution link", "Implement embed code snippet and test on 2 sites", "Add share CTA to tool page (non-blocking)", "Track embed adoption and referring domains"],
    success_check: "Embed widget live, tested, share CTA present, tracking active",
    kpi: "referring_domains",
    impact: 3,
    confidence: 3,
    effort: 3,
    depends_on: [],
    notes: "Ads and signups must not block the tool — non-intrusive only.",
  },
  "email-capture": {
    title: "Add email capture to tool page (save-results or lead magnet)",
    goal: "Email capture live on tool page with clear value prop and capture rate tracked",
    channel: "email-capture",
    route: "muse:github",
    approval: "A",
    inputs: ["live URL", "repo"],
    steps: ["Design capture (save results, bonus template, or notification)", "Implement non-blocking capture below tool output", "Add unsubscribe and consent handling", "Track capture rate weekly"],
    success_check: "Email capture live, non-blocking, consent handled, rate tracked",
    kpi: "email_signups",
    impact: 3,
    confidence: 4,
    effort: 1,
    depends_on: [],
    notes: "Must not block the tool — value-first capture only.",
  },
};

// ---------------------------------------------------------------------------
// Fallback for unknown first_30_days ids
// ---------------------------------------------------------------------------

function fallbackBlueprint(id: string): Omit<TaskBlueprint, "id"> {
  return {
    title: `Complete: ${id}`,
    goal: `Outcome for ${id} — see plan and brief`,
    channel: "directories",
    route: "muse:github",
    approval: "A",
    inputs: ["brief"],
    steps: ["Research and prepare", "Execute", "Verify and log evidence"],
    success_check: `${id} outcome verified with evidence`,
    kpi: "organic_visits",
    impact: 3,
    confidence: 3,
    effort: 3,
    depends_on: [],
    notes: "",
  };
}

// ---------------------------------------------------------------------------
// Priority (ops-loop §3)
// ---------------------------------------------------------------------------

/**
 * Priority score: (impact × confidence) / effort.
 * +2 if the task unlocks 3+ others; −2 if approval unanswered 3 days.
 * The caller tracks unlock counts and pending approvals.
 */
export function priorityScore(
  task: Pick<Task, "impact" | "confidence" | "effort">,
  opts: { unlocksCount?: number; approvalOverdue?: boolean } = {},
): number {
  let score = (task.impact * task.confidence) / task.effort;
  if ((opts.unlocksCount ?? 0) >= 3) score += 2;
  if (opts.approvalOverdue) score -= 2;
  return score;
}

// ---------------------------------------------------------------------------
// Public API: generateBacklog
// ---------------------------------------------------------------------------

export interface GenerateBacklogInput {
  archetypeId: ArchetypeId | string;
  rankedChannels?: readonly RankedChannel[];
}

export function generateBacklog(input: GenerateBacklogInput): Task[] {
  const archetype = getArchetype(input.archetypeId);
  if (!archetype) {
    throw new Error(`Unknown archetype "${input.archetypeId}"`);
  }

  const tasks: Task[] = [];
  let seq = 1;

  function nextId(): string {
    return `T-${String(seq++).padStart(3, "0")}`;
  }

  // Map of already-issued ids by blueprint key, so depends_on can reference them
  const issuedByBlueprint: Record<string, string> = {};

  // Phase 1: first_30_days — deterministic order per archetype
  for (const rawKey of archetype.first_30_days) {
    const bp = (BLUEPRINTS[rawKey] ?? fallbackBlueprint(rawKey)) as Omit<TaskBlueprint, "id">;
    const id = nextId();
    issuedByBlueprint[rawKey] = id;

    // Resolve depends_on: if a dependency blueprint was already issued, use its
    // actual T-NNN id; otherwise keep as-is (it may reference a task that does
    // not exist in this batch — that is intentional and not an error per spec)
    const depends_on = bp.depends_on.map((dep) => issuedByBlueprint[dep] ?? dep);

    tasks.push({
      id,
      title: bp.title,
      goal: bp.goal,
      channel: bp.channel,
      route: bp.route,
      approval: bp.approval,
      inputs: [...bp.inputs],
      steps: [...bp.steps],
      success_check: bp.success_check,
      kpi: bp.kpi,
      impact: bp.impact,
      confidence: bp.confidence,
      effort: bp.effort,
      depends_on,
      status: "todo",
      evidence: [],
      notes: bp.notes,
    });
  }

  // Phase 2: one task per ranked channel that is not already covered by a
  // first_30_days blueprint — ensures every plan channel has at least one task
  const coveredChannels = new Set(tasks.map((t) => t.channel));
  if (input.rankedChannels) {
    for (const rc of input.rankedChannels) {
      if (coveredChannels.has(rc.channel)) continue;
      const detail = BLUEPRINTS[rc.channel] ? undefined : fallbackBlueprint(rc.channel);
      // Prefer a channel-specific blueprint if one exists with that key
      const bp = (BLUEPRINTS[rc.channel] as Omit<TaskBlueprint, "id"> | undefined) ?? detail!;
      const id = nextId();
      tasks.push({
        id,
        title: bp.title,
        goal: bp.goal,
        channel: rc.channel,
        route: bp.route,
        approval: bp.approval,
        inputs: [...bp.inputs],
        steps: [...bp.steps],
        success_check: bp.success_check,
        kpi: bp.kpi,
        impact: bp.impact,
        confidence: bp.confidence,
        effort: bp.effort,
        depends_on: bp.depends_on.map((dep) => issuedByBlueprint[dep] ?? dep),
        status: "todo",
        evidence: [],
        notes: bp.notes,
      });
      coveredChannels.add(rc.channel);
    }
  }

  return tasks;
}

/** Return tasks sorted by priority descending (higher score first). */
export function sortByPriority(tasks: readonly Task[]): Task[] {
  // Count how many tasks each task unlocks
  const unlocksCount: Record<string, number> = {};
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      unlocksCount[dep] = (unlocksCount[dep] ?? 0) + 1;
    }
  }

  const scored = tasks.map((t) => ({
    task: t,
    score: priorityScore(t, { unlocksCount: unlocksCount[t.id] ?? 0 }),
  }));
  scored.sort((a, b) => b.score - a.score || tasks.indexOf(a.task) - tasks.indexOf(b.task));
  return scored.map((s) => s.task);
}
