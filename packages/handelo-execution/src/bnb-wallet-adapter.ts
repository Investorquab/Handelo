import type { AgentWalletContext } from "@handelo/core";
import { canAgentPermission } from "./wallet-context.js";
import type {
  WalletProviderAdapter,
  WalletProviderCapabilities,
  WalletSessionGrant
} from "./wallet-provider.js";
import { autonomousExecutionProviderReady, intersectWalletPolicies, validateWalletSessionGrant } from "./wallet-provider.js";

export interface BnbWalletRuntime {
  capabilities(): Promise<WalletProviderCapabilities>;
  getContext(): Promise<AgentWalletContext>;
  createSession?: (grant: WalletSessionGrant) => Promise<{ sessionId: string }>;
  revokeSession?: (sessionId: string) => Promise<void>;
}

export class BnbWalletAdapter implements WalletProviderAdapter {
  readonly name = "bnb-agent-wallet";

  constructor(private readonly runtime: BnbWalletRuntime) {}

  async capabilities(): Promise<WalletProviderCapabilities> {
    return this.runtime.capabilities();
  }

  async getContext(): Promise<AgentWalletContext> {
    return this.runtime.getContext();
  }

  async createSession(grant: WalletSessionGrant): Promise<{ sessionId: string }> {
    if (!this.runtime.createSession) {
      throw new Error("BNB wallet runtime does not expose session creation.");
    }
    const capabilities = await this.capabilities();
    if (!autonomousExecutionProviderReady(capabilities)) {
      throw new Error("BNB wallet provider has not passed the autonomous execution capability gate.");
    }
    const validatedGrant = validateWalletSessionGrant(grant);
    const context = await this.getContext();
    if (context.role !== "AGENT" || context.mode !== "USER") {
      throw new Error("Wallet session creation requires an active USER-mode agent wallet context.");
    }
    if (!context.connected || context.network !== "BSC" || context.status !== "ACTIVE") {
      throw new Error("Wallet session creation requires a connected active BSC agent wallet context.");
    }
    const ownerMatches = context.ownerWallet?.trim().toLowerCase() === validatedGrant.ownerWallet.toLowerCase();
    const contextAddress = context.address?.trim().toLowerCase();
    const agentMatches = contextAddress === validatedGrant.agentWallet.toLowerCase();
    if (!ownerMatches || !agentMatches) {
      throw new Error("Wallet session grant does not match the connected BNB wallet context.");
    }
    if (!context.policy.revocable) {
      throw new Error("Agent wallet policy is not revocable; autonomous session creation is blocked.");
    }
    if (
      context.policy.expiresAt !== undefined &&
      context.policy.expiresAt !== null &&
      (!Number.isFinite(Date.parse(context.policy.expiresAt)) || Date.parse(context.policy.expiresAt) <= Date.now())
    ) {
      throw new Error("Agent wallet policy expiry must be a valid future timestamp.");
    }
    for (const permission of validatedGrant.permissions) {
      if (!canAgentPermission(context, permission)) {
        throw new Error(`Agent wallet policy does not authorize permission "${permission}" for this session.`);
      }
    }
    const effectiveGrant = intersectWalletPolicies(context.policy, validatedGrant);
    return this.runtime.createSession(effectiveGrant);
  }

  async revokeSession(sessionId: string): Promise<void> {
    if (!this.runtime.revokeSession) {
      throw new Error("BNB wallet runtime does not expose session revocation.");
    }
    if (!sessionId.trim()) throw new Error("Session ID is required for revocation.");
    const capabilities = await this.capabilities();
    if (!capabilities.revocation) {
      throw new Error("BNB wallet provider has not passed the revocation capability gate.");
    }
    await this.runtime.revokeSession(sessionId);
  }
}

export async function probeBnbWalletAdapter(
  adapter: WalletProviderAdapter
): Promise<{
  provider: string;
  capabilities: WalletProviderCapabilities;
  autonomousExecutionReady: boolean;
}> {
  const capabilities = await adapter.capabilities();
  return {
    provider: adapter.name,
    capabilities,
    autonomousExecutionReady: autonomousExecutionProviderReady(capabilities)
  };
}
