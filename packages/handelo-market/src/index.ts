import { createHmac, randomUUID } from "node:crypto";
import type { MarketInsight } from "@handelo/core";

export interface TokenBalance { assetId:string; wallet:string; rawBalance:string; decimals:number; }
export interface WalletTransaction {
  binanceChainId:string; txHash:string; txTime:string; amount:string; symbol:string;
  txStatus:string; tokenContractAddress:string; from:string[]; to:string[];
}

export interface RwaAsset {
  binanceChainId:string; tokenContractAddress:string; platformId:string;
  tokenSymbol:string; decimals:string; underlyingTicker:string; underlyingName:string;
  tokenToShareRatio:string; tokenPrice:string; referencePrice:string;
  volume24H:string; marketCap:string;
  statusInfo:{openState:boolean;marketStatus:string;reasonCode:string;reasonMsg:string|null;nextOpenTime:number|null;nextCloseTime:number|null};
}

interface Envelope<T>{code:number;msg:string;data:T;timestamp:number;success:boolean}

export class MarketResolutionError extends Error {
  constructor(public readonly kind:"NOT_FOUND"|"AMBIGUOUS", message:string){
    super(message);
    this.name="MarketResolutionError";
  }
}

export class MarketUpstreamError extends Error {
  constructor(message:string){
    super(message);
    this.name="MarketUpstreamError";
  }
}

export function normalizeTransactionLimit(limit:number):number{
  if(!Number.isFinite(limit)) return 20;
  return Math.min(Math.max(Math.floor(limit),1),100);
}

