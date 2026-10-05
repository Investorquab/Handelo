import assert from "node:assert/strict";
import test from "node:test";
import {activateStrategy,createDraftStrategy,executionGrantFromStrategy,validateStrategyInput} from "./index.js";

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
