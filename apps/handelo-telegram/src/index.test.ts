import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramHandler, formatHandeloResponse } from "./index.js";
import type { AgentResult } from "@handelo/agent";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const telegramSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

test("Telegram formatter renders structured Handelo context", () => {
  const result = {
    answer: "NVIDIA has a live tokenized representation.",
    market: {
      tokenSymbol: "NVDAB",
      provider: "Binance",
      tokenPrice: "180",
      referencePrice: "175",
      premiumPct: 2.857,
      marketStatus: "OPEN",
    },
    strategy: {
      type: "DCA",
      asset: "NVDAB",
      amountUsd: 10,
      frequency: "Every Monday",
      status: "DRAFT",
    },
    policy: { decision: "READY", reasons: ["Policy checks passed."] },
    basket: { name: "AI basket", assets: [{ asset: "NVDAB", weightPercent: 50 }, { asset: "MSFTB", weightPercent: 50 }], strategyType: "REBALANCE", status: "DRAFT" },
  } as AgentResult;
  const text = formatHandeloResponse(result);

  assert.match(text, /MARKET INSIGHT/);
  assert.match(text, /STRATEGY PREVIEW/);
  assert.match(text, /RISK RESULT/);
  assert.match(text, /BASKET PREVIEW/);
  assert.match(text, /No strategy is activated by Telegram/);
});

test("Telegram ignores group messages", async () => {
  const calls: string[] = [];
  const client = {
    chat: async () => {
      throw new Error("should not be called");
    },
  };
  const transport = {
    call: async <T>(_method: string): Promise<T> => {
      return {} as T;
    },
  };

  await createTelegramHandler(client, transport)({
    update_id: 1,
    message: { chat: { id: 7, type: "group" }, text: "hello" },
  });

  assert.deepEqual(calls, []);
});

test("Telegram /start and /help are handled without the LLM", async () => {
  const messages: string[] = [];
  const client = { chat: async (): Promise<AgentResult> => ({ answer: "unused" } as AgentResult) };
  const transport = {
    call: async <T>(_method: string, body?: Record<string, unknown>): Promise<T> => {
      messages.push(String(body?.text ?? ""));
      return {} as T;
    },
  };
  const handler = createTelegramHandler(client, transport);

  await handler({ update_id: 1, message: { chat: { id: 1, type: "private" }, text: "/start" } });
  await handler({ update_id: 2, message: { chat: { id: 1, type: "private" }, text: "/help" } });

  assert.match(messages[0], /Welcome to Handelo/);
  assert.match(messages[1], /Telegram does not hold private keys/);
});


test("Telegram uses the server-side client API key configuration", () => {
  assert.match(telegramSource, /HANDELO_CLIENT_API_KEY/);
  assert.doesNotMatch(telegramSource, /HANDELO_API_KEY/);
});
