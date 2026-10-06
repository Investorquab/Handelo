import assert from "node:assert/strict";
import test from "node:test";
import { buildGapRadar, normalizeGapRadarLimit } from "./market-intelligence.js";
import type { RwaAsset } from "@handelo/market";

const asset = (overrides: Partial<RwaAsset> = {}): RwaAsset => ({
  binanceChainId: "56",
  tokenContractAddress: "0x0000000000000000000000000000000000000001",
  platformId: "ondo",
  tokenSymbol: "NVDAon",
  decimals: "18",
  underlyingTicker: "NVDA",
  underlyingName: "NVIDIA Corporation",
  tokenToShareRatio: "1",
  tokenPrice: "120",
  referencePrice: "125",
  volume24H: "1000",
  marketCap: "1000000",
  statusInfo: {
    openState: true,
    marketStatus: "OPEN",
    reasonCode: "",
    reasonMsg: null,
    nextOpenTime: null,
    nextCloseTime: null
  },
  ...overrides
});

test("normalizeGapRadarLimit bounds invalid and excessive limits", () => {
  assert.equal(normalizeGapRadarLimit(Number.NaN), 8);
  assert.equal(normalizeGapRadarLimit(0), 1);
  assert.equal(normalizeGapRadarLimit(3.9), 3);
  assert.equal(normalizeGapRadarLimit(100), 25);
});

test("buildGapRadar returns ranked gaps and cross-representation comparisons", () => {
  const nvdaOn = asset({
    tokenSymbol: "NVDAon",
    platformId: "ondo",
    tokenContractAddress: "0x0000000000000000000000000000000000000011",
    tokenPrice: "120"
  });
  const nvdaX = asset({
    tokenSymbol: "NVDAx",
    platformId: "xstocks",
    tokenContractAddress: "0x0000000000000000000000000000000000000012",
    tokenPrice: "126"
  });
  const msft = asset({
    tokenSymbol: "MSFTx",
    platformId: "xstocks",
    tokenContractAddress: "0x0000000000000000000000000000000000000013",
    underlyingTicker: "MSFT",
    underlyingName: "Microsoft Corporation",
    tokenPrice: "100",
    referencePrice: "105"
  });

  const result = buildGapRadar([nvdaOn, nvdaX, msft], 5);

  assert.equal(result.markets[0]?.underlyingTicker, "MSFT");
  assert.equal(result.representations.length, 1);
  assert.equal(result.representations[0]?.underlyingTicker, "NVDA");
  assert.equal(result.representations[0]?.lowestPriceToken, "NVDAon");
  assert.equal(result.representations[0]?.highestPriceToken, "NVDAx");
  assert.equal(result.representations[0]?.spreadPercent, 5);
  assert.equal(result.markets[0]?.marketStatus, "OPEN");
  assert.equal(result.markets[0]?.nextCloseAt, null);
});
