import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync=promisify(execFile);
export const BAW_COMMAND=process.platform==="win32"?"baw.cmd":"baw";
export const BAW_SHELL=process.platform==="win32";

export interface EvmTransaction{from:string;to:string;value:string;data?:string;}
export interface SimulationResult{status:string;failReason:string|null;balanceChanges:Array<{contractAddress:string;tokenType:string;change:string;owner:string}>;allowanceChanges:Array<{tokenAddress:string;owner:string;spender:string;preAmount:string;postAmount:string}>;}
export interface ExecutionAdapter{simulate(tx:EvmTransaction):Promise<SimulationResult>;execute(tx:EvmTransaction):Promise<{txHash:string}>;}

export interface WalletSwapRequest{
  fromTokenQty:string;
  fromToken:string;
  toToken:string;
  binanceChainId:"56";
  slippage?:string;
  mev?:boolean;
  gasLevel?:"LOW"|"MEDIUM"|"HIGH";
}
export interface WalletQuote{fromCoinSymbol:string;fromCoinAmount:string;toCoinSymbol:string;toCoinAmount:string;slippage:number;}
export interface WalletOrder{orderId:string;status:"PENDING"|"FINISHED"|"FAILED";txHash:string|null;toCoinAmount?:string;}
interface BawEnvelope<T>{success:boolean;data:T;message?:string;code?:string|number;}
interface MarketOrderStatus{orderId:string;status:"PENDING"|"FINISHED"|"FAILED";txHash:string|null;toCoinActualQty?:string;}
interface MarketOrderList{list:MarketOrderStatus[];}

async function baw<T>(args:string[]):Promise<T>{
  try{
    const {stdout,stderr}=await execFileAsync(BAW_COMMAND,[...args,"--json"],{maxBuffer:1024*1024,shell:BAW_SHELL});
    const raw=(stdout||stderr).trim();
    const payload=JSON.parse(raw) as BawEnvelope<T>;
    if(!payload.success) throw new Error(payload.message??"Binance Agentic Wallet command failed.");
    return payload.data;
  }catch(error){
    if(error instanceof SyntaxError) throw new Error("Binance Agentic Wallet returned non-JSON output.");
    const message=error instanceof Error?error.message:String(error);
    if(message.includes("ENOENT")) throw new Error("Binance Agentic Wallet CLI (baw) is not installed or is not on PATH.");
    throw new Error(message);
  }
}

export interface TokenAudit {
  hasResult:boolean;
  isSupported:boolean;
  riskLevel?:number;
  riskLevelEnum?:"LOW"|"MEDIUM"|"HIGH";
  extraInfo?:{buyTax?:string;sellTax?:string;isVerified?:boolean};
  riskItems?:unknown[];
}

export function normalizeTokenAudit(audit:TokenAudit):TokenAudit{
  if(audit.hasResult && audit.isSupported) return audit;
  return {
    hasResult:audit.hasResult,
    isSupported:audit.isSupported
  };
}

export const TOKEN_AUDIT_HEADERS={
  "content-type":"application/json",
  "source":"agent",
  "accept-encoding":"identity",
  "user-agent":"binance-web3/1.4 (Skill)"
} as const;

export async function auditToken(chainId:string,contractAddress:string):Promise<TokenAudit>{
  const response=await fetch("https://web3.binance.com/bapi/defi/v1/public/wallet-direct/security/token/audit",{
    method:"POST",
    headers:TOKEN_AUDIT_HEADERS,
    body:JSON.stringify({binanceChainId:chainId,contractAddress,requestId:randomUUID()})
  });
  const payload=await response.json() as {
    code:string|number;
    data:TokenAudit;
    success:boolean;
    message?:string;
  };
  if(!response.ok||!payload.success) throw new Error(payload.message??"Token security audit failed.");
  return payload.data;
}

export class BinanceAgenticWalletAdapter{
  async quote(request:WalletSwapRequest):Promise<WalletQuote>{
    return baw<WalletQuote>([
      "market-order","quote",
      "--fromTokenQty",request.fromTokenQty,
      "--fromToken",request.fromToken,
      "--toToken",request.toToken,
      "--binanceChainId",request.binanceChainId,
      ...(request.slippage?["--slippage",request.slippage]:[])
    ]);
  }

  async execute(request:WalletSwapRequest,confirmed:boolean):Promise<WalletOrder>{
    if(!confirmed) throw new Error("Execution requires explicit user confirmation.");

    const audit=await auditToken(request.binanceChainId,request.toToken);
    if(!audit.hasResult||!audit.isSupported){
      throw new Error("Token security audit data is unavailable for the requested token; execution is blocked.");
    }

    if(typeof audit.riskLevel === "number" && audit.riskLevel >= 4){
      throw new Error(`Token security audit returned ${audit.riskLevelEnum ?? "HIGH"} risk (level ${audit.riskLevel}); execution is blocked.`);
    }

    const wallet = await baw<{status:"CONNECTED"|"UNCONNECTED"|"CREATING"}>(["wallet","status"]);
    if(wallet.status !== "CONNECTED"){
      throw new Error(`Binance Agentic Wallet is not connected (status: ${wallet.status}). Execution is blocked.`);
    }

    const order=await baw<{orderId:string}>([
      "market-order","swap",
      "--fromTokenQty",request.fromTokenQty,
      "--fromToken",request.fromToken,
      "--toToken",request.toToken,
      "--binanceChainId",request.binanceChainId,
      ...(request.slippage?["--slippage",request.slippage]:[]),
      ...(request.mev===undefined?[]:["--mev",String(request.mev)]),
      ...(request.gasLevel?["--gasLevel",request.gasLevel]:[])
    ]);

    for(let i=0;i<10;i++){
      await new Promise(resolve=>setTimeout(resolve,3000));
      const result=await baw<MarketOrderList>([
        "market-order","list",
        "--orderId",order.orderId,
        "--binanceChainId",request.binanceChainId
      ]);
      const current=result.list?.[0];
      if(!current) continue;
      if(current.status==="FINISHED"){
        return {orderId:current.orderId,status:current.status,txHash:current.txHash,toCoinAmount:current.toCoinActualQty};
      }
      if(current.status==="FAILED"){
        return {orderId:current.orderId,status:current.status,txHash:current.txHash};
      }
    }

    return {orderId:order.orderId,status:"PENDING",txHash:null};
  }
}

export class BinanceSimulationAdapter implements ExecutionAdapter{
  constructor(private readonly apiKey:string,private readonly secretKey:string){}
  async simulate(_tx:EvmTransaction):Promise<SimulationResult>{
    throw new Error("Use the Binance Agentic Wallet quote path for execution review; direct transaction simulation remains a separate safety service.");
  }
  async execute(_tx:EvmTransaction):Promise<{txHash:string}>{
    throw new Error("Direct execution is disabled; use BinanceAgenticWalletAdapter.");
  }
}

export * from "./wallet-context.js";

export * from "./bnb-agent-provider.js";

export * from "./wallet-provider.js";
