import assert from "node:assert/strict";
import test from "node:test";
import {
  canAgentPermission,
  createAgentWalletContext,
  createWalletContext,
  DEFAULT_AGENT_POLICY
} from "./wallet-context.js";

test("personal and agent contexts are separate wallet roles", () => {
  const personal = createWalletContext(
    "USER",
    "PERSONAL",
    { address: "0x1111111111111111111111111111111111111111", network: "BSC" },
    1000
  );
  const agent = createAgentWalletContext(
    "USER",
    { address: "0x2222222222222222222222222222222222222222", network: "BSC" },
    personal.address,
    500
  );

  assert.equal(personal.role, "PERSONAL");
  assert.equal(agent.role, "AGENT");
  assert.notEqual(personal.address, agent.address);
  assert.equal(agent.ownerWallet, personal.address);
});

test("agent policy is bounded and revocable by default", () => {
  const agent = createAgentWalletContext(
    "DEMO",
    { address: "0x2222222222222222222222222222222222222222", network: "BSC" },
    null,
    10
  );

  assert.deepEqual(agent.policy, DEFAULT_AGENT_POLICY);
  assert.equal(agent.policy.revocable, true);
  assert.equal(canAgentPermission(agent, "DCA"), true);
  assert.equal(canAgentPermission(agent, "TRANSFER_OUT"), false);
});

test("paused, revoked, and expired agent contexts cannot execute permissions", () => {
  const paused = createAgentWalletContext(
    "USER",
    { address: "0x2222222222222222222222222222222222222222", network: "BSC" },
    "0x1111111111111111111111111111111111111111",
    10,
    DEFAULT_AGENT_POLICY,
    "PAUSED"
  );
  const expired = createAgentWalletContext(
    "USER",
    { address: "0x2222222222222222222222222222222222222222", network: "BSC" },
    "0x1111111111111111111111111111111111111111",
    10,
    { ...DEFAULT_AGENT_POLICY, expiresAt: "2020-01-01T00:00:00.000Z" }
  );

  assert.equal(canAgentPermission(paused, "DCA"), false);
  assert.equal(canAgentPermission(expired, "DCA"), false);
});
