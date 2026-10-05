import type { AgentWalletContext } from "@handelo/core";
import type {
  WalletProviderAdapter,
  WalletProviderCapabilities,
  WalletSessionGrant
} from "./wallet-provider.js";
import { autonomousExecutionProviderReady } from "./wallet-provider.js";

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
    return this.runtime.createSession(grant);
  }

  async revokeSession(sessionId: string): Promise<void> {
    if (!this.runtime.revokeSession) {
      throw new Error("BNB wallet runtime does not expose session revocation.");
    }
    if (!sessionId.trim()) throw new Error("Session ID is required for revocation.");
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
