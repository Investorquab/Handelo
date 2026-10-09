# Handelo MCP

Handelo exposes read-only market-intelligence tools to MCP-compatible clients.

## Local stdio

For MCP clients that can launch a local subprocess:

\`\`\`bash
pnpm --filter @handelo/mcp start
\`\`\`

## Claude.ai remote connector

Claude.ai custom connectors require a remote MCP server that is reachable from Anthropic's cloud. They cannot launch Handelo's local stdio process, so use the authenticated Streamable HTTP transport.

Required repository-root \`.env\` variables:

- \`BINANCE_WEB3_API_KEY\`
- \`BINANCE_WEB3_SECRET_KEY\`
- \`HANDELO_MCP_API_KEY\` — use a random secret of at least 32 characters; never commit it

Optional:

- \`HANDELO_MCP_PORT\` (default \`8789\`)
- \`HANDELO_MCP_ALLOWED_ORIGINS\` (default \`https://claude.ai,https://www.claude.ai\`)

Generate a secret locally with Node.js:

\`\`\`powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
\`\`\`

Start the HTTP process:

\`\`\`bash
pnpm --filter @handelo/mcp start:http
\`\`\`

It binds only to loopback and exposes a minimal \`GET /health\` endpoint plus authenticated \`POST /mcp\`. Every MCP request must include the \`X-Handelo-MCP-Key\` request header. Bodies are limited, provided origins are allowlisted, and provider/internal errors are not returned verbatim to Claude.

For initial testing, run a temporary HTTPS tunnel to \`http://127.0.0.1:8789\`, then add the resulting public URL plus \`/mcp\` in Claude.ai under **Customize → Connectors → Add custom connector**. Configure the fixed request header \`X-Handelo-MCP-Key\` with the secret from the local \`.env\`. Stop the tunnel after validation; permanent hosting remains a later deployment step.

## Tools

- \`handelo_market_lookup\`
- \`handelo_market_search\`

Search results identify candidate representations and must not be treated as proof that every result is validated. The currently individually validated asset remains NVIDIA (NVDA) represented by NVDAB on BNB Chain.

MCP is not a wallet/signing boundary. It receives no private keys and has no execution tool.
