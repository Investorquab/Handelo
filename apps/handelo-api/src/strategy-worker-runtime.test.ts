import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedAutonomousStrategy } from "./strategy-worker-runtime.js";
import type { StrategyDefinition } from "@handelo/core";

const base: StrategyDefinition = {
  id: "strategy-1",
  type: "DCA",
  asset: "NVDAB",
  amountUsd: 10,
  frequency: "Daily",
  constraints: {},
  nextExecutionAt: "2026-10-06T10:00:00.000Z",
  status: "ACTIVE"
};

test("autonomous worker accepts DCA and recurring strategies", () => {
  assert.equal(isSupportedAutonomousStrategy(base), true);
  assert.equal(isSupportedAutonomousStrategy({ ...base, type: "RECURRING" }), true);
});

test("autonomous worker does not silently execute unsupported strategy types", () => {
  assert.equal(isSupportedAutonomousStrategy({ ...base, type: "CONDITIONAL" }), false);
  assert.equal(isSupportedAutonomousStrategy({ ...base, type: "REBALANCE" }), false);
});
