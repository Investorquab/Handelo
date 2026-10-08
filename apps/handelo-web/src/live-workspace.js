(() => {
  const API_BASE = window.HANDELO_API_URL || localStorage.getItem("handelo_api_url") || "http://localhost:8787";
  const state = { market: null, portfolio: null, wallet: null, history: null };

  const $ = (id) => document.getElementById(id);

  function money(value) {
    const n = Number(value);
    return Number.isFinite(n)
      ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";
  }

  function percent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? (n >= 0 ? "+" : "") + n.toFixed(2) + "%" : "—";
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  async function get(path) {
    const response = await fetch(API_BASE + path, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || "Handelo API request failed.");
    return body;
  }

  function selectedMarket(markets) {
    return (Array.isArray(markets) ? markets : []).find((market) =>
      String(market.tokenSymbol || "").toUpperCase() === "NVDAB" ||
      String(market.underlyingTicker || market.ticker || "").toUpperCase() === "NVDA"
    ) || markets?.[0] || null;
  }

  function renderLiveChart(market) {
    const reference = Number(market.referencePrice);
    const token = Number(market.tokenPrice);
    const values = [reference, token].filter(Number.isFinite);
    if (values.length !== 2) {
      $("chart").innerHTML = '<div class="msg">Live chart unavailable: the API did not return both prices.</div>';
      return;
    }
    const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max((hi-lo)*0.35, 0.5);
    const min = lo-pad, max = hi+pad;
    const y = (v) => 70 - ((v-min)/(max-min))*52;
    $("chart").innerHTML =
      '<svg viewBox="0 0 640 84" role="img" aria-label="Live NVDA reference and NVDAB token price snapshot">' +
      '<line x1="20" y1="78" x2="620" y2="78" stroke="var(--line)"/>' +
      '<line x1="20" y1="'+y(reference).toFixed(1)+'" x2="620" y2="'+y(reference).toFixed(1)+'" stroke="var(--ink)" stroke-width="2"/>' +
      '<line x1="20" y1="'+y(token).toFixed(1)+'" x2="620" y2="'+y(token).toFixed(1)+'" stroke="var(--gold)" stroke-width="2"/>' +
      '<circle cx="620" cy="'+y(reference).toFixed(1)+'" r="3" fill="var(--ink)"/>' +
      '<circle cx="620" cy="'+y(token).toFixed(1)+'" r="3" fill="var(--gold)"/>' +
      '<text x="20" y="14" fill="var(--mute)" font-size="11">LIVE PRICE SNAPSHOT · API</text></svg>';
  }

  function renderMarket(market) {
    state.market = market;
    const reference = Number(market.referencePrice);
    const token = Number(market.tokenPrice);
    const gap = Number.isFinite(reference) && reference !== 0 && Number.isFinite(token)
      ? ((token/reference)-1)*100 : Number(market.premiumPct);

    $("tp").textContent = money(token);
    $("tp").nextElementSibling.textContent = "NVDAB token · live API";
    $("sr").textContent = money(reference);
    $("st").textContent = money(token);
    $("sg").textContent = percent(gap);
    $("sv").textContent = money(market.volume24hUsd ?? market.volumeUsd ?? market.volume24h);
    $("slq").textContent = String(market.liquidityContext ?? market.liquidity ?? "—");
    $("sus").innerHTML = '<span class="dot '+(market.marketOpen ? "g" : "r")+'"></span> '+esc(market.marketStatus || (market.marketOpen ? "Open" : "Closed"));
    $("readout").innerHTML =
      '<div>LIVE API<b>'+new Date().toLocaleTimeString()+"</b></div>" +
      '<div>'+esc(market.underlyingTicker || market.ticker || "NVDA")+' reference<b>'+money(reference)+'</b></div>' +
      '<div class="t">'+esc(market.tokenSymbol || "NVDAB")+' token<b>'+money(token)+'</b></div>' +
      '<div>Gap<b>'+percent(gap)+'</b></div>';
    renderLiveChart(market);
  }

  function renderWalletAndPortfolio(address, portfolio) {
    const connected = Boolean(address?.connected && address?.address);
    $("wal").innerHTML = connected
      ? '<span class="dot g"></span>'+esc(address.address.slice(0,6)+"…"+address.address.slice(-4))
      : "Connect wallet";
    $("wal").className = "chip wal"+(connected ? " on" : "");
    $("wal").title = connected ? "Wallet connected through the backend" : "Wallet not connected";

    if (!connected || !portfolio) {
      $("tot").textContent = "—";
      $("pn").textContent = "—"; $("pb").textContent = "—"; $("pu").textContent = "—";
      $("bn").style.width = "0%"; $("bb").style.width = "0%"; $("bu").style.width = "0%";
      $("gp").setAttribute("stroke-dasharray","0 100");
      $("gv").textContent = "—";
      $("gl").textContent = "Portfolio unavailable";
      $("gl").style.color = "var(--mute)";
      return;
    }

    const total = Number(portfolio.totalValueUsd);
    $("tot").textContent = money(total);
    const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
    const shares = positions.map((p) => [String(p.tokenSymbol || p.asset || "").toUpperCase(), Number(p.allocationPercent)]);
    const nvdab = shares.find((p) => p[0] === "NVDAB")?.[1];
    const bnb = shares.find((p) => p[0] === "BNB")?.[1];
    const usdt = shares.find((p) => p[0] === "USDT")?.[1];
    $("pn").textContent = Number.isFinite(nvdab) ? nvdab.toFixed(1)+"%" : "—";
    $("pb").textContent = Number.isFinite(bnb) ? bnb.toFixed(1)+"%" : "—";
    $("pu").textContent = Number.isFinite(usdt) ? usdt.toFixed(1)+"%" : "—";
    $("bn").style.width = (Number.isFinite(nvdab) ? Math.max(0,nvdab) : 0)+"%";
    $("bb").style.width = (Number.isFinite(bnb) ? Math.max(0,bnb) : 0)+"%";
    $("bu").style.width = (Number.isFinite(usdt) ? Math.max(0,usdt) : 0)+"%";

    const riskValue = Number(portfolio.riskPercent ?? portfolio.portfolioRiskPercent);
    $("gp").setAttribute("stroke-dasharray", Number.isFinite(riskValue) ? Math.max(0,Math.min(100,riskValue))+" 100" : "0 100");
    $("gv").textContent = Number.isFinite(riskValue) ? Math.round(riskValue)+"%" : "—";
    $("gl").textContent = Number.isFinite(riskValue) ? "Backend portfolio risk" : "Risk unavailable";
    $("gl").style.color = Number.isFinite(riskValue) ? (riskValue <= 60 ? "var(--green)" : "var(--red)") : "var(--mute)";
  }

  async function load() {
    if (!window.HANDELO_LIVE_WORKSPACE) return;
    $("msg").textContent = "Connecting to Handelo API…";
    try {
      const markets = await get("/api/markets");
      const market = selectedMarket(markets);
      if (!market) throw new Error("The Handelo API returned no supported market data.");
      renderMarket(market);

      const status = await get("/api/wallet/status").catch(() => ({status:"UNAVAILABLE"}));
      const address = await get("/api/wallet/address").catch(() => ({connected:false,address:null}));
      let portfolio = null;
      if (address.connected && address.address) {
        portfolio = await get("/api/portfolio?wallet="+encodeURIComponent(address.address)).catch(() => null);
      }
      state.wallet = status;
      state.portfolio = portfolio;
      renderWalletAndPortfolio(address, portfolio);

      $("pc").textContent = "LIVE BACKEND";
      $("pc").style.color = "var(--green)";
      $("msg").textContent = "Live market data and wallet/portfolio state loaded from the Handelo API.";
    } catch (error) {
      $("pc").textContent = "API ERROR";
      $("pc").style.color = "var(--red)";
      $("msg").textContent = "Live workspace unavailable: " + error.message;
    }
  }

  window.HandeloLiveWorkspace = { load };

  function syncFromHash() {
    const liveMode = location.hash.includes("mode=live");
    if (!liveMode) return;
    window.HANDELO_LIVE_WORKSPACE = true;
    void load();
  }

  window.addEventListener("hashchange", syncFromHash);
  syncFromHash();
  setInterval(() => {
    if (window.HANDELO_LIVE_WORKSPACE) void load();
  }, 30000);
})();