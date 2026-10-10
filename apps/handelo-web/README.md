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

The UI uses `http://localhost:8787` in local development. On Vercel it calls the same-origin `/api/*` serverless proxy, which forwards requests to the VPS without exposing the backend client key to browser JavaScript.

## Vercel API route layout

This is a static, non-Next.js frontend. Vercel's non-Next.js file router does not implement the Next.js arbitrary-depth `[...path]` catch-all behavior. Keep explicit function entry points for nested API paths under `api/`; they delegate to the shared `api/[...path].js` proxy handler. The route-coverage test ensures wallet, workspace, strategy, and portfolio endpoints do not silently become 404s.

## Vercel environment variables

Set these as server-side project environment variables. Do not prefix them with `NEXT_PUBLIC_` or `VITE_`:

- `HANDELO_API_ORIGIN=https://handelo.duckdns.org`
- `HANDELO_CLIENT_API_KEY` (the same generated secret as the VPS)
- `HANDELO_WEB_USERNAME` (workspace login username)
- `HANDELO_WEB_PASSWORD` (strong workspace login password)

The public market-read endpoints do not require the workspace login. Wallet, strategy, review, execution and chat requests pass through the authenticated proxy. Keep `HANDELO_EXECUTION_ENABLED=false` until controlled real-money validation.

To point it at another API without rebuilding:

```js
localStorage.setItem("handelo_api_url", "https://your-api.example.com")
```

The frontend never handles private keys. Wallet execution remains behind the existing API/Agentic Wallet boundary.
