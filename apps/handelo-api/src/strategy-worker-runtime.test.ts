import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedAutonomousStrategy, createHandeloStrategyWorkerDependencies } from "./strategy-worker-runtime.js";
import { runTriggeredStrategy } from "@handelo/strategy";
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
    store: {} as never,
    portfolioSnapshot: async () => ({
      wallet: "0x1111111111111111111111111111111111111111",
      balanceUsd: 20,
      totalValueUsd: 100,
      positions: []
    })
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
    store: {} as never,
    portfolioSnapshot: async () => ({
      wallet: "0x1111111111111111111111111111111111111111",
      balanceUsd: 20,
      totalValueUsd: 100,
      positions: []
    })
  });
  await assert.rejects(
    dependencies.execute({ ...base, amountUsd: 19 }, {} as never),
    /cash balance/i
  );
  assert.deepEqual(executionCalls, []);
});


test("autonomous worker retries transient API/network failures before broadcast", async () => {
  let quoteCalls = 0;
  let executeCalls = 0;
  const dependencies = createHandeloStrategyWorkerDependencies({
    walletAddress: "0x1111111111111111111111111111111111111111",
    executionWallet: {
      quote: async () => {
        quoteCalls += 1;
        if (quoteCalls === 1) {
          const error = new Error("fetch failed");
          (error as Error & { code: string }).code = "ECONNRESET";
          throw error;
        }
        return { fromCoinAmount: "10", toCoinAmount: "0.1", slippage: 0 };
      },
      execute: async () => {
        executeCalls += 1;
        return { orderId: "order-1", status: "FINISHED", txHash: "tx-1" };
      }
    } as never,
    market: {
      find: async () => ({
        binanceChainId: "56", tokenContractAddress: "0x2222222222222222222222222222222222222222", platformId: "bstock", tokenSymbol: "NVDAB", decimals: "18", underlyingTicker: "NVDA", underlyingName: "NVIDIA", tokenToShareRatio: "1", tokenPrice: "95", referencePrice: "100", volume24H: "1000", marketCap: "100000",
        statusInfo: { openState: true, marketStatus: "OPEN", reasonCode: "OPEN", reasonMsg: null, nextOpenTime: null, nextCloseTime: null }
      })
    },
    store: (() => {
      const records = new Map<string, any>();
      return {
        claim: async (record: any) => { records.set(record.executionKey, record); return record; },
        get: async (key: string) => records.get(key) ?? null,
        update: async (record: any) => { records.set(record.executionKey, record); return record; },
        list: async () => [...records.values()]
      };
    })() as never,
    portfolioSnapshot: async () => ({ wallet: "0x1111111111111111111111111111111111111111", balanceUsd: 100, totalValueUsd: 100, positions: [] })
  });
  const strategy = { ...base, amountUsd: 10, nextExecutionAt: "2026-10-06T09:00:00.000Z" };
  const result = await runTriggeredStrategy(strategy, { eligible: true, reason: "test", triggeredAt: "2026-10-06T10:00:00.000Z" }, {
    store: dependencies.store,
    now: () => "2026-10-06T10:00:01.000Z",
    riskCheck: async () => true,
    execute: dependencies.execute,
    maxAttempts: 2
  });
  assert.equal(result.status, "FINISHED");
  assert.equal(quoteCalls, 2);
  assert.equal(executeCalls, 1);
});

test("autonomous worker does not retry an uncertain execution-network failure", async () => {
  let executeCalls = 0;
  const dependencies = createHandeloStrategyWorkerDependencies({
    walletAddress: "0x1111111111111111111111111111111111111111",
    executionWallet: {
      quote: async () => ({ fromCoinAmount: "10", toCoinAmount: "0.1", slippage: 0 }),
      execute: async () => {
        executeCalls += 1;
        const error = new Error("socket hang up");
        (error as Error & { code: string }).code = "ECONNRESET";
        throw error;
      }
    } as never,
    market: {
      find: async () => ({
        binanceChainId: "56", tokenContractAddress: "0x2222222222222222222222222222222222222222", platformId: "bstock", tokenSymbol: "NVDAB", decimals: "18", underlyingTicker: "NVDA", underlyingName: "NVIDIA", tokenToShareRatio: "1", tokenPrice: "95", referencePrice: "100", volume24H: "1000", marketCap: "100000",
        statusInfo: { openState: true, marketStatus: "OPEN", reasonCode: "OPEN", reasonMsg: null, nextOpenTime: null, nextCloseTime: null }
      })
    },
    store: (() => {
      const records = new Map<string, any>();
      return {
        claim: async (record: any) => { records.set(record.executionKey, record); return record; },
        get: async (key: string) => records.get(key) ?? null,
        update: async (record: any) => { records.set(record.executionKey, record); return record; },
        list: async () => [...records.values()]
      };
    })() as never,
    portfolioSnapshot: async () => ({ wallet: "0x1111111111111111111111111111111111111111", balanceUsd: 100, totalValueUsd: 100, positions: [] })
  });
  const strategy = { ...base, amountUsd: 10, nextExecutionAt: "2026-10-06T09:00:00.000Z" };
  const result = await runTriggeredStrategy(strategy, { eligible: true, reason: "test", triggeredAt: "2026-10-06T10:00:00.000Z" }, {
    store: dependencies.store,
    now: () => "2026-10-06T10:00:01.000Z",
    riskCheck: async () => true,
    execute: dependencies.execute,
    maxAttempts: 3
  });
  assert.equal(result.status, "FAILED");
  if (result.status === "FAILED") assert.equal(result.record.retryable, false);
  assert.equal(executeCalls, 1);
});
