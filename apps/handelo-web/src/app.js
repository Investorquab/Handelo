const API_BASE = window.HANDELO_API_URL || localStorage.getItem("handelo_api_url") || "http://localhost:8787";

const conversation = document.querySelector("#conversation");
const welcome = document.querySelector("#welcome");
const composer = document.querySelector("#composer");
const input = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const connectButton = document.querySelector("#connectButton");
const marketGrid = document.querySelector("#marketGrid");
const marketSearch = document.querySelector("#marketSearch");
const marketCount = document.querySelector("#marketCount");
let marketRecords = [];
let workspaceWalletAddressValue = "";
const walletState = document.querySelector(".wallet-state");
let walletAuthPoll = null;
let walletAuthTimeout = null;
let walletAuthActive = false;
let walletAuthSessionId = 0;
let walletAuthReturnFocus = null;
let walletAuthKeydown = null;
let dataViewRequestId = 0;
const tradeReviewRequestIds = new WeakMap();
const executionRequestIds = new WeakMap();
const walletStatusRequestIds = new WeakMap();
let chatRequestId = 0;
const workspaceMarket = document.querySelector("#workspaceMarket");
const workspaceMarketStatus = document.querySelector("#workspaceMarketStatus");
const workspaceWalletBalance = document.querySelector("#workspaceWalletBalance");
const workspaceWalletAddress = document.querySelector("#workspaceWalletAddress");
const workspacePortfolio = document.querySelector("#workspacePortfolio");
const workspaceActivity = document.querySelector("#workspaceActivity");
const workspaceGapRadar = document.querySelector("#workspaceGapRadar");
const workspaceGapRadarStatus = document.querySelector("#workspaceGapRadarStatus");
const workspaceStrategies = document.querySelector("#workspaceStrategies");
const workspaceRiskState = document.querySelector("#workspaceRiskState");
const workspaceRiskBar = document.querySelector("#workspaceRiskBar");
const workspaceRiskCopy = document.querySelector("#workspaceRiskCopy");
const workspaceWalletAction = document.querySelector("#workspaceWalletAction");
const workspacePortfolioRefresh = document.querySelector("#workspacePortfolioRefresh");
const workspaceHistoryRefresh = document.querySelector("#workspaceHistoryRefresh");

function renderWorkspaceRisk(risk) {
  if (!workspaceRiskState || !workspaceRiskCopy || !workspaceRiskBar) return;
  if (!risk) {
    workspaceRiskState.textContent = "—";
    workspaceRiskState.className = "risk-state";
    workspaceRiskBar.style.width = "18%";
    workspaceRiskCopy.textContent = "Risk context will appear as strategies are reviewed.";
    return;
  }
  const blocked = risk.decision === "BLOCK";
  workspaceRiskState.textContent = blocked ? "BLOCKED" : "PASS";
  workspaceRiskState.className = blocked ? "risk-state blocked" : "risk-state";
  workspaceRiskBar.style.width = blocked ? "82%" : "28%";
  workspaceRiskCopy.textContent = blocked ? risk.reasons?.[0] || "Portfolio risk controls blocked this action." : "Portfolio risk checks passed for the reviewed action.";
}

function renderWorkspaceStrategies(strategies = [], attribution = []) {
  if (!workspaceStrategies) return;
  if (!Array.isArray(strategies) || !strategies.length) {
    workspaceStrategies.innerHTML = '<div class="workspace-empty">No active strategies yet. Draft strategies can be reviewed and activated from Chat.</div>';
    return;
  }
  const byId = new Map((Array.isArray(attribution) ? attribution : []).map(item => [item.strategyId, item]));
  workspaceStrategies.innerHTML = strategies.map(strategy => {
    const stats = byId.get(strategy.id);
    const runs = stats ? String(stats.finishedCount) + "/" + String(stats.executionCount) + " runs finished" : "No recorded runs";
    const planned = stats?.successfulPlannedUsd == null ? "" : " · " + money(stats.successfulPlannedUsd) + " attributed";
    return '<div class="workspace-position workspace-strategy"><span><strong>' +
      escapeHtml(strategy.type || "STRATEGY") + '</strong><small>' +
      escapeHtml(strategy.asset || "—") + ' · ' +
      escapeHtml(strategy.frequency || strategy.condition || "Rule-based") +
      '</small><small>' + escapeHtml(runs + planned) + '</small></span><b>ACTIVE</b></div>';
  }).join("");
}


function addPortfolioPreview(portfolio) {
  if (!portfolio || !Array.isArray(portfolio.positions)) return;
  const node = document.createElement("article");
  node.className = "strategy-preview portfolio-preview";
  node.setAttribute("role", "status");
  const positions = portfolio.positions.slice(0, 6);
  node.innerHTML = `<div class="strategy-preview-head"><div><div class="message-label">PORTFOLIO PREVIEW</div><h3>${escapeHtml(portfolio.wallet || "Connected wallet")}</h3></div><span class="strategy-draft">LIVE CONTEXT</span></div><div class="strategy-preview-grid"><div><small>TOTAL VALUE</small><strong>${money(portfolio.totalValueUsd ?? portfolio.balanceUsd)}</strong></div><div><small>POSITIONS</small><strong>${positions.length}</strong></div></div><div class="strategy-preview-grid">${positions.map(position => `<div><small>${escapeHtml(position.tokenSymbol || position.asset || "Asset")}</small><strong>${position.allocationPercent == null ? "—" : Number(position.allocationPercent).toFixed(1) + "%"}</strong></div>`).join("")}</div></div>`;
  conversation.appendChild(node);
  scrollConversation();
}

function renderWorkspaceError(element, message) {
  if (!element) return;
  element.innerHTML = `<div class="workspace-empty workspace-error" role="status">${escapeHtml(message)}</div>`;
}

function renderWorkspaceMarket(market) {
  if (!workspaceMarket) return;
  const gap = market.premiumPct;
  const gapText = gap === null ? "—" : (gap >= 0 ? "+" : "") + gap.toFixed(2) + "%";
  workspaceMarketStatus.textContent = market.marketOpen ? "LIVE" : "CLOSED";
  workspaceMarketStatus.className = market.marketOpen ? "market-live" : "market-closed";
  const tokenPrice = Number(market.tokenPrice);
  const referencePrice = Number(market.referencePrice);
  const hasComparison = Number.isFinite(tokenPrice) && Number.isFinite(referencePrice) && referencePrice > 0;
  const scale = hasComparison ? Math.max(tokenPrice, referencePrice) : 0;
  const referenceWidth = hasComparison ? Math.max((referencePrice / scale) * 100, 4) : 0;
  const tokenWidth = hasComparison ? Math.max((tokenPrice / scale) * 100, 4) : 0;
  workspaceMarket.innerHTML = `<div class="workspace-ticker"><strong>${escapeHtml(market.ticker)}</strong><span>${escapeHtml(market.tokenSymbol)}</span></div><div class="workspace-price">${money(market.tokenPrice)}</div><div class="workspace-price-compare" aria-label="Current on-chain versus reference price comparison"><div class="workspace-price-row"><span>REFERENCE</span><div class="workspace-price-track"><i style="width:${referenceWidth}%"></i></div><b>${money(market.referencePrice)}</b></div><div class="workspace-price-row"><span>ON-CHAIN</span><div class="workspace-price-track"><i style="width:${tokenWidth}%"></i></div><b>${money(market.tokenPrice)}</b></div></div><div class="workspace-market-grid"><div><small>GAP</small><b class="${gap === null ? "" : gap >= 0 ? "positive" : "negative"}">${gapText}</b></div><div><small>STATUS</small><b>${escapeHtml(market.marketStatus || "—")}</b></div><div><small>PROVIDER</small><b>${escapeHtml(market.provider || "BSC")}</b></div><div><small>REPRESENTATION</small><b>${escapeHtml(market.tokenSymbol || "—")}</b></div></div><div class="context-schedule"><span>${market.marketOpen ? "NEXT CLOSE" : "NEXT OPEN"}</span><strong>${escapeHtml(marketSchedule(market))}</strong></div>${market.marketStatusReason ? `<div class="context-reason">${escapeHtml(market.marketStatusReason)}</div>` : ""}`;
}

