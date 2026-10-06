import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appPath = fileURLToPath(new URL("./app.js", import.meta.url));
const source = readFileSync(appPath, "utf8");
const indexSource = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

test("workspace is the single primary application view", () => {
  assert.match(indexSource, /data-view="workspace"/);
  assert.match(indexSource, /id="view-workspace"/);
  assert.match(indexSource, /class="workspace-grid"/);
  assert.match(indexSource, /class="workspace-context"/);
  assert.match(indexSource, /class="workspace-chat"/);
  assert.match(source, /function showView\(view = "workspace"\)/);
  assert.match(source, /section\.id === "view-" \+ nextView/);
});

test("workspace keeps market, wallet, portfolio, strategy, risk, and activity context visible", () => {
  for (const id of ["workspaceMarket","workspaceWalletBalance","workspaceWalletAddress","workspacePortfolio","workspaceStrategies","workspaceRiskState","workspaceActivity"]) {
    assert.match(indexSource, new RegExp(`id="${id}"`));
  }
});

test("workspace Gap Radar renders cross-representation rows once", () => {
  assert.match(source, /workspaceGapRadar\.innerHTML = marketRows \+ comparisonHeader \+ empty;/);
  assert.doesNotMatch(source, /workspaceGapRadar\.innerHTML = marketRows \+ comparisonHeader \+ comparisonRows \+ empty;/);
});

