import type { AgentWalletContext, AgentWalletPolicy } from "@handelo/core";

export type AgentWalletLifecycleAction = "CONFIGURE" | "PAUSE" | "RESUME" | "REVOKE";

export function transitionAgentWallet(context:AgentWalletContext,action:AgentWalletLifecycleAction,policy?:AgentWalletPolicy):AgentWalletContext {
  if(context.mode!=="USER"||context.role!=="AGENT") throw new Error("Agent wallet lifecycle requires USER-mode agent wallet context.");
  if(!context.connected||context.network!=="BSC") throw new Error("Agent wallet lifecycle requires a connected BSC agent wallet.");
  if(context.status==="UNAVAILABLE") throw new Error("Unavailable agent wallet cannot enter an active lifecycle.");
  if(action==="CONFIGURE"){
    if(context.status==="REVOKED") throw new Error("Revoked agent wallet cannot be configured.");
    if(!policy) throw new Error("Agent wallet configuration requires an explicit policy.");
    if(!policy.revocable) throw new Error("Agent wallet lifecycle requires a revocable policy.");
    return {...context,policy,status:"ACTIVE"};
  }
  if(action==="PAUSE"){
    if(context.status!=="ACTIVE") throw new Error("Only an active agent wallet can be paused.");
    return {...context,status:"PAUSED"};
  }
  if(action==="RESUME"){
    if(context.status!=="PAUSED") throw new Error("Only a paused agent wallet can be resumed.");
    if(context.policy.expiresAt && Date.parse(context.policy.expiresAt)<=Date.now()) throw new Error("Expired agent wallet policy cannot be resumed.");
    return {...context,status:"ACTIVE"};
  }
  if(action==="REVOKE"){
    if(!context.policy.revocable) throw new Error("Agent wallet policy is not revocable.");
    if(context.status==="REVOKED") throw new Error("Agent wallet is already revoked.");
    return {...context,status:"REVOKED"};
  }
  throw new Error(`Unsupported agent wallet lifecycle action: ${action}`);
}
