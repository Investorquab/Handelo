import assert from "node:assert/strict";
import test from "node:test";
import {
  BNB_AGENTIC_WALLET_COMMANDS,
  BNB_AGENTIC_WALLET_STATUSES,
  BNB_BSC_CHAIN_ID,
  isBscChainId
} from "./bnb-agentic-wallet-contract.js";

test("Binance Agentic Wallet contract pins Handelo to documented BSC chain 56", () => {
  assert.equal(BNB_BSC_CHAIN_ID, "56");
  assert.equal(isBscChainId("56"), true);
  assert.equal(isBscChainId("1"), false);
});

test("documented wallet command surface covers Handelo preflight and execution", () => {
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.walletStatus, ["wallet", "status"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.walletAddress, ["wallet", "address"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.walletBalance, ["wallet", "balance"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.walletSettings, ["wallet", "settings"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.walletLeftQuota, ["wallet", "left-quota"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.walletTxLock, ["wallet", "tx-lock"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.walletChains, ["wallet", "chains"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.marketOrderQuote, ["market-order", "quote"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.marketOrderSwap, ["market-order", "swap"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.marketOrderList, ["market-order", "list"]);
});

test("wallet authentication lifecycle is explicit", () => {
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.authSignin, ["auth", "signin"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.authVerify, ["auth", "verify"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_COMMANDS.authSignout, ["auth", "signout"]);
  assert.deepEqual(BNB_AGENTIC_WALLET_STATUSES, ["CONNECTED", "UNCONNECTED", "CREATING"]);
});
