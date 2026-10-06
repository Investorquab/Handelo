import { createHandeloClient, type HandeloClient } from "@handelo/sdk";
import type { AgentResult } from "@handelo/agent";

type TelegramChat = { id: number; type: string };
type TelegramMessage = { chat: TelegramChat; text?: string };
type TelegramUpdate = { update_id: number; message?: TelegramMessage };

type TelegramResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

export interface TelegramTransport {
  call<T>(method: string, body?: Record<string, unknown>): Promise<T>;
}

export interface TelegramBotOptions {
  token: string;
  apiBaseUrl?: string;
  handeloBaseUrl?: string;
  handeloApiKey?: string;
  fetch?: typeof globalThis.fetch;
}

export function formatHandeloResponse(result: AgentResult): string {
  const sections = [result.answer.trim()];

  if (result.market) {
    const gap = result.market.premiumPct === null ? "n/a" : `${result.market.premiumPct.toFixed(2)}%`;
    sections.push(
      [
        "MARKET INSIGHT",
        `Asset: ${result.market.tokenSymbol}`,
        `Provider: ${result.market.provider}`,
        `On-chain: ${result.market.tokenPrice}`,
        `Reference: ${result.market.referencePrice}`,
        `Divergence: ${gap}`,
        `Status: ${result.market.marketStatus}`,
      ].join("\n"),
    );
  }

  if (result.strategy) {
    sections.push(
      [
        "STRATEGY PREVIEW",
        `Type: ${result.strategy.type}`,
        `Asset: ${result.strategy.asset}`,
        result.strategy.amountUsd === undefined ? null : `Amount: $${result.strategy.amountUsd}`,
        result.strategy.frequency ? `Frequency: ${result.strategy.frequency}` : null,
        `Status: ${result.strategy.status}`,
        "No strategy is activated by Telegram.",
      ].filter(Boolean).join("\n"),
    );
  }

  if (result.policy) {
    sections.push(
      [
        "RISK RESULT",
        `Decision: ${result.policy.decision}`,
        `Reason: ${result.policy.reasons[0] ?? "No reason supplied."}`,
      ].join("\n"),
    );
  }

  if (result.basket) {
    sections.push(
      [
        "BASKET PREVIEW",
        `Name: ${result.basket.name}`,
        `Assets: ${result.basket.assets.map((asset) => asset.asset).join(", ")}`,
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

export function createTelegramTransport(
  token: string,
  requestFetch: typeof globalThis.fetch = globalThis.fetch,
): TelegramTransport {
  const base = `https://api.telegram.org/bot${token}`;
  return {
    async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
      const response = await requestFetch(`${base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as TelegramResponse<T>;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.description ?? `Telegram API request failed with HTTP ${response.status}`);
      }
      return payload.result;
    },
  };
}

export function createTelegramHandler(client: HandeloClient, transport: TelegramTransport) {
  return async (update: TelegramUpdate): Promise<void> => {
    const message = update.message;
    if (!message || message.chat.type !== "private") return;

    const text = message.text?.trim();
    if (!text) return;

    if (text === "/start") {
      await transport.call("sendMessage", {
        chat_id: message.chat.id,
        text: "Welcome to Handelo. Ask me about tokenized-stock markets, strategies, risk, or transaction reviews.",
      });
      return;
    }

    if (text === "/help") {
      await transport.call("sendMessage", {
        chat_id: message.chat.id,
        text: "Try: What is happening with NVIDIA?\n\nYou can also ask for a DCA, a basket, or a risk/review explanation. Telegram does not hold private keys or activate strategies.",
      });
      return;
    }

    const result: AgentResult = await client.chat({ message: text });
    await transport.call("sendMessage", {
      chat_id: message.chat.id,
      text: formatHandeloResponse(result),
      disable_web_page_preview: true,
    });
  };
}

export async function runTelegramBot(options: TelegramBotOptions): Promise<void> {
  if (!options.token.trim()) throw new Error("TELEGRAM_BOT_TOKEN is required");

  const requestFetch = options.fetch ?? globalThis.fetch;
  if (!requestFetch) throw new Error("fetch is required");

  const transport = createTelegramTransport(options.token, requestFetch);
  const client = createHandeloClient({
    baseUrl: options.handeloBaseUrl ?? process.env.HANDELO_API_URL ?? "http://localhost:8787",
    apiKey: options.handeloApiKey ?? process.env.HANDELO_CLIENT_API_KEY,
    fetch: requestFetch,
  });
  const handleUpdate = createTelegramHandler(client, transport);

  let offset = 0;
  for (;;) {
    const updates = await transport.call<TelegramUpdate[]>("getUpdates", {
      timeout: 25,
      offset,
      allowed_updates: ["message"],
    });

    for (const update of updates) {
      offset = Math.max(offset, update.update_id + 1);
      try {
        await handleUpdate(update);
      } catch (error) {
        const message = update.message;
        if (message?.chat.type === "private") {
          await transport.call("sendMessage", {
            chat_id: message.chat.id,
            text: error instanceof Error ? error.message : "Handelo could not process that request.",
          });
        }
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runTelegramBot({
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    handeloBaseUrl: process.env.HANDELO_API_URL,
    handeloApiKey: process.env.HANDELO_CLIENT_API_KEY,
  });
}