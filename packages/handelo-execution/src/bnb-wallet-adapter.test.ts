import assert from "node:assert/strict";
import test from "node:test";
import { BnbWalletAdapter, probeBnbWalletAdapter } from "./bnb-wallet-adapter.js";
import type { WalletProviderCapabilities } from "./wallet-provider.js";

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

test("BNB adapter reports provider capabilities without exposing signing material", async () => {
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => ({
      mode: "USER",
      role: "AGENT",
      address: "0x2222222222222222222222222222222222222222",
      network: "BSC",
      connected: true,
      balanceUsd: 100,
      ownerWallet: "0x1111111111111111111111111111111111111111",
      policy: { permissions: ["DCA"], revocable: true },
      status: "ACTIVE"
    }),
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
    getContext: async () => {
      throw new Error("not reached");
    },
    createSession: async () => ({ sessionId: "should-not-run" })
  });

  await assert.rejects(
    adapter.createSession({
      ownerWallet: "0x1111111111111111111111111111111111111111",
      agentWallet: "0x2222222222222222222222222222222222222222",
      network: "BSC",
      permissions: ["DCA"],
      revocable: true
    }),
    /capability gate/
  );
});

test("BNB adapter requires an explicit runtime revocation implementation", async () => {
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => {
      throw new Error("not reached");
    }
  });

  await assert.rejects(
    adapter.revokeSession("session-1"),
    /session revocation/
  );
});


test("BNB adapter rejects an invalid wallet grant before invoking the provider", async () => {
  let providerCalls = 0;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => {
      throw new Error("not reached");
    },
    createSession: async () => {
      providerCalls += 1;
      return { sessionId: "should-not-run" };
    }
  });

  await assert.rejects(
    adapter.createSession({
      ownerWallet: "not-an-address",
      agentWallet: "0x2222222222222222222222222222222222222222",
      network: "BSC",
      permissions: ["DCA"],
      revocable: true
    }),
    /Owner wallet must be a valid EVM wallet address/
  );
  assert.equal(providerCalls, 0);
});

test("BNB adapter rejects non-revocable grants before provider invocation", async () => {
  let providerCalls = 0;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => {
      throw new Error("not reached");
    },
    createSession: async () => {
      providerCalls += 1;
      return { sessionId: "should-not-run" };
    }
  });

  await assert.rejects(
    adapter.createSession({
      ownerWallet: "0x1111111111111111111111111111111111111111",
      agentWallet: "0x2222222222222222222222222222222222222222",
      network: "BSC",
      permissions: ["DCA"],
      revocable: false
    }),
    /must be revocable/
  );
  assert.equal(providerCalls, 0);
});

test("BNB adapter forwards the validated normalized grant to the provider", async () => {
  let received: any = null;
  const adapter = new BnbWalletAdapter({
    capabilities: async () => complete,
    getContext: async () => {
      throw new Error("not reached");
    },
    createSession: async grant => {
      received = grant;
      return { sessionId: "session-valid" };
    }
  });

  const result = await adapter.createSession({
    ownerWallet: " 0x1111111111111111111111111111111111111111 ",
    agentWallet: "0x2222222222222222222222222222222222222222",
    network: "BSC",
    permissions: ["DCA"],
    allowedAssets: ["NVDAB"],
    revocable: true
  });

  assert.equal(result.sessionId, "session-valid");
  assert.equal(received.ownerWallet, "0x1111111111111111111111111111111111111111");
  assert.deepEqual(received.allowedAssets, ["NVDAB"]);
});
