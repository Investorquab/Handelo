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

## Vercel API routing

This is a static, non-Next.js frontend, so Vercel's `[...path]` function filename is not an arbitrary-depth catch-all. Nested wallet, workspace, portfolio, strategy and strategies routes are rewritten through `api/proxy.js`, which restores the requested path and delegates to the shared authenticated proxy. This keeps the deployment to two API functions rather than creating one serverless function per nested route, and avoids the Vercel Hobby plan's non-framework function-count limit.

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
