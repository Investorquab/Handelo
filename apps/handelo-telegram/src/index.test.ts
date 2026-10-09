import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramHandler, formatHandeloResponse, runTelegramBot } from "./index.js";
import type { AgentResult } from "@handelo/agent";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const telegramSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

function mockResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

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

test("Telegram response stays within its message-size budget", () => {
  const text = formatHandeloResponse({ answer: "😀".repeat(6000) } as AgentResult);

  assert.ok(Array.from(text).length <= 3900);
  assert.match(text, /Response shortened/);
});

test("Telegram ignores group messages", async () => {
  const client = {
    chat: async () => {
      throw new Error("should not be called");
    },
  };
  const transport = {
    call: async <T>(_method: string): Promise<T> => ({} as T),
  };

  await createTelegramHandler(client, transport)({
    update_id: 1,
    message: { chat: { id: 7, type: "group" }, text: "hello" },
  });
});

test("Telegram /start and /help commands work without the LLM", async () => {
  const messages: string[] = [];
  const client = { chat: async (): Promise<AgentResult> => ({ answer: "unused" } as AgentResult) };
  const transport = {
    call: async <T>(_method: string, body?: Record<string, unknown>): Promise<T> => {
      messages.push(String(body?.text ?? ""));
      return {} as T;
    },
  };
  const handler = createTelegramHandler(client, transport);

  await handler({ update_id: 1, message: { chat: { id: 1, type: "private" }, text: "/start@handelo_bot" } });
  await handler({ update_id: 2, message: { chat: { id: 1, type: "private" }, text: "/help" } });

  assert.match(messages[0], /Welcome to Handelo/);
  assert.match(messages[1], /Telegram does not hold private keys/);
});

test("Telegram does not expose raw backend errors to users", async () => {
  const controller = new AbortController();
  const sentMessages: Array<Record<string, unknown>> = [];
  let pollCount = 0;

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);

    if (url.includes("api.telegram.org") && url.endsWith("/getUpdates")) {
      pollCount += 1;
      if (pollCount === 1) {
        return mockResponse({
          ok: true,
          result: [{ update_id: 1, message: { chat: { id: 9, type: "private" }, text: "What is happening?" } }],
        });
      }
      controller.abort();
      return mockResponse({ ok: true, result: [] });
    }

    if (url.includes("api.telegram.org") && url.endsWith("/sendMessage")) {
      sentMessages.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return mockResponse({ ok: true, result: { message_id: 2 } });
    }

    return mockResponse({ error: "SENSITIVE_INTERNAL_PROVIDER_TRACE" }, 500);
  };

  await runTelegramBot({
    token: "test-token",
    handeloBaseUrl: "https://handelo.test",
    signal: controller.signal,
    fetch: fakeFetch,
    onError: () => undefined,
  });

  assert.equal(sentMessages.length, 1);
  assert.match(String(sentMessages[0].text), /could not process that request right now/i);
  assert.doesNotMatch(String(sentMessages[0].text), /SENSITIVE_INTERNAL_PROVIDER_TRACE/);
});

test("Telegram polling recovers from temporary network failures and can stop cleanly", async () => {
  const controller = new AbortController();
  const loggedContexts: string[] = [];
  let waits = 0;

  await runTelegramBot({
    token: "test-token",
    signal: controller.signal,
    fetch: async () => {
      throw new Error("temporary network failure");
    },
    sleep: async (milliseconds) => {
      waits += 1;
      assert.equal(milliseconds, 1000);
      controller.abort();
    },
    onError: (context) => loggedContexts.push(context),
  });

  assert.equal(waits, 1);
  assert.deepEqual(loggedContexts, ["Telegram polling failed; retrying"]);
});

test("Telegram uses the server-side client API key configuration", () => {
  assert.match(telegramSource, /HANDELO_CLIENT_API_KEY/);
  assert.doesNotMatch(telegramSource, /HANDELO_API_KEY/);
});