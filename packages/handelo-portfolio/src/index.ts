import { HandeloMarketClient, marketClientFromEnv, type RwaAsset } from "@handelo/market";

export interface PortfolioPosition{
  ticker:string;tokenSymbol:string;contract:string;balance:string;estimatedValueUsd:number|null;tokenPrice:string;provider:string;
}
export interface PortfolioSnapshot{wallet:string;positions:PortfolioPosition[];totalEstimatedValueUsd:number|null;balanceUsd:number|null;source:"BSC_TOKEN_BALANCES";asOf:string;}

function normalizeAssets(assets:RwaAsset[]):RwaAsset[]{
  const seen=new Set<string>();
  return assets.filter(asset=>{
    const contract=asset.tokenContractAddress.trim().toLowerCase();
    const decimals=Number(asset.decimals);
    const price=Number(asset.tokenPrice);
    if(asset.binanceChainId!=="56"||!asset.underlyingTicker.trim()||!/^[0-9]+$/.test(asset.decimals)||!Number.isInteger(decimals)||decimals<0||decimals>255||!/^0x[0-9a-fA-F]{40}$/.test(asset.tokenContractAddress)||!Number.isFinite(price)||price<0||seen.has(contract)) return false;
    seen.add(contract);
    return true;
  });
}

function normalizeRawBalance(rawBalance:string):string{
  if(!/^\d+$/.test(rawBalance)) throw new Error("Binance returned an invalid token balance.");
  return rawBalance;
}

export function portfolioAssets(assets:RwaAsset[]):RwaAsset[]{
  return normalizeAssets(assets);
}

function position(asset:RwaAsset,balance:string):PortfolioPosition{
  const units=Number(balance)/10**Number(asset.decimals);
  const price=Number(asset.tokenPrice);
  return {ticker:asset.underlyingTicker,tokenSymbol:asset.tokenSymbol,contract:asset.tokenContractAddress,balance,estimatedValueUsd:Number.isFinite(units*price)?units*price:null,tokenPrice:asset.tokenPrice,provider:asset.platformId};
}

const DEFAULT_QUOTE_TOKEN = "0x55d398326f99059fF775485246999027B3197955";

export class HandeloPortfolio{
  constructor(
    private readonly market:HandeloMarketClient=marketClientFromEnv(),
    private readonly quoteToken:string=process.env.HANDELO_QUOTE_TOKEN?.trim()||DEFAULT_QUOTE_TOKEN
  ){}
  async snapshot(wallet:string):Promise<PortfolioSnapshot>{
    if(!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Error("Invalid EVM wallet address.");
    const assets=normalizeAssets(await this.market.tokens());
    const positions:PortfolioPosition[]=[];
    const balances=await this.market.tokenBalances(wallet,assets.map(asset=>asset.tokenContractAddress));
    for(const asset of assets){
      const rawBalance=normalizeRawBalance(balances.get(asset.tokenContractAddress.toLowerCase())??"0");
      if(BigInt(rawBalance)>0n) positions.push(position(asset,rawBalance));
    }
    const values=positions.map(p=>p.estimatedValueUsd).filter((v):v is number=>v!==null);
    const cash=await this.market.tokenBalance(wallet,this.quoteToken);
    const rawCash=normalizeRawBalance(cash.rawBalance);
    const cashUnits=Number(rawCash)/10**cash.decimals;
    const balanceUsd=Number.isFinite(cashUnits)&&cashUnits>=0?cashUnits:null;
    return {wallet,positions,totalEstimatedValueUsd:values.length===positions.length?values.reduce((a,b)=>a+b,0):null,balanceUsd,source:"BSC_TOKEN_BALANCES",asOf:new Date().toISOString()};
  }
}
