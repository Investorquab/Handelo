import type { AgentWalletContext, AgentWalletPolicy, WalletContext, WalletMode, WalletPermission } from "@handelo/core";

export interface WalletIdentity {
  address: string;
  network: "BSC";
}

export interface AgentWalletProvider {
  getPersonalWallet(): Promise<WalletIdentity | null>;
  getAgentWallet(): Promise<WalletIdentity | null>;
  getAgentStatus(): Promise<AgentWalletContext["status"]>;
}

export interface WalletContextService {
  getContext(mode: WalletMode): Promise<{
    personal: WalletContext;
    agent: AgentWalletContext | null;
  }>;
}

export const DEFAULT_AGENT_POLICY: AgentWalletPolicy = {
  permissions: ["READ_PORTFOLIO", "DCA", "RECURRING"],
  maxTransactionUsd: 10,
  maxDailySpendUsd: 25,
  minimumReservePercent: 10,
  revocable: true
};

export function createWalletContext(
  mode: WalletMode,
  role: WalletContext["role"],
  identity: WalletIdentity | null,
  balanceUsd: number | null
): WalletContext {
  return {
    mode,
    role,
    address: identity?.address ?? null,
    network: "BSC",
    connected: Boolean(identity),
    balanceUsd
  };
}

export function createAgentWalletContext(
  mode: WalletMode,
  identity: WalletIdentity | null,
  ownerWallet: string | null,
  balanceUsd: number | null,
  policy: AgentWalletPolicy = DEFAULT_AGENT_POLICY,
  status: AgentWalletContext["status"] = identity ? "ACTIVE" : "UNAVAILABLE"
): AgentWalletContext {
  return {
    ...createWalletContext(mode, "AGENT", identity, balanceUsd),
    role: "AGENT",
    ownerWallet,
    policy,
    status
  };
}

export function canAgentPermission(
  context: AgentWalletContext,
  permission: WalletPermission
): boolean {
  if (context.status !== "ACTIVE") return false;
  if (context.policy.expiresAt && Date.parse(context.policy.expiresAt) <= Date.now()) return false;
  return context.policy.permissions.includes(permission);
}


export interface AgentSpendCheck {
  decision: "PASS" | "BLOCK";
  reasons: string[];
}

export function evaluateAgentSpend(
  context: AgentWalletContext,
  permission: WalletPermission,
  amountUsd: number,
  options: {
    asset?: string;
    dailySpentUsd?: number;
  } = {}
): AgentSpendCheck {
  const reasons: string[] = [];

  if (!canAgentPermission(context, permission)) {
    reasons.push("Agent wallet permission is not active for this operation.");
  }

  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    reasons.push("Spend amount must be greater than zero.");
  }

  const dailySpentUsd = options.dailySpentUsd ?? 0;
  if (!Number.isFinite(dailySpentUsd) || dailySpentUsd < 0) {
    reasons.push("Current daily spend must be a non-negative number.");
  }

  const maxTransactionUsd = context.policy.maxTransactionUsd;
  if (
    maxTransactionUsd !== undefined &&
    Number.isFinite(amountUsd) &&
    amountUsd > maxTransactionUsd
  ) {
    reasons.push("Transaction amount exceeds the $" + maxTransactionUsd + " agent limit.");
  }

  const maxDailySpendUsd = context.policy.maxDailySpendUsd;
  if (
    maxDailySpendUsd !== undefined &&
    Number.isFinite(amountUsd) &&
    Number.isFinite(dailySpentUsd) &&
    dailySpentUsd + amountUsd > maxDailySpendUsd
  ) {
    reasons.push("Daily spend would exceed the $" + maxDailySpendUsd + " agent limit.");
  }

  if (options.asset && context.policy.allowedAssets?.length) {
    const allowed = context.policy.allowedAssets.some(
      (asset) => asset.toLowerCase() === options.asset!.trim().toLowerCase()
    );
    if (!allowed) {
      reasons.push("Asset is not included in the agent wallet allowlist.");
    }
  }

  const minimumReservePercent = context.policy.minimumReservePercent;
  if (minimumReservePercent !== undefined) {
    if (context.balanceUsd === null || !Number.isFinite(context.balanceUsd)) {
      reasons.push("Wallet balance is unavailable, so the minimum reserve cannot be verified.");
    } else if (
      Number.isFinite(amountUsd) &&
      context.balanceUsd > 0 &&
      ((context.balanceUsd - amountUsd) / context.balanceUsd) * 100 < minimumReservePercent
    ) {
      reasons.push(
        "Spend would breach the " + minimumReservePercent + "% minimum wallet reserve."
      );
    }
  }

  return {
    decision: reasons.length === 0 ? "PASS" : "BLOCK",
    reasons
  };
}
