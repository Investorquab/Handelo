export type WalletConnectionStatus = "CONNECTED" | "UNCONNECTED" | "CREATING" | "UNAVAILABLE";
export type WalletTxLockStatus = "LOCKED" | "UNLOCKED" | "UNKNOWN";

export interface WalletGuardrails {
  provider: "BINANCE_AGENTIC_WALLET";
  status: WalletConnectionStatus;
  bscSupported: boolean | null;
  address: string | null;
  dailyLimitUsd: number | null;
  dailyQuotaLeftUsd: number | null;
  abnormalTxnHandling: string | null;
  tradeAllTokens: boolean | null;
  txLock: WalletTxLockStatus;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function normalizeWalletGuardrails(input: {
  status?: unknown;
  chains?: unknown;
  address?: unknown;
  settings?: unknown;
  quota?: unknown;
  txLock?: unknown;
}): WalletGuardrails {
  const statusValue = String(input.status ?? "UNAVAILABLE").trim().toUpperCase();
  const status: WalletConnectionStatus =
    statusValue === "CONNECTED" || statusValue === "UNCONNECTED" || statusValue === "CREATING"
      ? statusValue
      : "UNAVAILABLE";

  const chains = Array.isArray(input.chains) ? input.chains : [];
  const bscSupported = chains.length
    ? chains.some((chain) => String((chain as { binanceChainId?: unknown })?.binanceChainId ?? "").trim() === "56")
    : null;

  const settings = input.settings && typeof input.settings === "object" ? input.settings as Record<string, unknown> : {};
  const quota = input.quota && typeof input.quota === "object" ? input.quota as Record<string, unknown> : {};
  const txLockValue = String(input.txLock ?? "").trim().toUpperCase();

  return {
    provider: "BINANCE_AGENTIC_WALLET",
    status,
    bscSupported,
    address: typeof input.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(input.address.trim())
      ? input.address.trim()
      : null,
    dailyLimitUsd: firstFinite(settings.dailyLimit, settings.dailyLimitUsd),
    dailyQuotaLeftUsd: firstFinite(
      quota.dailyLimitLeft,
      quota.dailyQuotaLeft,
      quota.dailyLimitRemaining,
      quota.left
    ),
    abnormalTxnHandling: typeof settings.abnormalTxnHandling === "string"
      ? settings.abnormalTxnHandling
      : null,
    tradeAllTokens: typeof settings.tradeAllTokens === "boolean"
      ? settings.tradeAllTokens
      : null,
    txLock:
      txLockValue === "LOCKED" || txLockValue === "UNLOCKED"
        ? txLockValue
        : "UNKNOWN"
  };
}