test("workspace context refreshes from live market, gap radar, and wallet APIs", () => {
  assert.match(source, /API_BASE \+ "\/api\/markets"/);
  assert.match(source, /API_BASE \+ "\/api\/gap-radar\?limit=5/);
  assert.match(source, /function renderWorkspaceGapRadar\(markets, representations = \[\]\)/);
  assert.match(source, /API_BASE \+ "\/api\/wallet\/address"/);
  assert.match(source, /API_BASE \+ "\/api\/portfolio\?wallet=/);
  assert.match(source, /API_BASE \+ "\/api\/history\?wallet=/);
  assert.match(source, /function refreshWorkspaceContext\(\)/);
});

test("chat remains embedded as the workspace control surface", () => {
  assert.match(indexSource, /id="conversation"/);
  assert.match(indexSource, /id="composer"/);
  assert.match(indexSource, /id="messageInput"/);
  assert.match(source, /async function ask\(/);
  assert.match(source, /API_BASE \+ "\/api\/chat"/);
});

test("chat responses auto-scroll to the latest content", () => {
  assert.match(source, /conversation\.scrollTo\(\{ top: conversation\.scrollHeight/);
});

test("structured market insight remains available in chat", () => {
  assert.match(source, /context-kicker/);
  assert.match(source, /MARKET INSIGHT/);
  assert.match(source, /function renderMarketContext/);
  assert.match(source, /function renderCandidates/);
  assert.match(source, /data\.market/);
  assert.match(source, /data\.candidates/);
});

test("transaction review requires policy and security checks before confirmation", () => {
  assert.match(source, /decision !== "BLOCK" && !riskBlocked && !securityBlocked && Boolean\(data\.reviewToken && quote\)/);
  assert.match(source, /data-cancel/);
  assert.match(source, /data-confirm/);
  assert.match(source, /Confirm purchase/);
});

test("transaction review and execution bind to the full wallet address", () => {
  assert.match(source, /workspaceWalletAddressValue = address\.address/);
  assert.match(source, /wallet: workspaceWalletAddressValue/);
  assert.doesNotMatch(source, /wallet: workspaceWalletAddress,\s*confirmed: true/);
  assert.match(source, /wallet: workspaceWalletAddressValue\s*,\s*confirmed: true/);
});

test("transaction execution remains explicitly confirmed and status-aware", () => {
  assert.match(source, /wallet: workspaceWalletAddressValue/);
  assert.match(source, /confirmed: true/);
  assert.match(source, /result\.status === "FINISHED"/);
  assert.match(source, /result\.status === "PENDING"/);
  assert.match(source, /EXECUTION FAILED/);
  assert.match(source, /Transaction hash unavailable/);
});

test("execution follow-ups refresh the unified workspace instead of navigating to subpages", () => {
  assert.match(source, /data-refresh-portfolio/);
  assert.match(source, /data-view-history/);
  assert.match(source, /refreshWorkspaceContext\(\)/);
  assert.doesNotMatch(source, /showView\("portfolio"\)/);
  assert.doesNotMatch(source, /showView\("history"\)/);
});

test("wallet authentication guards duplicate sessions and stale responses", () => {
  assert.match(source, /let walletAuthActive = false/);
  assert.match(source, /if \(walletAuthActive\) return/);
  assert.match(source, /walletAuthSessionId/);
  assert.match(source, /clearWalletAuthPolling\(\)/);
});

test("market records are normalized before rendering", () => {
  assert.match(source, /function normalizeMarketRecord\(market\)/);
  assert.match(source, /marketRecords = markets\.map\(normalizeMarketRecord\)/);
  assert.match(source, /premiumPct/);
});

test("workspace exposes a persistent Gap Radar context panel", () => {
  assert.match(indexSource, /id="workspaceGapRadar"/);
  assert.match(indexSource, /id="workspaceGapRadarStatus"/);
  assert.match(source, /workspaceGapRadar/);
  assert.match(source, /divergencePercent/);
});

test("workspace market context includes a truthful current price comparison", () => {
  assert.match(source, /workspace-price-compare/);
  assert.match(source, /on-chain versus reference price comparison/);
  assert.match(source, /referencePrice \/ scale/);
});

test("rebalance strategies request a deterministic live portfolio preview", () => {
  assert.match(source,/\/api\/portfolio\/rebalance-preview/);
  assert.match(source,/strategy\.targetAllocation/);
  assert.match(source,/no rebalance has been scheduled/);
});

test("workspace portfolio exposes live BSC reconciliation provenance", () => {
  assert.match(source, /portfolio\?\.source === "BSC_TOKEN_BALANCES"/);
  assert.match(source, /LIVE BSC SNAPSHOT/);
  assert.match(source, /portfolio\?\.asOf/);
  assert.match(source, /formatMarketTime\(portfolio\?\.asOf\)/);
});

test("workspace styling defines the persistent two-column layout", () => {
  assert.match(styles, /\.workspace-grid/);
  assert.match(styles, /\.workspace-context/);
  assert.match(styles, /\.workspace-chat/);
});

test("frontend exposes keyboard-visible focus states", () => {
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /outline:/);
});

test("chat composer requires a non-empty message", () => {
  assert.match(indexSource, /id="messageInput"[^>]*required/);
});


test("strategy preview is rendered from agent strategy data",()=>{assert.match(source,/data\.strategy/);assert.match(source,/function addStrategyPreview\(strategy\)/);assert.match(source,/STRATEGY PREVIEW/);});
test("basket strategy intelligence renders a deterministic draft preview",()=>{assert.match(source,/data\.basket/);assert.match(source,/function addBasketPreview\(basket\)/);assert.match(source,/BASKET PREVIEW/);assert.match(source,/REBALANCE strategy/);});

test("portfolio preview is a supported structured chat card", () => {
  assert.match(source, /function addPortfolioPreview\(portfolio\)/);
  assert.match(source, /PORTFOLIO PREVIEW/);
  assert.match(source, /data\.portfolio\) addPortfolioPreview\(data\.portfolio\)/);
});

test("strategy preview exposes deterministic portfolio risk review",()=>{assert.match(source,/api\/strategy\/risk/);assert.match(source,/PORTFOLIO RISK/);assert.match(source,/activation remains blocked/);});

test("transaction preview requires portfolio risk to pass before confirmation",()=>{assert.match(source,/riskDecision !== "PASS"/);assert.match(source,/PORTFOLIO RISK/);assert.match(source,/TRANSACTION PREVIEW/);assert.match(source,/wallet: workspaceWalletAddressValue/);});


test("Handelo exposes exactly two primary navigation destinations", () => {
  assert.match(indexSource, /data-view="home"/);
  assert.match(indexSource, /data-view="workspace"/);
  assert.match(indexSource, /id="view-home"/);
  assert.match(indexSource, /id="view-workspace"/);
  assert.match(source, /function showView\(view = "workspace"\)/);
  assert.match(source, /section\.id === "view-" \+ nextView/);
});

test("homepage contains the locked product narrative and real UI surfaces", () => {
  assert.match(indexSource, /Understand\.\\?<br><em>Strategize\. Execute\.<\\?\/em>/);
  assert.match(indexSource, /Markets close\.<br><em>Tokenized stocks don't\.<\\?\/em>/);
  assert.match(indexSource, /DISCOVER|Discover/);
  assert.match(indexSource, /MARKET INSIGHT/);
  assert.match(indexSource, /STRATEGY PREVIEW/);
  assert.match(indexSource, /RISK RESULT/);
  assert.match(indexSource, /TRANSACTION PREVIEW/);
});

test("homepage CTAs open the unified workspace", () => {
  assert.match(indexSource, /id="homeWorkspaceCta"/);
  assert.match(indexSource, /id="homeFinalCta"/);
  assert.match(source, /showView\("workspace"\)/);
});

test("workspace remains the single persistent AI control surface", () => {
  assert.match(indexSource, /id="conversation"/);
  assert.match(indexSource, /id="composer"/);
  assert.match(indexSource, /class="workspace-context"/);
  assert.match(indexSource, /class="workspace-chat"/);
});


test("workspace surfaces loading and service errors instead of failing silently",()=>{assert.match(source,/function renderWorkspaceError\(element, message\)/);assert.match(source,/Market data is unavailable right now/);assert.match(source,/Could not reach the Gap Radar service/);assert.match(source,/aria-busy/);});


test("chat renders deterministic policy results as a structured risk card",()=>{assert.match(source,/function addRiskPreview\(policy\)/);assert.match(source,/RISK RESULT/);assert.match(source,/data\.policy && data\.intent\?\.action !== "research"/);});


test("workspace live context exposes accessible update regions", () => {
  assert.match(indexSource, /id="workspaceMarket" aria-live="polite"/);
  assert.match(indexSource, /id="workspaceMarketStatus" aria-live="polite"/);
  assert.match(indexSource, /id="workspaceGapRadar" aria-live="polite" aria-busy="false"/);
  assert.match(indexSource, /id="workspaceGapRadarStatus"[^>]*aria-live="polite"/);
  assert.match(source, /role="group" aria-label=/);
  assert.match(source, /workspaceGapRadar.setAttribute\("aria-busy", "false"\)/);
});

test("workspace market and radar failures clear loading state", () => {
  assert.match(source, /workspaceMarket\?\.setAttribute\("aria-busy", "false"\)/);
  assert.match(source, /No measurable gaps available/);
});


test("market radar exposes live status, market hours, reason and liquidity context",()=>{assert.match(source,/market\.marketStatus/);assert.match(source,/market\.liquidityContext/);assert.match(source,/market\.marketStatusReason/);assert.match(source,/marketSchedule\(normalizeMarketRecord\(market\)\)/);assert.match(source,/formatMarketTime/);assert.match(source,/label \+ " status " \+ status/);});
test("market-hour timestamps accept normalized ISO insight values",()=>{assert.match(source,/Date\.parse\(String\(value \|\| ""\)\)/);assert.match(source,/nextCloseAt/);assert.match(source,/nextOpenAt/);});
test("workspace activity exposes truthful transaction time and safe explorer links",()=>{assert.match(source,/new Date\(tx\.txTime\)\.toLocaleString/);assert.match(source,/https:\/\/bscscan\.com\/tx\//);assert.match(source,/noopener noreferrer/);});


test("market detail actions remain inside the two-page workspace", () => {
  assert.match(source, /showView\(["']workspace["']\)/);
  assert.doesNotMatch(source, /showView\(["']chat["']\)/);
});


test("workspace loads and activates persisted strategies through the API", () => {
  assert.match(source, /\/api\/strategies\?wallet=/);
  assert.match(source, /\/api\/strategies\/activate/);
  assert.match(source, /data-activate/);
  assert.match(source, /Review &amp; Activate/);
  assert.match(source, /No transaction or schedule was created automatically/);
});


test("workspace strategy context exposes persisted execution attribution", () => {
  assert.match(source, /\/api\/strategies\/attribution\?wallet=/);
  assert.match(source, /function renderWorkspaceStrategies\(strategies = \[\], attribution = \[\]\)/);
  assert.match(source, /finishedCount.*executionCount/);
  assert.match(source, /successfulPlannedUsd/);
});


test("transaction review renders quote-backed execution quality metrics", () => {
  assert.match(source, /data\.quoteQuality/);
  assert.match(source, /QUOTE QUALITY/);
  assert.match(source, /quoteVsOnChainPercent/);
  assert.match(source, /quoteVsReferencePercent/);
});


test("workspace provides first-stock onboarding from live market data", () => {
  assert.match(indexSource, /id="workspaceOnboarding"/);
  assert.match(indexSource, /id="workspaceOnboardingContent"/);
  assert.match(source, /function renderFirstStockOnboarding\(markets = \[\]\)/);
  assert.match(source, /handelo:first-stock-onboarded/);
  assert.match(source, /data-onboard-market/);
  assert.match(source, /Selecting a stock only opens an explanation/);
  assert.match(source, /Explain " \+ symbol \+ " and its reference-price gap/);
});


test("workspace exposes Binance-backed upcoming earnings intelligence", () => {
  assert.match(indexSource, /id="workspaceEarnings"/);
  assert.match(indexSource, /id="workspaceEarningsContent"/);
  assert.match(source, /\/api\/earnings\?limit=5/);
  assert.match(source, /function renderWorkspaceEarnings\(events = \[\]\)/);
  assert.match(source, /BINANCE EARNINGS SIGNAL/);
  assert.match(source, /earningsResponse/);
});

test("workspace exposes the Wallet Center guardrail surface", () => {
  assert.match(indexSource, /id="workspaceWalletCenter"/);
  assert.match(source, /function renderWorkspaceWalletCenter\(guardrails\)/);
  assert.match(source, /\/api\/wallet\/guardrails/);
  assert.match(source, /DAILY LIMIT/);
  assert.match(source, /QUOTA LEFT/);
  assert.match(source, /TX LOCK/);
  assert.match(source, /Provider guardrails are read-only here/);
});
