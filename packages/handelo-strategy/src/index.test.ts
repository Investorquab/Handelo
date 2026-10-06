import assert from "node:assert/strict";
import test from "node:test";
import {activateStrategy,canTransitionStrategyExecution,createDraftStrategy,executionGrantFromStrategy,transitionStrategyExecution,validateStrategyInput,evaluateStrategyTrigger,createStrategyExecutionRecord,runTriggeredStrategy,runStrategyScheduler,StrategyExecutionRegistry,FileStrategyExecutionStore,beginStrategyExecution,finishStrategyExecution,failStrategyExecution,nextExecutionAtForFrequency,scheduleNextStrategyExecution,recoverStaleStrategyExecutions} from "./index.js";

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

test("execution registry prevents duplicate claims for the same trigger", () => {
  const strategy = activateStrategy(createDraftStrategy({
    type: "DCA",
    asset: "NVDAB",
    amountUsd: 10,
    frequency: "Daily"
  }));
  const record = createStrategyExecutionRecord(strategy, "2026-10-05T12:00:00.000Z");
  const registry = new StrategyExecutionRegistry();

  assert.equal(registry.claim(record).runId, record.runId);
  assert.equal(registry.get(record.executionKey)?.runId, record.runId);
  assert.throws(() => registry.claim(record), /already been claimed/);
  assert.equal(registry.size(), 1);
});

test("execution record follows risk-check, execute, and finish lifecycle", () => {
  const strategy = activateStrategy(createDraftStrategy({
    type: "RECURRING",
    asset: "NVDAB",
    amountUsd: 10,
    frequency: "Daily"
  }));
  let record = createStrategyExecutionRecord(strategy, "2026-10-05T12:00:00.000Z");
  record = { ...record, status: transitionStrategyExecution(record.status, "RISK_CHECK") };
  record = beginStrategyExecution(record, "2026-10-05T12:00:05.000Z");
  assert.equal(record.status, "EXECUTING");
  record = finishStrategyExecution(record, "2026-10-05T12:00:10.000Z");
  assert.equal(record.status, "FINISHED");
  assert.equal(record.finishedAt, "2026-10-05T12:00:10.000Z");
});

test("in-flight failures are recorded with an explicit reason", () => {
  const strategy = activateStrategy(createDraftStrategy({
    type: "CONDITIONAL",
    asset: "NVDAB",
    condition: "price below reference"
  }));
  let record = createStrategyExecutionRecord(strategy, "2026-10-05T12:00:00.000Z");
  record = failStrategyExecution(record, "2026-10-05T12:00:01.000Z", "Risk blocked");
  assert.equal(record.status, "FAILED");
  assert.equal(record.error, "Risk blocked");
});

