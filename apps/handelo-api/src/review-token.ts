import { createHmac, timingSafeEqual } from "node:crypto";

export interface ReviewTokenInput {
  ticker: string;
  amountUsd: number;
  fromToken: string;
  fromTokenQty: string;
  contract: string;
  slippage?: string;
  wallet: string;
  reviewedQuotePrice?: number | null;
}

const REVIEW_TOKEN_TTL_MS = 5 * 60 * 1000;
const consumedReviewTokens = new Map<string, number>();

export interface VerifiedReviewToken {
  ticker: string;
  amountUsd: number;
  fromToken: string;
  fromTokenQty: string;
  contract: string;
  slippage?: string;
  wallet: string;
  reviewedQuotePrice?: number | null;
  exp: number;
}

function secret() {
  return process.env.HANDELO_REVIEW_TOKEN_SECRET ?? "handelo-local-review-secret";
}

export function createReviewToken(input: ReviewTokenInput, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...input, exp: now + REVIEW_TOKEN_TTL_MS })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readVerifiedReviewToken(token: string, now = Date.now()): VerifiedReviewToken | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as VerifiedReviewToken;
    return parsed.exp !== undefined && parsed.exp > now ? parsed : null;
  } catch {
    return null;
  }
}

export function verifyReviewToken(token: string, input: ReviewTokenInput, now = Date.now()) {
  const parsed = readVerifiedReviewToken(token, now);
  if (!parsed) return false;
  return parsed.ticker === input.ticker
    && parsed.amountUsd === input.amountUsd
    && parsed.fromToken.toLowerCase() === input.fromToken.toLowerCase()
    && parsed.fromTokenQty === input.fromTokenQty
    && parsed.contract.toLowerCase() === input.contract.toLowerCase()
    && parsed.slippage === input.slippage
    && parsed.wallet.toLowerCase() === input.wallet.toLowerCase()
    && parsed.reviewedQuotePrice === input.reviewedQuotePrice;
}

export function quoteDriftWithinTolerance(
  reviewedQuotePrice: number | null | undefined,
  freshQuotePrice: number | null | undefined,
  slippage?: string,
): boolean {
  if (reviewedQuotePrice == null || freshQuotePrice == null) return false;
  if (!Number.isFinite(reviewedQuotePrice) || reviewedQuotePrice <= 0 || !Number.isFinite(freshQuotePrice) || freshQuotePrice <= 0) return false;
  const tolerance = slippage === undefined ? 1 : Number(slippage);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) return false;
  return Math.abs((freshQuotePrice - reviewedQuotePrice) / reviewedQuotePrice) * 100 <= tolerance;
}

export function consumeReviewToken(token: string, now = Date.now()) {
  const consumedUntil = consumedReviewTokens.get(token);
  if (consumedUntil !== undefined && consumedUntil > now) return false;
  if (consumedUntil !== undefined) consumedReviewTokens.delete(token);
  consumedReviewTokens.set(token, now + REVIEW_TOKEN_TTL_MS);
  for (const [key, expiresAt] of consumedReviewTokens) {
    if (expiresAt <= now) consumedReviewTokens.delete(key);
  }
  return true;
}
