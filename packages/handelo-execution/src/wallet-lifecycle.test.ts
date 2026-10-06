import assert from "node:assert/strict"; import test from "node:test";
import {createAgentWalletContext,DEFAULT_AGENT_POLICY} from "./wallet-context.js"; import {transitionAgentWallet} from "./wallet-lifecycle.js";
const owner="0x1111111111111111111111111111111111111111"; const agent="0x2222222222222222222222222222222222222222";
function ctx(status:"ACTIVE"|"PAUSED"|"REVOKED"="ACTIVE"){return createAgentWalletContext("USER",{address:agent,network:"BSC"},owner,20,DEFAULT_AGENT_POLICY,status);}
test("configures an active lifecycle with an explicit revocable policy",()=>{const r=transitionAgentWallet(ctx("PAUSED"),"CONFIGURE",{...DEFAULT_AGENT_POLICY,maxTransactionUsd:7});assert.equal(r.status,"ACTIVE");assert.equal(r.policy.maxTransactionUsd,7);});
test("pause and resume are deterministic and fail closed",()=>{const paused=transitionAgentWallet(ctx(),"PAUSE");assert.equal(paused.status,"PAUSED");assert.equal(transitionAgentWallet(paused,"RESUME").status,"ACTIVE");assert.throws(()=>transitionAgentWallet(ctx(),"RESUME"),/Only a paused/);});
test("revoke is terminal",()=>{const revoked=transitionAgentWallet(ctx(),"REVOKE");assert.equal(revoked.status,"REVOKED");assert.throws(()=>transitionAgentWallet(revoked,"CONFIGURE",DEFAULT_AGENT_POLICY),/Revoked/);assert.throws(()=>transitionAgentWallet(revoked,"REVOKE"),/already revoked/);});
test("configuration cannot enable a non-revocable policy",()=>{assert.throws(()=>transitionAgentWallet(ctx("PAUSED"),"CONFIGURE",{...DEFAULT_AGENT_POLICY,revocable:false}),/revocable policy/);});
test("lifecycle rejects a non-user context",()=>{assert.throws(()=>transitionAgentWallet({...ctx(),mode:"DEMO" as const},"PAUSE"),/USER-mode agent wallet context/);});
test("lifecycle rejects a non-BSC context",()=>{assert.throws(()=>transitionAgentWallet({...ctx(),network:"ETH" as never},"PAUSE"),/connected BSC agent wallet/);});
test("lifecycle rejects a disconnected context",()=>{assert.throws(()=>transitionAgentWallet({...ctx(),connected:false},"PAUSE"),/connected BSC agent wallet/);});
test("lifecycle rejects an unavailable context",()=>{assert.throws(()=>transitionAgentWallet({...ctx("ACTIVE"),status:"UNAVAILABLE" as const},"PAUSE"),/Unavailable agent wallet/);});
