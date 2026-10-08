# Handelo

**Understand. Strategize. Execute.**

Handelo is an AI operating layer for tokenized-stock markets on BNB Smart Chain. It combines live market intelligence, natural-language strategy construction, portfolio context, deterministic risk controls, human-approved transaction review, and a secured Agentic Wallet boundary.

## Product workflow

Discover → Understand → Strategize → Check Risk → Review → Approve → Execute → Monitor

Handelo is not a chatbot-only product. The web workspace keeps market and portfolio context visible beside persistent AI Chat.

## Product surfaces

### Web

Handelo has exactly two primary web pages:

1. **Home** — product narrative, workflow and real UI demonstrations.
2. **Workspace** — one persistent application page with financial/market context on the left and AI Chat on the right.

The Home page provides two entry paths:

- **Try Demo** — zero-setup evaluation using the configured Handelo Agentic Wallet.
- **Connect Wallet** — user mode for a BSC-compatible personal wallet.

### SDK

`@handelo/sdk` provides a typed client for sending natural-language requests to the same Handelo runtime.

### MCP

`@handelo/mcp` exposes read-only tokenized-stock market-intelligence tools. MCP is not a signing boundary.

### Telegram

`@handelo/telegram` provides a private-chat conversational client over the same runtime. It does not hold private keys or bypass risk/review controls.

## Architecture

```
                         HANDELO
                            │
              ┌─────────────┴─────────────┐
              │                           │
         Personal Wallet             Agent Wallet
              │                           │
          User-owned                Agent-controlled
              │                    within policy
              └─────────────┬─────────────┘
                            │
                     Handelo Core
                            │
             ┌──────────────┼──────────────┐
             │              │              │
        Intelligence    Strategies     Portfolio
             │              │              │
             └──────────────┼──────────────┘
                            │
                      Risk Governor
                            │
                     Authorization
                            │
                        Execution
                            │
                           BSC
```

The long-term agent-wallet architecture uses BNB-supported wallet/agent infrastructure where appropriate. Personal-wallet connection does not automatically grant spending authority.

## Demo mode

Try Demo is designed for hackathon judges and product evaluation.

The judge should not need to:
- create API credentials;
- provide private keys;
- configure a wallet;
- install developer tooling.

The configured demo environment may use a deliberately funded Handelo Agentic Wallet for real demonstration transactions. The UI must disclose Demo Mode, and simulated actions must be labelled as simulated.

## User wallet mode

Connect Wallet is intended for normal BSC-compatible EVM wallets.

A connected personal wallet can establish identity and provide supported portfolio information. Autonomous spending requires a separate, explicit authorization/delegation model; simply connecting a wallet never gives the AI unrestricted access to funds.

## Agent wallet

Handelo's autonomous execution model uses a dedicated agent execution context. The agent wallet private key must never be exposed to the LLM or browser UI.

BNB Agent Studio and its supported wallet providers are being evaluated as the native infrastructure for agent wallet, signing, identity and runtime concerns. The exact provider and funding/delegation model is locked only after mainnet capability validation.

See `docs/AGENT-WALLET-ARCHITECTURE.md` for the architecture gate.

## Local development

```bash
pnpm install
pnpm check
pnpm test
```

Run the API:

```bash
pnpm --filter @handelo/api dev
```

The web client uses `http://localhost:8787` by default.

### SDK

```ts
import { createHandeloClient } from "@handelo/sdk";

const handelo = createHandeloClient({
  baseUrl: "http://localhost:8787",
});

const result = await handelo.chat({
  message: "What is happening with NVIDIA?",
});
```

### Telegram

Set:

- `TELEGRAM_BOT_TOKEN`
- `HANDELO_API_URL` (optional; defaults to local API)
- `HANDELO_CLIENT_API_KEY` when required by the API

Then:

```bash
pnpm --filter @handelo/telegram start
```

The bot accepts private chats only.

## Live market data

Configure Binance Web3 credentials in the runtime environment:

- `BINANCE_WEB3_API_KEY`
- `BINANCE_WEB3_SECRET_KEY`

Never commit secrets or private keys.

## Security boundary

- Personal wallet private keys never enter the LLM.
- Agent wallet private keys never enter the LLM or browser UI.
- Wallet connection does not equal spending authorization.
- Transaction execution requires the appropriate explicit approval or delegated policy.
- Risk and market checks are re-run at the execution boundary.
- Unsupported or unavailable security/audit paths remain blocking conditions.
- Handelo never fabricates transaction hashes or execution success.
- Ambiguous tokenized-stock representations are surfaced rather than silently selected.
- Autonomous execution must be idempotent and revocable.

## Current validation status

The repository uses GitHub Actions for TypeScript checks, frontend syntax checks and the full workspace test suite. The current web workspace is backed by live market data, real wallet status/address/guardrails, live BSC portfolio reconciliation, deterministic policy/risk review, security-audit gating and explicit execution boundaries.

The transaction review surface is server-authoritative through `/api/review`: the browser does not run a second policy engine. PASS/READY, confirmation-required and BLOCK outcomes, policy reasons, quote quality and security-audit failures are surfaced from the runtime. Incomplete or unavailable token-security audit results fail closed before execution.

P&L is displayed only when trustworthy acquisition cost basis is available. Handelo does not infer historical cost from current balances. Local/live browser validation and controlled real-money validation remain explicit later gates.

## Hackathon direction

Handelo is being built for the BNB Hack: Tokenized Stocks Edition with BSC mainnet tokenized-stock infrastructure at the center of the product. Final deployment, live demo evidence, demo video and submission packaging remain separate final-stage work.
