import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const REQUIRED_SCOPE = "market:read";
const MAX_BODY_BYTES = 16 * 1024;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_REGISTERED_CLIENTS = 1000;

export interface HandeloOAuthOptions {
  issuer: string;
  username: string;
  password: string;
  tokenSecret: string;
  storePath?: string;
  now?: () => number;
}

interface RegisteredClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  client_id_issued_at: number;
}

interface RefreshTokenRecord {
  client_id: string;
  username: string;
  resource: string;
  expires_at: number;
}

interface OAuthStore {
  clients: Record<string, RegisteredClient>;
  refreshTokens: Record<string, RefreshTokenRecord>;
}

interface PendingAuthorization {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  resource: string;
  createdAt: number;
  failedAttempts: number;
}

interface AuthorizationCodeRecord {
  clientId: string;
  username: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  expiresAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function safeEqual(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function oauthError(
  res: ServerResponse,
  status: number,
  error: string,
  description: string,
): void {
  json(res, status, { error, error_description: description });
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_BODY_BYTES) throw new RangeError("OAuth request body is too large.");
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function readStore(storePath?: string): OAuthStore {
  if (!storePath || !existsSync(storePath)) {
    return { clients: {}, refreshTokens: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storePath, "utf8")) as unknown;
  } catch {
    throw new Error("Handelo OAuth state file cannot be read. Repair or restore the file before starting OAuth mode.");
  }

  if (
    !isRecord(parsed) ||
    !isRecord(parsed.clients) ||
    !isRecord(parsed.refreshTokens)
  ) {
    throw new Error("Handelo OAuth state file has an invalid format.");
  }

  return {
    clients: parsed.clients as Record<string, RegisteredClient>,
    refreshTokens: parsed.refreshTokens as Record<string, RefreshTokenRecord>,
  };
}

function saveStore(storePath: string | undefined, store: OAuthStore): void {
  if (!storePath) return;
  const destination = resolve(storePath);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = destination + ".tmp-" + process.pid + "-" + randomOpaqueToken(6);
  writeFileSync(temporary, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, destination);
  chmodSync(destination, 0o600);
}

function isValidRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) return false;
  try {
    const uri = new URL(value);
    if (uri.hash || uri.username || uri.password) return false;
    if (uri.protocol === "https:") return true;
    if (uri.protocol !== "http:") return false;
    return uri.hostname === "localhost" ||
      uri.hostname === "127.0.0.1" ||
      uri.hostname === "[::1]" ||
      uri.hostname === "::1";
  } catch {
    return false;
  }
}

function decodeJsonBase64Url(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
}

function signJwt(secret: string, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const data = header + "." + payload;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return data + "." + signature;
}

function renderLoginForm(requestId: string, clientName: string, errorText = ""): string {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Authorize Handelo</title><style>" +
    "body{font-family:system-ui,sans-serif;background:#101216;color:#f4f4f5;margin:0;min-height:100vh;display:grid;place-items:center}" +
    "main{box-sizing:border-box;width:min(440px,calc(100% - 32px));background:#1b1e24;border:1px solid #373b45;border-radius:16px;padding:28px}" +
    "h1{margin:0 0 8px;font-size:25px}p{color:#c4c8d0;line-height:1.5}label{display:block;margin:16px 0 6px;font-size:14px}" +
    "input{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;border:1px solid #555b67;background:#101216;color:#fff}" +
    "button{margin-top:22px;width:100%;padding:12px;border:0;border-radius:8px;background:#d4a64c;color:#111;font-weight:700;cursor:pointer}" +
    ".error{color:#ffc2b8}.scope{padding:12px;background:#101216;border-radius:8px}" +
    "</style></head><body><main><h1>Connect Handelo</h1>" +
    "<p><strong>" + escapeHtml(clientName) + "</strong> is requesting read-only access to Handelo market lookup and search.</p>" +
    "<p class=\"scope\">Permission requested: <strong>market:read</strong></p>" +
    (errorText ? "<p class=\"error\">" + escapeHtml(errorText) + "</p>" : "") +
    "<form method=\"post\" action=\"/authorize\" autocomplete=\"on\">" +
    "<input type=\"hidden\" name=\"request_id\" value=\"" + escapeHtml(requestId) + "\">" +
    "<label for=\"username\">Handelo username</label>" +
    "<input id=\"username\" name=\"username\" autocomplete=\"username\" required maxlength=\"128\">" +
    "<label for=\"password\">Handelo password</label>" +
    "<input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" required>" +
    "<button type=\"submit\">Sign in and authorize</button></form>" +
    "<p>You can close this page without connecting. Handelo's MCP connector exposes read-only market tools.</p>" +
    "</main></body></html>";
}

