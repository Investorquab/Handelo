import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const apiDir = fileURLToPath(new URL("../api/", import.meta.url));
const nestedRoutes = [
  "wallet/status",
  "wallet/address",
  "wallet/auth",
  "wallet/guardrails",
  "wallet/signout",
  "workspace/snapshot",
  "workspace/stream",
  "portfolio/rebalance-preview",
  "strategy/risk",
  "strategies/activate",
  "strategies/cancel",
  "strategies/edit",
  "strategies/pause",
  "strategies/resume",
  "strategies/worker",
  "strategies/attribution",
  "strategies/executions",
  "strategies/all",
  "strategies/[id]"
];

test("nested API paths have explicit Vercel function entry points", () => {
  for (const route of nestedRoutes) {
    const routeFile = join(apiDir, route + ".js");
    assert.ok(existsSync(routeFile), `Missing Vercel route entry point: ${route}`);
    const source = readFileSync(routeFile, "utf8");
    assert.match(source, /import handler from ["']\.\.\/\[\.\.\.path\]\.js["']/);
    assert.match(source, /export default handler/);
  }
});

test("nested APIs delegate to the shared authenticated proxy", () => {
  const proxy = readFileSync(join(apiDir, "[...path].js"), "utf8");
  for (const marker of ["HANDELO_CLIENT_API_KEY", "HANDELO_WEB_USERNAME", "x-handelo-api-key", "x-handelo-auth-required"]) {
    assert.ok(proxy.includes(marker), `Shared proxy is missing security marker: ${marker}`);
  }
});
