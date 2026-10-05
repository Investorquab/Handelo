import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HandeloAgent } from "@handelo/agent";
import { portfolioSnapshot } from "./portfolio.js";
import { BAW_COMMAND, BAW_SHELL, BinanceAgenticWalletAdapter } from "@handelo/execution";
import { isExecutableMarketAsset, marketClientFromEnv, MarketResolutionError, MarketUpstreamError, rankGapRadarAssets, toMarketInsight } from "@handelo/market";
import { auditToken, normalizeTokenAudit } from "@handelo/execution";
import { consumeReviewToken, createReviewToken, verifyReviewToken } from "./review-token.js";
import { walletServiceError } from "./wallet-errors.js";
import { activateStoredStrategy, listActiveStrategies } from "./strategy-store.js";

const port = Number(process.env.PORT ?? "8787");
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
const wallet = new BinanceAgenticWalletAdapter();
const DEFAULT_BSC_QUOTE_TOKEN = "0x55d398326f99059fF775485246999027B3197955";
const CORS_ORIGIN = process.env.HANDELO_CORS_ORIGIN?.trim() || "*";
const CLIENT_API_KEY = process.env.HANDELO_CLIENT_API_KEY?.trim() || "";
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

  if (req.method === "GET" && req.url === "/api/wallet/status") {
    try {
      const status = await walletStatus();
      return json(res, 200, status);
    } catch (error) {
      return json(res, 503, { status: "UNAVAILABLE", error: walletServiceError(error) });
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

  if (req.method === "GET" && req.url === "/api/markets") {
    try {
      return json(res, 200, await getMarket().discover(8));
    } catch (error) {
      const status = marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
    }
  }

  if (req.method === "GET" && req.url?.startsWith("/api/gap-radar")) {
    const requestedLimit = Number(new URL(req.url, "http://localhost").searchParams.get("limit") ?? "8");
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 25) : 8;
    try {
      const assets = rankGapRadarAssets(await getMarket().tokens());
      return json(res, 200, {
        markets: assets.slice(0, limit).map(toMarketInsight),
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

  if (req.method === "GET" && req.url?.startsWith("/api/strategies")) {
    const walletAddress = new URL(req.url, "http://localhost").searchParams.get("wallet")?.trim() ?? "";
    if (!isEvmAddress(walletAddress)) return json(res, 400, { error: "A valid wallet is required." });
    try {
      return json(res, 200, { strategies: await listActiveStrategies(walletAddress) });
    } catch (error) {
      return json(res, 500, { error: errorMessage(error) });
    }
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
        ticker?: unknown;
        amountUsd?: unknown;
        action?: unknown;
        fromToken?: unknown;
        slippage?: unknown;
        wallet?: unknown;
      }>(raw);

      const ticker = String(body.ticker ?? "").trim().toUpperCase();
      const amountUsd = Number(body.amountUsd);
      const action = body.action === "sell" ? "sell" : body.action === "invest" ? "invest" : "buy";
      const executableAction = (await import("@handelo/policy")).executionAction(action);

      if (!executableAction) {
        return json(res, 400, { error: "Handelo execution currently supports buy/invest only. Sell execution is not enabled." });
      }

      if (!ticker || !Number.isFinite(amountUsd) || amountUsd <= 0) {
        return json(res, 400, { error: "ticker and positive amountUsd are required" });
      }

      const walletAddress = String(body.wallet ?? "").trim();
      if (!isEvmAddress(walletAddress)) {
        return json(res, 400, { error: "A valid connected wallet address is required for transaction review." });
      }
      const asset = await getMarket().find(ticker);
      if (!isExecutableMarketAsset(asset)) {
        return json(res, 422, { error: "Live market data is invalid for this tokenized stock, so Handelo will not create an executable review." });
      }
      const premiumPct = (() => {
        const token = Number(asset.tokenPrice);
        const reference = Number(asset.referencePrice);
        if (!Number.isFinite(token) || !Number.isFinite(reference) || reference === 0) return null;
        return ((token - reference) / reference) * 100;
      })();

      const policy = (await import("@handelo/policy")).evaluatePolicy({
        action,
        amountUsd,
        marketOpen: asset.statusInfo.openState,
        premiumPct
      });

      let portfolioRisk = null;
      let portfolioRiskError: string | null = null;
      if (walletAddress) {
        try {
          const snapshot = await portfolioSnapshot(walletAddress);
          const { evaluatePortfolioStrategyRisk } = await import("@handelo/core");
          portfolioRisk = evaluatePortfolioStrategyRisk(snapshot, asset.tokenSymbol, amountUsd);
        } catch (error) {
          portfolioRiskError = error instanceof Error ? error.message : String(error);
        }
      } else {
        portfolioRiskError = "A connected wallet is required for portfolio risk review.";
      }
      const riskDecision = portfolioRisk?.decision ?? "BLOCK";

      let securityAudit: Awaited<ReturnType<typeof auditToken>> | null = null;
      let securityAuditError: string | null = null;
      let executionBlocked = false;
      try {
        securityAudit = normalizeTokenAudit(await auditToken("56", asset.tokenContractAddress));
        executionBlocked =
          !securityAudit.hasResult ||
          !securityAudit.isSupported ||
          (typeof securityAudit.riskLevel === "number" && securityAudit.riskLevel >= 4);
        if (!securityAudit.hasResult || !securityAudit.isSupported) {
          securityAuditError = "Token security audit data is unavailable for this token.";
        }
      } catch (error) {
        executionBlocked = true;
        securityAuditError = error instanceof Error ? error.message : String(error);
      }

      let quote: unknown = null;
      const fromToken = String(body.fromToken ?? process.env.HANDELO_QUOTE_TOKEN ?? DEFAULT_BSC_QUOTE_TOKEN).trim();
      const slippageResult = normalizeSlippage(body.slippage);
      if (slippageResult.error) return json(res, 400, { error: slippageResult.error });
      const slippage = slippageResult.value;
      let quoteError: string | null = null;

      if (fromToken && policy.decision !== "BLOCK" && riskDecision === "PASS") {
        try {
          if (fromToken.toLowerCase() !== DEFAULT_BSC_QUOTE_TOKEN.toLowerCase()) {
            throw new Error("Handelo's USD-notional execution path currently requires the BSC USDT quote token.");
          }
          quote = await wallet.quote({
            fromTokenQty: String(amountUsd),
            fromToken,
            toToken: asset.tokenContractAddress,
            binanceChainId: "56",
            slippage
          });
        } catch (error) {
          quoteError = error instanceof Error ? error.message : String(error);
        }
      }

      return json(res, 200, {
        asset: {
          ticker: asset.underlyingTicker,
          tokenSymbol: asset.tokenSymbol,
          contract: asset.tokenContractAddress,
          provider: asset.platformId,
          tokenPrice: asset.tokenPrice,
          referencePrice: asset.referencePrice,
          premiumPct,
          market: asset.statusInfo
        },
        policy,
        portfolioRisk,
        portfolioRiskError,
        riskDecision,
        securityAudit,
        securityAuditError,
        executionBlocked,
        quote,
        quoteError,
        quoteToken: fromToken || null,
        reviewToken: quote && riskDecision === "PASS" ? createReviewToken({
          ticker: asset.underlyingTicker,
          amountUsd,
          fromToken,
          contract: asset.tokenContractAddress,
          slippage,
          wallet: walletAddress
        }) : null
      });
    } catch (error) {
      const status = requestBodyErrorStatus(error) ?? marketErrorStatus(error);
      return json(res, status ?? 500, { error: errorMessage(error) });
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
        fromToken?: unknown;
        slippage?: unknown;
        confirmed?: unknown;
        reviewToken?: unknown;
        wallet?: unknown;
      }>(raw);

      const ticker = String(body.ticker ?? "").trim().toUpperCase();
      const fromToken = String(body.fromToken ?? "").trim();
      const amount = Number(body.amountUsd);
      const reviewToken = String(body.reviewToken ?? "").trim();
      const walletAddress = String(body.wallet ?? "").trim();

      if (!ticker || !Number.isFinite(amount) || amount <= 0 || !fromToken || !reviewToken || !isEvmAddress(walletAddress)) {
        return json(res, 400, {
          error: "ticker, positive amountUsd, fromToken, and reviewToken are required"
        });
      }

      if (fromToken.toLowerCase() !== DEFAULT_BSC_QUOTE_TOKEN.toLowerCase()) {
        return json(res, 400, { error: "Handelo's USD-notional execution path currently requires the BSC USDT quote token." });
      }

      const asset = await getMarket().find(ticker);
      if (!isExecutableMarketAsset(asset)) {
        return json(res, 422, { error: "Live market data is invalid for this tokenized stock, so execution is blocked." });
      }
      const slippageResult = normalizeSlippage(body.slippage);
      if (slippageResult.error) return json(res, 400, { error: slippageResult.error });
      const slippage = slippageResult.value;

      if (!verifyReviewToken(reviewToken, {
        ticker: asset.underlyingTicker,
        amountUsd: amount,
        fromToken,
        contract: asset.tokenContractAddress,
        slippage,
        wallet: walletAddress
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
        action: "buy",
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
      const portfolioRisk = evaluatePortfolioStrategyRisk(snapshot, asset.tokenSymbol, amount);
      if (portfolioRisk.decision !== "PASS") {
        return json(res, 409, {
          error: "Execution blocked by portfolio risk controls.",
          policy,
          portfolioRisk
        });
      }

      const securityAudit = normalizeTokenAudit(await auditToken("56", asset.tokenContractAddress));
      if (!securityAudit.hasResult || !securityAudit.isSupported) {
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
        fromTokenQty: String(amount),
        fromToken,
        toToken: asset.tokenContractAddress,
        binanceChainId: "56",
        slippage: typeof body.slippage === "string" ? body.slippage : undefined
      });

      if (!consumeReviewToken(reviewToken)) {
        return json(res, 409, { error: "This reviewed transaction has already been used. Start a new review before executing again." });
      }

      const result = await wallet.execute(
        {
          fromTokenQty: reviewedQuote.fromCoinAmount,
          fromToken,
          toToken: asset.tokenContractAddress,
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

  if (CLIENT_API_KEY && req.headers["x-handelo-api-key"] !== CLIENT_API_KEY) {
    return json(res, 401, { error: "A valid Handelo client API key is required." });
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

server.listen(port, () => console.log(`Handelo API listening on http://localhost:${port}`));
