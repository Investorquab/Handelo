export type HandeloPage = "home" | "workspace";

export type MarketStatus = "OPEN" | "CLOSED" | "UNKNOWN";
export type RiskDecision = "PASS" | "BLOCK";
export type ExecutionState = "PENDING" | "FINISHED" | "FAILED";
export type StrategyType = "DCA" | "RECURRING" | "CONDITIONAL" | "REBALANCE";

export type WalletMode = "DEMO" | "USER";
export type WalletRole = "PERSONAL" | "AGENT";
export type WalletPermission =
  | "READ_PORTFOLIO"
  | "DCA"
  | "RECURRING"
  | "CONDITIONAL"
  | "REBALANCE"
  | "TRANSFER_OUT";

export interface WalletContext {
  mode: WalletMode;
  role: WalletRole;
  address: string | null;
  network: "BSC";
  connected: boolean;
  balanceUsd: number | null;
}

export interface AgentWalletPolicy {
  permissions: WalletPermission[];
  maxTransactionUsd?: number;
  maxDailySpendUsd?: number;
  minimumReservePercent?: number;
  allowedAssets?: string[];
  expiresAt?: string | null;
  revocable: boolean;
}

export interface AgentWalletContext extends WalletContext {
  role: "AGENT";
  policy: AgentWalletPolicy;
  status: "ACTIVE" | "PAUSED" | "REVOKED" | "UNAVAILABLE";
  ownerWallet: string | null;
}

export interface WalletTransferPreview {
  from: string;
  to: string;
  amountUsd: number;
  network: "BSC";
  risk: RiskResult;
  requiresUserApproval: boolean;
  executionState: ExecutionState;
}


export interface MarketInsight {
  underlyingTicker: string;
  tokenSymbol: string;
  provider: string;
  onChainPrice: number | null;
  referencePrice: number | null;
  divergencePercent: number | null;
  marketStatus: MarketStatus;
  nextOpenAt?: string | null;
  nextCloseAt?: string | null;
  marketStatusReason?: string | null;
  liquidityContext?: string | null;
  volume24h?: number | null;
  turnover24hPercent?: number | null;
  liquidityActivity?: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
}

export interface StrategyConstraints {
  maxSingleAssetExposurePercent?: number;
  maxTransactionUsd?: number;
  minimumReservePercent?: number;
}

export interface StrategyDefinition {
  id: string;
  type: StrategyType;
  asset: string;
  amountUsd?: number;
  frequency?: string;
  condition?: string;
  targetAllocation?: Record<string, number>;
  constraints: StrategyConstraints;
  nextExecutionAt?: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "BLOCKED" | "CANCELLED";
}

export interface PortfolioPosition {
  asset: string;
  tokenSymbol: string;
  allocationPercent: number | null;
  valueUsd: number | null;
}

export interface PortfolioSnapshot {
  wallet: string;
  balanceUsd: number | null;
  positions: PortfolioPosition[];
  totalValueUsd: number | null;
  source?: "BSC_TOKEN_BALANCES" | "LOCAL";
  asOf?: string | null;
}

export interface RebalanceAction {
  asset: string;
  currentAllocationPercent: number;
  targetAllocationPercent: number;
  deltaPercent: number;
  amountUsd: number;
  direction: "BUY" | "SELL" | "HOLD";
}

export interface RebalancePreview {
  wallet: string;
  totalValueUsd: number;
  targetAllocation: Record<string, number>;
  actions: RebalanceAction[];
}

export function createRebalancePreview(portfolio: PortfolioSnapshot, targetAllocation: Record<string, number>): RebalancePreview {
  const entries = Object.entries(targetAllocation).map(([asset, percent]) => [asset.trim(), Number(percent)] as const);
  if (!entries.length || entries.some(([asset, percent]) => !asset || !Number.isFinite(percent) || percent < 0)) {
    throw new Error("Target allocation must contain named assets with non-negative percentages.");
  }
  const totalTarget = entries.reduce((sum, [, percent]) => sum + percent, 0);
  if (Math.abs(totalTarget - 100) > 0.01) throw new Error("Target allocation must total 100%.");
  const totalValueUsd = Number(portfolio.totalValueUsd);
  if (!Number.isFinite(totalValueUsd) || totalValueUsd <= 0) throw new Error("A positive live portfolio value is required for rebalance preview.");
  const current = new Map<string, { label: string; percent: number }>();
  for (const position of portfolio.positions) {
    const key = (position.tokenSymbol || position.asset).trim().toLowerCase();
    const percent = Number(position.allocationPercent);
    if (!key || !Number.isFinite(percent)) continue;
    current.set(key, { label: position.tokenSymbol || position.asset, percent });
  }
  const targets = new Map(entries.map(([asset, percent]) => [asset.toLowerCase(), { label: asset, percent }]));
  const keys = new Set([...current.keys(), ...targets.keys()]);
  const actions = [...keys].map(key => {
    const currentPercent = current.get(key)?.percent ?? 0;
    const targetPercent = targets.get(key)?.percent ?? 0;
    const deltaPercent = targetPercent - currentPercent;
    return {
      asset: targets.get(key)?.label ?? current.get(key)?.label ?? key,
      currentAllocationPercent: currentPercent,
      targetAllocationPercent: targetPercent,
      deltaPercent,
      amountUsd: Math.abs(deltaPercent) / 100 * totalValueUsd,
      direction: deltaPercent > 0.01 ? "BUY" : deltaPercent < -0.01 ? "SELL" : "HOLD"
    } satisfies RebalanceAction;
  }).sort((a,b)=>Math.abs(b.deltaPercent)-Math.abs(a.deltaPercent));
  return {wallet:portfolio.wallet,totalValueUsd,targetAllocation:Object.fromEntries(entries),actions};
}

