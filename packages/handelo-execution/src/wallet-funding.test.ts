import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAgentWalletFunding } from "./wallet-funding.js";
import type { AgentWalletContext } from "@handelo/core";

const owner = "0x1111111111111111111111111111111111111111";
const agent = "0x2222222222222222222222222222222222222222";

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
  assert.equal(result.amountUsd, 5);
  assert.equal(result.network, "BSC");
  assert.equal(result.requiresProviderExecution, true);
  assert.equal(result.onChain, false);
});

test("requires explicit user approval before funding authorization", () => {
  assert.throws(
    () => authorizeAgentWalletFunding(context(), request({ userApproved: false })),
    /explicit user approval/
  );
});

test("rejects funding for a different owner or agent wallet", () => {
  assert.throws(
    () => authorizeAgentWalletFunding(
      context(),
      request({ ownerWallet: "0x3333333333333333333333333333333333333333" })
    ),
    /does not match the connected BNB wallet context/
  );
});

test("rejects demo, personal, disconnected, revoked, and non-BSC contexts", () => {
  const invalidContexts = [
    context({ mode: "DEMO" }),
    context({ role: "PERSONAL" } as unknown as Partial<AgentWalletContext>),
    context({ connected: false }),
    context({ status: "REVOKED" }),
    context({ network: "ETHEREUM" } as unknown as Partial<AgentWalletContext>)
  ];

  for (const invalid of invalidContexts) {
    assert.throws(
      () => authorizeAgentWalletFunding(invalid, request()),
      /requires (USER-mode agent wallet context|a connected active BSC agent wallet)/
    );
  }
});

test("fails closed when personal balance is unavailable or insufficient", () => {
  assert.throws(
    () => authorizeAgentWalletFunding(context(), request({ personalBalanceUsd: null })),
    /insufficient or unavailable/
  );
  assert.throws(
    () => authorizeAgentWalletFunding(context(), request({ personalBalanceUsd: 4 })),
    /insufficient or unavailable/
  );
});

test("rejects zero, negative, and non-finite funding amounts", () => {
  for (const amountUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => authorizeAgentWalletFunding(context(), request({ amountUsd })),
      /finite positive/
    );
  }
});

test("requires an approval reference for auditable funding authorization", () => {
  assert.throws(
    () => authorizeAgentWalletFunding(context(), request({ approvalReference: "  " })),
    /approval reference/
  );
});