function renderWorkspaceGapRadar(markets, representations = []) {
  if (!workspaceGapRadar) return;
  const marketRows = Array.isArray(markets) ? markets.slice(0, 5).map((market) => {
    const gap = Number(market.divergencePercent);
    const gapText = Number.isFinite(gap) ? (gap >= 0 ? "+" : "") + gap.toFixed(2) + "%" : "—";
    const gapClass = gap > 0 ? "positive" : gap < 0 ? "negative" : "";
    const label = (market.underlyingTicker || "—") + " " + (market.tokenSymbol || "—") + " gap " + gapText;
    const status = market.marketStatus || "UNKNOWN";
    const volume = market.liquidityContext || "Liquidity context unavailable";
    const schedule = marketSchedule(normalizeMarketRecord(market));
    const reason = market.marketStatusReason || "";
    return '<div class="workspace-gap-row" role="group" aria-label="' + escapeHtml(label + " status " + status) + '"><span><strong>' + escapeHtml(market.underlyingTicker || "—") + '</strong><small>' + escapeHtml(market.tokenSymbol || "—") + " · " + escapeHtml(market.provider || "BSC") + " · " + escapeHtml(status) + '</small><small>' + escapeHtml(schedule) + '</small><small>' + escapeHtml(volume) + (reason ? " · " + escapeHtml(reason) : "") + '</small></span><b class="' + gapClass + '">' + gapText + '</b></div>';
  }).join("") : "";

  const comparisonRows = Array.isArray(representations) ? representations.slice(0, 3).map((comparison) => {
    const spread = Number(comparison.spreadPercent);
    const spreadText = Number.isFinite(spread) ? spread.toFixed(2) + "%" : "—";
    const lowest = comparison.lowestPriceToken || "—";
    const highest = comparison.highestPriceToken || "—";
    const label = (comparison.underlyingTicker || "—") + " cross-representation spread " + spreadText;
    return '<div class="workspace-gap-row" role="group" aria-label="' + escapeHtml(label) + '"><span><strong>' + escapeHtml(comparison.underlyingTicker || "—") + '</strong><small>LOWEST ' + escapeHtml(lowest) + ' · HIGHEST ' + escapeHtml(highest) + '</small><small>CROSS-REPRESENTATION SPREAD</small></span><b>' + escapeHtml(spreadText) + '</b></div>';
  }).join("") : "";

  const comparisonHeader = comparisonRows
    ? '<div class="workspace-gap-section-label">CROSS-REPRESENTATION</div>' + comparisonRows
    : "";
  const empty = !marketRows && !comparisonRows
    ? '<div class="workspace-empty">No measurable gaps available.</div>'
    : "";

  workspaceGapRadar.innerHTML = marketRows + comparisonHeader + empty;
  workspaceGapRadar.setAttribute("aria-busy", "false");
}

async function refreshWorkspaceContext() {
  renderWorkspaceStrategies();
  [workspaceMarket, workspaceGapRadar, workspacePortfolio, workspaceActivity].forEach((element) => {
    element?.setAttribute("aria-busy", "true");
  });
  try {
    const marketsResponse = await fetch(API_BASE + "/api/markets", {cache:"no-store"});
    const markets = await marketsResponse.json();
    if (marketsResponse.ok && Array.isArray(markets) && markets.length) { renderWorkspaceMarket(normalizeMarketRecord(markets[0])); workspaceMarket?.setAttribute("aria-busy", "false"); }
    else { renderWorkspaceError(workspaceMarket, "Market data is unavailable right now."); workspaceMarket?.setAttribute("aria-busy", "false"); }
  } catch {
    renderWorkspaceError(workspaceMarket, "Could not reach market data. Try again.");
  }
  try {
    const gapResponse = await fetch(API_BASE + "/api/gap-radar?limit=5", {cache:"no-store"});
    const gapData = await gapResponse.json();
    if (gapResponse.ok && Array.isArray(gapData.markets)) {
      renderWorkspaceGapRadar(gapData.markets, gapData.representations);
      if (workspaceGapRadarStatus) workspaceGapRadarStatus.textContent = "LIVE";
    } else {
      if (workspaceGapRadarStatus) workspaceGapRadarStatus.textContent = "UNAVAILABLE";
      renderWorkspaceError(workspaceGapRadar, "No live gap data is available right now.");
    }
  } catch {
    if (workspaceGapRadarStatus) workspaceGapRadarStatus.textContent = "UNAVAILABLE";
    renderWorkspaceError(workspaceGapRadar, "Could not reach the Gap Radar service.");
  }
  try {
    const addressResponse = await fetch(API_BASE + "/api/wallet/address", {cache:"no-store"});
    const address = await addressResponse.json();
    if (!address.connected || !address.address) {
      workspaceWalletAddressValue = "";
      if (workspaceWalletBalance) workspaceWalletBalance.textContent = "—";
      if (workspaceWalletAddress) workspaceWalletAddress.textContent = "WALLET NOT CONNECTED";
      return;
    }
    workspaceWalletAddressValue = address.address;
    if (workspaceWalletAddress) workspaceWalletAddress.textContent = address.address.slice(0,6) + "…" + address.address.slice(-4);
    const strategiesResponse = await fetch(API_BASE + "/api/strategies?wallet=" + encodeURIComponent(address.address), {cache:"no-store"});
    const strategiesData = await strategiesResponse.json();
    const attributionResponse = await fetch(API_BASE + "/api/strategies/attribution?wallet=" + encodeURIComponent(address.address), {cache:"no-store"});
    const attributionData = await attributionResponse.json();
    if (strategiesResponse.ok) renderWorkspaceStrategies(strategiesData.strategies || [], attributionResponse.ok ? attributionData.attribution || [] : []);
    else renderWorkspaceStrategies([]);
    const portfolioResponse = await fetch(API_BASE + "/api/portfolio?wallet=" + encodeURIComponent(address.address), {cache:"no-store"});
    const portfolio = await portfolioResponse.json();
    if (workspaceWalletBalance) workspaceWalletBalance.textContent = money(portfolio?.totalValueUsd ?? portfolio?.balanceUsd);
    if (workspacePortfolio && Array.isArray(portfolio?.positions)) {
      const reconciliation = portfolio?.source === "BSC_TOKEN_BALANCES"
        ? "LIVE BSC SNAPSHOT · " + (formatMarketTime(portfolio?.asOf) === "—" ? "time unavailable" : formatMarketTime(portfolio?.asOf))
        : "PORTFOLIO";
      workspacePortfolio.innerHTML = '<div class="workspace-gap-section-label">' + escapeHtml(reconciliation) + '</div>' +
        (portfolio.positions.slice(0,4).map(position => `<div class="workspace-position"><span>${escapeHtml(position.tokenSymbol || position.asset)}</span><b>${position.allocationPercent == null ? "—" : position.allocationPercent.toFixed(1) + "%"}</b></div>`).join("") || '<div class="workspace-empty">No positions yet.</div>');
    }
    const historyResponse = await fetch(API_BASE + "/api/history?wallet=" + encodeURIComponent(address.address), {cache:"no-store"});
    const history = await historyResponse.json();
    if (workspaceActivity && Array.isArray(history?.transactions)) workspaceActivity.innerHTML = history.transactions.slice(0,3).map(tx => {
      const hash = String(tx.txHash || "");
      const time = tx.txTime ? new Date(tx.txTime).toLocaleString() : "Time unavailable";
      const hashLabel = hash ? hash.slice(0, 6) + "…" + hash.slice(-4) : "No hash";
      const link = /^0x[a-fA-F0-9]{64}$/.test(hash)
        ? '<a href="https://bscscan.com/tx/' + encodeURIComponent(hash) + '" target="_blank" rel="noopener noreferrer">' + hashLabel + '</a>'
        : '<span>' + escapeHtml(hashLabel) + '</span>';
      return '<div class="workspace-activity"><span><strong>' + escapeHtml(tx.symbol || "BSC transaction") + '</strong><small>' + escapeHtml(time) + '</small></span><b>' + escapeHtml(tx.txStatus || "UNKNOWN") + '</b><small>' + link + '</small></div>';
    }).join("") || '<div class="workspace-empty">No recent activity.</div>';
  } catch {
    renderWorkspaceError(workspacePortfolio, "Portfolio data is unavailable. Try refreshing.");
    renderWorkspaceError(workspaceActivity, "Activity data is unavailable. Try refreshing.");
  } finally {
    [workspaceMarket, workspaceGapRadar, workspacePortfolio, workspaceActivity].forEach((element) => {
      element?.setAttribute("aria-busy", "false");
    });
  }
}


