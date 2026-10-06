import assert from "node:assert/strict";
import test from "node:test";
import { buildWalletSendArgs } from "./index.js";

test("builds the documented BSC wallet send command", () => {
  assert.deepEqual(
    buildWalletSendArgs({
      recipient: " 0x2222222222222222222222222222222222222222 ",
      amount: "5.25",
      tokenAddress: "0x55d398326f99059fF775485246999027B3197955",
      binanceChainId: "56",
      gasLevel: "LOW"
    }),
    ["wallet","send","--amount","5.25","--recipient","0x2222222222222222222222222222222222222222","--binanceChainId","56","--tokenAddress","0x55d398326f99059fF775485246999027B3197955","--gasLevel","LOW"]
  );
});

test("rejects non-BSC transfer requests", () => {
  assert.throws(
    () => buildWalletSendArgs({recipient:"0x2222222222222222222222222222222222222222",amount:"1",tokenAddress:"0x1",binanceChainId:"1" as "56"}),
    /restricted to BSC/
  );
});

test("rejects malformed recipient and unsafe amounts", () => {
  assert.throws(
    () => buildWalletSendArgs({recipient:"not-an-address",amount:"1",tokenAddress:"0x1",binanceChainId:"56"}),
    /recipient must be a valid EVM/
  );
  for(const amount of ["0","-1","NaN","Infinity",""]){
    assert.throws(
      () => buildWalletSendArgs({recipient:"0x2222222222222222222222222222222222222222",amount,tokenAddress:"0x1",binanceChainId:"56"}),
      /finite positive/
    );
  }
});