export interface RiskResult {
  decision: RiskDecision;
  reasons: string[];
  checkedAt: string;
  constraints: StrategyConstraints;
}

export interface BasketDefinition {
  id: string;
  name: string;
  assets: Array<{ asset: string; weightPercent: number }>;
  strategyType: "REBALANCE";
  status: "DRAFT";
}

export interface TransactionPreview {
  action: "BUY" | "SELL" | "REBALANCE";
  asset: string;
  amountUsd: number;
  estimatedQuantity?: number | null;
  referencePrice?: number | null;
  onChainPrice?: number | null;
  network: "BSC";
  wallet: string;
  risk: RiskResult;
  executionState?: ExecutionState;
}

export type ChatCard =
  | {type:"MARKET_INSIGHT"; data:MarketInsight}
  | {type:"STRATEGY_PREVIEW"; data:StrategyDefinition}
  | {type:"RISK_RESULT"; data:RiskResult}
  | {type:"TRANSACTION_PREVIEW"; data:TransactionPreview}
  | {type:"PORTFOLIO_PREVIEW"; data:PortfolioSnapshot}
  | {type:"BASKET_PREVIEW"; data:BasketDefinition}
  | {type:"WALLET_TRANSFER_PREVIEW"; data:WalletTransferPreview};

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards?: ChatCard[];
  createdAt: string;
}

export interface WorkspaceState {
  selectedMarket: MarketInsight | null;
  wallet: {address:string|null; balanceUsd:number|null};
  portfolio: PortfolioSnapshot | null;
  activeStrategies: StrategyDefinition[];
  risk: RiskResult | null;
  activity: Array<{id:string; label:string; state:ExecutionState; createdAt:string}>;
  messages: ChatMessage[];
}

export function calculateDivergencePercent(
  onChainPrice: number | null,
  referencePrice: number | null
): number | null {
  if (
    onChainPrice === null ||
    referencePrice === null ||
    !Number.isFinite(onChainPrice) ||
    !Number.isFinite(referencePrice) ||
    referencePrice === 0
  ) return null;

  return ((onChainPrice - referencePrice) / referencePrice) * 100;
}

export function createRiskResult(
  constraints: StrategyConstraints,
  context: {
    proposedAmountUsd?: number;
    projectedAssetExposurePercent?: number;
    projectedReservePercent?: number;
    now?: string;
  }
): RiskResult {
  const reasons:string[] = [];

  if (
    constraints.maxTransactionUsd !== undefined &&
    context.proposedAmountUsd !== undefined &&
    context.proposedAmountUsd > constraints.maxTransactionUsd
  ) {
    reasons.push("Transaction amount exceeds the $" + constraints.maxTransactionUsd + " limit.");
  }

  if (
    constraints.maxSingleAssetExposurePercent !== undefined &&
    context.projectedAssetExposurePercent !== undefined &&
    context.projectedAssetExposurePercent > constraints.maxSingleAssetExposurePercent
  ) {
    reasons.push(
      "Projected asset exposure exceeds the " +
      constraints.maxSingleAssetExposurePercent +
      "% limit."
    );
  }

  if (
    constraints.minimumReservePercent !== undefined &&
    context.projectedReservePercent !== undefined &&
    context.projectedReservePercent < constraints.minimumReservePercent
  ) {
    reasons.push(
      "Projected reserve is below the " +
      constraints.minimumReservePercent +
      "% minimum."
    );
  }

  return {
    decision: reasons.length === 0 ? "PASS" : "BLOCK",
    reasons,
    checkedAt: context.now ?? new Date().toISOString(),
    constraints
  };
}

export function createStrategyId(prefix = "strategy"): string {
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "strategy";
  return safePrefix + "-" + Date.now().toString(36);
}


