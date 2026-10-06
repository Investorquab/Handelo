import type { AgentWalletContext } from "@handelo/core";

const EVM_WALLET = /^0x[a-fA-F0-9]{40}$/;
const BSC_CHAIN_ID = "0x38";
const ERC20_TRANSFER_SELECTOR = "a9059cbb";

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

export interface PersonalWalletFundingTransaction {
  from: string;
  to: string;
  data: string;
  chainId: "0x38";
}

export interface PersonalWalletProvider {
  request(args: {
    method: string;
    params?: unknown[];
  }): Promise<unknown>;
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

function normalizeHexAddress(address: string, label: string): string {
  assertWalletAddress(label, address);
  return address.trim().slice(2).toLowerCase().padStart(64, "0");
}

function tokenAmountToBaseUnits(amount: string, decimals: number): bigint {
  const normalized = amount.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals must be an integer from 0 to 255.");
  }
  if (!/^\d+(?:\.\d+)?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error("Token amount must be a positive decimal amount.");
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error("Token amount has more decimal places than the token supports.");
  }
  const base = BigInt(whole) * (10n ** BigInt(decimals));
  const fractional = fraction.padEnd(decimals, "0");
  const units = base + (fractional ? BigInt(fractional) : 0n);
  if (units <= 0n) throw new Error("Token amount must be greater than zero.");
  return units;
}

export function buildPersonalWalletFundingTransaction(args: {
  authorization: AgentWalletFundingAuthorization;
  tokenAddress: string;
  tokenAmount: string;
  tokenDecimals: number;
}): PersonalWalletFundingTransaction {
  const { authorization, tokenAddress, tokenAmount, tokenDecimals } = args;
  assertWalletAddress("Funding token contract", tokenAddress);
  assertWalletAddress("Funding owner wallet", authorization.from);
  assertWalletAddress("Funding agent wallet", authorization.to);
  if (authorization.network !== "BSC") {
    throw new Error("Personal wallet funding is restricted to BSC.");
  }
  if (!authorization.requiresProviderExecution || authorization.onChain) {
    throw new Error("Funding authorization is not a valid pre-chain provider request.");
  }

  const amountBaseUnits = tokenAmountToBaseUnits(tokenAmount, tokenDecimals);
  const data =
    "0x" +
    ERC20_TRANSFER_SELECTOR +
    normalizeHexAddress(authorization.to, "Funding agent wallet") +
    amountBaseUnits.toString(16).padStart(64, "0");

  return {
    from: authorization.from,
    to: tokenAddress.trim(),
    data,
    chainId: BSC_CHAIN_ID
  };
}

export async function sendPersonalWalletFunding(
  provider: PersonalWalletProvider,
  transaction: PersonalWalletFundingTransaction
): Promise<string> {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId !== BSC_CHAIN_ID) {
    throw new Error("Personal wallet funding requires the connected wallet to be on BSC.");
  }

  const accounts = await provider.request({ method: "eth_accounts" });
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    accounts[0].toLowerCase() !== transaction.from.toLowerCase()
  ) {
    throw new Error("Connected personal wallet does not match the approved funding owner.");
  }

  const txHash = await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: transaction.from,
      to: transaction.to,
      data: transaction.data,
      chainId: BSC_CHAIN_ID
    }]
  });

  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]+$/.test(txHash)) {
    throw new Error("Personal wallet provider returned an invalid funding transaction hash.");
  }
  return txHash;
}
