import assert from "node:assert/strict";
import test from "node:test";
import { HandeloMarketClient, MarketResolutionError, compareRepresentations, isExecutableMarketAsset, normalizeTransactionLimit, normalizeTransactions, rankGapRadarAssets, toMarketInsight, type RwaAsset, type WalletTransaction } from "./index.js";

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
    nextCloseTime: null,
  },
  ...overrides,
});

function client(searchResults: unknown[], tokenResults: RwaAsset[]) {
  const market = new HandeloMarketClient("test-key", "test-secret");
  market.search = async () => searchResults as never;
  market.tokens = async () => tokenResults;
  return market;
}

test("findAll only returns exact underlying ticker matches", async () => {
  const nvda = asset();
  const related = asset({
    tokenContractAddress: "0x0000000000000000000000000000000000000002",
    tokenSymbol: "NVDX",
    underlyingTicker: "NVDX",
  });

  const market = client(
    [{
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      assets: [
        {
          platformId: "ondo",
          binanceChainId: "56",
          tokenContractAddress: nvda.tokenContractAddress,
          tokenSymbol: nvda.tokenSymbol,
          assetType: 1,
        },
        {
          platformId: "other",
          binanceChainId: "56",
          tokenContractAddress: related.tokenContractAddress,
          tokenSymbol: related.tokenSymbol,
          assetType: 1,
        },
      ],
    }],
    [nvda, related],
  );

  const matches = await market.findAll(" nvda ");
  assert.deepEqual(matches.map((item: RwaAsset) => item.tokenContractAddress), [nvda.tokenContractAddress]);
});

test("findAll deduplicates the same contract returned by search", async () => {
  const nvda = asset();

  const market = client(
    [{
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      assets: [
        {
          platformId: "ondo",
          binanceChainId: "56",
          tokenContractAddress: nvda.tokenContractAddress.toUpperCase(),
          tokenSymbol: nvda.tokenSymbol,
          assetType: 1,
        },
        {
          platformId: "ondo",
          binanceChainId: "56",
          tokenContractAddress: nvda.tokenContractAddress,
          tokenSymbol: nvda.tokenSymbol,
          assetType: 1,
        },
      ],
    }],
    [nvda],
  );

  const matches = await market.findAll("NVDA");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].tokenContractAddress, nvda.tokenContractAddress);
});

test("findAll rejects search results that have no matching live market record", async () => {
  const market = client(
    [{
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      assets: [{
        platformId: "ondo",
        binanceChainId: "56",
        tokenContractAddress: "0x0000000000000000000000000000000000000001",
        tokenSymbol: "NVDAon",
        assetType: 1,
      }],
    }],
    [asset({
      tokenContractAddress: "0x0000000000000000000000000000000000000002",
      underlyingTicker: "NVDA",
    })],
  );

  await assert.rejects(
    () => market.findAll("NVDA"),
    /No live BSC tokenized-stock market record found for NVDA/,
  );
});

test("find resolves an exact token symbol before underlying ticker lookup", async () => {
  const bstock = asset({
    platformId: "bstock",
    tokenSymbol: "NVDAB",
    tokenContractAddress: "0x0000000000000000000000000000000000000003",
  });
  const market = client([], [bstock]);

  const result = await market.find(" nvdab ");

  assert.equal(result.tokenSymbol, "NVDAB");
  assert.equal(result.platformId, "bstock");
  assert.equal(result.tokenContractAddress, bstock.tokenContractAddress);
});

test("find refuses to silently choose between multiple live representations", async () => {
  const first = asset();
  const second = asset({
    tokenContractAddress: "0x0000000000000000000000000000000000000002",
    platformId: "xstocks",
    tokenSymbol: "NVDAx",
  });

  const market = client(
    [{
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      assets: [
        {
          platformId: first.platformId,
          binanceChainId: "56",
          tokenContractAddress: first.tokenContractAddress,
          tokenSymbol: first.tokenSymbol,
          assetType: 1,
        },
        {
          platformId: second.platformId,
          binanceChainId: "56",
          tokenContractAddress: second.tokenContractAddress,
          tokenSymbol: second.tokenSymbol,
          assetType: 1,
        },
      ],
    }],
    [first, second],
  );

  await assert.rejects(
    () => market.find("NVDA"),
    /Multiple BSC tokenized-stock representations found for NVDA/,
  );
});




