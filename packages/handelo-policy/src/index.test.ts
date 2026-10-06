import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, executionAction } from "./index.js";

test("blocks transactions above configured spend",()=>{
  const result=evaluatePolicy({action:"buy",amountUsd:101,marketOpen:true,premiumPct:0,maxSpendUsd:100});
  assert.equal(result.decision,"BLOCK");
});

test("requires confirmation when reference market is closed",()=>{
  const result=evaluatePolicy({action:"buy",amountUsd:20,marketOpen:false,premiumPct:1});
  assert.equal(result.decision,"CONFIRM");
});

test("allows an in-limit open-market transaction within the reference gap",()=>{
  const result=evaluatePolicy({action:"buy",amountUsd:20,marketOpen:true,premiumPct:2});
  assert.equal(result.decision,"READY");
});


test("execution action normalizes invest to buy and rejects sell",()=>{
  assert.equal(executionAction("buy"),"buy");
  assert.equal(executionAction("invest"),"buy");
  assert.equal(executionAction("sell"),null);
  assert.equal(executionAction("research"),null);
});


test("unknown reference gap requires confirmation",()=>{
  const result=evaluatePolicy({action:"buy",amountUsd:20,marketOpen:true,premiumPct:null});
  assert.equal(result.decision,"CONFIRM");
  assert.match(result.reasons[0],/reference price is unavailable/i);
});
