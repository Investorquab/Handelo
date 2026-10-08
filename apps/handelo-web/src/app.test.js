import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const indexSource = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const suppliedSource = readFileSync(fileURLToPath(new URL("../handelo-supplied-ui.html", import.meta.url)), "utf8");
const adapter = readFileSync(fileURLToPath(new URL("./handelo-adapter.js", import.meta.url)), "utf8");

test("supplied UI is preserved byte-for-byte as the adapter source of truth", () => {
  const withoutAdapter = indexSource.replace(/\n<script src="\.\/src\/handelo-adapter\.js"><\/script>\n/, "\n");
  assert.equal(withoutAdapter, suppliedSource);
});

test("index loads only the integration adapter in addition to the supplied UI", () => {
  assert.match(indexSource, /<script src="\.\/src\/handelo-adapter\.js"><\/script>/);
  assert.equal((indexSource.match(/<script src=/g) || []).length, 1);
});

test("adapter is valid JavaScript and does not replace the supplied UI", () => {
  assert.match(adapter, /\(function\(\)\{'use strict';/);
  assert.doesNotMatch(adapter, /innerHTML\s*=\s*['"]<!DOCTYPE html/);
});

test("adapter reads live market and wallet state from backend APIs", () => {
  assert.match(adapter, /get\('\/api\/markets'\)/);
  assert.match(adapter, /get\('\/api\/wallet\/status'\)/);
});

test("adapter loads wallet-scoped backend data only when a wallet address exists", () => {
  assert.match(adapter, /if\(!addr\)return Promise\.resolve\(\)/);
  for (const path of ["/api/portfolio", "/api/strategies", "/api/strategies/attribution", "/api/strategies/executions", "/api/history"]) {
    assert.match(adapter, new RegExp(path.replaceAll("/", "\\/")));
  }
});

test("adapter uses backend market values rather than invented chart prices", () => {
  assert.match(adapter, /referencePrice/);
  assert.match(adapter, /tokenPrice/);
  assert.match(adapter, /homeReferencePrice/);
  assert.match(adapter, /homeTokenPrice/);
  assert.doesNotMatch(adapter, /Math\.random/);
});

test("adapter does not generate fabricated transaction hashes or browser execution receipts", () => {
  assert.doesNotMatch(adapter, /Math\.random/);
  assert.doesNotMatch(adapter, /0x[0-9a-f]+\.\.\./i);
  assert.doesNotMatch(adapter, /txHash\s*:/);
});

test("adapter routes order review through the server-authoritative review endpoint", () => {
  assert.match(adapter, /post\('\/api\/review'/);
  assert.match(adapter, /action:'buy'/);
  assert.match(adapter, /fromToken:'USDT'/);
  assert.match(adapter, /wallet:addr/);
});

test("adapter does not claim execution success without a backend execution result", () => {
  assert.match(adapter, /Explicit execution remains required/);
  assert.doesNotMatch(adapter, /Order completed/);
  assert.doesNotMatch(adapter, /Filled on BNB Chain/);
});

test("adapter sends chat requests to the real backend", () => {
  assert.match(adapter, /post\('\/api\/chat'/);
  assert.match(adapter, /message:q/);
});

test("adapter stops the supplied browser-side simulated strategy loop", () => {
  assert.match(adapter, /window\.S/);
  assert.match(adapter, /window\.S\)window\.S\.run=false/);
});

test("adapter renders backend strategy state into the existing supplied strategy surface", () => {
  assert.match(adapter, /state\.strategies/);
  assert.match(adapter, /nextExecutionAt/);
  assert.match(adapter, /id="sl"/);
});

test("adapter strategy controls call backend pause/cancel endpoints", () => {
  assert.match(adapter, /\/api\/strategies\/pause/);
  assert.match(adapter, /\/api\/strategies\/cancel/);
});

test("adapter never executes strategies in the browser", () => {
  assert.doesNotMatch(adapter, /setInterval/);
  assert.doesNotMatch(adapter, /setTimeout/);
});

test("adapter does not invent portfolio cost basis", () => {
  assert.match(adapter, /totalValueUsd/);
  assert.match(adapter, /allocationPercent/);
  assert.doesNotMatch(adapter, /avgCost|averageCost|costBasis/);
});

test("supplied UI contains the original landing and workspace surfaces", () => {
  for (const needle of ["Handelo", "NVDAB", "Connect wallet", "Ask Handelo", "Strategies", "Portfolio"]) {
    assert.match(indexSource, new RegExp(needle));
  }
});

test("backend adapter is isolated to the web adapter file", () => {
  assert.match(indexSource, /handelo-adapter\.js/);
  assert.doesNotMatch(indexSource, /api\/review/);
  assert.doesNotMatch(indexSource, /api\/execute/);
  assert.doesNotMatch(indexSource, /api\/chat/);
});

test("no fabricated historical series is introduced by the integration", () => {
  assert.doesNotMatch(adapter, /for\s*\([^)]{0,100}history|Array\([^)]*\)\.fill/);
  assert.doesNotMatch(adapter, /spark|candlestick|chartData|seriesData/);
});

test("adapter bootstrap remains fail-soft when backend data is unavailable", () => {
  assert.match(adapter, /\.catch\(function\(e\)/);
  assert.match(adapter, /console\.warn\('Handelo backend bootstrap:/);
});

test("adapter escapes backend chat text before inserting it into the supplied DOM", () => {
  assert.match(adapter, /replace\(\/[&<>\]/);
  assert.match(adapter, /textContent=q/);
});
