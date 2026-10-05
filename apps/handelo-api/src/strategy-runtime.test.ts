import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStrategyExecutionStore } from "@handelo/strategy";
import { activateStoredStrategy, getStoredStrategy } from "./strategy-store.js";
import { runPersistedStrategyScheduler } from "./strategy-runtime.js";

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
