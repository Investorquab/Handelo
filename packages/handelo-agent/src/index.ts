import { createLlmClient, type LlmClient } from "@handelo/llm";
import { HandeloMarketClient, marketClientFromEnv, toMarketInsight, type RwaAsset } from "@handelo/market";
import { evaluatePolicy, type PolicyResult } from "@handelo/policy";
import { createDraftStrategy, type StrategyInput } from "@handelo/strategy";
import { createBasketDefinition, type BasketDefinition, type StrategyDefinition, type StrategyType } from "@handelo/core";

export interface UserIntent {
  action: "research" | "buy" | "sell" | "invest";
  ticker: string | null;
  amountUsd: number | null;
  horizon: string | null;
  riskTolerance: "low" | "medium" | "high" | "unknown";
  strategyType: StrategyType | null;
  frequency: string | null;
  condition: string | null;
  basketAssets: string[];
  basketName: string | null;
}

export interface MarketBrief {
  ticker: string;
  tokenSymbol: string;
  provider: string;
  tokenPrice: string;
  referencePrice: string;
  premiumPct: number | null;
  marketStatus: string;
  marketOpen: boolean;
  reason: string | null;
  nextOpenTime: number | null;
  nextCloseTime: number | null;
  contract: string;
}

export type AgentStageStatus = "COMPLETE" | "BLOCKED" | "SKIPPED";

export interface AgentStage {
  stage: "OBSERVED" | "REASONED" | "PROPOSED" | "POLICY_CHECKED";
  status: AgentStageStatus;
  evidence: string[];
}

export interface AgentDecisionTrace {
  stages: AgentStage[];
  executionReady: boolean;
}

export interface AgentResult {
  intent: UserIntent;
  market: MarketBrief | null;
  marketInsight: ReturnType<typeof toMarketInsight> | null;
  candidates: MarketBrief[];
  policy: PolicyResult | null;
  strategy: StrategyDefinition | null;
  basket: BasketDefinition | null;
  answer: string;
  provider: string;
  model: string;
  trace: AgentDecisionTrace;
}

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["research", "buy", "sell", "invest"] },
    ticker: { type: ["string", "null"] },
    amountUsd: { type: ["number", "null"] },
    horizon: { type: ["string", "null"] },
    riskTolerance: { type: "string", enum: ["low", "medium", "high", "unknown"] },
    strategyType: { type: ["string", "null"], enum: ["DCA", "RECURRING", "CONDITIONAL", "REBALANCE", null] },
    frequency: { type: ["string", "null"] },
    condition: { type: ["string", "null"] },
    basketAssets: { type: "array", items: { type: "string" }, maxItems: 8 },
    basketName: { type: ["string", "null"] }
  },
  required: ["action", "ticker", "amountUsd", "horizon", "riskTolerance"],
  additionalProperties: false
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false
};

export function validateAgentResponse(value: unknown): { answer: string } {
  if (!value || typeof value !== "object") throw new Error("LLM returned an invalid response.");
  const response = value as Record<string, unknown>;
  if (typeof response.answer !== "string" || !response.answer.trim()) {
    throw new Error("LLM returned an invalid answer.");
  }
  if (response.answer.length > 12000) {
    throw new Error("LLM returned an answer that is too long.");
  }
  return { answer: response.answer.trim() };
}

export function normalizeUserMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) throw new Error("message is required");
  if (normalized.length > 8000) throw new Error("message is too long");
  return normalized;
}

