# Handelo VPS Deployment (PM2)

This guide puts the backend processes on one Ubuntu VPS and keeps them running under PM2. It does not move or redesign the web frontend.

## What runs on the VPS

- `handelo-api`: API, market data, wallet-policy endpoints, and the strategy runtime.
- `handelo-telegram`: the Telegram long-polling bot; it calls the API over loopback.
- `handelo-mcp-http`: the read-only remote MCP endpoint for Claude.ai.

The strategy worker is started inside the API only when its explicit environment gates are enabled. Do not start a second PM2 process for the strategy worker. Keep live execution disabled during initial hosting validation. PM2 can restart crashed processes and restore them after a reboot, but it cannot keep the service online while the VPS itself is down.

## 1. Connect

From a terminal on your computer, connect using the actual IPv4 address:

```bash
ssh root@YOUR_VPS_IP
```

The IP is enough for SSH and initial setup. Claude.ai remote MCP and a hosted HTTPS frontend need public HTTPS hostnames before the whole system can be connected.

## 2. Install prerequisites

These commands assume Ubuntu 22.04/24.04. Install Node.js 22 using the Node.js version manager `n`, then install pnpm and PM2:

```bash
apt-get update
apt-get install -y git curl ca-certificates nginx nodejs npm
npm install --global n
n 22
hash -r
node --version
npm install --global pnpm@10.15.0 pm2
pnpm --version
pm2 --version
```

Confirm `node --version` reports Node.js 22 before continuing.

## 3. Clone and install as a dedicated user

```bash
adduser --disabled-password --gecos "" handelo
mkdir -p /opt/handelo
chown handelo:handelo /opt/handelo
runuser -u handelo -- git clone https://github.com/Investorquab/Handelo.git /opt/handelo
runuser -u handelo -- bash -lc 'cd /opt/handelo && pnpm install --no-frozen-lockfile'
mkdir -p /opt/handelo/logs /opt/handelo/data
chown -R handelo:handelo /opt/handelo
```

If this repository is already cloned on the VPS, do not clone over it. Keep the existing checkout and back up its `.env` before updating code.

## 4. Set the environment file

```bash
cp /opt/handelo/.env.example /opt/handelo/.env
chown handelo:handelo /opt/handelo/.env
chmod 600 /opt/handelo/.env
nano /opt/handelo/.env
```

Edit the values directly on the VPS. Never commit the real `.env` or paste its contents into chat.

Set the real provider values you will use, including `BINANCE_WEB3_API_KEY`, `BINANCE_WEB3_SECRET_KEY`, and `TELEGRAM_BOT_TOKEN`. Set `HANDELO_API_KEY` if the AI provider requires a key. Generate the MCP connector key on the VPS using `openssl rand -hex 32`; put its output in `HANDELO_MCP_API_KEY` and keep it for the Claude.ai connector setup.

Confirm these settings are present:

```dotenv
PORT=8787
HOST=127.0.0.1
HANDELO_API_URL=http://127.0.0.1:8787
HANDELO_MCP_PORT=8789
HANDELO_EXECUTION_ENABLED=false
HANDELO_STRATEGY_WORKER_ENABLED=false
HANDELO_STRATEGY_STORE_PATH=/opt/handelo/data/strategies.json
HANDELO_STRATEGY_EXECUTION_STORE_PATH=/opt/handelo/data/strategy-executions.json
HANDELO_CORS_ORIGIN=https://YOUR_FRONTEND_ORIGIN
HANDELO_MCP_ALLOWED_ORIGINS=https://claude.ai,https://www.claude.ai
```

Replace `YOUR_FRONTEND_ORIGIN` with the exact origin of the deployed Handelo frontend, without a trailing slash. Keep execution and the strategy worker disabled until controlled execution has been explicitly validated. Do not place wallet private keys in the LLM, Telegram, or MCP environment. The MCP server has read-only tools.

The strategy JSON files live in `/opt/handelo/data`, away from source files. Back up this directory before deployments. CORS is not authentication; it does not stop non-browser clients from sending requests.

