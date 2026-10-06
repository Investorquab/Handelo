import test from "node:test";
import assert from "node:assert/strict";
import { walletServiceError } from "./wallet-errors.js";

test("wallet service hides raw ENOENT process errors", () => {
  const message = walletServiceError(Object.assign(new Error("spawn baw ENOENT"), { code: "ENOENT" }));
  assert.equal(
    message,
    "The Binance Agentic Wallet service is unavailable. Please make sure the wallet CLI is installed and try again."
  );
  assert.doesNotMatch(message, /spawn baw ENOENT/i);
});

test("wallet service maps permission failures to a user-facing message", () => {
  assert.equal(
    walletServiceError(Object.assign(new Error("spawn baw EACCES"), { code: "EACCES" })),
    "The Binance Agentic Wallet service could not be started because of a permissions issue. Please try again."
  );
});

test("wallet service does not expose unknown internal errors", () => {
  assert.equal(
    walletServiceError(new Error("internal command output with sensitive details")),
    "The Binance Agentic Wallet service could not complete the request. Please try again."
  );
});
