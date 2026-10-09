import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createHandeloMcpHttpServer, isHandeloMcpHttpEntrypoint } from "./http.js";
import { fileURLToPath } from "node:url";
import type { McpMarketClient } from "./protocol.js";

const API_KEY = "test-secret-key-with-at-least-thirty-two-characters";
const asset = {
  underlyingTicker: "NVDA",
  underlyingName: "NVIDIA",
  tokenSymbol: "NVDAB",
  platformId: "bstock",
  binanceChainId: "56",
  tokenPrice: "232.59",
  referencePrice: "232.41",
  tokenContractAddress: "0x0f2fac66c1d1afb4e2a7884261eb00f63598a743",
  statusInfo: { openState: true, marketStatus: "OPEN" },
};

function fixture(): McpMarketClient {
  return {
    find: async () => asset as never,
    search: async () => [{ ticker: "NVDA", companyName: "NVIDIA", assets: [] }] as never,
  };
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createHandeloMcpHttpServer({ apiKey: API_KEY, allowedOrigins: ["https://claude.ai"], market: fixture() });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListen);
      reject(error);
    };
    const onListen = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", onListen);
  });
  try {
    const address = server.address() as AddressInfo;
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("HTTP MCP health endpoint is available without exposing tool data", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl + "/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "handelo-mcp-http" });
  });
});

test("HTTP MCP requires the shared connector key", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(response.status, 401);
  });
});

test("HTTP MCP authenticates requests and responds to initialize and tools/list", async () => {
  await withServer(async (baseUrl) => {
    const headers = { "content-type": "application/json", "x-handelo-mcp-key": API_KEY, origin: "https://claude.ai" };
    const initialize = await fetch(baseUrl + "/mcp", {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
    });
    assert.equal(initialize.status, 200);
    assert.equal(initialize.headers.get("mcp-protocol-version"), "2025-06-18");

    const list = await fetch(baseUrl + "/mcp", {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const payload = await list.json() as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(payload.result.tools.map((tool) => tool.name), ["handelo_market_lookup", "handelo_market_search"]);
  });
});

test("HTTP MCP blocks unapproved origins and non-POST calls", async () => {
  await withServer(async (baseUrl) => {
    const key = { "x-handelo-mcp-key": API_KEY, "content-type": "application/json" };
    const originResponse = await fetch(baseUrl + "/mcp", {
      method: "POST", headers: { ...key, origin: "https://untrusted.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(originResponse.status, 403);

    const getResponse = await fetch(baseUrl + "/mcp", { headers: key });
    assert.equal(getResponse.status, 405);
  });
});

test("HTTP MCP rejects weak/missing server keys before creating a server", () => {
  assert.throws(() => createHandeloMcpHttpServer({ apiKey: "short", market: fixture() }), /at least 32 characters/);
});


test("HTTP MCP entrypoint detection supports PM2's ESM process wrapper", () => {
  const moduleUrl = new URL("./http.ts", import.meta.url).href;
  const modulePath = fileURLToPath(new URL(moduleUrl));

  assert.equal(
    isHandeloMcpHttpEntrypoint(moduleUrl, "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js", modulePath),
    true,
  );
  assert.equal(isHandeloMcpHttpEntrypoint(moduleUrl, modulePath, undefined), true);
  assert.equal(isHandeloMcpHttpEntrypoint(moduleUrl, "/opt/other/http.ts", undefined), false);
});
