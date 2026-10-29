/**
 * Channel map — SPEC §6.13 (ChannelMap, Q6).
 *
 * Channel ids in archetypes.yaml are labels (not checked against channels.md).
 * This map is the authoritative registry: channel id → playbook section.
 * validate-pack hard-fails if an archetype references a channel missing here.
 */

export interface ChannelMapEntry {
  /** Playbook file that owns this channel's guidance. */
  file: string;
  /** Heading/section inside that file. */
  heading: string;
  /** Short description of the channel. */
  description: string;
}

/**
 * Every channel id appearing in archetypes.yaml must have an entry here.
 * Channel ids are labels — they are NOT validated against channels.md.
 */
export const CHANNEL_MAP: Readonly<Record<string, ChannelMapEntry>> = {
  // ---- dev-tool ----
  "docs-and-readme": {
    file: "channels.md",
    heading: "Support loop / Docs",
    description: "README, docs site, API reference — the primary surface for developer tools",
  },
  "hacker-news": {
    file: "channels.md",
    heading: "Hacker News",
    description: "Show HN launch and ongoing HN participation",
  },
  "communities": {
    file: "channels.md",
    heading: "Communities",
    description: "Developer communities — Reddit, Discord, Slack, forums, GitHub Discussions",
  },
  "social-dev": {
    file: "channels.md",
    heading: "Social",
    description: "Developer social — X, Mastodon, Bluesky, dev-focused social posts",
  },
  "directories": {
    file: "channels.md",
    heading: "Directories and listings",
    description: "Directory and listing submissions for discovery",
  },
  "newsletters-and-podcasts": {
    file: "channels.md",
    heading: "Outreach and PR",
    description: "Newsletter features and podcast appearances",
  },
  "integrations-and-awesome-lists": {
    file: "channels.md",
    heading: "Growth loops — Integrations",
    description: "Ecosystem integrations and curated awesome-lists",
  },
  "seo-comparisons": {
    file: "content-engine.md",
    heading: "Content types — Bottom funnel",
    description: "Comparison and alternatives SEO pages",
  },

  // ---- b2b-saas ----
  "seo-bottom-funnel": {
    file: "content-engine.md",
    heading: "Content types — Bottom funnel",
    description: "Bottom-of-funnel SEO — alternatives, comparisons, best-for pages",
  },
  "directories-and-review-sites": {
    file: "channels.md",
    heading: "Directories and listings",
    description: "B2B directories and review sites (G2, Capterra, etc.)",
  },
  "linkedin": {
    file: "channels.md",
    heading: "Social",
    description: "LinkedIn organic and thought-leadership posts",
  },
  "email-and-outreach": {
    file: "channels.md",
    heading: "Email + Outreach and PR",
    description: "Lifecycle email and targeted outbound outreach",
  },
  "partnerships": {
    file: "channels.md",
    heading: "Growth loops — Integrations",
    description: "Integration partnerships and co-marketing",
  },
  "launch-platforms": {
    file: "channels.md",
    heading: "Launch",
    description: "Product Hunt and launch-platform campaigns",
  },

  // ---- b2c-app ----
  "short-video-and-social": {
    file: "channels.md",
    heading: "Social",
    description: "Short-form video and social content (TikTok, Reels, Shorts)",
  },
  "app-store-or-seo": {
    file: "channels.md",
    heading: "Paid — App store optimisation",
    description: "App-store listing optimisation or organic SEO as acquisition surface",
  },
  "email": {
    file: "channels.md",
    heading: "Email",
    description: "Lifecycle and retention email sequences",
  },
  "influencers-and-creators": {
    file: "channels.md",
    heading: "Growth loops",
    description: "Influencer and creator collaborations",
  },
  "referral-loops": {
    file: "channels.md",
    heading: "Growth loops",
    description: "Referral and viral loop mechanics",
  },

  // ---- ai-tool ----
  "directories-ai": {
    file: "channels.md",
    heading: "Directories and listings",
    description: "AI-specific directories and aggregators",
  },
  "social-x-and-linkedin": {
    file: "channels.md",
    heading: "Social",
    description: "X and LinkedIn posts targeting builders and early adopters",
  },
  "seo-how-to-and-templates": {
    file: "content-engine.md",
    heading: "Content types — Middle funnel",
    description: "How-to guides, templates, and use-case SEO content",
  },
  "integrations-and-mcp-listings": {
    file: "channels.md",
    heading: "Growth loops — Integrations",
    description: "MCP catalogue and integration marketplace listings",
  },

  // ---- content-media ----
  "seo-informational": {
    file: "content-engine.md",
    heading: "Content types — Top funnel",
    description: "Informational SEO — explainers, guides, glossaries",
  },
  "newsletter-swaps-and-mentions": {
    file: "channels.md",
    heading: "Email",
    description: "Newsletter swaps, cross-promotions, and earned mentions",
  },
  "social": {
    file: "channels.md",
    heading: "Social",
    description: "Social distribution and community engagement",
  },
  "search-and-discover-feeds": {
    file: "channels.md",
    heading: "Launch",
    description: "Search and discover feed distribution (RSS, Substack discovery, etc.)",
  },

  // ---- ecommerce ----
  "seo-product-and-category": {
    file: "content-engine.md",
    heading: "Content types — Bottom funnel",
    description: "Product and category SEO pages",
  },
  "email-lifecycle": {
    file: "channels.md",
    heading: "Email",
    description: "Lifecycle email — welcome, cart, post-purchase, retention",
  },
  "social-and-short-video": {
    file: "channels.md",
    heading: "Social",
    description: "Social and short-video commerce content",
  },
  "marketplaces": {
    file: "channels.md",
    heading: "Growth loops — Integrations",
    description: "Marketplace listings (Amazon, Etsy, regional marketplaces)",
  },
  "creators-and-affiliates": {
    file: "channels.md",
    heading: "Growth loops",
    description: "Creator and affiliate programme",
  },
  "paid-after-proof": {
    file: "channels.md",
    heading: "Paid",
    description: "Paid acquisition enabled only after organic conversion is proven",
  },

  // ---- local-service ----
  "local-seo-and-maps-profile": {
    file: "channels.md",
    heading: "Support loop / Local SEO",
    description: "Local SEO and maps business profile optimisation",
  },
  "reviews": {
    file: "channels.md",
    heading: "Reviews and proof",
    description: "Review generation and reputation management",
  },
  "social-and-visual": {
    file: "channels.md",
    heading: "Social",
    description: "Social and visual storytelling (photos, video tours)",
  },
  "partnerships-and-referrals": {
    file: "channels.md",
    heading: "Growth loops — Integrations",
    description: "Local partnerships and referral network",
  },
  "email-and-chat": {
    file: "channels.md",
    heading: "Email",
    description: "Email and chat follow-ups with local customers",
  },
  "directories-and-travel-sites": {
    file: "channels.md",
    heading: "Directories and listings",
    description: "Local, travel, and niche directory listings",
  },

  // ---- digital-product ----
  "seo-templates-and-how-to": {
    file: "content-engine.md",
    heading: "Content types — Middle funnel",
    description: "Template and how-to SEO content for digital products",
  },
  "marketplaces-and-directories": {
    file: "channels.md",
    heading: "Directories and listings",
    description: "Digital-product marketplace and directory listings (Gumroad, etc.)",
  },
  "email-and-lead-magnet": {
    file: "channels.md",
    heading: "Email",
    description: "Lead-magnet funnel and nurture email sequences",
  },

  // ---- free-utility ----
  "seo-tool-pages": {
    file: "content-engine.md",
    heading: "Content types — Bottom funnel",
    description: "Tool pages optimised for high-intent search queries",
  },
  "embeds-and-backlinks": {
    file: "channels.md",
    heading: "Growth loops",
    description: "Embed widgets and backlink earning from tool distribution",
  },
  "email-capture": {
    file: "channels.md",
    heading: "Email",
    description: "Lightweight email capture from tool traffic",
  },
} as const;