function money(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n)
    : "—";
}

function addUserMessage(message) {
  if (welcome) welcome.remove();
  const node = document.createElement("article");
  node.className = "message user-message";
  node.innerHTML = '<div class="message-label">YOU</div><div class="message-text"></div>';
  node.querySelector(".message-text").textContent = message;
  conversation.appendChild(node);
  scrollConversation();
}

function userFacingError(error, fallback) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Handelo could not reach the service. Please check that the API is running and try again.";
  }
  if (/spawn baw|enoent/i.test(message)) {
    return "The Binance Agentic Wallet service is unavailable. Please make sure the wallet CLI is installed and try again.";
  }
  return message || fallback;
}

function addAgentError(message) {
  const node = document.createElement("article");
  node.className = "message agent-message error-message";
  node.setAttribute("role", "alert");
  node.innerHTML = '<div class="message-label">HANDELO / ERROR</div><div class="message-text"></div>';
  node.querySelector(".message-text").textContent = message;
  conversation.appendChild(node);
  scrollConversation();
}

function formatAgentText(value) {
  const lines = String(value ?? "").split(/\r?\n/);
  const html = [];
  let listType = null;
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = null; } };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { closeList(); html.push("<br>"); continue; }
    const escaped = escapeHtml(trimmed).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    const ordered = /^(\d+)\.\s+(.+)$/.exec(trimmed);
    if (unordered) {
      if (listType !== "ul") { closeList(); html.push("<ul>"); listType = "ul"; }
      html.push(`<li>${escapeHtml(unordered[1]).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`);
    } else if (ordered) {
      if (listType !== "ol") { closeList(); html.push("<ol>"); listType = "ol"; }
      html.push(`<li>${escapeHtml(ordered[2]).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</li>`);
    } else {
      closeList();
      html.push(`<p>${escaped}</p>`);
    }
  }
  closeList();
  return html.join("");
}

function addAgentMessage(data) {
  const node = document.createElement("article");
  node.className = "message agent-message";
  node.innerHTML = '<div class="message-label">HANDELO</div><div class="message-text"></div><div class="market-context"></div>';
  node.querySelector(".message-text").innerHTML = formatAgentText(data.answer || "I could not generate an explanation.");
  const context = node.querySelector(".market-context");

  if (data.strategy) addStrategyPreview(data.strategy);
  if (data.basket) addBasketPreview(data.basket);
  if (data.portfolio) addPortfolioPreview(data.portfolio);
  if (data.policy && data.intent?.action !== "research") addRiskPreview(data.policy);

  if (data.market) {
    context.classList.add("visible");
    renderMarketContext(context, normalizeMarketRecord(data.market));
  } else if (Array.isArray(data.candidates) && data.candidates.length) {
    context.classList.add("visible");
    renderCandidates(context, data.candidates.map(normalizeMarketRecord), data.intent);
  }

  conversation.appendChild(node);

  const action = data.intent?.action;
  const amount = Number(data.intent?.amountUsd);
  if (
    data.market &&
    (action === "buy" || action === "invest") &&
    Number.isFinite(amount) &&
    amount > 0 &&
    data.policy?.decision !== "BLOCK"
  ) {
    addReviewPrompt(data.market, amount, action);
  }

  scrollConversation();
}

function addRiskPreview(policy) {
  if (!policy) return;
  const node = document.createElement("article");
  node.className = "strategy-risk-result chat-risk-result " + String(policy.decision || "BLOCK").toLowerCase();
  node.setAttribute("role", "status");
  const reason = Array.isArray(policy.reasons) && policy.reasons.length
    ? policy.reasons.join(" ")
    : "No additional risk explanation was supplied.";
  node.innerHTML = `<span>RISK RESULT · ${escapeHtml(policy.decision || "BLOCK")}</span><strong>${escapeHtml(reason)}</strong>`;
  conversation.appendChild(node);
  scrollConversation();
}

function addBasketPreview(basket) {
  const node = document.createElement("article");
  node.className = "strategy-preview basket-preview";
  node.setAttribute("role", "status");
  node.innerHTML = `<div class="strategy-preview-head"><div><div class="message-label">BASKET PREVIEW</div><h3>${escapeHtml(basket.name || "Custom basket")}</h3></div><span class="strategy-draft">DRAFT</span></div><div class="strategy-preview-grid">${(basket.assets || []).map(asset => `<div><small>${escapeHtml(asset.asset)}</small><strong>${Number(asset.weightPercent).toFixed(2)}%</strong></div>`).join("")}</div><div class="strategy-preview-note">REBALANCE strategy · draft only · no orders created.</div>`;
  conversation.appendChild(node);
  scrollConversation();
}

