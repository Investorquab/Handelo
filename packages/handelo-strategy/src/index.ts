import {
  createStrategyId,
  type StrategyConstraints,
  type StrategyDefinition,
  type StrategyType,
  type WalletPermission
} from "@handelo/core";

export interface StrategyInput {
  type: StrategyType;
  asset: string;
  amountUsd?: number;
  frequency?: string;
  condition?: string;
  targetAllocation?: Record<string, number>;
  constraints?: StrategyConstraints;
  nextExecutionAt?: string | null;
}

export function validateStrategyInput(input: StrategyInput): string[] {
  const errors:string[] = [];

  if (!input.asset.trim()) errors.push("Strategy asset is required.");

  if (input.amountUsd !== undefined && (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0)) {
    errors.push("Strategy amount must be greater than zero.");
  }

  if ((input.type === "DCA" || input.type === "RECURRING") && !input.frequency?.trim()) {
    errors.push("A recurring strategy requires a frequency.");
  }

  if (input.type === "CONDITIONAL" && !input.condition?.trim()) {
    errors.push("A conditional strategy requires a condition.");
  }

  if (input.type === "REBALANCE" && !input.targetAllocation) {
    errors.push("A rebalance strategy requires target allocation.");
  }

  if (input.targetAllocation) {
    const values = Object.values(input.targetAllocation);
    if (values.some(value => !Number.isFinite(value) || value < 0)) {
      errors.push("Target allocations must be non-negative finite percentages.");
    } else {
      const total = values.reduce((sum,value)=>sum+value,0);
      if (Math.abs(total-100) > 0.01) errors.push("Target allocations must total 100%.");
    }
  }

  return errors;
}

export function createDraftStrategy(input: StrategyInput): StrategyDefinition {
  const errors = validateStrategyInput(input);
  if (errors.length) throw new Error(errors.join(" "));

  return {
    id: createStrategyId(input.type.toLowerCase()),
    type: input.type,
    asset: input.asset.trim(),
    amountUsd: input.amountUsd,
    frequency: input.frequency?.trim(),
    condition: input.condition?.trim(),
    targetAllocation: input.targetAllocation,
    constraints: input.constraints ?? {},
    nextExecutionAt: input.nextExecutionAt ?? null,
    status: "DRAFT"
  };
}

export function activateStrategy(strategy: StrategyDefinition): StrategyDefinition {
  if (strategy.status !== "DRAFT") {
    throw new Error("Only draft strategies can be activated.");
  }

  return {...strategy,status:"ACTIVE"};
}

export interface StrategyExecutionGrant {
  strategyId: string;
  asset: string;
  permission: WalletPermission;
  maxTransactionUsd?: number;
  maxDailySpendUsd?: number;
  minimumReservePercent?: number;
  allowedAssets: string[];
}

export function executionGrantFromStrategy(
  strategy: StrategyDefinition,
  maxDailySpendUsd?: number
): StrategyExecutionGrant {
  if (strategy.status !== "ACTIVE") {
    throw new Error("Only active strategies can produce execution grants.");
  }

  const permission: WalletPermission =
    strategy.type === "DCA" ? "DCA" :
    strategy.type === "RECURRING" ? "RECURRING" :
    strategy.type === "CONDITIONAL" ? "CONDITIONAL" :
    "REBALANCE";

  const maxTransactionUsd = strategy.constraints.maxTransactionUsd;
  if (
    maxTransactionUsd !== undefined &&
    maxDailySpendUsd !== undefined &&
    maxTransactionUsd > maxDailySpendUsd
  ) {
    throw new Error("Strategy transaction limit cannot exceed its daily wallet limit.");
  }

  return {
    strategyId: strategy.id,
    asset: strategy.asset,
    permission,
    maxTransactionUsd,
    maxDailySpendUsd,
    minimumReservePercent: strategy.constraints.minimumReservePercent,
    allowedAssets: [strategy.asset]
  };
}

export type StrategyExecutionStatus =
  | "ACTIVE"
  | "TRIGGERED"
  | "RISK_CHECK"
  | "EXECUTING"
  | "FINISHED"
  | "FAILED"
  | "PAUSED"
  | "CANCELLED";

