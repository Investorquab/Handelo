import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedAutonomousStrategy, createHandeloStrategyWorkerDependencies } from "./strategy-worker-runtime.js";
import type { StrategyDefinition } from "@handelo/core";

const base: StrategyDefinition = {
  id: "strategy-1",
  type: "DCA",
  asset: "NVDAB",
  amountUsd: 10,
  frequency: "Daily",
  constraints: {},
  nextExecutionAt: "2026-10-06T10:00:00.000Z",
  status: "ACTIVE"
};

test("autonomous worker accepts DCA and recurring strategies", () => {
  assert.equal(isSupportedAutonomousStrategy(base), true);
  assert.equal(isSupportedAutonomousStrategy({ ...base, type: "RECURRING" }), true);
});

test("autonomous worker supports only deterministic strategy types", () => {
  assert.equal(isSupportedAutonomousStrategy({ ...base, type: "CONDITIONAL", condition: "price below reference" }), true);
  assert.equal(isSupportedAutonomousStrategy({ ...base, type: "REBALANCE", targetAllocation: { NVDAB: 100 } }), true);
});

test("conditional worker evaluates live reference-price conditions instead of accepting arbitrary LLM booleans", async () => {
  const dependencies = createHandeloStrategyWorkerDependencies({
    walletAddress: "0x1111111111111111111111111111111111111111",
    executionWallet: {} as never,
    market: {
      find: async () => ({
        binanceChainId: "56",
        tokenContractAddress: "0x2222222222222222222222222222222222222222",
        platformId: "bstock",
        tokenSymbol: "NVDAB",
        decimals: "18",
        underlyingTicker: "NVDA",
        underlyingName: "NVIDIA",
        tokenToShareRatio: "1",
        tokenPrice: "95",
        referencePrice: "100",
        volume24H: "1000",
        marketCap: "100000",
        statusInfo: { openState: true, marketStatus: "OPEN", reasonCode: "OPEN", reasonMsg: null, nextOpenTime: null, nextCloseTime: null }
      })
    },
    store: {} as never
  });
  const strategy = { ...base, type: "CONDITIONAL" as const, condition: "price below reference" };
  assert.equal(await dependencies.conditionMet(strategy), true);
  assert.equal(await dependencies.conditionMet({ ...strategy, condition: "price above reference" }), false);
});

test("autonomous rebalance support is explicit", () => {
  assert.equal(isSupportedAutonomousStrategy({ ...base, type: "REBALANCE", targetAllocation: { NVDAB: 100 } }), true);
});


test("autonomous worker blocks execution when cash balance cannot fund the strategy reserve", async () => {
  const executionCalls: string[] = [];
  const dependencies = createHandeloStrategyWorkerDependencies({
    walletAddress: "0x1111111111111111111111111111111111111111",
    executionWallet: {
      quote: async () => ({ fromCoinAmount: "19", toCoinAmount: "0.2", slippage: 0 }),
      execute: async () => {
        executionCalls.push("execute");
        return { orderId: "unexpected", status: "FINISHED", txHash: "unexpected" };
      }
    } as never,
    market: {
      find: async () => ({
        binanceChainId: "56",
        tokenContractAddress: "0x2222222222222222222222222222222222222222",
        platformId: "bstock",
        tokenSymbol: "NVDAB",
        decimals: "18",
        underlyingTicker: "NVDA",
        underlyingName: "NVIDIA",
        tokenToShareRatio: "1",
        tokenPrice: "95",
        referencePrice: "100",
        volume24H: "1000",
        marketCap: "100000",
        statusInfo: { openState: true, marketStatus: "OPEN", reasonCode: "OPEN", reasonMsg: null, nextOpenTime: null, nextCloseTime: null }
      })
    },
    store: {} as never
  });
  // The worker's portfolio boundary is backed by the live portfolio service; this test proves the execution path
  // cannot be allowed to silently proceed when the required cash precondition is unavailable.
  await assert.rejects(
    dependencies.execute({ ...base, amountUsd: 19 }, {} as never),
    /cash balance/i
  );
  assert.deepEqual(executionCalls, []);
});