async function activateStrategy(strategy, node, button) {
  button.disabled = true;
  button.textContent = "Activating";
  try {
    const response = await fetch(API_BASE + "/api/strategies/activate", {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({wallet: workspaceWalletAddressValue, strategy})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Strategy activation failed.");
    button.textContent = "ACTIVE";
    const note = node.querySelector("[data-strategy-note]");
    if (note) note.textContent = "Active strategy stored. No transaction or schedule was created automatically.";
    await refreshWorkspaceContext();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Review & Activate";
    const note = node.querySelector("[data-strategy-note]");
    if (note) note.textContent = userFacingError(error, "Activation failed. The strategy remains a draft.");
  }
}

function addStrategyPreview(strategy) {
  const node = document.createElement("article");
  node.className = "strategy-preview";
  const amount = Number(strategy.amountUsd);
  const amountText = Number.isFinite(amount) ? money(amount) : "—";
  node.innerHTML = `<div class="strategy-preview-head"><div><div class="message-label">STRATEGY PREVIEW</div><h3>${escapeHtml(strategy.type || "STRATEGY")}</h3></div><span class="strategy-draft">DRAFT</span></div><div class="strategy-preview-grid"><div><small>ASSET</small><strong>${escapeHtml(strategy.asset || "—")}</strong></div><div><small>AMOUNT</small><strong>${amountText}</strong></div><div><small>FREQUENCY</small><strong>${escapeHtml(strategy.frequency || "—")}</strong></div><div><small>STATUS</small><strong>${escapeHtml(strategy.status || "DRAFT")}</strong></div></div><div class="strategy-preview-checks"><div>✓ Strategy inputs validated</div><div>• Portfolio risk review required before activation</div></div><div class="strategy-risk-result" data-strategy-risk><span>PORTFOLIO RISK</span><strong>Connect a wallet to check projected exposure.</strong></div><div class="strategy-preview-actions"><button type="button" class="primary-button" data-activate disabled>Review &amp; Activate</button></div><div class="strategy-preview-note" data-strategy-note>Draft only. No schedule or transaction has been created.</div>`;
  conversation.appendChild(node);
  const button = node.querySelector("[data-activate]");
  const normalizedWallet = workspaceWalletAddressValue;
  if (strategy.type === "REBALANCE" && strategy.targetAllocation && normalizedWallet) {
    fetch(API_BASE + "/api/portfolio/rebalance-preview", {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({wallet: normalizedWallet, targetAllocation: strategy.targetAllocation})
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Rebalance preview failed.");
      const actions = data?.preview?.actions || [];
      const summary = actions.filter(action => action.direction !== "HOLD")
        .map(action => action.direction + " " + action.asset + " " + action.amountUsd.toFixed(2) + " USD")
        .join(" · ");
      const target = node.querySelector("[data-strategy-risk]");
      if (target) {
        target.className = "strategy-risk-result pass";
        target.innerHTML = '<span>REBALANCE PREVIEW · LIVE PORTFOLIO</span><strong>' +
          escapeHtml(summary || "Portfolio already matches the target allocation.") + '</strong>';
      }
    }).catch(() => {
      const target = node.querySelector("[data-strategy-risk]");
      if (target) target.innerHTML = "<span>REBALANCE PREVIEW</span><strong>Preview unavailable; no rebalance has been scheduled.</strong>";
    });
  }

  if (normalizedWallet && Number.isFinite(amount) && amount > 0) {
    fetch(API_BASE + "/api/strategy/risk", {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({wallet: normalizedWallet, asset: strategy.asset, amountUsd: amount})
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Risk review failed.");
      const result = data.risk || {};
      const target = node.querySelector("[data-strategy-risk]");
      if (!target) return;
      target.className = "strategy-risk-result " + String(result.decision || "BLOCK").toLowerCase();
      target.innerHTML = `<span>PORTFOLIO RISK · ${escapeHtml(result.decision || "BLOCK")}</span><strong>${escapeHtml((result.reasons || ["Projected exposure is within configured constraints."]).join(" "))}</strong>`;
      if (result.decision === "PASS" && workspaceWalletAddressValue) {
        button.disabled = false;
        button.addEventListener("click", () => activateStrategy(strategy, node, button), {once:true});
      }
    }).catch(() => {
      const target = node.querySelector("[data-strategy-risk]");
      if (target) target.innerHTML = "<span>PORTFOLIO RISK</span><strong>Risk check unavailable; activation remains blocked until it passes.</strong>";
    });
  }
  scrollConversation();
}


function addReviewPrompt(market, amountUsd, action) {
  const node = document.createElement("article");
  node.className = "review-prompt";
  node.innerHTML = `
    <div class="review-copy">
      <div class="message-label">NEXT STEP</div>
      <strong>Review a ${action === "invest" ? "purchase" : "buy"} of ${escapeHtml(market.ticker)}.</strong>
      <span>${money(amountUsd)} · policy checks will run before any transaction.</span>
    </div>
    <button type="button">Review</button>`;
  node.querySelector("button").addEventListener("click", () => reviewTrade(market.ticker, amountUsd, action, node));
  conversation.appendChild(node);
}

async function reviewTrade(ticker, amountUsd, action, promptNode) {
  const requestId = Symbol("trade-review");
  tradeReviewRequestIds.set(promptNode, requestId);
  const button = promptNode.querySelector("button");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-label", "Checking transaction review");
  button.textContent = "Checking";

  try {
    const response = await fetch(API_BASE + "/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker, amountUsd, action, wallet: workspaceWalletAddressValue })
    });
    const data = await response.json();
    if (tradeReviewRequestIds.get(promptNode) !== requestId) return;
    if (!response.ok) throw new Error((data && typeof data === "object" && data.error) || "Review failed.");
    promptNode.remove();
    addReviewCard(data, amountUsd);
  } catch (error) {
    if (tradeReviewRequestIds.get(promptNode) !== requestId) return;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.removeAttribute("aria-label");
    button.textContent = "Review";
    addAgentError(userFacingError(error, "I could not complete the transaction review. Please try again."));
  }
}

function addReviewCard(data, amountUsd) {
  const card = document.createElement("article");
  card.className = "trade-review";
  const policy = data.policy || {};
  const market = data.asset || {};
  const quote = data.quote;
  const security = data.securityAudit || null;
  const portfolioRisk = data.portfolioRisk || null;
  const securityBlocked = data.executionBlocked === true;
  const securityLabel = securityBlocked && data.securityAuditError
    ? "SECURITY CHECK UNAVAILABLE — EXECUTION BLOCKED"
    : securityBlocked
      ? "EXECUTION BLOCKED"
      : security?.riskLevelEnum
        ? `SECURITY ${security.riskLevelEnum}`
        : "SECURITY CHECKED";
  const decision = policy.decision || "BLOCK";
  const decisionLabel = decision === "READY" ? "READY FOR CONFIRMATION" : decision === "CONFIRM" ? "CONFIRM REQUIRED" : "BLOCKED";
  const riskBlocked = data.riskDecision !== "PASS";
  const canConfirm = decision !== "BLOCK" && !riskBlocked && !securityBlocked && Boolean(data.reviewToken && quote);
  const quoteLine = quote
    ? `${escapeHtml(quote.fromCoinSymbol)} ${escapeHtml(quote.fromCoinAmount)} → ${escapeHtml(quote.toCoinAmount)} ${escapeHtml(quote.toCoinSymbol)}`
    : "Live quote unavailable until the Agentic Wallet is connected.";

  card.innerHTML = `
    <div class="review-head">
      <div>
        <div class="message-label">TRANSACTION PREVIEW</div>
        <h3>BUY ${escapeHtml(market.tokenSymbol || market.ticker || "asset")}</h3>
      </div>
      <span class="review-status ${decision.toLowerCase()}">${decisionLabel}</span>
    </div>
    <div class="review-amount">${money(amountUsd)}<span>requested · BSC</span></div>
    <div class="review-grid">
      <div><small>ON-CHAIN</small><strong>${money(market.tokenPrice)}</strong></div>
      <div><small>REFERENCE</small><strong>${money(market.referencePrice)}</strong></div>
      <div><small>DIFFERENCE</small><strong>${market.premiumPct === null ? "—" : (market.premiumPct >= 0 ? "+" : "") + market.premiumPct.toFixed(2) + "%"}</strong></div>
      <div><small>MARKET</small><strong>${market.market?.openState ? "LIVE" : "CLOSED"}</strong></div>
    </div>
    <div class="review-quote">
      <span>EXPECTED ROUTE</span>
      <strong>${quoteLine}</strong>
    </div>
    <div class="review-quote">
      <span>SECURITY</span>
      <strong>${escapeHtml(securityLabel)}${security?.riskLevel !== undefined ? ` · LEVEL ${escapeHtml(security.riskLevel)}` : ""}</strong>
    </div>
    <div class="review-checks">
      <div class="review-checks-head"><span>POLICY CHECKS</span><span>${(policy.checks || []).filter(check => check.passed).length}/${(policy.checks || []).length} passed</span></div>
      <div class="review-check-list">
        ${(policy.checks || []).map(check => `<div class="review-check ${check.passed ? "passed" : "warning"}"><span>${check.passed ? "✓" : "!"}</span><div><strong>${escapeHtml(check.name.replaceAll("_", " ").toUpperCase())}</strong><small>${escapeHtml(check.detail)}</small></div></div>`).join("")}
      </div>
    </div>
    <div class="review-reasons">
      ${(policy.reasons || []).map(reason => `<div>• ${escapeHtml(reason)}</div>`).join("")}
      ${data.securityAuditError ? `<div class="review-warning">• ${escapeHtml(data.securityAuditError)}</div>` : ""}
      ${security?.riskLevel !== undefined && security.riskLevel >= 4 ? `<div class="review-warning">• Binance security audit reports high risk. Execution is blocked.</div>` : ""}
      ${data.quoteError ? `<div class="review-warning">• ${escapeHtml(data.quoteError)}</div>` : ""}
    </div>
    <div class="review-actions">
      <button type="button" class="secondary-button" data-cancel>Cancel</button>
      <button type="button" class="primary-button" data-confirm ${canConfirm ? "" : "disabled"}>${canConfirm ? "Confirm purchase" : "Execution blocked"}</button>
    </div>`;

  renderWorkspaceRisk(data.portfolioRisk);
  card.querySelector("[data-cancel]").addEventListener("click", () => card.remove());
  card.querySelector("[data-confirm]").addEventListener("click", () => confirmTrade(data, amountUsd, card));
  conversation.appendChild(card);
  scrollConversation();
}

async function confirmTrade(data, amountUsd, card) {
  const requestId = Symbol("execution");
  executionRequestIds.set(card, requestId);
  const button = card.querySelector("[data-confirm]");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.setAttribute("aria-label", "Executing purchase");
  button.textContent = "Executing";

  try {
    const response = await fetch(API_BASE + "/api/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticker: data.asset.ticker,
        amountUsd,
        fromToken: data.quoteToken,
        reviewToken: data.reviewToken,
        wallet: workspaceWalletAddressValue,
        confirmed: true
      })
    });
    const result = await response.json();
    if (executionRequestIds.get(card) !== requestId) return;
    if (!response.ok) throw new Error((result && typeof result === "object" && result.error) || "Execution failed.");
    card.remove();
    addExecutionResult(result);
  } catch (error) {
    if (executionRequestIds.get(card) !== requestId) return;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.removeAttribute("aria-label");
    button.textContent = "Confirm purchase";
    addAgentError(userFacingError(error, "The transaction was not completed. Please try again."));
  }
}

