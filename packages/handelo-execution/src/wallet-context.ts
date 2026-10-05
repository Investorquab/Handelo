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