test("transactions applies live normalization to upstream history", async () => {
  const market = new HandeloMarketClient("test-key", "test-secret");
  (market as unknown as { request: () => Promise<unknown> }).request = async () => [{
    transactionList: [
      {
        binanceChainId: "56", txHash: "0xabc", txTime: "1", amount: "20", symbol: "NVDAon", txStatus: "FINISHED",
        tokenContractAddress: "0x0000000000000000000000000000000000000001",
        from: [{ address: "0x0000000000000000000000000000000000000002" }],
        to: [{ address: "0x0000000000000000000000000000000000000003" }],
      },
      {
        binanceChainId: "56", txHash: "0xABC", txTime: "2", amount: "20", symbol: "NVDAon", txStatus: "FINISHED",
        tokenContractAddress: "0x0000000000000000000000000000000000000001", from: [], to: [],
      },
      {
        binanceChainId: "1", txHash: "0xeth", txTime: "3", amount: "20", symbol: "ETH", txStatus: "FINISHED",
        tokenContractAddress: "0x0000000000000000000000000000000000000004", from: [], to: [],
      },
    ],
  }];

  const result = await market.transactions("0x0000000000000000000000000000000000000002");
  assert.deepEqual(result.map(item => item.txHash), ["0xabc"]);
});

test("transaction limits normalize invalid and out-of-range values", () => {
  assert.equal(normalizeTransactionLimit(Number.NaN), 20);
  assert.equal(normalizeTransactionLimit(Number.POSITIVE_INFINITY), 20);
  assert.equal(normalizeTransactionLimit(0), 1);
  assert.equal(normalizeTransactionLimit(25.9), 25);
  assert.equal(normalizeTransactionLimit(500), 100);
});

test("transaction normalization keeps BSC records and removes duplicate or empty hashes", () => {
  const tx = (overrides: Partial<WalletTransaction> = {}): WalletTransaction => ({
    binanceChainId: "56",
    txHash: "0xabc",
    txTime: "1",
    amount: "20",
    symbol: "NVDAon",
    txStatus: "FINISHED",
    tokenContractAddress: "0x0000000000000000000000000000000000000001",
    from: [],
    to: [],
    ...overrides,
  });

  const result = normalizeTransactions([
    tx(),
    tx({ txHash: "0xABC" }),
    tx({ txHash: "0xdef" }),
    tx({ binanceChainId: "1", txHash: "0xeth" }),
    tx({ txHash: "   " }),
  ]);

  assert.deepEqual(result.map(item => item.txHash), ["0xabc", "0xdef"]);
});


test("executable market validation rejects malformed price or contract", () => {
  assert.equal(isExecutableMarketAsset(asset()), true);
  assert.equal(isExecutableMarketAsset(asset({ tokenPrice: "not-a-number" })), false);
  assert.equal(isExecutableMarketAsset(asset({ tokenPrice: "0" })), false);
  assert.equal(isExecutableMarketAsset(asset({ tokenContractAddress: "invalid" })), false);
  assert.equal(isExecutableMarketAsset(asset({ binanceChainId: "1" })), false);
});


test("market insight exposes reference gap and market status",()=>{
  const insight=toMarketInsight(asset({
    tokenPrice:"110",
    referencePrice:"100",
    statusInfo:{openState:false,marketStatus:"CLOSED",reasonCode:"MARKET_CLOSED",reasonMsg:"The market is closed.",nextOpenTime:Date.parse("2026-10-06T13:30:00Z"),nextCloseTime:Date.parse("2026-10-06T20:00:00Z")}
  }));
  assert.equal(insight.onChainPrice,110);
  assert.equal(insight.referencePrice,100);
  assert.equal(insight.divergencePercent,10);
  assert.equal(insight.marketStatus,"CLOSED");
  assert.equal(insight.nextOpenAt,"2026-10-06T13:30:00.000Z");
  assert.equal(insight.nextCloseAt,"2026-10-06T20:00:00.000Z");
  assert.equal(insight.marketStatusReason,"The market is closed.");
  assert.equal(insight.volume24h,1000);
  assert.equal(insight.turnover24hPercent,0.1);
  assert.equal(insight.liquidityActivity,"LOW");
});

