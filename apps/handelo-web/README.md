# Handelo Web

Handelo uses one browser entry point: `index.html`.

## Product modes

- **Open Handelo** enters the approved real Handelo workspace. It stays powered by `src/app.js` and the existing Handelo API-backed market, wallet, portfolio, strategy, history, risk, execution and AI flows.
- **Open Demo** opens the supplied UI as an isolated simulated experience embedded inside the same `index.html`. Its balances, strategies and receipt are intentionally mocked. The demo runs in a sandbox and does not connect to the real wallet or production API.

Use `http://localhost:5173/` for the real landing page. Use `http://localhost:5173/?demo=1` to open the demo directly.

The real application never handles private keys. Wallet execution remains behind the existing API/Agentic Wallet boundary.

## Run locally

From the repository root:

```bash
pnpm --filter @handelo/web test
```

Serve the web directory:

```bash
cd apps/handelo-web
python -m http.server 5173
```
