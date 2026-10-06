export type PolicyDecision="READY"|"CONFIRM"|"BLOCK";
export interface PolicyInput{
  action:"research"|"buy"|"sell"|"invest";
  amountUsd:number|null;
  marketOpen:boolean;
  premiumPct:number|null;
  maxSpendUsd?:number;
  maxPremiumPct?:number;
}
export interface PolicyResult{decision:PolicyDecision;reasons:string[];checks:{name:string;passed:boolean;detail:string}[];}

export function evaluatePolicy(input:PolicyInput):PolicyResult{
  const maxSpend=input.maxSpendUsd??100;
  const maxPremium=input.maxPremiumPct??5;
  const checks:PolicyResult["checks"]=[];
  if(input.action==="research") return {decision:"READY",reasons:["Research does not move funds."],checks:[{name:"funds",passed:true,detail:"No transaction requested."}]};
  const amount=input.amountUsd??0;
  const spendOk=amount>0&&amount<=maxSpend;
  checks.push({name:"spend_limit",passed:spendOk,detail:spendOk?"Requested amount is within the configured demo limit.":"Amount is missing or exceeds the configured limit."});
  if(!spendOk) return {decision:"BLOCK",reasons:["The requested amount is outside Handelo's configured spending limit."],checks};
  const marketOk=input.marketOpen;
  checks.push({name:"market_state",passed:marketOk,detail:marketOk?"Reference market is open.":"Reference market is closed; on-chain trading may continue against a stale reference."});
  if(!marketOk) return {decision:"CONFIRM",reasons:["The reference market is closed, so the latest reference price may be stale."],checks};
  if(input.premiumPct!==null){
    const priceOk=Math.abs(input.premiumPct)<=maxPremium;
    checks.push({name:"reference_gap",passed:priceOk,detail:priceOk?"On-chain/reference gap is within the configured threshold.":"On-chain/reference gap exceeds the configured threshold."});
    if(!priceOk) return {decision:"CONFIRM",reasons:["The on-chain/reference price gap is larger than the configured threshold."],checks};
  } else {
    checks.push({name:"reference_gap",passed:false,detail:"Reference gap could not be calculated."});
    return {decision:"CONFIRM",reasons:["The reference price is unavailable, so Handelo cannot verify the on-chain/reference price gap."],checks};
  }
  return {decision:"READY",reasons:["Policy checks passed for a reviewable transaction."],checks};
}


export function executionAction(action:PolicyInput["action"]):"buy"|null{
  return action==="buy"||action==="invest" ? "buy" : null;
}
