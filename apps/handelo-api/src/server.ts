import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HandeloAgent } from "@handelo/agent";
import { portfolioSnapshot } from "./portfolio.js";
import { createQuoteQuality } from "@handelo/core";
import { toMarketInsight } from "@handelo/market";
import { BAW_COMMAND, BAW_SHELL, BinanceAgenticWalletAdapter } from "@handelo/execution";
import { isExecutableMarketAsset, marketClientFromEnv, MarketResolutionError, MarketUpstreamError, type RwaAsset } from "@handelo/market";
import { auditToken, normalizeTokenAudit } from "@handelo/execution";
import { consumeReviewToken, createReviewToken, quoteDriftWithinTolerance, readVerifiedReviewToken, verifyReviewToken } from "./review-token.js";
import { walletServiceError } from "./wallet-errors.js";
import { FileStrategyExecutionStore } from "@handelo/strategy";
import { activateStoredStrategy, cancelStoredStrategy, getStoredStrategy, listActiveStrategies, listStrategies, pauseStoredStrategy, resumeStoredStrategy, updateStoredStrategy } from "./strategy-store.js";
import { listPersistedStrategyExecutions, listStrategyAttribution } from "./strategy-runtime.js";
import { buildGapRadar } from "./market-intelligence.js";
import { createPersistedStrategyWorker } from "./strategy-worker.js";
import { createHandeloStrategyWorkerDependencies } from "./strategy-worker-runtime.js";
import { normalizeWalletGuardrails } from "./wallet-guardrails.js";

const port = Number(process.env.PORT ?? "8787");
const host = process.env.HOST?.trim() || "127.0.0.1";
const execFileAsync = promisify(execFile);
let walletAuth: { status: "IDLE" | "WAITING" | "SUCCESS" | "FAILED"; urlForWeb?: string; pairingCode?: string; error?: string } = { status: "IDLE" };
let agent: HandeloAgent | null = null;
function getAgent(): HandeloAgent {
  agent ??= new HandeloAgent();
  return agent;
}
let market: ReturnType<typeof marketClientFromEnv> | null = null;
function getMarket(): ReturnType<typeof marketClientFromEnv> {
  market ??= marketClientFromEnv();
  return market;
}

const MARKET_CACHE_TTL_MS = 5000;
let marketCacheData: RwaAsset[] | null = null;
let marketCacheAt = 0;
let marketRefresh: Promise<RwaAsset[]> | null = null;

async function discoverMarketsCached(force = false): Promise<RwaAsset[]> {
  if (!force && marketCacheData && Date.now() - marketCacheAt < MARKET_CACHE_TTL_MS) return marketCacheData;
  if (marketRefresh) return marketRefresh;
  marketRefresh = getMarket().discover(8)
    .then((data) => {
      marketCacheData = data;
      marketCacheAt = Date.now();
      return data;
    })
    .finally(() => {
      marketRefresh = null;
    });
  return marketRefresh;
}
type LiveWorkspaceClient = {
  id: number;
  res: import("node:http").ServerResponse;
  wallet: string | null;
};

const liveWorkspaceClients = new Map<number, LiveWorkspaceClient>();
let nextLiveWorkspaceClientId = 1;
let lastLivePortfolioBroadcastAt = 0;

function pickLiveMarket(markets: RwaAsset[]): RwaAsset | null {
  return markets.find(asset => asset.tokenSymbol.trim().toUpperCase() === "NVDAB")
    ?? markets.find(asset => asset.underlyingTicker.trim().toUpperCase() === "NVDA")
    ?? markets[0]
    ?? null;
}

async function connectedWalletState(): Promise<{
  status: "CONNECTED" | "UNCONNECTED" | "CREATING" | "UNAVAILABLE";
  address: string | null;
}> {
  const status = await walletStatus();
  if (status.status !== "CONNECTED") return { status: status.status, address: null };
  const payload = await bawJson<{ addresses?: Array<{ binanceChainId?: string; address?: string }> }>(["wallet", "address"]);
  const address = payload.addresses?.find(entry => entry.binanceChainId === "56")?.address?.trim() ?? null;
  return { status: "CONNECTED", address: isEvmAddress(address ?? "") ? address : null };
}

type WalletBalanceRow = {
  symbol?: string;
  address?: string;
  binanceChainId?: string;
  balance?: string;
  price?: string;
  value?: string;
};

async function liveWalletBalances(): Promise<WalletBalanceRow[]> {
  const balances = await bawJson<WalletBalanceRow[]>(["wallet", "balance", "--binanceChainId", "56"]);
  return balances
    .filter(balance => String(balance.binanceChainId ?? "56") === "56")
    .sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
}

const BSC_NATIVE_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

function resolveFundingBalance(balances: WalletBalanceRow[], tokenAddress: string, targetAddress: string) {
  const normalized=tokenAddress.trim().toLowerCase();
  if(!normalized)throw new Error("A funding token is required.");
  if(normalized===targetAddress.trim().toLowerCase())throw new Error("NVDAB cannot be used as its own funding token.");
  const balance=balances.find(item=>String(item.address??"").trim().toLowerCase()===normalized);
  if(!balance)throw new Error("The selected funding token is not available in the connected BSC wallet.");
  const price=Number(balance.price),value=Number(balance.value);
  if(!Number.isFinite(price)||price<=0)throw new Error("Live USD price is unavailable for the selected funding token.");
  if(!Number.isFinite(value)||value<=0)throw new Error("The selected funding token has no available balance.");
  return balance;
}

function fundingQtyForUsd(amountUsd:number,balance:WalletBalanceRow):string{
  const price=Number(balance.price),value=Number(balance.value);
  if(!Number.isFinite(price)||price<=0)throw new Error("Live funding-token price is unavailable.");
  if(!Number.isFinite(value)||value<=0||amountUsd>value+1e-9)throw new Error("The selected funding-token balance is insufficient for this purchase.");
  const qty=amountUsd/price;
  if(!Number.isFinite(qty)||qty<=0)throw new Error("Could not calculate a valid funding-token quantity.");
  return qty.toFixed(18).replace(/\.0+$/,"").replace(/(\.\d*?)0+$/,"$1");
}


