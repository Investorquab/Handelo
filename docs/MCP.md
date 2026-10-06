# Handelo MCP

Handelo exposes market-intelligence tools through a small MCP server.

The intended flow is:

```
Claude / Cursor / MCP client
          ↓
     Handelo MCP
          ↓
  live BSC stock data
          ↓
 Handelo market/policy core
```

MCP is intentionally not the signing boundary. A developer can inspect tokenized-stock conditions from an IDE or agent without giving the MCP process transaction-signing authority.

## Local configuration

Configure the MCP client to launch:

```bash
pnpm --filter @handelo/mcp start
```

Required environment:

- `BINANCE_WEB3_API_KEY`
- `BINANCE_WEB3_SECRET_KEY`

Do not put private keys into MCP configuration.
