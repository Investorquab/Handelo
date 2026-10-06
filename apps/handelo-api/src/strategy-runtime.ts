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
