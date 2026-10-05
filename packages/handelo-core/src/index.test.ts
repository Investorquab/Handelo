import assert from "node:assert/strict";
import test from "node:test";
import {calculateDivergencePercent, createRiskResult, evaluatePortfolioStrategyRisk, type PortfolioSnapshot} from "./index.js";

test("calculates reference vs on-chain divergence",()=>{
  assert.equal(calculateDivergencePercent(110,100),10);
  assert.equal(calculateDivergencePercent(90,100),-10);
  assert.equal(calculateDivergencePercent(100,0),null);
});

test("risk governor blocks an oversized transaction",()=>{
  const result=createRiskResult(
    {maxTransactionUsd:10,minimumReservePercent:10},
    {proposedAmountUsd:15,projectedReservePercent:20,now:"2026-09-30T00:00:00.000Z"}
  );
  assert.equal(result.decision,"BLOCK");
  assert.equal(result.reasons.length,1);
});

test("risk governor passes when constraints are satisfied",()=>{
  const result=createRiskResult(
    {maxTransactionUsd:20,maxSingleAssetExposurePercent:35,minimumReservePercent:10},
    {proposedAmountUsd:10,projectedAssetExposurePercent:25,projectedReservePercent:20,now:"2026-09-30T00:00:00.000Z"}
  );
  assert.equal(result.decision,"PASS");
  assert.deepEqual(result.reasons,[]);
});


test("portfolio strategy risk blocks excessive projected exposure", () => {
  const portfolio: PortfolioSnapshot = {
    wallet: "0x1111111111111111111111111111111111111111",
    balanceUsd: null,
    totalValueUsd: 100,
    positions: [{ asset: "NVDAB", tokenSymbol: "NVDAB", allocationPercent: 80, valueUsd: 80 }]
  };
  const result = evaluatePortfolioStrategyRisk(portfolio, "NVDAB", 30);
  assert.equal(result.decision, "BLOCK");
  assert.match(result.reasons[0], /exposure/i);
});

test("portfolio strategy risk passes a small diversified addition", () => {
  const portfolio: PortfolioSnapshot = {
    wallet: "0x1111111111111111111111111111111111111111",
    balanceUsd: null,
    totalValueUsd: 100,
    positions: [{ asset: "NVDAB", tokenSymbol: "NVDAB", allocationPercent: 20, valueUsd: 20 }]
  };
  const result = evaluatePortfolioStrategyRisk(portfolio, "NVDAB", 10);
  assert.equal(result.decision, "PASS");
});


test("wallet contracts distinguish personal and agent execution contexts", () => {
  const personal = {
    mode: "USER" as const,
    role: "PERSONAL" as const,
    address: "0x1111111111111111111111111111111111111111",
    network: "BSC" as const,
    connected: true,
    balanceUsd: 1000
  };

  const agent = {
    mode: "USER" as const,
    role: "AGENT" as const,
    address: "0x2222222222222222222222222222222222222222",
    network: "BSC" as const,
    connected: true,
    balanceUsd: 500,
    ownerWallet: personal.address,
    status: "ACTIVE" as const,
    policy: {
      permissions: ["DCA", "REBALANCE"] as const,
      maxTransactionUsd: 50,
      maxDailySpendUsd: 200,
      minimumReservePercent: 10,
      revocable: true
    }
  };

  assert.notEqual(personal.address, agent.address);
  assert.equal(agent.ownerWallet, personal.address);
  assert.equal(agent.policy.maxTransactionUsd, 50);
  assert.equal(agent.policy.revocable, true);
});

test("agent policy can represent bounded permissions without private keys", () => {
  const policy = {
    permissions: ["DCA", "TRANSFER_OUT"] as const,
    maxTransactionUsd: 20,
    maxDailySpendUsd: 100,
    allowedAssets: ["NVDAB", "USDC"],
    revocable: true
  };

  assert.deepEqual(policy.permissions, ["DCA", "TRANSFER_OUT"]);
  assert.equal(policy.allowedAssets?.includes("NVDAB"), true);
  assert.equal(policy.maxDailySpendUsd, 100);
});
