import assert from "node:assert/strict";
import test from "node:test";
import { BAW_COMMAND, BAW_SHELL, TOKEN_AUDIT_HEADERS, assertTokenAuditSafe, normalizeTokenAudit } from "./index.js";

test("uses the Windows baw command shim when running on Windows", () => {
  assert.equal(BAW_COMMAND, process.platform === "win32" ? "baw.cmd" : "baw");
  assert.equal(BAW_SHELL, process.platform === "win32");
});

test("sends Binance's documented agent headers for token audits", () => {
  assert.deepEqual(TOKEN_AUDIT_HEADERS, {
    "content-type": "application/json",
    "source": "agent",
    "accept-encoding": "identity",
    "user-agent": "binance-web3/1.4 (Skill)"
  });
});


test("hides risk details when Binance has no audit result", () => {
  const normalized = normalizeTokenAudit({
    hasResult: false,
    isSupported: false,
    riskLevel: -1,
    riskLevelEnum: "LOW",
    extraInfo: { buyTax: "0", sellTax: "0", isVerified: true },
    riskItems: [{ id: "CONTRACT_RISK" }]
  });
  assert.deepEqual(normalized, {
    hasResult: false,
    isSupported: false
  });
});

test("preserves supported audit details", () => {
  const audit = {
    hasResult: true,
    isSupported: true,
    riskLevel: 1,
    riskLevelEnum: "LOW" as const,
    extraInfo: { buyTax: "0", sellTax: "0", isVerified: true },
    riskItems: []
  };
  assert.deepEqual(normalizeTokenAudit(audit), audit);
});


test("security audit blocks missing or unsupported audit data before execution", () => {
  assert.throws(
    () => assertTokenAuditSafe({ hasResult: false, isSupported: false }),
    /audit data is unavailable/,
  );
  assert.throws(
    () => assertTokenAuditSafe({ hasResult: true, isSupported: false, riskLevel: 1 }),
    /audit data is unavailable/,
  );
});

test("security audit blocks high-risk tokens before execution", () => {
  assert.throws(
    () => assertTokenAuditSafe({ hasResult: true, isSupported: true, riskLevel: 4, riskLevelEnum: "HIGH" }),
    /HIGH risk/,
  );
  assert.doesNotThrow(
    () => assertTokenAuditSafe({ hasResult: true, isSupported: true, riskLevel: 3, riskLevelEnum: "MEDIUM" }),
  );
});
