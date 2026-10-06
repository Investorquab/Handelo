import { compareRepresentations, rankGapRadarAssets, toMarketInsight, type RwaAsset, type RepresentationComparison } from "@handelo/market";

export interface GapRadarResponse {
  markets: ReturnType<typeof toMarketInsight>[];
  representations: RepresentationComparison[];
}

export function normalizeGapRadarLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 8;
  return Math.min(Math.max(Math.floor(limit), 1), 25);
}

export function buildGapRadar(assets: RwaAsset[], limit = 8): GapRadarResponse {
  const normalizedLimit = normalizeGapRadarLimit(limit);
  const ranked = rankGapRadarAssets(assets);
  return {
    markets: ranked.slice(0, normalizedLimit).map(toMarketInsight),
    representations: compareRepresentations(assets).slice(0, normalizedLimit)
  };
}