export function normalizeTransactions(transactions:WalletTransaction[]):WalletTransaction[]{
  const seen=new Set<string>();
  return transactions.filter(tx=>{
    if(tx.binanceChainId!=="56") return false;
    const hash=tx.txHash.trim().toLowerCase();
    if(!hash||seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

export function isExecutableMarketAsset(asset:RwaAsset):boolean{
  const tokenPrice=Number(asset.tokenPrice);
  return asset.binanceChainId==="56"
    && /^0x[a-fA-F0-9]{40}$/.test(asset.tokenContractAddress)
    && Number.isFinite(tokenPrice)
    && tokenPrice>0;
}

const BASE="https://web3.binance.com/build";

export class HandeloMarketClient {
  constructor(private readonly apiKey:string,private readonly secretKey:string){
    if(!apiKey||!secretKey) throw new Error("BINANCE_WEB3_API_KEY and BINANCE_WEB3_SECRET_KEY are required.");
  }
  private async request<T>(method:"GET"|"POST",path:string,body?:unknown,params?:Record<string,string>):Promise<T>{
    const query=params ? new URLSearchParams(params).toString() : "";
    const fullPath=query ? `${path}?${query}` : path;
    const payload=body===undefined ? "" : JSON.stringify(body);
    const timestamp=new Date().toISOString(),nonce=randomUUID();
    const signature=createHmac("sha256",this.secretKey).update(timestamp+method+"/build"+fullPath+payload).digest("base64");
    const response=await fetch(BASE+fullPath,{method,headers:{"X-OC-APIKEY":this.apiKey,"X-OC-TIMESTAMP":timestamp,"X-OC-SIGN":signature,"X-OC-RECV-WINDOW":"5000","X-OC-NONCE":nonce,"content-type":"application/json"},...(body===undefined?{}:{body:payload})});
    const envelope=await response.json() as Envelope<T>;
    if(!response.ok||!envelope.success||envelope.code!==0) throw new MarketUpstreamError(`Binance Web3 API error ${response.status}/${envelope.code}: ${envelope.msg}`);
    return envelope.data;
  }
  async search(ticker:string):Promise<Array<{ticker:string;companyName:string;assets:Array<{platformId:string;binanceChainId:string;tokenContractAddress:string;tokenSymbol:string;assetType:number}>}>>{
    return this.request("GET","/api/v1/dex/market/rwa/search",undefined,{keyword:ticker});
  }
  async tokens():Promise<RwaAsset[]>{
    return this.request("GET","/api/v1/dex/market/rwa/tokens",undefined,{binanceChainId:"56"}) as Promise<RwaAsset[]>;
  }
  async tokenBalance(wallet:string,assetId:string):Promise<TokenBalance>{
    if(!/^0x[0-9a-fA-F]{40}$/.test(wallet)||!/^0x[0-9a-fA-F]{40}$/.test(assetId)) throw new Error("Invalid EVM wallet or token contract address.");
    const data=await this.request<Array<{tokenAssets:Array<{binanceChainId:string;tokenContractAddress:string;address:string;rawBalance:string}>}>>("POST","/api/v1/dex/balance/token-balances-by-address",{address:wallet,tokenContractAddresses:[{binanceChainId:"56",tokenContractAddress:assetId}]});
    const asset=data.flatMap(group=>group.tokenAssets).find(x=>x.binanceChainId==="56"&&x.tokenContractAddress.toLowerCase()===assetId.toLowerCase()&&x.address.toLowerCase()===wallet.toLowerCase());
    return {assetId,wallet,rawBalance:asset?.rawBalance??"0",decimals:18};
  }

  async tokenBalances(wallet:string,assetIds:string[]):Promise<Map<string,string>>{
    if(!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Error("Invalid EVM wallet address.");
    const balances=new Map<string,string>();
    for(let start=0;start<assetIds.length;start+=20){
      const chunk=assetIds.slice(start,start+20);
      const addresses=chunk.map(assetId=>{
        if(!/^0x[0-9a-fA-F]{40}$/.test(assetId)) throw new Error("Invalid token contract address.");
        return {binanceChainId:"56",tokenContractAddress:assetId};
      });
      const data=await this.request<Array<{tokenAssets:Array<{binanceChainId:string;tokenContractAddress:string;address:string;rawBalance:string}>}>>("POST","/api/v1/dex/balance/token-balances-by-address",{address:wallet,tokenContractAddresses:addresses});
      for(const asset of data.flatMap(group=>group.tokenAssets)){
        balances.set(asset.tokenContractAddress.toLowerCase(),asset.rawBalance||"0");
      }
    }
    return balances;
  }
  async transactions(wallet:string,limit=20):Promise<WalletTransaction[]>{
    if(!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Error("Invalid EVM wallet address.");
    const data=await this.request<Array<{transactionList:Array<{
      binanceChainId:string;txHash:string;txTime:string;amount:string;symbol:string;
      txStatus:string;tokenContractAddress:string;from:Array<{address:string}>;to:Array<{address:string}>;
    }>}>>("GET","/api/v1/dex/post-transaction/transactions-by-address",undefined,{
      address:wallet,chains:"56",limit:String(normalizeTransactionLimit(limit))
    });
    return normalizeTransactions(data.flatMap(group=>group.transactionList).map(tx=>({
      binanceChainId:tx.binanceChainId,txHash:tx.txHash,txTime:tx.txTime,amount:tx.amount,symbol:tx.symbol,
      txStatus:tx.txStatus,tokenContractAddress:tx.tokenContractAddress,
      from:tx.from.map(item=>item.address),to:tx.to.map(item=>item.address)
    })));
  }

  async discover(limit=8):Promise<RwaAsset[]>{
    const all=await this.tokens();
    return all.filter(x=>x.binanceChainId==="56"&&x.underlyingTicker).sort((a,b)=>Number(b.volume24H)-Number(a.volume24H)).slice(0,limit);
  }
  async findAll(ticker:string):Promise<RwaAsset[]>{
    const query=ticker.trim();
    const results=await this.search(query);
    const assets=results.flatMap(x=>x.assets).filter(x=>x.binanceChainId==="56");
    if(!assets.length) throw new MarketResolutionError("NOT_FOUND",`No BSC tokenized-stock representation found for ${query}.`);
    const all=await this.tokens();
    const contracts=new Set(assets.map(asset=>asset.tokenContractAddress.toLowerCase()));
    const normalizedTicker=query.toLowerCase();
    const matches=all.filter(
      asset =>
        contracts.has(asset.tokenContractAddress.toLowerCase()) &&
        asset.underlyingTicker.trim().toLowerCase()===normalizedTicker
    );
    const unique=new Map(matches.map(asset=>[asset.tokenContractAddress.toLowerCase(),asset]));
    if(!unique.size) throw new MarketResolutionError("NOT_FOUND",`No live BSC tokenized-stock market record found for ${query}.`);
    return [...unique.values()];
  }

  async find(ticker:string):Promise<RwaAsset>{
    const query=ticker.trim();
    const exactToken= (await this.tokens()).filter(
      asset => asset.binanceChainId==="56" && asset.tokenSymbol.trim().toLowerCase()===query.toLowerCase()
    );
    if(exactToken.length===1) return exactToken[0];
    const matches=await this.findAll(query);
    const exact=matches.filter(x=>x.tokenSymbol.toLowerCase()===ticker.trim().toLowerCase());
    if(exact.length===1) return exact[0];
    if(matches.length>1) throw new MarketResolutionError("AMBIGUOUS",`Multiple BSC tokenized-stock representations found for ${ticker}: ${matches.map(x=>x.tokenSymbol+" ("+x.platformId+")").join(", ")}. Resolve the representation before trading.`);
    return matches[0];
  }
}

export function toMarketInsight(asset:RwaAsset):MarketInsight{
  const onChainPrice=Number(asset.tokenPrice);
  const referencePrice=Number(asset.referencePrice);
  const validOnChain=Number.isFinite(onChainPrice)&&onChainPrice>=0;
  const validReference=Number.isFinite(referencePrice)&&referencePrice>0;
  return {
    underlyingTicker:asset.underlyingTicker,
    tokenSymbol:asset.tokenSymbol,
    provider:asset.platformId,
    onChainPrice:validOnChain?onChainPrice:null,
    referencePrice:validReference?referencePrice:null,
    divergencePercent:validOnChain&&validReference
      ? ((onChainPrice-referencePrice)/referencePrice)*100
      : null,
    marketStatus:asset.statusInfo?.openState===true
      ?"OPEN"
      :asset.statusInfo?.openState===false
        ?"CLOSED"
        :"UNKNOWN",
    nextOpenAt:asset.statusInfo?.nextOpenTime
      ?new Date(asset.statusInfo.nextOpenTime).toISOString()
      :null,
    liquidityContext:asset.volume24H
      ?`24h volume ${asset.volume24H}`
      :null
  };
}

export function rankGapRadarAssets(assets:RwaAsset[]):RwaAsset[]{
  return [...assets].sort((a,b)=>{
    const ad=Math.abs(Number(a.referencePrice)>0
      ?(Number(a.tokenPrice)-Number(a.referencePrice))/Number(a.referencePrice)
      :0);
    const bd=Math.abs(Number(b.referencePrice)>0
      ?(Number(b.tokenPrice)-Number(b.referencePrice))/Number(b.referencePrice)
      :0);
    return bd-ad;
  });
}

export function marketClientFromEnv(){
  return new HandeloMarketClient(process.env.BINANCE_WEB3_API_KEY?.trim()??"",process.env.BINANCE_WEB3_SECRET_KEY?.trim()??"");
}


export interface RepresentationComparison {
  underlyingTicker: string;
  representations: Array<{
    platformId: string;
    tokenSymbol: string;
    tokenPrice: number;
    referencePrice: number;
    divergencePercent: number;
  }>;
  lowestPriceToken: string;
  highestPriceToken: string;
  spreadPercent: number;
}

export function compareRepresentations(assets: RwaAsset[]): RepresentationComparison[] {
  const groups = new Map<string, RwaAsset[]>();
  for (const asset of normalizeAssets(assets)) {
    const ticker = asset.underlyingTicker.trim().toUpperCase();
    const tokenPrice = Number(asset.tokenPrice);
    const referencePrice = Number(asset.referencePrice);
    if (!ticker || !Number.isFinite(tokenPrice) || tokenPrice <= 0 || !Number.isFinite(referencePrice) || referencePrice <= 0) continue;
    const group = groups.get(ticker) ?? [];
    group.push(asset);
    groups.set(ticker, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([underlyingTicker, group]) => {
      const representations = group
        .map(item => {
          const tokenPrice = Number(item.tokenPrice);
          const referencePrice = Number(item.referencePrice);
          return {
            platformId: item.platformId,
            tokenSymbol: item.tokenSymbol,
            tokenPrice,
            referencePrice,
            divergencePercent: ((tokenPrice - referencePrice) / referencePrice) * 100
          };
        })
        .sort((a, b) => a.tokenPrice - b.tokenPrice);

      const lowest = representations[0];
      const highest = representations[representations.length - 1];
      if (!lowest || !highest) throw new Error("Representation comparison requires at least two valid prices.");
      return {
        underlyingTicker,
        representations,
        lowestPriceToken: lowest.tokenSymbol,
        highestPriceToken: highest.tokenSymbol,
        spreadPercent: ((highest.tokenPrice - lowest.tokenPrice) / lowest.tokenPrice) * 100
      };
    });
}
