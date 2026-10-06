# Handelo Product Specification

Status: LOCKED
Version: 1.2
Date: 2026-10-05

## 1. Product definition

Handelo is an AI operating layer for tokenized-stock markets on BNB Smart Chain.

Handelo is not only a chatbot and it is not a collection of disconnected dashboard pages. Chat is a core control surface over a broader market, strategy, portfolio, risk, and execution system.

The product turns market complexity into an understandable workflow:

Discover -> Understand -> Strategize -> Check Risk -> Review -> Approve -> Execute -> Monitor

AI interprets user intent, explains market context, and helps construct strategies. Deterministic application code remains the authority for risk, transaction construction, signing boundaries, and execution verification.

## 2. Product architecture

Handelo has exactly two primary product pages.

### Page 1 — Handelo Home

Purpose: introduce the product before the user enters the application.

The homepage must explain:
- the tokenized-stock problem Handelo addresses;
- what Handelo can do;
- the seven product capabilities;
- how the workflow works;
- why natural language is useful for this market;
- how to open the workspace.

The homepage must use real Handelo visual language and real product UI components for capability demonstrations. Demo snippets must not be unrelated fake interfaces.

Primary CTAs:
- Try Demo
- Connect Wallet / Use Handelo

### Page 2 — Handelo Workspace

The workspace is one page.

There are no separate Overview, Markets, Portfolio, Strategies, Activity, or Chat pages.

The workspace uses a persistent two-column model:

Left: financial and market context.
Right: persistent AI Chat.

### External control surfaces

The web pages remain the only primary product pages. Handelo may also expose the same runtime through:

- SDK — @handelo/sdk for applications and agents sending natural-language requests.
- MCP — read-only market-intelligence tools.
- Telegram — a conversational client routed through the same Handelo runtime.

These are control surfaces, not parallel business-logic implementations.

The left context remains visible while the user interacts with Chat.

## 2.1 Wallet and agent architecture

Handelo separates the human user's personal wallet from the wallet used by the autonomous Handelo agent.

### Demo mode

Try Demo opens a preconfigured Handelo environment using a configured Agentic Wallet.

The judge must not need:
- API credentials;
- private keys;
- wallet setup;
- developer configuration.

The UI must clearly disclose Demo Mode.

Any real transaction shown in Demo Mode must be an actual transaction from the configured demo wallet. Simulated actions must be explicitly labelled simulated. Handelo must never fabricate transaction hashes, balances or execution results.

### User mode

Connect Wallet connects a user's BSC-compatible personal EVM wallet.

Examples include MetaMask, Rabby, Binance Wallet, Bitget Wallet or another compatible provider.

Connecting a personal wallet establishes wallet identity and allows supported portfolio information to be read. It does not, by itself, grant Handelo spending authority.

### Agent wallet

Autonomous execution uses a dedicated agent execution context based on a BNB-supported wallet/provider.

The user must not be required to expose the agent wallet private key to the browser or LLM.

The intended long-term model is:
- personal wallet remains user-controlled;
- user explicitly funds or authorizes an agent execution context;
- agent operates only within deterministic spending, exposure, reserve and strategy policies;
- user can inspect agent balance, permissions and activity;
- user can revoke authority;
- user can transfer supported funds back to the personal wallet through a controlled transaction flow.

BNB Agent Studio and its supported wallet providers must be used where they provide the safest/native implementation rather than recreating wallet custody or signing infrastructure inside Handelo.

The exact funding, withdrawal and delegation mechanism is an architecture gate and must be validated against the current BNB Agent Studio/wallet-provider capabilities before autonomous money movement is implemented.

## 3. Workspace — persistent left context

The left side contains the user's current financial reality and relevant market state.

It may contain:
- Market Radar
- selected market / stock context
- reference price
- on-chain price
- divergence
- market status and market-hours context
- charts
- personal wallet balance
- agent wallet balance
- portfolio allocation and positions
- active strategies
- agent permissions
- risk state
- recent activity/history

These are context cards, not navigation tabs.

Cards should update in place rather than forcing the user into separate pages.

## 4. Workspace — persistent Chat

Chat remains a major/core feature.

Chat is the natural-language control surface for the Handelo system.

