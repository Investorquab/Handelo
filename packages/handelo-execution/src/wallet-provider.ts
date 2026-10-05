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

const EVM_WALLET = /^0x[a-fA-F0-9]{40}$/;

function assertWalletAddress(label: string, address: string): void {
  if (!EVM_WALLET.test(address.trim())) {
    throw new Error(`${label} must be a valid EVM wallet address.`);
  }
}

function assertNonNegativeFinite(label: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
}

function assertPolicyBounds(policy: AgentWalletPolicy): void {
  assertNonNegativeFinite("Maximum transaction", policy.maxTransactionUsd);
  assertNonNegativeFinite("Maximum daily spend", policy.maxDailySpendUsd);

  if (
    policy.maxTransactionUsd !== undefined &&
    policy.maxDailySpendUsd !== undefined &&
    policy.maxTransactionUsd > policy.maxDailySpendUsd
  ) {
    throw new Error("Maximum transaction spend cannot exceed maximum daily spend.");
  }

  if (
    policy.minimumReservePercent !== undefined &&
    (!Number.isFinite(policy.minimumReservePercent) ||
      policy.minimumReservePercent < 0 ||
      policy.minimumReservePercent > 100)
  ) {
    throw new Error("Minimum reserve percent must be between 0 and 100.");
  }

  if (policy.permissions.length === 0) {
    throw new Error("Autonomous wallet sessions require at least one permission.");
  }

  if (policy.permissions.includes("TRANSFER_OUT") && !policy.allowedAssets?.length) {
    throw new Error("TRANSFER_OUT sessions require an explicit allowed asset scope.");
  }
}

export function validateWalletSessionGrant(grant: WalletSessionGrant): WalletSessionGrant {
  assertWalletAddress("Owner wallet", grant.ownerWallet);
  assertWalletAddress("Agent wallet", grant.agentWallet);

  if (grant.network !== "BSC") {
    throw new Error("Autonomous wallet sessions are restricted to BSC.");
  }

  assertNonNegativeFinite("Maximum transaction", grant.maxTransactionUsd);
  assertNonNegativeFinite("Maximum daily spend", grant.maxDailySpendUsd);

  if (
    grant.maxTransactionUsd !== undefined &&
    grant.maxDailySpendUsd !== undefined &&
    grant.maxTransactionUsd > grant.maxDailySpendUsd
  ) {
    throw new Error("Maximum transaction spend cannot exceed maximum daily spend.");
  }

  if (
    grant.minimumReservePercent !== undefined &&
    (!Number.isFinite(grant.minimumReservePercent) ||
      grant.minimumReservePercent < 0 ||
      grant.minimumReservePercent > 100)
  ) {
    throw new Error("Minimum reserve percent must be between 0 and 100.");
  }

  if (grant.permissions.length === 0) {
    throw new Error("Autonomous wallet sessions require at least one permission.");
  }

  if (grant.permissions.includes("TRANSFER_OUT") && !grant.allowedAssets?.length) {
    throw new Error("TRANSFER_OUT sessions require an explicit allowed asset scope.");
  }

  if (!grant.revocable) {
    throw new Error("Autonomous wallet sessions must be revocable.");
  }

  if (
    grant.expiresAt !== undefined &&
    grant.expiresAt !== null &&
    (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.now())
  ) {
    throw new Error("Wallet session expiry must be a valid future timestamp.");
  }

  return {
    ...grant,
    ownerWallet: grant.ownerWallet.trim(),
    agentWallet: grant.agentWallet.trim(),
    permissions: [...grant.permissions],
    allowedAssets: grant.allowedAssets ? [...grant.allowedAssets] : undefined
  };
}

export function sessionGrantFromPolicy(
  ownerWallet: string,
  agentWallet: string,
  policy: AgentWalletPolicy
): WalletSessionGrant {
  assertWalletAddress("Owner wallet", ownerWallet);
  assertWalletAddress("Agent wallet", agentWallet);
  assertPolicyBounds(policy);

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

  return validateWalletSessionGrant({
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
  });
}

export function intersectWalletPolicies(
  walletPolicy: AgentWalletPolicy,
  requested: WalletSessionGrant
): WalletSessionGrant {
  const walletAssets = walletPolicy.allowedAssets;
  const requestedAssets = requested.allowedAssets;

  if (
    walletAssets?.length &&
    requestedAssets?.length &&
    requestedAssets.some(asset => !walletAssets.includes(asset))
  ) {
    throw new Error("Strategy asset scope exceeds the wallet policy asset scope.");
  }

  const permissions = requested.permissions.filter(permission =>
    walletPolicy.permissions.includes(permission)
  );
  if (permissions.length !== requested.permissions.length) {
    throw new Error("Strategy requests a wallet permission that is not authorized by the wallet policy.");
  }

  const maxTransactionUsd = [walletPolicy.maxTransactionUsd, requested.maxTransactionUsd]
    .filter((value): value is number => value !== undefined)
    .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);

  const maxDailySpendUsd = [walletPolicy.maxDailySpendUsd, requested.maxDailySpendUsd]
    .filter((value): value is number => value !== undefined)
    .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);

  const minimumReservePercent = Math.max(
    walletPolicy.minimumReservePercent ?? 0,
    requested.minimumReservePercent ?? 0
  );

  return validateWalletSessionGrant({
    ...requested,
    permissions,
    maxTransactionUsd: Number.isFinite(maxTransactionUsd) ? maxTransactionUsd : undefined,
    maxDailySpendUsd: Number.isFinite(maxDailySpendUsd) ? maxDailySpendUsd : undefined,
    minimumReservePercent,
    allowedAssets: requestedAssets?.length
      ? [...requestedAssets]
      : walletAssets?.length
        ? [...walletAssets]
        : undefined,
    revocable: requested.revocable && walletPolicy.revocable
  });
}

export function autonomousExecutionProviderReady(
  capabilities: WalletProviderCapabilities
): boolean {
  return Object.values(capabilities).every(Boolean);
}
