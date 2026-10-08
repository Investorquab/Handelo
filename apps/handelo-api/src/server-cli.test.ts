import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./server.ts", import.meta.url)), "utf8");

test("wallet auth uses the platform-safe BAW command configuration", () => {
  assert.match(source, /import \{ BAW_COMMAND, BAW_SHELL, BinanceAgenticWalletAdapter \} from "@handelo\/execution";/);
  assert.match(source, /execFileAsync\(BAW_COMMAND, \[\.\.\.args, "--json"\], \{ maxBuffer: 1024 \* 1024, shell: BAW_SHELL \}\)/);
});

test("wallet address reads the BSC address from the Agentic Wallet address list", () => {
  assert.match(source, /addresses\?: Array<\{ binanceChainId\?: string; address\?: string \}>/);
  assert.match(source, /\.find\(\(entry\) => entry\.binanceChainId === "56"\)/);
  assert.match(source, /\.address\?\.trim\(\) \?\? ""/);
});


test("chat boundary enforces the configured client API key", () => {
  assert.match(source, /const CLIENT_API_KEY = process\.env\.HANDELO_CLIENT_API_KEY/);
  assert.match(source, /req\.headers\["x-handelo-api-key"\] !== CLIENT_API_KEY/);
  assert.match(source, /A valid Handelo client API key is required/);
  assert.match(source, /access-control-allow-headers": "content-type, x-handelo-api-key"/);
});


test("strategy activation boundary is wallet-scoped and risk-gated", () => {
  assert.match(source, /GET.*\/api\/strategies/);
  assert.match(source, /POST.*\/api\/strategies\/activate/);
  assert.match(source, /listActiveStrategies\(walletAddress\)/);
  assert.match(source, /evaluatePortfolioStrategyRisk\(snapshot, strategy\.asset, strategy\.amountUsd, strategy\.constraints\)/);
  assert.match(source, /status !== "DRAFT"/);
  assert.match(source, /executionScheduled: false/);
});


test("API startup does not require the LLM key before a chat request", () => {
  assert.match(source, /let agent: HandeloAgent \| null = null/);
  assert.match(source, /function getAgent\(\): HandeloAgent/);
  assert.match(source, /agent \?\?= new HandeloAgent\(\)/);
});


test("portfolio rebalance preview is deterministic and never schedules execution", () => {
  assert.match(source,/POST.*\/api\/portfolio\/rebalance-preview/);
  assert.match(source,/createRebalancePreview\(await portfolioSnapshot\(walletAddress\)/);
  assert.match(source,/executionScheduled: false/);
  assert.match(source,/targetAllocation must be an object/);
});

test("API startup does not require market provider credentials before market requests", () => {
  assert.match(source, /let market: ReturnType<typeof marketClientFromEnv> \| null = null/);
  assert.match(source, /function getMarket\(\): ReturnType<typeof marketClientFromEnv>/);
  assert.match(source, /market \?\?= marketClientFromEnv\(\)/);
});


test("execution boundary requires explicit enablement, non-default secret, wallet binding, fresh quote, and audit support", () => {
  assert.match(source, /HANDELO_EXECUTION_ENABLED.*!== "true"/);
  assert.match(source, /HANDELO_REVIEW_TOKEN_SECRET/);
  assert.match(source, /reviewTokenSecret === "handelo-local-review-secret"/);
  assert.match(source, /connectedAddress\.toLowerCase\(\) !== walletAddress\.toLowerCase\(\)/);
  assert.match(source, /const reviewedQuote = await wallet\.quote/);
  assert.match(source, /!securityAudit\.isSupported/);
  assert.match(source, /consumeReviewToken\(reviewToken\)/);
});

test("execution never returns fabricated success state", () => {
  assert.match(source, /const result = await wallet\.execute/);
  assert.doesNotMatch(source, /txHash:\s*["']0x[0-9a-fA-F]{64}["']/);
});


test("review response exposes quote quality analysis without enabling execution", () => {
  assert.match(source, /createQuoteQuality/);
  assert.match(source, /quoteQuality/);
  assert.match(source, /executionBlocked/);
});

test("wallet signout uses the official Agentic Wallet auth signout command", () => {
  assert.match(source, /POST.*\/api\/wallet\/signout/);
  assert.match(source, /bawJson\(\["auth", "signout"\]\)/);
  assert.match(source, /status: "SIGNED_OUT"/);
});

test("live workspace exposes a coherent snapshot and SSE stream", () => {
  assert.match(source, /\/api\/workspace\/snapshot/);
  assert.match(source, /\/api\/workspace\/stream/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /type: "snapshot"/);
  assert.match(source, /type: "market"/);
  assert.match(source, /type: "account"/);
});
test("live market refresh is shared across workspace clients", () => {
  assert.match(source, /liveWorkspaceClients/);
  assert.match(source, /broadcastLiveMarket/);
  assert.match(source, /2500/);
  assert.match(source, /marketRefresh/);
});

test("live workspace snapshot returns portfolio before history and strategy enrichment", () => {
  assert.match(source, /workspacePortfolioFast/);
  assert.match(source, /workspaceAccount\(client\.wallet\)/);
  assert.match(source, /type: "snapshot"/);
  assert.match(source, /type: "account"/);
});

test("live workspace loads Binance Agentic Wallet BSC balances", () => {
  assert.match(source, /wallet", "balance", "--binanceChainId", "56"/);
  assert.match(source, /walletBalances/);
  assert.match(source, /walletBalancesError/);
});
test("live workspace fast snapshot loads portfolio and wallet balances in parallel", () => {
  assert.match(source, /workspacePortfolioFast/);
  assert.match(source, /Promise\.allSettled\(\[/);
  assert.match(source, /portfolioSnapshot\(walletAddress\)/);
  assert.match(source, /liveWalletBalances\(\)/);
});

test("live review supports BNB and USDT funding tokens", () => {
  assert.match(source, /resolveFundingBalance/);
  assert.match(source, /fundingQtyForUsd/);
  assert.doesNotMatch(source, /currently requires the BSC USDT quote token/);
});
test("live review and execution bind the exact funding quantity", () => {
  assert.match(source, /fundingTokenQty/);
  assert.match(source, /fromTokenQty,/);
  assert.match(source, /fromTokenQty: reviewedToken\?\.fromTokenQty/);
  assert.match(source, /ticker === "NVDA" \? "NVDAB" : ticker/);
});
