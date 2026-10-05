import assert from "node:assert/strict";
import test from "node:test";
import { BnbAgentWalletProvider, assertBscWalletIdentity } from "./bnb-agent-provider.js";

const personal = {
  address: "0x1111111111111111111111111111111111111111",
  network: "BSC" as const
};
const agent = {
  address: "0x2222222222222222222222222222222222222222",
  network: "BSC" as const
};

test("validates BSC wallet identities at the provider boundary", () => {
  assert.deepEqual(assertBscWalletIdentity(personal), personal);
  assert.equal(assertBscWalletIdentity(null), null);
  assert.throws(
    () => assertBscWalletIdentity({ address: "not-an-address", network: "BSC" }),
    /invalid BSC EVM wallet identity/
  );
});

test("provider adapter validates personal and agent wallets", async () => {
  const provider = new BnbAgentWalletProvider({
    async getPersonalWallet() {
      return personal;
    },
    async getAgentWallet() {
      return agent;
    },
    async getAgentStatus() {
      return "ACTIVE";
    }
  });

  assert.deepEqual(await provider.getPersonalWallet(), personal);
  assert.deepEqual(await provider.getAgentWallet(), agent);
  assert.equal(await provider.getAgentStatus(), "ACTIVE");
});

test("provider adapter rejects a wallet returned on the wrong network", async () => {
  const provider = new BnbAgentWalletProvider({
    async getPersonalWallet() {
      return { address: personal.address, network: "ETHEREUM" as never };
    },
    async getAgentWallet() {
      return null;
    },
    async getAgentStatus() {
      return "UNAVAILABLE";
    }
  });

  await assert.rejects(
    () => provider.getPersonalWallet(),
    /invalid BSC EVM wallet identity/
  );
});
