import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

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

test("nested API routes are rewritten through one shared proxy function", () => {
  assert.ok(existsSync(join(apiDir, "proxy.js")), "Missing shared proxy function");
  assert.equal(config.rewrites.length, 5);
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

test("shared proxy retains backend and website authentication", () => {
  const proxy = readFileSync(join(apiDir, "[...path].js"), "utf8");
  for (const marker of ["HANDELO_CLIENT_API_KEY", "HANDELO_WEB_USERNAME", "x-handelo-api-key", "x-handelo-auth-required"]) {
    assert.ok(proxy.includes(marker), `Shared proxy is missing security marker: ${marker}`);
  }
  const routedProxy = readFileSync(join(apiDir, "proxy.js"), "utf8");
  assert.match(routedProxy, /query\.delete\("__route"\)/);
  assert.match(routedProxy, /sharedHandler\(req, res\)/);
});
