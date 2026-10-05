import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { StrategyDefinition } from "@handelo/core";

export interface StoredStrategy extends StrategyDefinition {
  wallet: string;
  activatedAt: string;
}

const storePath = resolve(process.env.HANDELO_STRATEGY_STORE_PATH ?? "./data/strategies.json");
let loaded = false;
const strategies = new Map<string, StoredStrategy>();

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object" && typeof (item as StoredStrategy).id === "string" && typeof (item as StoredStrategy).wallet === "string") {
          strategies.set((item as StoredStrategy).id, item as StoredStrategy);
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function persist(): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify([...strategies.values()], null, 2) + "\n", "utf8");
}

export async function getStoredStrategy(wallet: string, strategyId: string): Promise<StoredStrategy | null> {
  await ensureLoaded();
  return [...strategies.values()].find(s => s.wallet.toLowerCase() === wallet.toLowerCase() && s.id === strategyId) ?? null;
}

export async function listStrategies(wallet: string): Promise<StoredStrategy[]> {
  await ensureLoaded();
  return [...strategies.values()].filter(s => s.wallet.toLowerCase() === wallet.toLowerCase());
}

export async function listActiveStrategies(wallet: string): Promise<StoredStrategy[]> {
  await ensureLoaded();
  return [...strategies.values()].filter(
    strategy => strategy.wallet.toLowerCase() === wallet.toLowerCase() && strategy.status === "ACTIVE"
  );
}

export async function activateStoredStrategy(wallet: string, strategy: StrategyDefinition): Promise<StoredStrategy> {
  await ensureLoaded();
  const active = [...strategies.values()].find(
    existing => existing.wallet.toLowerCase() === wallet.toLowerCase() && existing.id === strategy.id
  );
  if (active) return active;

  const activated: StoredStrategy = {
    ...strategy,
    status: "ACTIVE",
    wallet,
    activatedAt: new Date().toISOString()
  };
  strategies.set(activated.id, activated);
  await persist();
  return activated;
}

export async function updateStoredStrategy(wallet: string, strategyId: string, update: Partial<Pick<StoredStrategy, "asset" | "amountUsd" | "frequency" | "condition" | "targetAllocation" | "constraints" | "nextExecutionAt">>): Promise<StoredStrategy> {
  await ensureLoaded();
  const existing = await getStoredStrategy(wallet, strategyId);
  if (!existing) throw new Error("Strategy not found.");
  if (existing.status === "CANCELLED") throw new Error("Cancelled strategies cannot be edited.");
  const updated = { ...existing, ...update };
  strategies.set(updated.id, updated);
  await persist();
  return updated;
}

export async function pauseStoredStrategy(wallet: string, strategyId: string): Promise<StoredStrategy> {
  await ensureLoaded();
  const existing = await getStoredStrategy(wallet, strategyId);
  if (!existing) throw new Error("Strategy not found.");
  if (existing.status !== "ACTIVE") throw new Error("Only active strategies can be paused.");
  const updated = { ...existing, status: "PAUSED" as const };
  strategies.set(updated.id, updated);
  await persist();
  return updated;
}

export async function resumeStoredStrategy(wallet: string, strategyId: string): Promise<StoredStrategy> {
  await ensureLoaded();
  const existing = await getStoredStrategy(wallet, strategyId);
  if (!existing) throw new Error("Strategy not found.");
  if (existing.status !== "PAUSED") throw new Error("Only paused strategies can be resumed.");
  const updated = { ...existing, status: "ACTIVE" as const };
  strategies.set(updated.id, updated);
  await persist();
  return updated;
}

export async function cancelStoredStrategy(wallet: string, strategyId: string): Promise<StoredStrategy> {
  await ensureLoaded();
  const existing = await getStoredStrategy(wallet, strategyId);
  if (!existing) throw new Error("Strategy not found.");
  const updated = { ...existing, status: "CANCELLED" as const };
  strategies.set(updated.id, updated);
  await persist();
  return updated;
}
