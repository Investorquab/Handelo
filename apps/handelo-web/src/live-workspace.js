(() => {
  const API_BASE = window.HANDELO_API_URL || localStorage.getItem("handelo_api_url") || "http://localhost:8787";
  const state = {
    market: null,
    portfolio: null,
    wallet: null,
    address: null,
    history: null,
    liveSamples: [],
    entered: false,
    marketInFlight: false,
    accountInFlight: false
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  function money(value) {
    const n = Number(value);
    return Number.isFinite(n)
      ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";
  }

  function pct(value, digits = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) + "%" : "—";
  }

  function gap(reference, token) {
    const r = Number(reference);
    const t = Number(token);
    return Number.isFinite(r) && r > 0 && Number.isFinite(t) ? ((t / r) - 1) * 100 : null;
  }

  async function get(path, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(API_BASE + path, {
        cache: "no-store",
        signal: controller.signal,
        headers: { "accept": "application/json" }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Handelo API request failed.");
      return body;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function selectedMarket(markets) {
    return (Array.isArray(markets) ? markets : []).find((market) =>
      String(market.tokenSymbol || "").toUpperCase() === "NVDAB"
    ) || (Array.isArray(markets) ? markets.find((market) =>
      String(market.underlyingTicker || "").toUpperCase() === "NVDA"
    ) : null) || markets?.[0] || null;
  }

  function resetLiveSurface() {
    const safeText = (id, value = "—") => { const el = $(id); if (el) el.textContent = value; };
    safeText("tp"); safeText("sr"); safeText("st"); safeText("sg"); safeText("sv"); safeText("slq");
    safeText("tot"); safeText("pn"); safeText("pb"); safeText("pu"); safeText("gv");
    safeText("pc", "CONNECTING");
    safeText("msg", "Connecting to Handelo API…");
    if ($("sus")) $("sus").innerHTML = '<span class="dot"></span> Connecting';
    ["bn","bb","bu"].forEach((id) => { if ($(id)) $(id).style.width = "0%"; });
    if ($("gp")) $("gp").setAttribute("stroke-dasharray", "0 100");
    if ($("gl")) { $("gl").textContent = "Waiting for live portfolio data"; $("gl").style.color = "var(--mute)"; }
    if ($("chart")) $("chart").innerHTML = '<div class="msg">LIVE API · waiting for first market sample…</div>';
    state.market = null;
    state.portfolio = null;
    state.wallet = null;
    state.address = null;
    state.history = null;
    state.liveSamples = [];
    if ($("v-port") && !$("v-port").hidden) renderPortfolioView();
    if ($("v-hist") && !$("v-hist").hidden) renderHistoryView();
  }

  function enter() {
    if (!window.HANDELO_LIVE_WORKSPACE) return;
    state.entered = true;
    resetLiveSurface();
  }

  function addSample(market) {
    const reference = Number(market?.referencePrice);
    const token = Number(market?.tokenPrice);
    if (!Number.isFinite(reference) || !Number.isFinite(token)) return;
    state.liveSamples.push({ t: new Date(), reference, token });
    if (state.liveSamples.length > 60) state.liveSamples.shift();
  }

  function renderLiveChart() {
    const chart = $("chart");
    if (!chart) return;
    const samples = state.liveSamples;
    if (!samples.length) {
      chart.innerHTML = '<div class="msg">LIVE API · waiting for first market sample…</div>';
      return;
    }

    const values = samples.flatMap((s) => [s.reference, s.token]);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max((hi - lo) * 0.22, 0.5);
    const min = lo - pad;
    const max = hi + pad;
    const width = 640;
    const height = 180;
    const left = 44;
    const right = 14;
    const top = 24;
    const bottom = 28;
    const innerW = width - left - right;
    const innerH = height - top - bottom;
    const x = (i) => left + (samples.length <= 1 ? innerW : (i / (samples.length - 1)) * innerW);
    const y = (v) => top + (1 - (v - min) / (max - min || 1)) * innerH;
    const refPoints = samples.map((s, i) => x(i).toFixed(1) + "," + y(s.reference).toFixed(1)).join(" ");
    const tokenPoints = samples.map((s, i) => x(i).toFixed(1) + "," + y(s.token).toFixed(1)).join(" ");
    const last = samples[samples.length - 1];
    const stamp = last.t.toLocaleTimeString();

    chart.innerHTML =
      '<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Live NVDA reference and NVDAB token prices">' +
      '<line x1="'+left+'" y1="'+(height-bottom)+'" x2="'+(width-right)+'" y2="'+(height-bottom)+'" stroke="var(--line)"/>' +
      '<polyline points="'+refPoints+'" fill="none" stroke="var(--ink)" stroke-width="1.6"/>' +
      '<polyline points="'+tokenPoints+'" fill="none" stroke="var(--gold)" stroke-width="2"/>' +
      '<circle cx="'+x(samples.length-1).toFixed(1)+'" cy="'+y(last.reference).toFixed(1)+'" r="3" fill="var(--ink)"/>' +
      '<circle cx="'+x(samples.length-1).toFixed(1)+'" cy="'+y(last.token).toFixed(1)+'" r="3.5" fill="var(--gold)"/>' +
      '<text x="'+left+'" y="14" fill="var(--mute)" font-size="11">LIVE API · '+samples.length+' REAL SAMPLE'+(samples.length === 1 ? "" : "S")+'</text>' +
      '<text x="'+(width-right)+'" y="14" text-anchor="end" fill="var(--mute)" font-size="11">'+esc(stamp)+'</text>' +
      '<text x="'+left+'" y="'+(height-8)+'" fill="var(--mute)" font-size="11">NVDA reference</text>' +
      '<text x="'+(left+118)+'" y="'+(height-8)+'" fill="var(--gold)" font-size="11">NVDAB token</text>' +
      '</svg>';
  }

  function renderMarket(market) {
    state.market = market;
    addSample(market);

    const reference = Number(market.referencePrice);
    const token = Number(market.tokenPrice);
    const divergence = gap(reference, token);
    const statusInfo = market.statusInfo || {};
    const marketOpen = statusInfo.openState === true;
    const status = statusInfo.marketStatus || (marketOpen ? "OPEN" : "CLOSED");
    const volume = Number(market.volume24H);
    const liquidity = Number.isFinite(volume)
      ? "24h volume " + volume.toLocaleString("en-US") + " · live API"
      : "Live API";

    if ($("tp")) $("tp").textContent = money(token);
    if ($("tp")?.nextElementSibling) $("tp").nextElementSibling.textContent = "NVDAB token · live API";
    if ($("sr")) $("sr").textContent = money(reference);
    if ($("st")) $("st").textContent = money(token);
    if ($("sg")) $("sg").textContent = Number.isFinite(divergence) ? (divergence >= 0 ? "+" : "") + divergence.toFixed(2) + "%" : "—";
    if ($("sv")) $("sv").textContent = Number.isFinite(volume) ? money(volume) : "—";
    if ($("slq")) $("slq").textContent = liquidity;
    if ($("sus")) $("sus").innerHTML = '<span class="dot '+(marketOpen ? "g" : "r")+'"></span> '+esc(status);
    if ($("readout")) {
      $("readout").innerHTML =
        '<div>LIVE API<b>'+new Date().toLocaleTimeString()+"</b></div>" +
        '<div>'+esc(market.underlyingTicker || "NVDA")+' reference<b>'+money(reference)+'</b></div>' +
        '<div class="t">'+esc(market.tokenSymbol || "NVDAB")+' token<b>'+money(token)+'</b></div>' +
        '<div>Gap<b>'+ (Number.isFinite(divergence) ? (divergence >= 0 ? "+" : "") + divergence.toFixed(2) + "%" : "—") +'</b></div>';
    }
    renderLiveChart();
    if ($("pc")) { $("pc").textContent = "LIVE BACKEND"; $("pc").style.color = "var(--green)"; }
  }

  function portfolioTotals(portfolio) {
    const tokenTotal = Number(portfolio?.totalValueUsd);
    const cash = Number(portfolio?.balanceUsd);
    const safeTokenTotal = Number.isFinite(tokenTotal) && tokenTotal >= 0 ? tokenTotal : 0;
    const safeCash = Number.isFinite(cash) && cash >= 0 ? cash : 0;
    return { tokenTotal: safeTokenTotal, cash: safeCash, total: safeTokenTotal + safeCash };
  }

  function renderWalletAndPortfolio(address, portfolio) {
    state.address = address;
    state.portfolio = portfolio;
    const connected = Boolean(address?.connected && address?.address);
    if ($("wal")) {
      $("wal").innerHTML = connected
        ? '<span class="dot g"></span>'+esc(address.address.slice(0,6)+"…"+address.address.slice(-4))
        : "Connect wallet";
      $("wal").className = "chip wal"+(connected ? " on" : "");
      $("wal").title = connected ? "Wallet connected through the backend" : "Wallet not connected";
    }

    if (!connected || !portfolio) {
      if ($("tot")) $("tot").textContent = "—";
      ["pn","pb","pu"].forEach((id) => { if ($(id)) $(id).textContent = "—"; });
      ["bn","bb","bu"].forEach((id) => { if ($(id)) $(id).style.width = "0%"; });
      if ($("gp")) $("gp").setAttribute("stroke-dasharray", "0 100");
      if ($("gv")) $("gv").textContent = "—";
      if ($("gl")) { $("gl").textContent = connected ? "Portfolio unavailable" : "Wallet not connected"; $("gl").style.color = "var(--mute)"; }
      renderPortfolioView();
      return;
    }

    const totals = portfolioTotals(portfolio);
    const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
    const nvdabValue = positions.filter((p) => String(p.tokenSymbol || "").toUpperCase() === "NVDAB")
      .reduce((sum, p) => sum + (Number(p.valueUsd) || 0), 0);
    const usdtShare = totals.total > 0 ? (totals.cash / totals.total) * 100 : 0;
    const nvdabShare = totals.total > 0 ? (nvdabValue / totals.total) * 100 : 0;

    if ($("tot")) $("tot").textContent = money(totals.total);
    if ($("pn")) $("pn").textContent = pct(nvdabShare);
    if ($("pb")) $("pb").textContent = "—";
    if ($("pu")) $("pu").textContent = pct(usdtShare);
    if ($("bn")) $("bn").style.width = Math.max(0, Math.min(100, nvdabShare))+"%";
    if ($("bb")) $("bb").style.width = "0%";
    if ($("bu")) $("bu").style.width = Math.max(0, Math.min(100, usdtShare))+"%";

    if ($("gp")) $("gp").setAttribute("stroke-dasharray", "0 100");
    if ($("gv")) $("gv").textContent = "—";
    if ($("gl")) {
      $("gl").textContent = "Live portfolio · risk score not supplied by API";
      $("gl").style.color = "var(--mute)";
    }
    renderPortfolioView();
  }

  function renderPortfolioView() {
    if (!$("pvt") || $("v-port")?.hidden) return;
    const portfolio = state.portfolio;
    const address = state.address;
    if (!portfolio || !address?.connected) {
      $("pvt").textContent = "—";
      $("pvt").nextElementSibling.textContent = "Live API · portfolio unavailable";
      $("pvc").innerHTML = '<p class="hint">A connected backend wallet is required for live portfolio data.</p>';
      return;
    }

    const totals = portfolioTotals(portfolio);
    const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
    const rows = positions.map((position) => {
      const value = Number(position.valueUsd);
      const allocation = totals.total > 0 && Number.isFinite(value) ? (value / totals.total) * 100 : null;
      return [
        position.tokenSymbol || "—",
        position.balance || "—",
        money(position.tokenPrice),
        money(value),
        pct(allocation),
        "Live on-chain balance"
      ];
    });
    rows.push(["USDT", "cash", "$1.00", money(totals.cash), pct(totals.total > 0 ? totals.cash / totals.total * 100 : null), "Live Binance token balance"]);
    $("pvt").textContent = money(totals.total);
    $("pvt").nextElementSibling.textContent = "LIVE API · BSC token balances + USDT";
    $("pvc").innerHTML =
      '<div class="bar">'+rows.map((row) => {
        const share = parseFloat(row[4]);
        const width = Number.isFinite(share) ? share : 0;
        const background = row[0] === "NVDAB" ? "var(--gold)" : row[0] === "USDT" ? "#5c5546" : "#a9742b";
        return '<i style="width:'+width+'%;background:'+background+'"></i>';
      }).join("")+'</div>' +
      '<div class="tw"><table class="tb"><thead><tr><th>Asset</th><th>Holding</th><th>Price</th><th>Value</th><th>Share</th><th>Source</th></tr></thead><tbody>' +
      rows.map((row) => "<tr>"+row.map((cell) => "<td>"+esc(cell)+"</td>").join("")+"</tr>").join("") +
      '</tbody></table></div>' +
      '<p class="hint">As of '+esc(portfolio.asOf || "—")+'. BNB is not included because the current portfolio endpoint exposes BSC RWA token balances and USDT cash only.</p>';
  }

  function renderHistoryView() {
    if (!$("hl") || $("v-hist")?.hidden) return;
    const history = Array.isArray(state.history?.transactions) ? state.history.transactions : [];
    $("hs").textContent = history.length + " live blockchain entr" + (history.length === 1 ? "y" : "ies") + ".";
    const heldOnly = $("hf1")?.getAttribute("aria-pressed") === "true";
    const filtered = heldOnly ? history.filter((tx) => String(tx.txStatus || "").toUpperCase() !== "SUCCESS") : history;
    $("hl").innerHTML = filtered.map((tx) => {
      const time = tx.txTime ? new Date(tx.txTime).toLocaleString() : "Unknown time";
      const status = tx.txStatus || "UNKNOWN";
      const hash = tx.txHash ? String(tx.txHash) : "No hash";
      return '<li class="'+(String(status).toUpperCase() === "SUCCESS" ? "" : "hold")+'"><time>'+esc(time)+'</time>' +
        '<b>'+esc(tx.symbol || "BSC transaction")+'</b> · '+esc(tx.amount || "")+' · '+esc(status)+'<br><span class="num">'+esc(hash)+'</span></li>';
    }).join("") || '<li><time></time>No live transactions available.</li>';
  }

  async function refreshMarket() {
    if (!window.HANDELO_LIVE_WORKSPACE || state.marketInFlight) return;
    state.marketInFlight = true;
    try {
      const markets = await get("/api/markets");
      const market = selectedMarket(markets);
      if (!market) throw new Error("The Handelo API returned no supported market data.");
      renderMarket(market);
      if ($("msg")) $("msg").textContent = "Live market data · refreshed " + new Date().toLocaleTimeString();
    } catch (error) {
      if ($("msg")) $("msg").textContent = "Live market refresh delayed: " + (error.name === "AbortError" ? "API timeout" : error.message);
    } finally {
      state.marketInFlight = false;
    }
  }

  async function refreshAccount() {
    if (!window.HANDELO_LIVE_WORKSPACE || state.accountInFlight) return;
    state.accountInFlight = true;
    try {
      const results = await Promise.allSettled([
        get("/api/wallet/status", 6000),
        get("/api/wallet/address", 6000)
      ]);
      const status = results[0].status === "fulfilled" ? results[0].value : { status: "UNAVAILABLE" };
      const address = results[1].status === "fulfilled" ? results[1].value : { connected: false, address: null };

      state.wallet = status;
      if (address.connected && address.address) {
        const [portfolioResult, historyResult] = await Promise.allSettled([
          get("/api/portfolio?wallet="+encodeURIComponent(address.address), 10000),
          get("/api/history?wallet="+encodeURIComponent(address.address), 8000)
        ]);
        const portfolio = portfolioResult.status === "fulfilled" ? portfolioResult.value : state.portfolio;
        const history = historyResult.status === "fulfilled" ? historyResult.value : state.history;
        state.portfolio = portfolio;
        state.history = history;
        renderWalletAndPortfolio(address, portfolio);
      } else {
        renderWalletAndPortfolio(address, null);
      }

      if ($("msg") && address.connected) {
        $("msg").textContent = "Live market + portfolio data · refreshed " + new Date().toLocaleTimeString();
      } else if ($("msg")) {
        $("msg").textContent = "Live market data · backend wallet is not connected";
      }
    } catch (error) {
      if ($("msg")) $("msg").textContent = "Live account refresh delayed: " + (error.name === "AbortError" ? "API timeout" : error.message);
    } finally {
      state.accountInFlight = false;
    }
  }

  async function load() {
    if (!window.HANDELO_LIVE_WORKSPACE) return;
    if (!state.entered) enter();

    // Market and wallet/account start together; market can render without waiting for wallet/portfolio.
    void refreshMarket();
    void refreshAccount();
  }

  function syncView(view) {
    if (!window.HANDELO_LIVE_WORKSPACE) return;
    if (view === "port") renderPortfolioView();
    if (view === "hist") renderHistoryView();
  }

  window.HandeloLiveWorkspace = { enter, load, syncView };

  // Deep-link support for workspace?mode=live.
  if (location.hash.includes("mode=live")) {
    window.HANDELO_LIVE_WORKSPACE = true;
    enter();
    void load();
  }

  window.addEventListener("hashchange", () => {
    if (!window.HANDELO_LIVE_WORKSPACE) return;
    const hash = location.hash;
    const view = hash.split("?")[0].replace("#", "");
    if (hash.includes("mode=live")) {
      syncView(view === "workspace" ? "work" : view);
      void load();
    }
  });

  window.setInterval(() => {
    if (!window.HANDELO_LIVE_WORKSPACE) return;
    void refreshMarket();
  }, 10000);

  window.setInterval(() => {
    if (!window.HANDELO_LIVE_WORKSPACE) return;
    void refreshAccount();
  }, 30000);
})();