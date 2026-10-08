import { BinanceAgenticWalletAdapter } from "@handelo/execution";
import type { PortfolioSnapshot as WorkspacePortfolioSnapshot } from "@handelo/core";

interface LiveBalance {
  symbol?: string;
  address?: string;
  binanceChainId?: string;
  balance?: string;
  price?: string;
  value?: string;
}

export async function portfolioSnapshot(wallet: string): Promise<WorkspacePortfolioSnapshot> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Error("Invalid EVM wallet address.");
  const balances = await new BinanceAgenticWalletAdapter().balances("56");
  const rows = balances
    .filter((balance) => balance.binanceChainId === "56")
    .map((balance) => {
      const symbol = String(balance.symbol ?? "").trim().toUpperCase();
      const contract = String(balance.address ?? "").trim();
      const amount = Number(balance.balance);
      const price = Number(balance.price);
      const valueRaw = Number(balance.value);
      const valueUsd =
        Number.isFinite(valueRaw) && valueRaw >= 0
          ? valueRaw
          : Number.isFinite(amount) && amount >= 0 && Number.isFinite(price) && price >= 0
            ? amount * price
            : null;
      return { symbol, contract, valueUsd };
    })
    .filter((row) => row.symbol && row.contract && row.valueUsd !== null && row.valueUsd > 0);

  const totalValueUsd = rows.reduce((sum, row) => sum + Number(row.valueUsd), 0);
  const positions = rows.map((row) => ({
    asset: row.symbol,
    tokenSymbol: row.symbol,
    allocationPercent: totalValueUsd > 0 ? (Number(row.valueUsd) / totalValueUsd) * 100 : null,
    valueUsd: Number(row.valueUsd)
  }));
  const usdt = rows.find((row) => row.symbol === "USDT");
  const balanceUsd = usdt ? Number(usdt.valueUsd) : null;

  return {
    wallet,
    positions,
    totalValueUsd,
    balanceUsd,
    source: "BSC_TOKEN_BALANCES",
    asOf: new Date().toISOString()
  };
}