# Handelo Web

The first Handelo product surface: a restrained AI workspace for understanding tokenized-stock markets on BSC.

## Run

From the repository root:

```bash
pnpm --filter @handelo/web test
```

Serve the web directory with any static server:

```bash
cd apps/handelo-web
python -m http.server 5173
```

The UI expects the Handelo API at `http://localhost:8787` by default.

To point it at another API without rebuilding:

```js
localStorage.setItem("handelo_api_url", "https://your-api.example.com")
```

The frontend never handles private keys. Wallet execution remains behind the existing API/Agentic Wallet boundary.
