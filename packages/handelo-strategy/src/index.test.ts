import assert from "node:assert/strict";
import test from "node:test";
import {activateStrategy,canTransitionStrategyExecution,createDraftStrategy,executionGrantFromStrategy,transitionStrategyExecution,validateStrategyInput,evaluateStrategyTrigger} from "./index.js";

test("requires frequency for DCA",()=>{
  assert.deepEqual(
    validateStrategyInput({type:"DCA",asset:"NVDAB",amountUsd:10}),
    ["A recurring strategy requires a frequency."]
  );
});

test("requires target allocation to total 100 percent",()=>{
  const errors=validateStrategyInput({
    type:"REBALANCE",
    asset:"portfolio",
    targetAllocation:{NVDAB:60,AAPL:30}
  });
  assert.deepEqual(errors,["Target allocations must total 100%."]);
});

test("creates and activates a valid DCA strategy",()=>{
  const draft=createDraftStrategy({
    type:"DCA",
    asset:"NVDAB",
    amountUsd:10,
    frequency:"Every Monday",
    constraints:{maxTransactionUsd:20}
  });
  assert.equal(draft.status,"DRAFT");
  assert.equal(draft.asset,"NVDAB");

  const active=activateStrategy(draft);
  assert.equal(active.status,"ACTIVE");
});

test("derives a bounded wallet execution grant from an active DCA strategy", () => {
  const strategy = activateStrategy(createDraftStrategy({
    type: "DCA",
    asset: "NVDAB",
    amountUsd: 10,
    frequency: "Every Monday",
    constraints: { maxTransactionUsd: 10, minimumReservePercent: 15 }
  }));

  const grant = executionGrantFromStrategy(strategy, 25);
  assert.equal(grant.permission, "DCA");
  assert.equal(grant.maxTransactionUsd, 10);
  assert.equal(grant.maxDailySpendUsd, 25);
  assert.deepEqual(grant.allowedAssets, ["NVDAB"]);
});

test("strategy grant rejects a daily wallet limit below the strategy transaction limit", () => {
  const strategy = activateStrategy(createDraftStrategy({
    type: "RECURRING",
    asset: "NVDAB",
    amountUsd: 10,
    frequency: "Weekly",
    constraints: { maxTransactionUsd: 20 }
  }));

  assert.throws(() => executionGrantFromStrategy(strategy, 10), /cannot exceed/);
});

test("only active strategies can produce execution grants", () => {
  const draft = createDraftStrategy({
    type: "CONDITIONAL",
    asset: "NVDAB",
    condition: "price below reference",
    constraints: { maxTransactionUsd: 10 }
  });
  assert.throws(() => executionGrantFromStrategy(draft), /Only active strategies/);
});

test("strategy execution lifecycle allows the deterministic happy path", () => {
  assert.equal(transitionStrategyExecution("ACTIVE", "TRIGGERED"), "TRIGGERED");
  assert.equal(transitionStrategyExecution("TRIGGERED", "RISK_CHECK"), "RISK_CHECK");
  assert.equal(transitionStrategyExecution("RISK_CHECK", "EXECUTING"), "EXECUTING");
  assert.equal(transitionStrategyExecution("EXECUTING", "FINISHED"), "FINISHED");
});

test("strategy execution lifecycle rejects unsafe transitions", () => {
  assert.equal(canTransitionStrategyExecution("ACTIVE", "EXECUTING"), false);
  assert.equal(canTransitionStrategyExecution("FINISHED", "EXECUTING"), false);
  assert.equal(canTransitionStrategyExecution("CANCELLED", "ACTIVE"), false);
  assert.throws(
    () => transitionStrategyExecution("ACTIVE", "FINISHED"),
    /Invalid strategy execution transition/
  );
});

test("failed execution can recover only through an explicit active transition", () => {
  assert.equal(canTransitionStrategyExecution("EXECUTING", "FAILED"), true);
  assert.equal(transitionStrategyExecution("FAILED", "ACTIVE"), "ACTIVE");
  assert.equal(canTransitionStrategyExecution("FAILED", "EXECUTING"), false);
});

test("trigger evaluator fires an active strategy when its time has arrived", () => {
  const strategy = activateStrategy(createDraftStrategy({
    type: "DCA",
    asset: "NVDAB",
    amountUsd: 10,
    frequency: "Weekly",
    nextExecutionAt: "2026-10-05T09:00:00.000Z"
  }));

  const decision = evaluateStrategyTrigger(strategy, {
    now: "2026-10-05T10:00:00.000Z",
    marketOpen: true
  });
  assert.equal(decision.eligible, true);
  assert.equal(decision.triggeredAt, "2026-10-05T10:00:00.000Z");
});

test("trigger evaluator does not fire before the scheduled time or when market is closed", () => {
  const strategy = activateStrategy(createDraftStrategy({
    type: "RECURRING",
    asset: "NVDAB",
    amountUsd: 10,
    frequency: "Daily",
    nextExecutionAt: "2026-10-05T11:00:00.000Z"
  }));

  assert.equal(evaluateStrategyTrigger(strategy, {
    now: "2026-10-05T10:00:00.000Z",
    marketOpen: true
  }).eligible, false);

  assert.equal(evaluateStrategyTrigger(strategy, {
    now: "2026-10-05T12:00:00.000Z",
    marketOpen: false
  }).eligible, false);
});

test("conditional strategies require an explicit deterministic condition result", () => {
  const strategy = activateStrategy(createDraftStrategy({
    type: "CONDITIONAL",
    asset: "NVDAB",
    condition: "price below reference"
  }));

  assert.equal(evaluateStrategyTrigger(strategy, {
    now: "2026-10-05T12:00:00.000Z",
    marketOpen: true
  }).eligible, false);

  assert.equal(evaluateStrategyTrigger(strategy, {
    now: "2026-10-05T12:00:00.000Z",
    marketOpen: true,
    conditionMet: true
  }).eligible, true);
});
