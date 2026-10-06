import test from "node:test";
import assert from "node:assert/strict";
import { HandeloPortfolio, calculatePortfolioPnl, portfolioAssets } from "./index.js";
import type { RwaAsset } from "@handelo/market";

const asset=(overrides:Partial<RwaAsset>={}):RwaAsset=>({
  binanceChainId:"56", tokenContractAddress:"0x1111111111111111111111111111111111111111",
  platformId:"demo", tokenSymbol:"NVDA", decimals:"18", underlyingTicker:"NVDA", underlyingName:"NVIDIA",
  tokenToShareRatio:"1", tokenPrice:"180", referencePrice:"180", volume24H:"1000", marketCap:"1000000",
  statusInfo:{openState:true,marketStatus:"OPEN",reasonCode:"",reasonMsg:null,nextOpenTime:null,nextCloseTime:null}, ...overrides
});

test("portfolio asset normalization keeps only valid unique BSC assets",()=>{
  const result=portfolioAssets([asset(),asset({tokenSymbol:"NVDA-2"}),asset({tokenContractAddress:"0x2222222222222222222222222222222222222222",tokenSymbol:"AAPL",underlyingTicker:"AAPL"}),asset({tokenContractAddress:"bad"}),asset({decimals:"-1"}),asset({tokenPrice:"not-a-number"}),asset({binanceChainId:"1"})]);
  assert.equal(result.length,2); assert.deepEqual(result.map(x=>x.tokenSymbol),["NVDA","AAPL"]);
});
test("portfolio asset normalization allows zero price but rejects invalid metadata",()=>{
  const result=portfolioAssets([asset({tokenPrice:"0"}),asset({decimals:"256",tokenContractAddress:"0x2222222222222222222222222222222222222222"})]);
  assert.equal(result.length,1); assert.equal(result[0].tokenPrice,"0");
});
test("portfolio snapshot reconciles live token balances and records provenance",async()=>{
  const liveAsset=asset({tokenPrice:"180"});
  const market={tokens:async()=>[liveAsset],tokenBalances:async()=>new Map([[liveAsset.tokenContractAddress.toLowerCase(),"2000000000000000000"]]),tokenBalance:async()=>({assetId:"0x55d398326f99059fF775485246999027B3195",wallet:"0x2222222222222222222222222222222222222222",rawBalance:"15000000000000000000",decimals:18})} as unknown as ConstructorParameters<typeof HandeloPortfolio>[0];
  const snapshot=await new HandeloPortfolio(market).snapshot("0x2222222222222222222222222222222222222222");
  assert.equal(snapshot.wallet,"0x2222222222222222222222222222222222222222"); assert.equal(snapshot.positions.length,1);
  assert.equal(snapshot.positions[0]?.balance,"2000000000000000000"); assert.equal(snapshot.totalEstimatedValueUsd,360); assert.equal(snapshot.balanceUsd,15);
  assert.equal(snapshot.source,"BSC_TOKEN_BALANCES"); assert.ok(snapshot.asOf); assert.ok(!Number.isNaN(Date.parse(snapshot.asOf)));
});
test("portfolio P&L calculates unrealized gain from explicit cost-basis lots",()=>{
  const result=calculatePortfolioPnl([{ticker:"NVDA",tokenSymbol:"NVDA",contract:"0x1111111111111111111111111111111111111111",balance:"2000000000000000000",estimatedValueUsd:360,tokenPrice:"180",provider:"demo",decimals:18}],[
    {asset:"NVDA",quantity:1,unitCostUsd:150,acquiredAt:"2026-10-01T00:00:00.000Z"},
    {asset:"NVDA",quantity:1,unitCostUsd:160,acquiredAt:"2026-10-02T00:00:00.000Z"}
  ]);
  assert.equal(result.totalMarketValueUsd,360); assert.equal(result.totalCostBasisUsd,310); assert.equal(result.unrealizedPnlUsd,50);
  assert.equal(result.unrealizedPnlPercent,50/310*100);
});
test("portfolio P&L fails closed on malformed cost-basis records",()=>{
  assert.throws(()=>calculatePortfolioPnl([], [{asset:"NVDA",quantity:1,unitCostUsd:-1,acquiredAt:"2026-10-01T00:00:00.000Z"}]), /valid asset, quantity, unit cost/);
});
