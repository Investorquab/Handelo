(() => {
  const API_BASE = window.HANDELO_API_URL || localStorage.getItem("handelo_api_url") || "http://localhost:8787";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const state = {
    market: null, portfolio: null, portfolioError: null, wallet: null, address: null,
    history: null, strategies: [], liveSamples: [], review: null, entered: false,
    marketInFlight: false, accountInFlight: false, reviewInFlight: false, chatInFlight: false
  };

  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

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

  function divergence(reference, token) {
    const r = Number(reference), t = Number(token);
    return Number.isFinite(r) && r > 0 && Number.isFinite(t) ? ((t / r) - 1) * 100 : null;
  }

  async function get(path, timeoutMs = 9000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(API_BASE + path, {
        cache: "no-store", signal: controller.signal,
        headers: { accept: "application/json" }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Handelo API request failed.");
      return body;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function send(path, body, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(API_BASE + path, {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Handelo API request failed.");
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function selectedMarket(markets) {
    const list = Array.isArray(markets) ? markets : [];
    return list.find((market) => String(market.tokenSymbol || "").toUpperCase() === "NVDAB")
      || list.find((market) => String(market.underlyingTicker || "").toUpperCase() === "NVDA")
      || list[0] || null;
  }

  function safeAuthUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "#";
    } catch { return "#"; }
  }

  function resetLiveSurface() {
    if ($("ph")) $("ph").textContent = "Live order review";
    if ($("pform")) $("pform").hidden = false;
    if ($("rcpt")) $("rcpt").hidden = true;
    if ($("pc")) { $("pc").textContent = "LIVE BACKEND"; $("pc").style.color = "var(--green)"; }
    if ($("qty")) $("qty").value = "1";
    document.querySelectorAll(".seg button").forEach((button) => button.setAttribute("aria-pressed", button.dataset.side === "buy"));
    const stress = $("sim")?.closest(".sw");
    if (stress) stress.hidden = true;
    if ($("approve")) { $("approve").disabled = false; $("approve").textContent = "Connect wallet to review"; $("approve").title = ""; }
    if ($("ordv")) $("ordv").textContent = "—";
    if ($("checks")) $("checks").innerHTML = '<li><span class="dot"></span><span>Connect your wallet to review a real order<small>Handelo will use the backend policy, portfolio, security and provider quote services.</small></span><span class="v">WAITING</span></li>';
    if ($("msg")) $("msg").textContent = "Connecting to Handelo API…";
    if ($("sus")) $("sus").innerHTML = '<span class="dot"></span> Connecting';
    ["tp","sr","st","sg","sv","slq","tot","pn","pb","pu","gv"].forEach((id) => { if ($(id)) $(id).textContent = "—"; });
    ["bn","bb","bu"].forEach((id) => { if ($(id)) $(id).style.width = "0%"; });
    if ($("gp")) $("gp").setAttribute("stroke-dasharray", "0 100");
    if ($("gl")) { $("gl").textContent = "Waiting for live portfolio data"; $("gl").style.color = "var(--mute)"; }
    if ($("chart")) $("chart").innerHTML = '<div class="msg">LIVE API · waiting for first market sample…</div>';
    state.market = null; state.portfolio = null; state.portfolioError = null; state.wallet = null; state.address = null;
    state.history = null; state.strategies = []; state.review = null; state.liveSamples = [];
    const small = document.querySelector("#v-port .title small");
    if (small) small.textContent = "Live BSC balances from the Handelo API";
  }

  function enter() {
    if (!window.HANDELO_LIVE_WORKSPACE) return;
    state.entered = true;
    resetLiveSurface();
    void refreshAccount();
    void refreshMarket();
  }

  function addSample(market) {
    const reference = Number(market?.referencePrice), token = Number(market?.tokenPrice);
    if (!Number.isFinite(reference) || !Number.isFinite(token)) return;
    state.liveSamples.push({ t: new Date(), reference, token });
    if (state.liveSamples.length > 90) state.liveSamples.shift();
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
    const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max((hi - lo) * .22, .5);
    const min = lo - pad, max = hi + pad;
    const width = 640, height = 180, left = 44, right = 14, top = 24, bottom = 28;
    const innerW = width - left - right, innerH = height - top - bottom;
    const x = (i) => left + (samples.length <= 1 ? innerW : (i / (samples.length - 1)) * innerW);
    const y = (v) => top + (1 - (v - min) / (max - min || 1)) * innerH;
    const refPoints = samples.map((s, i) => x(i).toFixed(1)+","+y(s.reference).toFixed(1)).join(" ");
    const tokenPoints = samples.map((s, i) => x(i).toFixed(1)+","+y(s.token).toFixed(1)).join(" ");
    const last = samples[samples.length-1];
    chart.innerHTML =
      '<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Live NVDA reference and NVDAB token prices">' +
      '<line x1="'+left+'" y1="'+(height-bottom)+'" x2="'+(width-right)+'" y2="'+(height-bottom)+'" stroke="var(--line)"/>' +
      '<polyline points="'+refPoints+'" fill="none" stroke="var(--ink)" stroke-width="1.6"/>' +
      '<polyline points="'+tokenPoints+'" fill="none" stroke="var(--gold)" stroke-width="2"/>' +
      '<circle cx="'+x(samples.length-1).toFixed(1)+'" cy="'+y(last.reference).toFixed(1)+'" r="3" fill="var(--ink)"/>' +
      '<circle cx="'+x(samples.length-1).toFixed(1)+'" cy="'+y(last.token).toFixed(1)+'" r="3.5" fill="var(--gold)"/>' +
      '<text x="'+left+'" y="14" fill="var(--mute)" font-size="11">LIVE API · '+samples.length+' REAL SAMPLE'+(samples.length===1?"":"S")+'</text>' +
      '<text x="'+(width-right)+'" y="14" text-anchor="end" fill="var(--mute)" font-size="11">'+esc(last.t.toLocaleTimeString())+'</text>' +
      '<text x="'+left+'" y="'+(height-8)+'" fill="var(--mute)" font-size="11">NVDA reference</text>' +
      '<text x="'+(left+118)+'" y="'+(height-8)+'" fill="var(--gold)" font-size="11">NVDAB token</text>' +
      '</svg>';
  }

  function updateLiveOrderValue() {
    const qty = Math.max(1, Math.min(500, parseInt($("qty")?.value, 10) || 1));
    const tokenPrice = Number(state.market?.tokenPrice);
    if ($("ordv")) $("ordv").textContent = Number.isFinite(tokenPrice) ? "$"+(qty*tokenPrice).toFixed(2)+" at "+money(tokenPrice) : "—";
  }

  function renderMarket(market) {
    state.market = market;
    addSample(market);
    const reference = Number(market.referencePrice), token = Number(market.tokenPrice), gap = divergence(reference, token);
    const info = market.statusInfo || {};
    const marketOpen = info.openState === true || market.marketOpen === true;
    const status = info.marketStatus || market.marketStatus || (marketOpen ? "OPEN" : "CLOSED");
    const volume = Number(market.volume24H ?? market.volume24hUsd ?? market.volumeUsd);

    if ($("tp")) $("tp").textContent = money(token);
    if ($("tp")?.nextElementSibling) $("tp").nextElementSibling.textContent = "NVDAB token · live API";
    if ($("sr")) $("sr").textContent = money(reference);
    if ($("st")) $("st").textContent = money(token);
    if ($("sg")) $("sg").textContent = Number.isFinite(gap) ? (gap>=0?"+":"")+gap.toFixed(2)+"%" : "—";
    if ($("sv")) $("sv").textContent = Number.isFinite(volume) ? money(volume) : "—";
    if ($("slq")) $("slq").textContent = Number.isFinite(volume) ? "24h volume "+volume.toLocaleString("en-US")+" · live API" : "Live API";
    if ($("sus")) $("sus").innerHTML = '<span class="dot '+(marketOpen?"g":"r")+'"></span> '+esc(status);
    if ($("readout")) $("readout").innerHTML =
      '<div>LIVE API<b>'+new Date().toLocaleTimeString()+"</b></div>" +
      '<div>'+esc(market.underlyingTicker || "NVDA")+' reference<b>'+money(reference)+'</b></div>' +
      '<div class="t">'+esc(market.tokenSymbol || "NVDAB")+' token<b>'+money(token)+'</b></div>' +
      '<div>Gap<b>'+ (Number.isFinite(gap)?(gap>=0?"+":"")+gap.toFixed(2)+"%":"—") +'</b></div>';
    renderLiveChart();
    updateLiveOrderValue();
  }

  function portfolioTotals(portfolio) {
    const tokenTotal = Number(portfolio?.totalValueUsd), cash = Number(portfolio?.balanceUsd);
    return {
      tokenTotal: Number.isFinite(tokenTotal) && tokenTotal >= 0 ? tokenTotal : 0,
      cash: Number.isFinite(cash) && cash >= 0 ? cash : 0,
      total: (Number.isFinite(tokenTotal) && tokenTotal >= 0 ? tokenTotal : 0) + (Number.isFinite(cash) && cash >= 0 ? cash : 0)
    };
  }

  function renderWalletAndPortfolio(address, portfolio) {
    state.address = address; state.portfolio = portfolio;
    const connected = Boolean(address?.connected && address?.address);
    if ($("wal")) {
      $("wal").innerHTML = connected ? '<span class="dot g"></span>'+esc(address.address.slice(0,6)+"…"+address.address.slice(-4)) : "Connect wallet";
      $("wal").className = "chip wal"+(connected?" on":"");
      $("wal").title = connected ? "Wallet connected through the backend" : "Connect the Binance Agentic Wallet";
    }
    if ($("approve")) {
      $("approve").textContent = state.review?.reviewToken ? "Confirm purchase" : (connected ? "Review live order" : "Connect wallet to review");
      $("approve").disabled = Boolean(state.reviewInFlight);
    }
    if (!connected || !portfolio) {
      if ($("tot")) $("tot").textContent = "—";
      ["pn","pb","pu"].forEach((id)=>{if($(id))$(id).textContent="—";});
      ["bn","bb","bu"].forEach((id)=>{if($(id))$(id).style.width="0%";});
      if ($("gp")) $("gp").setAttribute("stroke-dasharray","0 100");
      if ($("gv")) $("gv").textContent="—";
      if ($("gl")) { $("gl").textContent = !connected ? "Wallet not connected" : (state.portfolioError || "Portfolio unavailable"); $("gl").style.color="var(--mute)"; }
      renderPortfolioView();
      return;
    }
    const totals=portfolioTotals(portfolio), positions=Array.isArray(portfolio.positions)?portfolio.positions:[];
    const nvdabValue=positions.filter((p)=>String(p.tokenSymbol||"").toUpperCase()==="NVDAB").reduce((sum,p)=>sum+(Number(p.valueUsd)||0),0);
    const usdtShare=totals.total>0?totals.cash/totals.total*100:0, nvdabShare=totals.total>0?nvdabValue/totals.total*100:0;
    if ($("tot")) $("tot").textContent=money(totals.total);
    if ($("pn")) $("pn").textContent=pct(nvdabShare);
    if ($("pb")) $("pb").textContent="—";
    if ($("pu")) $("pu").textContent=pct(usdtShare);
    if ($("bn")) $("bn").style.width=Math.max(0,Math.min(100,nvdabShare))+"%";
    if ($("bb")) $("bb").style.width="0%";
    if ($("bu")) $("bu").style.width=Math.max(0,Math.min(100,usdtShare))+"%";
    if ($("gp")) $("gp").setAttribute("stroke-dasharray","0 100");
    if ($("gv")) $("gv").textContent="—";
    if ($("gl")) { $("gl").textContent="Live portfolio · risk score is calculated server-side during review"; $("gl").style.color="var(--mute)"; }
    renderPortfolioView();
  }

  function renderPortfolioView() {
    if (!$("pvt") || $("v-port")?.hidden) return;
    const subtitle=document.querySelector("#v-port .title small"), totalLabel=$("pvt")?.nextElementSibling;
    if (subtitle) subtitle.textContent="Live BSC balances from the Handelo API";
    if (totalLabel) totalLabel.textContent="LIVE API · token balances + USDT cash";
    if (!state.portfolio || !state.address?.connected) {
      $("pvt").textContent="—";
      $("pvc").innerHTML='<p class="hint">'+esc(state.portfolioError || "Connect a wallet to load live portfolio data.")+'</p>';
      return;
    }
    const totals=portfolioTotals(state.portfolio), positions=Array.isArray(state.portfolio.positions)?state.portfolio.positions:[];
    const rows=positions.map((position)=>{
      const value=Number(position.valueUsd), share=totals.total>0&&Number.isFinite(value)?value/totals.total*100:null;
      return [position.tokenSymbol||"—",position.balance||"—",money(position.tokenPrice),money(value),pct(share),"Live BSC token balance"];
    });
    rows.push(["USDT","cash","$1.00",money(totals.cash),pct(totals.total>0?totals.cash/totals.total*100:null),"Live BSC token balance"]);
    $("pvt").textContent=money(totals.total);
    $("pvc").innerHTML='<div class="bar">'+rows.map((row)=>{
      const share=parseFloat(row[4]),width=Number.isFinite(share)?share:0,background=row[0]==="NVDAB"?"var(--gold)":row[0]==="USDT"?"#5c5546":"#a9742b";
      return '<i style="width:'+Math.max(0,Math.min(100,width))+'%;background:'+background+'"></i>';
    }).join("")+'</div><div class="tw"><table class="tb"><thead><tr><th>Asset</th><th>Holding</th><th>Price</th><th>Value</th><th>Share</th><th>Source</th></tr></thead><tbody>'+
      rows.map((row)=>"<tr>"+row.map((cell)=>"<td>"+esc(cell)+"</td>").join("")+"</tr>").join("")+
      '</tbody></table></div><p class="hint">As of '+esc(state.portfolio.asOf||"—")+'. BNB is shown as unavailable until the backend exposes a native BNB balance source; no BNB number is fabricated.</p>';
  }

  function renderHistoryView() {
    if (!$("hl") || $("v-hist")?.hidden) return;
    const history=Array.isArray(state.history?.transactions)?state.history.transactions:[];
    $("hs").textContent=history.length+" live BSC entr"+(history.length===1?"y":"ies")+".";
    const heldOnly=$("hf1")?.getAttribute("aria-pressed")==="true";
    const filtered=heldOnly?history.filter((tx)=>String(tx.txStatus||"").toUpperCase()!=="SUCCESS"):history;
    $("hl").innerHTML=filtered.map((tx)=>{
      const time=tx.txTime?new Date(tx.txTime).toLocaleString():"Unknown time", status=tx.txStatus||"UNKNOWN";
      return '<li class="'+(String(status).toUpperCase()==="SUCCESS"?"":"hold")+'"><time>'+esc(time)+'</time><b>'+esc(tx.symbol||"BSC transaction")+'</b> · '+esc(tx.amount||"")+' · '+esc(status)+'<br><span class="num">'+esc(tx.txHash||"No hash")+'</span></li>';
    }).join("")||'<li><time></time>No live blockchain transactions available.</li>';
  }

  function renderStrategyCount() {
    const count=Array.isArray(state.strategies)?state.strategies.length:0;
    if ($("sc")) $("sc").textContent=count?String(count):"";
  }

  function renderReview(review) {
    state.review=review;
    const policy=review?.policy, risk=review?.portfolioRisk, audit=review?.securityAudit;
    const quoteReady=Boolean(review?.quote);
    const policyOk=policy?.decision && policy.decision!=="BLOCK";
    const riskOk=risk?.decision==="PASS";
    const auditOk=Boolean(audit?.isSupported)&&!(typeof audit?.riskLevel==="number"&&audit.riskLevel>=4);
    const checks=[
      ["Server policy",policyOk?"Policy decision "+policy.decision:"Policy blocked the order",policy?.decision||"BLOCK",Boolean(policyOk)],
      ["Portfolio risk",riskOk?"Projected portfolio risk passed":(review?.portfolioRiskError||"Portfolio risk blocked the order"),risk?.decision||"BLOCK",riskOk],
      ["Token security audit",auditOk?"Security audit supports this token":(review?.securityAuditError||"Security audit blocks execution"),audit?.riskLevel==null?"PASS":"RISK "+audit.riskLevel,auditOk],
      ["Provider quote",quoteReady?"Provider returned a live execution quote":(review?.quoteError||"No live provider quote available"),quoteReady?"READY":"BLOCKED",quoteReady],
      ["Reference gap",Number.isFinite(Number(review?.asset?.premiumPct))?"Live NVDAB vs NVDA reference gap":"Reference price unavailable",Number.isFinite(Number(review?.asset?.premiumPct))?((Number(review.asset.premiumPct)>=0?"+":"")+Number(review.asset.premiumPct).toFixed(2)+"%"):"—",Number.isFinite(Number(review?.asset?.premiumPct))]
    ];
    if ($("checks")) $("checks").innerHTML=checks.map((item)=>'<li class="'+(item[3]?"":"fail")+'"><span class="dot '+(item[3]?"g":"r")+'"></span><span>'+esc(item[0])+'<small>'+esc(item[1])+'</small></span><span class="v">'+esc(item[2])+'</span></li>').join("");
    const executable=Boolean(review?.reviewToken&&policyOk&&riskOk&&auditOk&&quoteReady);
    if ($("approve")) {
      $("approve").disabled=state.reviewInFlight;
      $("approve").textContent=executable?"Confirm purchase":"Review blocked";
      $("approve").title=executable?"Send the reviewed transaction to the controlled execution boundary.":"The server review did not produce an executable review.";
    }
    if ($("msg")) $("msg").textContent=executable?"Live review passed. Confirmation is still required before execution.":"Live review completed. Execution remains blocked until every server gate passes.";
  }

  async function refreshMarket() {
    if (!window.HANDELO_LIVE_WORKSPACE || state.marketInFlight) return;
    state.marketInFlight=true;
    try {
      const markets=await get("/api/markets",7000), market=selectedMarket(markets);
      if (!market) throw new Error("The Handelo API returned no NVDAB market data.");
      renderMarket(market);
    } catch(error) {
      if ($("msg")) $("msg").textContent="Live market refresh delayed: "+(error.name==="AbortError"?"API timeout":error.message);
    } finally { state.marketInFlight=false; }
  }

  async function refreshAccount() {
    if (!window.HANDELO_LIVE_WORKSPACE || state.accountInFlight) return;
    state.accountInFlight=true;
    try {
      const [statusResult,addressResult]=await Promise.allSettled([get("/api/wallet/status",5000),get("/api/wallet/address",7000)]);
      state.wallet=statusResult.status==="fulfilled"?statusResult.value:{status:"UNAVAILABLE"};
      const address=addressResult.status==="fulfilled"?addressResult.value:{connected:false,address:null,error:"Wallet address unavailable."};
      state.address=address;
      if (address.connected && address.address) {
        const [portfolioResult,historyResult,strategyResult]=await Promise.allSettled([
          get("/api/portfolio?wallet="+encodeURIComponent(address.address),11000),
          get("/api/history?wallet="+encodeURIComponent(address.address),8000),
          get("/api/strategies?wallet="+encodeURIComponent(address.address),7000)
        ]);
        if(portfolioResult.status==="fulfilled"){state.portfolio=portfolioResult.value;state.portfolioError=null;}
        else if(!state.portfolio){state.portfolioError=portfolioResult.reason?.message||"Live portfolio request failed.";}
        if(historyResult.status==="fulfilled") state.history=historyResult.value;
        if(strategyResult.status==="fulfilled") state.strategies=strategyResult.value?.strategies||[];
      } else {
        state.portfolio=null; state.portfolioError=address.error||"Wallet not connected."; state.history=null; state.strategies=[];
      }
      renderWalletAndPortfolio(address,state.portfolio); renderStrategyCount(); renderPortfolioView(); renderHistoryView();
      if($("msg")){
        $("msg").textContent=state.portfolioError&&address.connected&&!state.portfolio
          ?"Live wallet connected, but portfolio data is unavailable: "+state.portfolioError
          :address.connected?"Live market + wallet state loaded from the Handelo API"
          :"Live market data loaded · connect the backend wallet for portfolio data.";
      }
    } finally { state.accountInFlight=false; }
  }

  function showWalletAuth(data) {
    document.querySelector(".live-wallet-modal")?.remove();
    const modal=document.createElement("div");
    modal.className="live-wallet-modal";
    modal.style.cssText="position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(8,6,4,.72);backdrop-filter:blur(10px);";
    modal.innerHTML='<div role="dialog" aria-modal="true" style="width:min(520px,100%);background:#110e0b;border:1px solid #3b3225;border-radius:14px;padding:28px;box-shadow:0 30px 90px rgba(0,0,0,.7)">'+
      '<div style="font:11px &quot;DM Mono&quot;,monospace;letter-spacing:.12em;color:#d4af37;margin-bottom:12px">BINANCE AGENTIC WALLET</div>'+
      '<h2 style="font:400 30px &quot;Instrument Serif&quot;,Georgia,serif;margin:0 0 10px">Connect your wallet.</h2>'+
      '<p style="color:#8d8574;margin:0 0 22px">Open the Binance sign-in page and confirm the matching code in Binance Wallet App.</p>'+
      '<div style="font:400 28px &quot;DM Mono&quot;,monospace;color:#ede6d6;letter-spacing:.18em;margin:18px 0">'+esc(data.pairingCode||"—")+'</div>'+
      '<a href="'+esc(safeAuthUrl(data.urlForWeb))+'" target="_blank" rel="noopener noreferrer" style="display:inline-block;color:#d4af37;margin-bottom:18px">Open Binance sign-in ↗</a>'+
      '<div style="color:#8d8574">Waiting for confirmation…</div>'+
      '<button type="button" class="live-wallet-close" style="margin-top:24px;border:1px solid #272119;background:none;color:#ede6d6;border-radius:4px;padding:8px 14px">Cancel</button></div>';
    modal.querySelector(".live-wallet-close").addEventListener("click",()=>modal.remove());
    modal.addEventListener("click",(event)=>{if(event.target===modal)modal.remove();});
    document.body.appendChild(modal);
  }

  let authPoll=null, authBusy=false;
  async function connectLiveWallet() {
    if(authBusy) return;
    authBusy=true;
    const button=$("wal");
    if(button){button.disabled=true;button.textContent="Connecting…";button.setAttribute("aria-busy","true");}
    try{
      const data=await get("/api/wallet/auth",10000);
      if(data.status==="SUCCESS"){await refreshAccount();return;}
      if(data.status!=="WAITING") throw new Error(data.error||"Wallet connection could not be started.");
      showWalletAuth(data);
      if(authPoll)clearInterval(authPoll);
      authPoll=window.setInterval(async()=>{
        try{
          const auth=await get("/api/wallet/auth",7000);
          if(auth.status==="SUCCESS"){
            clearInterval(authPoll);authPoll=null;document.querySelector(".live-wallet-modal")?.remove();await refreshAccount();
          }else if(auth.status==="FAILED"){
            clearInterval(authPoll);authPoll=null;document.querySelector(".live-wallet-modal")?.remove();
            if($("msg"))$("msg").textContent="Wallet connection failed: "+(auth.error||"Authentication failed.");
          }
        }catch(error){
          clearInterval(authPoll);authPoll=null;document.querySelector(".live-wallet-modal")?.remove();
          if($("msg"))$("msg").textContent="Wallet connection failed: "+(error.name==="AbortError"?"API timeout":error.message);
        }
      },2500);
    }catch(error){
      if($("msg"))$("msg").textContent="Wallet connection failed: "+(error.name==="AbortError"?"API timeout":error.message);
    }finally{
      authBusy=false;
      if(button){
        button.disabled=false;button.removeAttribute("aria-busy");
        if(state.address?.connected){
          button.innerHTML='<span class="dot g"></span>'+esc(state.address.address.slice(0,6)+"…"+state.address.address.slice(-4));
          button.className="chip wal on";
        }
      }
    }
  }

  function renderLiveChatMessage(role,text){
    const thread=$("thread"); if(!thread)return;
    const node=document.createElement("div"); node.className=role==="user"?"um":"ac";
    node.innerHTML=role==="user"?esc(text):'<h3>Handelo</h3><p>'+esc(text)+'</p>';
    thread.appendChild(node);thread.scrollTop=thread.scrollHeight;
  }

  function renderLiveChatResult(data){
    renderLiveChatMessage("assistant",data?.answer||"The Handelo API returned no answer.");
    if(data?.trace?.stages?.length){
      const node=document.createElement("div");node.className="ac";
      node.innerHTML='<p><strong>OPERATING TRACE</strong></p><p>'+esc(data.trace.stages.map((stage)=>stage.stage+": "+stage.status).join(" · "))+'</p>';
      $("thread")?.appendChild(node);
    }
    if(data?.policy){
      const node=document.createElement("div");node.className="ac";
      node.innerHTML='<p><strong>SERVER POLICY</strong></p><p>'+esc(data.policy.decision||"UNKNOWN")+' · '+esc((data.policy.reasons||[]).join(" ")||"No additional reasons.")+'</p>';
      $("thread")?.appendChild(node);
    }
    if($("thread"))$("thread").scrollTop=$("thread").scrollHeight;
  }

  function openLiveChat(prompt=""){
    if($("ov"))$("ov").hidden=false;
    if($("thread"))$("thread").innerHTML='<p class="hint">Live Handelo API · ask about NVDAB, portfolio, risk, orders or strategies.</p>';
    if($("qi"))$("qi").focus();
    if(prompt){$("qi").value=prompt;void submitLiveChat();}
  }

  async function submitLiveChat(){
    if(state.chatInFlight)return;
    const input=$("qi"), prompt=String(input?.value||"").trim();
    if(!prompt)return;
    input.value="";state.chatInFlight=true;renderLiveChatMessage("user",prompt);renderLiveChatMessage("assistant","Thinking from the live Handelo backend…");
    try{
      const data=await send("/api/chat",{message:prompt},25000);
      const thread=$("thread");if(thread?.lastElementChild)thread.lastElementChild.remove();renderLiveChatResult(data);
    }catch(error){
      const thread=$("thread");if(thread?.lastElementChild)thread.lastElementChild.remove();
      renderLiveChatMessage("assistant","Live Handelo request failed: "+(error.name==="AbortError"?"API timeout":error.message));
    }finally{state.chatInFlight=false;}
  }

  async function reviewLiveOrder(){
    if(state.reviewInFlight||!state.market)return;
    if(!state.address?.connected){await connectLiveWallet();return;}
    const qty=Math.max(1,Math.min(500,parseInt($("qty")?.value,10)||1)), tokenPrice=Number(state.market.tokenPrice);
    if(!Number.isFinite(tokenPrice)||tokenPrice<=0)return;
    state.reviewInFlight=true;state.review=null;updateLiveOrderValue();
    if($("approve")){$("approve").disabled=true;$("approve").textContent="Reviewing live order…";}
    try{
      const side=document.querySelector(".seg button[aria-pressed='true']")?.dataset.side==="sell"?"sell":"buy";
      const data=await send("/api/review",{ticker:state.market.underlyingTicker||"NVDA",amountUsd:qty*tokenPrice,action:side,fromToken:USDT,wallet:state.address.address},18000);
      renderReview(data);
    }catch(error){
      state.review=null;
      if($("checks"))$("checks").innerHTML='<li class="fail"><span class="dot r"></span><span>Server review failed<small>'+esc(error.name==="AbortError"?"The review API timed out.":error.message)+'</small></span><span class="v">ERROR</span></li>';
      if($("approve")){$("approve").disabled=false;$("approve").textContent="Review live order";}
      if($("msg"))$("msg").textContent="Live order review failed.";
    }finally{state.reviewInFlight=false;}
  }

  async function executeLiveOrder(){
    if(!state.review?.reviewToken||!state.address?.connected)return;
    state.reviewInFlight=true;if($("approve")){$("approve").disabled=true;$("approve").textContent="Executing…";}
    try{
      const qty=Math.max(1,Math.min(500,parseInt($("qty")?.value,10)||1)),tokenPrice=Number(state.market?.tokenPrice);
      const result=await send("/api/execute",{ticker:state.market?.underlyingTicker||"NVDA",amountUsd:qty*tokenPrice,fromToken:USDT,reviewToken:state.review.reviewToken,wallet:state.address.address,confirmed:true},25000);
      if($("msg"))$("msg").textContent=result?.result?.txHash?"Execution submitted · "+result.result.txHash:"Execution completed without a transaction hash.";
      state.review=null;await Promise.all([refreshMarket(),refreshAccount()]);
    }catch(error){
      if($("msg"))$("msg").textContent="Execution was not completed: "+error.message;
      if($("approve"))$("approve").disabled=false;
    }finally{
      state.reviewInFlight=false;
      if($("approve")&&!state.review)$("approve").textContent=state.address?.connected?"Review live order":"Connect wallet to review";
    }
  }

  function interceptLiveClicks(event){
    if(!window.HANDELO_LIVE_WORKSPACE)return;
    const target=event.target instanceof Element?event.target.closest("button,[role='button']"):null;
    if(!target)return;
    if(target.id==="wal"){event.preventDefault();event.stopImmediatePropagation();void connectLiveWallet();return;}
    if(target.id==="approve"){event.preventDefault();event.stopImmediatePropagation();if(state.review?.reviewToken)void executeLiveOrder();else void reviewLiveOrder();return;}
    if(target.id==="ag"){event.preventDefault();event.stopImmediatePropagation();openLiveChat("Compare NVDAB and NVDA using the latest live market data.");return;}
    if(target.id==="askb"||target.id==="askf"){event.preventDefault();event.stopImmediatePropagation();openLiveChat();return;}
    if(target.id==="bs"){event.preventDefault();event.stopImmediatePropagation();openLiveChat("Help me design a governed recurring buy strategy for NVDAB. Keep it as a draft until I explicitly approve it.");return;}
    if(target.id==="hf0"||target.id==="hf1"){event.preventDefault();event.stopImmediatePropagation();target.setAttribute("aria-pressed",target.id==="hf1"?"true":"false");const other=target.id==="hf1"?$("hf0"):$("hf1");other?.setAttribute("aria-pressed",target.id==="hf1"?"false":"true");renderHistoryView();}
  }

  function interceptLiveInputs(event){
    if(!window.HANDELO_LIVE_WORKSPACE)return;
    if(event.target?.id==="qty"){state.review=null;updateLiveOrderValue();if($("approve"))$("approve").textContent=state.address?.connected?"Review live order":"Connect wallet to review";}
  }

  function interceptLiveChat(event){
    if(!window.HANDELO_LIVE_WORKSPACE)return;
    if(event.target?.id==="send"){event.preventDefault();event.stopImmediatePropagation();void submitLiveChat();return;}
    if(event.target?.id==="qi"&&event.key==="Enter"){event.preventDefault();event.stopImmediatePropagation();void submitLiveChat();return;}
    if(event.target?.closest("#qs")){const button=event.target.closest("[data-q]");if(!button)return;event.preventDefault();event.stopImmediatePropagation();openLiveChat(button.dataset.q||"");}
  }

  function syncView(view){if(!window.HANDELO_LIVE_WORKSPACE)return;if(view==="port")renderPortfolioView();if(view==="hist")renderHistoryView();}
  function load(){if(!window.HANDELO_LIVE_WORKSPACE)return;if(!state.entered)enter();void refreshMarket();void refreshAccount();}

  document.addEventListener("click",interceptLiveClicks,true);
  document.addEventListener("input",interceptLiveInputs,true);
  document.addEventListener("keydown",interceptLiveChat,true);

  window.HandeloLiveWorkspace={enter,load,syncView};

  if(location.hash.includes("mode=live")){window.HANDELO_LIVE_WORKSPACE=true;enter();}

  window.addEventListener("hashchange",()=>{
    if(!window.HANDELO_LIVE_WORKSPACE)return;
    if(location.hash.includes("mode=live")){const view=location.hash.split("?")[0].replace("#","");syncView(view==="workspace"?"work":view);load();}
  });

  window.setInterval(()=>{if(window.HANDELO_LIVE_WORKSPACE)void refreshMarket();},5000);
  window.setInterval(()=>{if(window.HANDELO_LIVE_WORKSPACE)void refreshAccount();},20000);
})();