function addExecutionResult(data) {
  const result = data.result || {};
  const node = document.createElement("article");
  node.className = "execution-result";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  const ticker = escapeHtml(data.asset?.ticker || "Asset");
  const orderId = escapeHtml(result.orderId || "—");
  const receivedAmount = result.toCoinAmount ? escapeHtml(result.toCoinAmount) : null;

  if (result.status === "FINISHED") {
    const txHash = String(result.txHash || "");
    const validTxHash = /^0x[a-fA-F0-9]{64}$/.test(txHash);
    const txLink = validTxHash
      ? '<a class="tx-hash" href="https://bscscan.com/tx/' + encodeURIComponent(txHash) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(txHash.slice(0, 10) + "…" + txHash.slice(-8)) + " ↗</a>"
      : '<span class="tx-hash">Transaction hash unavailable</span>';
    node.innerHTML = `
      <div class="execution-icon">✓</div>
      <div>
        <div class="message-label">EXECUTION CONFIRMED</div>
        <h3>Purchase complete.</h3>
        <p>${ticker} was purchased through the Agentic Wallet.</p>
        ${receivedAmount ? `<div class="execution-meta"><span>RECEIVED</span><strong>${receivedAmount} ${escapeHtml(result.toCoinSymbol || data.asset?.tokenSymbol || "")}</strong></div>` : ""}
        <div class="execution-meta"><span>ORDER</span><strong>${orderId}</strong></div>
        ${txLink}
        <div class="execution-actions">
          <button type="button" class="primary-button" data-refresh-portfolio>Refresh portfolio</button>
          <button type="button" class="secondary-button" data-view-history>View history</button>
        </div>
      </div>`;
  } else if (result.status === "PENDING") {
    node.innerHTML = `
      <div class="execution-icon pending">·</div>
      <div>
        <div class="message-label">EXECUTION PENDING</div>
        <h3>Still processing.</h3>
        <p>The order was submitted, but Handelo has not received a terminal result yet.</p>
        <div class="execution-meta"><span>ORDER</span><strong>${orderId}</strong></div>
        <div class="execution-actions">
          <button type="button" class="secondary-button" data-view-history>View history</button>
        </div>
      </div>`;
  } else {
    node.innerHTML = `
      <div class="execution-icon failed">!</div>
      <div>
        <div class="message-label">EXECUTION FAILED</div>
        <h3>The purchase did not complete.</h3>
        <p>Handelo received a terminal failure from the execution layer.</p>
        <div class="execution-meta"><span>ORDER</span><strong>${orderId}</strong></div>
        <div class="execution-actions">
          <button type="button" class="secondary-button" data-view-history>View history</button>
        </div>
      </div>`;
  }
  conversation.appendChild(node);
  node.querySelector("[data-refresh-portfolio]")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("data-navigation-busy", "true");
    button.setAttribute("aria-disabled", "true");
    button.textContent = "Refreshing…";
    button.setAttribute("aria-label", "Refreshing portfolio");
    refreshWorkspaceContext();
  });
  node.querySelector("[data-view-history]")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-disabled", "true");
    button.textContent = "Opening…";
    button.setAttribute("aria-label", "Opening transaction history");
    button.setAttribute("data-navigation-disabled", "true");
    button.setAttribute("data-navigation-busy", "true");
    refreshWorkspaceContext();
  });
  scrollConversation();
}

function renderMarketContext(container, market) {
  const gap = market.premiumPct;
  const gapText = gap === null ? "—" : (gap >= 0 ? "+" : "") + gap.toFixed(2) + "%";
  const status = market.marketOpen ? "LIVE" : "CLOSED";
  container.innerHTML = `
    <div class="context-head">
      <div><div class="context-kicker">MARKET INSIGHT</div><div class="context-name">${escapeHtml(market.ticker)} <span style="color:#5d5a53">/ ${escapeHtml(market.tokenSymbol)}</span></div></div>
      <div class="context-status ${market.marketOpen ? "" : "closed"}">${status} · ${escapeHtml(market.provider || "BSC")}</div>
    </div>
    <div class="context-body">
      <div class="context-price"><strong>${money(market.tokenPrice)}</strong><span>ON-CHAIN PRICE</span></div>
      <div class="context-grid">
        <div class="metric"><div class="metric-label">Reference</div><div class="metric-value">${money(market.referencePrice)}</div></div>
        <div class="metric"><div class="metric-label">Difference</div><div class="metric-value ${gap === null ? "" : gap >= 0 ? "positive" : "negative"}">${gapText}</div></div>
        <div class="metric"><div class="metric-label">Market</div><div class="metric-value">${escapeHtml(market.marketStatus || "—")}</div></div>
        <div class="metric"><div class="metric-label">Provider</div><div class="metric-value">${escapeHtml(market.provider || "—")}</div></div>
      </div>
      <div class="context-schedule"><span>${market.marketOpen ? "NEXT CLOSE" : "NEXT OPEN"}</span><strong>${escapeHtml(marketSchedule(market))}</strong></div>
      ${market.reason ? `<div class="context-reason">${escapeHtml(market.reason)}</div>` : ""}
    </div>`;
}

function renderCandidates(container, candidates, intent) {
  const action = intent?.action === "sell" ? "sell" : intent?.action === "invest" ? "invest" : intent?.action === "buy" ? "buy" : "research";
  const amount = Number(intent?.amountUsd);
  const canSelect = ["buy", "invest", "sell"].includes(action);
  container.innerHTML = `
    <div class="context-head">
      <div class="context-name">LIVE MARKET CONTEXT</div>
      <div class="context-status">BSC</div>
    </div>
    <div class="candidate-list">
      ${candidates.map((market, index) => `
        <div class="candidate">
          <div><strong>${escapeHtml(market.ticker)}</strong><small>${escapeHtml(market.tokenSymbol)} · ${escapeHtml(market.provider || "BSC")}</small></div>
          <div class="candidate-price"><strong>${money(market.tokenPrice)}</strong><small>${market.marketOpen ? "LIVE" : "CLOSED"}</small></div>
          ${canSelect ? `<button type="button" class="candidate-select" data-candidate="${index}">Use ${escapeHtml(market.tokenSymbol)} ↗</button>` : ""}
        </div>`).join("")}
    </div>`;
  if (canSelect) {
    container.querySelectorAll("[data-candidate]").forEach((button) => {
      button.addEventListener("click", () => {
        const market = candidates[Number(button.dataset.candidate)];
        if (!market) return;
        if (action === "buy" || action === "invest") {
          if (Number.isFinite(amount) && amount > 0) {
            const prompt = document.createElement("article");
            prompt.className = "review-prompt";
            prompt.innerHTML = `
              <div class="review-copy">
                <div class="message-label">SELECTED REPRESENTATION</div>
                <strong>Review a ${action === "invest" ? "purchase" : "buy"} of ${escapeHtml(market.tokenSymbol)}.</strong>
                <span>${money(amount)} · ${escapeHtml(market.provider || "BSC")} · policy checks will run before any transaction.</span>
              </div>
              <button type="button">Review</button>`;
            prompt.querySelector("button").addEventListener("click", () => reviewTrade(market.tokenSymbol, amount, action, prompt));
            container.closest(".message")?.after(prompt);
            scrollConversation();
            return;
          }
        }
        ask(action === "research" ? `research ${market.tokenSymbol}` : `${action} ${market.tokenSymbol}`);
      });
    });
  }
}

