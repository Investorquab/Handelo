import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const indexSource = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const appJs = readFileSync(fileURLToPath(new URL("./app.js", import.meta.url)), "utf8");
const serverSource = readFileSync(fileURLToPath(new URL("../../handelo-api/src/server.ts", import.meta.url)), "utf8");
const portfolioSource = readFileSync(fileURLToPath(new URL("../../handelo-api/src/portfolio.ts", import.meta.url)), "utf8");
const executionSource = readFileSync(fileURLToPath(new URL("../../../packages/handelo-execution/src/index.ts", import.meta.url)), "utf8");
const agentSource = readFileSync(fileURLToPath(new URL("../../../packages/handelo-agent/src/index.ts", import.meta.url)), "utf8");

test("web root has exactly one HTML entry point", () => {
  const htmlFiles = readdirSync(root).filter((name) => name.endsWith(".html"));
  assert.deepEqual(htmlFiles, ["index.html"]);
});

test("landing keeps the approved narrative and offers Open App and Open Demo", () => {
  assert.match(indexSource, /AI explains\.<br>The system governs\.<br>You decide\./);
  assert.match(indexSource, /See how it works/);
  assert.match(indexSource, /id="homeWorkspaceCta"[^>]*>Open Handelo<\/button>/);
  assert.match(indexSource, /id="homeDemoCta"[^>]*>Open Demo<\/button>/);
});

test("Open Demo embeds the exact supplied mock in the same index.html", () => {
  const match = indexSource.match(/const HANDELO_DEMO_HTML = (.*);\n/);
  assert.ok(match, "embedded demo source is present");
  const demo = JSON.parse(match[1]);
  assert.equal(createHash("sha256").update(demo, "utf8").digest("hex"), "2a9b55f581f676fc402a917effd4bab444314756d85f87aa5e43a412df01854d");
  assert.match(demo, /var S=\{d:1/);
  assert.match(demo, /Math\.random\(\)/);
});

test("real Handelo remains the same page and uses the production runtime", () => {
  assert.match(indexSource, /<script type="module" src="\.\/src\/app\.js"><\/script>/);
  assert.match(indexSource, /id="view-workspace"/);
  for (const needle of ["workspaceMarket", "workspacePortfolio", "workspaceStrategies", "workspaceActivity", "workspaceGapRadar", "conversation"]) assert.match(indexSource, new RegExp(needle));
});

test("real app talks to the backend for market, wallet, portfolio, strategy, history and AI data", () => {
  for (const path of ["/api/markets", "/api/wallet/status", "/api/wallet/address", "/api/portfolio", "/api/strategies", "/api/strategies/attribution", "/api/history", "/api/chat"]) assert.match(appJs, new RegExp(path.replaceAll("/", "\\/")));
});

test("production runtime does not contain demo fabricated balances or random receipts", () => {
  for (const fake of ["12480", "1850", "4.78", "189.10", "187.40", "0x7a3f", "Math.random"]) assert.doesNotMatch(appJs, new RegExp(fake.replace(".", "\\."), "i"));
});

test("portfolio is backed by Binance Agentic Wallet balances", () => {
  assert.match(executionSource, /wallet","balance/);
  assert.match(portfolioSource, /new BinanceAgenticWalletAdapter\(\)\.balances/);
});

test("server exposes the live market, wallet, portfolio, strategy and chat seams", () => {
  for (const path of ["/api/markets", "/api/wallet/status", "/api/wallet/address", "/api/portfolio", "/api/strategies", "/api/chat"]) assert.match(serverSource, new RegExp(path.replaceAll("/", "\\/")));
});

test("AI receives authoritative account context from the server", () => {
  assert.match(serverSource, /accountContext/);
  assert.match(agentSource, /async run\(message: string, accountContext\?/);
  assert.match(agentSource, /accountContext/);
});
