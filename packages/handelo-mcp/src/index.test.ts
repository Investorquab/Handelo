import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

test("MCP exposes only read-only market tools", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /name:"handelo_market_lookup"/);
  assert.match(source, /name:"handelo_market_search"/);
  assert.doesNotMatch(source, /market-order/);
  assert.doesNotMatch(source, /execute|swap/);
});

test("MCP source strictly validates ticker arguments", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /function readTicker\(args: unknown\)/);
  assert.match(source, /typeof ticker !== "string"/);
  assert.match(source, /ticker is too long/);
});


test("MCP validates JSON-RPC envelopes before handling", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /function validateJsonRpc\(value: unknown\)/);
  assert.match(source, /message\.jsonrpc !== "2\.0"/);
  assert.match(source, /message\.method !== "string"/);
  assert.match(source, /Invalid JSON-RPC params/);
});


test("MCP classifies invalid tool arguments as invalid params", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /class InvalidToolArgumentsError extends Error/);
  assert.match(source, /error\(message\.id,-32602,e\.message\)/);
});
