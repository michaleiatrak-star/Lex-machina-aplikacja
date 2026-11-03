import { authorityEndpoints, microsoftScopes, type MicrosoftOAuthClientConfig } from "./config.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class MicrosoftIntegrationError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number
  ) {
    super(code);
    this.name = "MicrosoftIntegrationError";
  }
}

export function buildMicrosoftAuthorizationUrl(args: {
  config: MicrosoftOAuthClientConfig;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(authorityEndpoints(args.config.tenant).authorize);
  url.searchParams.set("client_id", args.config.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", microsoftScopes(args.config.tenant).join(" "));
  url.searchParams.set("state", args.state);
  url.searchParams.set("nonce", args.nonce);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export type MicrosoftTokens = { accessToken: string; refreshToken?: string; idToken?: string; scopes: string[]; expiresIn: number };

async function tokenRequest(fetchImpl: FetchLike, config: MicrosoftOAuthClientConfig, body: URLSearchParams, failure: string): Promise<MicrosoftTokens> {
  body.set("client_id", config.clientId);
  let response: Response;
  try {
    response = await fetchImpl(authorityEndpoints(config.tenant).token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
  } catch {
    throw new MicrosoftIntegrationError("MICROSOFT_NETWORK_ERROR", 502);
  }
  if (!response.ok) throw new MicrosoftIntegrationError(failure, 409);
  const json = (await response.json()) as Record<string, unknown>;
  if (typeof json.access_token !== "string") throw new MicrosoftIntegrationError(failure, 409);
  return {
    accessToken: json.access_token,
    ...(typeof json.refresh_token === "string" ? { refreshToken: json.refresh_token } : {}),
    ...(typeof json.id_token === "string" ? { idToken: json.id_token } : {}),
    scopes: typeof json.scope === "string" ? json.scope.split(/\s+/u).filter(Boolean) : [],
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : 3600
  };
}

export function exchangeMicrosoftCode(args: {
  fetch: FetchLike;
  config: MicrosoftOAuthClientConfig;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<MicrosoftTokens> {
  return tokenRequest(
    args.fetch,
    args.config,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      code_verifier: args.codeVerifier,
      redirect_uri: args.redirectUri,
      scope: microsoftScopes(args.config.tenant).join(" ")
    }),
    "MICROSOFT_TOKEN_EXCHANGE_FAILED"
  );
}

export function refreshMicrosoftToken(fetchImpl: FetchLike, config: MicrosoftOAuthClientConfig, refreshToken: string): Promise<MicrosoftTokens> {
  return tokenRequest(
    fetchImpl,
    config,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: microsoftScopes(config.tenant).join(" ") }),
    // invalid_grant: the user revoked the consent, changed the password or the token expired.
    "MICROSOFT_RECONNECT_REQUIRED"
  );
}

export type MicrosoftIdentity = { sub: string; tenantId: string; email: string };

// The ID token comes straight from the token endpoint over TLS (OpenID Connect Core 3.1.3.7):
// its claims are checked without fetching keys. Never for an ID token that arrives otherwise.
export function validateMicrosoftIdToken(args: { idToken: string; clientId: string; nonce: string; nowMs: number }): MicrosoftIdentity {
  const parts = args.idToken.split(".");
  let claims: Record<string, unknown> = {};
  try {
    if (parts.length !== 3) throw new Error("parts");
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new MicrosoftIntegrationError("MICROSOFT_ID_TOKEN_INVALID", 409);
  }
  const skew = 5 * 60 * 1000;
  const tid = typeof claims.tid === "string" ? claims.tid : "";
  const email = [claims.email, claims.preferred_username].find((value): value is string => typeof value === "string" && value.includes("@")) ?? "";
  const ok =
    typeof claims.iss === "string" &&
    /^[0-9a-f-]{36}$/u.test(tid) &&
    claims.iss === `https://login.microsoftonline.com/${tid}/v2.0` &&
    claims.aud === args.clientId &&
    typeof claims.exp === "number" &&
    claims.exp * 1000 + skew > args.nowMs &&
    typeof claims.iat === "number" &&
    claims.iat * 1000 - skew < args.nowMs &&
    claims.nonce === args.nonce &&
    typeof claims.oid === "string" &&
    email.length > 0;
  if (!ok) throw new MicrosoftIntegrationError("MICROSOFT_ID_TOKEN_INVALID", 409);
  return { sub: claims.oid as string, tenantId: tid, email: email.slice(0, 320) };
}
