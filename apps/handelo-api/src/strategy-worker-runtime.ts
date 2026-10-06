import { evaluatePortfolioStrategyRisk, type PortfolioSnapshot, type StrategyDefinition } from "@handelo/core";
import { evaluateStrategyCondition, executionGrantFromStrategy, RetryableStrategyExecutionError, type StrategyExecutionRecord, type StrategyExecutionStore } from "@handelo/strategy";
import { createRebalancePreview } from "@handelo/core";
import { BinanceAgenticWalletAdapter } from "@handelo/execution";
import { marketClientFromEnv, type RwaAsset } from "@handelo/market";
import { portfolioSnapshot } from "./portfolio.js";

export const SUPPORTED_AUTONOMOUS_STRATEGIES = ["DCA", "RECURRING", "CONDITIONAL", "REBALANCE"] as const;
export type SupportedAutonomousStrategy = typeof SUPPORTED_AUTONOMOUS_STRATEGIES[number];

export function isSupportedAutonomousStrategy(strategy: StrategyDefinition): strategy is StrategyDefinition & { type: SupportedAutonomousStrategy } {
  return SUPPORTED_AUTONOMOUS_STRATEGIES.includes(strategy.type as SupportedAutonomousStrategy);
}


function assertSufficientCash(balanceUsd: number | null, amountUsd: number, minimumReservePercent = 10): void {
  if (balanceUsd === null) {
    throw new Error("Cash balance is unavailable; autonomous execution is blocked until available balance can be verified.");
  }
  if (!Number.isFinite(balanceUsd) || balanceUsd < 0 || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("Invalid cash balance or execution amount; autonomous execution is blocked.");
  }
  const minimumReserveUsd = balanceUsd * (minimumReservePercent / 100);
  if (balanceUsd - amountUsd + 1e-9 < minimumReserveUsd) {
    throw new Error("Insufficient available cash balance for autonomous execution while preserving the minimum reserve.");
  }
}


function isTransientNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message : String(error);
  const transientCodes = new Set([
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
    "EHOSTUNREACH", "ENETUNREACH", "EPIPE"
  ]);
  if (transientCodes.has(code) || name === "timeouterror") return true;
  return /fetch failed|socket hang up|connection (?:reset|refused|closed)|network (?:error|failure)|timed out/i.test(message);
}

function retryableDependencyError(error: unknown, operation: string): Error {
  if (error instanceof RetryableStrategyExecutionError) return error;
  if (!isTransientNetworkError(error)) return error instanceof Error ? error : new Error(String(error));
  const message = error instanceof Error ? error.message : String(error);
  return new RetryableStrategyExecutionError(
    `${operation} failed due to a transient network/API error: ${message}`
  );
}

function premiumPercent(asset: RwaAsset): number | null {
  const tokenPrice = Number(asset.tokenPrice);
  const referencePrice = Number(asset.referencePrice);
  if (!Number.isFinite(tokenPrice) || !Number.isFinite(referencePrice) || referencePrice === 0) return null;
  return ((tokenPrice - referencePrice) / referencePrice) * 100;
}

export interface HandeloStrategyWorkerDependencies {
  walletAddress: string;
  executionWallet: BinanceAgenticWalletAdapter;
  market: Pick<ReturnType<typeof marketClientFromEnv>, "find">;
  store: StrategyExecutionStore;
  portfolioSnapshot?: (wallet: string) => Promise<PortfolioSnapshot>;
}

