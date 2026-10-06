import assert from "node:assert/strict";
import test from "node:test";
import { BnbWalletAdapter, probeBnbWalletAdapter } from "./bnb-wallet-adapter.js";
import type { WalletPermission } from "@handelo/core";
import type { WalletProviderCapabilities, WalletSessionGrant } from "./wallet-provider.js";

const complete: WalletProviderCapabilities = {
  bscMainnet: true,
  personalWallet: true,
  agentWallet: true,
  scopedPermissions: true,
  spendLimits: true,
  expiry: true,
  revocation: true,
  transferOut: true
};

function context(): import("@handelo/core").AgentWalletContext {
  return {
    mode: "USER" as const,
    role: "AGENT" as const,
    address: "0x2222222222222222222222222222222222222222",
    network: "BSC" as const,
    connected: true,
    balanceUsd: 100,
    ownerWallet: "0x1111111111111111111111111111111111111111",
    policy: { permissions: ["DCA" satisfies WalletPermission], revocable: true },
    status: "ACTIVE" as const
  };
}

function validGrant(): WalletSessionGrant {
  return {
    ownerWallet: "0x1111111111111111111111111111111111111111",
    agentWallet: "0x2222222222222222222222222222222222222222",
    network: "BSC" as const,
    permissions: ["DCA"],
    revocable: true
  };
}

function makeInvalidContext(
  overrides: Record<string, unknown>
): import("@handelo/core").AgentWalletContext {
  // These fixtures intentionally inject impossible discriminant states to exercise the runtime fail-closed boundary.
  return { ...context(), ...overrides } as unknown as import("@handelo/core").AgentWalletContext;
}

test("BNB adapter reports provider capabilities without exposing signing material", async () => {
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => context(),
    createSession: async () => ({ sessionId: "session-test" }),
    revokeSession: async () => undefined
  });

  const result = await probeBnbWalletAdapter(adapter);
  assert.equal(result.provider, "bnb-agent-wallet");
  assert.equal(result.autonomousExecutionReady, true);
  assert.equal(result.capabilities.scopedPermissions, true);
});

test("BNB adapter refuses session creation before the capability gate passes", async () => {
  const adapter = new BnbWalletAdapter({
    capabilities: async () => ({ ...complete, spendLimits: false }),
    getContext: async () => context(),
    createSession: async () => ({ sessionId: "should-not-run" })
  });

  await assert.rejects(adapter.createSession(validGrant()), /capability gate/);
});

test("BNB adapter requires an explicit runtime revocation implementation", async () => {
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => context()
  });

  await assert.rejects(adapter.revokeSession("session-1"), /session revocation/);
});

test("BNB adapter rejects an invalid wallet grant before invoking the provider", async () => {
  let providerCalls = 0;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => context(),
    createSession: async () => {
      providerCalls += 1;
      return { sessionId: "should-not-run" };
    }
  });

  await assert.rejects(
    adapter.createSession({
      ...validGrant(),
      ownerWallet: "not-an-address"
    }),
    /Owner wallet must be a valid EVM wallet address/
  );
  assert.equal(providerCalls, 0);
});

test("BNB adapter rejects non-revocable grants before provider invocation", async () => {
  let providerCalls = 0;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => context(),
    createSession: async () => {
      providerCalls += 1;
      return { sessionId: "should-not-run" };
    }
  });

  await assert.rejects(
    adapter.createSession({
      ...validGrant(),
      revocable: false
    }),
    /must be revocable/
  );
  assert.equal(providerCalls, 0);
});

test("BNB adapter rejects a grant for the wrong wallet context", async () => {
  let providerCalls = 0;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => ({
      ...context(),
      ownerWallet: "0x3333333333333333333333333333333333333333"
    }),
    createSession: async () => {
      providerCalls += 1;
      return { sessionId: "should-not-run" };
    }
  });

  await assert.rejects(
    adapter.createSession(validGrant()),
    /does not match the requesting personal wallet/
  );
  assert.equal(providerCalls, 0);
});



test("BNB adapter refuses session creation from a non-user or non-agent context", async () => {
  for (const invalidContext of [
    makeInvalidContext({ mode: "DEMO" }),
    makeInvalidContext({ role: "PERSONAL" })
  ]) {
    let providerCalls = 0;
    const adapter = new BnbWalletAdapter({
      capabilities: async () => complete,
      getContext: async () => invalidContext,
      createSession: async () => {
        providerCalls += 1;
        return { sessionId: "should-not-run" };
      }
    });

    await assert.rejects(
      adapter.createSession(validGrant()),
      /requires an active USER-mode agent wallet context/
    );
    assert.equal(providerCalls, 0);
  }
});