export function validateUserIntent(value: unknown): UserIntent {
  if (!value || typeof value !== "object") throw new Error("LLM returned an invalid intent.");
  const intent = value as Record<string, unknown>;
  const actions = ["research", "buy", "sell", "invest"];
  const risks = ["low", "medium", "high", "unknown"];
  const strategyTypes: Array<StrategyType | null> = ["DCA", "RECURRING", "CONDITIONAL", "REBALANCE", null];
  if (!actions.includes(String(intent.action)) || !risks.includes(String(intent.riskTolerance))) {
    throw new Error("LLM returned an invalid investment intent.");
  }
  if (intent.ticker !== null && typeof intent.ticker !== "string") {
    throw new Error("LLM returned an invalid ticker.");
  }
  if (intent.amountUsd !== null && (typeof intent.amountUsd !== "number" || !Number.isFinite(intent.amountUsd))) {
    throw new Error("LLM returned an invalid amount.");
  }
  if (intent.strategyType !== null && intent.strategyType !== undefined && typeof intent.strategyType !== "string") throw new Error("LLM returned an invalid strategy type.");
  if (!strategyTypes.includes((intent.strategyType ?? null) as StrategyType | null)) throw new Error("LLM returned an invalid strategy type.");
  if (intent.frequency !== null && intent.frequency !== undefined && typeof intent.frequency !== "string") throw new Error("LLM returned an invalid strategy frequency.");
  if (intent.condition !== null && intent.condition !== undefined && typeof intent.condition !== "string") throw new Error("LLM returned an invalid strategy condition.");
  if (intent.basketAssets !== undefined && (!Array.isArray(intent.basketAssets) || intent.basketAssets.some((asset) => typeof asset !== "string"))) throw new Error("LLM returned invalid basket assets.");
  if (Array.isArray(intent.basketAssets) && intent.basketAssets.length > 8) throw new Error("A basket cannot contain more than 8 assets.");
  if (intent.basketName !== null && intent.basketName !== undefined && typeof intent.basketName !== "string") throw new Error("LLM returned an invalid basket name.");
  if (intent.horizon !== null && typeof intent.horizon !== "string") {
    throw new Error("LLM returned an invalid horizon.");
  }
  return {
    action: intent.action as UserIntent["action"],
    ticker: intent.ticker as string | null,
    amountUsd: intent.amountUsd as number | null,
    horizon: intent.horizon as string | null,
    riskTolerance: intent.riskTolerance as UserIntent["riskTolerance"],
    strategyType: (intent.strategyType ?? null) as StrategyType | null,
    frequency: (intent.frequency ?? null) as string | null,
    condition: (intent.condition ?? null) as string | null,
    basketAssets: (intent.basketAssets ?? []) as string[],
    basketName: (intent.basketName ?? null) as string | null
  };
}

function pct(token: string, reference: string): number | null {
  const t = Number(token);
  const r = Number(reference);
  if (!Number.isFinite(t) || !Number.isFinite(r) || r === 0) return null;
  return ((t - r) / r) * 100;
}

function marketBrief(asset: RwaAsset): MarketBrief {
  return {
    ticker: asset.underlyingTicker,
    tokenSymbol: asset.tokenSymbol,
    provider: asset.platformId,
    tokenPrice: asset.tokenPrice,
    referencePrice: asset.referencePrice,
    premiumPct: pct(asset.tokenPrice, asset.referencePrice),
    marketStatus: asset.statusInfo.marketStatus,
    marketOpen: asset.statusInfo.openState,
    reason: asset.statusInfo.reasonMsg,
    nextOpenTime: asset.statusInfo.nextOpenTime,
    nextCloseTime: asset.statusInfo.nextCloseTime,
    contract: asset.tokenContractAddress
  };
}

export class HandeloAgent {
  private readonly llm: LlmClient;
  private readonly market: HandeloMarketClient;

  constructor(opts: { llmApiKey?: string; llmClient?: LlmClient; marketClient?: HandeloMarketClient } = {}) {
    this.llm = opts.llmClient ?? createLlmClient(opts.llmApiKey);
    this.market = opts.marketClient ?? marketClientFromEnv();
  }

