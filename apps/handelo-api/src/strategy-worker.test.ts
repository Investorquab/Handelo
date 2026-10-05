import assert from "node:assert/strict";
import test from "node:test";
import { createPersistedStrategyWorker } from "./strategy-worker.js";

test("strategy worker rejects intervals below one second", () => {
  assert.throws(
    () => createPersistedStrategyWorker({
      wallet: "0x3333333333333333333333333333333333333333",
      store: {
        claim: async record => record,
        get: async () => null,
        update: async record => record
      },
      riskCheck: async () => true,
      execute: async () => {},
      intervalMs: 999
    }),
    /at least 1000ms/
  );
});

test("strategy worker starts once, stops once, and prevents overlapping ticks", async () => {
  let scheduled = 0;
  let cleared = 0;
  let resolveRun: (() => void) | undefined;
  let calls = 0;

  const worker = createPersistedStrategyWorker({
    wallet: "0x3333333333333333333333333333333333333333",
    store: {
      claim: async record => record,
      get: async () => null,
      update: async record => record
    },
    riskCheck: async () => true,
    execute: async () => {},
    intervalMs: 1000,
    setInterval: () => {
      scheduled += 1;
      return 1 as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {
      cleared += 1;
    }
  });

  worker.start();
  worker.start();
  assert.equal(scheduled, 1);
  assert.equal(worker.isRunning(), true);

  const first = worker.tick();
  const second = worker.tick();
  assert.equal(first, second);
  await new Promise<void>(resolve => {
    resolveRun = resolve;
    setTimeout(resolve, 0);
  });
  void resolveRun;

  worker.stop();
  worker.stop();
  assert.equal(cleared, 1);
  assert.equal(worker.isRunning(), false);
  assert.equal(calls, 0);
});
