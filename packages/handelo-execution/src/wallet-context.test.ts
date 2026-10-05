import assert from "node:assert/strict";
import test from "node:test";
import {
  canAgentPermission,
  createAgentWalletContext,
  createWalletContext,
  DEFAULT_AGENT_POLICY,
  evaluateAgentSpend
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


test("agent spend policy enforces transaction, daily, allowlist, and reserve bounds", () => {
  const context = createAgentWalletContext(
    "USER",
    { address: "0x2222222222222222222222222222222222222222", network: "BSC" },
    "0x1111111111111111111111111111111111111111",
    100,
    {
      ...DEFAULT_AGENT_POLICY,
      allowedAssets: ["NVDAB"]
    }
  );

  const allowed = evaluateAgentSpend(context, "DCA", 10, {
    asset: "NVDAB",
    dailySpentUsd: 5
  });
  assert.equal(allowed.decision, "PASS");

  const blocked = evaluateAgentSpend(context, "DCA", 11, {
    asset: "OTHER",
    dailySpentUsd: 20
  });
  assert.equal(blocked.decision, "BLOCK");
  assert.match(blocked.reasons.join(" "), /agent limit/);
  assert.match(blocked.reasons.join(" "), /Daily spend/);
  assert.match(blocked.reasons.join(" "), /allowlist/);
});

test("agent spend blocks when reserve cannot be verified", () => {
  const context = createAgentWalletContext(
    "USER",
    { address: "0x2222222222222222222222222222222222222222", network: "BSC" },
    "0x1111111111111111111111111111111111111111",
    null
  );

  const result = evaluateAgentSpend(context, "DCA", 5, { asset: "NVDAB" });
  assert.equal(result.decision, "BLOCK");
  assert.match(result.reasons.join(" "), /balance is unavailable/);
});

test("agent spend blocks a transaction that breaches the minimum reserve", () => {
  const context = createAgentWalletContext(
    "USER",
    { address: "0x2222222222222222222222222222222222222222", network: "BSC" },
    "0x1111111111111111111111111111111111111111",
    100
  );

  const result = evaluateAgentSpend(context, "DCA", 95);
  assert.equal(result.decision, "BLOCK");
  assert.match(result.reasons.join(" "), /minimum wallet reserve/);
});


test("agent spend blocks a zero-balance wallet", () => {
  const context = createAgentWalletContext(
    "USER",
    { address: "0x2222222222222222222222222222222222222222", network: "BSC" },
    "0x1111111111111111111111111111111111111111",
    0
  );

  const result = evaluateAgentSpend(context, "DCA", 5);
  assert.equal(result.decision, "BLOCK");
  assert.match(result.reasons.join(" "), /minimum wallet reserve/);
});
