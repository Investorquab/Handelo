# Handelo Telegram

Telegram is a private-chat conversational client over the same Handelo API/runtime used by the web application. It does not implement separate market, policy, wallet, or execution logic.

## Configuration

Set these environment variables:

- TELEGRAM_BOT_TOKEN — token created with Telegram's BotFather. Keep it secret and out of source control.
- HANDELO_API_URL — Handelo API base URL; defaults to http://localhost:8787 for local development.
- HANDELO_CLIENT_API_KEY — set this when the Handelo API requires external-client authentication.

The root .env file is loaded when starting through the package command. For a hosted process, configure these values in the hosting provider's environment settings instead of committing an .env file.

## Run locally

Start the Handelo API in one terminal, then start the Telegram client from the repository root:

    pnpm --filter @handelo/telegram start

The bot supports /start and /help and forwards private-chat questions to the Handelo runtime. It ignores group messages, caps replies to Telegram's message-size limit, returns a safe generic message when a request fails, retries temporary polling failures with backoff, and shuts down on SIGINT/SIGTERM.

Telegram does not receive private keys, activate strategies, bypass policy, or replace the user's required review/approval. Strategy content is presented as a preview only.

## Before public launch

- Create the bot with BotFather and set TELEGRAM_BOT_TOKEN outside source control.
- Confirm the API URL is reachable from the bot host and configure HANDELO_CLIENT_API_KEY if required.
- Validate /start, /help, market questions, a simulated API failure, and polling recovery in a real private chat.
- Run the bot as a long-lived process with a supervisor; do not use a short-lived serverless function for long polling.
- Confirm that logs do not contain bot tokens, API keys, private keys, or unnecessary user-message content.
