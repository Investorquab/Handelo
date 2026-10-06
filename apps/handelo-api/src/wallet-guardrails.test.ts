import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWalletGuardrails } from "./wallet-guardrails.js";

test("normalizes connected BSC wallet guardrails", () => {
  const result = normalizeWalletGuardrails({
    status: "CONNECTED",
    address: " 0x1111111111111111111111111111111111111111 ",
    chains: [{ binanceChainId: "56" }, { binanceChainId: "1" }],
    settings: {
      dailyLimit: 50,
      abnormalTxnHandling: "NeedConfirmation",
      tradeAllTokens: false
    },
    quota: { dailyLimitLeft: 42.5 },
    txLock: "UNLOCKED"
  });

  assert.equal(result.status, "CONNECTED");
  assert.equal(result.bscSupported, true);
  assert.equal(result.address, "0x1111111111111111111111111111111111111111");
  assert.equal(result.dailyLimitUsd, 50);
  assert.equal(result.dailyQuotaLeftUsd, 42.5);
  assert.equal(result.abnormalTxnHandling, "NeedConfirmation");
  assert.equal(result.tradeAllTokens, false);
  assert.equal(result.txLock, "UNLOCKED");
});

test("does not invent unavailable provider guardrail values", () => {
  const result = normalizeWalletGuardrails({
    status: "UNCONNECTED",
    chains: [],
    settings: {},
    quota: {},
    txLock: "unexpected"
  });

  assert.equal(result.status, "UNCONNECTED");
  assert.equal(result.bscSupported, null);
  assert.equal(result.address, null);
  assert.equal(result.dailyLimitUsd, null);
  assert.equal(result.dailyQuotaLeftUsd, null);
  assert.equal(result.abnormalTxnHandling, null);
  assert.equal(result.tradeAllTokens, null);
  assert.equal(result.txLock, "UNKNOWN");
});

test("rejects malformed wallet identity instead of displaying it as connected", () => {
  const result = normalizeWalletGuardrails({
    status: "CONNECTED",
    address: "not-an-address",
    chains: [{ binanceChainId: "56" }],
    txLock: "LOCKED"
  });

  assert.equal(result.address, null);
  assert.equal(result.bscSupported, true);
  assert.equal(result.txLock, "LOCKED");
});
