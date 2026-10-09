import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

const MAX_TELEGRAM_MESSAGE_LENGTH = 3900;
const SAFE_FAILURE_REPLY = "Handelo could not process that request right now. Please try again shortly.";
const INITIAL_POLL_RETRY_MS = 1000;
const MAX_POLL_RETRY_MS = 30_000;

export interface TelegramTransport {
  call<T>(method: string, body?: Record<string, unknown>): Promise<T>;
}

export interface TelegramBotOptions {
  token: string;
  handeloBaseUrl?: string;
  handeloApiKey?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  onError?: (context: string, error: unknown) => void;
}

function fitTelegramMessage(message: string): string {
  const characters = Array.from(message);
  if (characters.length <= MAX_TELEGRAM_MESSAGE_LENGTH) return message;

  const suffix = "\n\n[Response shortened. Ask a follow-up for more detail.]";
  const suffixLength = Array.from(suffix).length;
  return characters
    .slice(0, MAX_TELEGRAM_MESSAGE_LENGTH - suffixLength)
    .join("")
    .trimEnd() + suffix;
}

export function formatHandeloResponse(result: AgentResult): string {
  const sections = [result.answer.trim()];

  if (result.market) {
    const gap = result.market.premiumPct === null ? "n/a" : result.market.premiumPct.toFixed(2) + "%";
    sections.push(
      [
        "MARKET INSIGHT",
        "Asset: " + result.market.tokenSymbol,
        "Provider: " + result.market.provider,
        "On-chain: " + result.market.tokenPrice,
        "Reference: " + result.market.referencePrice,
        "Divergence: " + gap,
        "Status: " + result.market.marketStatus,
      ].join("\n"),
    );
  }

  if (result.strategy) {
    sections.push(
      [
        "STRATEGY PREVIEW",
        "Type: " + result.strategy.type,
        "Asset: " + result.strategy.asset,
        result.strategy.amountUsd === undefined ? null : "Amount: $" + result.strategy.amountUsd,
        result.strategy.frequency ? "Frequency: " + result.strategy.frequency : null,
        "Status: " + result.strategy.status,
        "No strategy is activated by Telegram.",
      ].filter(Boolean).join("\n"),
    );
  }

  if (result.policy) {
    sections.push(
      [
        "RISK RESULT",
        "Decision: " + result.policy.decision,
        "Reason: " + (result.policy.reasons[0] ?? "No reason supplied."),
      ].join("\n"),
    );
  }

  if (result.basket) {
    sections.push(
      [
        "BASKET PREVIEW",
        "Name: " + result.basket.name,
        "Assets: " + result.basket.assets.map((asset) => asset.asset).join(", "),
      ].join("\n"),
    );
  }

  const message = sections.filter((section) => section.trim()).join("\n\n") || "Handelo did not return a response.";
  return fitTelegramMessage(message);
}

export function createTelegramTransport(
  token: string,
  requestFetch: typeof globalThis.fetch = globalThis.fetch,
  signal?: AbortSignal,
): TelegramTransport {
  const base = "https://api.telegram.org/bot" + token;
  return {
    async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
      const response = await requestFetch(base + "/" + method, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const payload = await response.json() as TelegramResponse<T>;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.description ?? "Telegram API request failed with HTTP " + response.status);
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

    const command = text.match(/^\/(start|help)(?:@\w+)?(?:\s|$)/i)?.[1]?.toLowerCase();
    if (command === "start") {
      await transport.call("sendMessage", {
        chat_id: message.chat.id,
        text: "Welcome to Handelo. Ask me about tokenized-stock markets, strategies, risk, or transaction reviews.",
      });
      return;
    }

    if (command === "help") {
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

function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveWait) => {
    if (signal?.aborted) {
      resolveWait();
      return;
    }

    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolveWait();
    };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function reportError(options: TelegramBotOptions, context: string, error: unknown): void {
  if (options.onError) {
    try {
      options.onError(context, error);
    } catch {
      // Diagnostics must never crash the bot.
    }
    return;
  }

  const detail = error instanceof Error ? error.name + ": " + error.message : String(error);
  console.error("[Handelo Telegram] " + context + ": " + detail.slice(0, 300));
}

export async function runTelegramBot(options: TelegramBotOptions): Promise<void> {
  if (typeof options.token !== "string" || !options.token.trim()) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }

  const requestFetch = options.fetch ?? globalThis.fetch;
  if (!requestFetch) throw new Error("fetch is required");

  const transport = createTelegramTransport(options.token, requestFetch, options.signal);
  const client = createHandeloClient({
    baseUrl: options.handeloBaseUrl?.trim() || process.env.HANDELO_API_URL?.trim() || "http://localhost:8787",
    apiKey: options.handeloApiKey ?? process.env.HANDELO_CLIENT_API_KEY,
    fetch: requestFetch,
  });
  const handleUpdate = createTelegramHandler(client, transport);
  const sleep = options.sleep ?? ((milliseconds: number) => waitForRetry(milliseconds, options.signal));

  let offset = 0;
  let retryDelayMs = INITIAL_POLL_RETRY_MS;

  while (!options.signal?.aborted) {
    let updates: TelegramUpdate[];
    try {
      updates = await transport.call<TelegramUpdate[]>("getUpdates", {
        timeout: 25,
        offset,
        allowed_updates: ["message"],
      });
      retryDelayMs = INITIAL_POLL_RETRY_MS;
    } catch (error) {
      if (options.signal?.aborted) break;
      reportError(options, "Telegram polling failed; retrying", error);
      await sleep(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_POLL_RETRY_MS);
      continue;
    }

    for (const update of updates) {
      if (options.signal?.aborted) break;
      offset = Math.max(offset, update.update_id + 1);

      try {
        await handleUpdate(update);
      } catch (error) {
        reportError(options, "Could not process a Telegram update", error);
        const message = update.message;
        if (message?.chat.type === "private") {
          try {
            await transport.call("sendMessage", {
              chat_id: message.chat.id,
              text: SAFE_FAILURE_REPLY,
            });
          } catch (sendError) {
            reportError(options, "Could not send the failure reply", sendError);
          }
        }
      }
    }
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPath) {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  await runTelegramBot({
    token: process.env.TELEGRAM_BOT_TOKEN ?? "",
    handeloBaseUrl: process.env.HANDELO_API_URL,
    handeloApiKey: process.env.HANDELO_CLIENT_API_KEY,
    signal: controller.signal,
  });
}