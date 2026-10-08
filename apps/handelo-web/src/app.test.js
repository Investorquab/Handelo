import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appPath = fileURLToPath(new URL("./app.js", import.meta.url));
const source = readFileSync(appPath, "utf8");
const indexSource = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
const liveWorkspaceSource = readFileSync(fileURLToPath(new URL("./live-workspace.js", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

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

test("strategy preview is rendered from agent strategy data",()=>{assert.match(source,/data\.strategy/);assert.match(source,/function addStrategyPreview\(strategy\)/);assert.match(source,/STRATEGY PREVIEW/);});
test("basket strategy intelligence renders a deterministic draft preview",()=>{assert.match(source,/data\.basket/);assert.match(source,/function addBasketPreview\(basket\)/);assert.match(source,/BASKET PREVIEW/);assert.match(source,/REBALANCE strategy/);});

test("portfolio preview is a supported structured chat card", () => {
  assert.match(source, /function addPortfolioPreview\(portfolio\)/);
  assert.match(source, /PORTFOLIO PREVIEW/);
  assert.match(source, /data\.portfolio\) addPortfolioPreview\(data\.portfolio\)/);
});

test("strategy preview exposes deterministic portfolio risk review",()=>{assert.match(source,/api\/strategy\/risk/);assert.match(source,/PORTFOLIO RISK/);assert.match(source,/activation remains blocked/);});

test("transaction preview requires portfolio risk to pass before confirmation",()=>{assert.match(source,/riskDecision !== "PASS"/);assert.match(source,/PORTFOLIO RISK/);assert.match(source,/TRANSACTION PREVIEW/);assert.match(source,/wallet: workspaceWalletAddressValue/);});


test("workspace surfaces loading and service errors instead of failing silently",()=>{assert.match(source,/function renderWorkspaceError\(element, message\)/);assert.match(source,/Market data is unavailable right now/);assert.match(source,/Could not reach the Gap Radar service/);assert.match(source,/aria-busy/);});


test("chat renders deterministic policy results as a structured risk card",()=>{assert.match(source,/function addRiskPreview\(policy\)/);assert.match(source,/RISK RESULT/);assert.match(source,/data\.policy && data\.intent\?\.action !== "research"/);});


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


test("workspace strategy cards expose pause, resume and cancel controls", () => {
  assert.match(source, /data-strategy-action="pause"/);
  assert.match(source, /data-strategy-action="resume"/);
  assert.match(source, /data-strategy-action="cancel"/);
  assert.match(source, /\/api\/strategies\/"\s*\+\s*action/);
});


test("workspace selected market exposes live liquidity and volume fields", () => {
  assert.match(source, /<small>LIQUIDITY<\/small>/);
  assert.match(source, /<small>VOLUME<\/small>/);
  assert.match(source, /market\.liquidityContext/);
  assert.match(source, /market\.volume24hUsd/);
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

test("approved landing page preserves the supplied standalone home and workspace flow", () => {
  assert.match(indexSource, /<title>Handelo workspace mockup<\/title>/);
  assert.match(indexSource, /id="openh"/);
  assert.match(indexSource, /id="oh1"/);
  assert.match(indexSource, /id="oh2"/);
  assert.match(indexSource, /location\.hash="workspace"/);
});

test("landing page exposes the approved product narrative and seven-stage loop", () => {
  assert.match(indexSource, /AI explains\.<br>The system governs\.<br>You decide\./);
  assert.match(indexSource, /Markets close\. Tokenized stocks don't\./);
  assert.match(indexSource, /data-i="0"/);
  assert.match(indexSource, /data-i="6"/);
  assert.match(indexSource, /Market intelligence/);
  assert.match(indexSource, /Strategy/);
  assert.match(indexSource, /Portfolio risk/);
  assert.match(indexSource, /Execution/);
});

test("landing page keeps the validated asset scope truthful", () => {
  assert.match(indexSource, /NVDA and NVDAB/);
  assert.match(indexSource, /only asset validated end to end/);
  assert.match(indexSource, /Additional assets.*validated/i);
  assert.match(indexSource, /live simulation/);
});

test("Try Demo CTA is present beside the approved how-it-works CTA", () => {
  assert.match(indexSource, /id="how"/);
  assert.match(indexSource, /id="tryd"/);
  assert.match(indexSource, />Try Demo<\/button>/);
  assert.match(indexSource, /["oh1","oh2","openh"]/);
});

test("workspace route accepts the live and demo mode query strings", () => {
  assert.match(indexSource, /function route\(\)\{var v=\(location\.hash\|\|""\)\.slice\(1\)\.split\("\?"\)\[0\]/);
});

test("Try Demo remains demo-only while Open Handelo enters live mode", () => {
  assert.match(indexSource, /function goLive\(\)/);
  assert.match(indexSource, /function goDemo\(\)/);
  assert.match(indexSource, /\$\("tryd"\)\.addEventListener\("click",goDemo\)/);
  assert.match(indexSource, /window\.HANDELO_LIVE_WORKSPACE=true/);
  assert.match(indexSource, /window\.HANDELO_LIVE_WORKSPACE=false/);
  assert.doesNotMatch(indexSource, /goDemo\(\)[\s\S]*?\/api\//);
});


test("Open Handelo live mode is wired to the real backend without changing Try Demo", () => {
  assert.match(indexSource, /function goLive\(\)/);
  assert.match(indexSource, /window\.HANDELO_LIVE_WORKSPACE=true/);
  assert.match(indexSource, /function goDemo\(\)/);
  assert.match(indexSource, /window\.HANDELO_LIVE_WORKSPACE=false/);
  assert.match(indexSource, /["oh1","oh2","openh"]/);
  assert.match(indexSource, /\$\("tryd"\)\.addEventListener\("click",goDemo\)/);
});

test("live workspace uses the Handelo API for market and portfolio data", () => {
  assert.match(liveWorkspaceSource, /\/api\/markets/);
  assert.match(liveWorkspaceSource, /\/api\/wallet\/status/);
  assert.match(liveWorkspaceSource, /\/api\/wallet\/address/);
  assert.match(liveWorkspaceSource, /\/api\/portfolio\?wallet=/);
  assert.match(liveWorkspaceSource, /NVDAB token · live API/);
  assert.doesNotMatch(liveWorkspaceSource, /Try Demo/);
});

test("live workspace uses raw Binance market fields without demo simulation", () => {
  assert.match(liveWorkspaceSource, /volume24H/);
  assert.match(liveWorkspaceSource, /statusInfo/);
  assert.match(liveWorkspaceSource, /liveSamples/);
  assert.match(liveWorkspaceSource, /LIVE API/);
  assert.doesNotMatch(liveWorkspaceSource, /live simulation/);
  assert.doesNotMatch(liveWorkspaceSource, /S\.nv|B0\(|prem\(|tok\(/);
});

test("live workspace loads a coherent snapshot and then receives streamed updates", () => {
  assert.match(liveWorkspaceSource, /\/api\/workspace\/snapshot/);
  assert.match(liveWorkspaceSource, /\/api\/workspace\/stream/);
  assert.match(liveWorkspaceSource, /new EventSource/);
  assert.match(liveWorkspaceSource, /Promise\.allSettled/);
  assert.match(liveWorkspaceSource, /\/api\/portfolio\?wallet=/);
  assert.match(liveWorkspaceSource, /function applyWorkspaceSnapshot\(snapshot\)/);
});

test("live portfolio uses the real API wallet balances", () => {
  assert.match(liveWorkspaceSource, /walletBalances/);
  assert.match(liveWorkspaceSource, /balance\.value/);
  assert.match(liveWorkspaceSource, /balance\.symbol/);
  assert.match(liveWorkspaceSource, /Binance Agentic Wallet/);
  assert.match(liveWorkspaceSource, /0\.01/);
});

test("live mode clears demo values before the real workspace loads", () => {
  assert.match(indexSource, /window\.HandeloLiveWorkspace\.enter\(\)/);
  assert.match(liveWorkspaceSource, /function resetLiveSurface\(\)/);
  assert.match(liveWorkspaceSource, /liveSamples = \[\]/);
});

test("live portfolio and history routes do not invoke demo renderers", () => {
  assert.match(indexSource, /if\(window\.HANDELO_LIVE_WORKSPACE\)\{window\.HandeloLiveWorkspace\?\.syncView/);
  assert.match(indexSource, /if\(v=="hist"\)\{if\(window\.HANDELO_LIVE_WORKSPACE\)\{window\.HandeloLiveWorkspace\?\.syncView/);
});

test("live workspace owns wallet connection, review, execution, and chat actions", () => {
  assert.match(liveWorkspaceSource, /function connectLiveWallet\(\)/);
  assert.match(liveWorkspaceSource, /\/api\/wallet\/auth/);
  assert.match(liveWorkspaceSource, /\/api\/review/);
  assert.match(liveWorkspaceSource, /\/api\/execute/);
  assert.match(liveWorkspaceSource, /\/api\/chat/);
  assert.match(liveWorkspaceSource, /stopImmediatePropagation/);
});

test("live workspace removes demo-only order controls without touching Try Demo", () => {
  assert.match(liveWorkspaceSource, /const stress = .*closest\("\.sw"\)/);
  assert.match(liveWorkspaceSource, /stress\.hidden = true/);
  assert.doesNotMatch(liveWorkspaceSource, /tryd/);
});

test("live workspace exposes real portfolio failures instead of hiding them", () => {
  assert.match(liveWorkspaceSource, /portfolioError/);
  assert.match(liveWorkspaceSource, /portfolio data is unavailable/);
});

test("live order value and review are driven by the live market price", () => {
  assert.match(liveWorkspaceSource, /qty\*tokenPrice/);
  assert.match(liveWorkspaceSource, /amountUsd:qty\*tokenPrice/);
  assert.match(liveWorkspaceSource, /state\.market\.tokenPrice/);
});

test("live workspace wallet menu supports copy and real disconnect", () => {
  assert.match(liveWorkspaceSource, /live-wallet-copy/);
  assert.match(liveWorkspaceSource, /navigator\.clipboard\.writeText\(address\)/);
  assert.match(liveWorkspaceSource, /\/api\/wallet\/signout/);
  assert.match(liveWorkspaceSource, /live-wallet-disconnect/);
});

test("live assistant output formats markdown professionally", () => {
  assert.match(liveWorkspaceSource, /function formatLiveAssistantText\(rawText\)/);
  assert.match(liveWorkspaceSource, /<strong>/);
  assert.match(liveWorkspaceSource, /listType="ol"/);
  assert.match(liveWorkspaceSource, /value\.replace\(\/.*\\\*\\\*/);
});

test("live-only wallet and chat work remains isolated from Try Demo", () => {
  assert.doesNotMatch(liveWorkspaceSource, /tryd/);
  assert.match(indexSource, /\$\("tryd"\)\.addEventListener\("click",goDemo\)/);
  assert.match(indexSource, /window\.HANDELO_LIVE_WORKSPACE=false/);
});

test("live workspace uses one snapshot plus an SSE stream instead of independent polling", () => {
  assert.match(liveWorkspaceSource, /\/api\/workspace\/snapshot/);
  assert.match(liveWorkspaceSource, /\/api\/workspace\/stream/);
  assert.match(liveWorkspaceSource, /new EventSource/);
  assert.doesNotMatch(liveWorkspaceSource, /void refreshMarket\(\);/);
  assert.doesNotMatch(liveWorkspaceSource, /void refreshAccount\(\);/);
});
test("live workspace consumes one coherent market and account snapshot", () => {
  assert.match(liveWorkspaceSource, /function applyWorkspaceSnapshot\(snapshot\)/);
  assert.match(liveWorkspaceSource, /function applyWorkspaceAccount\(account\)/);
  assert.match(liveWorkspaceSource, /snapshot\.market/);
  assert.match(liveWorkspaceSource, /snapshot\.account/);
});
test("live portfolio rendering accepts the wallet balance snapshot fields", () => {
  assert.match(liveWorkspaceSource, /walletBalances/);
  assert.match(liveWorkspaceSource, /balance\.symbol/);
  assert.match(liveWorkspaceSource, /balance\.balance/);
  assert.match(liveWorkspaceSource, /balance\.price/);
  assert.match(liveWorkspaceSource, /balance\.value/);
});
test("live workspace closes its stream when leaving live mode", () => {
  assert.match(liveWorkspaceSource, /if\(!window\.HANDELO_LIVE_WORKSPACE\)closeLiveStream\(\)/);
  assert.match(liveWorkspaceSource, /function closeLiveStream\(resetAttempt = true\)/);
});

test("live stream reconnect keeps exponential backoff state", () => {
  assert.match(liveWorkspaceSource, /closeLiveStream\(false\)/);
  assert.match(liveWorkspaceSource, /Math\.min\(10000,1000\*Math\.pow\(2,state\.streamAttempt-1\)\)/);
});

test("live workspace renders all provider-returned BSC balances", () => {
  assert.match(liveWorkspaceSource, /walletBalances/);
  assert.match(liveWorkspaceSource, /renderLiveBalances/);
  assert.match(liveWorkspaceSource, /liveBalanceTotal/);
  assert.match(liveWorkspaceSource, /balance\.symbol/);
  assert.match(liveWorkspaceSource, /balance\.address/);
  assert.match(liveWorkspaceSource, /balance\.value/);
});
test("live portfolio view is not limited to NVDAB and USDT", () => {
  assert.match(liveWorkspaceSource, /all BSC balances/);
  assert.match(liveWorkspaceSource, /balances\.map\(balance=>/);
  assert.match(liveWorkspaceSource, /<th>Contract<\/th>/);
});

test("live buy uses a real connected-wallet funding token selector", () => {
  assert.match(liveWorkspaceSource, /live-funding-token/);
  assert.match(liveWorkspaceSource, /Pay with/);
  assert.match(liveWorkspaceSource, /selectedFundingBalance/);
  assert.match(liveWorkspaceSource, /walletBalances/);
  assert.match(liveWorkspaceSource, /BNB/);
  assert.match(liveWorkspaceSource, /USDT/);
});
test("live buy explicitly targets the NVDAB representation", () => {
  assert.match(liveWorkspaceSource, /ticker:state\.market\.tokenSymbol\|\|"NVDAB"/);
  assert.doesNotMatch(liveWorkspaceSource, /ticker:state\.market\.underlyingTicker\|\|"NVDA"/);
});
test("live buy displays the selected funding-token equivalent", () => {
  assert.match(liveWorkspaceSource, /sourceQty=usd\/Number\(funding\.price\)/);
  assert.match(liveWorkspaceSource, /funding\.symbol/);
});

test("live Buy and Sell modes have distinct real trade semantics", () => {
  assert.match(liveWorkspaceSource, /currentLiveSide/);
  assert.match(liveWorkspaceSource, /target\.dataset\.side==="sell"/);
  assert.match(liveWorkspaceSource, /Review live sell/);
  assert.match(liveWorkspaceSource, /Review live buy/);
});
test("live Sell uses NVDAB as source and a real BSC payout token", () => {
  assert.match(liveWorkspaceSource, /LIVE_NATIVE_BNB/);
  assert.match(liveWorkspaceSource, /LIVE_USDT/);
  assert.match(liveWorkspaceSource, /LIVE_USDC/);
  assert.match(liveWorkspaceSource, /fromToken:side==="sell"\?String\(state\.market\.tokenContractAddress/);
  assert.match(liveWorkspaceSource, /toToken:side==="sell"\?String\(selected\.address/);
});
test("live Buy uses the selected wallet token as source and NVDAB as destination", () => {
  assert.match(liveWorkspaceSource, /fromToken:side==="sell"\?String\(state\.market\.tokenContractAddress\|\|"\":String\(selected\.address/);
  assert.match(liveWorkspaceSource, /toToken:side==="sell"\?String\(selected\.address\|\|"\":String\(state\.market\.tokenContractAddress/);
});
