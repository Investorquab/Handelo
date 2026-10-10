(() => {
  const DEFAULT_API_BASE = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:8787"
  : "";
const API_BASE = window.HANDELO_API_URL || localStorage.getItem("handelo_api_url") || DEFAULT_API_BASE;
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const state = {
    market: null, portfolio: null, portfolioError: null, wallet: null, address: null,
    walletBalances: [], walletBalancesError: null, history: null, strategies: [], liveSamples: [], review: null, entered: false,
    marketInFlight: false, accountInFlight: false, reviewInFlight: false, chatInFlight: false,
    streamSource: null, streamReconnectTimer: null, streamAttempt: 0
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

  function closeLiveStream(resetAttempt = true){
    if(state.streamReconnectTimer){clearTimeout(state.streamReconnectTimer);state.streamReconnectTimer=null;}
    if(state.streamSource){state.streamSource.close();state.streamSource=null;}
    if(resetAttempt)state.streamAttempt=0;
  }

  function scheduleLiveStreamReconnect(){
    if(!window.HANDELO_LIVE_WORKSPACE||state.streamReconnectTimer)return;
    state.streamAttempt=Math.min(state.streamAttempt+1,6);
    const delay=Math.min(10000,1000*Math.pow(2,state.streamAttempt-1));
    state.streamReconnectTimer=setTimeout(()=>{
      state.streamReconnectTimer=null;
      if(window.HANDELO_LIVE_WORKSPACE)void connectWorkspaceStream();
    },delay);
  }

  async function connectWorkspaceStream(){
    if(!window.HANDELO_LIVE_WORKSPACE)return;
    closeLiveStream(false);
    const currentWallet=state.address?.connected?state.address.address:"";
    const query=currentWallet?"?wallet="+encodeURIComponent(currentWallet):"";
    try{
      const snapshot=await get("/api/workspace/snapshot"+query,9000);
      if(!window.HANDELO_LIVE_WORKSPACE)return;
      applyWorkspaceSnapshot(snapshot);
    }catch(error){
      if($("msg"))$("msg").textContent="Live workspace snapshot delayed: "+(error.name==="AbortError"?"API timeout":error.message);
    }
    if(!window.HANDELO_LIVE_WORKSPACE)return;
    const controller=new AbortController();
    const source={close:()=>controller.abort()};
    state.streamSource=source;
    try{
      const response=await fetch(API_BASE+"/api/workspace/stream"+query,{
        method:"GET",headers:{accept:"text/event-stream"},cache:"no-store",signal:controller.signal
      });
      if(!response.ok)throw new Error("Live stream request failed (HTTP "+response.status+").");
      if(!response.body)throw new Error("Streaming responses are not supported by this browser.");
      state.streamAttempt=0;
      if($("msg"))$("msg").textContent="Live workspace connected";
      const reader=response.body.getReader();
      const decoder=new TextDecoder();
      let buffered="";
      while(window.HANDELO_LIVE_WORKSPACE&&!controller.signal.aborted){
        const item=await reader.read();
        if(item.done)break;
        buffered+=decoder.decode(item.value,{stream:true});
        let separator;
        while((separator=buffered.indexOf("\n\n"))>=0){
          const frame=buffered.slice(0,separator);
          buffered=buffered.slice(separator+2);
          const data=frame.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
          if(!data)continue;
          try{
            const message=JSON.parse(data);
            if(message.type==="snapshot"){applyWorkspaceSnapshot(message.data);continue;}
            if(message.type==="market"){if(message.data)renderMarket(message.data);continue;}
            if(message.type==="account"){applyWorkspaceAccount(message.data);continue;}
          }catch(error){
            if($("msg"))$("msg").textContent="Live stream message ignored: "+(error instanceof Error?error.message:String(error));
          }
        }
      }
      try{await reader.cancel();}catch{}
    }catch(error){
      if(!controller.signal.aborted&&$("msg"))$("msg").textContent="Live stream reconnecting…";
    }finally{
      if(state.streamSource===source)state.streamSource=null;
      if(!controller.signal.aborted&&window.HANDELO_LIVE_WORKSPACE){
        if($("msg"))$("msg").textContent="Live stream reconnecting…";
        scheduleLiveStreamReconnect();
      }
    }
  }
  function ensureLiveFundingControl(){
    if(document.getElementById("live-funding-wrap"))return;
    const order=document.querySelector(".policy .order");
    if(!order)return;
    const wrap=document.createElement("label");
    wrap.id="live-funding-wrap";
    wrap.style.cssText="display:flex;align-items:center;gap:10px;margin-top:10px;font-size:12px;color:var(--mute);";
    wrap.innerHTML='<span id="live-funding-label">Pay with</span><select id="live-funding-token" aria-label="Funding token" style="flex:1;min-width:145px;background:#0d0b09;border:1px solid var(--line);color:var(--ink);border-radius:5px;padding:6px 8px;font:12px monospace"></select>';
    order.parentElement.insertBefore(wrap,order.nextSibling);
    $("live-funding-token")?.addEventListener("change",()=>{
      state.review=null;
      updateLiveOrderValue();
      if($("approve"))$("approve").textContent=state.address?.connected?"Review live order":"Connect wallet to review";
    });
  }

  function selectedFundingBalance(){
    const address=String($("live-funding-token")?.value||"").toLowerCase();
    return state.walletBalances.find(balance=>String(balance?.address||"").toLowerCase()===address)||null;
  }

  const LIVE_NATIVE_BNB="0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const LIVE_USDT="0x55d398326f99059fF775485246999027B3197955";
  const LIVE_USDC="0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

  function currentLiveSide(){
    return document.querySelector('.seg button[aria-pressed="true"]')?.dataset.side==="sell"?"sell":"buy";
  }

  function selectedFundingBalance(){
    const address=String($("live-funding-token")?.value||"").toLowerCase();
    const side=currentLiveSide();
    if(side==="sell"){
      const known=[
        {symbol:"BNB",address:LIVE_NATIVE_BNB,price:null,value:null,balance:null},
        {symbol:"USDT",address:LIVE_USDT,price:null,value:null,balance:null},
        {symbol:"USDC",address:LIVE_USDC,price:null,value:null,balance:null}
      ];
      return known.find(token=>token.address.toLowerCase()===address)||null;
    }
    return state.walletBalances.find(balance=>String(balance?.address||"").toLowerCase()===address)||null;
  }

  function renderTradeMode(){
    ensureLiveFundingControl();
    const side=currentLiveSide();
    const label=$("live-funding-label"),select=$("live-funding-token"),qty=$("qty"),approve=$("approve");
    if(label)label.textContent=side==="sell"?"Receive":"Pay with";
    if(select)select.setAttribute("aria-label",side==="sell"?"Receive token":"Funding token");

    if(qty){
      if(side==="sell"){
        const held=state.walletBalances.find(b=>String(b.symbol||"").toUpperCase()==="NVDAB");
        const max=Number(held?.balance);
        qty.min="0.000001";
        qty.step="0.000001";
        qty.max=Number.isFinite(max)&&max>0?String(max):"500";
        if(Number(qty.value)>Number(qty.max))qty.value=qty.max;
        if(Number(qty.value)<=0)qty.value="0.000001";
      }else{
        qty.min="1";
        qty.step="1";
        qty.max="500";
        if(!qty.value||Number(qty.value)<1)qty.value="1";
      }
    }

    if(!select)return;
    const current=select.value;

    if(side==="sell"){
      const options=[
        {symbol:"BNB",address:LIVE_NATIVE_BNB},
        {symbol:"USDT",address:LIVE_USDT},
        {symbol:"USDC",address:LIVE_USDC}
      ];
      select.innerHTML=options.map(token=>{
        const liveBalance=state.walletBalances.find(b=>String(b.address||"").toLowerCase()===token.address.toLowerCase());
        const suffix=liveBalance?.balance?" · "+liveBalance.balance:"";
        return '<option value="'+token.address+'">'+token.symbol+esc(suffix)+'</option>';
      }).join("");
      if(options.some(token=>token.address.toLowerCase()===current.toLowerCase()))select.value=current;
      else select.value=LIVE_USDT;
    }else{
      const target=String(state.market?.tokenSymbol||"NVDAB").toUpperCase();
      const balances=state.walletBalances.filter(balance=>{
        const symbol=String(balance?.symbol||"").toUpperCase();
        const value=Number(balance?.value),price=Number(balance?.price);
        return String(balance?.binanceChainId||"56")==="56"&&symbol!==target&&Number.isFinite(value)&&value>0&&Number.isFinite(price)&&price>0;
      });
      select.innerHTML=balances.map(balance=>'<option value="'+esc(balance.address||"")+'">'+esc(String(balance.symbol||"").toUpperCase())+" · "+esc(String(balance.balance||"0"))+" · "+esc(money(balance.value))+"</option>").join("");
      const same=balances.find(balance=>String(balance.address||"").toLowerCase()===current.toLowerCase());
      if(same)select.value=same.address;
      else{
        const usdt=balances.find(balance=>String(balance.symbol||"").toUpperCase()==="USDT");
        const bnb=balances.find(balance=>String(balance.symbol||"").toUpperCase()==="BNB");
        const first=usdt||bnb||balances[0];
        if(first)select.value=first.address;
      }
      if(!balances.length)select.innerHTML='<option value="">No funded token available</option>';
    }

    updateLiveOrderValue();
    if(approve && !state.review)approve.textContent=state.address?.connected?(side==="sell"?"Review live sell":"Review live buy"):(side==="sell"?"Connect wallet to sell":"Connect wallet to review");
  }

  function resetLiveSurface(){closeWalletMenu();closeLiveStream();
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
    ensureLiveFundingControl();
    if ($("live-funding-token")) $("live-funding-token").innerHTML='<option value="">Waiting for wallet balances…</option>';
    if ($("checks")) $("checks").innerHTML = '<li><span class="dot"></span><span>Connect your wallet to review a real order<small>Handelo will use the backend policy, portfolio, security and provider quote services.</small></span><span class="v">WAITING</span></li>';
    if ($("msg")) $("msg").textContent = "Connecting to Handelo API…";
    if ($("sus")) $("sus").innerHTML = '<span class="dot"></span> Connecting';
    ["tp","sr","st","sg","sv","slq","tot","pn","pb","pu","gv"].forEach((id) => { if ($(id)) $(id).textContent = "—"; });
    ["bn","bb","bu"].forEach((id) => { if ($(id)) $(id).style.width = "0%"; });
    if ($("gp")) $("gp").setAttribute("stroke-dasharray", "0 100");
    if ($("gl")) { $("gl").textContent = "Waiting for live portfolio data"; $("gl").style.color = "var(--mute)"; }
    if ($("chart")) $("chart").innerHTML = '<div class="msg">LIVE API · waiting for first market sample…</div>';
    state.market = null; state.portfolio = null; state.portfolioError = null; state.wallet = null; state.address = null;
    state.walletBalances = []; state.walletBalancesError = null; state.history = null; state.strategies = []; state.review = null; state.liveSamples = [];
    const small = document.querySelector("#v-port .title small");
    if (small) small.textContent = "Live BSC balances from the Handelo API";
  }

  function enter() {
    if (!window.HANDELO_LIVE_WORKSPACE) return;
    installLiveChatStyles();
    state.entered = true;
    resetLiveSurface();
    void connectWorkspaceStream();
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

  function updateLiveOrderValue(){
    const side=currentLiveSide();
    const qty=Math.max(0.000001,Number($("qty")?.value)||0);
    const tokenPrice=Number(state.market?.tokenPrice);
    const selected=selectedFundingBalance();
    if(!Number.isFinite(tokenPrice)||tokenPrice<=0){if($("ordv"))$("ordv").textContent="—";return;}
    if(side==="sell"){
      if(!selected){if($("ordv"))$("ordv").textContent="Choose a receiving token";return;}
      const proceeds=qty*tokenPrice;
      if($("ordv"))$("ordv").textContent="≈ "+money(proceeds)+" in "+String(selected.symbol||"").toUpperCase()+" before fees";
      return;
    }
    if(!selected){if($("ordv"))$("ordv").textContent="Choose a funding token";return;}
    const usd=qty*tokenPrice;
    const sourcePrice=Number(selected.price);
    if($("ordv")){
      if(Number.isFinite(sourcePrice)&&sourcePrice>0){
        const sourceQty=usd/sourcePrice;
        $("ordv").textContent=money(usd)+" · ≈ "+sourceQty.toFixed(8)+" "+String(selected.symbol||"").toUpperCase();
      }else $("ordv").textContent=money(usd)+" · "+String(selected.symbol||"").toUpperCase();
    }
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
    renderTradeMode();
  }

  function portfolioTotals(portfolio) {
    const tokenTotal = Number(portfolio?.totalValueUsd ?? portfolio?.totalEstimatedValueUsd), cash = Number(portfolio?.balanceUsd);
    return {
      tokenTotal: Number.isFinite(tokenTotal) && tokenTotal >= 0 ? tokenTotal : 0,
      cash: Number.isFinite(cash) && cash >= 0 ? cash : 0,
      total: (Number.isFinite(tokenTotal) && tokenTotal >= 0 ? tokenTotal : 0) + (Number.isFinite(cash) && cash >= 0 ? cash : 0)
    };
  }

  function applyWorkspaceAccount(account){
    if(!account)return;
    state.wallet=account.wallet||null;
    state.address=account.address||{connected:false,address:null};
    state.portfolio=account.portfolio||null;
    state.portfolioError=account.portfolioError||null;
    state.walletBalances=Array.isArray(account.walletBalances)?account.walletBalances:[];
    state.walletBalancesError=account.walletBalancesError||null;
    state.history=account.history||null;
    state.strategies=Array.isArray(account.strategies)?account.strategies:[];
    renderWalletAndPortfolio(state.address,state.portfolio);
    renderLiveBalances();
    renderTradeMode();
    renderStrategyCount();
    renderPortfolioView();
    renderHistoryView();
  }

  function applyWorkspaceSnapshot(snapshot){
    if(!snapshot)return;
    if(snapshot.market)renderMarket(snapshot.market);
    applyWorkspaceAccount(snapshot.account||{
      wallet:snapshot.wallet,
      address:snapshot.address,
      portfolio:snapshot.portfolio,
      portfolioError:snapshot.portfolioError,
      walletBalances:snapshot.walletBalances,
      walletBalancesError:snapshot.walletBalancesError,
      history:snapshot.history,
      strategies:snapshot.strategies
    });
    if($("msg")){
      $("msg").textContent=snapshot.account?.portfolioError
        ?"Live market loaded · portfolio refresh failed: "+snapshot.account.portfolioError
        :snapshot.address?.connected
          ?"Live market + wallet data loaded"
          :"Live market data loaded · wallet not connected";
    }
  }
  function liveBalanceTotal(){
    return state.walletBalances.reduce((sum,balance)=>{
      const value=Number(balance?.value);
      return sum+(Number.isFinite(value)&&value>0?value:0);
    },0);
  }

  function renderLiveBalances(){
    const portfolioSection=document.querySelector("#v-work .two");
    if(!portfolioSection)return;
    let host=document.getElementById("live-balance-list");
    if(!host){
      host=document.createElement("div");
      host.id="live-balance-list";
      host.style.cssText="grid-column:1/-1;margin-top:8px;border-top:1px solid var(--line);padding-top:18px;";
      portfolioSection.appendChild(host);
    }
    if(!state.address?.connected){
      host.innerHTML='<div class="hint">Connect the wallet to load live BSC balances.</div>';
      return;
    }
    const balances=state.walletBalances.filter(balance=>String(balance?.binanceChainId||"56")==="56");
    if(!balances.length){
      host.innerHTML='<div class="hint">'+esc(state.walletBalancesError||"No BSC token balances worth $0.01 or more were returned by Binance Agentic Wallet.")+'</div>';
      return;
    }
    const total=liveBalanceTotal();
    host.innerHTML=
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px">'+
        '<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute)">Live BSC balances</div>'+
        '<div style="font-family:monospace;font-size:12px;color:var(--mute)">'+esc(money(total))+'</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px">'+
      balances.map(balance=>{
        const value=Number(balance.value), share=total>0&&Number.isFinite(value)?value/total*100:null;
        const symbol=String(balance.symbol||"—").toUpperCase();
        return '<div style="border:1px solid var(--line);background:#0e0c0a;border-radius:8px;padding:12px">'+
          '<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:7px"><b>'+esc(symbol)+'</b><span style="color:var(--gold);font-family:monospace">'+esc(money(value))+'</span></div>'+
          '<div style="font-family:monospace;color:var(--ink);font-size:12px;margin-bottom:6px">'+esc(balance.balance||"—")+'</div>'+
          '<div style="font-family:monospace;color:var(--mute);font-size:10px;word-break:break-all;margin-bottom:7px">'+esc(balance.address||"—")+'</div>'+
          '<div style="color:var(--mute);font-size:11px">Price '+esc(money(balance.price))+' · '+esc(pct(share))+'</div>'+
        '</div>';
      }).join("")+
      '</div>'+
      '<div class="hint" style="margin-top:10px">Source: Binance Agentic Wallet · BNB Smart Chain. Provider omits balances below $0.01.</div>';
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
    const walletTotal=liveBalanceTotal();
    const displayTotal=walletTotal>0?walletTotal:totals.total;
    const nvdabValue=state.walletBalances.filter((b)=>String(b.symbol||"").toUpperCase()==="NVDAB").reduce((sum,b)=>sum+(Number(b.value)||0),0);
    const bnbValue=state.walletBalances.filter((b)=>String(b.symbol||"").toUpperCase()==="BNB").reduce((sum,b)=>sum+(Number(b.value)||0),0);
    const usdtValue=state.walletBalances.filter((b)=>String(b.symbol||"").toUpperCase()==="USDT").reduce((sum,b)=>sum+(Number(b.value)||0),0);
    const nvdabShare=displayTotal>0?nvdabValue/displayTotal*100:0;
    const bnbShare=displayTotal>0?bnbValue/displayTotal*100:0;
    const usdtShare=displayTotal>0?usdtValue/displayTotal*100:0;
    if ($("tot")) $("tot").textContent=money(displayTotal);
    if ($("pn")) $("pn").textContent=pct(nvdabShare);
    if ($("pb")) $("pb").textContent=pct(bnbShare);
    if ($("pu")) $("pu").textContent=pct(usdtShare);
    if ($("bn")) $("bn").style.width=Math.max(0,Math.min(100,nvdabShare))+"%";
    if ($("bb")) $("bb").style.width=Math.max(0,Math.min(100,bnbShare))+"%";
    if ($("bu")) $("bu").style.width=Math.max(0,Math.min(100,usdtShare))+"%";
    if ($("gp")) $("gp").setAttribute("stroke-dasharray","0 100");
    if ($("gv")) $("gv").textContent="—";
    if ($("gl")) {
      $("gl").textContent=state.walletBalancesError
        ?"Live balances partially unavailable: "+state.walletBalancesError
        :"Live BSC balances · risk score is calculated server-side during review";
      $("gl").style.color="var(--mute)";
    }
    renderLiveBalances();
    renderPortfolioView();
  }

  function renderPortfolioView() {
    if (!$("pvt") || $("v-port")?.hidden) return;
    const subtitle=document.querySelector("#v-port .title small"), totalLabel=$("pvt")?.nextElementSibling;
    if (subtitle) subtitle.textContent="Live BSC balances from Binance Agentic Wallet";
    if (totalLabel) totalLabel.textContent="LIVE API · all BSC balances";

    if (!state.address?.connected) {
      $("pvt").textContent="—";
      $("pvc").innerHTML='<p class="hint">Connect a wallet to load live BSC balances.</p>';
      return;
    }

    const balances=state.walletBalances.filter(item=>String(item?.binanceChainId||"56")==="56");
    if (!balances.length) {
      $("pvt").textContent="—";
      $("pvc").innerHTML='<p class="hint">'+esc(state.walletBalancesError||"No BSC token balances worth $0.01 or more were returned by Binance Agentic Wallet.")+'</p>';
      return;
    }

    const total=liveBalanceTotal();
    const rows=balances.map(balance=>{
      const value=Number(balance.value);
      const share=total>0&&Number.isFinite(value)?value/total*100:null;
      return [
        balance.symbol||"—",
        balance.balance||"—",
        money(balance.price),
        money(value),
        pct(share),
        "Binance Agentic Wallet",
        balance.address||"—"
      ];
    });

    $("pvt").textContent=money(total);
    $("pvc").innerHTML=
      '<div class="bar">'+rows.map((row)=>{
        const share=parseFloat(row[4]),width=Number.isFinite(share)?share:0;
        const background=String(row[0]).toUpperCase()==="NVDAB"?"var(--gold)":String(row[0]).toUpperCase()==="BNB"?"#a9742b":String(row[0]).toUpperCase()==="USDT"?"#5c5546":"#7d6b48";
        return '<i style="width:'+Math.max(0,Math.min(100,width))+'%;background:'+background+'"></i>';
      }).join("")+
      '</div><div class="tw"><table class="tb"><thead><tr><th>Asset</th><th>Balance</th><th>Price</th><th>Value</th><th>Share</th><th>Source</th><th>Contract</th></tr></thead><tbody>'+
      rows.map((row)=>"<tr>"+row.map((cell)=>"<td>"+esc(cell)+"</td>").join("")+"</tr>").join("")+
      '</tbody></table></div><p class="hint">Real-time BSC wallet balances. Binance Agentic Wallet omits balances below $0.01.</p>';
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
      $("approve").textContent=executable?(review?.action==="sell"?"Confirm sale":"Confirm purchase"):"Review blocked";
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
      if(data.status==="SUCCESS"){await connectWorkspaceStream();return;}
      if(data.status!=="WAITING") throw new Error(data.error||"Wallet connection could not be started.");
      showWalletAuth(data);
      if(authPoll)clearInterval(authPoll);
      authPoll=window.setInterval(async()=>{
        try{
          const auth=await get("/api/wallet/auth",7000);
          if(auth.status==="SUCCESS"){
            clearInterval(authPoll);authPoll=null;document.querySelector(".live-wallet-modal")?.remove();await connectWorkspaceStream();
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

  function formatLiveAssistantText(rawText){
    const source=String(rawText??"").replace(/\r\n?/g,"\n").replace(/^\s*```(?:markdown|md)?\s*/i,"").replace(/\s*```\s*$/i,"");
    const blocks=[];let paragraph=[];let listType=null;let listItems=[];
    const inline=(raw)=>{
      let value=esc(raw);
      value=value.replace(/`([^`]+)`/g,"<code>$1</code>").replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/__([^_]+)__/g,"<strong>$1</strong>").replace(/\*([^*]+)\*/g,"<em>$1</em>").replace(/_([^_]+)_/g,"<em>$1</em>").replace(/\*\*/g,"").replace(/__/g,"");
      return value;
    };
    const flushList=()=>{if(!listType||!listItems.length)return;blocks.push("<"+listType+">"+listItems.map((item)=>"<li>"+inline(item)+"</li>").join("")+"</"+listType+">");listType=null;listItems=[];};
    const flushParagraph=()=>{if(!paragraph.length)return;blocks.push("<p>"+inline(paragraph.join(" "))+"</p>");paragraph=[];};
    for(const rawLine of source.split("\n")){
      const line=rawLine.trim();
      if(!line){flushParagraph();flushList();continue;}
      const heading=line.match(/^#{1,4}\s+(.+)$/);
      if(heading){flushParagraph();flushList();blocks.push("<h4>"+inline(heading[1])+"</h4>");continue;}
      const numbered=line.match(/^\d+[.)]\s+(.+)$/);
      if(numbered){flushParagraph();if(listType!=="ol")flushList();listType="ol";listItems.push(numbered[1]);continue;}
      const bullet=line.match(/^[-•]\s+(.+)$/);
      if(bullet){flushParagraph();if(listType!=="ul")flushList();listType="ul";listItems.push(bullet[1]);continue;}
      if(listType)flushList();paragraph.push(line);
    }
    flushParagraph();flushList();return blocks.join("");
  }
  function installLiveChatStyles(){
    if(document.getElementById("live-chat-styles"))return;
    const style=document.createElement("style");style.id="live-chat-styles";
    style.textContent=".live-chat-rich{line-height:1.65;color:var(--ink)}.live-chat-rich p{margin:0 0 12px}.live-chat-rich h4{margin:14px 0 8px;font-size:14px;color:var(--gold);font-weight:600}.live-chat-rich ul,.live-chat-rich ol{margin:8px 0 14px 20px;padding:0}.live-chat-rich li{margin:5px 0}.live-chat-rich strong{color:var(--ink);font-weight:700}.live-chat-rich em{color:var(--gold)}.live-chat-rich code{font-family:monospace;font-size:.92em;border:1px solid var(--line);padding:1px 4px;border-radius:4px}";
    document.head.appendChild(style);
  }
  function closeWalletMenu(){const menu=document.querySelector(".live-wallet-menu");if(!menu)return;if(menu._cleanup)menu._cleanup();menu.remove();}
  function showWalletMenu(){
    closeWalletMenu();
    const address=state.address?.address;if(!state.address?.connected||!address)return;
    const menu=document.createElement("div");menu.className="live-wallet-menu";
    menu.style.cssText="position:fixed;z-index:120;min-width:310px;background:#110e0b;border:1px solid #3b3225;border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.55);padding:16px;color:#ede6d6;font-family:Manrope,sans-serif;";
    menu.innerHTML='<div style="font-size:10px;letter-spacing:.13em;color:#8d8574;text-transform:uppercase;margin-bottom:10px">CONNECTED WALLET</div>'+
      '<div style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px"><span class="dot g"></span><span>Binance Agentic Wallet</span></div>'+
      '<div style="font-family:monospace;font-size:12px;color:#b8b0a0;word-break:break-all;border:1px solid #272119;background:#0d0b09;border-radius:8px;padding:10px;margin-bottom:12px">'+esc(address)+'</div>'+
      '<div style="display:flex;gap:8px"><button type="button" id="live-wallet-copy" style="flex:1;border:1px solid #3b3225;background:#17130f;color:#ede6d6;border-radius:7px;padding:10px 12px;cursor:pointer">Copy address</button>'+
      '<button type="button" id="live-wallet-disconnect" style="flex:1;border:1px solid rgba(201,85,72,.55);background:rgba(201,85,72,.08);color:#e6a49b;border-radius:7px;padding:10px 12px;cursor:pointer">Disconnect</button></div>';
    const rect=$("wal")?.getBoundingClientRect();
    const top=Math.min(window.innerHeight-210,(rect?.bottom??70)+8);
    const left=Math.max(12,Math.min(window.innerWidth-330,(rect?.right??330)-310));
    menu.style.top=top+"px";menu.style.left=left+"px";
    menu.querySelector("#live-wallet-copy").addEventListener("click",async()=>{const button=menu.querySelector("#live-wallet-copy");try{await navigator.clipboard.writeText(address);button.textContent="Copied";window.setTimeout(()=>{if(button.isConnected)button.textContent="Copy address";},1400);}catch{button.textContent="Copy failed";window.setTimeout(()=>{if(button.isConnected)button.textContent="Copy address";},1400);}});
    menu.querySelector("#live-wallet-disconnect").addEventListener("click",async()=>{const button=menu.querySelector("#live-wallet-disconnect");button.disabled=true;button.textContent="Disconnecting…";try{await send("/api/wallet/signout",{},10000);closeWalletMenu();state.review=null;state.portfolio=null;state.history=null;state.strategies=[];state.portfolioError="Wallet disconnected.";await connectWorkspaceStream();if($("msg"))$("msg").textContent="Wallet disconnected.";}catch(error){button.disabled=false;button.textContent="Disconnect";if($("msg"))$("msg").textContent="Wallet disconnect failed: "+(error.name==="AbortError"?"API timeout":error.message);}});
    const outside=(event)=>{if(!menu.contains(event.target)&&event.target!==$("wal"))closeWalletMenu();};
    const escape=(event)=>{if(event.key==="Escape")closeWalletMenu();};
    menu._cleanup=()=>{document.removeEventListener("click",outside,true);document.removeEventListener("keydown",escape,true);};
    document.addEventListener("click",outside,true);document.addEventListener("keydown",escape,true);
    document.body.appendChild(menu);
  }
  function renderLiveChatMessage(role,text){
    const thread=$("thread"); if(!thread)return;
    const node=document.createElement("div"); node.className=role==="user"?"um":"ac";
    node.innerHTML=role==="user"?esc(text):'<h3>Handelo</h3><div class="live-chat-rich">'+formatLiveAssistantText(text)+"</div>";
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
    const side=currentLiveSide();
    const qty=Math.max(0.000001,Number($("qty")?.value)||0);
    const tokenPrice=Number(state.market.tokenPrice);
    const selected=selectedFundingBalance();
    if(!Number.isFinite(tokenPrice)||tokenPrice<=0||!Number.isFinite(qty)||qty<=0)return;
    if(!selected){
      if($("msg"))$("msg").textContent=side==="sell"?"Choose a receiving token for the NVDAB sale.":"Choose a funded BSC token to pay for NVDAB.";
      return;
    }
    if(side==="sell"){
      const held=state.walletBalances.find(b=>String(b.symbol||"").toUpperCase()==="NVDAB");
      const heldQty=Number(held?.balance);
      if(!Number.isFinite(heldQty)||heldQty<qty){
        if($("msg"))$("msg").textContent="Insufficient NVDAB balance for this sale.";
        return;
      }
    }
    state.reviewInFlight=true;state.review=null;updateLiveOrderValue();
    if($("approve")){$("approve").disabled=true;$("approve").textContent=side==="sell"?"Reviewing live sale…":"Reviewing live buy…";}
    try{
      const body={
        ticker:state.market.tokenSymbol||"NVDAB",
        amountUsd:qty*tokenPrice,
        action:side,
        fromToken:side==="sell"?String(state.market.tokenContractAddress||state.market.contract||""):String(selected.address||""),
        fromTokenQty:String(qty),
        toToken:side==="sell"?String(selected.address||""):String(state.market.tokenContractAddress||state.market.contract||""),
        wallet:state.address.address
      };
      const data=await send("/api/review",body,18000);
      data.fromToken=body.fromToken;
      data.toToken=body.toToken;
      data.action=side;
      renderReview(data);
    }catch(error){
      state.review=null;
      if($("checks"))$("checks").innerHTML='<li class="fail"><span class="dot r"></span><span>Server review failed<small>'+esc(error.name==="AbortError"?"The review API timed out.":error.message)+'</small></span><span class="v">ERROR</span></li>';
      if($("approve")){$("approve").disabled=false;$("approve").textContent=side==="sell"?"Review live sell":"Review live buy";}
      if($("msg"))$("msg").textContent=side==="sell"?"Live sell review failed.":"Live buy review failed.";
    }finally{state.reviewInFlight=false;}
  }

async function executeLiveOrder(){
    if(!state.review?.reviewToken||!state.address?.connected)return;
    state.reviewInFlight=true;
    if($("approve")){$("approve").disabled=true;$("approve").textContent=state.review.action==="sell"?"Executing sell…":"Executing buy…";}
    try{
      const result=await send("/api/execute",{
        ticker:state.market?.tokenSymbol||"NVDAB",
        amountUsd:Number(state.review.amountUsd),
        action:state.review.action||currentLiveSide(),
        fromToken:state.review.fromToken||"",
        toToken:state.review.toToken||"",
        reviewToken:state.review.reviewToken,
        wallet:state.address.address,
        confirmed:true
      },25000);
      if($("msg"))$("msg").textContent=result?.result?.txHash?"Execution submitted · "+result.result.txHash:"Execution completed without a transaction hash.";
      state.review=null;
      await connectWorkspaceStream();
    }catch(error){
      if($("msg"))$("msg").textContent="Execution was not completed: "+error.message;
      if($("approve"))$("approve").disabled=false;
    }finally{
      state.reviewInFlight=false;
      if($("approve")&&!state.review)$("approve").textContent=state.address?.connected?(currentLiveSide()==="sell"?"Review live sell":"Review live buy"):(currentLiveSide()==="sell"?"Connect wallet to sell":"Connect wallet to review");
    }
  }

  function interceptLiveClicks(event){
    if(!window.HANDELO_LIVE_WORKSPACE)return;
    const target=event.target instanceof Element?event.target.closest("button,[role='button']"):null;
    if(!target)return;
    if(target.matches(".seg button")){
      event.preventDefault();event.stopImmediatePropagation();
      document.querySelectorAll(".seg button").forEach(button=>button.setAttribute("aria-pressed",button===target?"true":"false"));
      state.review=null;
      renderTradeMode();
      if($("msg"))$("msg").textContent=target.dataset.side==="sell"?"Live sell mode · choose the NVDAB amount and receiving token.":"Live buy mode · choose the funding token and NVDAB amount.";
      return;
    }
    if(target.id==="wal"){event.preventDefault();event.stopImmediatePropagation();if(state.address?.connected){if(document.querySelector(".live-wallet-menu"))closeWalletMenu();else showWalletMenu();}else{void connectLiveWallet();}return;}
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
  function load(){if(!window.HANDELO_LIVE_WORKSPACE)return;if(!state.entered)enter();else if(!state.streamSource)void connectWorkspaceStream();}

  document.addEventListener("click",interceptLiveClicks,true);
  document.addEventListener("input",interceptLiveInputs,true);
  document.addEventListener("keydown",interceptLiveChat,true);

  window.HandeloLiveWorkspace={enter,load,syncView};

  if(location.hash.includes("mode=live")){window.HANDELO_LIVE_WORKSPACE=true;enter();}

  window.addEventListener("hashchange",()=>{
    if(!window.HANDELO_LIVE_WORKSPACE)return;
    if(location.hash.includes("mode=live")){const view=location.hash.split("?")[0].replace("#","");syncView(view==="workspace"?"work":view);load();}
  });

  window.addEventListener("hashchange",()=>{
    if(!window.HANDELO_LIVE_WORKSPACE)closeLiveStream();
  });
})();