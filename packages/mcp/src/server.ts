/**
 * MCP server wiring (S12) — registers the Kailashe tools on an McpServer.
 * Kept separate from stdio startup so tests can connect an in-memory
 * transport pair without touching stdio, the network, or real providers.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createHandlers,
  StubBackend,
  type KailasheBackend,
  type ToolResult,
} from "./handlers.js";

function toCallToolResult<T>(result: ToolResult<T>): CallToolResult {
  const isNeedsConfirmation = result.status === "needs_confirmation";
  const payload = isNeedsConfirmation
    ? { status: result.status, plan: result.plan }
    : { status: result.status, data: result.data };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    ...(isNeedsConfirmation ? { isError: true } : {}),
  };
}

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: JSON.stringify({ status: "error", error: message }) }],
    isError: true,
  };
}

export function createKailasheServer(backend: KailasheBackend = new StubBackend()): McpServer {
  const handlers = createHandlers(backend);
  const server = new McpServer({ name: "kailashe", version: "0.1.0" });

  server.registerTool(
    "detect_project",
    {
      description: "Read: detect the project type and hints for a local project path. No side effects.",
      inputSchema: { path: z.string().trim().min(1) },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return toCallToolResult(await handlers.detectProject(args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "list_providers",
    {
      description: "Read: list known deploy providers. No side effects.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return toCallToolResult(await handlers.listProviders(args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "status",
    {
      description: "Read: report status for a project (default path '.'). No side effects.",
      inputSchema: { path: z.string().trim().min(1).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return toCallToolResult(await handlers.status(args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "deploy",
    {
      description:
        "Write: deploy a project. Without confirm=true it only returns a plan and takes no action.",
      inputSchema: {
        path: z.string().trim().min(1),
        provider: z.string().trim().min(1).optional(),
        confirm: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      try {
        return toCallToolResult(await handlers.deploy(args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "scan_business",
    {
      description:
        "Write: scan a project/business and write scan outputs. Without confirm=true it only returns a plan.",
      inputSchema: {
        path: z.string().trim().min(1),
        confirm: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      try {
        return toCallToolResult(await handlers.scanBusiness(args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "build_prompt",
    {
      description:
        "Write: build prompt.md for a project. Without confirm=true it only returns a plan and writes nothing.",
      inputSchema: {
        path: z.string().trim().min(1),
        confirm: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      try {
        return toCallToolResult(await handlers.buildPrompt(args));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  return server;
}
