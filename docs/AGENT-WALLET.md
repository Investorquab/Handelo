# Handelo agent wallet boundary

Handelo separates reasoning from signing.

## Current boundary

- LLM: parses intent and explains market state.
- Market client: reads live tokenized-stock data from Binance Web3.
- Policy: deterministic spend/market/reference checks.
- Execution adapter: transaction simulation is available.
- Broadcast: intentionally not implemented in the generic adapter.

## Target hackathon path

Use the BNB/Binance agent-wallet infrastructure rather than giving an LLM a private key.

The production boundary is:

```
User intent
  -> Handelo agent
  -> market + policy checks
  -> transaction review
  -> Agentic Wallet / secured agent signer
  -> BSC
  -> receipt verification
```

The language model must never receive a private key or wallet password.

The final execution adapter will be responsible for:
1. obtaining/confirming a quote;
2. applying Handelo's deterministic policy;
3. requiring confirmation when policy says CONFIRM;
4. signing through the secured wallet boundary;
5. waiting for the transaction receipt;
6. returning verifiable transaction evidence.

Until that adapter is connected, Handelo must not claim that a trade was executed.


## Current Binance Agentic Wallet integration

Handelo's execution adapter targets Binance's Agentic Wallet skill through the `baw` CLI.

Install the official skill with:

```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
```

The adapter uses the wallet's quote, market-order, and order-status surfaces. BSC is chain `56`.

Execution remains confirmation-gated. Handelo does not receive or store the wallet private key. Binance's current Agentic Wallet architecture uses MPC Keyless security and applies wallet-side daily limits and transaction rules. 

The current integration is deliberately separate from MCP: MCP remains read-only; wallet execution is an explicit execution boundary.
