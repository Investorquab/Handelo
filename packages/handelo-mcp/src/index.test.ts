import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("stdio MCP adapter delegates requests to the shared protocol handler", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.match(source, /createMcpProtocolHandler\(marketClientFromEnv\(\)\)/);
  assert.match(source, /JSON\.parse\(line\)/);
  assert.match(source, /JSON\.stringify\(outcome\.body\)/);
  assert.match(source, /process\.stdout\.write/);
});

test("stdio MCP adapter reserves stdout for line-delimited JSON-RPC", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

  assert.match(source, /process\.stdout\.write\(JSON\.stringify\(outcome\.body\) \+ "\\n"\)/);
  assert.doesNotMatch(source, /console\.log/);
});
