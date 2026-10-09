import { marketClientFromEnv } from "@handelo/market";
import { createMcpProtocolHandler, jsonRpcParseError } from "./protocol.js";

const handleMessage = createMcpProtocolHandler(marketClientFromEnv());
let buffer = "";
let queue: Promise<void> = Promise.resolve();

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");

  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\n");
    if (!line) continue;

    queue = queue.then(async () => {
      let request: unknown;
      try {
        request = JSON.parse(line);
      } catch {
        process.stdout.write(JSON.stringify(jsonRpcParseError()) + "\n");
        return;
      }

      const outcome = await handleMessage(request);
      if (outcome.body) process.stdout.write(JSON.stringify(outcome.body) + "\n");
    }).catch(() => {
      // Standard output is reserved for valid JSON-RPC responses only.
      process.stdout.write(JSON.stringify(jsonRpcParseError()) + "\n");
    });
  }
});
