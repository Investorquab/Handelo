# Handelo

<p align="center">
  <strong>Understand. Strategize. Execute.</strong>
</p>

<p align="center">
  An AI operating layer for tokenized-stock markets on BNB Smart Chain.
</p>

<p align="center">
  <a href="https://github.com/Investorquab/Handelo">Repository</a> ·
  <a href="https://github.com/Investorquab/Handelo#architecture">Architecture</a> ·
  <a href="https://github.com/Investorquab/Handelo/blob/main/docs/DEVELOPER-EXPERIENCE.md">Developer Experience</a> ·
  <a href="https://github.com/Investorquab/Handelo/blob/main/docs/HANDELO-LIVE-VALIDATION.md">Live Validation</a>
</p>

> **BNB Hack: Tokenized Stocks Edition**
>
> Handelo is built around a simple observation: traditional stock markets can close while tokenized representations continue trading on-chain. The result is a market that needs more than a buy button — it needs context, strategy, risk controls, wallet authority, execution discipline and verification in one decision path.

**Status:** active hackathon build  
**Current validated asset:** NVIDIA (NVDA) represented by NVDAB on BNB Chain  
**Primary network:** BNB Smart Chain mainnet · Chain ID 56  
**Primary application surfaces:** Home + Workspace

---

## Contents

