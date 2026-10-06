# Handelo MCP

Read-only developer tools for tokenized-stock market intelligence.

## Tools

- `handelo_market_lookup`
- `handelo_market_search`

The server does not sign or broadcast transactions. Execution remains behind Handelo's deterministic policy and secured wallet boundary.

## Run

```bash
pnpm --filter @handelo/mcp start
```

The process speaks JSON-RPC over stdin/stdout so it can be hosted by MCP-compatible developer tools.

BNB Agent Studio's own MCP surface is also read-only; Handelo follows the same separation and keeps signing outside MCP.
