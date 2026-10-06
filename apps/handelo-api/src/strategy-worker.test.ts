import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDraftStrategy } from "@handelo/strategy";
import { activateStoredStrategy } from "./strategy-store.js";
import { createPersistedStrategyWorker } from "./strategy-worker.js";

const dependencies = {
  wallet: "0x3333333333333333333333333333333333333333",
  store: {
    claim: async <T>(record: T) => record,
    get: async () => null,
    update: async <T>(record: T) => record
  },
  riskCheck: async () => true,
  execute: async () => {}
};

test("strategy worker rejects intervals below one second", () => {
  assert.throws(
    () => createPersistedStrategyWorker({ ...dependencies, intervalMs: 999 }),
    /at least 1000ms/
  );
});

test("strategy worker starts and stops idempotently", async () => {
  let scheduled = 0;
  let cleared = 0;

  const worker = createPersistedStrategyWorker({
    ...dependencies,
    intervalMs: 1000,
    setInterval: () => {
      scheduled += 1;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {
      cleared += 1;
    }
  });

  worker.start();
  worker.start();
  assert.equal(scheduled, 1);
  assert.equal(worker.isRunning(), true);

  const result = await worker.tick();
  assert.equal(result.evaluated, 0);

  worker.stop();
  worker.stop();
  assert.equal(cleared, 1);
  assert.equal(worker.isRunning(), false);
});

test("strategy worker shares an in-flight tick instead of overlapping scheduler runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "handelo-worker-"));
  const strategyPath = join(directory, "strategies.json");
  const executionPath = join(directory, "executions.json");
  const previousPath = process.env.HANDELO_STRATEGY_STORE_PATH;
  process.env.HANDELO_STRATEGY_STORE_PATH = strategyPath;

  let releaseRisk: (() => void) | null = null;
  let riskStarted = false;
  const riskGate = new Promise<void>(resolve => {
    releaseRisk = resolve;
  });

  try {
    const strategy = createDraftStrategy({
      type: "DCA",
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Daily",
      nextExecutionAt: "2026-10-05T11:00:00.000Z"
    });
    await activateStoredStrategy(dependencies.wallet, strategy);

    const executionRecords = new Map<string, any>();
    const store = {
      claim: async (record: any) => {
        executionRecords.set(record.executionKey, record);
        return record;
      },
      get: async (executionKey: string) => executionRecords.get(executionKey) ?? null,
      update: async (record: any) => {
        executionRecords.set(record.executionKey, record);
        return record;
      }
    };

    const worker = createPersistedStrategyWorker({
      wallet: dependencies.wallet,
      store,
      now: () => "2026-10-05T12:00:00.000Z",
      marketOpen: true,
      riskCheck: async () => {
        riskStarted = true;
        await riskGate;
        return true;
      },
      execute: async () => {}
    });

    const first = worker.tick();
    while (!riskStarted) await new Promise(resolve => setImmediate(resolve));
    const second = worker.tick();

    assert.strictEqual(first, second);
    releaseRisk?.();

    const result = await first;
    assert.equal(result.finished, 1);
    assert.equal(result.failed, 0);
  } finally {
    if (previousPath === undefined) delete process.env.HANDELO_STRATEGY_STORE_PATH;
    else process.env.HANDELO_STRATEGY_STORE_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
    void executionPath;
  }
});
