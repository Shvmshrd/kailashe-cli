/**
 * Setup checklist text (tool-hubs.md §3 format: numbered steps for owner).
 *
 * Mirrors the example in prompt.template.md §5:
 *   1. Connect in Muse Settings, Connectors: Gmail, Google Docs and Sheets, GitHub, Canva.
 *   2. Connect Zapier. In Zapier's MCP settings approve: <apps and actions>.
 *   3. Add a custom connector for Composio (https://connect.composio.dev/mcp) with my API key.
 *   4. Add DataForSEO through the credential prompt, for Trends and keywords.
 *   5. Tell me how you get Search Console data: connector, or I export a CSV.
 */

import type { Manifest } from "./manifest.js";
import type { ConnectorsRegistry } from "./manifest.js";
import { DEFAULT_REGISTRY } from "./manifest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function friendlyToolName(tool: string): string {
  const MAP: Record<string, string> = {
    notion: "Notion",
    "google-docs-and-sheets": "Google Docs and Sheets",
    "google-sheets": "Google Sheets",
    gmail: "Gmail",
    outlook: "Outlook",
    slack: "Slack",
    github: "GitHub",
    vercel: "Vercel",
    railway: "Railway",
    klaviyo: "Klaviyo",
    canva: "Canva",
    figma: "Figma",
    stripe: "Stripe",
    quickbooks: "QuickBooks",
    "google-calendar": "Google Calendar",
    calendly: "Calendly",
    highlevel: "GoHighLevel",
    linear: "Linear",
    asana: "Asana",
    todoist: "Todoist",
    "meta-accounts": "Meta accounts (Facebook, Instagram, Threads)",
    "meta-business-manager": "Meta Business Manager",
    "web-search-and-browser": "Web search and browser",
    "browser-and-lighthouse-via-site": "Browser site audit (Lighthouse)",
    "scheduled-task-http-check": "Scheduled HTTP check (uptime)",
  };
  return MAP[tool] ?? tool;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildChecklistInput {
  manifest: Manifest;
  registry?: ConnectorsRegistry;
}

/**
 * Generate the setup checklist as numbered steps for the owner.
 * Format follows tool-hubs.md §3 setup recipes.
 */
export function buildChecklist(input: BuildChecklistInput): string {
  const manifest = input.manifest;
  const registry = input.registry ?? DEFAULT_REGISTRY;

  if (manifest.capabilities.length === 0) {
    return "1. No additional connectors needed — the plan runs on research and local tasks only.";
  }

  const steps: string[] = [];

  // Group capabilities by route type
  const museTools: string[] = [];
  const zapierTools: string[] = [];
  const composioTools: string[] = [];
  const customTools: string[] = [];
  const browserTools: string[] = [];
  const manualTools: string[] = [];
  const hubTools: string[] = []; // activepieces / n8n / flow

  for (const cap of manifest.capabilities) {
    const capDef = registry.capabilities[cap.id];
    if (!capDef) continue;
    const via = capDef.routes[0]?.via ?? "muse";
    switch (via) {
      case "muse":
        museTools.push(capDef.routes[0]!.tool);
        break;
      case "zapier":
        zapierTools.push(capDef.routes[0]!.tool);
        break;
      case "composio":
      case "composio-or-custom":
        composioTools.push(capDef.routes[0]!.tool);
        break;
      case "custom":
        customTools.push(capDef.routes[0]!.tool);
        break;
      case "browser":
        browserTools.push(capDef.routes[0]!.tool);
        break;
      case "manual":
        manualTools.push(capDef.routes[0]!.tool);
        break;
      case "activepieces":
      case "activepieces-or-n8n":
      case "n8n":
      case "flow":
        hubTools.push(capDef.routes[0]!.tool);
        break;
      default:
        // composio-or-custom already handled; fallback to custom
        if (via.includes("composio")) composioTools.push(capDef.routes[0]!.tool);
        else customTools.push(capDef.routes[0]!.tool);
        break;
    }
  }

  // Dedupe
  function dedupe(arr: string[]): string[] {
    return [...new Set(arr)].sort();
  }

  // Step 1: Muse built-in connectors
  const dedupedMuse = dedupe(museTools);
  if (dedupedMuse.length > 0) {
    steps.push(
      `Connect in Muse Settings, Connectors: ${dedupedMuse.map(friendlyToolName).join(", ")}.`,
    );
  }

  // Step 2: Zapier
  const dedupedZapier = dedupe(zapierTools);
  if (dedupedZapier.length > 0) {
    steps.push(
      `Connect Zapier in Muse Settings, Connectors. In Zapier's MCP settings, approve only these apps and actions: ${dedupedZapier.join(", ")}. I will test with a read call after you confirm.`,
    );
  }

  // Step 3: Composio
  const dedupedComposio = dedupe(composioTools);
  if (dedupedComposio.length > 0) {
    steps.push(
      `Add a custom connector for Composio (https://connect.composio.dev/mcp) with your API key. Once connected, I will search for: ${dedupedComposio.join(", ")} — then connect and test each. Stay inside the manifest's apps.`,
    );
  }

  // Step 4: Activepieces / n8n / flow hubs
  const dedupedHub = dedupe(hubTools);
  if (dedupedHub.length > 0) {
    steps.push(
      `Set up your automation hub (Activepieces or n8n) if you have one. I will use it for: ${dedupedHub.join(", ")}. If you do not have a hub, I will fall back to direct connectors or manual steps.`,
    );
  }

  // Step 5: Custom connectors (DataForSEO, etc.)
  const dedupedCustom = dedupe(customTools);
  if (dedupedCustom.length > 0) {
    steps.push(
      `Add custom connectors through the credential prompt for: ${dedupedCustom.join(", ")}. Enter your API keys when Muse asks. I will test each with a read call.`,
    );
  }

  // Step 6: Browser tasks
  const dedupedBrowser = dedupe(browserTools);
  if (dedupedBrowser.length > 0) {
    steps.push(
      `Browser tasks — I will use the Muse Secure VM browser for: ${dedupedBrowser.join(", ")}. For community posts, you will post from your account; I will prepare the exact text.`,
    );
  }

  // Step 7: Manual tasks
  const dedupedManual = dedupe(manualTools);
  if (dedupedManual.length > 0) {
    steps.push(
      `Manual steps — you will handle these directly: ${dedupedManual.join(", ")}. I will prepare everything (drafts, links, tracker rows) for your approval.`,
    );
  }

  // Step: Search Console data source
  const hasSearchConsole = manifest.capabilities.some((c) => c.id === "seo.search_console");
  if (hasSearchConsole) {
    const scCap = registry.capabilities["seo.search_console"];
    const scVia = scCap?.routes[0]?.via ?? "";
    if (scVia === "composio" || scVia === "hub") {
      steps.push(
        `Search Console: I will read queries, clicks, and indexing via your connected hub. Confirm the toolkit exists on your plan, or tell me you will export a CSV into the sheet.`,
      );
    } else if (scVia === "custom" || scVia === "manual") {
      steps.push(
        `Search Console: tell me how you get the data — connector (OAuth/custom), or export a CSV into the tracker sheet. I will work with either.`,
      );
    }
  }

  // Step: cost caps
  if (manifest.budget.monthly_cap_usd > 0) {
    steps.push(
      `Budget: monthly cap $${manifest.budget.monthly_cap_usd.toFixed(2)}, per-action cap $${manifest.budget.per_action_cap_usd.toFixed(2)}. At 80% I warn you; at 100% I stop paid calls (exit 7).`,
    );
  }

  // Number the steps
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}