export function createHandeloOAuthProvider(options: HandeloOAuthOptions) {
  let issuerUrl: URL;
  try {
    issuerUrl = new URL(options.issuer);
  } catch {
    throw new Error("HANDELO_OAUTH_ISSUER must be an absolute HTTPS URL.");
  }
  if (
    (issuerUrl.protocol !== "https:" && issuerUrl.hostname !== "localhost" && issuerUrl.hostname !== "127.0.0.1") ||
    issuerUrl.username ||
    issuerUrl.password ||
    issuerUrl.search ||
    issuerUrl.hash ||
    (issuerUrl.pathname !== "/" && issuerUrl.pathname !== "")
  ) {
    throw new Error("HANDELO_OAUTH_ISSUER must be an HTTPS origin without a path, query, or fragment.");
  }

  const issuer = issuerUrl.origin;
  const resource = issuer + "/mcp";
  const now = options.now ?? Date.now;

  if (!options.username || options.username.length > 128) {
    throw new Error("HANDELO_OAUTH_USERNAME must be configured.");
  }
  if (options.password.length < 16) {
    throw new Error("HANDELO_OAUTH_PASSWORD must contain at least 16 characters.");
  }
  if (options.tokenSecret.length < 32) {
    throw new Error("HANDELO_OAUTH_TOKEN_SECRET must contain at least 32 characters.");
  }

  const storePath = options.storePath ? resolve(options.storePath) : undefined;
  const store = readStore(storePath);
  const pendingAuthorizations = new Map<string, PendingAuthorization>();
  const authorizationCodes = new Map<string, AuthorizationCodeRecord>();

  function persist(): void {
    saveStore(storePath, store);
  }

  function clearExpiredTransientState(): void {
    const timestamp = now();
    for (const [key, value] of pendingAuthorizations) {
      if (timestamp - value.createdAt > AUTH_REQUEST_TTL_MS) pendingAuthorizations.delete(key);
    }
    for (const [key, value] of authorizationCodes) {
      if (timestamp > value.expiresAt) authorizationCodes.delete(key);
    }
    const timestampSeconds = Math.floor(timestamp / 1000);
    for (const [key, value] of Object.entries(store.refreshTokens)) {
      if (timestampSeconds >= value.expires_at) delete store.refreshTokens[key];
    }
  }

  function mintAccessToken(clientId: string, username: string, scope: string): {
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
    scope: string;
  } {
    const issuedAt = Math.floor(now() / 1000);
    const accessToken = signJwt(options.tokenSecret, {
      iss: issuer,
      sub: username,
      aud: resource,
      client_id: clientId,
      scope,
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
      jti: randomOpaqueToken(16),
    });
    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope,
    };
  }

  function issueTokens(client: RegisteredClient, username: string, scope: string): Record<string, unknown> {
    clearExpiredTransientState();
    const result: Record<string, unknown> = mintAccessToken(client.client_id, username, scope);
    if (client.grant_types.includes("refresh_token")) {
      const refreshToken = randomOpaqueToken(48);
      store.refreshTokens[hash(refreshToken)] = {
        client_id: client.client_id,
        username,
        resource,
        expires_at: Math.floor(now() / 1000) + REFRESH_TOKEN_TTL_SECONDS,
      };
      result.refresh_token = refreshToken;
      persist();
    }
    return result;
  }

  function validateAccessToken(token: string): boolean {
    if (token.length > 8192) return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const data = parts[0] + "." + parts[1];
    const expected = createHmac("sha256", options.tokenSecret).update(data).digest();
    const actual = Buffer.from(parts[2], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

    try {
      const header = decodeJsonBase64Url(parts[0]);
      const claims = decodeJsonBase64Url(parts[1]);
      if (!isRecord(header) || header.alg !== "HS256" || header.typ !== "JWT" || !isRecord(claims)) return false;
      const timestamp = Math.floor(now() / 1000);
      return claims.iss === issuer &&
        claims.aud === resource &&
        typeof claims.exp === "number" &&
        timestamp < claims.exp &&
        typeof claims.iat === "number" &&
        claims.iat <= timestamp + 60 &&
        typeof claims.sub === "string" &&
        typeof claims.client_id === "string" &&
        Boolean(store.clients[claims.client_id]) &&
        typeof claims.scope === "string" &&
        claims.scope.split(/\s+/).includes(REQUIRED_SCOPE);
    } catch {
      return false;
    }
  }

  async function registerClient(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      oauthError(res, 415, "invalid_request", "Client registration requires application/json.");
      return;
    }

    let input: unknown;
    try {
      input = JSON.parse(await readBody(req)) as unknown;
    } catch (error) {
      oauthError(res, error instanceof RangeError ? 413 : 400, "invalid_client_metadata", "Registration request must be valid, small JSON.");
      return;
    }

    if (!isRecord(input)) {
      oauthError(res, 400, "invalid_client_metadata", "Client metadata must be a JSON object.");
      return;
    }

    const redirectUris = input.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length < 1 ||
      redirectUris.length > 10 ||
      !redirectUris.every(isValidRedirectUri)
    ) {
      oauthError(res, 400, "invalid_client_metadata", "Provide 1–10 valid HTTPS or loopback redirect URIs.");
      return;
    }

    const grantTypes = input.grant_types === undefined
      ? ["authorization_code", "refresh_token"]
      : input.grant_types;
    const responseTypes = input.response_types === undefined ? ["code"] : input.response_types;
    if (
      !Array.isArray(grantTypes) ||
      !grantTypes.every((item) => item === "authorization_code" || item === "refresh_token") ||
      !grantTypes.includes("authorization_code") ||
      !Array.isArray(responseTypes) ||
      responseTypes.length !== 1 ||
      responseTypes[0] !== "code"
    ) {
      oauthError(res, 400, "invalid_client_metadata", "Only authorization-code flow with PKCE is supported.");
      return;
    }

    const authMethod = input.token_endpoint_auth_method;
    if (authMethod !== undefined && authMethod !== "none") {
      oauthError(res, 400, "invalid_client_metadata", "Handelo supports public OAuth clients without a client secret.");
      return;
    }

    if (Object.keys(store.clients).length >= MAX_REGISTERED_CLIENTS) {
      oauthError(res, 429, "registration_limit_reached", "Handelo has reached its public-client registration limit.");
      return;
    }

    const clientName = typeof input.client_name === "string" && input.client_name.trim()
      ? input.client_name.trim().slice(0, 100)
      : "MCP client";
    const clientId = randomOpaqueToken(24);
    const client: RegisteredClient = {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes as string[],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(now() / 1000),
    };

    store.clients[clientId] = client;
    persist();
    json(res, 201, client);
  }

  function validateRequestedScope(value: string | null): string | null {
    const requested = (value ?? REQUIRED_SCOPE).trim().split(/\s+/).filter(Boolean);
    if (requested.length === 0) return REQUIRED_SCOPE;
    if (requested.some((scope) => scope !== REQUIRED_SCOPE)) return null;
    return REQUIRED_SCOPE;
  }

  function requestedResource(value: string | null): string | null {
    if (value === null || value === "" || value === resource || value === issuer) return resource;
    return null;
  }

  function authorizationError(res: ServerResponse, message: string): void {
    html(res, 400, "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Handelo authorization error</title>" +
      "<body style=\"font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem\">" +
      "<h1>Unable to authorize Handelo</h1><p>" + escapeHtml(message) + "</p></body></html>");
  }

  function beginAuthorization(url: URL, res: ServerResponse): void {
    clearExpiredTransientState();
    console.info("[Handelo OAuth] authorize_get", JSON.stringify({ method: "GET", path: "/authorize" }));
    if (url.searchParams.get("response_type") !== "code") {
      authorizationError(res, "Only the authorization-code response type is supported.");
      return;
    }

    const clientId = url.searchParams.get("client_id") ?? "";
    const client = store.clients[clientId];
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const stateValue = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    const challengeMethod = url.searchParams.get("code_challenge_method");
    const requestedScopeValue = validateRequestedScope(url.searchParams.get("scope"));
    const requestedResourceValue = requestedResource(url.searchParams.get("resource"));
    const responseMode = url.searchParams.get("response_mode");

    if (!client || !client.redirect_uris.includes(redirectUri) || !isValidRedirectUri(redirectUri)) {
      authorizationError(res, "The OAuth client or its registered redirect URI is not recognized.");
      return;
    }
    if (!stateValue || stateValue.length > 1024) {
      authorizationError(res, "A valid OAuth state value is required.");
      return;
    }
    if (
      challengeMethod !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      requestedScopeValue === null ||
      requestedResourceValue === null ||
      (responseMode !== null && responseMode !== "query")
    ) {
      authorizationError(res, "This request must use PKCE S256 and the read-only market:read permission.");
      return;
    }

    const requestId = randomOpaqueToken(32);
    pendingAuthorizations.set(requestId, {
      clientId,
      clientName: client.client_name,
      redirectUri,
      state: stateValue,
      codeChallenge: challenge,
      resource: requestedResourceValue,
      createdAt: now(),
      failedAttempts: 0,
    });
    console.info("[Handelo OAuth] authorize_form_issued", JSON.stringify({ pendingCount: pendingAuthorizations.size, ttlMs: AUTH_REQUEST_TTL_MS }));
    html(res, 200, renderLoginForm(requestId, client.client_name));
  }

  async function finishAuthorization(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      oauthError(res, 415, "invalid_request", "Authorization form must be submitted as application/x-www-form-urlencoded.");
      return;
    }

    let form: URLSearchParams;
    try {
      form = new URLSearchParams(await readBody(req));
    } catch (error) {
      oauthError(res, error instanceof RangeError ? 413 : 400, "invalid_request", "Authorization form is invalid.");
      return;
    }

    const requestId = form.get("request_id") ?? "";
    console.info("[Handelo OAuth] authorize_form_received", JSON.stringify({
      requestIdPresent: requestId.length > 0,
      usernamePresent: form.has("username"),
      passwordPresent: form.has("password"),
      pendingCount: pendingAuthorizations.size,
    }));
    const pending = pendingAuthorizations.get(requestId);
    const ageMs = pending ? Math.max(0, now() - pending.createdAt) : null;
    if (!pending || now() - pending.createdAt > AUTH_REQUEST_TTL_MS) {
      if (pending) pendingAuthorizations.delete(requestId);
      console.warn("[Handelo OAuth] authorize_form_rejected", JSON.stringify({ reason: pending ? "expired_request" : "missing_request", ageMs, pendingCount: pendingAuthorizations.size }));
      authorizationError(res, "This authorization request expired. Return to Claude and try connecting again.");
      return;
    }
    console.info("[Handelo OAuth] authorize_form_accepted", JSON.stringify({ ageMs, pendingCount: pendingAuthorizations.size }));

    const username = form.get("username") ?? "";
    const password = form.get("password") ?? "";
    const usernameMatches = safeEqual(username, options.username);
    const passwordMatches = safeEqual(password, options.password);
    if (!usernameMatches || !passwordMatches) {
      pending.failedAttempts += 1;
      console.warn("[Handelo OAuth] authorize_credentials_rejected", JSON.stringify({
        failedAttempts: pending.failedAttempts,
        pendingCount: pendingAuthorizations.size,
      }));
      if (pending.failedAttempts >= 5) {
        pendingAuthorizations.delete(requestId);
        authorizationError(res, "Too many failed attempts. Return to Claude and start a new connection.");
        return;
      }
      html(res, 401, renderLoginForm(requestId, pending.clientName, "Username or password is incorrect."));
      return;
    }

    pendingAuthorizations.delete(requestId);
    const client = store.clients[pending.clientId];
    if (!client) {
      authorizationError(res, "This OAuth client is no longer registered.");
      return;
    }

    const code = randomOpaqueToken(32);
    authorizationCodes.set(hash(code), {
      clientId: pending.clientId,
      username: options.username,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      resource: pending.resource,
      scope: REQUIRED_SCOPE,
      expiresAt: now() + AUTH_CODE_TTL_MS,
    });

    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", pending.state);
    console.info("[Handelo OAuth] authorize_redirect_issued", JSON.stringify({
      redirectOrigin: redirect.origin,
      redirectPath: redirect.pathname,
      pendingCount: pendingAuthorizations.size,
    }));
    res.writeHead(302, {
      location: redirect.toString(),
      "cache-control": "no-store",
      pragma: "no-cache",
      "referrer-policy": "no-referrer",
    });
    res.end();
  }

  async function exchangeToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      oauthError(res, 415, "invalid_request", "Token requests must use application/x-www-form-urlencoded.");
      return;
    }

    let form: URLSearchParams;
    try {
      form = new URLSearchParams(await readBody(req));
    } catch (error) {
      oauthError(res, error instanceof RangeError ? 413 : 400, "invalid_request", "Token request is invalid.");
      return;
    }

    const grantType = form.get("grant_type") ?? "";
    const clientId = form.get("client_id") ?? "";
    const client = store.clients[clientId];
    console.info("[Handelo OAuth] token_request_received", JSON.stringify({
      grantType: grantType === "authorization_code" || grantType === "refresh_token" ? grantType : "unsupported",
      clientRegistered: Boolean(client),
      codePresent: form.has("code") && Boolean(form.get("code")),
      verifierPresent: form.has("code_verifier") && Boolean(form.get("code_verifier")),
      refreshTokenPresent: form.has("refresh_token") && Boolean(form.get("refresh_token")),
      resourcePresent: form.has("resource") && Boolean(form.get("resource")),
    }));
    if (!client || (form.has("client_secret") && Boolean(form.get("client_secret")))) {
      console.warn("[Handelo OAuth] token_request_rejected", JSON.stringify({ reason: "invalid_client", grantType: grantType === "authorization_code" || grantType === "refresh_token" ? grantType : "unsupported" }));
      oauthError(res, 401, "invalid_client", "A registered public client_id is required; client secrets are not used.");
      return;
    }

    if (grantType === "authorization_code") {
      const code = form.get("code") ?? "";
      const codeKey = hash(code);
      const authorization = authorizationCodes.get(codeKey);
      authorizationCodes.delete(codeKey);
      const redirectUri = form.get("redirect_uri") ?? "";
      const verifier = form.get("code_verifier") ?? "";
      const verifierValid = /^[A-Za-z0-9._~-]{43,128}$/.test(verifier);
      const calculatedChallenge = verifierValid
        ? createHash("sha256").update(verifier).digest("base64url")
        : "";

      const authorizationExpired = Boolean(authorization && now() > authorization.expiresAt);
      const clientMatches = Boolean(authorization && authorization.clientId === clientId);
      const redirectMatches = Boolean(authorization && authorization.redirectUri === redirectUri);
      const redirectRegistered = client.redirect_uris.includes(redirectUri);
      const pkceMatches = Boolean(authorization && verifierValid && safeEqual(calculatedChallenge, authorization.codeChallenge));
      const resourceMatches = Boolean(authorization && requestedResource(form.get("resource")) === authorization.resource);
      if (
        !authorization ||
        authorizationExpired ||
        !clientMatches ||
        !redirectMatches ||
        !redirectRegistered ||
        !verifierValid ||
        !pkceMatches ||
        !resourceMatches
      ) {
        const reason = !authorization ? "unknown_or_reused_code"
          : authorizationExpired ? "expired_code"
          : !clientMatches ? "client_mismatch"
          : !redirectMatches || !redirectRegistered ? "redirect_uri_mismatch"
          : !verifierValid || !pkceMatches ? "pkce_mismatch"
          : "resource_mismatch";
        console.warn("[Handelo OAuth] token_exchange_rejected", JSON.stringify({
          reason,
          codeFound: Boolean(authorization),
          authorizationExpired,
          clientMatches,
          redirectMatches,
          redirectRegistered,
          verifierValid,
          pkceMatches,
          resourceMatches,
        }));
        oauthError(res, 400, "invalid_grant", "The authorization code, redirect URI, resource, or PKCE verifier is invalid or expired.");
        return;
      }

      const tokenResponse = issueTokens(client, authorization.username, authorization.scope);
      console.info("[Handelo OAuth] token_exchange_succeeded", JSON.stringify({
        grantType: "authorization_code",
        scope: authorization.scope,
      }));
      json(res, 200, tokenResponse);
      return;
    }

    if (grantType === "refresh_token") {
      if (!client.grant_types.includes("refresh_token")) {
        oauthError(res, 400, "unauthorized_client", "This client is not registered for refresh tokens.");
        return;
      }

      const refreshToken = form.get("refresh_token") ?? "";
      const refreshKey = hash(refreshToken);
      const record = store.refreshTokens[refreshKey];
      const timestamp = Math.floor(now() / 1000);
      const refreshReason = !record ? "unknown_or_reused_refresh_token"
        : record.client_id !== clientId ? "client_mismatch"
        : timestamp >= record.expires_at ? "expired_refresh_token"
        : "resource_mismatch";
      if (
        !record ||
        record.client_id !== clientId ||
        timestamp >= record.expires_at ||
        requestedResource(form.get("resource")) !== record.resource
      ) {
        console.warn("[Handelo OAuth] refresh_exchange_rejected", JSON.stringify({ reason: refreshReason }));
        oauthError(res, 400, "invalid_grant", "The refresh token is invalid, expired, or belongs to another client.");
        return;
      }

      delete store.refreshTokens[refreshKey];
      persist();
      const tokenResponse = issueTokens(client, record.username, REQUIRED_SCOPE);
      console.info("[Handelo OAuth] token_exchange_succeeded", JSON.stringify({ grantType: "refresh_token", scope: REQUIRED_SCOPE }));
      json(res, 200, tokenResponse);
      return;
    }

    oauthError(res, 400, "unsupported_grant_type", "Supported grants are authorization_code and refresh_token.");
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;

    if (path === "/.well-known/oauth-protected-resource") {
      if (req.method !== "GET") {
        res.writeHead(405, { allow: "GET", "cache-control": "no-store" });
        res.end();
        return true;
      }
      json(res, 200, {
        resource,
        authorization_servers: [issuer],
        bearer_methods_supported: ["header"],
        scopes_supported: [REQUIRED_SCOPE],
      });
      return true;
    }

    if (path === "/.well-known/oauth-authorization-server") {
      if (req.method !== "GET") {
        res.writeHead(405, { allow: "GET", "cache-control": "no-store" });
        res.end();
        return true;
      }
      json(res, 200, {
        issuer,
        authorization_endpoint: issuer + "/authorize",
        token_endpoint: issuer + "/token",
        registration_endpoint: issuer + "/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: [REQUIRED_SCOPE],
        client_id_metadata_document_supported: false,
      });
      return true;
    }

    if (path === "/register") {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST", "cache-control": "no-store" });
        res.end();
        return true;
      }
      await registerClient(req, res);
      return true;
    }

    if (path === "/authorize") {
      if (req.method === "GET") {
        beginAuthorization(url, res);
        return true;
      }
      if (req.method === "POST") {
        await finishAuthorization(req, res);
        return true;
      }
      res.writeHead(405, { allow: "GET, POST", "cache-control": "no-store" });
      res.end();
      return true;
    }

    if (path === "/token") {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST", "cache-control": "no-store" });
        res.end();
        return true;
      }
      await exchangeToken(req, res);
      return true;
    }

    return false;
  }

  return {
    issuer,
    resource,
    resourceMetadataUrl: issuer + "/.well-known/oauth-protected-resource",
    handleRequest,
    validateAccessToken,
  };
}
