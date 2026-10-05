# Handelo Agent Wallet Architecture

Status: LOCKED FOUNDATION
Version: 1.0
Date: 2026-10-05

## Purpose

Handelo separates the human user's personal wallet from the wallet used by the autonomous Handelo agent.

The product must never require a user to expose a personal-wallet private key to Handelo or to an LLM.

The hackathon demo may use a configured, funded Handelo Agentic Wallet so judges can enter the product without API-key or wallet setup. Demo execution must remain real and truthful: simulated actions are labelled simulated; real transactions use the configured demo wallet.

The long-term product supports user-specific wallet contexts and controlled agent execution. The exact authorization/funding mechanism must use a BNB-supported wallet primitive where possible rather than a custom private-key derivation scheme.

## Current BNB direction

BNB Agent Studio currently provides agent runtime/deployment tooling, wallet-provider selection, ERC-8004 agent identity, and read-only chain tools. Current Studio/SDK documentation lists EVM-local, TWAK and Altana wallet options in Studio, while the SDK also documents remote-signing options such as Turnkey.

Agent Studio's security model keeps wallet keys out of MCP and separates the signing-capable agent layer from the service layer.

Altana is especially relevant for Handelo because the current BNB documentation describes its Smart Agentic Wallet/session-key model with scoped permissions such as spending limits, allowlists and time bounds. This must be validated against the exact mainnet APIs before production integration.

## Wallet roles

### Personal Wallet

The user's normal BSC-compatible EVM wallet.

Examples may include MetaMask, Rabby, Binance Wallet, Bitget Wallet or another compatible provider.

Responsibilities:
- establish the user's wallet identity;
- hold assets the user has not delegated to an agent;
- fund or receive funds from an agent wallet where the chosen architecture supports it;
- provide explicit signatures when required.

Handelo must not assume that connecting a personal wallet grants spending authority.

### Agent Wallet

A dedicated execution context controlled by the Handelo agent through a BNB-supported wallet/provider and bounded by explicit policy.

Responsibilities:
- hold only funds intended for autonomous strategies;
- execute approved strategy actions;
- obey spend/exposure/reserve limits;
- expose balances and transaction history to the user;
- support controlled funding and withdrawal flows where the selected wallet primitive supports them.

The agent private key must not be exposed to the user interface or LLM. Key custody and signing must remain inside the selected secure wallet infrastructure.

## Product modes

### Demo Mode

Try Demo enters a preconfigured Handelo environment.

- No judge API-key setup.
- No judge wallet setup.
- Configured demo Agentic Wallet.
- Clear DEMO MODE disclosure.
- Real transactions only when deliberately funded for demonstration.
- No fabricated transaction hashes or portfolio changes.

### User Mode

Connect Wallet connects a user's BSC-compatible personal wallet.

The first version of user mode may be read/portfolio focused until the authorization model for autonomous spending is implemented and verified.

Do not imply that wallet connection alone authorizes Handelo to spend.

## Target user flow

1. User connects personal wallet.
2. Handelo reads supported BSC portfolio state.
3. User creates or configures an Agent Wallet/execution context using the selected BNB-supported wallet architecture.
4. User explicitly funds or authorizes the execution context.
5. User sets strategy and risk limits.
6. Handelo agent executes only inside those limits.
7. User can inspect agent balance, permissions, strategies and activity.
8. User can request a transfer back to the personal wallet.
9. Transfers require the appropriate deterministic policy and signing/authorization boundary.
10. Revocation must stop future autonomous execution.

## Security boundaries

- Personal wallet private keys never enter Handelo's LLM.
- Agent wallet private keys never enter the LLM or browser UI.
- Wallet connection does not equal spending authorization.
- Strategy limits are deterministic.
- Risk Governor remains authoritative.
- Agent runtime cannot bypass policy.
- Withdrawal destinations should be constrained to verified user-controlled wallets where the selected infrastructure permits.
- Every transfer/execution has an explicit auditable state.
- Failed, pending and successful transactions are represented truthfully.
- Revocation must be testable.
- Restart/recovery must not create duplicate execution.

## Required architecture investigation before autonomous runtime

Validate with current BNB/Agent Studio primitives:
1. Per-user agent-wallet isolation.
2. Agent Studio wallet provider best fit for Handelo.
3. Altana scoped/session-key capabilities on BSC mainnet.
4. TWAK/Turnkey alternatives and tradeoffs.
5. Personal-wallet funding into an agent wallet.
6. Agent-wallet withdrawal back to the user's personal wallet.
7. Spending caps, allowlists and time bounds.
8. Revocation and recovery.
9. Wallet identity and ERC-8004 relationship.
10. Public demo deployment/security constraints.
11. Whether Handelo should use Agent Studio as the actual agent runtime or only selected wallet/identity primitives.

No autonomous money-moving implementation is considered complete until these questions have concrete, tested answers.

## Build sequence

Wallet architecture -> user wallet context -> agent wallet lifecycle -> portfolio ownership -> autonomous strategy runtime -> risk/execution -> verification -> withdrawal/revocation -> live validation.
