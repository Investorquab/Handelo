import test from "node:test";
import assert from "node:assert/strict";
import { HandeloAgent, normalizeUserMessage, validateAgentResponse, validateUserIntent } from "./index.js";
import type { LlmClient } from "@handelo/llm";
import type { HandeloMarketClient } from "@handelo/market";

const asset={
  binanceChainId:"56",tokenContractAddress:"0x0000000000000000000000000000000000000001",
  platformId:"ondo",tokenSymbol:"NVDAon",decimals:"18",underlyingTicker:"NVDA",underlyingName:"NVIDIA",
  tokenToShareRatio:"1",tokenPrice:"120",referencePrice:"125",volume24H:"1000",marketCap:"1000000",
  statusInfo:{openState:false,marketStatus:"closed",reasonCode:"MARKET_CLOSED",reasonMsg:"US market closed",nextOpenTime:null,nextCloseTime:null}
};

test("Handelo resolves live market context before generating its explanation",async()=>{
  let calls=0;
  const llm:LlmClient={
    provider:"groq",model:"openai/gpt-oss-120b",
    async generateJson<T>(request:{system:string;user:string;schemaName:string;schema:Record<string,unknown>}):Promise<T>{
      calls++;
      if(request.schemaName==="handelo_intent") return {action:"research",ticker:"NVDA",amountUsd:20,horizon:null,riskTolerance:"unknown",strategyType:null,frequency:null,condition:null} as T;
      return {answer:"NVDA's latest tokenized price is below the latest reference price, and the traditional market is closed."} as T;
    }
  };
  const market={findAll:async()=>[asset]} as unknown as HandeloMarketClient;
  const result=await new HandeloAgent({llmClient:llm,marketClient:market}).run("What is happening with NVIDIA?");
  assert.equal(calls,2);
  assert.equal(result.intent.ticker,"NVDA");
  assert.equal(result.market?.marketOpen,false);
  assert.equal(result.market?.premiumPct,-4);
  assert.equal(result.marketInsight?.tokenSymbol,"NVDAon");
  assert.equal(result.marketInsight?.divergencePercent,-4);
  assert.match(result.answer,/reference price/);
});


