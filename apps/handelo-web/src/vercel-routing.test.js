import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import routedProxy from "../api/proxy.js";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const apiDir = join(rootDir, "api");
const config = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

const nestedRoutes = [
  "wallet/status", "wallet/address", "wallet/auth", "wallet/guardrails", "wallet/signout",
  "workspace/snapshot", "workspace/stream", "portfolio/rebalance-preview", "strategy/risk",
  "strategies/activate", "strategies/cancel", "strategies/edit", "strategies/pause",
  "strategies/resume", "strategies/worker", "strategies/attribution", "strategies/executions",
  "strategies/all", "strategies/NVDAB"
];
const topLevelRoutes = ["markets", "earnings", "gap-radar", "portfolio", "history", "strategies", "chat", "quote", "review", "execute"];

test("single-segment API paths are rewritten through the shared proxy", () => {
  assert.ok(existsSync(join(apiDir, "proxy.js")), "Missing shared proxy function");
  assert.equal(existsSync(join(apiDir, "[...path].js")), false, "Do not use Next.js catch-all syntax in this non-Next Vercel function project");
  assert.ok(config.rewrites.some(rule =>
    rule.source === "/api/:endpoint" &&
    rule.destination === "/api/proxy?__route=:endpoint"
  ), "Missing Vercel rewrite for single-segment API endpoints");
  for (const route of topLevelRoutes) {
    assert.ok(config.rewrites.some(rule =>
      rule.source === "/api/:endpoint" &&
      rule.destination === "/api/proxy?__route=:endpoint"
    ), `Top-level API route is not covered by shared rewrite: ${route}`);
  }
});

test("nested API routes are rewritten through one shared proxy function", () => {
  assert.equal(config.rewrites.length, 6);
  for (const group of ["wallet", "workspace", "portfolio", "strategy", "strategies"]) {
    assert.ok(
      config.rewrites.some(rule =>
        rule.source === `/api/${group}/:endpoint` &&
        rule.destination === `/api/proxy?__route=${group}/:endpoint`
      ),
      `Missing Vercel rewrite for /api/${group}/:endpoint`
    );
  }
  for (const route of nestedRoutes) {
    const group = route.split("/")[0];
    const endpoint = route.slice(group.length + 1);
    assert.ok(endpoint && config.rewrites.some(rule =>
      rule.source === `/api/${group}/:endpoint` &&
      rule.destination === `/api/proxy?__route=${group}/:endpoint`
    ), `Nested route is not covered by a rewrite: ${route}`);
  }
});

test("shared proxy keeps the API key server-side and supports optional website auth", () => {
  const proxy = readFileSync(join(rootDir, "src", "proxy-handler.js"), "utf8");
  for (const marker of ["HANDELO_CLIENT_API_KEY", "x-handelo-api-key", "x-handelo-auth-required", "HANDELO_WEB_AUTH_ENABLED"]) {
    assert.ok(proxy.includes(marker), `Shared proxy is missing security/configuration marker: ${marker}`);
  }
  assert.ok(proxy.includes('process.env.HANDELO_WEB_AUTH_ENABLED==="true"'));
  assert.ok(proxy.includes('method==="POST"&&path==="execute"'));
  const routedSource = readFileSync(join(apiDir, "proxy.js"), "utf8");
  assert.ok(routedSource.includes('query.delete("__route")'));
  assert.match(routedSource, /sharedHandler\(req, res\)/);
});

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; this.writableEnded = true; this.headersSent = true; }
  };
}

function mockUpstream(status = 200) {
  return {
    status,
    headers: { get(name) { return name.toLowerCase() === "content-type" ? "application/json" : null; } },
    body: null
  };
}

