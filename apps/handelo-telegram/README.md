# Handelo Telegram

Telegram is a thin conversational client over the Handelo runtime.

## Configuration

Set:

- `TELEGRAM_BOT_TOKEN`
- `HANDELO_API_URL` (defaults to `http://localhost:8787`)
- `HANDELO_CLIENT_API_KEY` when the API requires it

Then run:

```bash
pnpm --filter @handelo/telegram start
```

The bot accepts private-chat messages only. It does not receive or store private keys, activate strategies, or bypass Handelo's risk/review controls.

For production, run the bot as a long-lived service with a process supervisor and keep the bot token outside source control.