test("market insight classifies liquidity activity from volume-to-market-cap turnover",()=>{
  assert.equal(toMarketInsight(asset({volume24H:"200000",marketCap:"1000000"})).liquidityActivity,"HIGH");
  assert.equal(toMarketInsight(asset({volume24H:"30000",marketCap:"1000000"})).liquidityActivity,"MEDIUM");
  assert.equal(toMarketInsight(asset({volume24H:"100",marketCap:"1000000"})).liquidityActivity,"LOW");
  assert.equal(toMarketInsight(asset({volume24H:"bad",marketCap:"1000000"})).liquidityActivity,"UNKNOWN");
});

test("gap radar ranks assets by absolute divergence",()=>{
  const low=asset({tokenSymbol:"LOW",tokenPrice:"101",referencePrice:"100"});
  const high=asset({tokenSymbol:"HIGH",tokenPrice:"120",referencePrice:"100"});
  assert.deepEqual(rankGapRadarAssets([low,high]).map(item=>item.tokenSymbol),["HIGH","LOW"]);
});

test("market resolution errors expose actionable categories",async()=>{
  const market=client([],[]);
  await assert.rejects(
    ()=>market.findAll("UNKNOWN"),
    (error:unknown)=>error instanceof MarketResolutionError && error.kind==="NOT_FOUND"
  );
});


test("compareRepresentations detects cross-provider price spread for the same stock", () => {
  const ondo = asset({
    platformId: "ondo",
    tokenSymbol: "NVDAon",
    tokenContractAddress: "0x0000000000000000000000000000000000000011",
    tokenPrice: "120",
    referencePrice: "125"
  });
  const xstocks = asset({
    platformId: "xstocks",
    tokenSymbol: "NVDAx",
    tokenContractAddress: "0x0000000000000000000000000000000000000012",
    tokenPrice: "126",
    referencePrice: "125"
  });

  const result = compareRepresentations([ondo, xstocks]);
  assert.equal(result.length, 1);
  assert.equal(result[0].underlyingTicker, "NVDA");
  assert.equal(result[0].lowestPriceToken, "NVDAon");
  assert.equal(result[0].highestPriceToken, "NVDAx");
  assert.equal(result[0].spreadPercent, 5);
  assert.equal(result[0].representations[0].divergencePercent, -4);
});


test("compareRepresentations ignores invalid prices and unrelated assets", () => {
  const invalid = asset({ tokenSymbol: "BAD", tokenPrice: "not-a-number" });
  const unrelated = asset({
    tokenSymbol: "MSFTx",
    underlyingTicker: "MSFT",
    tokenPrice: "100",
    referencePrice: "100"
  });
  const result = compareRepresentations([invalid, unrelated]);
  assert.deepEqual(result, []);
});


test("upcomingEarnings requests the Binance Upcoming Earnings tab and ranks live BSC assets", async () => {
  const nvda = asset({ tokenSymbol: "NVDAB", platformId: "bstock", volume24H: "9000" });
  const msft = asset({ tokenSymbol: "MSFTB", platformId: "bstock", underlyingTicker: "MSFT", volume24H: "1000" });
  const market = new HandeloMarketClient("test-key", "test-secret");
  let requestedTab: number | undefined;
  market.tokens = async (tabId?: number) => { requestedTab = tabId; return [msft, nvda]; };
  const result = await market.upcomingEarnings(2);
  assert.equal(requestedTab, 3);
  assert.deepEqual(result.map(item => item.tokenSymbol), ["NVDAB", "MSFTB"]);
});