function resolvePayoutToken(tokenAddress:string){
  const normalized=tokenAddress.trim().toLowerCase();
  const allowed=new Map([
    ["0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","BNB"],
    ["0x55d398326f99059ff775485246999027b3197955","USDT"],
    ["0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d","USDC"]
  ]);
  const symbol=allowed.get(normalized);
  if(!symbol)throw new Error("Sell proceeds must be paid to BNB, USDT, or USDC on BSC.");
  return {address:tokenAddress.trim(),symbol};
}

function resolveHeldNvdabQuantity(balances:WalletBalanceRow[],assetAddress:string){
  const holding=balances.find(item=>String(item.address??"").trim().toLowerCase()===assetAddress.trim().toLowerCase());
  const quantity=Number(holding?.balance);
  if(!holding||!Number.isFinite(quantity)||quantity<=0)throw new Error("The connected wallet does not hold a sellable NVDAB balance.");
  return quantity;
}
async function workspaceAccount(walletAddress: string) {
  const [portfolioResult, balancesResult, historyResult, strategyResult] = await Promise.allSettled([
    portfolioSnapshot(walletAddress),
    liveWalletBalances(),
    getMarket().transactions(walletAddress, 20),
    listActiveStrategies(walletAddress)
  ]);
  return {
    wallet: { status: "CONNECTED", address: walletAddress },
    address: { connected: true, address: walletAddress },
    portfolio: portfolioResult.status === "fulfilled" ? portfolioResult.value : null,
    portfolioError: portfolioResult.status === "rejected" ? errorMessage(portfolioResult.reason) : null,
    walletBalances: balancesResult.status === "fulfilled" ? balancesResult.value : [],
    walletBalancesError: balancesResult.status === "rejected" ? errorMessage(balancesResult.reason) : null,
    history: historyResult.status === "fulfilled" ? { wallet: walletAddress, transactions: historyResult.value } : null,
    strategies: strategyResult.status === "fulfilled" ? strategyResult.value : [],
    generatedAt: new Date().toISOString()
  };
}

async function workspacePortfolioFast(walletAddress: string) {
  const [portfolioResult, balancesResult] = await Promise.allSettled([
    portfolioSnapshot(walletAddress),
    liveWalletBalances()
  ]);
  return {
    wallet: { status: "CONNECTED", address: walletAddress },
    address: { connected: true, address: walletAddress },
    portfolio: portfolioResult.status === "fulfilled" ? portfolioResult.value : null,
    portfolioError: portfolioResult.status === "rejected" ? errorMessage(portfolioResult.reason) : null,
    walletBalances: balancesResult.status === "fulfilled" ? balancesResult.value : [],
    walletBalancesError: balancesResult.status === "rejected" ? errorMessage(balancesResult.reason) : null,
    history: null,
    strategies: [],
    generatedAt: new Date().toISOString()
  };
}

async function workspaceSnapshot(walletOverride?: string) {
  const markets = await discoverMarketsCached();
  const marketAsset = pickLiveMarket(markets);
  if (!marketAsset) throw new MarketUpstreamError("No live NVDAB market data is available.");
  let walletState: { status: "CONNECTED" | "UNCONNECTED" | "CREATING" | "UNAVAILABLE"; address: string | null };
  if (walletOverride) walletState = { status: "CONNECTED", address: walletOverride };
  else {
    try { walletState = await connectedWalletState(); }
    catch { walletState = { status: "UNAVAILABLE", address: null }; }
  }
  if (walletState.status === "CONNECTED" && walletState.address) {
    return { market: marketAsset, ...await workspacePortfolioFast(walletState.address) };
  }
  return {
    market: marketAsset,
    wallet: { status: walletState.status, address: null },
    address: { connected: false, address: null },
    portfolio: null,
    portfolioError: null,
    history: null,
    strategies: [],
    generatedAt: new Date().toISOString()
  };
}

function writeLiveWorkspaceEvent(client: LiveWorkspaceClient, payload: unknown) {
  try { client.res.write("data: " + JSON.stringify(payload) + "\n\n"); }
  catch { liveWorkspaceClients.delete(client.id); }
}

async function broadcastLiveMarket() {
  if (!liveWorkspaceClients.size) return;
  try {
    const marketAsset = pickLiveMarket(await discoverMarketsCached(true));
    if (!marketAsset) return;
    for (const client of liveWorkspaceClients.values()) writeLiveWorkspaceEvent(client, { type: "market", data: marketAsset, generatedAt: new Date().toISOString() });
  } catch {}
}

async function broadcastLiveAccounts() {
  if (!liveWorkspaceClients.size) return;
  const wallets = [...new Set([...liveWorkspaceClients.values()].map(client => client.wallet).filter((wallet): wallet is string => Boolean(wallet)))];
  for (const wallet of wallets) {
    try {
      const account = await workspaceAccount(wallet);
      for (const client of liveWorkspaceClients.values()) if (client.wallet === wallet) writeLiveWorkspaceEvent(client, { type: "account", data: account });
    } catch {}
  }
}

const wallet = new BinanceAgenticWalletAdapter();
const strategyExecutionStore = new FileStrategyExecutionStore(
  process.env.HANDELO_STRATEGY_EXECUTION_STORE_PATH ?? "./data/strategy-executions.json"
);
const DEFAULT_BSC_QUOTE_TOKEN = "0x55d398326f99059fF775485246999027B3197955";
const CORS_ORIGIN = process.env.HANDELO_CORS_ORIGIN?.trim() || "*";
const CLIENT_API_KEY = process.env.HANDELO_CLIENT_API_KEY?.trim() || "";
const strategyWorkerWallet = process.env.HANDELO_STRATEGY_WORKER_WALLET?.trim() || "";
let strategyWorker: ReturnType<typeof createPersistedStrategyWorker> | null = null;
function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function normalizeSlippage(value: unknown): { value?: string; error?: string } {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return { error: "slippage must be a non-negative numeric percentage." };
  }
  const normalized = value.trim();
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric > 100) {
    return { error: "slippage must be between 0 and 100." };
  }
  return { value: normalized };
}

async function bawJson<T>(args: string[]): Promise<T> {
  const { stdout, stderr } = await execFileAsync(BAW_COMMAND, [...args, "--json"], { maxBuffer: 1024 * 1024, shell: BAW_SHELL });
  const raw = (stdout || stderr).trim();
  const payload = JSON.parse(raw) as { success: boolean; data: T; message?: string };
  if (!payload.success) throw new Error(payload.message ?? "Binance Agentic Wallet command failed.");
  return payload.data;
}

