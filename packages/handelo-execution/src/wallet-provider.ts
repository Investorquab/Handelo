import type { AgentWalletContext, AgentWalletPolicy, WalletPermission } from "@handelo/core";

export interface WalletProviderCapabilities {
  bscMainnet: boolean;
  personalWallet: boolean;
  agentWallet: boolean;
  scopedPermissions: boolean;
  spendLimits: boolean;
  expiry: boolean;
  revocation: boolean;
  transferOut: boolean;
}

export interface WalletSessionGrant {
  ownerWallet: string;
  agentWallet: string;
  network: "BSC";
  permissions: WalletPermission[];
  maxTransactionUsd?: number;
  maxDailySpendUsd?: number;
  allowedAssets?: string[];
  minimumReservePercent?: number;
  expiresAt?: string | null;
  revocable: boolean;
}

export interface WalletProviderAdapter {
  readonly name: string;
  capabilities(): Promise<WalletProviderCapabilities>;
  getContext(): Promise<AgentWalletContext>;
  createSession?(grant: WalletSessionGrant): Promise<{ sessionId: string }>;
  revokeSession?(sessionId: string): Promise<void>;
}

export function sessionGrantFromPolicy(
  ownerWallet: string,
  agentWallet: string,
  policy: AgentWalletPolicy
): WalletSessionGrant {
  if (!ownerWallet || !agentWallet) {
    throw new Error("Wallet session requires both an owner wallet and an agent wallet.");
  }
  if (!policy.revocable) {
    throw new Error("Autonomous wallet sessions must be revocable.");
  }
  if (
    policy.expiresAt !== undefined &&
    policy.expiresAt !== null &&
    (!Number.isFinite(Date.parse(policy.expiresAt)) || Date.parse(policy.expiresAt) <= Date.now())
  ) {
    throw new Error("Wallet session expiry must be a valid future timestamp.");
  }
  return {
    ownerWallet,
    agentWallet,
    network: "BSC",
    permissions: [...policy.permissions],
    maxTransactionUsd: policy.maxTransactionUsd,
    maxDailySpendUsd: policy.maxDailySpendUsd,
    allowedAssets: policy.allowedAssets ? [...policy.allowedAssets] : undefined,
    minimumReservePercent: policy.minimumReservePercent,
    expiresAt: policy.expiresAt ?? null,
    revocable: policy.revocable
  };
}

export function autonomousExecutionProviderReady(
  capabilities: WalletProviderCapabilities
): boolean {
  return Object.values(capabilities).every(Boolean);
}
