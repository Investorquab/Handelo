import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAgentWalletIsolation,
  assertAgentWalletOwnership,
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

test("agent ownership is bound to the requesting personal wallet", () => {
  const agent = createAgentWalletContext(
    "USER",
    { address: "0x2222222222222222222222222222222222222222", network: "BSC" },
    "0x1111111111111111111111111111111111111111",
    10
  );

  assert.strictEqual(
    assertAgentWalletOwnership(agent, "0x1111111111111111111111111111111111111111"),
    agent
  );

  assert.throws(
    () => assertAgentWalletOwnership(agent, "0x3333333333333333333333333333333333333333"),
    /does not match/
  );
  assert.throws(
    () => assertAgentWalletOwnership(
      { ...agent, ownerWallet: null },
      "0x1111111111111111111111111111111111111111"
    ),
    /missing a valid owner/
  );
  assert.throws(
    () => assertAgentWalletOwnership(
      { ...agent, mode: "DEMO" },
      "0x1111111111111111111111111111111111111111"
    ),
    /USER mode/
  );
  assert.throws(
    () => assertAgentWalletOwnership(
      { ...agent, status: "REVOKED" },
      "0x1111111111111111111111111111111111111111"
    ),
    /not available/
  );
});


test("agent wallet isolation rejects cross-user reuse of the same agent address", () => {
  const userA = createAgentWalletContext("USER", { address: "0x2222222222222222222222222222222222222222", network: "BSC" }, "0x1111111111111111111111111111111111111111", 10);
  const userB = createAgentWalletContext("USER", { address: "0x2222222222222222222222222222222222222222", network: "BSC" }, "0x3333333333333333333333333333333333333333", 10);
  assert.strictEqual(assertAgentWalletIsolation(userA, "0x1111111111111111111111111111111111111111", "0x2222222222222222222222222222222222222222"), userA);
  assert.throws(() => assertAgentWalletIsolation(userA, "0x3333333333333333333333333333333333333333", "0x2222222222222222222222222222222222222222"), /does not match/);
  assert.throws(() => assertAgentWalletIsolation(userB, "0x3333333333333333333333333333333333333333", "0x1111111111111111111111111111111111111111"), /does not match/);
});