export function evaluatePortfolioStrategyRisk(
  portfolio: PortfolioSnapshot,
  asset: string,
  amountUsd: number,
  constraints: StrategyConstraints = {
    maxSingleAssetExposurePercent: 35,
    maxTransactionUsd: 100,
    minimumReservePercent: 10
  }
): RiskResult {
  const total = Number(portfolio.totalValueUsd);
  const current = portfolio.positions.find(
    (position) =>
      position.asset.toLowerCase() === asset.toLowerCase() ||
      position.tokenSymbol.toLowerCase() === asset.toLowerCase()
  );
  const currentValue = Number(current?.valueUsd ?? 0);
  const projectedTotal = Number.isFinite(total) && total >= 0 ? total + amountUsd : amountUsd;
  const projectedExposurePercent = projectedTotal > 0
    ? ((currentValue + amountUsd) / projectedTotal) * 100
    : 100;
  const balance = portfolio.balanceUsd;
  const minimumReservePercent = constraints.minimumReservePercent ?? 0;
  const minimumReserveUsd = Number.isFinite(Number(balance)) && Number(balance) >= 0
    ? Number(balance) * (minimumReservePercent / 100)
    : null;
  const availableAfterSpend = Number.isFinite(Number(balance)) && Number(balance) >= 0
    ? Number(balance) - amountUsd
    : null;
  const cashSufficient = availableAfterSpend === null ||
    (availableAfterSpend >= 0 && availableAfterSpend + 1e-9 >= (minimumReserveUsd ?? 0));
  const result = createRiskResult(constraints, {
    proposedAmountUsd: amountUsd,
    projectedAssetExposurePercent: projectedExposurePercent,
    now: new Date().toISOString()
  });
  if (!cashSufficient) {
    result.decision = "BLOCK";
    result.reasons.push(
      "Insufficient available cash balance for the requested transaction while preserving the " +
      minimumReservePercent + "% minimum reserve."
    );
  }
  return result;
}


export function createBasketDefinition(input: {
  name: string;
  assets: string[];
}): BasketDefinition {
  const assets = input.assets.map((asset) => asset.trim()).filter(Boolean);
  if (!input.name.trim() || assets.length < 2) {
    throw new Error("A basket requires a name and at least two assets.");
  }
  const weightPercent = 100 / assets.length;
  return {
    id: createStrategyId("basket"),
    name: input.name.trim(),
    assets: assets.map((asset) => ({ asset, weightPercent })),
    strategyType: "REBALANCE",
    status: "DRAFT"
  };
}

export function createTransactionPreview(input: {
  asset: string;
  amountUsd: number;
  estimatedQuantity?: number | null;
  referencePrice?: number | null;
  onChainPrice?: number | null;
  wallet: string;
  risk: RiskResult;
}): TransactionPreview {
  return {
    action: "BUY",
    asset: input.asset,
    amountUsd: input.amountUsd,
    estimatedQuantity: input.estimatedQuantity ?? null,
    referencePrice: input.referencePrice ?? null,
    onChainPrice: input.onChainPrice ?? null,
    network: "BSC",
    wallet: input.wallet,
    risk: input.risk,
    executionState: "PENDING"
  };
}


export interface QuoteQuality {
  fromCoinAmount: number;
  toCoinAmount: number;
  impliedPrice: number | null;
  onChainPrice: number | null;
  referencePrice: number | null;
  quoteVsOnChainPercent: number | null;
  quoteVsReferencePercent: number | null;
  requestedSlippagePercent: number | null;
}

export function createQuoteQuality(input: {
  fromCoinAmount: string | number;
  toCoinAmount: string | number;
  onChainPrice?: number | null;
  referencePrice?: number | null;
  requestedSlippagePercent?: number | null;
}): QuoteQuality {
  const fromCoinAmount = Number(input.fromCoinAmount);
  const toCoinAmount = Number(input.toCoinAmount);
  const onChainPrice = Number(input.onChainPrice);
  const referencePrice = Number(input.referencePrice);
  const impliedPrice = Number.isFinite(fromCoinAmount) && fromCoinAmount > 0 && Number.isFinite(toCoinAmount) && toCoinAmount > 0
    ? fromCoinAmount / toCoinAmount
    : null;
  const quoteVsOnChainPercent = impliedPrice !== null && Number.isFinite(onChainPrice) && onChainPrice > 0
    ? ((impliedPrice - onChainPrice) / onChainPrice) * 100
    : null;
  const quoteVsReferencePercent = impliedPrice !== null && Number.isFinite(referencePrice) && referencePrice > 0
    ? ((impliedPrice - referencePrice) / referencePrice) * 100
    : null;
  const requestedSlippagePercent = Number(input.requestedSlippagePercent);
  return {
    fromCoinAmount,
    toCoinAmount,
    impliedPrice,
    onChainPrice: Number.isFinite(onChainPrice) && onChainPrice > 0 ? onChainPrice : null,
    referencePrice: Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : null,
    quoteVsOnChainPercent,
    quoteVsReferencePercent,
    requestedSlippagePercent: Number.isFinite(requestedSlippagePercent) && requestedSlippagePercent >= 0 ? requestedSlippagePercent : null
  };
}