## 5. Start the processes

```bash
runuser -u handelo -- bash -lc 'cd /opt/handelo && pm2 start ecosystem.config.cjs --env production'
runuser -u handelo -- pm2 status
runuser -u handelo -- pm2 logs --lines 100
```

Check the local health endpoints:

```bash
curl --fail http://127.0.0.1:8787/health
curl --fail http://127.0.0.1:8789/health
```

Both must return successful JSON responses. If a process is `errored` or keeps restarting, read its PM2 logs and fix the missing configuration rather than disabling automatic restarts.

## 6. Enable restart after reboot

Run PM2's startup helper as the `handelo` user:

```bash
runuser -u handelo -- bash -lc 'pm2 startup systemd'
```

PM2 prints a system command for systemd registration. Run the exact command it prints as root, then save the process list:

```bash
runuser -u handelo -- pm2 save
```

PM2 will then restore these saved processes on reboot and restart them if they crash.

## 7. Set up public HTTPS

Create DNS `A` records pointing to the VPS:

- `api.YOUR_DOMAIN` for the API.
- `mcp.YOUR_DOMAIN` for the remote MCP server.

After the names resolve to the VPS, install Certbot:

```bash
apt-get install -y certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/handelo` with your real hostnames:

```nginx
server {
    listen 80;
    server_name api.YOUR_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name mcp.YOUR_DOMAIN;
    client_max_body_size 64k;

    location / {
        proxy_pass http://127.0.0.1:8789;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Enable and check the Nginx site, then issue certificates:

```bash
ln -s /etc/nginx/sites-available/handelo /etc/nginx/sites-enabled/handelo
nginx -t
systemctl reload nginx
certbot --nginx -d api.YOUR_DOMAIN -d mcp.YOUR_DOMAIN
```

Replace each placeholder with hostnames you control. Do not expose ports 8787 or 8789 to the public internet; Nginx should be the public HTTPS entry point. Allow SSH, HTTP and HTTPS in the VPS firewall. Before enabling UFW, make sure your active SSH port is allowed so you do not lock yourself out.

## 8. Point the hosted web UI at the API

The web client currently falls back to `http://localhost:8787`, which is correct only for local development. After the API hostname works over HTTPS, configure the deployed frontend so `window.HANDELO_API_URL` is set to `https://api.YOUR_DOMAIN` before the web client scripts load. Keep the local fallback for development. Do not put provider secrets or private keys in frontend JavaScript.

## 9. Connect Claude.ai

Configure Claude.ai's remote MCP connector with:

- Server URL: `https://mcp.YOUR_DOMAIN/mcp`
- Header name: `X-Handelo-MCP-Key`
- Header value: the `HANDELO_MCP_API_KEY` saved on the VPS

Use HTTPS only. Do not expose port 8789 directly. The available MCP tools are read-only market lookup/search; the currently individually validated asset remains NVIDIA (NVDA) represented by NVDAB on BNB Chain.

## 10. Deploy future updates

Only deploy after CI is green:

```bash
runuser -u handelo -- bash -lc 'cd /opt/handelo && git pull --ff-only origin main && pnpm install --no-frozen-lockfile && pnpm check && pnpm test'
runuser -u handelo -- bash -lc 'cd /opt/handelo && pm2 reload ecosystem.config.cjs --env production --update-env && pm2 save'
```

Back up `/opt/handelo/data` before updating. To roll back, check out the previously deployed commit, reinstall dependencies, rerun checks and reload PM2.

## Troubleshooting

- `pm2 status`: process state and restart counts.
- `pm2 logs handelo-api`: API errors.
- `pm2 logs handelo-telegram`: Telegram polling and API errors.
- `pm2 logs handelo-mcp-http`: MCP startup/protocol errors.
- `curl http://127.0.0.1:8787/health`: API health.
- `curl http://127.0.0.1:8789/health`: MCP process health.

A healthy process response alone does not prove that Telegram, the market-data provider, the AI provider, or the Claude.ai connector passed end-to-end validation.
