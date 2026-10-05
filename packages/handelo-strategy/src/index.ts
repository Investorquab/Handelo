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
