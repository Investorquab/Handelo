import test from "node:test";
import assert from "node:assert/strict";
import { consumeReviewToken, createReviewToken, quoteDriftWithinTolerance, readVerifiedReviewToken, verifyReviewToken, type ReviewTokenInput } from "./review-token.js";

const input: ReviewTokenInput = {
  ticker: "NVDA",
  amountUsd: 20,
  fromToken: "0x55d398326f99059fF775485246999027B3197955",
  fromTokenQty: "20",
  toToken: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  action: "buy",
  contract: "0x0000000000000000000000000000000000000001",
  slippage: "0.50",
  wallet: "0x0000000000000000000000000000000000000003"
};

test("review token accepts the exact reviewed trade", () => {
  const now = 1_000_000;
  const token = createReviewToken(input, now);
  assert.equal(verifyReviewToken(token, input, now + 1_000), true);
});

test("review token rejects a changed amount or contract", () => {
  const now = 1_000_000;
  const token = createReviewToken(input, now);
  assert.equal(verifyReviewToken(token, { ...input, amountUsd: 25 }, now + 1_000), false);
  assert.equal(verifyReviewToken(token, { ...input, contract: "0x0000000000000000000000000000000000000002" }, now + 1_000), false);
});

test("review token rejects tampering and expiry", () => {
  const now = 1_000_000;
  const token = createReviewToken(input, now);
  const [payload] = token.split(".");
  const tampered = `${payload}.invalid-signature`;
  assert.equal(verifyReviewToken(tampered, input, now + 1_000), false);
  assert.equal(verifyReviewToken(token, input, now + 5 * 60 * 1000), false);
});

test("review token compares address casing without weakening the contract binding", () => {
  const now = 1_000_000;
  const token = createReviewToken(input, now);
  assert.equal(
    verifyReviewToken(token, { ...input, fromToken: input.fromToken.toLowerCase(), contract: input.contract.toUpperCase() }, now + 1_000),
    true
  );
});


test("review token rejects a missing or changed reviewed slippage", () => {
  const now = 1_000_000;
  const token = createReviewToken(input, now);
  assert.equal(verifyReviewToken(token, { ...input, slippage: undefined }, now + 1_000), false);
  assert.equal(verifyReviewToken(token, { ...input, slippage: "1.00" }, now + 1_000), false);
});

test("review token rejects a changed slippage", () => {
  const now = 1_000_000;
  const token = createReviewToken(input, now);
  assert.equal(verifyReviewToken(token, { ...input, slippage: "1.00" }, now + 1_000), false);
});


test("review token can only be consumed once during its lifetime", () => {
  const now = 2_000_000;
  const token = createReviewToken(input, now);
  assert.equal(consumeReviewToken(token, now + 1), true);
  assert.equal(consumeReviewToken(token, now + 2), false);
});


test("review token rejects a changed wallet", () => {
  const now = 1_000_000;
  const token = createReviewToken(input, now);
  assert.equal(
    verifyReviewToken(token, { ...input, wallet: "0x0000000000000000000000000000000000000004" }, now + 1_000),
    false
  );
});


test("review token binds the reviewed quote price", () => {
  const now = 1_000_000;
  const token = createReviewToken({ ...input, reviewedQuotePrice: 125 }, now);
  assert.equal(verifyReviewToken(token, { ...input, reviewedQuotePrice: 125 }, now + 1_000), true);
  assert.equal(verifyReviewToken(token, { ...input, reviewedQuotePrice: 120 }, now + 1_000), false);
  assert.equal(readVerifiedReviewToken(token, now + 1_000)?.reviewedQuotePrice, 125);
});

test("quote drift guard blocks material price movement", () => {
  assert.equal(quoteDriftWithinTolerance(125, 125.5, "1"), true);
  assert.equal(quoteDriftWithinTolerance(125, 127, "1"), false);
  assert.equal(quoteDriftWithinTolerance(125, null, "1"), false);
});

test("quote drift guard defaults to a one percent tolerance when review omitted slippage", () => {
  assert.equal(quoteDriftWithinTolerance(100, 100.9), true);
  assert.equal(quoteDriftWithinTolerance(100, 101.1), false);
});

test("review token rejects a changed funding quantity", () => {
  const now = 1_000_000;
  const token = createReviewToken(input, now);
  assert.equal(verifyReviewToken(token, { ...input, fromTokenQty: "0.5" }, now + 1_000), false);
});

test("review token rejects a changed direction or destination", () => {
  const now=1_000_000;
  const token=createReviewToken(input,now);
  assert.equal(verifyReviewToken(token,{...input,action:"sell"},now+1_000),false);
  assert.equal(verifyReviewToken(token,{...input,toToken:"0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"},now+1_000),false);
});