test("file execution store persists claims and updates", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = await mkdtemp(join(tmpdir(), "handelo-strategy-"));
  try {
    const store = new FileStrategyExecutionStore(join(dir, "runs.json"));
    const strategy = activateStrategy(createDraftStrategy({
      type: "DCA",
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Daily"
    }));
    const record = createStrategyExecutionRecord(strategy, "2026-10-05T12:00:00.000Z");

    await store.claim(record);
    const loaded = await store.get(record.executionKey);
    assert.equal(loaded?.runId, record.runId);

    const riskChecked = { ...record, status: transitionStrategyExecution(record.status, "RISK_CHECK") };
    await store.update(riskChecked);
    assert.equal((await store.get(record.executionKey))?.status, "RISK_CHECK");

    await assert.rejects(() => store.claim(record), /already been claimed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale in-flight executions are recovered after restart", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = await mkdtemp(join(tmpdir(), "handelo-recovery-"));
  try {
    const store = new FileStrategyExecutionStore(join(dir, "runs.json"));
    const strategy = activateStrategy(createDraftStrategy({
      type: "DCA",
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Daily"
    }));
    let record = createStrategyExecutionRecord(strategy, "2026-10-05T11:00:00.000Z");
    record = { ...record, status: "RISK_CHECK", startedAt: null };
    await store.claim(record);

    const result = await recoverStaleStrategyExecutions(
      store,
      "2026-10-05T12:00:00.000Z",
      1_000
    );

    assert.equal(result.recovered, 1);
    assert.equal(result.records[0]?.status, "FAILED");
    assert.equal(
      result.records[0]?.error,
      "Recovered after worker restart; the previous execution was left in-flight."
    );
    assert.equal((await store.get(record.executionKey))?.status, "FAILED");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime worker performs risk check before execution and persists completion", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = await mkdtemp(join(tmpdir(), "handelo-runtime-"));
  try {
    const store = new FileStrategyExecutionStore(join(dir, "runs.json"));
    const strategy = activateStrategy(createDraftStrategy({
      type: "DCA",
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Daily"
    }));
    const calls: string[] = [];

    const result = await runTriggeredStrategy(
      strategy,
      { eligible: true, reason: "ready", triggeredAt: "2026-10-05T12:00:00.000Z" },
      {
        store,
        now: () => "2026-10-05T12:00:05.000Z",
        riskCheck: async (_strategy, record) => {
          calls.push(record.status);
          return true;
        },
        execute: async (_strategy, record) => {
          calls.push(record.status);
        }
      }
    );

    assert.equal(result.status, "FINISHED");
    assert.deepEqual(calls, ["RISK_CHECK", "EXECUTING"]);
    assert.equal((await store.get("bad-key"))?.status, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime worker records risk blocks and never calls execution", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = await mkdtemp(join(tmpdir(), "handelo-runtime-block-"));
  try {
    const store = new FileStrategyExecutionStore(join(dir, "runs.json"));
    const strategy = activateStrategy(createDraftStrategy({
      type: "CONDITIONAL",
      asset: "NVDAB",
      condition: "price below reference"
    }));
    let executed = false;

    const result = await runTriggeredStrategy(
      strategy,
      { eligible: true, reason: "ready", triggeredAt: "2026-10-05T12:00:00.000Z" },
      {
        store,
        now: () => "2026-10-05T12:00:05.000Z",
        riskCheck: async () => false,
        execute: async () => { executed = true; }
      }
    );

    assert.equal(result.status, "FAILED");
    assert.equal(executed, false);
    if (result.status === "FAILED") assert.equal(result.record.error, "Risk governor blocked execution.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime worker treats a duplicate trigger as non-executable", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = await mkdtemp(join(tmpdir(), "handelo-runtime-duplicate-"));
  try {
    const store = new FileStrategyExecutionStore(join(dir, "runs.json"));
    const strategy = activateStrategy(createDraftStrategy({
      type: "DCA",
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Daily"
    }));
    const trigger = { eligible: true, reason: "ready", triggeredAt: "2026-10-05T12:00:00.000Z" };
    const dependencies = {
      store,
      now: () => "2026-10-05T12:00:05.000Z",
      riskCheck: async () => true,
      execute: async () => undefined
    };

    const first = await runTriggeredStrategy(strategy, trigger, dependencies);
    const second = await runTriggeredStrategy(strategy, trigger, dependencies);

    assert.equal(first.status, "FINISHED");
    assert.equal(second.status, "DUPLICATE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("strategy scheduler evaluates active strategies and runs only eligible triggers", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = await mkdtemp(join(tmpdir(), "handelo-scheduler-"));
  try {
    const store = new FileStrategyExecutionStore(join(dir, "runs.json"));
    const due = activateStrategy(createDraftStrategy({
      type: "DCA", asset: "NVDAB", amountUsd: 10, frequency: "Daily", nextExecutionAt: "2026-10-05T11:00:00.000Z"
    }));
    const future = activateStrategy(createDraftStrategy({
      type: "DCA", asset: "NVDAon", amountUsd: 10, frequency: "Daily",
      nextExecutionAt: "2026-10-05T13:00:00.000Z"
    }));
    const executed: string[] = [];

    const result = await runStrategyScheduler({
      store,
      now: () => "2026-10-05T12:00:00.000Z",
      marketOpen: true,
      listActiveStrategies: async () => [due, future],
      riskCheck: async () => true,
      execute: async strategy => { executed.push(strategy.asset); }
    });

    assert.equal(result.evaluated, 2);
    assert.equal(result.triggered, 1);
    assert.equal(result.finished, 1);
    assert.equal(result.skipped, 1);
    assert.deepEqual(executed, ["NVDAB"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scheduler supplies deterministic condition results to conditional strategies", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = await mkdtemp(join(tmpdir(), "handelo-scheduler-condition-"));
  try {
    const store = new FileStrategyExecutionStore(join(dir, "runs.json"));
    const strategy = activateStrategy(createDraftStrategy({
      type: "CONDITIONAL", asset: "NVDAB", condition: "price below reference"
    }));
    let conditionCalls = 0;
    let executions = 0;

    const result = await runStrategyScheduler({
      store,
      now: () => "2026-10-05T12:00:00.000Z",
      marketOpen: true,
      listActiveStrategies: async () => [strategy],
      conditionMet: async () => { conditionCalls += 1; return true; },
      riskCheck: async () => true,
      execute: async () => { executions += 1; }
    });

    assert.equal(conditionCalls, 1);
    assert.equal(executions, 1);
    assert.equal(result.finished, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scheduler never executes when market is closed", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = await mkdtemp(join(tmpdir(), "handelo-scheduler-closed-"));
  try {
    const store = new FileStrategyExecutionStore(join(dir, "runs.json"));
    const strategy = activateStrategy(createDraftStrategy({
      type: "DCA", asset: "NVDAB", amountUsd: 10, frequency: "Daily", nextExecutionAt: "2026-10-05T11:00:00.000Z"
    }));
    let executions = 0;

    const result = await runStrategyScheduler({
      store,
      now: () => "2026-10-05T12:00:00.000Z",
      marketOpen: false,
      listActiveStrategies: async () => [strategy],
      riskCheck: async () => true,
      execute: async () => { executions += 1; }
    });

    assert.equal(result.skipped, 1);
    assert.equal(executions, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recurring schedules calculate the next execution deterministically", () => {
  assert.equal(
    nextExecutionAtForFrequency("Daily", "2026-10-05T12:00:00.000Z"),
    "2026-10-06T12:00:00.000Z"
  );
  assert.equal(
    nextExecutionAtForFrequency("Weekly", "2026-10-05T12:00:00.000Z"),
    "2026-10-12T12:00:00.000Z"
  );
  assert.equal(
    nextExecutionAtForFrequency("Every Monday", "2026-10-05T12:00:00.000Z"),
    "2026-10-12T12:00:00.000Z"
  );
  assert.equal(nextExecutionAtForFrequency("Unsupported cadence", "2026-10-05T12:00:00.000Z"), null);
});

test("scheduler persists the next execution time after a successful recurring run", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = await mkdtemp(join(tmpdir(), "handelo-scheduler-next-"));
  try {
    const store = new FileStrategyExecutionStore(join(dir, "runs.json"));
    const strategy = activateStrategy(createDraftStrategy({
      type: "DCA",
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Daily",
      nextExecutionAt: "2026-10-05T11:00:00.000Z"
    }));
    let updated: { nextExecutionAt?: string | null } = { };

    const result = await runStrategyScheduler({
      store,
      now: () => "2026-10-05T12:00:00.000Z",
      marketOpen: true,
      listActiveStrategies: async () => [strategy],
      updateStrategy: async value => { updated = value; },
      riskCheck: async () => true,
      execute: async () => undefined
    });

    assert.equal(result.finished, 1);
    assert.equal(updated.nextExecutionAt, "2026-10-06T12:00:00.000Z");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
