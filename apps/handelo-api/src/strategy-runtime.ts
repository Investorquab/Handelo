import {
  runStrategyScheduler,

  type StrategyExecutionRecord,
  type StrategyExecutionStore,
  type StrategyRuntimeResult,
  type StrategySchedulerResult
} from "@handelo/strategy";
import type { StrategyDefinition } from "@handelo/core";
import {
  listActiveStrategies,
  listStrategies,
  updateStoredStrategy
} from "./strategy-store.js";

export interface PersistedStrategySchedulerDependencies {
  wallet: string;
  store: StrategyExecutionStore;
  now?: () => string;
  marketOpen?: boolean;
  conditionMet?: (strategy: StrategyDefinition) => Promise<boolean>;
  riskCheck: (strategy: StrategyDefinition, record: StrategyExecutionRecord) => Promise<boolean>;
  execute: (strategy: StrategyDefinition, record: StrategyExecutionRecord) => Promise<void>;
}

export async function listPersistedStrategyExecutions(
  wallet: string,
  store: StrategyExecutionStore
): Promise<StrategyExecutionRecord[]> {
  const strategyIds = new Set((await listStrategies(wallet)).map(strategy => strategy.id));
  const records = await store.list();
  return records
    .filter(record => strategyIds.has(record.strategyId))
    .sort((a, b) => Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt));
}

export interface StrategyAttribution {
  strategyId: string;
  type: StrategyDefinition["type"];
  asset: string;
  status: StrategyDefinition["status"];
  frequency?: string;
  amountUsd?: number;
  executionCount: number;
  finishedCount: number;
  failedCount: number;
  lastExecutionAt: string | null;
  nextExecutionAt: string | null;
  successfulPlannedUsd: number | null;
}

export async function listStrategyAttribution(
  wallet: string,
  store: StrategyExecutionStore
): Promise<StrategyAttribution[]> {
  const strategies = await listStrategies(wallet);
  const records = await listPersistedStrategyExecutions(wallet, store);
  return strategies.map(strategy => {
    const strategyRecords = records.filter(record => record.strategyId === strategy.id);
    const finishedCount = strategyRecords.filter(record => record.status === "FINISHED").length;
    const failedCount = strategyRecords.filter(record => record.status === "FAILED").length;
    return {
      strategyId: strategy.id,
      type: strategy.type,
      asset: strategy.asset,
      status: strategy.status,
      frequency: strategy.frequency,
      amountUsd: strategy.amountUsd,
      executionCount: strategyRecords.length,
      finishedCount,
      failedCount,
      lastExecutionAt: strategyRecords[0]?.finishedAt ?? strategyRecords[0]?.triggeredAt ?? null,
      nextExecutionAt: strategy.nextExecutionAt ?? null,
      successfulPlannedUsd: strategy.amountUsd === undefined ? null : strategy.amountUsd * finishedCount
    };
  });
}

export async function runPersistedStrategyScheduler(
  dependencies: PersistedStrategySchedulerDependencies
): Promise<StrategySchedulerResult> {
  return runStrategyScheduler({
    store: dependencies.store,
    now: dependencies.now,
    marketOpen: dependencies.marketOpen,
    conditionMet: dependencies.conditionMet,
    riskCheck: dependencies.riskCheck,
    execute: dependencies.execute,
    listActiveStrategies: () => listActiveStrategies(dependencies.wallet),
    updateStrategy: async strategy => {
      await updateStoredStrategy(dependencies.wallet, strategy.id, {
        nextExecutionAt: strategy.nextExecutionAt
      });
    }
  });
}
