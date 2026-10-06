import { HandeloMarketClient, marketClientFromEnv, type RwaAsset } from "@handelo/market";

export interface PortfolioPosition{
  ticker:string;tokenSymbol:string;contract:string;balance:string;estimatedValueUsd:number|null;tokenPrice:string;provider:string;decimals:number;
}
export interface PortfolioSnapshot{wallet:string;positions:PortfolioPosition[];totalEstimatedValueUsd:number|null;balanceUsd:number|null;source:"BSC_TOKEN_BALANCES";asOf:string;}

export interface CostBasisLot {
  asset: string;
  quantity: number;
  unitCostUsd: number;
  acquiredAt: string;
}

export interface PortfolioPnlPosition {
  asset: string;
  quantity: number;
  currentPriceUsd: number;
  marketValueUsd: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPercent: number|null;
}

export interface PortfolioPnl {
  positions: PortfolioPnlPosition[];
  totalMarketValueUsd: number;
  totalCostBasisUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPercent: number|null;
}

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

export function portfolioAssets(assets:RwaAsset[]):RwaAsset[]{ return normalizeAssets(assets); }

function position(asset:RwaAsset,balance:string):PortfolioPosition{
  const units=Number(balance)/10**Number(asset.decimals);
  const price=Number(asset.tokenPrice);
  return {ticker:asset.underlyingTicker,tokenSymbol:asset.tokenSymbol,contract:asset.tokenContractAddress,balance,estimatedValueUsd:Number.isFinite(units*price)?units*price:null,tokenPrice:asset.tokenPrice,provider:asset.platformId,decimals:Number(asset.decimals)};
}

export function calculatePortfolioPnl(
  positions: PortfolioPosition[],
  lots: CostBasisLot[]
): PortfolioPnl {
  const lotsByAsset = new Map<string, CostBasisLot[]>();
  for (const lot of lots) {
    const asset = lot.asset.trim().toLowerCase();
    if (!asset || !Number.isFinite(lot.quantity) || lot.quantity < 0 || !Number.isFinite(lot.unitCostUsd) || lot.unitCostUsd < 0 || !Number.isFinite(Date.parse(lot.acquiredAt))) {
      throw new Error("Cost basis lots must contain valid asset, quantity, unit cost and acquisition timestamp.");
    }
    const bucket = lotsByAsset.get(asset) ?? [];
    bucket.push({...lot, asset});
    lotsByAsset.set(asset, bucket);
  }

  const result = positions.map(position => {
    const quantity = Number(position.balance) / 10 ** position.decimals;
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Portfolio position balance cannot be converted to a finite quantity.");
    const currentPriceUsd = Number(position.tokenPrice);
    if (!Number.isFinite(currentPriceUsd) || currentPriceUsd < 0) throw new Error("Portfolio position price must be a finite non-negative number.");
    const asset = position.tokenSymbol.trim().toLowerCase();
    const costBasisUsd = (lotsByAsset.get(asset) ?? []).reduce((sum, lot) => sum + lot.quantity * lot.unitCostUsd, 0);
    const marketValueUsd = Number.isFinite(quantity * currentPriceUsd) ? quantity * currentPriceUsd : 0;
    const unrealizedPnlUsd = marketValueUsd - costBasisUsd;
    return {
      asset: position.tokenSymbol,
      quantity,
      currentPriceUsd,
      marketValueUsd,
      costBasisUsd,
      unrealizedPnlUsd,
      unrealizedPnlPercent: costBasisUsd > 0 ? (unrealizedPnlUsd / costBasisUsd) * 100 : null
    };
  });

  const totalMarketValueUsd = result.reduce((sum, p) => sum + p.marketValueUsd, 0);
  const totalCostBasisUsd = result.reduce((sum, p) => sum + p.costBasisUsd, 0);
  const unrealizedPnlUsd = totalMarketValueUsd - totalCostBasisUsd;
  return {
    positions: result,
    totalMarketValueUsd,
    totalCostBasisUsd,
    unrealizedPnlUsd,
    unrealizedPnlPercent: totalCostBasisUsd > 0 ? (unrealizedPnlUsd / totalCostBasisUsd) * 100 : null
  };
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
