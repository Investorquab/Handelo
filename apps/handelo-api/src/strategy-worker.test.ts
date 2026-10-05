import assert from "node:assert/strict";
import test from "node:test";
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

  const result = await worker.tick();
  assert.equal(result.evaluated, 0);

  worker.stop();
  worker.stop();
  assert.equal(cleared, 1);
  assert.equal(worker.isRunning(), false);
});