test("Handelo contains unresolved market errors without inventing market context",async()=>{
  const llm:LlmClient={
    provider:"groq",model:"test",
    async generateJson<T>(request:{system:string;user:string;schemaName:string;schema:Record<string,unknown>}):Promise<T>{
      if(request.schemaName==="handelo_intent") return {action:"research",ticker:"UNKNOWN",amountUsd:null,horizon:null,riskTolerance:"unknown",strategyType:null,frequency:null,condition:null} as T;
      assert.match(request.user,/could not find a supported BSC tokenized-stock market/i);
      return {answer:"I couldn't resolve a supported tokenized-stock market for that ticker."} as T;
    }
  };
  const market={findAll:async()=>{throw new Error("upstream unavailable");}} as unknown as HandeloMarketClient;
  const result=await new HandeloAgent({llmClient:llm,marketClient:market}).run("What is UNKNOWN doing?");
  assert.equal(result.market,null);
  assert.equal(result.candidates.length,0);
  assert.equal(result.policy,null);
  assert.match(result.answer,/couldn't resolve/i);
});


test("structured intent validation rejects malformed LLM output", () => {
  assert.throws(
    () => validateUserIntent({ action: "buy", ticker: 123, amountUsd: 20, horizon: null, riskTolerance: "low", strategyType: null, frequency: null, condition: null }),
    /invalid ticker/,
  );
  assert.throws(
    () => validateUserIntent({ action: "buy", ticker: "NVDA", amountUsd: Number.NaN, horizon: null, riskTolerance: "low", strategyType: null, frequency: null, condition: null }),
    /invalid amount/,
  );
  assert.throws(
    () => validateUserIntent({ action: "unknown", ticker: null, amountUsd: null, horizon: null, riskTolerance: "low", strategyType: null, frequency: null, condition: null }),
    /invalid investment intent/,
  );
});


test("user message normalization rejects empty and oversized input", () => {
  assert.throws(() => normalizeUserMessage("   "), /message is required/);
  assert.throws(() => normalizeUserMessage("x".repeat(8001)), /message is too long/);
  assert.equal(normalizeUserMessage("  Help me understand NVDA  "), "Help me understand NVDA");
});


test("agent response validation rejects malformed provider output", () => {
  assert.throws(() => validateAgentResponse({ answer: "   " }), /invalid answer/);
  assert.throws(() => validateAgentResponse({ answer: "x".repeat(12001) }), /answer that is too long/);
  assert.deepEqual(validateAgentResponse({ answer: "  Ready.  " }), { answer: "Ready." });
});


test("explicit DCA intent becomes a deterministic draft strategy",async()=>{const llm:LlmClient={provider:"groq",model:"test",async generateJson<T>(request:any):Promise<T>{if(request.schemaName==="handelo_intent")return {action:"invest",ticker:"NVDA",amountUsd:10,horizon:null,riskTolerance:"unknown",strategyType:"DCA",frequency:"Every Monday",condition:null} as T;return {answer:"Draft prepared."} as T;}};const market={findAll:async()=>[asset]} as unknown as HandeloMarketClient;const result=await new HandeloAgent({llmClient:llm,marketClient:market}).run("Buy $10 of NVDA every Monday.");assert.equal(result.strategy?.type,"DCA");assert.equal(result.strategy?.status,"DRAFT");assert.equal(result.strategy?.frequency,"Every Monday");assert.equal(result.strategy?.amountUsd,10);});


test("agent decision trace records the operating stages without claiming execution", async () => {
  const llm: LlmClient = {
    provider: "groq",
    model: "test",
    async generateJson<T>(request: {schemaName:string;system:string;user:string;schema:Record<string,unknown>}): Promise<T> {
      if (request.schemaName === "handelo_intent") {
        return {action:"buy",ticker:"NVDA",amountUsd:20,horizon:null,riskTolerance:"medium",strategyType:null,frequency:null,condition:null} as T;
      }
      return {answer:"I found a live market context and checked the policy before presenting the action."} as T;
    }
  };
  const market = { findAll: async () => [asset] } as unknown as HandeloMarketClient;
  const result = await new HandeloAgent({llmClient:llm,marketClient:market}).run("Buy $20 of NVDA.");
  assert.deepEqual(result.trace.stages.map(stage => stage.stage), ["OBSERVED","REASONED","PROPOSED","POLICY_CHECKED"]);
  assert.equal(result.trace.stages.find(stage => stage.stage === "OBSERVED")?.status, "COMPLETE");
  assert.equal(result.trace.stages.find(stage => stage.stage === "POLICY_CHECKED")?.status, "COMPLETE");
  assert.equal(result.trace.executionReady, true);
  assert.equal(result.trace.stages.some(stage => stage.evidence.some(item => /executed|transaction happened/i.test(item))), false);
});

test("agent decision trace blocks readiness when no live market is resolved", async () => {
  const llm: LlmClient = {
    provider: "groq",
    model: "test",
    async generateJson<T>(request: {schemaName:string;system:string;user:string;schema:Record<string,unknown>}): Promise<T> {
      if (request.schemaName === "handelo_intent") {
        return {action:"buy",ticker:"UNKNOWN",amountUsd:20,horizon:null,riskTolerance:"medium",strategyType:null,frequency:null,condition:null} as T;
      }
      return {answer:"I could not resolve a supported live market."} as T;
    }
  };
  const market = { findAll: async () => { throw new Error("not found"); } } as unknown as HandeloMarketClient;
  const result = await new HandeloAgent({llmClient:llm,marketClient:market}).run("Buy $20 of UNKNOWN.");
  assert.equal(result.trace.stages.find(stage => stage.stage === "OBSERVED")?.status, "BLOCKED");
  assert.equal(result.trace.stages.find(stage => stage.stage === "POLICY_CHECKED")?.status, "BLOCKED");
  assert.equal(result.trace.executionReady, false);
});
