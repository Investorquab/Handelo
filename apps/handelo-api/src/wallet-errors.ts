export function walletServiceError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";

  if (code === "ENOENT") {
    return "The Binance Agentic Wallet service is unavailable. Please make sure the wallet CLI is installed and try again.";
  }

  if (code === "EACCES") {
    return "The Binance Agentic Wallet service could not be started because of a permissions issue. Please try again.";
  }

  return "The Binance Agentic Wallet service could not complete the request. Please try again.";
}
