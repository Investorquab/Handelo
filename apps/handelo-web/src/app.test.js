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
  assert.match(indexSource, /AI explains\.<br>The system governs\.<br>You decide\./);
  assert.match(indexSource, /Markets close\.[\s\S]*Tokenized stocks don't\./);
  assert.match(indexSource, /DISCOVER|Discover/);
  assert.match(indexSource, /MARKET INTELLIGENCE/);
  assert.match(indexSource, /STRATEGY/);
  assert.match(indexSource, /PORTFOLIO RISK/);
  assert.match(indexSource, /EXECUTION/);
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

test("workspace strategy cards expose pause, resume and cancel controls", () => {
  assert.match(source, /data-strategy-action="pause"/);
  assert.match(source, /data-strategy-action="resume"/);
  assert.match(source, /data-strategy-action="cancel"/);
  assert.match(source, /\/api\/strategies\/"\s*\+\s*action/);
});


test("premium terminal header exposes direct workspace surfaces without adding primary pages",()=> {
  assert.match(indexSource,/class="terminal-header"/);
  for (const label of ["Markets","Portfolio","Strategies","Activity"]) assert.match(indexSource,new RegExp(label));
  assert.match(indexSource,/data-workspace-focus="workspacePortfolio"/);
  assert.match(indexSource,/data-workspace-focus="workspaceStrategies"/);
  assert.match(indexSource,/data-ask-handelo/);
});

test("homepage uses the approved connected seven-stage operating loop",()=> {
  assert.match(indexSource,/class="lg"/);
  assert.match(indexSource,/data-home-stage="0"/);
  assert.match(indexSource,/data-home-stage="6"/);
  assert.match(source,/premiumLoopDetail/);
  assert.match(indexSource,/The system makes the decision path visible/);
});


test("homepage market object is backed by live market reality", () => {
  assert.match(indexSource, /id="homeMarketReality"/);
  assert.match(indexSource, /id="homeMarketLiveStatus"/);
  assert.doesNotMatch(indexSource, /INTERFACE PREVIEW/);
  assert.doesNotMatch(indexSource, /Illustrative relationship/);
  assert.match(source, /function renderHomeMarketReality\(markets = \[\]\)/);
  assert.match(source, /function loadHomeMarketReality\(\)/);
  assert.match(source, /API_BASE \+ "\/api\/markets"/);
});

test("homepage market reality exposes truthful price, gap, state, liquidity and provider context", () => {
  assert.match(source, /homeReferencePrice/);
  assert.match(source, /homeTokenPrice/);
  assert.match(source, /homeMarketGap/);
  assert.match(source, /homeMarketState/);
  assert.match(source, /selected\.liquidityContext/);
  assert.match(source, /selected\.provider/);
  assert.match(source, /selected\.volume24hUsd/);
  assert.match(indexSource, /No simulated market state is shown/);
});

test("workspace selected market exposes live liquidity and volume fields", () => {
  assert.match(source, /<small>LIQUIDITY<\/small>/);
  assert.match(source, /<small>VOLUME<\/small>/);
  assert.match(source, /market\.liquidityContext/);
  assert.match(source, /market\.volume24hUsd/);
});

test("wallet center exposes real connection status and BSC address context", () => {
  assert.match(indexSource, /id="workspaceWalletStatus"/);
  assert.match(indexSource, /id="workspaceWalletProvider"/);
  assert.match(indexSource, /id="workspaceWalletAddress"/);
  assert.match(source, /\/api\/wallet\/status/);
  assert.match(source, /workspaceWalletStatus\.textContent = "CONNECTED"/);
  assert.match(source, /workspaceWalletAddressValue = address\.address/);
  assert.match(source, /BINANCE AGENTIC WALLET/);
});

test("portfolio surface exposes live value, cash balance, allocations and fail-closed P&L", () => {
  assert.match(indexSource, /id="workspacePortfolioSummary"/);
  assert.match(indexSource, /POSITION VALUE/);
  assert.match(indexSource, /AVAILABLE USDT/);
  assert.match(indexSource, /UNREALIZED P&amp;L/);
  assert.match(source, /portfolio\?\.totalValueUsd/);
  assert.match(source, /portfolio\?\.balanceUsd/);
  assert.match(source, /position\.allocationPercent/);
  assert.match(source, /COST BASIS REQUIRED/);
  assert.match(source, /does not estimate historical cost from current balances/);
});

test("portfolio presentation has no fabricated demo balance", () => {
  assert.doesNotMatch(indexSource, /12,480/);
  assert.doesNotMatch(source, /\$12,480/);
});

test("order review is server-authoritative and has no browser policy engine", () => {
  assert.match(source, /API_BASE \+ "\/api\/review"/);
  assert.doesNotMatch(source, /function evaluatePolicy/);
  assert.doesNotMatch(source, /evaluatePolicy\(/);
  assert.match(source, /policy\.decision/);
  assert.match(source, /policy\.reasons/);
  assert.match(source, /READY FOR CONFIRMATION/);
  assert.match(source, /CONFIRM REQUIRED/);
  assert.match(source, /BLOCKED/);
});

test("order review surfaces security-audit state and fail-closed execution", () => {
  assert.match(source, /data\.securityAudit/);
  assert.match(source, /securityAuditError/);
  assert.match(source, /executionBlocked/);
  assert.match(source, /SECURITY CHECK UNAVAILABLE — EXECUTION BLOCKED/);
  assert.match(source, /Binance security audit reports high risk/);
});

test("chat surfaces the server-provided agent decision trace", () => {
  assert.match(source, /data\.trace/);
  assert.match(source, /function addAgentTracePreview\(trace\)/);
  assert.match(source, /HANDELO OPERATING TRACE/);
  assert.match(source, /OBSERVED/);
  assert.match(source, /POLICY_CHECKED/);
  assert.match(source, /EXECUTION_GATED/);
  assert.match(source, /AWAITING APPROVAL/);
  assert.match(source, /No execution occurs from chat/);
});

test("chat keeps execution behind the review and confirmation boundary", () => {
  assert.match(source, /trace\.executionPlan/);
  assert.match(source, /requiresExplicitConfirmation/);
  assert.match(source, /\/api\/review/);
  assert.match(source, /data\.policy\?\.decision !== "BLOCK"/);
});

test("active strategy cards expose scheduler state and execution outcomes", () => {
  assert.match(source, /stats\?\.failedCount/);
  assert.match(source, /stats\?\.nextExecutionAt/);
  assert.match(source, /strategy\.nextExecutionAt/);
  assert.match(source, /stats\?\.lastExecutionAt/);
  assert.match(source, /NEXT RUN NOT SCHEDULED/);
  assert.match(source, /NO RUN YET/);
  assert.match(source, /failed/);
});

test("strategy runtime presentation does not imply execution from a stored schedule", () => {
  assert.match(source, /No transaction or schedule was created automatically/);
  assert.match(source, /Active strategy stored/);
  assert.match(source, /nextExecutionAt/);
});
