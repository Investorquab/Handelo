import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("strategy store persists lifecycle changes and isolates wallets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handelo-strategy-store-"));
  const path = join(dir, "strategies.json");
  process.env.HANDELO_STRATEGY_STORE_PATH = path;

  try {
    const store = await import("./strategy-store.js");
    const strategy = {
      id: "strategy-lifecycle-test",
      type: "DCA" as const,
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Daily",
      constraints: {},
      nextExecutionAt: "2026-10-06T12:00:00.000Z",
      status: "DRAFT" as const
    };
    const walletA = "0x1111111111111111111111111111111111111111";
    const walletB = "0x2222222222222222222222222222222222222222";

    const activated = await store.activateStoredStrategy(walletA, strategy);
    assert.equal(activated.status, "ACTIVE");
    assert.equal((await store.listActiveStrategies(walletB)).length, 0);

    const paused = await store.pauseStoredStrategy(walletA, strategy.id);
    assert.equal(paused.status, "PAUSED");
    assert.equal((await store.listActiveStrategies(walletA)).length, 0);

    const resumed = await store.resumeStoredStrategy(walletA, strategy.id);
    assert.equal(resumed.status, "ACTIVE");

    const edited = await store.updateStoredStrategy(walletA, strategy.id, {
      amountUsd: 15,
      nextExecutionAt: "2026-10-07T12:00:00.000Z"
    });
    assert.equal(edited.amountUsd, 15);
    assert.equal(edited.nextExecutionAt, "2026-10-07T12:00:00.000Z");

    const cancelled = await store.cancelStoredStrategy(walletA, strategy.id);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal((await store.listActiveStrategies(walletA)).length, 0);
    assert.equal((await store.getStoredStrategy(walletA, strategy.id))?.status, "CANCELLED");
    await assert.rejects(
      () => store.updateStoredStrategy(walletA, strategy.id, { amountUsd: 20 }),
      /Cancelled strategies cannot be edited/
    );
  } finally {
    delete process.env.HANDELO_STRATEGY_STORE_PATH;
    await rm(dir, { recursive: true, force: true });
  }
});
