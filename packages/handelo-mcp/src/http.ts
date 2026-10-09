import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { marketClientFromEnv } from "@handelo/market";
import { createMcpProtocolHandler, jsonRpcParseError, type McpMarketClient } from "./protocol.js";

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const DEFAULT_ALLOWED_ORIGINS = ["https://claude.ai", "https://www.claude.ai"];

export interface HandeloMcpHttpOptions {
  apiKey?: string;
  allowedOrigins?: string[];
  market?: McpMarketClient;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function safeEqual(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  let size = 0;

  for await (const chunk of req) {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    size += Buffer.byteLength(text);
    if (size > MAX_REQUEST_BODY_BYTES) throw new RangeError("Request body is too large.");
    raw += text;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new SyntaxError("Request body must be valid JSON.");
  }
}

export function createHandeloMcpHttpServer(options: HandeloMcpHttpOptions = {}): Server {
  const apiKey = options.apiKey ?? process.env.HANDELO_MCP_API_KEY ?? "";
  if (apiKey.length < 32) {
    throw new Error("HANDELO_MCP_API_KEY must be configured with at least 32 characters before HTTP MCP can start.");
  }

  const configuredOrigins = process.env.HANDELO_MCP_ALLOWED_ORIGINS;
  const allowedOrigins = options.allowedOrigins ?? (
    configuredOrigins
      ? configuredOrigins.split(",").map((value) => value.trim()).filter(Boolean)
      : DEFAULT_ALLOWED_ORIGINS
  );
  const market = options.market ?? marketClientFromEnv();
  const handleMessage = createMcpProtocolHandler(market);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, service: "handelo-mcp-http" });
      return;
    }

    if (url.pathname !== "/mcp") {
      json(res, 404, { error: "Not found" });
      return;
    }

    if (req.method === "GET") {
      res.writeHead(405, { allow: "POST", "cache-control": "no-store" });
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST", "cache-control": "no-store" });
      res.end();
      return;
    }

    const presentedKey = req.headers["x-handelo-mcp-key"];
    const candidate = typeof presentedKey === "string" ? presentedKey.trim() : "";
    if (!safeEqual(candidate, apiKey)) {
      json(res, 401, { error: "A valid X-Handelo-MCP-Key header is required." });
      return;
    }

    const origin = req.headers.origin;
    if (typeof origin === "string" && origin && !allowedOrigins.includes(origin)) {
      json(res, 403, { error: "Origin is not allowed." });
      return;
    }

    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      json(res, 415, { error: "Content-Type must be application/json." });
      return;
    }

    let request: unknown;
    try {
      request = await readJsonBody(req);
    } catch (error) {
      if (error instanceof RangeError) {
        json(res, 413, { error: "Request body is too large." });
        return;
      }
      json(res, 400, jsonRpcParseError());
      return;
    }

    try {
      const outcome = await handleMessage(request);
      if (outcome.status === 202 || !outcome.body) {
        res.writeHead(202, { "cache-control": "no-store" });
        res.end();
        return;
      }

      const responseVersion = outcome.protocolVersion ?? req.headers["mcp-protocol-version"];
      res.writeHead(outcome.status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(typeof responseVersion === "string" && responseVersion ? { "mcp-protocol-version": responseVersion } : {}),
      });
      res.end(JSON.stringify(outcome.body));
    } catch (error) {
      console.error("[Handelo MCP] Protocol handler failed:", error instanceof Error ? error.message.slice(0, 300) : "Unknown error");
      json(res, 500, { error: "Handelo MCP could not complete the request." });
    }
  });
}

export function isHandeloMcpHttpEntrypoint(moduleUrl: string, argvPath?: string, pm2ExecPath?: string): boolean {
  const modulePath = resolve(fileURLToPath(moduleUrl));
  return [argvPath, pm2ExecPath].some(
    (candidate) => typeof candidate === "string" && candidate.length > 0 && resolve(candidate) === modulePath,
  );
}

if (isHandeloMcpHttpEntrypoint(import.meta.url, process.argv[1], process.env.pm_exec_path)) {
  try {
    const server = createHandeloMcpHttpServer();
    const port = Number(process.env.HANDELO_MCP_PORT ?? "8789");
    server.listen(port, "127.0.0.1", () => {
      console.log("Handelo remote MCP listening on http://127.0.0.1:" + port + "/mcp");
    });
  } catch (error) {
    console.error("[Handelo MCP] Startup failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  }
}