const EXECUTION_TRANSITIONS: Record<StrategyExecutionStatus, readonly StrategyExecutionStatus[]> = {
  ACTIVE: ["TRIGGERED", "PAUSED", "CANCELLED"],
  TRIGGERED: ["RISK_CHECK", "FAILED"],
  RISK_CHECK: ["EXECUTING", "FAILED"],
  EXECUTING: ["FINISHED", "FAILED"],
  FINISHED: ["ACTIVE", "PAUSED", "CANCELLED"],
  FAILED: ["ACTIVE", "PAUSED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  CANCELLED: []
};

export function canTransitionStrategyExecution(
  from: StrategyExecutionStatus,
  to: StrategyExecutionStatus
): boolean {
  return EXECUTION_TRANSITIONS[from].includes(to);
}

export function transitionStrategyExecution(
  from: StrategyExecutionStatus,
  to: StrategyExecutionStatus
): StrategyExecutionStatus {
  if (!canTransitionStrategyExecution(from, to)) {
    throw new Error(`Invalid strategy execution transition: ${from} -> ${to}.`);
  }
  return to;
}

export interface StrategyTriggerContext {
  now?: string;
  marketOpen?: boolean;
  conditionMet?: boolean;
}

export interface StrategyTriggerDecision {
  eligible: boolean;
  reason: string;
  triggeredAt: string | null;
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function evaluateStrategyTrigger(
  strategy: StrategyDefinition,
  context: StrategyTriggerContext = {}
): StrategyTriggerDecision {
  const now = context.now ?? new Date().toISOString();
  if (!validTimestamp(now)) throw new Error("Trigger evaluation requires a valid current timestamp.");

  if (strategy.status !== "ACTIVE") {
    return { eligible: false, reason: "Strategy is not active.", triggeredAt: null };
  }

  if (context.marketOpen === false) {
    return { eligible: false, reason: "Market is closed.", triggeredAt: null };
  }

  if (strategy.nextExecutionAt) {
    if (!validTimestamp(strategy.nextExecutionAt)) {
      throw new Error("Strategy next execution time is invalid.");
    }
    if (Date.parse(strategy.nextExecutionAt) > Date.parse(now)) {
      return { eligible: false, reason: "Next execution time has not arrived.", triggeredAt: null };
    }
  }

  if (strategy.type === "CONDITIONAL" && context.conditionMet !== true) {
    return { eligible: false, reason: "Strategy condition is not met.", triggeredAt: null };
  }

  return {
    eligible: true,
    reason: "Strategy trigger conditions are satisfied.",
    triggeredAt: now
  };
}

export interface StrategyExecutionRecord {
  runId: string;
  strategyId: string;
  status: StrategyExecutionStatus;
  triggeredAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  attempt: number;
  executionKey: string;
  error?: string | null;
}

export function createExecutionKey(
  strategyId: string,
  triggerAt: string
): string {
  if (!strategyId.trim() || !validTimestamp(triggerAt)) {
    throw new Error("Execution key requires a strategy ID and valid trigger timestamp.");
  }
  return strategyId + ":" + new Date(triggerAt).toISOString();
}

export function createStrategyExecutionRecord(
  strategy: StrategyDefinition,
  triggerAt: string
): StrategyExecutionRecord {
  if (strategy.status !== "ACTIVE") {
    throw new Error("Only active strategies can create execution records.");
  }

  return {
    runId: createStrategyId("run"),
    strategyId: strategy.id,
    status: "TRIGGERED",
    triggeredAt: new Date(triggerAt).toISOString(),
    startedAt: null,
    finishedAt: null,
    attempt: 1,
    executionKey: createExecutionKey(strategy.id, triggerAt),
    error: null
  };
}

export function beginStrategyExecution(
  record: StrategyExecutionRecord,
  now: string
): StrategyExecutionRecord {
  if (record.status !== "RISK_CHECK") {
    throw new Error("Strategy execution must pass through RISK_CHECK before execution.");
  }
  return {
    ...record,
    status: transitionStrategyExecution(record.status, "EXECUTING"),
    startedAt: new Date(now).toISOString()
  };
}

export function finishStrategyExecution(
  record: StrategyExecutionRecord,
  now: string
): StrategyExecutionRecord {
  if (record.status !== "EXECUTING") {
    throw new Error("Only executing strategy runs can finish.");
  }
  return {
    ...record,
    status: transitionStrategyExecution(record.status, "FINISHED"),
    finishedAt: new Date(now).toISOString()
  };
}

export class RetryableStrategyExecutionError extends Error {
  readonly retryable = true;

  constructor(message: string) {
    super(message.trim() || "Retryable strategy execution failure.");
    this.name = "RetryableStrategyExecutionError";
  }
}

export function retryStrategyExecution(
  record: StrategyExecutionRecord,
  now: string
): StrategyExecutionRecord {
  if (record.status !== "FAILED") {
    throw new Error("Only failed strategy runs can be retried.");
  }
  return {
    ...record,
    status: transitionStrategyExecution(record.status, "RISK_CHECK"),
    attempt: record.attempt + 1,
    startedAt: null,
    finishedAt: null,
    error: null
  };
}

export function failStrategyExecution(
  record: StrategyExecutionRecord,
  now: string,
  error: string
): StrategyExecutionRecord {
  if (record.status !== "TRIGGERED" && record.status !== "RISK_CHECK" && record.status !== "EXECUTING") {
    throw new Error("Only in-flight strategy runs can fail.");
  }
  return {
    ...record,
    status: transitionStrategyExecution(record.status, "FAILED"),
    finishedAt: new Date(now).toISOString(),
    error: error.trim() || "Strategy execution failed."
  };
}

export class StrategyExecutionRegistry {
  private readonly records = new Map<string, StrategyExecutionRecord>();

  claim(record: StrategyExecutionRecord): StrategyExecutionRecord {
    const existing = this.records.get(record.executionKey);
    if (existing) {
      throw new Error("Strategy execution key has already been claimed.");
    }
    this.records.set(record.executionKey, record);
    return record;
  }

  get(executionKey: string): StrategyExecutionRecord | null {
    return this.records.get(executionKey) ?? null;
  }

  list(): StrategyExecutionRecord[] {
    return [...this.records.values()];
  }

  size(): number {
    return this.records.size;
  }
}

export interface StrategyExecutionStore {
  claim(record: StrategyExecutionRecord): Promise<StrategyExecutionRecord>;
  get(executionKey: string): Promise<StrategyExecutionRecord | null>;
  update(record: StrategyExecutionRecord): Promise<StrategyExecutionRecord>;
  list(): Promise<StrategyExecutionRecord[]>;
}

export class FileStrategyExecutionStore implements StrategyExecutionStore {
  constructor(private readonly filePath: string) {}

  private async read(): Promise<StrategyExecutionRecord[]> {
    const { readFile } = await import("node:fs/promises");
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed as StrategyExecutionRecord[] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(records: StrategyExecutionRecord[]): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(records, null, 2) + "\n", "utf8");
  }

  async claim(record: StrategyExecutionRecord): Promise<StrategyExecutionRecord> {
    const records = await this.read();
    if (records.some(existing => existing.executionKey === record.executionKey)) {
      throw new Error("Strategy execution key has already been claimed.");
    }
    records.push(record);
    await this.write(records);
    return record;
  }

  async get(executionKey: string): Promise<StrategyExecutionRecord | null> {
    const records = await this.read();
    return records.find(record => record.executionKey === executionKey) ?? null;
  }

  async list(): Promise<StrategyExecutionRecord[]> {
    return this.read();
  }

  async update(record: StrategyExecutionRecord): Promise<StrategyExecutionRecord> {
    const records = await this.read();
    const index = records.findIndex(existing => existing.executionKey === record.executionKey);
    if (index === -1) throw new Error("Strategy execution record does not exist.");
    records[index] = record;
    await this.write(records);
    return record;
  }
}


export function nextExecutionAtForFrequency(
  frequency: string,
  from: string
): string | null {
  if (!validTimestamp(from)) throw new Error("Next execution calculation requires a valid timestamp.");
  const date = new Date(from);
  const normalized = frequency.trim().toLowerCase();
  if (normalized === "daily" || normalized === "every day") {
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }
  if (normalized === "weekly" || normalized === "every week") {
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString();
  }
  if (normalized === "monthly" || normalized === "every month") {
    date.setUTCMonth(date.getUTCMonth() + 1);
    return date.toISOString();
  }
  const weekday = normalized.match(/^every (monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (weekday) {
    const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
    const target = days.indexOf(weekday[1]);
    const delta = (target - date.getUTCDay() + 7) % 7 || 7;
    date.setUTCDate(date.getUTCDate() + delta);
    return date.toISOString();
  }
  return null;
}

export function scheduleNextStrategyExecution(
  strategy: StrategyDefinition,
  completedAt: string
): StrategyDefinition {
  if (!validTimestamp(completedAt)) throw new Error("Completed execution time is invalid.");
  if (!strategy.nextExecutionAt) return strategy;
  const next = nextExecutionAtForFrequency(strategy.frequency ?? "", completedAt);
  return next ? { ...strategy, nextExecutionAt: next } : strategy;
}

export interface StrategyRecoveryResult {
  recovered: number;
  records: StrategyExecutionRecord[];
}

export async function recoverStaleStrategyExecutions(
  store: StrategyExecutionStore,
  now: string,
  staleAfterMs = 300_000
): Promise<StrategyRecoveryResult> {
  if (!validTimestamp(now)) throw new Error("Strategy recovery requires a valid current timestamp.");
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1_000) {
    throw new Error("Strategy recovery stale threshold must be at least 1000ms.");
  }

  const nowMs = Date.parse(now);
  const recovered: StrategyExecutionRecord[] = [];

  for (const record of await store.list()) {
    if (record.status !== "RISK_CHECK" && record.status !== "EXECUTING") continue;
    const anchor = record.startedAt ?? record.triggeredAt;
    const ageMs = nowMs - Date.parse(anchor);
    if (!Number.isFinite(ageMs) || ageMs < staleAfterMs) continue;

    const failed = failStrategyExecution(
      record,
      now,
      "Recovered after worker restart; the previous execution was left in-flight."
    );
    await store.update(failed);
    recovered.push(failed);
  }

  return { recovered: recovered.length, records: recovered };
}

export interface StrategyRuntimeDependencies {
  store: StrategyExecutionStore;
  now?: () => string;
  riskCheck: (strategy: StrategyDefinition, record: StrategyExecutionRecord) => Promise<boolean>;
  execute: (strategy: StrategyDefinition, record: StrategyExecutionRecord) => Promise<void>;
  maxAttempts?: number;
}

export type StrategyRuntimeResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "DUPLICATE"; executionKey: string }
  | { status: "FINISHED"; record: StrategyExecutionRecord }
  | { status: "FAILED"; record: StrategyExecutionRecord };

export async function runTriggeredStrategy(
  strategy: StrategyDefinition,
  trigger: StrategyTriggerDecision,
  dependencies: StrategyRuntimeDependencies
): Promise<StrategyRuntimeResult> {
  if (!trigger.eligible || !trigger.triggeredAt) {
    return { status: "SKIPPED", reason: trigger.reason };
  }

  const record = createStrategyExecutionRecord(strategy, trigger.triggeredAt);

  try {
    await dependencies.store.claim(record);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already been claimed")) {
      return { status: "DUPLICATE", executionKey: record.executionKey };
    }
    throw error;
  }

  const now = dependencies.now ?? (() => new Date().toISOString());
  const maxAttempts = dependencies.maxAttempts ?? 1;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("Strategy maxAttempts must be a positive integer.");
  }

  let current = record;

  while (true) {
    try {
      current = {
        ...current,
        status: transitionStrategyExecution(current.status, "RISK_CHECK")
      };
      await dependencies.store.update(current);

      const riskPassed = await dependencies.riskCheck(strategy, current);
      if (!riskPassed) {
        current = failStrategyExecution(current, now(), "Risk governor blocked execution.");
        await dependencies.store.update(current);
        return { status: "FAILED", record: current };
      }

      current = beginStrategyExecution(current, now());
      await dependencies.store.update(current);

      await dependencies.execute(strategy, current);

      current = finishStrategyExecution(current, now());
      await dependencies.store.update(current);
      return { status: "FINISHED", record: current };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = error instanceof RetryableStrategyExecutionError;

      if (retryable && current.attempt < maxAttempts) {
        current = failStrategyExecution(current, now(), message);
        await dependencies.store.update(current);
        current = retryStrategyExecution(current, now());
        await dependencies.store.update(current);
        continue;
      }

      const stored = await dependencies.store.get(record.executionKey);
      if (!stored) throw error;
      if (stored.status === "FAILED") return { status: "FAILED", record: stored };

      const failed = failStrategyExecution(stored, now(), message);
      await dependencies.store.update(failed);
      return { status: "FAILED", record: failed };
    }
  }
}

