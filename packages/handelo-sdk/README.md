# @handelo/sdk

A small typed client for sending natural-language requests to a Handelo runtime.

## Usage

```ts
import { createHandeloClient } from "@handelo/sdk";

const handelo = createHandeloClient({
  baseUrl: "https://your-handelo-api.example",
  apiKey: process.env.HANDELO_CLIENT_API_KEY,
});

const result = await handelo.chat({
  message: "What is happening with NVIDIA?",
});
```

For local development, use `http://localhost:8787` as the API base URL.

The SDK does not hold private keys, sign transactions, or bypass Handelo's review and risk controls. It is a client surface over the same runtime used by the web application.

Remote HTTP failures are exposed as `HandeloApiError` with the HTTP status code.
