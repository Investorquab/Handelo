import test from "node:test";
import assert from "node:assert/strict";
import { createHandeloClient, HandeloApiError, normalizeChatMessage } from "./index.js";

test("SDK rejects empty chat messages",()=>{
  assert.throws(()=>normalizeChatMessage("   "),/message is required/);
  assert.equal(normalizeChatMessage("  What is NVDA?  "),"What is NVDA?");
});

test("remote SDK sends an API key when configured", async () => {
  const original = globalThis.fetch;
  let receivedHeaders;
  globalThis.fetch = async (_input, init) => {
    receivedHeaders = init?.headers;
    return new Response(JSON.stringify({ message: "ok" }), { status: 200 });
  };
  try {
    await createHandeloClient({ baseUrl: "https://example.test/", apiKey: "demo-key" }).chat({ message: "hello" });
    assert.deepEqual(receivedHeaders, {
      "content-type": "application/json",
      "x-handelo-api-key": "demo-key",
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("SDK exposes structured API failures", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "blocked" }), { status: 403 });
  try {
    await assert.rejects(
      () => createHandeloClient({ baseUrl: "https://example.test" }).chat({ message: "hello" }),
      (error) => error instanceof HandeloApiError && error.status === 403 && error.message === "blocked",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("SDK remote client reports non-JSON API failures clearly",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response("not json",{status:503});
  try{
    await assert.rejects(
      ()=>createHandeloClient({baseUrl:"https://example.test"}).chat({message:"hello"}),
      /returned invalid JSON \(HTTP 503\)/
    );
  }finally{
    globalThis.fetch=original;
  }
});
