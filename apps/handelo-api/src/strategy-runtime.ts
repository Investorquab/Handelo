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