function formatMarketTime(value) {
  const numericTimestamp = Number(value);
  const timestamp = Number.isFinite(numericTimestamp) && numericTimestamp > 0
    ? numericTimestamp
    : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function marketSchedule(market) {
  const nextOpen = formatMarketTime(market.nextOpenTime);
  const nextClose = formatMarketTime(market.nextCloseTime);
  if (market.marketOpen) return nextClose !== "—" ? "Closes " + nextClose : "Market currently open";
  return nextOpen !== "—" ? "Next open " + nextOpen : "Market currently closed";
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "#";
  } catch {
    return "#";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[char]));
}

function scrollConversation() {
  requestAnimationFrame(() => conversation.scrollTo({ top: conversation.scrollHeight, behavior: "smooth" }));
}

async function ask(message) {
  const requestId = ++chatRequestId;
  const clean = message.trim();
  if (!clean) return;
  addUserMessage(clean);
  input.value = "";
  sendButton.disabled = true;
  sendButton.setAttribute("aria-busy", "true");
  input.disabled = true;

  const thinking = document.createElement("article");
  thinking.className = "message agent-message";
  thinking.setAttribute("aria-live", "polite");
  thinking.innerHTML = '<div class="message-label">HANDELO</div><div class="message-text">Reading the market<span class="thinking-dots"> ···</span></div>';
  conversation.appendChild(thinking);
  scrollConversation();

  try {
    const response = await fetch(API_BASE + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: clean })
    });
    const data = await response.json();
    if (requestId !== chatRequestId) {
      thinking.remove();
      return;
    }
    thinking.remove();
    if (!response.ok) throw new Error((data && typeof data === "object" && data.error) || "Handelo API request failed.");
    if (!data || typeof data !== "object" || typeof data.answer !== "string") throw new Error("Handelo response was invalid.");
    addAgentMessage(data);
  } catch (error) {
    if (requestId !== chatRequestId) {
      thinking.remove();
      return;
    }
    thinking.remove();
    addAgentError(userFacingError(error, "I could not reach the Handelo agent. Please try again."));
  } finally {
    if (requestId !== chatRequestId) return;
    sendButton.disabled = false;
    sendButton.setAttribute("aria-busy", "false");
    input.disabled = false;
    input.focus();
  }
}

async function refreshWalletStatus() {
  const requestId = Symbol("wallet-status");
  walletStatusRequestIds.set(connectButton, requestId);
  try {
    const response = await fetch(API_BASE + "/api/wallet/status", { cache: "no-store" });
    const data = await response.json();
    if (walletStatusRequestIds.get(connectButton) !== requestId) return;
    if (!data || typeof data !== "object" || typeof data.status !== "string") throw new Error("Wallet status response was invalid.");
    const connected = data.status === "CONNECTED";
    walletState.textContent = connected ? "WALLET CONNECTED" : "WALLET NOT CONNECTED";
    connectButton.innerHTML = connected ? "Wallet connected <span>✓</span>" : 'Connect wallet <span>↗</span>';
    connectButton.classList.toggle("connected", connected);
  } catch {
    if (walletStatusRequestIds.get(connectButton) !== requestId) return;
    walletState.textContent = "WALLET STATUS UNAVAILABLE";
  }
}

async function connectWallet() {
  if (walletAuthActive) return;
  walletAuthActive = true;
  const sessionId = ++walletAuthSessionId;
  connectButton.disabled = true;
  connectButton.setAttribute("aria-busy", "true");
  connectButton.innerHTML = "Starting <span>…</span>";
  try {
    const response = await fetch(API_BASE + "/api/wallet/auth", { cache: "no-store" });
    const data = await response.json();
    if (sessionId !== walletAuthSessionId || !walletAuthActive) return;
    if (!response.ok) throw new Error((data && typeof data === "object" && data.error) || "Could not start wallet connection.");
    if (!data || typeof data !== "object" || typeof data.status !== "string") throw new Error("Wallet authentication response was invalid.");

    if (data.status === "SUCCESS") {
      walletAuthActive = false;
      await refreshWalletStatus();
      if (document.querySelector("#view-portfolio.active")) loadPortfolio();
      if (document.querySelector("#view-history.active")) loadHistory();
      return;
    }

    showWalletAuth(data);
    walletAuthPoll = setInterval(async () => {
      if (sessionId !== walletAuthSessionId || !walletAuthActive) return;
      try {
        const authResponse = await fetch(API_BASE + "/api/wallet/auth", { cache: "no-store" });
        const auth = await authResponse.json();
        if (sessionId !== walletAuthSessionId || !walletAuthActive) return;
        if (!auth || typeof auth !== "object" || typeof auth.status !== "string") {
          throw new Error("Wallet authentication status response was invalid.");
        }

        if (auth.status === "SUCCESS") {
          clearWalletAuthPolling();
          closeWalletAuth();
          await refreshWalletStatus();
          if (document.querySelector("#view-portfolio.active")) loadPortfolio();
          if (document.querySelector("#view-history.active")) loadHistory();
        } else if (auth.status === "FAILED") {
          clearWalletAuthPolling();
          closeWalletAuth();
          addAgentError(auth.error || "The wallet did not complete authentication. Please try again.");
        }
      } catch (error) {
        if (sessionId !== walletAuthSessionId || !walletAuthActive) return;
        clearWalletAuthPolling();
        closeWalletAuth();
        addAgentError(userFacingError(error, "Wallet connection status could not be checked. Please try again."));
      }
    }, 2500);

    walletAuthTimeout = setTimeout(() => {
      clearWalletAuthPolling();
      closeWalletAuth();
      addAgentError("Wallet connection timed out. Please try connecting again.");
    }, 5 * 60 * 1000);
  } catch (error) {
    if (sessionId !== walletAuthSessionId || !walletAuthActive) return;
    walletAuthActive = false;
    addAgentError(userFacingError(error, "I could not start the wallet connection. Please try again."));
  } finally {
    if (!walletAuthActive) {
      connectButton.disabled = false;
      connectButton.removeAttribute("aria-busy");
      if (!connectButton.classList.contains("connected")) connectButton.innerHTML = 'Connect wallet <span>↗</span>';
    }
  }
}

function showWalletAuth(data) {
  let modal = document.querySelector(".wallet-modal");
  if (modal) modal.remove();
  walletAuthReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : connectButton;
  modal = document.createElement("div");
  modal.className = "wallet-modal";
  modal.innerHTML = `
    <div class="wallet-modal-backdrop"></div>
    <div class="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-title" aria-describedby="wallet-description">
      <button class="wallet-close" type="button" aria-label="Close">×</button>
      <div class="eyebrow">BINANCE AGENTIC WALLET</div>
      <h2 id="wallet-title">Connect your wallet.</h2>
      <p id="wallet-description">Open the Binance sign-in page, then confirm the matching code in your Binance Wallet App.</p>
      <div class="pairing-code">${escapeHtml(data.pairingCode || "—")}</div>
      <a class="wallet-link" href="${escapeHtml(safeExternalUrl(data.urlForWeb))}" target="_blank" rel="noopener">Open Binance sign-in ↗</a>
      <div class="wallet-wait">Waiting for confirmation…</div>
    </div>`;
  const dialog = modal.querySelector(".wallet-dialog");
  modal.querySelector(".wallet-close").addEventListener("click", closeWalletAuth);
  modal.querySelector(".wallet-modal-backdrop").addEventListener("click", closeWalletAuth);
  walletAuthKeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWalletAuth();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  modal.addEventListener("keydown", walletAuthKeydown);
  document.body.appendChild(modal);
  modal.querySelector(".wallet-close").focus();
}

function clearWalletAuthPolling() {
  if (walletAuthPoll) {
    clearInterval(walletAuthPoll);
    walletAuthPoll = null;
  }
  if (walletAuthTimeout) {
    clearTimeout(walletAuthTimeout);
    walletAuthTimeout = null;
  }
}

