import { HandeloPortfolio } from "@handelo/portfolio";
import type { PortfolioSnapshot as WorkspacePortfolioSnapshot } from "@handelo/core";

export async function portfolioSnapshot(wallet: string): Promise<WorkspacePortfolioSnapshot> {
  const snapshot = await new HandeloPortfolio().snapshot(wallet);
  const totalValueUsd = snapshot.totalEstimatedValueUsd;
  const positions = snapshot.positions.map((position) => ({
    asset: position.ticker,
    tokenSymbol: position.tokenSymbol,
    allocationPercent: totalValueUsd && totalValueUsd > 0 && position.estimatedValueUsd !== null
      ? (position.estimatedValueUsd / totalValueUsd) * 100
      : null,
    valueUsd: position.estimatedValueUsd
  }));
  return {
    wallet: snapshot.wallet,
    balanceUsd: null,
    positions,
    totalValueUsd,
    source: snapshot.source,
    asOf: snapshot.asOf
  };
}
