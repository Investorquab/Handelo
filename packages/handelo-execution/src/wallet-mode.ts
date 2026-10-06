import type { AgentWalletContext, WalletContext } from "@handelo/core";

export const DEMO_MODE_DISCLOSURE =
  "Demo Mode: all wallet actions are simulated and do not move real funds or create real BSC transactions.";

export interface DemoExecutionNotice {
  mode: "DEMO";
  simulated: true;
  disclosure: typeof DEMO_MODE_DISCLOSURE;
}

export function createDemoExecutionNotice(): DemoExecutionNotice {
  return {
    mode: "DEMO",
    simulated: true,
    disclosure: DEMO_MODE_DISCLOSURE
  };
}

export function assertLiveWalletExecutionContext(
  context: WalletContext | AgentWalletContext
): AgentWalletContext {
  if (context.mode !== "USER") {
    throw new Error("Live wallet execution is unavailable in Demo Mode; use a USER-mode wallet context.");
  }
  if (context.role !== "AGENT") {
    throw new Error("Live autonomous execution requires an AGENT wallet context.");
  }

  const agentContext = context as AgentWalletContext;

  if (!agentContext.connected || agentContext.network !== "BSC") {
    throw new Error("Live wallet execution requires a connected BSC agent wallet.");
  }
  if (agentContext.status !== "ACTIVE") {
    throw new Error("Live wallet execution requires an active agent wallet.");
  }
  return agentContext;
}
