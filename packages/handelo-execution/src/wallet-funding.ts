import type { AgentWalletContext } from "@handelo/core";

const EVM_WALLET = /^0x[a-fA-F0-9]{40}$/;

export interface AgentWalletFundingRequest {
  ownerWallet: string;
  agentWallet: string;
  amountUsd: number;
  personalBalanceUsd: number | null;
  userApproved: boolean;
  approvalReference: string;
}

export interface AgentWalletFundingAuthorization {
  status: "AUTHORIZED";
  from: string;
  to: string;
  amountUsd: number;
  network: "BSC";
  approvalReference: string;
  requiresProviderExecution: true;
  onChain: false;
}

function assertWalletAddress(label: string, address: string): void {
  if (!EVM_WALLET.test(address.trim())) {
    throw new Error(`${label} must be a valid EVM wallet address.`);
  }
}

export function authorizeAgentWalletFunding(
  context: AgentWalletContext,
  request: AgentWalletFundingRequest
): AgentWalletFundingAuthorization {
  assertWalletAddress("Funding owner wallet", request.ownerWallet);
  assertWalletAddress("Funding agent wallet", request.agentWallet);

  if (context.mode !== "USER" || context.role !== "AGENT") {
    throw new Error("Agent wallet funding requires USER-mode agent wallet context.");
  }
  if (!context.connected || context.network !== "BSC" || context.status !== "ACTIVE") {
    throw new Error("Agent wallet funding requires a connected active BSC agent wallet.");
  }

  const contextOwner = context.ownerWallet?.trim().toLowerCase();
  const contextAgent = context.address?.trim().toLowerCase();
  if (
    contextOwner !== request.ownerWallet.trim().toLowerCase() ||
    contextAgent !== request.agentWallet.trim().toLowerCase()
  ) {
    throw new Error("Funding request does not match the connected BNB wallet context.");
  }

  if (!request.userApproved) {
    throw new Error("Agent wallet funding requires explicit user approval.");
  }
  if (!request.approvalReference.trim()) {
    throw new Error("Agent wallet funding requires an approval reference.");
  }
  if (!Number.isFinite(request.amountUsd) || request.amountUsd <= 0) {
    throw new Error("Funding amount must be a finite positive USD amount.");
  }
  if (
    request.personalBalanceUsd === null ||
    !Number.isFinite(request.personalBalanceUsd) ||
    request.personalBalanceUsd < request.amountUsd
  ) {
    throw new Error("Personal wallet balance is insufficient or unavailable for the requested funding amount.");
  }

  return {
    status: "AUTHORIZED",
    from: request.ownerWallet.trim(),
    to: request.agentWallet.trim(),
    amountUsd: request.amountUsd,
    network: "BSC",
    approvalReference: request.approvalReference.trim(),
    requiresProviderExecution: true,
    onChain: false
  };
}
