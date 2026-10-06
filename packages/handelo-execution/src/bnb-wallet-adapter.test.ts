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
    /does not match the connected BNB wallet context/
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
