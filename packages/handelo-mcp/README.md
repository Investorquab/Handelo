# Handelo MCP

Handelo MCP exposes read-only developer tools for tokenized-stock market intelligence. It does not sign, broadcast, or execute transactions.

## Tools

- \`handelo_market_lookup\` — resolve one BSC tokenized-stock representation and return token/reference prices, provider, contract, and market status.
- \`handelo_market_search\` — search candidate BSC tokenized-stock representations. Results do not prove every asset is individually validated.

## Local stdio client

Use this for MCP clients that can launch a local process:

\`\`\`bash
pnpm --filter @handelo/mcp start
\`\`\`

Required server-side variables:

- \`BINANCE_WEB3_API_KEY\`
- \`BINANCE_WEB3_SECRET_KEY\`

## Claude.ai remote connector

Claude.ai custom connectors require an internet-reachable remote MCP server; they cannot launch this repository's local stdio process. Handelo provides a separate authenticated Streamable HTTP transport for this case.

Set these in the repository root \`.env\` file:

- \`BINANCE_WEB3_API_KEY\`
- \`BINANCE_WEB3_SECRET_KEY\`
- \`HANDELO_MCP_API_KEY\` — a unique random secret with at least 32 characters
- Optional \`HANDELO_MCP_PORT\` (default \`8789\`)
- Optional \`HANDELO_MCP_ALLOWED_ORIGINS\` (default \`https://claude.ai,https://www.claude.ai\`)

Generate a strong secret locally:

\`\`\`powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
\`\`\`

Keep the secret private. Do not commit it or share it in chat.

Start the HTTP transport:

\`\`\`bash
pnpm --filter @handelo/mcp start:http
\`\`\`

The server binds to \`127.0.0.1\` and exposes \`GET /health\` and an authenticated \`POST /mcp\` endpoint. Every MCP request needs the \`X-Handelo-MCP-Key\` header. If an \`Origin\` header is present, it must match the allowlist. Provider credentials stay server-side.

### Temporary Claude.ai test

A public HTTPS tunnel must run on the same machine as this server. For example, if Cloudflare Tunnel is installed:

\`\`\`bash
cloudflared tunnel --url http://127.0.0.1:8789
\`\`\`

Use the printed HTTPS URL followed by \`/mcp\` as Claude's custom connector URL. Configure the fixed request header \`X-Handelo-MCP-Key\` using the secret from the local \`.env\`. Select no OAuth sign-in because Handelo uses a fixed key for this controlled test.

Remove the temporary connector and stop the tunnel after testing. A temporary tunnel is not production deployment.

## Security boundary

MCP exposes only read-only market lookup and search. It never receives private keys and has no transaction-execution tool. Search results are candidates; the currently individually validated asset remains NVIDIA (NVDA) represented by NVDAB on BNB Chain.