async function walletStatus() {
  return bawJson<{ status: "CONNECTED" | "UNCONNECTED" | "CREATING" }>(["wallet", "status"]);
}

async function verifyWalletAuth(qrCodeId: string) {
  try {
    await bawJson(["auth", "verify", "--qrCodeId", qrCodeId]);
    const status = await walletStatus();
    if (status.status !== "CONNECTED") {
      walletAuth = {
        status: "FAILED",
        error: `Wallet authentication completed, but wallet status is ${status.status}.`
      };
      return;
    }
    walletAuth = { status: "SUCCESS" };
  } catch (error) {
    walletAuth = { status: "FAILED", error: walletServiceError(error) };
  }
}

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
function toMarketInsightForServer(asset: import("@handelo/market").RwaAsset) {
  const insight = toMarketInsight(asset);
  return {
    ticker: insight.underlyingTicker,
    tokenSymbol: insight.tokenSymbol,
    provider: insight.provider,
    tokenPrice: insight.onChainPrice,
    referencePrice: insight.referencePrice,
    divergencePercent: insight.divergencePercent,
    marketStatus: insight.marketStatus,
    marketOpen: asset.statusInfo.openState,
    nextOpenAt: insight.nextOpenAt,
    nextCloseAt: insight.nextCloseAt,
    marketStatusReason: insight.marketStatusReason,
    liquidityContext: insight.liquidityContext
  };
}

async function readRequestBody(req: import("node:http").IncomingMessage): Promise<string> {
  let raw = "";
  let size = 0;
  for await (const chunk of req) {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    size += Buffer.byteLength(text);
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new RangeError("Request body is too large.");
    }
    raw += text;
  }
  return raw;
}

function parseJsonBody<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new SyntaxError("Request body must be valid JSON.");
  }
}

function marketErrorStatus(error: unknown): 404 | 409 | 503 | null {
  if (error instanceof MarketResolutionError) return error.kind === "NOT_FOUND" ? 404 : 409;
  if (error instanceof MarketUpstreamError) return 503;
  return null;
}

