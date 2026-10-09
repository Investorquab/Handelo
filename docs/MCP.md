# Handelo MCP

Handelo exposes read-only market-intelligence tools to MCP-compatible clients.

## Local stdio

For MCP clients that can launch a local subprocess:

```bash
pnpm --filter @handelo/mcp start
```

## Claude.ai remote connector

Claude.ai custom connectors use a remote MCP server reachable from Anthropic's cloud. The local stdio process is not usable by Claude.ai in the browser; deploy the authenticated Streamable HTTP transport on a server with a public HTTPS hostname.

Follow [VPS deployment](./VPS-DEPLOYMENT.md) to run the HTTP transport under PM2 and publish it through Nginx with TLS. The MCP process binds to `127.0.0.1:8789`; do not expose that port directly to the internet. A tunnel is not needed for the VPS deployment.

Required repository-root `.env` variables:

- `BINANCE_WEB3_API_KEY`
- `BINANCE_WEB3_SECRET_KEY`
- `HANDELO_MCP_API_KEY` — use a random secret of at least 32 characters; never commit it

Optional:

- `HANDELO_MCP_PORT` (default `8789`)
- `HANDELO_MCP_ALLOWED_ORIGINS` (default `https://claude.ai,https://www.claude.ai`)

Generate a secret on the VPS:

```bash
openssl rand -hex 32
```

Start locally for development with:

```bash
pnpm --filter @handelo/mcp start:http
```

The HTTP process exposes a minimal `GET /health` endpoint plus authenticated `POST /mcp`. Every MCP request must include the `X-Handelo-MCP-Key` request header. Request bodies are limited, configured origins are allowlisted, and provider/internal errors are not returned verbatim to Claude.

## Tools

- `handelo_market_lookup`
- `handelo_market_search`

Search results identify candidate representations and must not be treated as proof that every result is validated. The currently individually validated asset remains NVIDIA (NVDA) represented by NVDAB on BNB Chain.

MCP is not a wallet/signing boundary. It receives no private keys and has no execution tool.