// ---------------------------------------------------------------------------
// Validation helpers for validate-pack
// ---------------------------------------------------------------------------

export interface ChannelMapValidationIssue {
  archetypeId: string;
  channelId: string;
  message: string;
}

/**
 * Validate that every channel referenced by an archetype exists in CHANNEL_MAP.
 * Hard-fail (throw) when `strict` is true — this is the CI path.
 * When `strict` is false, return issues as warnings.
 */
export function validateChannelMap(
  archetypeChannels: ReadonlyArray<{ archetypeId: string; channels: string[] }>,
  channelMap: Readonly<Record<string, ChannelMapEntry>> = CHANNEL_MAP,
): ChannelMapValidationIssue[] {
  const issues: ChannelMapValidationIssue[] = [];
  for (const { archetypeId, channels } of archetypeChannels) {
    for (const channelId of channels) {
      if (!(channelId in channelMap)) {
        issues.push({
          archetypeId,
          channelId,
          message: `Archetype "${archetypeId}" references channel "${channelId}" missing from CHANNEL_MAP`,
        });
      }
    }
  }
  return issues;
}

/**
 * Assert the channel map is valid — throws ValidationError-style on failure.
 * validate-pack calls this with strict=true in CI.
 */
export function assertChannelMapValid(
  archetypeChannels: ReadonlyArray<{ archetypeId: string; channels: string[] }>,
  channelMap: Readonly<Record<string, ChannelMapEntry>> = CHANNEL_MAP,
  strict = true,
): void {
  const issues = validateChannelMap(archetypeChannels, channelMap);
  if (issues.length === 0) return;
  const msg = issues.map((i) => i.message).join("\n");
  if (strict) {
    throw new Error(`Channel map validation failed:\n${msg}`);
  }
}

/** Return true if a channel id exists in the map. */
export function hasChannel(channelId: string): boolean {
  return channelId in CHANNEL_MAP;
}

/** All channel ids in the map. */
export function allChannelIds(): string[] {
  return Object.keys(CHANNEL_MAP);
}