Users can ask things such as:
- What is happening with NVIDIA?
- Find the largest tokenized-stock price gaps.
- Why is this token trading above its reference?
- Create a $10 weekly DCA for NVIDIA.
- Rebalance my portfolio to target allocations.
- Why was my strategy blocked?
- Review this transaction.
- Transfer 10% of my agent wallet back to my personal wallet.

Chat must:
- auto-scroll to the newest response;
- preserve the conversation;
- expose useful capability prompt chips for new users;
- render structured product cards where appropriate;
- never fabricate market data, execution, transaction success, or unsupported assets;
- route wallet-moving actions through the same deterministic review, authorization and execution boundaries as UI actions.

## 5. Seven product capabilities

### 5.1 Market Intelligence / Gap Radar

Handelo detects and explains relevant tokenized-stock market conditions.

Core concepts:
- on-chain price;
- underlying/reference price;
- price divergence;
- market status;
- market-hours awareness;
- liquidity/context;
- multiple tokenized representations of the same underlying.

The system should make the difference between an asset's reference value and its current on-chain representation understandable.

### 5.2 AI Analyst

The existing Chat experience remains the AI Analyst.

It explains:
- what is happening;
- why a market condition matters;
- representation differences;
- market-hours context;
- relevant portfolio implications;
- why a deterministic rule allowed or blocked an action.

AI is an interpretation/explanation layer, not a safety authority.

### 5.3 Strategy Engine

Users can express strategies in natural language.

Initial strategy forms:
- DCA;
- recurring strategies;
- conditional strategies;
- target/exposure rules.

A strategy must become a structured, deterministic object before activation.

Example:

STRATEGY PREVIEW
- Type: Weekly DCA
- Asset: selected tokenized-stock representation
- Amount: $10
- Frequency: Every Monday
- Maximum exposure: 35%
- Minimum USDC reserve: 10%
- Next execution: resolved from strategy schedule

The user must be able to understand and review the strategy before activation.

### 5.4 Portfolio Engine

The portfolio system provides:
- holdings;
- allocation;
- target allocation;
- exposure;
- rebalancing;
- portfolio context for strategy decisions.

Portfolio state belongs in the persistent workspace context.

### 5.5 Risk Governor

Risk decisions are deterministic.

Initial policy dimensions:
- maximum single-asset exposure;
- maximum transaction/trade size;
- minimum reserve;
- strategy constraints;
- market-condition restrictions;
- agent-wallet spending limits.

The Risk Governor returns an explicit decision and reason.

A blocked action must be explainable in user language without allowing the LLM to override the deterministic decision.

### 5.6 Agentic Execution

Execution follows the appropriate human-approval or delegated-policy boundary.

For explicitly user-approved actions:

Review -> deterministic policy -> transaction preview -> explicit confirmation -> wallet execution -> verification

For autonomous strategy actions:

Trigger -> deterministic risk/policy -> wallet permission check -> execution -> verification -> portfolio update

Transaction previews must explain what the user is approving.

Example fields:
- action;
- asset;
- amount;
- estimated quantity;
- relevant prices;
- execution context;
- network;
- wallet;
- risk/policy result;
- security/audit result where available.

Unsupported or unavailable security/audit paths remain blocking conditions. Handelo must never bypass them merely to produce a successful demo.

Execution status must be honest: FINISHED, FAILED, or PENDING where applicable.

### 5.7 Strategy Intelligence

This capability combines market intelligence into useful strategy context.

Initial scope:
- market-hours intelligence;
- thematic baskets;
- transparent basket composition;
- basket explanation;
- strategy signals/context.

Thematic examples may include AI, semiconductors, energy, or other supported groups when live data supports them.

## 6. Structured Chat cards

Chat may render structured UI cards for:
- Market Insight
- Strategy Preview
- Risk Result
- Transaction Preview
- Portfolio/Rebalance Preview
- Basket Preview
- Wallet Transfer Preview
- Agent Permission / Wallet Status

Cards must be readable and actionable.

The UI should not reduce a complex action to a vague “Sign transaction” message.

## 7. First-stock onboarding

Onboarding is part of the product flow, not a separate eighth subsystem.

