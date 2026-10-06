/**
 * Contract facts used by the Handelo Binance Agentic Wallet boundary.
 *
 * These are intentionally limited to documented command and chain facts. They
 * do not claim that Binance Agentic Wallet exposes generic owner-to-agent
 * session creation or revocation APIs; delegated session permissions are a
 * separate wallet-provider concern handled by the Agent Studio/Altana path.
 */

export const BNB_BSC_CHAIN_ID = "56" as const;

export const BNB_AGENTIC_WALLET_COMMANDS = {
  authSignin: ["auth", "signin"] as const,
  authVerify: ["auth", "verify"] as const,
  authSignout: ["auth", "signout"] as const,
  walletStatus: ["wallet", "status"] as const,
  walletAddress: ["wallet", "address"] as const,
  walletBalance: ["wallet", "balance"] as const,
  walletSettings: ["wallet", "settings"] as const,
  walletLeftQuota: ["wallet", "left-quota"] as const,
  walletTxLock: ["wallet", "tx-lock"] as const,
  walletChains: ["wallet", "chains"] as const,
  marketOrderQuote: ["market-order", "quote"] as const,
  marketOrderSwap: ["market-order", "swap"] as const,
  marketOrderList: ["market-order", "list"] as const
} as const;

export const BNB_AGENTIC_WALLET_STATUSES = [
  "CONNECTED",
  "UNCONNECTED",
  "CREATING"
] as const;

export type BnbAgenticWalletStatus = typeof BNB_AGENTIC_WALLET_STATUSES[number];

export function isBscChainId(chainId: string): boolean {
  return chainId.trim() === BNB_BSC_CHAIN_ID;
}
