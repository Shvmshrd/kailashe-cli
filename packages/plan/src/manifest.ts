/**
 * Manifest builder — picks only capabilities the plan needs (based on
 * channels/flows). Every manifest entry maps to a connectors.yaml capability.
 * (SPEC §6.9 / tool-hubs §4)
 */

import type { ArchetypeId } from "./archetype.js";
import { getArchetype } from "./archetype.js";
import type { RankedChannel } from "./ranking.js";

// ---------------------------------------------------------------------------
// Minimal connectors.yaml shape needed by the manifest builder
// ---------------------------------------------------------------------------

export interface ConnectorRoute {
  via: string;
  tool: string;
  status: string;
  class: string;
  note?: string;
}

export interface ConnectorCapability {
  id: string;
  purpose: string;
  routes: ConnectorRoute[];
}

export interface ConnectorsRegistry {
  version: number;
  verified: string;
  capabilities: Record<string, ConnectorCapability>;
}

// ---------------------------------------------------------------------------
// Manifest type (SPEC §6.9 / tool-hubs §4)
// ---------------------------------------------------------------------------

export interface ManifestBudget {
  monthly_cap_usd: number;
  per_action_cap_usd: number;
}

export interface ManifestCapability {
  id: string;
  route: string;
  allowed: string[];
  class: string;
  cost?: string;
  notes?: string;
}

export interface Manifest {
  project: string;
  budget: ManifestBudget;
  capabilities: ManifestCapability[];
}

// ---------------------------------------------------------------------------
// Channel → capabilities + Flow → capabilities mappings
// ---------------------------------------------------------------------------

/**
 * Maps archetype channel ids to the connectors.yaml capability ids they need.
 * A channel may require 0, 1, or several capabilities.
 */
const CHANNEL_CAPABILITIES: Record<string, string[]> = {
  // Generic / shared
  "directories": ["directories.submit", "docs.hq", "chat.notify"],
  "directories-ai": ["directories.submit", "docs.hq"],
  "directories-and-review-sites": ["directories.submit", "reviews.monitor"],
  "directories-and-travel-sites": ["directories.submit", "docs.hq"],
  "docs-and-readme": ["code.pr", "docs.hq"],
  "hacker-news": ["social.hacker_news", "docs.hq"],
  "communities": ["social.reddit", "docs.hq", "chat.notify"],
  "social-dev": ["social.x", "docs.hq"],
  "social": ["social.x", "docs.hq"],
  "social-x-and-linkedin": ["social.x", "social.linkedin"],
  "social-and-visual": ["social.meta_apps", "design.assets"],
  "social-and-short-video": ["social.meta_apps", "social.video", "design.assets"],
  "short-video-and-social": ["social.meta_apps", "social.video", "design.assets"],
  "newsletters-and-podcasts": ["outreach.crm", "email.campaigns"],
  "newsletter-swaps-and-mentions": ["outreach.crm", "email.campaigns"],
  "integrations-and-awesome-lists": ["code.pr", "docs.hq"],
  "integrations-and-mcp-listings": ["content.publish_repo", "docs.hq"],
  "seo-comparisons": ["seo.keywords", "seo.serp", "content.publish_repo", "seo.search_console"],
  "seo-bottom-funnel": ["seo.keywords", "seo.serp", "content.publish_repo", "seo.search_console"],
  "seo-informational": ["seo.keywords", "seo.serp", "content.publish_repo", "seo.search_console"],
  "seo-how-to-and-templates": ["seo.keywords", "seo.serp", "content.publish_repo", "seo.search_console"],
  "seo-product-and-category": ["seo.keywords", "seo.serp", "content.publish_repo", "seo.audit"],
  "seo-templates-and-how-to": ["seo.keywords", "seo.serp", "content.publish_repo", "seo.search_console"],
  "seo-tool-pages": ["seo.keywords", "seo.serp", "seo.audit", "content.publish_repo"],
  "linkedin": ["social.linkedin", "outreach.crm"],
  "email": ["email.campaigns", "email.inbox"],
  "email-and-outreach": ["email.campaigns", "email.inbox", "outreach.crm"],
  "email-and-lead-magnet": ["email.campaigns", "outreach.crm"],
  "email-lifecycle": ["email.campaigns"],
  "email-capture": ["email.campaigns"],
  "email-and-chat": ["email.campaigns", "email.inbox"],
  "partnerships": ["outreach.crm", "social.linkedin"],
  "partnerships-and-referrals": ["outreach.crm", "email.campaigns"],
  "launch-platforms": ["directories.submit", "social.x", "social.linkedin", "content.publish_repo"],
  "app-store-or-seo": ["seo.keywords", "seo.serp", "seo.audit"],
  "influencers-and-creators": ["outreach.crm", "email.campaigns"],
  "referral-loops": ["flows.build", "analytics.web"],
  "marketplaces": ["content.cms", "analytics.web"],
  "marketplaces-and-directories": ["directories.submit", "content.cms"],
  "creators-and-affiliates": ["outreach.crm", "email.campaigns"],
  "paid-after-proof": ["analytics.web"],
  "local-seo-and-maps-profile": ["seo.audit", "seo.search_console", "content.publish_repo"],
  "reviews": ["reviews.monitor", "email.campaigns"],
  "search-and-discover-feeds": ["content.publish_repo", "seo.search_console"],
  "embeds-and-backlinks": ["analytics.web", "content.publish_repo"],
};