function closeWalletAuth() {
  walletAuthSessionId += 1;
  clearWalletAuthPolling();
  walletAuthActive = false;
  connectButton.disabled = false;
  connectButton.removeAttribute("aria-busy");
  if (!connectButton.classList.contains("connected")) connectButton.innerHTML = 'Connect wallet <span>↗</span>';
  const modal = document.querySelector(".wallet-modal");
  if (modal) {
    if (walletAuthKeydown) modal.removeEventListener("keydown", walletAuthKeydown);
    modal.remove();
  }
  if (walletAuthReturnFocus?.isConnected) walletAuthReturnFocus.focus();
  walletAuthReturnFocus = null;
  walletAuthKeydown = null;
}

connectButton.addEventListener("click", connectWallet);
workspaceWalletAction?.addEventListener("click", connectWallet);
workspacePortfolioRefresh?.addEventListener("click", refreshWorkspaceContext);
workspaceHistoryRefresh?.addEventListener("click", refreshWorkspaceContext);
refreshWalletStatus();
input.focus();
async function loadPortfolio() {
  const requestId = ++dataViewRequestId;
  const target = document.querySelector("#portfolioContent");
  target.setAttribute("aria-busy", "true");
  target.innerHTML = '<div class="loading-card">Reading wallet positions...</div>';
  try {
    const addressResponse = await fetch(API_BASE + "/api/wallet/address", { cache: "no-store" });
    const address = await addressResponse.json();
    if (requestId !== dataViewRequestId) return;
    if (!address.connected || !address.address) {
      target.innerHTML = '<div class="empty-state"><div class="empty-number">03</div><h3>Connect a wallet to see your portfolio.</h3><p>Handelo reads the connected wallet. It never asks for a private key.</p><button class="primary-button" id="portfolioConnect" type="button">Connect wallet</button></div>';
      target.querySelector("#portfolioConnect").addEventListener("click", connectWallet);
      target.setAttribute("aria-busy", "false");
      return;
    }
    const response = await fetch(API_BASE + "/api/portfolio?wallet=" + encodeURIComponent(address.address), { cache: "no-store" });
    const data = await response.json();
    if (requestId !== dataViewRequestId) return;
    if (!response.ok) throw new Error((data && typeof data === "object" && data.error) || "Portfolio request failed.");
    if (!data || !Array.isArray(data.positions)) throw new Error("Portfolio response was invalid.");
    target.innerHTML = `
      <div class="portfolio-summary"><div><span>ESTIMATED VALUE</span><strong>${data.totalEstimatedValueUsd === null ? "—" : money(data.totalEstimatedValueUsd)}</strong></div><div><span>POSITIONS</span><strong>${data.positions.length}</strong></div></div>
      <div class="portfolio-list">${data.positions.length ? data.positions.map(p => `<article class="portfolio-row"><div><strong>${escapeHtml(p.ticker)}</strong><span>${escapeHtml(p.tokenSymbol)} · ${escapeHtml(p.provider)}</span><small>${p.marketOpen ? "LIVE MARKET" : "MARKET CLOSED"} · ${p.tokenPrice === null || p.tokenPrice === undefined ? "PRICE UNAVAILABLE" : money(p.tokenPrice)}</small></div><div class="portfolio-value">${p.estimatedValueUsd === null ? "—" : money(p.estimatedValueUsd)}</div></article>`).join("") : '<div class="empty-row">No supported tokenized-stock positions found in this wallet.<br><button class="secondary-button" id="portfolioEmptyRefresh" type="button">Refresh</button></div>'}</div>`;
    target.querySelector("#portfolioEmptyRefresh")?.addEventListener("click", loadPortfolio);
    target.setAttribute("aria-busy", "false");
  } catch (error) {
    if (requestId !== dataViewRequestId) return;
    target.innerHTML = `<div class="loading-card" role="alert">Portfolio data is unavailable. ${escapeHtml(userFacingError(error, "Portfolio data could not be loaded. Please try again."))}<br><button class="primary-button" id="portfolioRetry" type="button">Retry</button></div>`;
    target.querySelector("#portfolioRetry").addEventListener("click", loadPortfolio);
    target.setAttribute("aria-busy", "false");
  }
}

function normalizeMarketRecord(market) {
  const tokenPrice = Number(market?.tokenPrice);
  const referencePrice = Number(market?.referencePrice);
  const premiumPct = Number.isFinite(tokenPrice) && Number.isFinite(referencePrice) && referencePrice !== 0
    ? ((tokenPrice - referencePrice) / referencePrice) * 100
    : null;
  const statusInfo = market?.statusInfo && typeof market.statusInfo === "object" ? market.statusInfo : {};
  return {
    ...market,
    ticker: market?.ticker || market?.underlyingTicker || "",
    provider: market?.provider || market?.platformId || "",
    premiumPct,
    marketOpen: Boolean(statusInfo.openState ?? market?.marketOpen),
    marketStatus: statusInfo.marketStatus ?? market?.marketStatus ?? null,
    nextOpenTime: statusInfo.nextOpenTime ?? market?.nextOpenTime ?? market?.nextOpenAt ?? null,
    nextCloseTime: statusInfo.nextCloseTime ?? market?.nextCloseTime ?? market?.nextCloseAt ?? null,
    marketStatusReason: statusInfo.reasonMsg ?? statusInfo.reasonCode ?? market?.marketStatusReason ?? null
  };
}

async function loadMarkets() {
  const requestId = ++dataViewRequestId;
  marketGrid.setAttribute("aria-busy", "true");
  marketGrid.innerHTML = '<div class="loading-card">Reading BSC market data...</div>';
  try {
    const response = await fetch(API_BASE + "/api/markets", { cache: "no-store" });
    const markets = await response.json();
    if (requestId !== dataViewRequestId) return;
    if (!response.ok || !Array.isArray(markets) || !markets.length) {
      throw new Error((markets && typeof markets === "object" && markets.error) || "No market records returned.");
    }
    marketRecords = markets.map(normalizeMarketRecord);
    renderMarketResults();
    marketGrid.setAttribute("aria-busy", "false");
  } catch (error) {
    if (requestId !== dataViewRequestId) return;
    marketGrid.innerHTML = `<div class="loading-card" role="alert">Market data is unavailable. ${escapeHtml(userFacingError(error, "Market data could not be loaded. Please try again."))}<br><button class="primary-button" id="marketsRetry" type="button">Retry</button></div>`;
    marketGrid.querySelector("#marketsRetry").addEventListener("click", loadMarkets);
    marketGrid.setAttribute("aria-busy", "false");
  }
}