  async run(message: string): Promise<AgentResult> {
    const normalizedMessage = normalizeUserMessage(message);
    const intent = await this.llm.generateJson<UserIntent>({
      schemaName: "handelo_intent",
      schema: INTENT_SCHEMA,
      system: "You are Handelo's intent parser. Extract the user's investment intent without inventing a ticker or amount. If they did not name a stock, ticker is null. Amount is USD when explicitly stated. If the user explicitly describes DCA, recurring, conditional, or rebalancing behavior, extract strategyType, frequency, and condition; otherwise return null for those fields.",
      user: normalizedMessage
    });

    const parsedIntent = validateUserIntent(intent);

    let market: MarketBrief | null = null;
    let marketInsight: ReturnType<typeof toMarketInsight> | null = null;
    let candidates: MarketBrief[] = [];
    let strategy: StrategyDefinition | null = null;
    let basket: BasketDefinition | null = null;

    let marketResolutionError: string | null = null;

    if (parsedIntent.ticker) {
      try {
        const matches = await this.market.findAll(parsedIntent.ticker);
        const exact = matches.filter((asset) => asset.tokenSymbol.toLowerCase() === parsedIntent.ticker!.trim().toLowerCase());
        if (exact.length === 1) {
          market = marketBrief(exact[0]);
          marketInsight = toMarketInsight(exact[0]);
        } else if (matches.length === 1) {
          market = marketBrief(matches[0]);
          marketInsight = toMarketInsight(matches[0]);
        } else {
          candidates = matches.map(marketBrief);
        }
      } catch {
        marketResolutionError = "The live market resolver could not find a supported BSC tokenized-stock market for that ticker.";
      }
    } else if (parsedIntent.action === "buy" || parsedIntent.action === "sell" || parsedIntent.action === "invest") {
      try {
        candidates = (await this.market.discover(4)).map(marketBrief);
      } catch {
        marketResolutionError = "The live market discovery service is unavailable right now.";
      }
    }

    if (market && parsedIntent.strategyType) {
      try {
        const input: StrategyInput = {
          type: parsedIntent.strategyType,
          asset: market.tokenSymbol,
          amountUsd: parsedIntent.amountUsd ?? undefined,
          frequency: parsedIntent.frequency ?? undefined,
          condition: parsedIntent.condition ?? undefined,
          constraints: {}
        };
        strategy = createDraftStrategy(input);
      } catch {
        strategy = null;
      }
    }

    if (parsedIntent.basketAssets.length >= 2) {
      const resolvedAssets: string[] = [];
      for (const symbol of parsedIntent.basketAssets) {
        try {
          const matches = await this.market.findAll(symbol);
          const exact = matches.find((asset) => asset.tokenSymbol.toLowerCase() === symbol.trim().toLowerCase()) ?? (matches.length === 1 ? matches[0] : null);
          if (exact) resolvedAssets.push(exact.tokenSymbol);
        } catch {
          // Keep the basket draft limited to markets that resolve through live data.
        }
      }
      if (resolvedAssets.length >= 2) {
        try {
          basket = createBasketDefinition({
            name: parsedIntent.basketName ?? "Custom basket",
            assets: resolvedAssets
          });
        } catch {
          basket = null;
        }
      }
    }

    const policy = market
      ? evaluatePolicy({
          action: parsedIntent.action,
          amountUsd: parsedIntent.amountUsd,
          marketOpen: market.marketOpen,
          premiumPct: market.premiumPct
        })
      : null;

    const context = market
      ? JSON.stringify({ market, policy }, null, 2)
      : candidates.length
        ? JSON.stringify({ candidateMarkets: candidates }, null, 2)
        : marketResolutionError
          ? marketResolutionError
          : "No specific stock market record was resolved.";

    const response = await this.llm.generateJson<{ answer: string }>({
      schemaName: "handelo_response",
      schema: RESPONSE_SCHEMA,
      system: "You are Handelo, a beginner-friendly tokenized-stock market agent on BNB Chain. Explain market structure in simple language. Never claim a trade happened unless execution evidence is supplied. If the market is closed, explain that the on-chain token may still trade while the latest reference price is stale. Mention the on-chain/reference gap when available. When candidateMarkets are supplied, explain that they are live market-data candidates rather than a personalized recommendation. Do not give personalized certainty; present observations and let the user decide.",
      user: `User request: ${normalizedMessage}
Parsed intent: ${JSON.stringify(parsedIntent)}
Live market context: ${context}
Respond naturally and concisely.`
    });

    const validatedResponse = validateAgentResponse(response);

    const trace: AgentDecisionTrace = {
      stages: [
        {
          stage: "OBSERVED",
          status: market || candidates.length ? "COMPLETE" : "BLOCKED",
          evidence: market
            ? ["live market record resolved", "market insight derived from live data"]
            : candidates.length
              ? ["live market candidates discovered"]
              : ["no live market record resolved"]
        },
        {
          stage: "REASONED",
          status: "COMPLETE",
          evidence: [market ? "market context and reference-price relationship supplied to the response model" : "response model received the available live-data context"]
        },
        {
          stage: "PROPOSED",
          status: strategy || basket || parsedIntent.action === "research" ? "COMPLETE" : "SKIPPED",
          evidence: [
            ...(strategy ? ["deterministic strategy draft created"] : []),
            ...(basket ? ["deterministic basket draft created"] : []),
            ...(parsedIntent.action === "research" ? ["research response requested; no execution proposal created"] : [])
          ]
        },
        {
          stage: "POLICY_CHECKED",
          status: policy ? "COMPLETE" : "BLOCKED",
          evidence: policy ? [`policy decision: ${policy.decision}`] : ["policy was not evaluated without a resolved market"]
        }
      ],
      executionReady: Boolean(
        market &&
        policy &&
        policy.decision !== "BLOCK" &&
        parsedIntent.amountUsd !== null &&
        parsedIntent.amountUsd > 0
      )
    };

    return {
      intent: parsedIntent,
      market,
      marketInsight,
      candidates,
      policy,
      strategy,
      basket,
      answer: validatedResponse.answer,
      provider: this.llm.provider,
      model: this.llm.model,
      trace
    };
  }
}