/**
 * Maps tool-hubs starter-flow ids to the extra capabilities they need
 * (on top of the base that channels already cover).
 */
const FLOW_CAPABILITIES: Record<string, string[]> = {
  "github-star-alerts": ["code.pr", "chat.notify"],
  "release-to-social": ["content.publish_repo", "social.x"],
  "mentions-watch": ["reviews.monitor"],
  "gsc-weekly": ["seo.search_console", "docs.hq"],
  "uptime-alert": ["uptime"],
  "lead-route": ["outreach.crm", "chat.notify", "scheduling"],
  "signup-welcome": ["email.campaigns", "outreach.crm", "chat.notify"],
  "payment-events": ["payments.stripe", "chat.notify", "outreach.crm"],
  "review-request": ["email.campaigns", "reviews.monitor"],
  "support-triage": ["email.inbox", "chat.notify"],
  "content-to-social": ["social.scheduler", "content.publish_repo"],
  "abandoned-cart": ["email.campaigns", "analytics.web"],
  "newsletter-pipeline": ["email.campaigns", "content.publish_repo"],
  "local-review-request": ["email.campaigns", "reviews.monitor"],
  "directory-check": ["directories.submit"],
  "github-star-alerts-flow": ["code.pr", "chat.notify"],
};

// Capabilities required regardless of archetype (HQ, basic comms)
const BASE_CAPABILITIES: string[] = ["docs.hq", "research.web", "chat.notify"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allowedForCapability(capabilityId: string): string[] {
  // Narrowest allowed lists per capability — human-readable action names.
  const MAP: Record<string, string[]> = {
    "docs.hq": ["create_page", "read_page", "update_page", "create_database_row"],
    "tasks.board": ["create_task", "read_tasks", "update_task"],
    "chat.notify": ["send_message"],
    "code.pr": ["read_file", "create_branch", "commit_files", "open_pull_request"],
    "code.deploy_status": ["read_deploy_status"],
    "research.web": ["search", "read_page"],
    "seo.trends": ["explore_trends", "read_trends"],
    "seo.keywords": ["keywords_google_ads_search_volume", "labs_google_keyword_ideas", "labs_google_related_keywords"],
    "seo.serp": ["dataforseo_serp_api_live_advanced", "search_and_read"],
    "seo.search_console": ["search_console_queries", "search_console_pages", "search_console_export"],
    "seo.audit": ["lighthouse_audit", "browser_site_check"],
    "content.publish_repo": ["read_file", "create_branch", "commit_files", "open_pull_request"],
    "content.cms": ["create_draft", "read_draft"],
    "directories.submit": ["browser_submit", "track_submission", "read_tracker"],
    "social.meta_apps": ["read_analytics"],
    "social.x": ["search_posts", "prepare_draft", "schedule_post"],
    "social.linkedin": ["prepare_post", "search_posts"],
    "social.reddit": ["read_subreddit", "prepare_reply"],
    "social.hacker_news": ["prepare_show_hn", "read_threads"],
    "social.scheduler": ["schedule_post", "read_schedule"],
    "social.video": ["prepare_script", "prepare_thumbnail"],
    "email.campaigns": ["create_campaign", "send_to_opted_in_list", "read_campaign_stats"],
    "email.inbox": ["read_inbox", "draft_reply"],
    "outreach.crm": ["create_row", "read_rows", "update_row"],
    "design.assets": ["create_design", "export_image"],
    "payments.stripe": ["read_events", "read_products"],
    "accounting": ["read_invoices"],
    "scheduling": ["create_booking_link", "read_calendar"],
    "analytics.web": ["read_analytics", "read_conversions"],
    "reviews.monitor": ["read_reviews", "read_mentions"],
    "flows.build": ["discover_pieces", "build_flow", "test_flow"],
    "uptime": ["scheduled_http_check", "alert_on_failure"],
  };
  return MAP[capabilityId] ?? ["read"];
}

function classForCapability(capabilityId: string, registry: ConnectorsRegistry): string {
  const cap = registry.capabilities[capabilityId];
  if (!cap) return "A";
  // Use the least-privilege class among routes (A < B < C)
  const order: Record<string, number> = { A: 0, B: 1, C: 2 };
  let best = "C";
  let bestRank = 2;
  for (const r of cap.routes) {
    const rank = order[r.class] ?? 1;
    if (rank < bestRank) {
      bestRank = rank;
      best = r.class;
    }
  }
  return best;
}

function routeForCapability(capabilityId: string, registry: ConnectorsRegistry): string {
  const cap = registry.capabilities[capabilityId];
  if (!cap) return "unknown";
  const r = cap.routes[0];
  if (!r) return "unknown";
  return `${r.via}:${r.tool}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildManifestInput {
  project: string;
  archetypeId: ArchetypeId | string;
  rankedChannels?: readonly RankedChannel[];
  registry?: ConnectorsRegistry;
  monthlyCapUsd?: number;
  perActionCapUsd?: number;
}

/**
 * Build a tool manifest from the archetype + ranked channels + flows.
 * Every capability id in the result exists in the supplied registry (or the
 * default registry distilled from connectors.yaml).
 */
export function buildManifest(input: BuildManifestInput): Manifest {
  const archetype = getArchetype(input.archetypeId);
  if (!archetype) throw new Error(`Unknown archetype "${input.archetypeId}"`);

  const registry = input.registry ?? getDefaultRegistry();

  // Collect capability ids from all sources
  const needed = new Set<string>(BASE_CAPABILITIES);

  // From ranked channels (or archetype default if no ranking provided)
  const channels = input.rankedChannels?.map((r) => r.channel) ?? [...archetype.channels_ranked];
  for (const ch of channels) {
    const caps = CHANNEL_CAPABILITIES[ch] ?? [];
    for (const cap of caps) needed.add(cap);
  }

  // From archetype flows
  for (const flowId of archetype.flows) {
    const caps = FLOW_CAPABILITIES[flowId] ?? [];
    for (const cap of caps) needed.add(cap);
  }

  // Filter to only capabilities that actually exist in the registry
  const validNeeded = [...needed].filter((id) => id in registry.capabilities);

  // Build ManifestCapability entries, sorted for determinism
  validNeeded.sort();

  const capabilities: ManifestCapability[] = validNeeded.map((id) => ({
    id,
    route: routeForCapability(id, registry),
    allowed: allowedForCapability(id),
    class: classForCapability(id, registry),
  }));

  // Add cost hints where applicable
  for (const c of capabilities) {
    if (c.id === "seo.keywords" || c.id === "seo.serp" || c.id === "seo.trends") {
      c.cost = "pay per call";
    }
  }

  return {
    project: input.project,
    budget: {
      monthly_cap_usd: input.monthlyCapUsd ?? 0,
      per_action_cap_usd: input.perActionCapUsd ?? 0,
    },
    capabilities,
  };
}

/**
 * Validate that every manifest entry's id exists in the registry.
 * Throws on failure (the validate-pack path).
 */
export function validateManifest(
  manifest: Manifest,
  registry: ConnectorsRegistry,
): { valid: true } | { valid: false; unknownIds: string[] } {
  const unknownIds = manifest.capabilities.filter((c) => !(c.id in registry.capabilities)).map((c) => c.id);
  if (unknownIds.length === 0) return { valid: true };
  return { valid: false, unknownIds };
}

export function assertManifestValid(manifest: Manifest, registry: ConnectorsRegistry): void {
  const result = validateManifest(manifest, registry);
  if (!result.valid) {
    throw new Error(`Manifest validation failed: unknown capability ids: ${result.unknownIds.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Default registry (distilled from connectors.yaml — capabilities section)
// ---------------------------------------------------------------------------

function getDefaultRegistry(): ConnectorsRegistry {
  return DEFAULT_REGISTRY;
}

/**
 * Default registry — capabilities distilled from connectors.yaml.
 * Kept in sync with skill/kailashe-operator/assets/connectors.yaml (version 1).
 */
export const DEFAULT_REGISTRY: ConnectorsRegistry = {
  version: 1,
  verified: "2026-10-13",
  capabilities: {
    "docs.hq": { id: "docs.hq", purpose: "Project HQ pages and sheets", routes: [{ via: "muse", tool: "notion", status: "live", class: "A" }, { via: "muse", tool: "google-docs-and-sheets", status: "live", class: "A" }] },
    "tasks.board": { id: "tasks.board", purpose: "Backlog board outside HQ, optional", routes: [{ via: "muse", tool: "asana", status: "live", class: "A" }] },
    "chat.notify": { id: "chat.notify", purpose: "Alerts and approvals to the owner", routes: [{ via: "muse", tool: "slack", status: "live", class: "A" }] },
    "code.pr": { id: "code.pr", purpose: "Open pull requests for content and SEO fixes", routes: [{ via: "muse", tool: "github", status: "live", class: "A" }] },
    "code.deploy_status": { id: "code.deploy_status", purpose: "Check deploys and logs after merges", routes: [{ via: "muse", tool: "vercel", status: "live", class: "A" }] },
    "research.web": { id: "research.web", purpose: "Search and read pages", routes: [{ via: "muse", tool: "web-search-and-browser", status: "live", class: "A" }] },
    "seo.trends": { id: "seo.trends", purpose: "Google Trends interest, rising queries, regions", routes: [{ via: "custom", tool: "google-trends-api-alpha", status: "custom", class: "A" }] },
    "seo.keywords": { id: "seo.keywords", purpose: "Volume, difficulty, related keywords, questions", routes: [{ via: "custom", tool: "dataforseo", status: "custom", class: "A" }] },
    "seo.serp": { id: "seo.serp", purpose: "Read top results, features, People Also Ask", routes: [{ via: "muse", tool: "web-search-and-browser", status: "live", class: "A" }] },
    "seo.search_console": { id: "seo.search_console", purpose: "Queries, impressions, clicks, positions, indexing", routes: [{ via: "composio", tool: "google-search-console", status: "hub", class: "A" }] },
    "seo.audit": { id: "seo.audit", purpose: "Technical and on-page checks", routes: [{ via: "muse", tool: "browser-and-lighthouse-via-site", status: "browser", class: "A" }] },
    "content.publish_repo": { id: "content.publish_repo", purpose: "Publish content by pull request", routes: [{ via: "muse", tool: "github", status: "live", class: "B" }] },
    "content.cms": { id: "content.cms", purpose: "Publish drafts to a CMS", routes: [{ via: "composio", tool: "wordpress-ghost-webflow-sanity", status: "hub", class: "B" }] },
    "directories.submit": { id: "directories.submit", purpose: "Submit to directories and listing sites", routes: [{ via: "browser", tool: "directory-forms", status: "browser", class: "B" }] },
    "social.meta_apps": { id: "social.meta_apps", purpose: "Facebook, Instagram, Threads", routes: [{ via: "muse", tool: "meta-accounts", status: "live", class: "C" }] },
    "social.x": { id: "social.x", purpose: "Posts and replies on X", routes: [{ via: "composio", tool: "twitter-x", status: "hub", class: "C" }] },
    "social.linkedin": { id: "social.linkedin", purpose: "Posts on LinkedIn", routes: [{ via: "composio", tool: "linkedin", status: "hub", class: "C" }] },
    "social.reddit": { id: "social.reddit", purpose: "Read threads, prepare replies, post with approval", routes: [{ via: "browser", tool: "reddit-read", status: "browser", class: "A" }] },
    "social.hacker_news": { id: "social.hacker_news", purpose: "Show HN and comments", routes: [{ via: "browser", tool: "news-ycombinator-website", status: "browser", class: "C" }] },
    "social.scheduler": { id: "social.scheduler", purpose: "Schedule approved posts", routes: [{ via: "zapier", tool: "buffer-or-similar", status: "hub", class: "B" }] },
    "social.video": { id: "social.video", purpose: "Short video and YouTube", routes: [{ via: "composio", tool: "youtube", status: "hub", class: "C" }] },
    "email.campaigns": { id: "email.campaigns", purpose: "Newsletters, sequences, lifecycle email", routes: [{ via: "muse", tool: "klaviyo", status: "live", class: "B" }] },
    "email.inbox": { id: "email.inbox", purpose: "Triage, drafts, one-to-one outreach", routes: [{ via: "muse", tool: "gmail", status: "live", class: "C" }] },
    "outreach.crm": { id: "outreach.crm", purpose: "Targets, contacts, status", routes: [{ via: "muse", tool: "google-sheets", status: "live", class: "A" }] },
    "design.assets": { id: "design.assets", purpose: "Social graphics, OG images, listing images", routes: [{ via: "muse", tool: "canva", status: "live", class: "A" }] },
    "payments.stripe": { id: "payments.stripe", purpose: "Payment events, products, links", routes: [{ via: "muse", tool: "stripe", status: "live", class: "C" }] },
    "accounting": { id: "accounting", purpose: "Invoices, expenses", routes: [{ via: "muse", tool: "quickbooks", status: "live", class: "C" }] },
    "scheduling": { id: "scheduling", purpose: "Booking links, calendar", routes: [{ via: "muse", tool: "google-calendar", status: "live", class: "B" }] },
    "analytics.web": { id: "analytics.web", purpose: "Traffic, conversions, funnels", routes: [{ via: "composio", tool: "google-analytics", status: "hub", class: "A" }] },
    "reviews.monitor": { id: "reviews.monitor", purpose: "Read reviews and mentions", routes: [{ via: "browser", tool: "review-sites-read", status: "browser", class: "A" }] },
    "flows.build": { id: "flows.build", purpose: "Build recurring automations", routes: [{ via: "activepieces", tool: "flow-building-mcp", status: "custom", class: "B" }] },
    "uptime": { id: "uptime", purpose: "Know when the live site breaks", routes: [{ via: "flow", tool: "uptime-alert", status: "hub", class: "A" }] },
  },
};

/** All capability ids from the default registry. */
export function allCapabilityIds(registry: ConnectorsRegistry = DEFAULT_REGISTRY): string[] {
  return Object.keys(registry.capabilities);
}
