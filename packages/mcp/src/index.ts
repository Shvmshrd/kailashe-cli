#!/usr/bin/env node
/**
 * Kailashe stdio MCP server (S12).
 *
 * Run as a subprocess by an MCP client:
 *   node packages/mcp/dist/index.js
 *
 * Tools: detect_project, list_providers, status (read, no confirmation)
 * and deploy, scan_business, build_prompt (write — require confirm=true).
 *
 * The default backend is StubBackend (structured stub data, no side
 * effects). Hosts with real scan/deploy/compose backends should import
 * `createKailasheServer` and inject them instead of using this entrypoint.
 */

import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKailasheServer } from "./server.js";
import { StubBackend } from "./handlers.js";

export { createKailasheServer } from "./server.js";
export {
  createHandlers,
  StubBackend,
  NeedsConfirmationError,
  DetectProjectArgsSchema,
  ListProvidersArgsSchema,
  StatusArgsSchema,
  DeployArgsSchema,
  ScanBusinessArgsSchema,
  BuildPromptArgsSchema,
} from "./handlers.js";
export type {
  KailasheBackend,
  ProviderInfo,
  DetectProjectResult,
  StatusResult,
  WriteResult,
  ToolResult,
  ToolStatus,
  Handlers,
  DetectProjectArgs,
  StatusArgs,
  DeployArgs,
  ScanBusinessArgs,
  BuildPromptArgs,
} from "./handlers.js";

export async function main(): Promise<void> {
  const server = createKailasheServer(new StubBackend());
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const entry = process.argv[1];
const isMain = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (isMain) {
  main().catch((err: unknown) => {
    console.error("kailashe-mcp: fatal", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