export interface StrategyRuntimeSchedulerDependencies extends StrategyRuntimeDependencies {
  listActiveStrategies: () => Promise<StrategyDefinition[]>;
  marketOpen?: boolean;
  conditionMet?: (strategy: StrategyDefinition) => Promise<boolean>;
  updateStrategy?: (strategy: StrategyDefinition) => Promise<void>;
}

export interface StrategySchedulerResult {
  evaluated: number;
  triggered: number;
  finished: number;
  failed: number;
  skipped: number;
  duplicate: number;
  results: StrategyRuntimeResult[];
}

export async function runStrategyScheduler(
  dependencies: StrategyRuntimeSchedulerDependencies
): Promise<StrategySchedulerResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const strategies = await dependencies.listActiveStrategies();
  const results: StrategyRuntimeResult[] = [];

  for (const strategy of strategies) {
    const conditionMet = strategy.type === "CONDITIONAL"
      ? await (dependencies.conditionMet?.(strategy) ?? Promise.resolve(false))
      : undefined;

    const trigger = evaluateStrategyTrigger(strategy, {
      now: now(),
      marketOpen: dependencies.marketOpen,
      conditionMet
    });

    const result = await runTriggeredStrategy(strategy, trigger, dependencies);
    if (result.status === "FINISHED" && dependencies.updateStrategy) {
      await dependencies.updateStrategy(scheduleNextStrategyExecution(strategy, result.record.finishedAt ?? result.record.triggeredAt));
    }
    results.push(result);
  }

  return {
    evaluated: strategies.length,
    triggered: results.filter(result => result.status !== "SKIPPED").length,
    finished: results.filter(result => result.status === "FINISHED").length,
    failed: results.filter(result => result.status === "FAILED").length,
    skipped: results.filter(result => result.status === "SKIPPED").length,
    duplicate: results.filter(result => result.status === "DUPLICATE").length,
    results
  };
}
