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

This is a static, non-Next.js frontend. Both single-segment endpoints (such as `/api/markets`) and nested endpoints (such as `/api/wallet/status`) are explicitly rewritten through `api/proxy.js`. The wrapper restores the canonical `/api/...` path before invoking the shared proxy. Regression tests cover both route families and the proxy's upstream URL construction.

## Vercel and VPS configuration

Set these as server-side Vercel Production environment variables. Do not prefix them with `NEXT_PUBLIC_` or `VITE_`:

- `HANDELO_API_ORIGIN=https://handelo-api.185-7-81-139.sslip.io`
- `HANDELO_CLIENT_API_KEY` (must match the VPS value; never expose it to browser JavaScript)
- `HANDELO_WEB_AUTH_ENABLED=false` (public hackathon demo, no website username/password prompt)

For the dedicated API hostname, add this separate site to `/etc/caddy/Caddyfile` on the VPS:

```caddy
handelo-api.185-7-81-139.sslip.io {
    reverse_proxy 127.0.0.1:8787
}
```

Validate the Caddyfile before reloading. On this VPS, use `caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` rather than relying on `systemctl reload caddy`.

Public demo mode means the API proxy is publicly callable; it is a shared demo instance, not a multi-user private account system. The proxy hard-blocks `POST /api/execute` while public mode is active. Keep both `HANDELO_EXECUTION_ENABLED=false` and `HANDELO_STRATEGY_WORKER_ENABLED=false` on the VPS. To re-enable the website Basic-auth gate, set `HANDELO_WEB_AUTH_ENABLED=true` and configure `HANDELO_WEB_USERNAME` and `HANDELO_WEB_PASSWORD` server-side. MCP authentication remains separate.

The existing market-read endpoints are public in either mode. Keep execution disabled until controlled real-money validation.

To point it at another API without rebuilding:

```js
localStorage.setItem("handelo_api_url", "https://your-api.example.com")
```

The frontend never handles private keys. Wallet execution remains behind the existing API/Agentic Wallet boundary.