- [What is Handelo?](#what-is-handelo)
- [Why we built it](#why-we-built-it)
- [The problem](#the-problem)
- [The product idea](#the-product-idea)
- [How the system works](#how-the-system-works)
- [Architecture](#architecture)
- [Seven capabilities](#seven-capabilities)
- [Wallet and security model](#wallet-and-security-model)
- [How we built Handelo](#how-we-built-handelo)
- [Validated scope](#validated-scope)
- [Known gaps](#known-gaps)
- [Repository structure](#repository-structure)
- [Local development](#local-development)
- [Environment configuration](#environment-configuration)
- [API](#api)
- [SDK](#sdk)
- [MCP](#mcp)
- [Telegram](#telegram)
- [Testing and CI](#testing-and-ci)
- [Developer Experience Report](#developer-experience-report)
- [Hackathon evidence](#hackathon-evidence)
- [Demo and deployment](#demo-and-deployment)
- [Roadmap](#roadmap)
- [License](#license)

---

## What is Handelo?

Handelo is an **AI operating layer for tokenized-stock markets**.

It combines:

- live market intelligence;
- natural-language interaction;
- strategy construction and scheduling;
- portfolio context;
- deterministic policy and risk checks;
- wallet permissions and guardrails;
- transaction review;
- execution;
- execution verification;
- persistent strategy runtime state.

The important distinction is that **the AI is not the safety authority**.

The model can interpret intent, explain market conditions and help construct a strategy. Deterministic application logic remains authoritative for policy, risk, authorization, transaction review, execution state and verification.

The product workflow is:

**Discover → Understand → Strategize → Check Risk → Review → Approve → Execute → Monitor**

Handelo is not a chatbot with a trading button attached to it. Chat is one control surface over a broader financial system.

---

## Why we built it

The product idea came from the shape of tokenized-stock markets.

A traditional equity reference can stop updating when the market closes. The tokenized representation can continue trading on BNB Chain. That creates a moving relationship between:

- the underlying/reference price;
- the on-chain token price;
- market-hours state;
- liquidity and execution conditions;
- portfolio exposure;
- wallet authority;
- strategy rules.

We wanted the product to answer:

> **What is happening, why does it matter, what should happen next, and is the requested action actually allowed?**

That became Handelo.

The central product principle is:

> **AI explains. The system governs. You decide.**

---

## The problem

### One company can have multiple representations

A ticker is not always enough to identify the exact tradable token representation.

Handelo preserves the selected representation rather than silently treating every token for the same underlying as interchangeable.

### Price needs context

A token price without its reference price is incomplete.

Handelo compares the on-chain representation with the underlying reference and exposes the divergence, market state and relevant timing context.

### A trade is a portfolio decision

A transaction changes exposure and reserves.

Handelo evaluates transaction conditions together with portfolio context instead of treating every order as an isolated button click.

### AI explanation is not authorization

A language model can produce a convincing instruction to buy.

That instruction must not be sufficient to move funds.

Handelo separates reasoning from deterministic policy, wallet authorization and execution.

### Execution claims must be verifiable

A successful API response, simulated result or generated transaction hash is not automatically proof of settlement.

Handelo treats execution as a lifecycle:

```
requested → reviewed → executing → verifying → finished / failed / pending
```

---

## The product idea

Handelo turns the above problems into one governed loop.

### Discover

Resolve supported tokenized-stock market information from Binance-backed BSC data.

### Understand

Explain:

- token price;
- reference price;
- gap/divergence;
- market state;
- market-hours context;
- liquidity/context;
- asset metadata.

### Strategize

Turn natural language into structured strategy intent.

Examples include:

- recurring buys;
- DCA;
- conditional actions;
- target/exposure rules;
- rebalancing logic.

### Check Risk

Run deterministic checks before an action reaches execution.

Examples include:

- transaction size;
- reference-price gap;
- market state;
- portfolio exposure;
- minimum reserve;
- strategy scope;
- wallet authority.

### Review

Create a server-authoritative transaction review containing the exact action and execution context.

### Approve

For actions requiring explicit user approval, the user remains the approval boundary.

### Execute

Only after required gates pass can an action reach the secured wallet/execution boundary.

### Monitor

Record execution state, verification, strategy history and next-run information so autonomous behavior is observable rather than implied.

---

## How the system works

A normal request can move through this path:

```
User intent
   ↓
Handelo Agent
   ↓
Market resolution
   ↓
Strategy / transaction intent
   ↓
Deterministic policy + portfolio risk
   ↓
Review
   ↓
Wallet authorization
   ↓
Quote / execution
   ↓
Verification
   ↓
Portfolio + strategy state
```

For autonomous strategy runs, the path becomes:

```
Scheduled trigger
   ↓
Load persisted strategy
   ↓
Re-evaluate strategy scope
   ↓
Re-evaluate policy + portfolio risk
   ↓
Check wallet permission
   ↓
Obtain executable quote
   ↓
Execute
   ↓
Verify
   ↓
Persist execution result
   ↓
Schedule next run
```

The autonomous path is intentionally more than a timer. It must survive retries, duplicate triggers, restart/recovery and failed execution without silently creating duplicate actions.

---

## Architecture

Handelo's core architecture follows the README architecture source of truth:

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

### Intelligence boundary

The LLM interprets intent and explains market context.

It does not receive private keys and does not define policy.

### Authority boundary

Deterministic application logic is authoritative for:

- risk;
- transaction constraints;
- approval;
- authorization;
- execution gating;
- verification.

See [docs/AGENT-WALLET-ARCHITECTURE.md](docs/AGENT-WALLET-ARCHITECTURE.md) for the detailed wallet architecture gate.

---

## Seven capabilities

### 1. Market Intelligence / Gap Radar

Resolves Binance-backed RWA data and compares the tokenized representation with its underlying reference.

### 2. AI Analyst / Chat

Provides natural-language explanation over the same runtime used by the workspace.

### 3. Strategy Engine

Supports structured, persisted strategy state including lifecycle, triggers, recurring schedules, execution records, idempotency, retry and recovery paths.

### 4. Portfolio Engine

Provides live BSC balance context, allocations, holdings and trustworthy cost-basis/P&L information where acquisition history exists.

### 5. Risk Governor

Returns deterministic decisions such as **READY**, **CONFIRM** or **BLOCK**, together with the checks and reasons behind them.

### 6. Agentic Execution

Connects approved execution to the secured Binance Agentic Wallet boundary without exposing signing authority to the LLM.

### 7. Strategy Intelligence

Combines market-hours context, price divergence, portfolio state and strategy conditions for recurring and conditional execution.

---

## Wallet and security model

### Personal wallet

The personal wallet is user-owned.

Connecting it does not automatically grant unrestricted spending authority.

### Agent wallet / execution context

The autonomous execution model uses a dedicated, policy-bounded execution context.

The agent private key must never be exposed to:

- the LLM;
- the browser;
- MCP;
- Telegram.

The architecture investigates BNB-supported wallet primitives and session/delegation models instead of inventing custom custody.

### Non-negotiable security rules

1. Private keys never enter the LLM.
2. Wallet connection is not authorization.
3. Deterministic policy is authoritative.
4. Execution checks are re-run at the execution boundary.
5. Unsupported or unsafe security/audit states remain blocking conditions.
6. Autonomous execution must be revocable and idempotent.
7. Handelo never fabricates transaction hashes, balances or execution success.
8. Uncertain execution remains uncertain until verified.

---

## How we built Handelo

Handelo was built as an incremental engineering process rather than as a single UI-first prototype.

### 1. Start from the market problem

We started from the market-hours mismatch: the reference equity market can close while its tokenized representation keeps trading.

### 2. Turn the problem into a governed loop

Instead of creating a chatbot that recommends trades, we designed the full decision path from discovery through verification.

### 3. Separate intelligence from authority

We kept model reasoning outside deterministic policy, wallet authorization and signing boundaries.

### 4. Build vertical slices

Each capability followed the pattern:

**domain contract → deterministic/service logic → API/agent behavior → workspace UI → tests**

### 5. Build the wallet boundary before autonomous money movement

Wallet context, permissions, spending limits, asset scope, reserve, expiry, revocation and recovery were treated as architectural gates.

### 6. Make autonomy persistent

The strategy runtime introduced persisted state, triggers, recurring scheduling, execution records, worker/runtime components, next-run calculation, retries, recovery and idempotency.

### 7. Make execution observable

The workspace exposes strategy runtime telemetry and provider transaction receipts when available, instead of presenting a generic “automation is working” claim.

### 8. Use CI as an engineering gate

The repository is a pnpm monorepo. GitHub Actions run dependency installation, checks, tests and an API health smoke.

### 9. Treat live validation separately from CI

CI green is not proof of live market behavior or real-money settlement.

Live validation has its own gates for provider behavior, wallet state, execution, verification, portfolio reconciliation and deployment.

### 10. Preserve failures as evidence

During local Binance API validation, an integration request returned:

```
HTTP 401
API Key is required
```

We keep observations like this for the Developer Experience Report instead of converting the build history into promotional copy.

---

## Validated scope

The validation rule is:

> **Implemented is not the same as validated.**

### Currently validated

- NVIDIA / NVDA;
- NVDAB as its tokenized representation on BNB Chain;
- Binance-backed BSC RWA market resolution for that relationship;
- reference/on-chain price comparison;
- deterministic policy and risk review;
- live wallet status/address and BSC portfolio reconciliation;
- execution review binding;
- strategy persistence/runtime components;
- execution lifecycle and verification boundaries;
- automated regression/adversarial coverage across the repository.

### Not yet claimed as fully validated

- every additional tokenized-stock asset returned by Binance;
- the complete provider-backed agent-wallet lifecycle;
- every funding and withdrawal path;
- the complete deployed end-to-end execution flow;
- controlled real-money validation;
- production deployment;
- final external MCP validation;
- production Telegram bot provisioning and deployment.

---

## Known gaps

### Additional assets

The market architecture is provider-driven, but each additional tokenized-stock asset must be validated before it is presented as supported.

### Live money movement

Controlled real-money validation remains a later gate. Mocked or simulated behavior is not treated as live evidence.

### Agent wallet lifecycle

The architecture and runtime boundaries are substantially built, but final provider-backed funding, withdrawal, revocation and recovery behavior still require live validation.

### MCP

The package and tool surface exist in the repository, but the final external-client workflow still needs a deliberate validation pass.

### Telegram

The Telegram client package exists and routes through the Handelo runtime, but a public bot has not yet been provisioned and deployment-validated for the submission.

### Deployment

The Vercel frontend and properly hosted backend remain final deployment work.

---

## Repository structure

```
.
├── apps/
│   ├── handelo-api/
│   ├── handelo-telegram/
│   └── handelo-web/
│
├── packages/
│   ├── handelo-agent/
│   ├── handelo-core/
│   ├── handelo-execution/
│   ├── handelo-llm/
│   ├── handelo-market/
│   ├── handelo-mcp/
│   ├── handelo-policy/
│   ├── handelo-portfolio/
│   ├── handelo-sdk/
│   └── handelo-strategy/
│
├── docs/
│   ├── AGENT-WALLET-ARCHITECTURE.md
│   ├── AGENT-WALLET.md
│   ├── BNB-WALLET-PROVIDER-AUDIT.md
│   ├── BUILD.md
│   ├── DEVELOPER-EXPERIENCE.md
│   ├── HANDELO-BUILD-STATUS.md
│   ├── HANDELO-LIVE-VALIDATION.md
│   ├── HANDELO-PRODUCT-SPEC.md
│   └── MCP.md
│
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

## Local development

### Requirements

- Node.js 22
- pnpm 10.15.0

### Install

```
pnpm install
```

### Checks

```
pnpm check
pnpm test
```

### Run the API

From the repository root:

```
pnpm dev
```

The API runs at:

```
http://localhost:8787
```

Health endpoint:

```
http://localhost:8787/health
```

### Run the web application

Handelo's web surface is a static application.

In a second terminal:

```
cd apps/handelo-web
python -m http.server 5173
```

Open:

```
http://localhost:5173
```

The web app uses the API at http://localhost:8787 by default.

To point it at another API without rebuilding, use the browser local setting:

```
localStorage.setItem("handelo_api_url", "https://your-api.example.com")
```

The browser never handles private keys.

---

## Environment configuration

Copy the example environment file:

```
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| HANDELO_API_KEY | AI provider configuration |
| HANDELO_CLIENT_API_KEY | Optional external-client authentication |
| BINANCE_WEB3_API_KEY | Binance Web3 API credential |
| BINANCE_WEB3_SECRET_KEY | Binance Web3 API signing secret |
| BSC_RPC_URL | Optional BSC RPC endpoint for direct verification |
| HANDELO_WALLET | Optional demo wallet address |
| HANDELO_EXECUTION_ENABLED | Execution gate; keep false except during controlled live validation |

Never commit API secrets, wallet passwords, private keys, bot tokens or deployment environment files.

---

## API

### Health

```
GET /health
```

Example response:

```
{"ok":true,"service":"handelo-agent"}
```

### Chat

```
POST /api/chat
```

Example:

```
curl -X POST http://localhost:8787/api/chat -H "content-type: application/json" -d '{"message":"I have $20. Tell me what is happening with NVIDIA."}'
```

External clients use the same Handelo runtime rather than implementing parallel market or trading logic.

For the authoritative API implementation, see the API server source in apps/handelo-api/src/server.ts.

---

## SDK

The Handelo SDK is a typed client over the same runtime used by the web application.

```
import { createHandeloClient } from "@handelo/sdk";

const handelo = createHandeloClient({
  baseUrl: "http://localhost:8787",
  apiKey: process.env.HANDELO_CLIENT_API_KEY,
});

const result = await handelo.chat({
  message: "What is happening with NVIDIA?",
});
```

The SDK does not hold private keys, sign transactions, bypass policy or fabricate execution evidence.

---

## MCP

Handelo includes a read-only MCP server for tokenized-stock market intelligence.

Current tools:

- handelo_market_lookup
- handelo_market_search

Run locally:

```
pnpm --filter @handelo/mcp start
```

Required environment:

- BINANCE_WEB3_API_KEY
- BINANCE_WEB3_SECRET_KEY

MCP is not the signing boundary.

**Status:** package and tests are present; final external-client validation is pending.

See [docs/MCP.md](docs/MCP.md).

---

## Telegram

Handelo includes a thin Telegram client over the same runtime.

Configuration:

```
TELEGRAM_BOT_TOKEN=
HANDELO_API_URL=http://localhost:8787
HANDELO_CLIENT_API_KEY=
```

Run locally:

```
pnpm --filter @handelo/telegram start
```

The client is designed for private chats and must preserve the same policy/review boundaries.

**Status:** source package exists; public bot provisioning, deployment and end-to-end validation are pending.

---

## Testing and CI

The root commands are:

```
pnpm check
pnpm test
```

The GitHub Actions pipeline performs:

1. dependency installation;
2. type/check validation;
3. repository tests;
4. API health smoke.

CI is an engineering gate, not proof of:

- live Binance availability;
- live wallet behavior;
- successful on-chain settlement;
- production deployment;
- controlled real-money execution;
- support for every asset returned by the provider.

See [docs/HANDELO-LIVE-VALIDATION.md](docs/HANDELO-LIVE-VALIDATION.md).

---

## Developer Experience Report

The BNB Hack: Tokenized Stocks Edition assigns the Developer Experience Report **25% of the judging score**.

This is not a section we will fill with generic AI-generated prose.

The evidence register tracks:

### Onboarding

- time from opening the docs to the first successful API call;
- exact setup step where we got stuck;
- exact documentation page and section involved.

### Binance API behavior

- exact endpoint;
- exact request and response;
- HTTP status and error message;
- actual latency;
- edge cases.

### Tokenized-stock behavior

- reference vs on-chain price;
- market-hours behavior;
- liquidity depth;
- slippage;
- execution quality;
- representation differences.

### Agentic Wallet experience

- actual CLI/provider workflow;
- successful paths;
- failed attempts;
- confusing steps;
- missing capabilities;
- what we changed;
- what we would redesign.

### Requested platform improvements

- missing endpoints;
- missing SDK support;
- missing wallet capabilities;
- missing tooling;
- documentation fixes.

The rule is:

> **We record what actually happened. We do not manufacture numbers, failures or successes.**

See [docs/DEVELOPER-EXPERIENCE.md](docs/DEVELOPER-EXPERIENCE.md).

---

## Hackathon evidence

The BNB Hack: Tokenized Stocks Edition is a BSC tokenized-stock product and agent challenge. The official track requires at least one of bStocks, Ondo or xStocks to be central to the submission, and it calls for a working project plus a public repository and deployment/demo path.

Handelo's evidence set is being built from:

- repository history;
- automated tests and CI;
- live Binance responses;
- actual wallet/provider behavior;
- execution and verification behavior;
- browser screenshots and screen recordings;
- final public deployment;
- demo video;
- Developer Experience Report.

The evidence rule is simple:

> **A claim belongs in the final submission only when we can point to the implementation or the actual validation that supports it.**

---

## License

Handelo is currently maintained as the Handelo hackathon repository.

License and distribution status will be finalized with the submission package.

---

## Links

- **Repository:** https://github.com/Investorquab/Handelo
- **Architecture:** https://github.com/Investorquab/Handelo#architecture
- **Product Specification:** https://github.com/Investorquab/Handelo/blob/main/docs/HANDELO-PRODUCT-SPEC.md
- **Build Plan:** https://github.com/Investorquab/Handelo/blob/main/docs/BUILD.md
- **Build Status:** https://github.com/Investorquab/Handelo/blob/main/docs/HANDELO-BUILD-STATUS.md
- **Agent Wallet Architecture:** https://github.com/Investorquab/Handelo/blob/main/docs/AGENT-WALLET-ARCHITECTURE.md
- **Developer Experience:** https://github.com/Investorquab/Handelo/blob/main/docs/DEVELOPER-EXPERIENCE.md
- **Live Validation:** https://github.com/Investorquab/Handelo/blob/main/docs/HANDELO-LIVE-VALIDATION.md
- **MCP:** https://github.com/Investorquab/Handelo/blob/main/docs/MCP.md
- **BNB Hack: Tokenized Stocks Edition:** https://www.bnbchain.org/en/hackathons/tokenized-stocks
- **BNB Web3 Developer Portal:** https://web3.binance.com/en/dev-portal
- **Binance Web3 API Documentation:** https://web3.binance.com/en/dev-docs/introduction
- **BNB Agent Studio:** https://www.bnbchain.org/en/bnb-agent-studio
- **Binance Agentic Wallet:** https://developers.binance.com/en/docs/products/agentic-wallet/welcome

> Deployment URLs, YouTube demo, public MCP endpoint, Telegram bot and other final submission resources will be added only after they are actually live and validated.
