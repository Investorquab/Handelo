# Handelo BNB Wallet Provider Audit

Status: VERIFIED ARCHITECTURE BASELINE
Date: 2026-10-06

## Scope

This audit records the documented wallet surfaces Handelo may rely on before autonomous money movement. It deliberately separates Binance Agentic Wallet execution APIs from scoped delegation/session-key APIs so the product does not claim a provider capability that has not been implemented.

## Verified Binance Agentic Wallet contract

Binance's current Agentic Wallet documentation supports BNB Smart Chain (BSC) on chain ID 56. The documented wallet surface includes authentication/session lifecycle, wallet status/address/balance, wallet settings and daily quota, transaction lock state, supported chains, market-order quotes, market-order swaps and market-order status/listing.

Handelo uses these surfaces as follows:

| Handelo concern | Documented surface | Current state |
|---|---|---|
| Authentication | baw auth signin, auth verify, auth signout | Adapter boundary / manual setup |
| Connected state | baw wallet status | Implemented execution pre-check |
| BSC identity | baw wallet address | Implemented execution review/identity check |
| Balance | baw wallet balance | Provider capability / portfolio layer |
| Daily guardrails | baw wallet settings, wallet left-quota | Provider guardrail validation to complete |
| Pending transaction lock | baw wallet tx-lock | Provider guardrail validation to complete |
| Chain support | baw wallet chains | BSC contract pinned to 56 |
| Quote | baw market-order quote | Implemented |
| Execution | baw market-order swap | Implemented behind policy/security/confirmation gates |
| Token transfer | baw wallet send | Implemented as an explicit-confirmation BSC outbound transfer primitive; live confirmation remains pending |
| Withdrawal | baw wallet send | Implemented with a verified personal-owner destination and explicit approval boundary; live withdrawal remains unvalidated |
| Verification | baw market-order list | Implemented order polling |
| Token security | Binance Web3 token audit | Implemented before execution |

The quote/swap/list contract is intentionally the same execution path described by Binance's Agentic Wallet skill. Handelo does not substitute a custom signer or LLM-generated transaction calldata.

## What is not claimed

The generic WalletProviderAdapter createSession/revokeSession interfaces in Handelo are provider-neutral architecture seams. They are not evidence that Binance Agentic Wallet exposes those exact generic session APIs.

For user-delegated autonomous spending, BNB Agent Studio currently offers wallet-provider options including Altana. BNB documents Altana as a Smart Agentic Wallet with scoped session keys, spending limits, allowlists, time bounds and immediate revocation, with permissions registered onchain. This is the current preferred candidate for Handelo's user-owned scoped delegation.

That means:

- Binance Agentic Wallet remains a concrete execution adapter and strong hackathon integration.
- Agent Studio is the runtime/deployment/identity integration layer where useful.
- Altana is the current candidate for user-owned scoped delegation.
- Handelo's deterministic Risk Governor remains authoritative above all wallet-provider permissions.
- No provider is treated as production-ready for user funding/withdrawal until the actual mainnet flow is exercised and tested.

## Phase 1 decisions

### Provider decision

Decision: use BNB Agent Studio as the agent runtime/deployment/identity layer, Binance Agentic Wallet for the documented BSC market-order execution path, and Altana as the preferred candidate for user-owned scoped delegation.

This preserves a deep Binance Wallet integration while giving Handelo a credible path for per-user permissions, spend caps, allowlists, expiry and revocation.

### Mainnet gate before Phase 2 autonomous spending

The following remain live-validation gates:

1. Per-user isolation across two distinct owner wallets.
2. Funding from personal wallet into the selected agent execution context. The documented `wallet send` primitive is insufficient for this direction because it operates from the connected Agentic Wallet. Handelo now has a provider-neutral EIP-1193 personal-wallet signing boundary that builds the BSC ERC-20 transfer and verifies the connected chain/account; live wallet confirmation and on-chain validation remain required.
3. Withdrawal back to the verified personal wallet.
4. Permission scope enforcement on a real BSC execution.
5. Spend-cap enforcement.
6. Expiry enforcement.
7. Revocation and restart/recovery.
8. User consent UX.

These are intentionally not marked complete by documentation alone.

## Personal-wallet funding boundary

The funding authorization remains provider-independent and pre-chain. After explicit approval, `buildPersonalWalletFundingTransaction` constructs the ERC-20 `transfer(agentWallet, amount)` request for BSC, and `sendPersonalWalletFunding` requires chain ID `0x38`, verifies the connected personal account matches the approved owner, then delegates the signature to the injected EIP-1193 provider. A returned transaction hash is accepted only when it has the expected hex shape. `waitForPersonalWalletFundingReceipt` separately polls `eth_getTransactionReceipt` and only reports `CONFIRMED` for a successful mined receipt; submission, confirmation, and final settlement remain distinct.

## Evidence references

- Binance Agentic Wallet: https://developers.binance.com/en/docs/products/agentic-wallet/welcome
- Binance Agentic Wallet skill: https://github.com/binance/binance-skills-hub/tree/main/skills/binance-web3/binance-agentic-wallet
- BNB Agent Studio: https://www.bnbchain.org/en/bnb-agent-studio
- Altana in BNB Agent Studio: https://www.bnbchain.org/en/blog/altana-in-bnb-agent-studio-agents-with-limits-you-set
