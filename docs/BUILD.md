# Handelo Build Plan

This document is the high-level engineering roadmap. The authoritative product and UX requirements live in `docs/HANDELO-PRODUCT-SPEC.md`. The live execution checklist lives in `docs/HANDELO-BUILD-STATUS.md`.

## Product thesis

Handelo is an AI operating layer for tokenized-stock markets on BNB Smart Chain.

It is not a chatbot-only product. Chat is the natural-language control surface for a broader system covering market intelligence, strategy, portfolio, risk, execution, and strategy intelligence.

The workflow is:

**Discover -> Understand -> Strategize -> Check Risk -> Review -> Approve -> Execute -> Monitor**

## Product structure

Handelo has exactly two primary pages:

1. **Home** — explains the product, its problem, capabilities, workflow, and shows real Handelo UI demo snippets.
2. **Workspace** — one page with persistent financial/market context on the left and persistent AI Chat on the right.

There are no separate Overview, Markets, Portfolio, Strategies, Activity, or Chat pages.

## Seven capabilities

1. Market Intelligence / Gap Radar
2. AI Analyst / Chat
3. Strategy Engine
4. Portfolio Engine
5. Risk Governor
6. Agentic Execution
7. Strategy Intelligence / Baskets / Market-hours intelligence

## Engineering order

### Phase 0 — Source of truth
- Lock product/UX specification.
- Maintain build status.
- Record material changes through the specification change-control rule.

### Phase 1 — Shared foundations
Build the shared contracts/state required by the seven capabilities:
- market insight;
- strategy;
- portfolio;
- risk decision;
- transaction preview;
- structured Chat response;
- workspace state.

### Phase 2 — Seven capabilities
Implement each capability as an integrated vertical slice:
1. deterministic/service behavior;
2. API/agent behavior;
3. workspace representation;
4. Chat integration where relevant;
5. tests.

### Phase 3 — Workspace
Build the single-page workspace:
- persistent left financial context;
- persistent right Chat;
- market cards;
- charts;
- wallet;
- portfolio;
- active strategies;
- risk;
- activity/history;
- structured Chat cards;
- auto-scroll;
- responsive/loading/empty/error states.

### Phase 4 — Homepage
Build the product landing page:
- hero;
- problem;
- product explanation;
- seven capability sections;
- real Handelo UI demo snippets;
- workflow;
- launch CTA.

### Phase 5 — Integration and polish
- end-to-end flows;
- transitions where useful;
- accessibility;
- security;
- performance;
- responsive QA;
- README positioning.

### Phase 6 — Validation
- clean install;
- build;
- tests;
- API smoke tests;
- workspace and Chat flows;
- strategy/risk/execution flows;
- security regression;
- honest execution evidence.

### Phase 7 — Submission
- public repo;
- deployed link/instructions;
- four-minute-or-less demo;
- Developer Experience Report;
- architecture documentation;
- final regression.

## Batch workflow

We do not wait for CI after every tiny change.

During a batch:
- make several related meaningful commits;
- push the accumulated batch;
- inspect CI;
- if green, continue;
- if red, identify and fix the actual failure before continuing past the affected area.

Local pull/test is reserved for explicit checkpoints.

## Truth and security boundary

AI interprets intent and explains context.

Deterministic application code remains authoritative for:
- risk;
- transaction constraints;
- approval;
- transaction construction;
- signing boundary;
- execution state;
- verification.

The LLM never receives private keys and must never fabricate prices, tickers, transactions, hashes, or execution results.

Existing security/audit blocking behavior remains intact.

## Hackathon alignment

The current BNB Hack: Tokenized Stocks Edition requires a central bStocks, Ondo, or xStocks integration, spot-only BSC mainnet use, and a working project. Its stack explicitly provides RWA market/reference data, market data, trading, transaction, wallet and DeFi APIs, with Agentic Wallet as an optional but heavily weighted execution layer.

Handelo's architecture therefore prioritizes the tokenized-stock market problem, understandable product UX, deterministic execution safety, and credible wallet integration rather than building unrelated features.
