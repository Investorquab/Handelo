import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createHandeloMcpHttpServer, isHandeloMcpHttpEntrypoint } from "./http.js";
import { fileURLToPath } from "node:url";
import type { McpMarketClient } from "./protocol.js";

const API_KEY = "test-secret-key-with-at-least-thirty-two-characters";
const asset = {
  underlyingTicker: "NVDA",
  underlyingName: "NVIDIA",
  tokenSymbol: "NVDAB",
  platformId: "bstock",
  binanceChainId: "56",
  tokenPrice: "232.59",
  referencePrice: "232.41",
  tokenContractAddress: "0x0f2fac66c1d1afb4e2a7884261eb00f63598a743",
  statusInfo: { openState: true, marketStatus: "OPEN" },
};

async function withOAuthServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createHandeloMcpHttpServer({
    authMode: "oauth",
    oauth: {
      issuer: "https://handelo.test",
      username: "test-user",
      password: "this-is-a-long-oauth-test-password",
      tokenSecret: "test-oauth-token-secret-with-at-least-32-characters",
    },
    allowedOrigins: ["https://claude.ai"],
    market: fixture(),
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListen);
      reject(error);
    };
    const onListen = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", onListen);
  });
  try {
    const address = server.address() as AddressInfo;
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fixture(): McpMarketClient {
  return {
    find: async () => asset as never,
    search: async () => [{ ticker: "NVDA", companyName: "NVIDIA", assets: [] }] as never,
  };
}

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createHandeloMcpHttpServer({ apiKey: API_KEY, allowedOrigins: ["https://claude.ai"], market: fixture() });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListen);
      reject(error);
    };
    const onListen = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", onListen);
  });
  try {
    const address = server.address() as AddressInfo;
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("HTTP MCP health endpoint is available without exposing tool data", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl + "/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: "handelo-mcp-http" });
  });
});

test("HTTP MCP requires the shared connector key", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(response.status, 401);
  });
});

