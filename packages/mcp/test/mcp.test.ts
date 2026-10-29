import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createHandlers,
  StubBackend,
  type KailasheBackend,
  type WriteResult,
} from "../src/handlers.js";
import { createKailasheServer } from "../src/server.js";

function writeResult(action: string, path: string): WriteResult {
  return { action, path, status: "done", stub: false, detail: "fake backend acted" };
}

function makeFakeBackend() {
  const backend: KailasheBackend = {
    detectProject: vi.fn(async ({ path }: { path: string }) => ({
      path,
      appType: "nextjs",
      hints: ["ssr"],
      stub: false,
    })),
    listProviders: vi.fn(async () => [{ id: "vercel", name: "Vercel" }]),
    status: vi.fn(async ({ path }: { path: string }) => ({
      path,
      state: "deployed",
      stub: false,
    })),
    deploy: vi.fn(async ({ path }: { path: string }) => writeResult("deploy", path)),
    scanBusiness: vi.fn(async ({ path }: { path: string }) =>
      writeResult("scan_business", path),
    ),
    buildPrompt: vi.fn(async ({ path }: { path: string }) =>
      writeResult("build_prompt", path),
    ),
  };
  return backend;
}

describe("read handlers (no confirmation, no writes)", () => {
  it("detect_project validates and delegates", async () => {
    const backend = makeFakeBackend();
    const handlers = createHandlers(backend);
    const result = await handlers.detectProject({ path: "/repo/app" });
    expect(result).toMatchObject({ status: "ok", readOnly: true });
    expect(result.data?.appType).toBe("nextjs");
    expect(backend.detectProject).toHaveBeenCalledWith({ path: "/repo/app" });
  });

  it("list_providers and status work without confirm", async () => {
    const backend = makeFakeBackend();
    const handlers = createHandlers(backend);
    expect((await handlers.listProviders({})).data).toEqual([
      { id: "vercel", name: "Vercel" },
    ]);
    expect((await handlers.status({})).data?.state).toBe("deployed");
    expect(backend.status).toHaveBeenCalledWith({ path: "." });
  });

  it("read handlers reject invalid input via Zod", async () => {
    const handlers = createHandlers(makeFakeBackend());
    await expect(handlers.detectProject({ path: "" })).rejects.toThrow();
    await expect(handlers.detectProject({})).rejects.toThrow();
    await expect(handlers.detectProject({ path: "/x", extra: 1 })).rejects.toThrow();
  });
});

describe("write handlers require explicit confirm=true", () => {
  it("deploy returns needs_confirmation and never calls the backend without confirm", async () => {
    const backend = makeFakeBackend();
    const handlers = createHandlers(backend);
    for (const args of [
      { path: "/repo/app" },
      { path: "/repo/app", confirm: false },
    ]) {
      const result = await handlers.deploy(args);
      expect(result.status).toBe("needs_confirmation");
      expect(result.readOnly).toBe(false);
      expect(result.plan).toContain("/repo/app");
      expect(result.data).toBeUndefined();
    }
    expect(backend.deploy).not.toHaveBeenCalled();
  });

  it("deploy acts only with confirm=true", async () => {
    const backend = makeFakeBackend();
    const handlers = createHandlers(backend);
    const result = await handlers.deploy({
      path: "/repo/app",
      provider: "vercel",
      confirm: true,
    });
    expect(result.status).toBe("ok");
    expect(backend.deploy).toHaveBeenCalledTimes(1);
    expect(backend.deploy).toHaveBeenCalledWith({ path: "/repo/app", provider: "vercel" });
  });

  it("scan_business and build_prompt are gated the same way", async () => {
    const backend = makeFakeBackend();
    const handlers = createHandlers(backend);

    expect((await handlers.scanBusiness({ path: "/r" })).status).toBe(
      "needs_confirmation",
    );
    expect((await handlers.buildPrompt({ path: "/r" })).status).toBe(
      "needs_confirmation",
    );
    expect(backend.scanBusiness).not.toHaveBeenCalled();
    expect(backend.buildPrompt).not.toHaveBeenCalled();

    expect((await handlers.scanBusiness({ path: "/r", confirm: true })).status).toBe("ok");
    expect((await handlers.buildPrompt({ path: "/r", confirm: true })).status).toBe("ok");
    expect(backend.scanBusiness).toHaveBeenCalledTimes(1);
    expect(backend.buildPrompt).toHaveBeenCalledTimes(1);
  });

  it("write handlers still validate input before the confirmation gate", async () => {
    const backend = makeFakeBackend();
    const handlers = createHandlers(backend);
    await expect(handlers.deploy({ path: "", confirm: true })).rejects.toThrow();
    await expect(handlers.deploy({ path: "/r", confirm: "yes" })).rejects.toThrow();
    expect(backend.deploy).not.toHaveBeenCalled();
  });
});

describe("StubBackend", () => {
  it("is clearly marked as stub in every write result", async () => {
    const handlers = createHandlers(new StubBackend());
    const result = await handlers.deploy({ path: "/r", confirm: true });
    expect(result.data?.stub).toBe(true);
    expect(result.data?.status).toBe("stubbed");
  });
});

describe("MCP server over in-memory transport (no network, no stdio)", () => {
  async function connect(backend: KailasheBackend) {
    const server = createKailasheServer(backend);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "kailashe-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }

  function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
    const first = result.content?.[0];
    return first && first.type === "text" ? first.text : "";
  }

  it("lists all six tools", async () => {
    const { client, server } = await connect(makeFakeBackend());
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "build_prompt",
      "deploy",
      "detect_project",
      "list_providers",
      "scan_business",
      "status",
    ]);
    await client.close();
    await server.close();
  });

  it("read tool answers without confirmation", async () => {
    const backend = makeFakeBackend();
    const { client, server } = await connect(backend);
    const result = await client.callTool({
      name: "detect_project",
      arguments: { path: "/repo/app" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("nextjs");
    await client.close();
    await server.close();
  });

  it("write tool does not act without confirm, then acts with confirm=true", async () => {
    const backend = makeFakeBackend();
    const { client, server } = await connect(backend);

    const unconfirmed = await client.callTool({
      name: "deploy",
      arguments: { path: "/repo/app" },
    });
    expect(unconfirmed.isError).toBe(true);
    expect(textOf(unconfirmed)).toContain("needs_confirmation");
    expect(backend.deploy).not.toHaveBeenCalled();

    const confirmed = await client.callTool({
      name: "deploy",
      arguments: { path: "/repo/app", confirm: true },
    });
    expect(confirmed.isError).toBeFalsy();
    expect(textOf(confirmed)).toContain("done");
    expect(backend.deploy).toHaveBeenCalledTimes(1);
    await client.close();
    await server.close();
  });
});