A new user should be able to understand the path from first stock discovery to a reviewed transaction without seed-phrase friction in the product experience.

The workspace should guide users toward supported tokenized-stock representations and wallet connection when required.

## 8. External interface rules

### SDK

The SDK is a typed client over the Handelo runtime. It must not hold private keys, sign transactions, bypass risk/review controls, or fabricate execution evidence.

### Telegram

Telegram is a conversational client, not a separate trading engine. It routes requests through the same market, strategy, portfolio, risk, review, authorization and execution boundaries.

The bot must isolate Telegram users by application session, never receive or store private keys, preserve deterministic risk decisions, and never claim execution without verified evidence. If secured wallet interaction cannot be safely represented in Telegram, execution must hand off to the web wallet flow.

### MCP

MCP remains read-only for market intelligence and is not a signing boundary.

## 9. Visual and interaction rules

Preserve the existing Handelo visual identity:
- typography;
- colors;
- card language;
- spacing;
- premium feel;
- restrained motion.

Add transitions where they improve comprehension and continuity, not as decoration.

The product should feel like one coherent application rather than seven tools assembled together.

## 10. Data and truth rules

Live market data is authoritative for market observations.

Deterministic application code is authoritative for:
- policy;
- transaction constraints;
- confirmation state;
- authorization state;
- execution state;
- verification.

The LLM must not invent:
- tickers;
- prices;
- execution results;
- transaction hashes;
- unsupported token representations;
- wallet balances;
- wallet permissions.

Ambiguous stock requests must not silently select a representation.

## 11. Security rules

- Personal wallet private keys never enter the LLM.
- Agent wallet private keys never enter the LLM or browser UI.
- Wallet connection does not equal spending authorization.
- Explicit user approval remains required where delegated authority is not configured.
- Delegated autonomous execution is bounded by deterministic policy.
- Execution policy is rechecked at the execution boundary.
- Unsupported/high-risk audit results block execution according to the existing security path.
- External links remain HTTPS-only.
- User-controlled UI values remain safely escaped.
- No fake execution evidence.
- No bypass of wallet or audit controls for demos.
- Agent authority must be revocable.
- Recovery and idempotency must prevent duplicate autonomous execution.

## 12. Engineering direction

Build the product as integrated vertical slices.

Do not build seven disconnected backend subsystems and postpone the UI until the end.

For each capability:
1. define domain/data contract;
2. implement deterministic/service behavior;
3. expose required API/agent behavior;
4. add workspace representation;
5. add Chat integration where relevant;
6. test the slice;
7. commit it;
8. continue the batch.

## 13. Build order

1. Product/spec source of truth.
2. Shared domain contracts and workspace state.
3. Market Intelligence / Gap Radar.
4. AI Analyst / structured Chat foundation.
5. Strategy Engine.
6. Portfolio Engine.
7. Risk Governor.
8. Agentic Execution integration.
9. Strategy Intelligence / baskets.
10. Workspace integration and polish.
11. Homepage and real UI demo snippets.
12. Agent Wallet Architecture gate:
   - BNB Agent Studio/provider capability audit;
   - personal-wallet context;
   - agent-wallet lifecycle;
   - permissions/delegation;
   - funding;
   - withdrawal;
   - revocation;
   - demo mode.
13. Autonomous Strategy Runtime.
14. Portfolio state reconciliation and post-execution verification.
15. Liquidity-aware execution and event intelligence.
16. Full regression, security review, live validation, demo and submission preparation.

## 14. Explicit non-goals

Handelo must not become:
- a chatbot-only product;
- a multi-page admin dashboard;
- seven disconnected mini-apps;
- an autonomous trading system that hides approval or delegated authority;
- a UI that claims unsupported execution is working;
- a fake demo assembled from unrelated mock screens;
- a system that derives an agent private key from a user's personal wallet seed phrase.

## 15. Change-control rule

This specification is the source of truth.

The direction is not to be re-strategized during implementation unless:
- a technical constraint makes a requirement impossible;
- a security issue requires a change;
- a hackathon requirement changes;
- testing proves the architecture is materially wrong;
- the product owner explicitly changes direction.

Any accepted change must be recorded in this specification and the build status before implementation continues.
