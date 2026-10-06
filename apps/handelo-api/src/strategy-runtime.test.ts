import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStrategyExecutionStore } from "@handelo/strategy";
import { activateStoredStrategy, getStoredStrategy } from "./strategy-store.js";
import { listPersistedStrategyExecutions, runPersistedStrategyScheduler } from "./strategy-runtime.js";

test("persisted scheduler updates the stored strategy after a successful run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handelo-persisted-runtime-"));
  const strategyPath = join(dir, "strategies.json");
  const executionPath = join(dir, "runs.json");
  process.env.HANDELO_STRATEGY_STORE_PATH = strategyPath;

  try {
    const wallet = "0x3333333333333333333333333333333333333333";
    const strategy = {
      id: "persisted-runtime-test",
      type: "DCA" as const,
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Daily",
      constraints: {},
      nextExecutionAt: "2026-10-05T11:00:00.000Z",
      status: "DRAFT" as const
    };

    await activateStoredStrategy(wallet, strategy);

    let executions = 0;
    const result = await runPersistedStrategyScheduler({
      wallet,
      store: new FileStrategyExecutionStore(executionPath),
      now: () => "2026-10-05T12:00:00.000Z",
      marketOpen: true,
      riskCheck: async () => true,
      execute: async () => { executions += 1; }
    });

    assert.equal(result.finished, 1);
    assert.equal(executions, 1);
    assert.equal(
      (await getStoredStrategy(wallet, strategy.id))?.nextExecutionAt,
      "2026-10-06T12:00:00.000Z"
    );

    const persisted = JSON.parse(await readFile(strategyPath, "utf8")) as Array<{id:string; nextExecutionAt?:string}>;
    assert.equal(persisted.find(item => item.id === strategy.id)?.nextExecutionAt, "2026-10-06T12:00:00.000Z");
  } finally {
    delete process.env.HANDELO_STRATEGY_STORE_PATH;
    await rm(dir, { recursive: true, force: true });
  }
});

test("persisted execution history is isolated to the requested wallet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handelo-history-runtime-"));
  const strategyPath = join(dir, "strategies.json");
  const executionPath = join(dir, "runs.json");
  process.env.HANDELO_STRATEGY_STORE_PATH = strategyPath;

  try {
    const walletA = "0x3333333333333333333333333333333333333333";
    const walletB = "0x4444444444444444444444444444444444444444";
    const store = new FileStrategyExecutionStore(executionPath);

    const strategyA = {
      id: "history-a",
      type: "DCA" as const,
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Daily",
      constraints: {},
      nextExecutionAt: null,
      status: "DRAFT" as const
    };
    const strategyB = { ...strategyA, id: "history-b", asset: "NVDAon" };

    await activateStoredStrategy(walletA, strategyA);
    await activateStoredStrategy(walletB, strategyB);

    const activeA = await getStoredStrategy(walletA, strategyA.id);
    const activeB = await getStoredStrategy(walletB, strategyB.id);
    assert.ok(activeA);
    assert.ok(activeB);

    const { createStrategyExecutionRecord } = await import("@handelo/strategy");
    await store.claim(createStrategyExecutionRecord(activeA!, "2026-10-05T12:00:00.000Z"));
    await store.claim(createStrategyExecutionRecord(activeB!, "2026-10-05T13:00:00.000Z"));

    const history = await listPersistedStrategyExecutions(walletA, store);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.strategyId, strategyA.id);
  } finally {
    delete process.env.HANDELO_STRATEGY_STORE_PATH;
    await rm(dir, { recursive: true, force: true });
  }
});


test("strategy attribution joins persisted execution outcomes to the requested wallet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handelo-attribution-runtime-"));
  const strategyPath = join(dir, "strategies.json");
  const executionPath = join(dir, "runs.json");
  process.env.HANDELO_STRATEGY_STORE_PATH = strategyPath;
  try {
    const wallet = "0x5555555555555555555555555555555555555555";
    const strategy = { id: "attribution-test", type: "DCA" as const, asset: "NVDAB", amountUsd: 25, frequency: "Weekly", constraints: {}, nextExecutionAt: "2026-10-12T12:00:00.000Z", status: "DRAFT" as const };
    await activateStoredStrategy(wallet, strategy);
    const active = await getStoredStrategy(wallet, strategy.id);
    assert.ok(active);
    const store = new FileStrategyExecutionStore(executionPath);
    const { createStrategyExecutionRecord } = await import("@handelo/strategy");
    const record = createStrategyExecutionRecord(active!, "2026-10-05T12:00:00.000Z");
    await store.claim(record);
    record.status = "FINISHED";
    record.finishedAt = "2026-10-05T12:00:03.000Z";
    await store.update(record);
    const { listStrategyAttribution } = await import("./strategy-runtime.js");
    const result = await listStrategyAttribution(wallet, store);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.executionCount, 1);
    assert.equal(result[0]?.finishedCount, 1);
    assert.equal(result[0]?.successfulPlannedUsd, 25);
    assert.equal(result[0]?.lastExecutionAt, "2026-10-05T12:00:03.000Z");
    assert.equal(result[0]?.nextExecutionAt, "2026-10-12T12:00:00.000Z");
  } finally {
    delete process.env.HANDELO_STRATEGY_STORE_PATH;
    await rm(dir, { recursive: true, force: true });
  }
});
