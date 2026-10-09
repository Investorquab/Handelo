import { MarketResolutionError, marketClientFromEnv } from "@handelo/market";

export type McpMarketClient = Pick<ReturnType<typeof marketClientFromEnv>, "find" | "search">;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

export type McpProtocolOutcome = {
  status: number;
  body?: Record<string, unknown>;
  protocolVersion?: string;
};

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const HANDELO_MCP_TOOLS = [
  {
    name: "handelo_market_lookup",
    description: "Resolve one BSC tokenized-stock representation and return its token price, reference price, provider, contract address, and market status. This tool is read-only.",
    inputSchema: {
      type: "object",
      properties: { ticker: { type: "string", description: "Underlying ticker or token symbol, such as NVDA or NVDAB." } },
      required: ["ticker"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "handelo_market_search",
    description: "Search Binance-backed BSC tokenized-stock representations. Search results are candidates and do not imply every result has been individually validated.",
    inputSchema: {
      type: "object",
      properties: { ticker: { type: "string", description: "Ticker, token symbol, or company keyword." } },
      required: ["ticker"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
];

function rpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function jsonRpcParseError(): Record<string, unknown> {
  return rpcError(null, -32700, "Parse error");
}

function validateJsonRpc(value: unknown): JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON-RPC request");
  const message = value as Record<string, unknown>;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || !message.method.trim()) {
    throw new Error("Invalid JSON-RPC request");
  }
  if (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number") {
    throw new Error("Invalid JSON-RPC request ID");
  }
  if (message.params !== undefined && (!message.params || typeof message.params !== "object" || Array.isArray(message.params))) {
    throw new Error("Invalid JSON-RPC params");
  }
  return value as JsonRpcRequest;
}

function readTicker(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("arguments must be an object");
  const ticker = (args as Record<string, unknown>).ticker;
  if (typeof ticker !== "string" || !ticker.trim()) throw new Error("ticker is required");
  const normalized = ticker.trim().toUpperCase();
  if (normalized.length > 20) throw new Error("ticker is too long");
  return normalized;
}

function textResult(id: string | number, text: string, isError = false): McpProtocolOutcome {
  return {
    status: 200,
    body: {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text }],
        ...(isError ? { isError: true } : {}),
      },
    },
  };
}

export function createMcpProtocolHandler(market: McpMarketClient) {
  return async (value: unknown): Promise<McpProtocolOutcome> => {
    let message: JsonRpcRequest;
    try {
      message = validateJsonRpc(value);
    } catch {
      return { status: 200, body: rpcError(null, -32600, "Invalid Request") };
    }

    const id = message.id;
    if (id === undefined) return { status: 202 };

    if (message.method === "initialize") {
      const requested = message.params?.protocolVersion;
      const protocolVersion = typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      return {
        status: 200,
        protocolVersion,
        body: {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "handelo-mcp", version: "0.2.0" },
            instructions: "Handelo MCP provides read-only tokenized-stock market intelligence. Search results are candidate representations, not proof that every result is validated. This server cannot sign or execute transactions.",
          },
        },
      };
    }

    if (message.method === "ping") {
      return { status: 200, body: { jsonrpc: "2.0", id, result: {} } };
    }

    if (message.method === "tools/list") {
      return { status: 200, body: { jsonrpc: "2.0", id, result: { tools: HANDELO_MCP_TOOLS } } };
    }

    if (message.method !== "tools/call") {
      return { status: 200, body: rpcError(id, -32601, "Method not found") };
    }

    const toolName = typeof message.params?.name === "string" ? message.params.name : "";
    if (toolName !== "handelo_market_lookup" && toolName !== "handelo_market_search") {
      return { status: 200, body: rpcError(id, -32602, "Unknown tool: " + toolName) };
    }

    let ticker: string;
    try {
      ticker = readTicker(message.params?.arguments);
    } catch (error) {
      return { status: 200, body: rpcError(id, -32602, error instanceof Error ? error.message : "Invalid tool arguments") };
    }

    try {
      if (toolName === "handelo_market_lookup") {
        const asset = await market.find(ticker);
        return textResult(id, JSON.stringify({
          ticker: asset.underlyingTicker,
          underlyingName: asset.underlyingName,
          tokenSymbol: asset.tokenSymbol,
          provider: asset.platformId,
          chainId: asset.binanceChainId,
          tokenPrice: asset.tokenPrice,
          referencePrice: asset.referencePrice,
          market: asset.statusInfo,
          contract: asset.tokenContractAddress,
        }, null, 2));
      }

      const results = await market.search(ticker);
      return textResult(id, JSON.stringify(results, null, 2));
    } catch (error) {
      if (error instanceof MarketResolutionError) return textResult(id, error.message, true);

      console.error("[Handelo MCP] Market tool failed:", error instanceof Error ? error.message.slice(0, 300) : "Unknown error");
      return textResult(id, "Handelo could not retrieve market data right now. Check the server-side provider configuration and try again.", true);
    }
  };
}
