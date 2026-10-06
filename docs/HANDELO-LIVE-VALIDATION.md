# Handelo Live Validation Runbook

This runbook begins only after the pre-live engineering batches are green. Phases 7-9 require operator-controlled local, live-provider and (for Phase 8) real-money validation. CI green is not a substitute for these checks.

## Phase 7 — Local and live validation

### 1. Pull the exact green main
```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
```
Record the SHA and confirm it matches the latest green GitHub Actions run.

### 2. Clean automated baseline
```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
```
Do not continue if either command fails.

### 3. API smoke
```bash
cp -n .env.example .env
pnpm dev
```
In another terminal, verify the health endpoint exposed by the running API. Provider/LLM secrets must be configured before provider-backed tests; never paste secrets into evidence.

### 4. Web smoke
Open the deployed Handelo web app in a real browser and verify:
- homepage loads;
- navigation reaches Workspace;
- wallet connection state is understandable;
- Demo/User mode disclosure is visible;
- market data renders;
- portfolio state renders without fabricated execution history;
- strategy creation/review UI is usable;
- rejected/blocked actions show a clear reason.

Record screenshots or screen capture for the final evidence package.

### 5. Provider/chat smoke
With the intended provider credentials configured:
- send a research request;
- resolve a supported tokenized-stock market;
- request a buy/invest intent;
- verify the response shows the policy/review boundary;
- verify no response claims a trade happened without execution evidence.

### 6. Wallet flow
Use a dedicated validation wallet/context:
- connect the personal wallet;
- establish the USER-mode agent context;
- verify owner/agent addresses are bound;
- verify wrong-wallet, non-BSC, disconnected and inactive contexts are rejected;
- verify permissions/spend/asset/reserve policy intersection;
- verify pause/resume/revoke behavior;
- verify Demo Mode cannot reach live wallet execution.

For provider-backed creation/funding/withdrawal, record the real provider response and BSC evidence. Mocks do not count.

### 7. Strategy flow
Exercise at least:
- DCA;
- recurring;
- conditional;
- rebalance;
- pause/resume/edit/cancel;
- retryable failure and recovery;
- duplicate trigger;
- restart recovery;
- post-execution verification;
- deterministic scheduler behavior.

Confirm execution history and next/last run state.

### 8. Portfolio reconciliation
Compare Handelo's portfolio snapshot against the connected BSC wallet:
- token balances;
- quote-token cash balance;
- market value;
- cost basis/P&L only where acquisition lots actually exist;
- no invented historical cost.

### 9. SDK / Telegram / deployment
Run SDK regression tests, then exercise the deployed/API-connected SDK and Telegram path using the same runtime. Confirm they do not implement parallel trading logic.

## Phase 8 — Controlled real-money validation

Use only a dedicated validation wallet and approximately $5-$10.

1. Confirm wallet address, BSC network and agent policy.
2. Fund the validation wallet/agent wallet through the intended provider path.
3. Execute one small real DCA/strategy transaction.
4. Record transaction hash, token, amount and timestamp.
5. Verify the transaction on BSC.
6. Reconcile Handelo portfolio state.
7. Verify persisted execution history and verification status.
8. Exercise the withdrawal/recovery path if the provider supports it.
9. Secure/remove the validation funds after evidence is captured.

If any transaction outcome is uncertain, stop. Do not blindly retry or claim success.

## Phase 9 — Final attack and submission

After the real flow succeeds:
- repeat the relevant failure/recovery attacks;
- confirm stale quote, wrong wallet, insufficient balance, provider/network failure and duplicate execution protections;
- capture Developer Experience evidence from the actual build;
- record BNB API/provider usage;
- capture Agentic Wallet evidence;
- capture Agent Studio evidence only if it was actually used;
- verify architecture claims against the repository;
- verify public deployment;
- record a demo of 4 minutes or less;
- run the final hackathon requirement audit;
- assemble the submission package.

## Evidence rules

- CI green proves repository correctness, not live money movement.
- A mock/provider fixture is not live-provider evidence.
- A transaction is not considered successful without on-chain confirmation.
- Never expose private keys or secrets in logs, screenshots or the demo.
- Do not claim Agent Studio, ERC-8004 or provider-backed wallet creation was used unless the live environment actually demonstrates it.

## Binance token-audit interpretation

The Binance token-audit endpoint can report a supported token with no detailed audit result. For example, a live NVDAB response returned `isSupported=true`, `hasResult=false`, `riskLevelEnum=LOW`, and `riskLevel=-1`. Handelo treats this state as supported/low-risk rather than as an unsupported token.

The safety boundary remains fail-closed for `isSupported=false` and for explicit high-risk results (risk level >= 4). A supported token with no detailed result still requires all other Handelo review gates to pass before a review token can be issued or execution can occur.

This interpretation is based on the live provider response captured during Phase 7 validation; it is not evidence that a real transaction is safe or that execution succeeded.

## Phase 4 engineering closure — liquidity, slippage and price impact

The Phase 4 liquidity gate is complete in code. Market intelligence exposes deterministic 24h volume/market-cap turnover and liquidity activity classification; execution review uses provider quotes for slippage/price-impact measurement and route/execution-quality telemetry. These signals inform review but do not bypass policy, portfolio risk, wallet security or execution verification gates.
