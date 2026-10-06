import type { AgentWalletContext } from "@handelo/core";
import type { AgentWalletProvider, WalletIdentity } from "./wallet-context.js";

export interface BnbAgentWalletRuntime {
  getPersonalWallet(): Promise<WalletIdentity | null>;
  getAgentWallet(): Promise<WalletIdentity | null>;
  getAgentStatus(): Promise<AgentWalletContext["status"]>;
}

export function assertBscWalletIdentity(identity: WalletIdentity | null): WalletIdentity | null {
  if (identity === null) return null;
  if (identity.network !== "BSC" || !/^0x[a-fA-F0-9]{40}$/.test(identity.address.trim())) {
    throw new Error("Wallet provider returned an invalid BSC EVM wallet identity.");
  }
  return { address: identity.address.trim(), network: "BSC" };
}

export class BnbAgentWalletProvider implements AgentWalletProvider {
  constructor(private readonly runtime: BnbAgentWalletRuntime) {}

  async getPersonalWallet(): Promise<WalletIdentity | null> {
    return assertBscWalletIdentity(await this.runtime.getPersonalWallet());
  }

  async getAgentWallet(): Promise<WalletIdentity | null> {
    return assertBscWalletIdentity(await this.runtime.getAgentWallet());
  }

  async getAgentStatus(): Promise<AgentWalletContext["status"]> {
    return this.runtime.getAgentStatus();
  }
}