export function createHandeloStrategyWorkerDependencies(
  dependencies: HandeloStrategyWorkerDependencies
) {
  const quoteToken = process.env.HANDELO_QUOTE_TOKEN ?? "0x55d398326f99059fF775485246999027B3197955";
  const loadPortfolio = dependencies.portfolioSnapshot ?? portfolioSnapshot;

  return {
    wallet: dependencies.walletAddress,
    store: dependencies.store,
    marketOpen: true,
    conditionMet: async (strategy: StrategyDefinition) => {
      if (strategy.type !== "CONDITIONAL" || !strategy.condition) return false;
      const asset = await dependencies.market.find(strategy.asset);
      const tokenPrice = Number(asset.tokenPrice);
      const referencePrice = Number(asset.referencePrice);
      if (!Number.isFinite(tokenPrice) || !Number.isFinite(referencePrice) || referencePrice <= 0) return false;
      return evaluateStrategyCondition(strategy.condition, {
        tokenPrice,
        referencePrice,
        marketOpen: asset.statusInfo.openState
      });
    },
    riskCheck: async (strategy: StrategyDefinition, _record: StrategyExecutionRecord): Promise<boolean> => {
      if (!isSupportedAutonomousStrategy(strategy)) return false;
      let portfolio: PortfolioSnapshot;
      try {
        portfolio = await loadPortfolio(dependencies.walletAddress);
      } catch (error) {
        throw retryableDependencyError(error, "Portfolio reconciliation");
      }

      if (strategy.type === "REBALANCE") {
        if (!strategy.targetAllocation || !Number.isFinite(Number(portfolio.totalValueUsd)) || Number(portfolio.totalValueUsd) <= 0) return false;
        const preview = createRebalancePreview(portfolio, strategy.targetAllocation);
        const totalBuyUsd = preview.actions
          .filter(item => item.direction === "BUY")
          .reduce((sum, item) => sum + item.amountUsd, 0);
        if (totalBuyUsd > 0) {
          const reserve = strategy.constraints.minimumReservePercent ?? 10;
          assertSufficientCash(portfolio.balanceUsd, totalBuyUsd, reserve);
        }
        for (const action of preview.actions.filter(item => item.direction === "BUY")) {
          const asset = await dependencies.market.find(action.asset);
          if (!asset.statusInfo.openState) return false;
          const { evaluatePolicy } = await import("@handelo/policy");
          const policy = evaluatePolicy({
            action: "buy",
            amountUsd: action.amountUsd,
            marketOpen: asset.statusInfo.openState,
            premiumPct: premiumPercent(asset)
          });
          if (policy.decision !== "READY") return false;
          const risk = evaluatePortfolioStrategyRisk(portfolio, asset.tokenSymbol, action.amountUsd, strategy.constraints);
          if (risk.decision !== "PASS") return false;
        }
        return true;
      }

      if (!strategy.amountUsd || strategy.amountUsd <= 0) return false;
      let asset: RwaAsset;
      try {
        asset = await dependencies.market.find(strategy.asset);
      } catch (error) {
        throw retryableDependencyError(error, "Market data lookup");
      }
      if (!asset.statusInfo.openState) return false;

      const { evaluatePolicy } = await import("@handelo/policy");
      const policy = evaluatePolicy({
        action: "buy",
        amountUsd: strategy.amountUsd,
        marketOpen: asset.statusInfo.openState,
        premiumPct: premiumPercent(asset)
      });
      if (policy.decision !== "READY") return false;

      const risk = evaluatePortfolioStrategyRisk(
        portfolio,
        asset.tokenSymbol,
        strategy.amountUsd,
        strategy.constraints
      );
      if (risk.decision !== "PASS") return false;

      const grant = executionGrantFromStrategy(strategy);
      return grant.allowedAssets.some(
        allowed => allowed.toLowerCase() === asset.tokenSymbol.toLowerCase() ||
          allowed.toLowerCase() === asset.underlyingTicker.toLowerCase()
      );
    },
    execute: async (strategy: StrategyDefinition, _record: StrategyExecutionRecord): Promise<void> => {
      if (!isSupportedAutonomousStrategy(strategy)) {
        throw new Error("This strategy type is not enabled for autonomous BAW execution yet.");
      }

      if (strategy.type === "REBALANCE") {
        if (!strategy.targetAllocation) throw new Error("Rebalance strategy requires target allocation.");
        const portfolio = await loadPortfolio(dependencies.walletAddress);
        const preview = createRebalancePreview(portfolio, strategy.targetAllocation);
        const totalBuyUsd = preview.actions
          .filter(item => item.direction === "BUY")
          .reduce((sum, item) => sum + item.amountUsd, 0);
        if (totalBuyUsd > 0) {
          const reserve = strategy.constraints.minimumReservePercent ?? 10;
          assertSufficientCash(portfolio.balanceUsd, totalBuyUsd, reserve);
        }
        const stableToken = quoteToken;
        for (const action of preview.actions.filter(item => item.direction !== "HOLD")) {
          const asset = await dependencies.market.find(action.asset);
          if (!asset.statusInfo.openState) throw new Error("Reference market is closed; rebalance execution is blocked.");
          const amount = Number(action.amountUsd);
          if (!Number.isFinite(amount) || amount <= 0) continue;

          if (action.direction === "BUY") {
            const quote = await dependencies.executionWallet.quote({
              fromTokenQty: String(amount),
              fromToken: stableToken,
              toToken: asset.tokenContractAddress,
              binanceChainId: "56"
            });
            if (!(Number(quote.toCoinAmount) > 0)) throw new Error("Fresh rebalance buy quote returned no executable quantity.");
            const result = await dependencies.executionWallet.execute({
              fromTokenQty: quote.fromCoinAmount,
              fromToken: stableToken,
              toToken: asset.tokenContractAddress,
              binanceChainId: "56"
            }, true);
            if (result.status !== "FINISHED") throw new Error("Rebalance buy did not finish successfully.");
          } else {
            const tokenPrice = Number(asset.tokenPrice);
            if (!Number.isFinite(tokenPrice) || tokenPrice <= 0) throw new Error("Cannot calculate rebalance sell quantity from live token price.");
            const tokenQuantity = amount / tokenPrice;
            const quote = await dependencies.executionWallet.quote({
              fromTokenQty: String(tokenQuantity),
              fromToken: asset.tokenContractAddress,
              toToken: stableToken,
              binanceChainId: "56"
            });
            if (!(Number(quote.toCoinAmount) > 0)) throw new Error("Fresh rebalance sell quote returned no executable quantity.");
            const result = await dependencies.executionWallet.execute({
              fromTokenQty: quote.fromCoinAmount,
              fromToken: asset.tokenContractAddress,
              toToken: stableToken,
              binanceChainId: "56"
            }, true);
            if (result.status !== "FINISHED") throw new Error("Rebalance sell did not finish successfully.");
          }
        }
        return;
      }

      if (!strategy.amountUsd || strategy.amountUsd <= 0) {
        throw new Error("Autonomous strategy amount must be greater than zero.");
      }

      let portfolio: PortfolioSnapshot;
      try {
        portfolio = await loadPortfolio(dependencies.walletAddress);
      } catch (error) {
        throw retryableDependencyError(error, "Portfolio reconciliation");
      }
      assertSufficientCash(
        portfolio.balanceUsd,
        strategy.amountUsd,
        strategy.constraints.minimumReservePercent ?? 10
      );

      let asset: RwaAsset;
      try {
        asset = await dependencies.market.find(strategy.asset);
      } catch (error) {
        throw retryableDependencyError(error, "Market data lookup");
      }
      if (!asset.statusInfo.openState) {
        throw new Error("Tokenized-stock reference market is closed; autonomous execution is blocked.");
      }

      let quote: Awaited<ReturnType<BinanceAgenticWalletAdapter["quote"]>>;
      try {
        quote = await dependencies.executionWallet.quote({
          fromTokenQty: String(strategy.amountUsd),
          fromToken: quoteToken,
          toToken: asset.tokenContractAddress,
          binanceChainId: "56"
        });
      } catch (error) {
        throw retryableDependencyError(error, "Agentic Wallet quote");
      }

      const toAmount = Number(quote.toCoinAmount);
      if (!Number.isFinite(toAmount) || toAmount <= 0) {
        throw new Error("Fresh Agentic Wallet quote returned no executable quantity.");
      }

      const result = await dependencies.executionWallet.execute({
        fromTokenQty: quote.fromCoinAmount,
        fromToken: quoteToken,
        toToken: asset.tokenContractAddress,
        binanceChainId: "56"
      }, true);

      if (result.status === "FAILED") {
        throw new Error("Agentic Wallet rejected the autonomous strategy order.");
      }
      if (result.status === "PENDING") {
        throw new Error("Agentic Wallet order remained pending after the verification window.");
      }
    }
  };
}
