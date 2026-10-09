import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramHandler, formatHandeloResponse, runTelegramBot, isTelegramEntrypoint } from "./index.js";
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

test("Telegram formats Markdown bold and inline code as safe HTML", () => {
  const text = formatHandeloResponse({
    answer: "The market is **OPEN** at `180`. Never trust <script>alert(1)</script> & raw HTML.",
  } as AgentResult);

  assert.match(text, /<b>OPEN<\/b>/);
  assert.match(text, /<code>180<\/code>/);
  assert.match(text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(text, /&amp;/);
  assert.doesNotMatch(text, /\*\*OPEN\*\*/);
});


test("Telegram converts Markdown headings, lists and tables into polished chat formatting", () => {
  const text = formatHandeloResponse({
    answer: [
      "### 1. Why diversify?",
      "Diversification spreads risk across different assets.",
      "",
      "* **Sector tilt:** Avoid concentrating everything in one sector.",
      "* **Liquidity:** Low liquidity can increase slippage.",
      "",
      "| Allocation | Approx. $ amount | Reason |",
      "| --- | --- | --- |",
      "| Large-cap US tech | $30 | Established companies with growth potential. |",
      "| Consumer staples | $20 | Adds a more defensive sector. |",
    ].join("\n"),
  } as AgentResult);

  assert.ok(text.includes("<b>1. Why diversify?</b>"));
  assert.ok(text.includes("• <b>Sector tilt:</b> Avoid concentrating everything in one sector."));
  assert.ok(text.includes("• <b>Liquidity:</b> Low liquidity can increase slippage."));
  assert.ok(text.includes("<b>Large-cap US tech</b>"));
  assert.equal(text.match(/Large-cap US tech/g)?.length, 1, "each table row should render once");
  assert.ok(text.includes("<b>Approx. $ amount:</b> $30"));
  assert.ok(text.includes("<b>Reason:</b> Established companies with growth potential."));
  assert.ok(!text.includes("###"));
  assert.ok(!text.includes("| --- |"));
  assert.ok(!text.includes("| Allocation |"));
});

test("Telegram response stays within its message-size budget", () => {
  const text = formatHandeloResponse({ answer: "😀".repeat(6000) } as AgentResult);
  const visibleText = text.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt);/g, "x");

  assert.ok(Array.from(visibleText).length <= 3900);
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


test("Telegram sends formatted responses using HTML parse mode", async () => {
  let sent: Record<string, unknown> | undefined;
  const client = {
    chat: async (): Promise<AgentResult> => ({ answer: "The market is **OPEN**." } as AgentResult),
  };
  const transport = {
    call: async <T>(_method: string, body?: Record<string, unknown>): Promise<T> => {
      sent = body;
      return {} as T;
    },
  };

  await createTelegramHandler(client, transport)({
    update_id: 10,
    message: { chat: { id: 1, type: "private" }, text: "market status" },
  });

  assert.equal(sent?.parse_mode, "HTML");
  assert.match(String(sent?.text), /<b>OPEN<\/b>/);
});

test("Telegram uses the server-side client API key configuration", () => {
  assert.match(telegramSource, /HANDELO_CLIENT_API_KEY/);
  assert.doesNotMatch(telegramSource, /HANDELO_API_KEY/);
});

test("Telegram entrypoint detection supports PM2's ESM process wrapper", () => {
  const moduleUrl = new URL("./index.ts", import.meta.url).href;
  const modulePath = fileURLToPath(new URL(moduleUrl));

  assert.equal(
    isTelegramEntrypoint(moduleUrl, "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js", modulePath),
    true,
  );
  assert.equal(isTelegramEntrypoint(moduleUrl, modulePath, undefined), true);
  assert.equal(isTelegramEntrypoint(moduleUrl, "/opt/other/index.ts", undefined), false);
});
