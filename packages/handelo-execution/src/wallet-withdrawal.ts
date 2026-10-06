import type { AgentWalletContext } from "@handelo/core";

const EVM_WALLET=/^0x[a-fA-F0-9]{40}$/;

export interface AgentWalletWithdrawalRequest {
  agentWallet:string; personalWallet:string; amount:string; tokenAddress:string;
  userApproved:boolean; approvalReference:string;
}
export interface AgentWalletWithdrawalAuthorization {
  status:"AUTHORIZED"; from:string; to:string; amount:string; tokenAddress:string;
  network:"BSC"; approvalReference:string; requiresProviderExecution:true; onChain:false;
}
function assertWallet(label:string,value:string):void {
  if(!EVM_WALLET.test(value.trim())) throw new Error(label+" must be a valid EVM wallet address.");
}
export function authorizeAgentWalletWithdrawal(context:AgentWalletContext,request:AgentWalletWithdrawalRequest):AgentWalletWithdrawalAuthorization {
  assertWallet("Withdrawal agent wallet",request.agentWallet);
  assertWallet("Withdrawal personal wallet",request.personalWallet);
  if(context.mode!=="USER"||context.role!=="AGENT") throw new Error("Agent wallet withdrawal requires USER-mode agent wallet context.");
  if(!context.connected||context.network!=="BSC"||context.status!=="ACTIVE") throw new Error("Agent wallet withdrawal requires a connected active BSC agent wallet.");
  const contextAgent=context.address?.trim().toLowerCase(); const contextOwner=context.ownerWallet?.trim().toLowerCase();
  if(contextAgent!==request.agentWallet.trim().toLowerCase()||contextOwner!==request.personalWallet.trim().toLowerCase()) throw new Error("Withdrawal request does not match the connected BNB wallet context.");
  if(!request.userApproved) throw new Error("Agent wallet withdrawal requires explicit user approval.");
  if(!request.approvalReference.trim()) throw new Error("Agent wallet withdrawal requires an approval reference.");
  if(!request.tokenAddress.trim()) throw new Error("Withdrawal token address is required.");
  if(!request.amount.trim()||Number(request.amount)<=0||!Number.isFinite(Number(request.amount))) throw new Error("Withdrawal amount must be a finite positive value.");
  return {status:"AUTHORIZED",from:request.agentWallet.trim(),to:request.personalWallet.trim(),amount:request.amount.trim(),tokenAddress:request.tokenAddress.trim(),network:"BSC",approvalReference:request.approvalReference.trim(),requiresProviderExecution:true,onChain:false};
}