async function loadHistory() {
  const requestId = ++dataViewRequestId;
  const target = document.querySelector("#historyContent");
  target.setAttribute("aria-busy", "true");
  target.innerHTML = '<div class="loading-card">Reading on-chain history...</div>';
  try {
    const addressResponse = await fetch(API_BASE + "/api/wallet/address", { cache: "no-store" });
    const address = await addressResponse.json();
    if (requestId !== dataViewRequestId) return;
    if (!address.connected || !address.address) {
      target.innerHTML = '<div class="empty-state"><div class="empty-number">04</div><h3>Connect a wallet to see transaction history.</h3><p>Handelo reads recent BSC transactions from the connected wallet.</p><button class="primary-button" id="historyConnect" type="button">Connect wallet</button></div>';
      target.querySelector("#historyConnect").addEventListener("click", connectWallet);
      target.setAttribute("aria-busy", "false");
      return;
    }
    const response = await fetch(API_BASE + "/api/history?wallet=" + encodeURIComponent(address.address), { cache: "no-store" });
    const data = await response.json();
    if (requestId !== dataViewRequestId) return;
    if (!response.ok) throw new Error((data && typeof data === "object" && data.error) || "History request failed.");
    if (!Array.isArray(data.transactions)) throw new Error("History response was invalid.");
    if (!data.transactions.length) {
      target.innerHTML = '<div class="empty-state"><div class="empty-number">04</div><h3>No recent BSC transactions.</h3><p>Completed wallet activity will appear here when available.</p><button class="secondary-button" id="historyEmptyRefresh" type="button">Refresh</button></div>';
      target.querySelector("#historyEmptyRefresh").addEventListener("click", loadHistory);
      target.setAttribute("aria-busy", "false");
      return;
    }
    target.innerHTML = '<div class="history-toolbar"><span>RECENT ACTIVITY</span><button class="secondary-button" id="historyRefresh" type="button">Refresh</button></div><div class="history-list">' + data.transactions.map(tx => {
      const time = Number(tx.txTime);
      const date = Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Unknown time";
      const hash = String(tx.txHash || "");
      const validHash = /^0x[a-fA-F0-9]{64}$/.test(hash);
      const shortHash = validHash ? hash.slice(0, 8) + "…" + hash.slice(-6) : "No hash";
      const hashLink = validHash
        ? '<a class="history-hash" href="https://bscscan.com/tx/' + encodeURIComponent(hash) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(shortHash) + ' ↗</a>'
        : '<span class="history-hash">' + escapeHtml(shortHash) + '</span>';
      return '<article class="history-row"><div><div class="history-main"><strong>' + escapeHtml(tx.symbol || "BSC transaction") + '</strong><span class="history-status ' + escapeHtml(String(tx.txStatus || "").toLowerCase()) + '">' + escapeHtml(tx.txStatus || "unknown") + '</span></div><span class="history-meta">' + escapeHtml(date) + ' · ' + escapeHtml(String(tx.amount || "—")) + ' ' + escapeHtml(tx.symbol || "") + '</span></div>' + hashLink + '</article>';
    }).join("") + '</div>';
    const refreshButton = target.querySelector("#historyRefresh");
    refreshButton?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-label", "Refreshing transaction history");
      button.textContent = "Refreshing…";
      loadHistory();
    });
    target.setAttribute("aria-busy", "false");
  } catch (error) {
    if (requestId !== dataViewRequestId) return;
    target.innerHTML = '<div class="loading-card" role="alert">History data is unavailable. ' + escapeHtml(userFacingError(error, "Transaction history could not be loaded. Please try again.")) + '<br><button class="primary-button" id="historyRetry" type="button">Retry</button></div>';
    target.querySelector("#historyRetry").addEventListener("click", loadHistory);
    target.setAttribute("aria-busy", "false");
  }
}

function showView(view = "workspace") {
  const nextView = view === "home" ? "home" : "workspace";
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.view === nextView;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === "view-" + nextView));
  const topbarLabel = document.querySelector("#topbarLabel");
  if (topbarLabel) topbarLabel.textContent = "HANDELO / " + nextView.toUpperCase();
  if (nextView === "workspace") refreshWorkspaceContext();
}

function openMarketDetail(index) {
  const market = marketRecords[index];
  if (!market) return;
  let panel = document.querySelector('.market-detail');
  if (panel) panel.remove();
  panel = document.createElement('aside');
  panel.className = 'market-detail';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'market-detail-title');
  panel.innerHTML = `
    <div class="market-detail-backdrop"></div>
    <div class="market-detail-panel">
      <button class="market-detail-close" type="button" aria-label="Close market details">×</button>
      <div class="eyebrow">MARKET REPRESENTATION</div>
      <h3 id="market-detail-title">${escapeHtml(market.ticker)} <span>${escapeHtml(market.tokenSymbol)}</span></h3>
      <div class="market-detail-provider">${escapeHtml(market.provider || 'BSC')}</div>
      <div class="market-detail-price"><strong>${money(market.tokenPrice)}</strong><span>ON-CHAIN PRICE</span></div>
      <div class="market-detail-grid">
        <div><small>REFERENCE</small><strong>${money(market.referencePrice)}</strong></div>
        <div><small>DIFFERENCE</small><strong>${market.premiumPct === null ? '—' : (market.premiumPct >= 0 ? '+' : '') + market.premiumPct.toFixed(2) + '%'}</strong></div>
        <div><small>STATUS</small><strong>${market.marketOpen ? 'LIVE' : 'CLOSED'}</strong></div>
        <div><small>SCHEDULE</small><strong>${escapeHtml(marketSchedule(market))}</strong></div>
      </div>
      <button class="primary-button market-detail-chat" type="button">Ask Handelo about this</button>
    </div>`;
  const related = marketRecords.filter((candidate) => candidate.ticker === market.ticker);
  const section = document.createElement('section');
  section.className = 'market-detail-representations';
  section.innerHTML = '<div class="eyebrow">AVAILABLE REPRESENTATIONS</div>' + related.map((candidate) => '<button class="market-representation" type="button" data-market-representation="' + escapeHtml(candidate.tokenSymbol) + '"><span><strong>' + escapeHtml(candidate.tokenSymbol) + '</strong><small>' + escapeHtml(candidate.provider || 'BSC') + ' · ' + (candidate.marketOpen ? 'LIVE' : 'CLOSED') + '</small></span><b>' + money(candidate.tokenPrice) + '</b></button>').join('');
  panel.querySelector('.market-detail-panel').insertBefore(section, panel.querySelector('.market-detail-chat'));
  section.querySelectorAll('[data-market-representation]').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = related.find((candidate) => candidate.tokenSymbol === button.dataset.marketRepresentation);
      if (selected) openMarketDetail(marketRecords.indexOf(selected));
    });
  });
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(panel);
  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    panel.remove();
    returnFocus?.isConnected && returnFocus.focus();
  };
  const onKeydown = (event) => {
    if (event.key !== "Escape") return;
    close();
  };
  panel.querySelector('.market-detail-close').addEventListener('click', close);
  panel.querySelector('.market-detail-backdrop').addEventListener('click', close);
  panel.querySelector('.market-detail-chat').addEventListener('click', () => { close(); showView('workspace'); ask(`Explain ${market.tokenSymbol} compared with its reference price.`); });
  document.addEventListener("keydown", onKeydown);
  panel.querySelector('.market-detail-close').focus();
}
function renderMarketResults() {
  const query = String(marketSearch?.value || "").trim().toLowerCase();
  const filtered = marketRecords.filter((market) => {
    if (!query) return true;
    return [market.ticker, market.tokenSymbol, market.provider]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });

  if (marketCount) {
    marketCount.textContent = query
      ? `${filtered.length} of ${marketRecords.length} markets`
      : `${marketRecords.length} markets`;
  }

  marketGrid.innerHTML = filtered.length
    ? filtered.map((market) => renderMarketCard(market, marketRecords.indexOf(market))).join("")
    : '<div class="loading-card market-empty">No markets match that search.</div>';
}

function renderMarketCard(market, index) {
  const gap = market.premiumPct;
  const gapText = gap === null ? "—" : (gap >= 0 ? "+" : "") + gap.toFixed(2) + "%";
  return `
    <article class="market-card">
      <div class="market-card-head">
        <div class="market-card-name">${escapeHtml(market.ticker)} <span>${escapeHtml(market.tokenSymbol)}</span></div>
        <div class="market-card-status ${market.marketOpen ? "" : "closed"}">${market.marketOpen ? "LIVE" : "CLOSED"}</div>
      </div>
      <div class="market-card-price"><strong>${money(market.tokenPrice)}</strong><span>ON-CHAIN</span></div>
      <div class="market-card-stats">
        <div><small>REFERENCE</small><b>${money(market.referencePrice)}</b></div>
        <div><small>DIFFERENCE</small><b class="${gap >= 0 ? "positive" : "negative"}">${gapText}</b></div>
      </div>
      <button class="market-card-detail" type="button" data-market-detail="${index}">View details ↗</button>
      <div class="market-card-schedule"><span>${market.marketOpen ? "NEXT CLOSE" : "NEXT OPEN"}</span><b>${escapeHtml(marketSchedule(market))}</b></div>
    </article>`;
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

marketSearch?.addEventListener("input", renderMarketResults);

document.querySelector("#homeWorkspaceCta")?.addEventListener("click", () => showView("workspace"));
document.querySelector("#homeFinalCta")?.addEventListener("click", () => showView("workspace"));

marketGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-market-detail]");
  if (!button) return;
  openMarketDetail(Number(button.dataset.marketDetail));
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => ask(button.dataset.prompt || ""));
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  ask(input.value);
});

document.querySelector("#portfolioConnect")?.addEventListener("click", () => connectButton.click());
document.querySelector("#historyConnect")?.addEventListener("click", () => connectButton.click());


refreshWorkspaceContext();
