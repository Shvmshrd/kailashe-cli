/**
 * Plan package — orchestrator.
 *
 * Takes profile + brief + market + archetype override →
 * { archetype, plan, backlog, manifest, checklist }
 */

import type { LLMClient } from "@kailashe/core/llm/client.js";
import type { ArchetypeId, ArchetypeDefinition } from "./archetype.js";
import { getArchetype, selectArchetype } from "./archetype.js";
import { rankChannels, toMarketJsonChannels } from "./ranking.js";
import type { MarketEvidenceForRanking, RankedChannel, RankingResult } from "./ranking.js";
import { generateBacklog } from "./backlog.js";
import type { Task } from "./backlog.js";
import { buildManifest } from "./manifest.js";
import type { Manifest, ConnectorsRegistry } from "./manifest.js";
import { buildChecklist } from "./checklist.js";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { CHANNEL_MAP, validateChannelMap, assertChannelMapValid, hasChannel, allChannelIds } from "./channel-map.js";
export type { ChannelMapEntry, ChannelMapValidationIssue } from "./channel-map.js";
export { ARCHETYPES, getArchetype, allArchetypeIds, selectArchetype, resolveArchetypeSync } from "./archetype.js";
export type { ArchetypeDefinition, ArchetypeId, ProfileHints, MarketEvidence, SelectArchetypeInput, SelectArchetypeResult } from "./archetype.js";
export { rankChannels, toMarketJsonChannels } from "./ranking.js";
export type { MarketEvidenceForRanking, TrendEvidence, CommunityEvidence, RankedChannel, RankingResult } from "./ranking.js";
export { generateBacklog, sortByPriority, priorityScore } from "./backlog.js";
export type { Task, TaskApproval, TaskStatus, GenerateBacklogInput } from "./backlog.js";
export { buildManifest, validateManifest, assertManifestValid, DEFAULT_REGISTRY, allCapabilityIds } from "./manifest.js";
export type { Manifest, ManifestBudget, ManifestCapability, ConnectorsRegistry, ConnectorCapability, BuildManifestInput } from "./manifest.js";
export { buildChecklist } from "./checklist.js";
export type { BuildChecklistInput } from "./checklist.js";
export { HQ_TEMPLATES, renderHqCsv, writeHqTemplates, HqTemplateNameSchema } from "./hq.js";
export type { HqTemplate, HqTemplateName } from "./hq.js";
export {
  vetDirectories,
  importDirectories,
  renderDirectoriesSeedCsv,
  buildListingKit,
  DIRECTORY_SEED_COLUMNS,
  DirectoryRowSchema,
  DirectoryPricingSchema,
  ListingKitBriefSchema,
} from "./directories.js";
export type {
  DirectoryRow,
  DirectoryPricing,
  VettedDirectory,
  ListingKitBrief,
  ListingKit,
  ListingKitAssetCheck,
} from "./directories.js";

// ---------------------------------------------------------------------------
// Orchestrator types
// ---------------------------------------------------------------------------

export interface ProfileInput {
  /** App type label from the detector. */
  appType?: string;
  /** Keywords/feature labels. */
  keywords?: string[];
  /** Feature flags. */
  hasFeature?: Record<string, boolean>;
}

export interface BriefInput {
  what?: string;
  audience?: string;
  problem?: string;
  features?: string[];
  pricing?: string;
  links?: string[];
}

export interface MarketInput {
  trends?: Array<{ term: string; shape?: string; region?: string; confidence?: string }>;
  clusters?: Array<{ name: string; primary_keyword?: string; intent?: string; volume?: number; difficulty?: number; score?: number; gap?: string }>;
  competitors?: Array<{ name: string; url?: string; positioning?: string; pricing?: string }>;
  communities?: Array<{ name: string; url?: string; rules?: string; fit: number }>;
  channels_ranked?: Array<{ channel: string; why: string; kpi: string; stop_if: string }>;
  unknowns?: string[];
}

export interface OrchestratorInput {
  profile: ProfileInput;
  brief?: BriefInput;
  market?: MarketInput;
  archetypeOverride?: string;
  llmClient?: LLMClient;
  projectSlug?: string;
  registry?: ConnectorsRegistry;
  monthlyCapUsd?: number;
  perActionCapUsd?: number;
}

// Plan shape (SPEC §6.7)
export interface Plan {
  archetype: ArchetypeId;
  archetypeName: string;
  reason: string;
  audience: string;
  goal90d: string;
  kpis: string[];
  channelsRanked: RankedChannel[];
  channelsRankedJson: Array<{ channel: string; why: string; kpi: string; stop_if: string }>;
  later: Array<{ channel: string; trigger: string }>;
  flows: string[];
  contentMix: { bottom: number; middle: number; top: number; proof: number };
  cautions: string[];
}