test("BNB adapter refuses disconnected, non-BSC, and inactive contexts", async () => {
  for (const invalidContext of [
    makeInvalidContext({ connected: false }),
    makeInvalidContext({ network: "ETHEREUM" }),
    makeInvalidContext({ status: "REVOKED" })
  ]) {
    let providerCalls = 0;
    const adapter = new BnbWalletAdapter({
      capabilities: async () => complete,
      getContext: async () => invalidContext,
      createSession: async () => {
        providerCalls += 1;
        return { sessionId: "should-not-run" };
      }
    });

    await assert.rejects(
      adapter.createSession(validGrant()),
      /requires a connected active BSC agent wallet context/
    );
    assert.equal(providerCalls, 0);
  }
});

test("BNB adapter forwards the validated normalized grant to the provider", async () => {
  const received: { grant?: WalletSessionGrant } = {};
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => context(),
    createSession: async grant => {
      received.grant = grant;
      return { sessionId: "session-valid" };
    }
  });

  const result = await adapter.createSession({
    ...validGrant(),
    ownerWallet: " 0x1111111111111111111111111111111111111111 ",
    allowedAssets: ["NVDAB"]
  });

  assert.equal(result.sessionId, "session-valid");
  const receivedGrant = received.grant;
  assert.ok(receivedGrant);
  assert.equal(receivedGrant.ownerWallet, "0x1111111111111111111111111111111111111111");
  assert.deepEqual(receivedGrant.allowedAssets, ["NVDAB"]);
});


test("BNB adapter intersects requested permissions with the active agent wallet policy", async () => {
  const received: { grant?: WalletSessionGrant } = {};
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => ({
      ...context(),
      policy: {
        permissions: ["DCA", "RECURRING"],
        maxTransactionUsd: 8,
        maxDailySpendUsd: 20,
        minimumReservePercent: 15,
        allowedAssets: ["NVDAB"],
        revocable: true
      }
    }),
    createSession: async grant => {
      received.grant = grant;
      return { sessionId: "session-policy-bounded" };
    }
  });

  const result = await adapter.createSession({
    ...validGrant(),
    permissions: ["DCA"],
    maxTransactionUsd: 10,
    maxDailySpendUsd: 25,
    minimumReservePercent: 5,
    allowedAssets: ["NVDAB"]
  });

  assert.equal(result.sessionId, "session-policy-bounded");
  assert.equal(received.grant?.maxTransactionUsd, 8);
  assert.equal(received.grant?.maxDailySpendUsd, 20);
  assert.equal(received.grant?.minimumReservePercent, 15);
  assert.deepEqual(received.grant?.permissions, ["DCA"]);
});

test("BNB adapter rejects a requested permission outside the active wallet policy", async () => {
  let providerCalls = 0;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => context(),
    createSession: async () => {
      providerCalls += 1;
      return { sessionId: "should-not-run" };
    }
  });

  await assert.rejects(
    adapter.createSession({ ...validGrant(), permissions: ["RECURRING"] }),
    /does not authorize permission "RECURRING"/
  );
  assert.equal(providerCalls, 0);
});

test("BNB adapter refuses an expired wallet policy before provider invocation", async () => {
  let providerCalls = 0;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => ({
      ...context(),
      policy: { ...context().policy, expiresAt: "2020-01-01T00:00:00.000Z" }
    }),
    createSession: async () => {
      providerCalls += 1;
      return { sessionId: "should-not-run" };
    }
  });

  await assert.rejects(
    adapter.createSession(validGrant()),
    /expiry must be a valid future timestamp/
  );
  assert.equal(providerCalls, 0);
});

test("BNB adapter gates revocation on the provider capability", async () => {
  let revokeCalls = 0;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => ({ ...complete, revocation: false }),
    getContext: async () => context(),
    revokeSession: async () => { revokeCalls += 1; }
  });

  await assert.rejects(
    adapter.revokeSession("session-1"),
    /revocation capability gate/
  );
  assert.equal(revokeCalls, 0);
});

test("BNB adapter forwards a valid revocation only when the provider supports it", async () => {
  let revoked: string | null = null;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => context(),
    revokeSession: async sessionId => { revoked = sessionId; }
  });

  await adapter.revokeSession("session-1");
  assert.equal(revoked, "session-1");
});
