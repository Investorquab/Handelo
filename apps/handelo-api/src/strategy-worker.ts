import type {
  StrategyExecutionRecord,
  StrategyExecutionStore,
  StrategySchedulerResult
} from "@handelo/strategy";
import type { StrategyDefinition } from "@handelo/core";
import { runPersistedStrategyScheduler } from "./strategy-runtime.js";

export interface PersistedStrategyWorkerDependencies {
  wallet: string;
  store: StrategyExecutionStore;
  now?: () => string;
  marketOpen?: boolean;
  conditionMet?: (strategy: StrategyDefinition) => Promise<boolean>;
  riskCheck: (strategy: StrategyDefinition, record: StrategyExecutionRecord) => Promise<boolean>;
  execute: (strategy: StrategyDefinition, record: StrategyExecutionRecord) => Promise<void>;
  intervalMs?: number;
  setInterval?: (handler: () => void, timeoutMs: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface PersistedStrategyWorker {
  tick(): Promise<StrategySchedulerResult>;
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

const DEFAULT_INTERVAL_MS = 60_000;

export function createPersistedStrategyWorker(
  dependencies: PersistedStrategyWorkerDependencies
): PersistedStrategyWorker {
  const intervalMs = dependencies.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error("Strategy worker interval must be at least 1000ms.");
  }

  const schedule = dependencies.setInterval ?? setInterval;
  const unschedule = dependencies.clearInterval ?? clearInterval;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<StrategySchedulerResult> | null = null;

  const tick = (): Promise<StrategySchedulerResult> => {
    if (inFlight) return inFlight;

    inFlight = runPersistedStrategyScheduler(dependencies).finally(() => {
      inFlight = null;
    });

    return inFlight;
  };

  const start = (): void => {
    if (timer) return;
    timer = schedule(() => {
      void tick();
    }, intervalMs);
  };

  const stop = (): void => {
    if (!timer) return;
    unschedule(timer);
    timer = null;
  };

  return {
    tick,
    start,
    stop,
    isRunning: () => timer !== null
  };
}