function requestBodyErrorStatus(error: unknown): 400 | 413 | null {
  if (error instanceof SyntaxError) return 400;
  if (error instanceof RangeError) return 413;
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": CORS_ORIGIN,
    "access-control-allow-headers": "content-type, x-handelo-api-key"
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": CORS_ORIGIN,
      "access-control-allow-headers": "content-type, x-handelo-api-key",
      "access-control-allow-methods": "POST,GET,OPTIONS"
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, service: "handelo-agent" });
  }

  const requestPath = (req.url ?? "").split("?")[0];
  const isPublicMarketRead = req.method === "GET" && (
    requestPath === "/api/markets" ||
    requestPath === "/api/earnings" ||
    requestPath.startsWith("/api/earnings/") ||
    requestPath === "/api/gap-radar" ||
    requestPath.startsWith("/api/gap-radar/")
  );
  if (requestPath.startsWith("/api/") && !isPublicMarketRead) {
    if (!CLIENT_API_KEY) return json(res, 503, { error: "Private Handelo API routes are disabled until HANDELO_CLIENT_API_KEY is configured." });
    if (req.headers["x-handelo-api-key"] !== CLIENT_API_KEY) return json(res, 401, { error: "A valid Handelo client API key is required." });
  }

  if (req.method === "GET" && req.url === "/api/wallet/status") {
    try {
      const status = await walletStatus();
      return json(res, 200, status);
    } catch (error) {
      return json(res, 503, { status: "UNAVAILABLE", error: walletServiceError(error) });
    }
  }

  if (req.method === "GET" && req.url === "/api/wallet/guardrails") {
    try {
      const status = await walletStatus();
      if (status.status !== "CONNECTED") {
        return json(res, 200, normalizeWalletGuardrails({ status: status.status }));
      }

      const [addressPayload, chains, settings, quota, txLock] = await Promise.all([
        bawJson<{ addresses?: Array<{ binanceChainId?: string; address?: string }> }>(["wallet", "address"]),
        bawJson<Array<{ binanceChainId?: string; name?: string }>>(["wallet", "chains"]),
        bawJson<Record<string, unknown>>(["wallet", "settings"]),
        bawJson<Record<string, unknown>>(["wallet", "left-quota"]),
        bawJson<{ status?: string }>(["wallet", "tx-lock", "--binanceChainId", "56"])
      ]);
      const address = addressPayload.addresses
        ?.find((entry) => entry.binanceChainId === "56")
        ?.address?.trim() ?? null;

      return json(res, 200, normalizeWalletGuardrails({
        status: status.status,
        address,
        chains,
        settings,
        quota,
        txLock: txLock.status
      }));
    } catch (error) {
      return json(res, 503, { status: "UNAVAILABLE", error: walletServiceError(error) });
    }
  }

  if (req.method === "POST" && req.url === "/api/wallet/signout") {
    try {
      await bawJson(["auth", "signout"]);
      walletAuth = { status: "IDLE" };
      return json(res, 200, { status: "SIGNED_OUT", connected: false });
    } catch (error) {
      return json(res, 503, { status: "SIGNOUT_FAILED", connected: true, error: walletServiceError(error) });
    }
  }
  if (req.method === "GET" && req.url === "/api/wallet/auth") {
    if (walletAuth.status === "WAITING" || walletAuth.status === "SUCCESS" || walletAuth.status === "FAILED") return json(res, 200, walletAuth);

    try {
      const signin = await bawJson<{ urlForWeb?: string; qrCodeId?: string; pairingCode?: string; status?: string }>(["auth", "signin"]);
      if (signin.status === "ALREADY_CONNECTED") {
        const status = await walletStatus();
        if (status.status !== "CONNECTED") {
          return json(res, 502, {
            error: `Binance Agentic Wallet reported an existing session, but wallet status is ${status.status}.`
          });
        }
        walletAuth = { status: "SUCCESS" };
        return json(res, 200, walletAuth);
      }
      if (!signin.qrCodeId || !signin.urlForWeb || !signin.pairingCode) {
        return json(res, 502, { error: "Binance Agentic Wallet returned an incomplete sign-in response." });
      }

      walletAuth = { status: "WAITING", urlForWeb: signin.urlForWeb, pairingCode: signin.pairingCode };

      void verifyWalletAuth(signin.qrCodeId).catch(() => undefined);
      return json(res, 200, walletAuth);
    } catch (error) {
      return json(res, 502, { error: walletServiceError(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/workspace/snapshot")) {
    const requestedWallet = new URL(req.url, "http://localhost").searchParams.get("wallet")?.trim() || "";
    if (requestedWallet && !isEvmAddress(requestedWallet)) return json(res, 400, { error: "wallet must be a valid EVM address" });
    try {
      return json(res, 200, await workspaceSnapshot(requestedWallet || undefined));
    } catch (error) {
      const status = marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/workspace/stream")) {
    const requestedWallet = new URL(req.url, "http://localhost").searchParams.get("wallet")?.trim() || "";
    if (requestedWallet && !isEvmAddress(requestedWallet)) return json(res, 400, { error: "wallet must be a valid EVM address" });
    const clientId = nextLiveWorkspaceClientId++;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-store, must-revalidate",
      "connection": "keep-alive",
      "access-control-allow-origin": CORS_ORIGIN,
      "access-control-allow-headers": "content-type, x-handelo-api-key",
      "x-accel-buffering": "no"
    });
    const client: LiveWorkspaceClient = { id: clientId, res, wallet: requestedWallet || null };
    liveWorkspaceClients.set(clientId, client);
    const heartbeat = setInterval(() => { try { res.write(": keep-alive\n\n"); } catch { clearInterval(heartbeat); } }, 15000);
    req.on("close", () => { clearInterval(heartbeat); liveWorkspaceClients.delete(clientId); });
    try {
      const snapshot = await workspaceSnapshot(requestedWallet || undefined);
      client.wallet = snapshot.address?.connected ? snapshot.address.address : null;
      writeLiveWorkspaceEvent(client, { type: "snapshot", data: snapshot });
      if (client.wallet) {
        void workspaceAccount(client.wallet).then(account => {
          if (liveWorkspaceClients.has(client.id)) writeLiveWorkspaceEvent(client, { type: "account", data: account });
        }).catch(() => undefined);
      }
    } catch (error) {
      writeLiveWorkspaceEvent(client, { type: "error", error: errorMessage(error) });
    }
    return;
  }
  if (req.method === "GET" && req.url === "/api/markets") {
    try {
      return json(res, 200, await discoverMarketsCached());
    } catch (error) {
      const status = marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/earnings")) {
    const requestedLimit = Number(new URL(req.url, "http://localhost").searchParams.get("limit") ?? "8");
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 25) : 8;
    try {
      const assets = await getMarket().upcomingEarnings(limit);
      return json(res, 200, {
        source: "BINANCE_RWA_UPCOMING_EARNINGS_TAB",
        generatedAt: new Date().toISOString(),
        events: assets.map(asset => ({
          ...toMarketInsightForServer(asset),
          underlyingName: asset.underlyingName
        }))
      });
    } catch (error) {
      const status = marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/gap-radar")) {
    const requestedLimit = Number(new URL(req.url, "http://localhost").searchParams.get("limit") ?? "8");
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 25) : 8;
    try {
      return json(res, 200, {
        ...buildGapRadar(await getMarket().tokens(), limit),
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      const status = marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url === "/api/wallet/address") {
    try {
      const status = await walletStatus();
      if (status.status !== "CONNECTED") return json(res, 200, { connected: false, address: null });
      const wallet = await bawJson<{
        addresses?: Array<{ binanceChainId?: string; address?: string }>;
      }>(["wallet", "address"]);
      const address = wallet.addresses
        ?.find((entry) => entry.binanceChainId === "56")
        ?.address?.trim() ?? "";
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return json(res, 502, {
          connected: false,
          address: null,
          error: "Binance Agentic Wallet returned an invalid EVM wallet address."
        });
      }
      return json(res, 200, { connected: true, address });
    } catch (error) {
      return json(res, 503, { connected: false, address: null, error: walletServiceError(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/history")) {
    const walletAddress =
      new URL(req.url, "http://localhost").searchParams.get("wallet") ??
      process.env.HANDELO_WALLET;

    if (!walletAddress) {
      return json(res, 400, { error: "wallet query parameter or HANDELO_WALLET is required" });
    }
    if (!isEvmAddress(walletAddress)) {
      return json(res, 400, { error: "wallet must be a valid EVM address" });
    }

    try {
      return json(res, 200, { wallet: walletAddress, transactions: await getMarket().transactions(walletAddress, 20) });
    } catch (error) {
      const status = marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "POST" && req.url === "/api/portfolio/rebalance-preview") {
    try {
      const body = parseJsonBody<{ wallet?: unknown; targetAllocation?: unknown }>(await readRequestBody(req));
      const walletAddress = String(body.wallet ?? "").trim();
      if (!isEvmAddress(walletAddress)) return json(res, 400, { error: "A valid wallet is required." });
      if (!body.targetAllocation || typeof body.targetAllocation !== "object" || Array.isArray(body.targetAllocation)) {
        return json(res, 400, { error: "targetAllocation must be an object of asset percentages." });
      }
      const { createRebalancePreview } = await import("@handelo/core");
      const preview = createRebalancePreview(await portfolioSnapshot(walletAddress), body.targetAllocation as Record<string, number>);
      return json(res, 200, { preview, executionScheduled: false });
    } catch (error) {
      const status = requestBodyErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/portfolio")) {
    const walletAddress =
      new URL(req.url, "http://localhost").searchParams.get("wallet") ??
      process.env.HANDELO_WALLET;

    if (!walletAddress) {
      return json(res, 400, { error: "wallet query parameter or HANDELO_WALLET is required" });
    }
    if (!isEvmAddress(walletAddress)) {
      return json(res, 400, { error: "wallet must be a valid EVM address" });
    }

    try {
      return json(res, 200, await portfolioSnapshot(walletAddress));
    } catch (error) {
      const status = marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url === "/api/strategies/worker") {
    return json(res, 200, {
      enabled: strategyWorker !== null,
      running: strategyWorker?.isRunning() ?? false,
      wallet: strategyWorker ? strategyWorkerWallet : null,
      supportedTypes: ["DCA", "RECURRING"],
      disclosure: "Autonomous strategy execution is disabled unless explicitly enabled with a configured worker wallet."
    });
  }

  if (req.method === "GET" && req.url?.startsWith("/api/strategies/attribution")) {
    const walletAddress = new URL(req.url, "http://localhost").searchParams.get("wallet")?.trim() ?? "";
    if (!isEvmAddress(walletAddress)) return json(res, 400, { error: "A valid wallet is required." });
    try {
      return json(res, 200, { wallet: walletAddress, attribution: await listStrategyAttribution(walletAddress, strategyExecutionStore) });
    } catch (error) {
      return json(res, 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/strategies/executions")) {
    const walletAddress = new URL(req.url, "http://localhost").searchParams.get("wallet")?.trim() ?? "";
    if (!isEvmAddress(walletAddress)) return json(res, 400, { error: "A valid wallet is required." });
    try {
      return json(res, 200, {
        wallet: walletAddress,
        executions: await listPersistedStrategyExecutions(walletAddress, strategyExecutionStore)
      });
    } catch (error) {
      return json(res, 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/strategies")) {
    const walletAddress = new URL(req.url, "http://localhost").searchParams.get("wallet")?.trim() ?? "";
    if (!isEvmAddress(walletAddress)) return json(res, 400, { error: "A valid wallet is required." });
    try {
      return json(res, 200, { strategies: await listActiveStrategies(walletAddress) });
    } catch (error) {
      return json(res, 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/strategies/all")) {
    const walletAddress = new URL(req.url, "http://localhost").searchParams.get("wallet")?.trim() ?? "";
    if (!isEvmAddress(walletAddress)) return json(res, 400, { error: "A valid wallet is required." });
    return json(res, 200, { strategies: await listStrategies(walletAddress) });
  }

  if (req.method === "GET" && req.url?.startsWith("/api/strategies/")) {
    const url = new URL(req.url, "http://localhost");
    const strategyId = url.pathname.split("/").pop() ?? "";
    const walletAddress = url.searchParams.get("wallet")?.trim() ?? "";
    if (!isEvmAddress(walletAddress) || !strategyId) return json(res, 400, { error: "A valid wallet and strategy ID are required." });
    const strategy = await getStoredStrategy(walletAddress, strategyId);
    return strategy ? json(res, 200, { strategy }) : json(res, 404, { error: "Strategy not found." });
  }

  if (req.method === "POST" && req.url === "/api/strategies/pause") {
    try {
      const body = parseJsonBody<{wallet?: unknown; strategyId?: unknown}>(await readRequestBody(req));
      const walletAddress=String(body.wallet??"").trim(), strategyId=String(body.strategyId??"").trim();
      if (!isEvmAddress(walletAddress)||!strategyId) return json(res,400,{error:"A valid wallet and strategyId are required."});
      return json(res,200,{strategy:await pauseStoredStrategy(walletAddress,strategyId)});
    } catch(error){ return json(res,409,{error:errorMessage(error)}); }
  }

  if (req.method === "POST" && req.url === "/api/strategies/resume") {
    try {
      const body = parseJsonBody<{wallet?: unknown; strategyId?: unknown}>(await readRequestBody(req));
      const walletAddress=String(body.wallet??"").trim(), strategyId=String(body.strategyId??"").trim();
      if (!isEvmAddress(walletAddress)||!strategyId) return json(res,400,{error:"A valid wallet and strategyId are required."});
      return json(res,200,{strategy:await resumeStoredStrategy(walletAddress,strategyId)});
    } catch(error){ return json(res,409,{error:errorMessage(error)}); }
  }

  if (req.method === "POST" && req.url === "/api/strategies/cancel") {
    try {
      const body = parseJsonBody<{wallet?: unknown; strategyId?: unknown}>(await readRequestBody(req));
      const walletAddress=String(body.wallet??"").trim(), strategyId=String(body.strategyId??"").trim();
      if (!isEvmAddress(walletAddress)||!strategyId) return json(res,400,{error:"A valid wallet and strategyId are required."});
      return json(res,200,{strategy:await cancelStoredStrategy(walletAddress,strategyId)});
    } catch(error){ return json(res,409,{error:errorMessage(error)}); }
  }

  if (req.method === "POST" && req.url === "/api/strategies/edit") {
    try {
      const body = parseJsonBody<{wallet?: unknown; strategyId?: unknown; update?: unknown}>(await readRequestBody(req));
      const walletAddress=String(body.wallet??"").trim(), strategyId=String(body.strategyId??"").trim();
      if(!isEvmAddress(walletAddress)||!strategyId||!body.update||typeof body.update!=="object") return json(res,400,{error:"A valid wallet, strategyId, and update are required."});
      return json(res,200,{strategy:await updateStoredStrategy(walletAddress,strategyId,body.update as Parameters<typeof updateStoredStrategy>[2])});
    } catch(error){ return json(res,409,{error:errorMessage(error)}); }
  }

  if (req.method === "POST" && req.url === "/api/strategies/activate") {
    try {
      const raw = await readRequestBody(req);
      const body = parseJsonBody<{ wallet?: unknown; strategy?: unknown }>(raw);
      const walletAddress = String(body.wallet ?? "").trim();
      if (!isEvmAddress(walletAddress) || !body.strategy || typeof body.strategy !== "object") {
        return json(res, 400, { error: "A valid wallet and strategy are required." });
      }

      const strategy = body.strategy as import("@handelo/core").StrategyDefinition;
      if (strategy.status !== "DRAFT") return json(res, 409, { error: "Only draft strategies can be activated." });
      if (!strategy.id || !strategy.asset || !strategy.type) return json(res, 400, { error: "Strategy definition is incomplete." });

      if (strategy.amountUsd !== undefined) {
        if (!Number.isFinite(strategy.amountUsd) || strategy.amountUsd <= 0) {
          return json(res, 400, { error: "Strategy amount must be greater than zero." });
        }
        const snapshot = await portfolioSnapshot(walletAddress);
        const { evaluatePortfolioStrategyRisk } = await import("@handelo/core");
        const risk = evaluatePortfolioStrategyRisk(snapshot, strategy.asset, strategy.amountUsd, strategy.constraints);
        if (risk.decision !== "PASS") {
          return json(res, 409, { error: "Strategy activation is blocked by portfolio risk controls.", risk });
        }
      }

      const activated = await activateStoredStrategy(walletAddress, strategy);
      return json(res, 200, { strategy: activated, executionScheduled: false });
    } catch (error) {
      const status = requestBodyErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "POST" && req.url === "/api/strategy/risk") {
    try {
      const raw = await readRequestBody(req);
      const body = parseJsonBody<{ wallet?: unknown; asset?: unknown; amountUsd?: unknown }>(raw);
      const walletAddress = String(body.wallet ?? "").trim();
      const asset = String(body.asset ?? "").trim();
      const amountUsd = Number(body.amountUsd);
      if (!isEvmAddress(walletAddress) || !asset || !Number.isFinite(amountUsd) || amountUsd <= 0) {
        return json(res, 400, { error: "wallet, asset, and positive amountUsd are required" });
      }
      const snapshot = await portfolioSnapshot(walletAddress);
      const { evaluatePortfolioStrategyRisk } = await import("@handelo/core");
      const risk = evaluatePortfolioStrategyRisk(snapshot, asset, amountUsd);
      return json(res, 200, { risk, portfolio: snapshot });
    } catch (error) {
      const status = marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "POST" && req.url === "/api/review") {
    try {
      const raw = await readRequestBody(req);
      const body = parseJsonBody<{
        ticker?: unknown; amountUsd?: unknown; action?: unknown;
        fromToken?: unknown; fromTokenQty?: unknown; toToken?: unknown;
        slippage?: unknown; wallet?: unknown;
      }>(raw);

      const ticker=String(body.ticker??"").trim().toUpperCase();
      const requestedAction=body.action==="sell"?"sell":"buy";
      const amountInput=Number(body.amountUsd);
      const fromToken=String(body.fromToken??"").trim();
      const fromTokenQtyInput=String(body.fromTokenQty??"").trim();
      const toTokenInput=String(body.toToken??"").trim();

      if(!ticker||(!Number.isFinite(amountInput)||amountInput<=0)){
        return json(res,400,{error:"ticker and positive amountUsd are required"});
      }

      const walletAddress=String(body.wallet??"").trim();
      if(!isEvmAddress(walletAddress)){
        return json(res,400,{error:"A valid connected wallet address is required for transaction review."});
      }

      const connected=await connectedWalletState();
      if(!connected.address||connected.address.toLowerCase()!==walletAddress.toLowerCase()){
        return json(res,409,{error:"The connected Binance Agentic Wallet does not match the wallet supplied for review."});
      }

      const asset=await getMarket().find(ticker==="NVDA"?"NVDAB":ticker);
      if(!isExecutableMarketAsset(asset)){
        return json(res,422,{error:"Live market data is invalid for this tokenized stock, so Handelo will not create an executable review."});
      }

      const premiumPct=(()=>{
        const token=Number(asset.tokenPrice),reference=Number(asset.referencePrice);
        if(!Number.isFinite(token)||!Number.isFinite(reference)||reference===0)return null;
        return ((token-reference)/reference)*100;
      })();

      let amountUsd=amountInput;
      let resolvedFromToken="";
      let resolvedFromQty="";
      let resolvedToToken="";
      let fundingSymbol:string|null=null;

      const balances=await liveWalletBalances();

      if(requestedAction==="buy"){
        const funding=resolveFundingBalance(balances,fromToken,asset.tokenContractAddress);
        resolvedFromToken=funding.address??"";
        resolvedFromQty=fundingQtyForUsd(amountUsd,funding);
        resolvedToToken=asset.tokenContractAddress;
        fundingSymbol=funding.symbol??null;
      }else{
        const nvdabQuantity=Number(fromTokenQtyInput);
        if(!Number.isFinite(nvdabQuantity)||nvdabQuantity<=0){
          return json(res,400,{error:"A positive NVDAB quantity is required for a sell."});
        }
        const heldQuantity=resolveHeldNvdabQuantity(balances,asset.tokenContractAddress);
        if(nvdabQuantity>heldQuantity+1e-9){
          return json(res,409,{error:"The requested NVDAB sell quantity exceeds the connected wallet balance."});
        }
        const payout=resolvePayoutToken(toTokenInput);
        const liveTokenPrice=Number(asset.tokenPrice);
        if(!Number.isFinite(liveTokenPrice)||liveTokenPrice<=0){
          return json(res,422,{error:"Live NVDAB price is unavailable for sell review."});
        }
        amountUsd=nvdabQuantity*liveTokenPrice;
        resolvedFromToken=asset.tokenContractAddress;
        resolvedFromQty=fromTokenQtyInput;
        resolvedToToken=payout.address;
        fundingSymbol=payout.symbol;
      }

      const policy=(await import("@handelo/policy")).evaluatePolicy({
        action:requestedAction,amountUsd,marketOpen:asset.statusInfo.openState,premiumPct
      });
      const executableAction=(await import("@handelo/policy")).executionAction(requestedAction);
      if(!executableAction)return json(res,400,{error:"Unsupported transaction action."});

      let portfolioRisk=null;
      let portfolioRiskError:string|null=null;
      try{
        const snapshot=await portfolioSnapshot(walletAddress);
        const {evaluatePortfolioStrategyRisk}=await import("@handelo/core");
        portfolioRisk=evaluatePortfolioStrategyRisk(snapshot,asset.tokenSymbol,amountUsd,undefined,requestedAction==="sell"?"SELL":"BUY");
      }catch(error){
        portfolioRiskError=error instanceof Error?error.message:String(error);
      }
      const riskDecision=portfolioRisk?.decision??"BLOCK";

      let securityAudit:Awaited<ReturnType<typeof auditToken>>|null=null;
      let securityAuditError:string|null=null;
      let executionBlocked=false;
      try{
        securityAudit=normalizeTokenAudit(await auditToken("56",asset.tokenContractAddress));
        executionBlocked=!securityAudit.hasResult||!securityAudit.isSupported||(typeof securityAudit.riskLevel==="number"&&securityAudit.riskLevel>=4);
        if(!securityAudit.isSupported)securityAuditError="Token security audit data is unavailable for this token.";
      }catch(error){
        executionBlocked=true;
        securityAuditError=error instanceof Error?error.message:String(error);
      }

      let quote:unknown=null;
      const slippageResult=normalizeSlippage(body.slippage);
      if(slippageResult.error)return json(res,400,{error:slippageResult.error});
      const slippage=slippageResult.value;
      let quoteError:string|null=null;

      if(policy.decision!=="BLOCK"&&riskDecision==="PASS"){
        try{
          quote=await wallet.quote({
            fromTokenQty:resolvedFromQty,
            fromToken:resolvedFromToken,
            toToken:resolvedToToken,
            binanceChainId:"56",
            slippage
          });
        }catch(error){
          quoteError=error instanceof Error?error.message:String(error);
        }
      }

      const quoteQuality=quote&&typeof quote==="object"&&"fromCoinAmount" in quote&&"toCoinAmount" in quote
        ?createQuoteQuality({
          fromCoinAmount:String((quote as {fromCoinAmount:unknown}).fromCoinAmount),
          toCoinAmount:String((quote as {toCoinAmount:unknown}).toCoinAmount),
          onChainPrice:Number(asset.tokenPrice),
          referencePrice:Number(asset.referencePrice),
          requestedSlippagePercent:Number((quote as {slippage?:unknown}).slippage)
        }):null;

      return json(res,200,{
        action:requestedAction,
        amountUsd,
        asset:{
          ticker:asset.underlyingTicker,tokenSymbol:asset.tokenSymbol,contract:asset.tokenContractAddress,
          provider:asset.platformId,tokenPrice:asset.tokenPrice,referencePrice:asset.referencePrice,premiumPct,market:asset.statusInfo
        },
        policy,portfolioRisk,portfolioRiskError,riskDecision,securityAudit,securityAuditError,executionBlocked,
        quote,quoteQuality,quoteError,
        quoteToken:fundingSymbol,
        fundingToken:requestedAction==="buy"?fundingSymbol:null,
        fundingTokenQty:requestedAction==="buy"?resolvedFromQty:null,
        fromToken:resolvedFromToken,
        fromTokenQty:resolvedFromQty,
        toToken:resolvedToToken,
        reviewToken:quote&&riskDecision==="PASS"?createReviewToken({
          ticker:asset.tokenSymbol,
          amountUsd,
          action:requestedAction,
          fromToken:resolvedFromToken,
          fromTokenQty:resolvedFromQty,
          toToken:resolvedToToken,
          contract:asset.tokenContractAddress,
          slippage,
          wallet:walletAddress,
          reviewedQuotePrice:quoteQuality?.impliedPrice??null
        }):null
      });
    }catch(error){
      const status=requestBodyErrorStatus(error)??marketErrorStatus(error);
      return json(res,status??500,{error:errorMessage(error)});
    }
  }

  if (req.method === "POST" && req.url === "/api/quote") {
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = parseJsonBody<{
        ticker?: unknown;
        fromTokenQty?: unknown;
        fromToken?: unknown;
        slippage?: unknown;
      }>(raw);

      const ticker = String(body.ticker ?? "").trim().toUpperCase();
      const amount = Number(body.fromTokenQty);
      const fromToken = String(body.fromToken ?? "").trim();

      if (!ticker || !Number.isFinite(amount) || amount <= 0 || !fromToken) {
        return json(res, 400, {
          error: "ticker, positive fromTokenQty, and fromToken are required"
        });
      }

      const slippageResult = normalizeSlippage(body.slippage);
      if (slippageResult.error) return json(res, 400, { error: slippageResult.error });
      const slippage = slippageResult.value;

      const asset = await getMarket().find(ticker);
      const quote = await wallet.quote({
        fromTokenQty: String(amount),
        fromToken,
        toToken: asset.tokenContractAddress,
        binanceChainId: "56",
        slippage
      });

      return json(res, 200, {
        asset: {
          ticker: asset.underlyingTicker,
          tokenSymbol: asset.tokenSymbol,
          contract: asset.tokenContractAddress,
          provider: asset.platformId,
          tokenPrice: asset.tokenPrice,
          referencePrice: asset.referencePrice,
          market: asset.statusInfo
        },
        quote
      });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "POST" && req.url === "/api/execute") {
    if (process.env.HANDELO_EXECUTION_ENABLED !== "true") {
      return json(res, 403, {
        error: "Execution is disabled. Set HANDELO_EXECUTION_ENABLED=true only in a controlled demo environment."
      });
    }

    const reviewTokenSecret = process.env.HANDELO_REVIEW_TOKEN_SECRET?.trim();
    if (!reviewTokenSecret || reviewTokenSecret === "handelo-local-review-secret") {
      return json(res, 503, {
        error: "Execution is unavailable until HANDELO_REVIEW_TOKEN_SECRET is configured to a non-default value."
      });
    }

    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = parseJsonBody<{
        ticker?: unknown;
        amountUsd?: unknown;
        action?: unknown;
        fromToken?: unknown;
        toToken?: unknown;
        slippage?: unknown;
        confirmed?: unknown;
        reviewToken?: unknown;
        wallet?: unknown;
      }>(raw);

      const ticker = String(body.ticker ?? "").trim().toUpperCase();
      const action = body.action === "sell" ? "sell" : "buy";
      const fromToken = String(body.fromToken ?? "").trim();
      const toTokenInput = String(body.toToken ?? "").trim();
      const amount = Number(body.amountUsd);
      const reviewToken = String(body.reviewToken ?? "").trim();
      const walletAddress = String(body.wallet ?? "").trim();

      if (!ticker || !Number.isFinite(amount) || amount <= 0 || !fromToken || !reviewToken || !isEvmAddress(walletAddress)) {
        return json(res, 400, {
          error: "ticker, positive amountUsd, fromToken, and reviewToken are required"
        });
      }

      const asset = await getMarket().find(ticker === "NVDA" ? "NVDAB" : ticker);
      if (!isExecutableMarketAsset(asset)) {
        return json(res, 422, { error: "Live market data is invalid for this tokenized stock, so execution is blocked." });
      }
      const slippageResult = normalizeSlippage(body.slippage);
      if (slippageResult.error) return json(res, 400, { error: slippageResult.error });
      const slippage = slippageResult.value;

      const reviewedToken = readVerifiedReviewToken(reviewToken);
      const toToken = toTokenInput || reviewedToken?.toToken || (action === "buy" ? asset.tokenContractAddress : DEFAULT_BSC_QUOTE_TOKEN);
      if (!verifyReviewToken(reviewToken, {
        ticker: asset.tokenSymbol,
        amountUsd: amount,
        action,
        fromToken,
        fromTokenQty: reviewedToken?.fromTokenQty ?? "",
        toToken,
        contract: asset.tokenContractAddress,
        slippage,
        wallet: walletAddress,
        reviewedQuotePrice: reviewedToken?.reviewedQuotePrice ?? null
      })) {
        return json(res, 409, { error: "This transaction no longer matches the reviewed trade or the review has expired. Start a new review." });
      }

      const connectedWallet = await bawJson<{
        addresses?: Array<{ binanceChainId?: string; address?: string }>;
      }>(["wallet", "address"]);
      const connectedAddress = connectedWallet.addresses
        ?.find((entry) => entry.binanceChainId === "56")
        ?.address?.trim() ?? "";
      if (!isEvmAddress(connectedAddress) || connectedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return json(res, 409, {
          error: "The connected Binance Agentic Wallet does not match the wallet approved in the transaction review."
        });
      }

      const tokenPrice = Number(asset.tokenPrice);
      const referencePrice = Number(asset.referencePrice);
      const premiumPct = Number.isFinite(tokenPrice) && Number.isFinite(referencePrice) && referencePrice !== 0
        ? ((tokenPrice - referencePrice) / referencePrice) * 100
        : null;
      const policy = (await import("@handelo/policy")).evaluatePolicy({
        action,
        amountUsd: amount,
        marketOpen: asset.statusInfo.openState,
        premiumPct
      });

      if (policy.decision === "BLOCK") {
        return json(res, 409, {
          error: "Execution blocked by Handelo safety policy.",
          policy
        });
      }

      if (body.confirmed !== true) {
        return json(res, 409, {
          error: policy.decision === "CONFIRM"
            ? "Additional confirmation is required by Handelo safety policy."
            : "Explicit confirmation is required before execution.",
          policy
        });
      }

      const snapshot = await portfolioSnapshot(walletAddress);
      const { evaluatePortfolioStrategyRisk } = await import("@handelo/core");
      const portfolioRisk = evaluatePortfolioStrategyRisk(snapshot, asset.tokenSymbol, amount, undefined, action === "sell" ? "SELL" : "BUY");
      if (portfolioRisk.decision !== "PASS") {
        return json(res, 409, {
          error: "Execution blocked by portfolio risk controls.",
          policy,
          portfolioRisk
        });
      }

      const securityAudit = normalizeTokenAudit(await auditToken("56", asset.tokenContractAddress));
      if (!securityAudit.isSupported) {
        return json(res, 409, {
          error: "Token security audit data is unavailable for the requested token; execution is blocked.",
          policy,
          portfolioRisk,
          securityAudit
        });
      }
      if (typeof securityAudit.riskLevel === "number" && securityAudit.riskLevel >= 4) {
        return json(res, 409, {
          error: "Token security audit returned high risk; execution is blocked.",
          policy,
          portfolioRisk,
          securityAudit
        });
      }

      const reviewedQuote = await wallet.quote({
        fromTokenQty: reviewedToken?.fromTokenQty ?? "",
        fromToken,
        toToken,
        binanceChainId: "56",
        slippage: typeof body.slippage === "string" ? body.slippage : undefined
      });

      const reviewedQuotePrice = reviewedToken?.reviewedQuotePrice ?? null;
      const freshQuoteQuality = createQuoteQuality({
        fromCoinAmount: String(reviewedQuote.fromCoinAmount),
        toCoinAmount: String(reviewedQuote.toCoinAmount),
        onChainPrice: tokenPrice,
        referencePrice,
        requestedSlippagePercent: slippage === undefined ? null : Number(slippage)
      });
      if (!quoteDriftWithinTolerance(reviewedQuotePrice, freshQuoteQuality.impliedPrice, slippage)) {
        return json(res, 409, {
          error: "The fresh execution quote moved materially from the reviewed quote. Start a new review before executing.",
          reviewedQuotePrice,
          freshQuotePrice: freshQuoteQuality.impliedPrice,
          quoteDriftTolerancePercent: slippage === undefined ? 1 : Number(slippage)
        });
      }

      if (!consumeReviewToken(reviewToken)) {
        return json(res, 409, { error: "This reviewed transaction has already been used. Start a new review before executing again." });
      }

      const result = await wallet.execute(
        {
          fromTokenQty: reviewedQuote.fromCoinAmount,
          fromToken,
          toToken,
          binanceChainId: "56",
          slippage: typeof body.slippage === "string" ? body.slippage : undefined
        },
        body.confirmed === true
      );

      return json(res, 200, {
        asset: {
          ticker: asset.underlyingTicker,
          tokenSymbol: asset.tokenSymbol,
          contract: asset.tokenContractAddress,
          action,
          provider: asset.platformId
        },
        policy,
        portfolioRisk,
        securityAudit,
        result
      });
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    return json(res, 404, { error: "Not found" });
  }

  try {
    const raw = await readRequestBody(req);
    const body = parseJsonBody<{ message?: unknown }>(raw);

    if (typeof body.message !== "string" || !body.message.trim()) {
      return json(res, 400, { error: "message is required" });
    }

    const result = await getAgent().run(body.message.trim());
    return json(res, 200, result);
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : marketErrorStatus(error);
    return json(res, status ?? 500, { error: errorMessage(error) });
  }
});

if (
  process.env.HANDELO_STRATEGY_WORKER_ENABLED === "true" &&
  isEvmAddress(strategyWorkerWallet)
) {
  strategyWorker = createPersistedStrategyWorker(
    createHandeloStrategyWorkerDependencies({
      walletAddress: strategyWorkerWallet,
      executionWallet: wallet,
      market: getMarket(),
      store: strategyExecutionStore
    })
  );
  strategyWorker.start();
  console.log("Handelo strategy worker enabled for the configured controlled wallet.");
}

const liveMarketTimer = setInterval(() => {
  void broadcastLiveMarket();
}, 2500);
liveMarketTimer.unref?.();

const liveAccountTimer = setInterval(() => {
  const now = Date.now();
  if (now - lastLivePortfolioBroadcastAt < 12000) return;
  lastLivePortfolioBroadcastAt = now;
  void broadcastLiveAccounts();
}, 15000);
liveAccountTimer.unref?.();

server.listen(port, host, () => {
  console.log(`Handelo API listening on http://${host}:${port}`);
  void discoverMarketsCached(true).catch(() => undefined);
});
