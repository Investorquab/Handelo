import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeAgentWalletFunding,
  buildPersonalWalletFundingTransaction,
  sendPersonalWalletFunding
} from "./wallet-funding.js";
import type { AgentWalletContext } from "@handelo/core";

const owner = "0x1111111111111111111111111111111111111111";
const agent = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";

function context(overrides: Partial<AgentWalletContext> = {}): AgentWalletContext {
  return {
    mode: "USER",
    role: "AGENT",
    address: agent,
    network: "BSC",
    connected: true,
    balanceUsd: 20,
    ownerWallet: owner,
    policy: { permissions: ["DCA"], revocable: true },
    status: "ACTIVE",
    ...overrides
  };
}

function request(overrides: Partial<Parameters<typeof authorizeAgentWalletFunding>[1]> = {}) {
  return {
    ownerWallet: owner,
    agentWallet: agent,
    amountUsd: 5,
    personalBalanceUsd: 20,
    userApproved: true,
    approvalReference: "approval-001",
    ...overrides
  };
}

test("authorizes a policy-bound funding request without claiming an on-chain transfer", () => {
  const result = authorizeAgentWalletFunding(context(), request());
  assert.equal(result.status, "AUTHORIZED");
  assert.equal(result.from, owner);
  assert.equal(result.to, agent);
  assert.equal(result.requiresProviderExecution, true);
  assert.equal(result.onChain, false);
});

test("builds an ERC-20 BSC transfer request for the approved agent wallet", () => {
  const authorization = authorizeAgentWalletFunding(context(), request());
  const transaction = buildPersonalWalletFundingTransaction({
    authorization,
    tokenAddress: token,
    tokenAmount: "5",
    tokenDecimals: 18
  });

  assert.equal(transaction.from, owner);
  assert.equal(transaction.to, token);
  assert.equal(transaction.chainId, "0x38");
  assert.match(transaction.data, /^0xa9059cbb/);
  assert.equal(transaction.data.length, 2 + 8 + 64 + 64);
  assert.ok(transaction.data.endsWith((5n * 10n ** 18n).toString(16).padStart(64, "0")));
});

test("rejects token amounts that cannot be represented safely", () => {
  const authorization = authorizeAgentWalletFunding(context(), request());
  assert.throws(
    () => buildPersonalWalletFundingTransaction({
      authorization,
      tokenAddress: token,
      tokenAmount: "1.001",
      tokenDecimals: 2
    }),
    /more decimal places/
  );
  assert.throws(
    () => buildPersonalWalletFundingTransaction({
      authorization,
      tokenAddress: token,
      tokenAmount: "0",
      tokenDecimals: 18
    }),
    /positive decimal/
  );
});

test("personal wallet provider must be on BSC and match the approved owner", async () => {
  const authorization = authorizeAgentWalletFunding(context(), request());
  const transaction = buildPersonalWalletFundingTransaction({
    authorization,
    tokenAddress: token,
    tokenAmount: "5",
    tokenDecimals: 18
  });

  const calls: Array<{ method: string; params?: unknown[] }> = [];
  const provider = {
    request: async (args: { method: string; params?: unknown[] }) => {
      calls.push(args);
      if (args.method === "eth_chainId") return "0x38";
      if (args.method === "eth_accounts") return [owner];
      return "0xabc123";
    }
  };

  const hash = await sendPersonalWalletFunding(provider, transaction);
  assert.equal(hash, "0xabc123");
  assert.deepEqual(calls.map(call => call.method), [
    "eth_chainId",
    "eth_accounts",
    "eth_sendTransaction"
  ]);
});

test("blocks funding when provider chain or owner is wrong", async () => {
  const authorization = authorizeAgentWalletFunding(context(), request());
  const transaction = buildPersonalWalletFundingTransaction({
    authorization,
    tokenAddress: token,
    tokenAmount: "5",
    tokenDecimals: 18
  });

  await assert.rejects(
    () => sendPersonalWalletFunding({
      request: async ({ method }) => method === "eth_chainId" ? "0x1" : [owner]
    }, transaction),
    /requires the connected wallet to be on BSC/
  );

  await assert.rejects(
    () => sendPersonalWalletFunding({
      request: async ({ method }) => method === "eth_chainId" ? "0x38" : ["0x4444444444444444444444444444444444444444"]
    }, transaction),
    /does not match the approved funding owner/
  );
});

test("still requires explicit approval before a personal-wallet funding transaction can be built", () => {
  assert.throws(
    () => authorizeAgentWalletFunding(context(), request({ userApproved: false })),
    /explicit user approval/
  );
});
