import { evaluatePortfolioStrategyRisk, type StrategyDefinition } from "@handelo/core";
import { evaluateStrategyCondition, executionGrantFromStrategy, type StrategyExecutionRecord, type StrategyExecutionStore } from "@handelo/strategy";
import { BinanceAgenticWalletAdapter } from "@handelo/execution";
import { marketClientFromEnv, type RwaAsset } from "@handelo/market";
import { portfolioSnapshot } from "./portfolio.js";

export const SUPPORTED_AUTONOMOUS_STRATEGIES = ["DCA", "RECURRING"] as const;
export type SupportedAutonomousStrategy = typeof SUPPORTED_AUTONOMOUS_STRATEGIES[number];

export function isSupportedAutonomousStrategy(strategy: StrategyDefinition): strategy is StrategyDefinition & { type: SupportedAutonomousStrategy } {
  return SUPPORTED_AUTONOMOUS_STRATEGIES.includes(strategy.type as SupportedAutonomousStrategy);
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
}

export function createHandeloStrategyWorkerDependencies(
  dependencies: HandeloStrategyWorkerDependencies
) {
  const quoteToken = process.env.HANDELO_QUOTE_TOKEN ?? "0x55d398326f99059fF775485246999027B3197955";

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
      if (!isSupportedAutonomousStrategy(strategy) || !strategy.amountUsd || strategy.amountUsd <= 0) return false;

      const asset = await dependencies.market.find(strategy.asset);
      if (!asset.statusInfo.openState) return false;

      const { evaluatePolicy } = await import("@handelo/policy");
      const policy = evaluatePolicy({
        action: "buy",
        amountUsd: strategy.amountUsd,
        marketOpen: asset.statusInfo.openState,
        premiumPct: premiumPercent(asset)
      });
      if (policy.decision !== "READY") return false;

      const portfolio = await portfolioSnapshot(dependencies.walletAddress);
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
      if (!strategy.amountUsd || strategy.amountUsd <= 0) {
        throw new Error("Autonomous strategy amount must be greater than zero.");
      }

      const asset = await dependencies.market.find(strategy.asset);
      if (!asset.statusInfo.openState) {
        throw new Error("Tokenized-stock reference market is closed; autonomous execution is blocked.");
      }

      const quote = await dependencies.executionWallet.quote({
        fromTokenQty: String(strategy.amountUsd),
        fromToken: quoteToken,
        toToken: asset.tokenContractAddress,
        binanceChainId: "56"
      });

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