test("HTTP MCP authenticates requests and responds to initialize and tools/list", async () => {
  await withServer(async (baseUrl) => {
    const headers = { "content-type": "application/json", "x-handelo-mcp-key": API_KEY, origin: "https://claude.ai" };
    const initialize = await fetch(baseUrl + "/mcp", {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
    });
    assert.equal(initialize.status, 200);
    assert.equal(initialize.headers.get("mcp-protocol-version"), "2025-06-18");

    const list = await fetch(baseUrl + "/mcp", {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const payload = await list.json() as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(payload.result.tools.map((tool) => tool.name), ["handelo_market_lookup", "handelo_market_search"]);
  });
});

test("HTTP MCP blocks unapproved origins and non-POST calls", async () => {
  await withServer(async (baseUrl) => {
    const key = { "x-handelo-mcp-key": API_KEY, "content-type": "application/json" };
    const originResponse = await fetch(baseUrl + "/mcp", {
      method: "POST", headers: { ...key, origin: "https://untrusted.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(originResponse.status, 403);

    const getResponse = await fetch(baseUrl + "/mcp", { headers: key });
    assert.equal(getResponse.status, 405);
  });
});

test("HTTP MCP rejects weak/missing server keys before creating a server", () => {
  assert.throws(() => createHandeloMcpHttpServer({ apiKey: "short", market: fixture() }), /at least 32 characters/);
});


test("HTTP MCP entrypoint detection supports PM2's ESM process wrapper", () => {
  const moduleUrl = new URL("./http.ts", import.meta.url).href;
  const modulePath = fileURLToPath(new URL(moduleUrl));

  assert.equal(
    isHandeloMcpHttpEntrypoint(moduleUrl, "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js", modulePath),
    true,
  );
  assert.equal(isHandeloMcpHttpEntrypoint(moduleUrl, modulePath, undefined), true);
  assert.equal(isHandeloMcpHttpEntrypoint(moduleUrl, "/opt/other/http.ts", undefined), false);
});


test("HTTP MCP supports Claude OAuth registration, PKCE, bearer access, and rotating refresh tokens", async () => {
  await withOAuthServer(async (baseUrl) => {
    const protectedResource = await fetch(baseUrl + "/.well-known/oauth-protected-resource");
    assert.equal(protectedResource.status, 200);
    const metadata = await protectedResource.json() as { resource: string; authorization_servers: string[] };
    assert.equal(metadata.resource, "https://handelo.test/mcp");
    assert.deepEqual(metadata.authorization_servers, ["https://handelo.test"]);

    const authorizationMetadata = await fetch(baseUrl + "/.well-known/oauth-authorization-server");
    assert.equal(authorizationMetadata.status, 200);
    const authorizationDetails = await authorizationMetadata.json() as Record<string, unknown>;
    assert.equal(authorizationDetails.authorization_endpoint, "https://handelo.test/authorize");
    assert.equal(authorizationDetails.registration_endpoint, "https://handelo.test/register");
    assert.deepEqual(authorizationDetails.code_challenge_methods_supported, ["S256"]);

    const registrationResponse = await fetch(baseUrl + "/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude test",
        redirect_uris: ["http://127.0.0.1:4321/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registrationResponse.status, 201);
    const client = await registrationResponse.json() as { client_id: string };
    assert.ok(client.client_id);

    const verifier = "a".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizeUrl = new URL(baseUrl + "/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", client.client_id);
    authorizeUrl.searchParams.set("redirect_uri", "http://127.0.0.1:4321/callback");
    authorizeUrl.searchParams.set("state", "state-test-value");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("scope", "market:read");
    authorizeUrl.searchParams.set("resource", "https://handelo.test/mcp");

    const authorizePage = await fetch(authorizeUrl);
    assert.equal(authorizePage.status, 200);
    const pageText = await authorizePage.text();
    const requestId = pageText.match(/name="request_id" value="([^"]+)"/)?.[1];
    assert.ok(requestId, "authorization page should contain a CSRF-resistant request ID");

    const authorizeResponse = await fetch(baseUrl + "/authorize", {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        request_id: requestId,
        username: "test-user",
        password: "this-is-a-long-oauth-test-password",
      }),
    });
    assert.equal(authorizeResponse.status, 302);
    const callback = new URL(authorizeResponse.headers.get("location") ?? "");
    assert.equal(callback.origin, "http://127.0.0.1:4321");
    assert.equal(callback.searchParams.get("state"), "state-test-value");
    const code = callback.searchParams.get("code");
    assert.ok(code);

    const tokenResponse = await fetch(baseUrl + "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code,
        redirect_uri: "http://127.0.0.1:4321/callback",
        code_verifier: verifier,
        resource: "https://handelo.test/mcp",
      }),
    });
    assert.equal(tokenResponse.status, 200);
    const tokens = await tokenResponse.json() as { access_token: string; refresh_token: string };
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);

    const toolsResponse = await fetch(baseUrl + "/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer " + tokens.access_token,
        "content-type": "application/json",
        origin: "https://claude.ai",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(toolsResponse.status, 200);
    const toolsPayload = await toolsResponse.json() as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(toolsPayload.result.tools.map((tool) => tool.name), ["handelo_market_lookup", "handelo_market_search"]);

    const refreshResponse = await fetch(baseUrl + "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        resource: "https://handelo.test/mcp",
      }),
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = await refreshResponse.json() as { access_token: string; refresh_token: string };
    assert.ok(refreshed.access_token);
    assert.ok(refreshed.refresh_token);
    assert.notEqual(refreshed.refresh_token, tokens.refresh_token);

    const oldRefreshResponse = await fetch(baseUrl + "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        resource: "https://handelo.test/mcp",
      }),
    });
    assert.equal(oldRefreshResponse.status, 400);
  });
});

test("OAuth-mode MCP rejects requests without a valid bearer token and advertises resource metadata", async () => {
  await withOAuthServer(async (baseUrl) => {
    const response = await fetch(baseUrl + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
  });
});


test("OAuth authorization rejects a missing pending request with a safe expiration page", async () => {
  await withOAuthServer(async (baseUrl) => {
    const response = await fetch(baseUrl + "/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        request_id: "not-a-live-request",
        username: "test-user",
        password: "this-is-a-long-oauth-test-password",
      }),
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /authorization request expired/i);
  });
});
