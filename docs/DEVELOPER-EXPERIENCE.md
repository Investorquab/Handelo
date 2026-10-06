# Handelo Developer Experience Report

This document records the developer experience of building Handelo for the BNB Tokenized Stocks hackathon. It is intentionally specific about what works, what was difficult, and what is still incomplete.

## What a developer gets

### SDK
`@handelo/sdk` exposes a small client surface for sending natural-language requests to a Handelo runtime.

### MCP
`@handelo/mcp` exposes read-only tokenized-stock market tools for MCP-compatible developer environments. It does not sign or broadcast transactions.

### Market data
The market package isolates Binance Web3 authentication and normalizes tokenized-stock records into a BSC-focused representation used by the agent and API.

### Policy
The policy package is deterministic and independent of the LLM provider. Spend limits, market state, and reference-price gaps are checked outside the model.

### Web application
The web app makes the boundary visible: market context first, then transaction review, policy checks, security status, quote status, explicit confirmation, and an honest execution result.

## Environment

```
HANDELO_CLIENT_API_KEY=
BINANCE_WEB3_API_KEY=
BINANCE_WEB3_SECRET_KEY=
HANDELO_WALLET=
HANDELO_CORS_ORIGIN=https://your-handelo-frontend.example
BSC_RPC_URL=
```

No private key or wallet password belongs in these variables.

`HANDELO_CORS_ORIGIN` may be set to the exact deployed frontend origin. If omitted, the API keeps `*` for local/demo compatibility.

## Setup journey

The shortest verified repository workflow is:

```bash
pnpm install
pnpm check
pnpm test
```

Run the API with:

```bash
pnpm --filter @handelo/api dev
```

Then the chat surface can be exercised with:

```bash
curl -X POST http://localhost:8787/api/chat \
  -H "content-type: application/json" \
  -d '{"message":"I have $20. Tell me what is happening with NVIDIA."}'
```

The web client defaults to `http://localhost:8787`, or can be pointed at another API with `HANDELO_API_URL` or the `handelo_api_url` local setting.

## What was straightforward

- A pnpm workspace kept the market, policy, execution, agent, MCP, SDK, API, and web surfaces separated.
- Provider-agnostic LLM selection meant the application did not need a model dropdown.
- Binance Web3 authentication and market normalization were isolated in one package instead of being spread through UI code.
- Deterministic policy checks were easy to test independently from the LLM.
- Strict output validation made the agent boundary explicit.
- CI runs syntax/type checks and tests on every push, which caught regressions before they reached the next build step.

## What was difficult

### 1. Market representations are not interchangeable

A stock ticker can have multiple tokenized representations. The first implementation risk was treating a ticker as if it uniquely identified a tradable token.

We changed the flow so exact token-symbol matches are preferred, ambiguous matches are surfaced as candidates, and the selected representation is preserved into transaction review.

This is important because the user should know which representation is being reviewed rather than having the application silently choose one.

### 2. Live market state needs more than a price

A token price alone is not enough for a review. The market client now carries market-open state, reason codes, and next-open/next-close timestamps. The UI exposes that context before a transaction is reviewed.

### 3. AI must not become the safety layer

The LLM is useful for intent and explanation, but it is not a source of truth for policy, transaction status, or signing.

The review and execution paths therefore re-resolve market data, re-run deterministic policy, require explicit confirmation, and use a short-lived review token bound to the reviewed asset and amount.

### 4. Execution claims must match the actual integration

The Binance Transaction API provides an off-chain simulation capability for raw EVM transactions. The current Agentic Wallet execution path does not expose the raw transaction needed to honestly wire that simulation into the existing flow.

We therefore keep the direct EVM simulation adapter explicit about this boundary instead of claiming that simulation is integrated when it is not.

### 5. MCP protocol testing needed restraint

A child-process protocol test initially introduced timing sensitivity in CI. The stable tests now validate the JSON-RPC envelope, argument rules, and tool surface deterministically rather than relying on a long-lived subprocess interaction in the CI runner.

## What CI has taught us

CI is part of the development experience, not just a final gate.

Recent examples:

- The selected-market review flow was locked with deterministic regression tests.
- The frontend syntax check caught a malformed template literal immediately after the policy-check UI build. The issue was fixed before another feature was started.
- MCP validation regressions were caught and corrected through focused tests rather than being hidden behind a broad integration test.

The current workflow is deliberately small: install the workspace, run checks, then run tests.

## Current security boundary

MCP is read-only. Transaction signing is not an MCP tool.

The secured wallet layer is responsible for authorization and signing, while Handelo is responsible for intent, market context, deterministic policy, review binding, and verification.

The language model never receives a private key.

## Current known gaps

These are intentionally not described as completed:

- A polished public deployment is still separate from the local developer workflow.
- SDK and Telegram control surfaces are implemented and tested; public release/deployment remains final-stage work.
- A complete live end-to-end execution test with controlled funds still needs to be captured as demo evidence.
- Direct raw-EVM transaction simulation is not yet wired into the Agentic Wallet execution path.
- The final hackathon demo video and final narrative still need to be produced.
- Responsive/accessibility implementation is complete; a final live browser/demo QA pass still remains.
- This report should be updated after the first complete live end-to-end run with the exact observed setup time, failures, and fixes.

## Developer feedback

The main lesson from building Handelo is that the easiest-looking integration is not always the safest one. The most useful developer experience came from making boundaries explicit: normalized market data, deterministic policy, a visible review step, and honest execution states.

For the final submission, this report should remain a record of the actual build experience rather than becoming promotional copy.
