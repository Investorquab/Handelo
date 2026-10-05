import assert from "node:assert/strict";
import test from "node:test";
import {
  autonomousExecutionProviderReady,
  sessionGrantFromPolicy,
  type WalletProviderCapabilities
} from "./wallet-provider.js";

const complete: WalletProviderCapabilities = {
  bscMainnet: true,
  personalWallet: true,
  agentWallet: true,
  scopedPermissions: true,
  spendLimits: true,
  expiry: true,
  revocation: true,
  transferOut: true
};

test("provider is not autonomous-ready when any security capability is missing", () => {
  assert.equal(autonomousExecutionProviderReady(complete), true);
  assert.equal(autonomousExecutionProviderReady({ ...complete, scopedPermissions: false }), false);
  assert.equal(autonomousExecutionProviderReady({ ...complete, revocation: false }), false);
});

test("session grants preserve bounded policy", () => {
  const grant = sessionGrantFromPolicy(
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    {
      permissions: ["DCA", "RECURRING"],
      maxTransactionUsd: 10,
      maxDailySpendUsd: 25,
      minimumReservePercent: 10,
      allowedAssets: ["NVDAB"],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      revocable: true
    }
  );
  assert.equal(grant.network, "BSC");
  assert.deepEqual(grant.permissions, ["DCA", "RECURRING"]);
  assert.equal(grant.maxTransactionUsd, 10);
  assert.equal(grant.maxDailySpendUsd, 25);
  assert.deepEqual(grant.allowedAssets, ["NVDAB"]);
  assert.equal(grant.revocable, true);
});

test("non-revocable and expired sessions are rejected", () => {
  assert.throws(() => sessionGrantFromPolicy(
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    { permissions: ["DCA"], revocable: false }
  ), /revocable/);

  assert.throws(() => sessionGrantFromPolicy(
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    { permissions: ["DCA"], expiresAt: "2020-01-01T00:00:00.000Z", revocable: true }
  ), /future timestamp/);
});