test("public top-level route reaches the configured API without website credentials", async () => {
  const names = ["HANDELO_API_ORIGIN", "HANDELO_CLIENT_API_KEY", "HANDELO_WEB_AUTH_ENABLED", "HANDELO_WEB_USERNAME", "HANDELO_WEB_PASSWORD"];
  const oldEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const oldFetch = globalThis.fetch;
  let requestedUrl;
  let forwardedHeaders;
  try {
    process.env.HANDELO_API_ORIGIN = "https://handelo-api.185-7-81-139.sslip.io";
    process.env.HANDELO_CLIENT_API_KEY = "test-key-never-used-in-production";
    delete process.env.HANDELO_WEB_AUTH_ENABLED;
    delete process.env.HANDELO_WEB_USERNAME;
    delete process.env.HANDELO_WEB_PASSWORD;
    globalThis.fetch = async (url, options) => {
      requestedUrl = String(url);
      forwardedHeaders = options.headers;
      return mockUpstream(200);
    };
    const req = { url: "/api/proxy?__route=markets", method: "GET", headers: { accept: "application/json" } };
    const res = mockResponse();
    await routedProxy(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(req.url, "/api/markets");
    assert.equal(requestedUrl, "https://handelo-api.185-7-81-139.sslip.io/api/markets");
    assert.equal(forwardedHeaders["x-handelo-api-key"], "test-key-never-used-in-production");
    assert.equal(forwardedHeaders.authorization, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of names) {
      if (oldEnv[name] === undefined) delete process.env[name];
      else process.env[name] = oldEnv[name];
    }
  }
});

test("Vercel rewrite routing parameters are removed before upstream forwarding", async () => {
  const names = ["HANDELO_API_ORIGIN", "HANDELO_CLIENT_API_KEY", "HANDELO_WEB_AUTH_ENABLED"];
  const oldEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const oldFetch = globalThis.fetch;
  const urls = [];
  try {
    process.env.HANDELO_API_ORIGIN = "https://handelo-api.185-7-81-139.sslip.io";
    process.env.HANDELO_CLIENT_API_KEY = "test-key-never-used-in-production";
    delete process.env.HANDELO_WEB_AUTH_ENABLED;
    globalThis.fetch = async url => {
      urls.push(String(url));
      return mockUpstream(200);
    };
    const routedRequests = [
      ["/api/proxy?__route=markets&endpoint=markets", "https://handelo-api.185-7-81-139.sslip.io/api/markets"],
      ["/api/proxy?__route=wallet/status&endpoint=status", "https://handelo-api.185-7-81-139.sslip.io/api/wallet/status"],
      ["/api/proxy?__route=portfolio&endpoint=portfolio&wallet=0x1111111111111111111111111111111111111111", "https://handelo-api.185-7-81-139.sslip.io/api/portfolio?wallet=0x1111111111111111111111111111111111111111"]
    ];
    for (const [path, expectedUrl] of routedRequests) {
      const req = { url: path, method: "GET", headers: { accept: "application/json" } };
      const res = mockResponse();
      await routedProxy(req, res);
      assert.equal(res.statusCode, 200, path);
      assert.equal(urls.at(-1), expectedUrl, path);
    }
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of names) {
      if (oldEnv[name] === undefined) delete process.env[name];
      else process.env[name] = oldEnv[name];
    }
  }
});

test("public proxy mode blocks the execute endpoint independently of backend flags", async () => {
  const names = ["HANDELO_API_ORIGIN", "HANDELO_CLIENT_API_KEY", "HANDELO_WEB_AUTH_ENABLED"];
  const oldEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const oldFetch = globalThis.fetch;
  let calledUpstream = false;
  try {
    process.env.HANDELO_API_ORIGIN = "https://handelo-api.185-7-81-139.sslip.io";
    process.env.HANDELO_CLIENT_API_KEY = "test-key-never-used-in-production";
    delete process.env.HANDELO_WEB_AUTH_ENABLED;
    globalThis.fetch = async () => { calledUpstream = true; return mockUpstream(200); };
    const req = { url: "/api/proxy?__route=execute", method: "POST", headers: { "content-type": "application/json" } };
    const res = mockResponse();
    await routedProxy(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error, "Execution is disabled for the public workspace.");
    assert.equal(calledUpstream, false);
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of names) {
      if (oldEnv[name] === undefined) delete process.env[name];
      else process.env[name] = oldEnv[name];
    }
  }
});
