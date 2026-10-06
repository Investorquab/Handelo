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

const EVM_WALLET = /^0x[a-fA-F0-9]{40}$/;

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

export function assertAgentWalletOwnership(
  context: AgentWalletContext,
  ownerWallet: string
): AgentWalletContext {
  const expectedOwner = ownerWallet.trim();
  if (!EVM_WALLET.test(expectedOwner)) {
    throw new Error("Agent wallet ownership check requires a valid BSC EVM owner wallet.");
  }

  const contextOwner = context.ownerWallet?.trim() ?? "";
  if (!EVM_WALLET.test(contextOwner)) {
    throw new Error("Agent wallet context is missing a valid owner wallet.");
  }

  if (contextOwner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error("Agent wallet owner does not match the requesting personal wallet.");
  }

  if (context.mode !== "USER") {
    throw new Error("Autonomous user-owned agent wallet execution requires USER mode.");
  }

  if (context.status === "REVOKED" || context.status === "UNAVAILABLE") {
    throw new Error("Agent wallet is not available for the requesting owner.");
  }

  return context;
}

export function canAgentPermission(
  context: AgentWalletContext,
  permission: WalletPermission
): boolean {
  if (context.status !== "ACTIVE") return false;
  if (context.policy.expiresAt && Date.parse(context.policy.expiresAt) <= Date.now()) return false;
  return context.policy.permissions.includes(permission);
}
