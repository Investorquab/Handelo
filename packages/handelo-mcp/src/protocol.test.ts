import test from "node:test";
import assert from "node:assert/strict";
import { MarketResolutionError } from "@handelo/market";
import { createMcpProtocolHandler, type McpMarketClient } from "./protocol.js";

const sampleAsset = {
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

function marketFixture(overrides: Partial<McpMarketClient> = {}): McpMarketClient {
  return {
    find: async () => sampleAsset as never,
    search: async () => [{ ticker: "NVDA", companyName: "NVIDIA", assets: [{ tokenSymbol: "NVDAB", binanceChainId: "56" }] }] as never,
    ...overrides,
  };
}

test("MCP initialize negotiates a supported protocol version", async () => {
  const handle = createMcpProtocolHandler(marketFixture());
  const outcome = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });

  assert.equal(outcome.status, 200);
  assert.equal(outcome.protocolVersion, "2025-06-18");
  assert.equal((outcome.body?.result as { capabilities: { tools: object } }).capabilities.tools !== undefined, true);
});

test("MCP lists the two explicitly read-only market tools", async () => {
  const handle = createMcpProtocolHandler(marketFixture());
  const outcome = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (outcome.body?.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> }).tools;

  assert.deepEqual(tools.map((tool) => tool.name), ["handelo_market_lookup", "handelo_market_search"]);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint));
});

test("MCP market lookup returns selected market fields", async () => {
  const handle = createMcpProtocolHandler(marketFixture());
  const outcome = await handle({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "handelo_market_lookup", arguments: { ticker: "NVDAB" } },
  });
  const result = outcome.body?.result as { content: Array<{ text: string }> };
  const data = JSON.parse(result.content[0].text) as Record<string, unknown>;

  assert.equal(data.tokenSymbol, "NVDAB");
  assert.equal(data.tokenPrice, "232.59");
  assert.equal(data.referencePrice, "232.41");
  assert.equal(data.chainId, "56");
});

test("MCP market search returns candidate representations", async () => {
  const handle = createMcpProtocolHandler(marketFixture());
  const outcome = await handle({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "handelo_market_search", arguments: { ticker: "NVDA" } },
  });
  const result = outcome.body?.result as { content: Array<{ text: string }> };

  assert.match(result.content[0].text, /NVDAB/);
});

test("MCP rejects missing or invalid ticker arguments", async () => {
  const handle = createMcpProtocolHandler(marketFixture());
  const missing = await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "handelo_market_lookup", arguments: {} } });
  const invalid = await handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "handelo_market_lookup", arguments: { ticker: "X".repeat(21) } } });

  assert.equal((missing.body?.error as { code: number }).code, -32602);
  assert.equal((invalid.body?.error as { code: number }).code, -32602);
});

test("MCP hides provider errors but preserves useful market-resolution messages", async () => {
  const upstream = createMcpProtocolHandler(marketFixture({
    find: async () => { throw new Error("provider secret diagnostic"); },
  }));
  const failed = await upstream({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "handelo_market_lookup", arguments: { ticker: "NVDA" } } });
  const failedText = JSON.stringify(failed.body);

  assert.doesNotMatch(failedText, /provider secret diagnostic/);
  assert.match(failedText, /could not retrieve market data/i);

  const notFound = createMcpProtocolHandler(marketFixture({
    find: async () => { throw new MarketResolutionError("NOT_FOUND", "No BSC market found for TEST."); },
  }));
  const result = await notFound({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "handelo_market_lookup", arguments: { ticker: "TEST" } } });

  assert.match(JSON.stringify(result.body), /No BSC market found for TEST/);
});

test("MCP notifications receive no JSON-RPC response body", async () => {
  const handle = createMcpProtocolHandler(marketFixture());
  const outcome = await handle({ jsonrpc: "2.0", method: "notifications/initialized" });

  assert.equal(outcome.status, 202);
  assert.equal(outcome.body, undefined);
});