export interface OrchestratorResult {
  archetype: { id: ArchetypeId; reason: string };
  plan: Plan;
  backlog: Task[];
  manifest: Manifest;
  checklist: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function goal90dForArchetype(archetype: ArchetypeDefinition): string {
  const MAP: Record<string, string> = {
    "dev-tool": "Ship quality docs and earn first 100 stars / 200 installs with 5 indexed comparison pages and 5 live directory listings.",
    "b2b-saas": "Launch 3 alternatives pages, 2 comparison pages, and 2 review-site profiles — generate first 10 demo requests with tracking live.",
    "b2c-app": "Publish store listing + 3 content pillars, ship 20 social posts, reach 500 signups with day-7 retention tracked.",
    "ai-tool": "List on 10 AI directories, publish 3 use-case pages with real demos, ship demo video, and reach 300 signups.",
    "content-media": "Publish 3 pillar pages, build 12-week calendar, launch lead magnet, and reach 500 subscribers via SEO + swaps.",
    "ecommerce": "Optimise 5 product pages, launch 3 category pages, wire welcome + cart sequences, and reach first 50 orders.",
    "local-service": "Complete maps profile, publish 3 location pages, collect 10 reviews, and drive 30 bookings via local SEO.",
    "digital-product": "Launch 3 preview-rich product pages, list on 3 marketplaces, ship free sample, and reach 50 sales.",
    "free-utility": "Optimise tool page to 90+ Lighthouse, publish 3 explainer pages, add embed/share feature, and reach 5,000 organic visits.",
  };
  return MAP[archetype.id] ?? `Execute first-30-day plan for ${archetype.name} and validate channel traction with KPIs.`;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Build the full operating plan from profile + brief + market + override.
 *
 * This is the S9 entry point used by S10 (composer) and S11 (gate UX).
 */
export async function plan(input: OrchestratorInput): Promise<OrchestratorResult> {
  const profileHints = {
    appType: input.profile.appType,
    keywords: input.profile.keywords,
    hasFeature: input.profile.hasFeature,
  };

  const marketEvidenceForArchetype = {
    trends: input.market?.trends,
    competitorAudiences: input.market?.competitors?.map((c) => c.positioning ?? c.name) ?? [],
    communityHints: input.market?.communities?.map((c) => c.name) ?? [],
  };

  const marketEvidenceForRanking: MarketEvidenceForRanking = {
    trends: input.market?.trends?.map((t) => ({
      term: t.term,
      shape: t.shape,
      region: t.region,
      confidence: t.confidence,
    })),
    communities: input.market?.communities,
  };

  // 1. Archetype selection
  const archetypeResult = await selectArchetype(
    profileHints,
    marketEvidenceForArchetype,
    input.llmClient,
    input.archetypeOverride,
  );

  const archetype = getArchetype(archetypeResult.id);
  if (!archetype) throw new Error(`Selected archetype "${archetypeResult.id}" not found`);

  // 2. Channel ranking (archetype default adjusted by market evidence)
  const ranking: RankingResult = rankChannels(archetype.id, marketEvidenceForRanking);

  // 3. Backlog — pass ranked channels so every plan channel gets a task
  const backlog = generateBacklog({
    archetypeId: archetype.id,
    rankedChannels: ranking.ranked,
  });

  // 4. Manifest — capabilities driven by channels + flows
  const manifest: Manifest = buildManifest({
    project: input.projectSlug ?? "my-project",
    archetypeId: archetype.id,
    rankedChannels: ranking.ranked,
    registry: input.registry,
    monthlyCapUsd: input.monthlyCapUsd,
    perActionCapUsd: input.perActionCapUsd,
  });

  // 5. Checklist — numbered steps per tool-hubs §3
  const checklist = buildChecklist({ manifest, registry: input.registry });

  // 6. Assemble Plan object (SPEC §6.7)
  const planObj: Plan = {
    archetype: archetype.id as ArchetypeId,
    archetypeName: archetype.name,
    reason: archetypeResult.reason,
    audience: archetype.audience,
    goal90d: goal90dForArchetype(archetype),
    kpis: [...archetype.kpis],
    channelsRanked: ranking.ranked,
    channelsRankedJson: toMarketJsonChannels(ranking.ranked),
    later: ranking.later,
    flows: [...archetype.flows],
    contentMix: { ...archetype.content_mix },
    cautions: [...archetype.cautions],
  };

  return {
    archetype: archetypeResult,
    plan: planObj,
    backlog,
    manifest,
    checklist,
  };
}

/**
 * Synchronous variant that skips LLM tiebreak — safe for snapshot tests.
 * Use `plan()` for the full async path.
 */
export function planSync(input: Omit<OrchestratorInput, "llmClient">): {
  archetype: { id: ArchetypeId; reason: string };
  plan: Plan;
  backlog: Task[];
  manifest: Manifest;
  checklist: string;
} {
  const archetypeId = input.archetypeOverride as ArchetypeId | undefined;
  if (!archetypeId || !getArchetype(archetypeId)) {
    throw new Error(
      `planSync requires a valid archetypeOverride — got "${input.archetypeOverride ?? ""}"`,
    );
  }

  const archetype = getArchetype(archetypeId)!;

  const marketEvidenceForRanking: MarketEvidenceForRanking = {
    trends: input.market?.trends?.map((t) => ({
      term: t.term,
      shape: t.shape,
      region: t.region,
      confidence: t.confidence,
    })),
    communities: input.market?.communities,
  };

  const ranking = rankChannels(archetype.id, marketEvidenceForRanking);

  const backlog = generateBacklog({
    archetypeId: archetype.id,
    rankedChannels: ranking.ranked,
  });

  const manifest = buildManifest({
    project: input.projectSlug ?? "my-project",
    archetypeId: archetype.id,
    rankedChannels: ranking.ranked,
    registry: input.registry,
    monthlyCapUsd: input.monthlyCapUsd,
    perActionCapUsd: input.perActionCapUsd,
  });

  const checklist = buildChecklist({ manifest, registry: input.registry });

  return {
    archetype: { id: archetype.id as ArchetypeId, reason: `User override: "${archetype.id}"` },
    plan: {
      archetype: archetype.id as ArchetypeId,
      archetypeName: archetype.name,
      reason: `User override: "${archetype.id}"`,
      audience: archetype.audience,
      goal90d: goal90dForArchetype(archetype),
      kpis: [...archetype.kpis],
      channelsRanked: ranking.ranked,
      channelsRankedJson: toMarketJsonChannels(ranking.ranked),
      later: ranking.later,
      flows: [...archetype.flows],
      contentMix: { ...archetype.content_mix },
      cautions: [...archetype.cautions],
    },
    backlog,
    manifest,
    checklist,
  };
}
