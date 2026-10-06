import assert from "node:assert/strict"; import test from "node:test";
import {createAgentWalletContext,DEFAULT_AGENT_POLICY} from "./wallet-context.js";
import {assertLiveWalletExecutionContext,createDemoExecutionNotice,DEMO_MODE_DISCLOSURE} from "./wallet-mode.js";
const owner="0x1111111111111111111111111111111111111111"; const agent="0x2222222222222222222222222222222222222222";
test("demo execution notice explicitly marks actions as simulated",()=>{const notice=createDemoExecutionNotice();assert.equal(notice.mode,"DEMO");assert.equal(notice.simulated,true);assert.equal(notice.disclosure,DEMO_MODE_DISCLOSURE);});
test("live execution rejects Demo Mode",()=>{const context=createAgentWalletContext("DEMO",{address:agent,network:"BSC"},owner,100,DEFAULT_AGENT_POLICY);assert.throws(()=>assertLiveWalletExecutionContext(context),/Demo Mode/);});
test("live execution accepts only an active USER agent context",()=>{const context=createAgentWalletContext("USER",{address:agent,network:"BSC"},owner,100,DEFAULT_AGENT_POLICY);assert.equal(assertLiveWalletExecutionContext(context).address,agent);});
test("live execution rejects personal wallet contexts",()=>{const context={mode:"USER" as const,role:"PERSONAL" as const,address:owner,network:"BSC" as const,connected:true,balanceUsd:100};assert.throws(()=>assertLiveWalletExecutionContext(context),/AGENT wallet context/);});
test("live execution rejects paused, revoked, and unavailable agents",()=>{for(const status of ["PAUSED","REVOKED","UNAVAILABLE"] as const){const context=createAgentWalletContext("USER",{address:agent,network:"BSC"},owner,100,DEFAULT_AGENT_POLICY,status);assert.throws(()=>assertLiveWalletExecutionContext(context),/active agent wallet/);}});
