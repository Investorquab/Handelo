# Handelo API

The first Handelo agent runtime.

## Environment

Set:
- `HANDELO_API_KEY` (or `API_KEY`) — a Groq, OpenAI, or Anthropic API key.
- `HANDELO_CLIENT_API_KEY` — optional shared client key for `/api/chat`; required when configured and sent as `x-handelo-api-key`.
- `BINANCE_WEB3_API_KEY`
- `BINANCE_WEB3_SECRET_KEY`

No provider/model selection is required. Handelo detects the provider from the key and uses a tested model for that provider.

## Run

```bash
pnpm --filter @handelo/api dev
```

Health: `GET /health`

Agent: `POST /api/chat`

```json
{"message":"I have $20. Tell me what is happening with NVIDIA."}
```

The agent resolves live BSC tokenized-stock data before explaining the market when a ticker is present.


## Wallet execution

Install Binance Agentic Wallet so the `baw` CLI is available. Handelo uses its quote, market-order, and order-status commands rather than holding a private key in the application.

The quote endpoint is:

```text
POST /api/quote
{"ticker":"NVDA","fromTokenQty":"20","fromToken":"0x..."}
```

Execution is disabled by default. For a controlled demo only, set `HANDELO_EXECUTION_ENABLED=true` and send `POST /api/execute` with `confirmed:true`. The execution adapter performs a token security audit, checks wallet availability, submits the market order, and polls until FINISHED, FAILED, or still PENDING.

Never place a private key in Handelo environment variables.
