import { createHash, randomBytes } from "node:crypto";
import {
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  type GoogleOAuthClientConfig
} from "./config.js";

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export class GoogleOAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GoogleOAuthError";
  }
}

export type PkcePair = {
  verifier: string;
  challenge: string;
};

// RFC 7636, S256.
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function buildAuthorizationUrl(args: {
  config: GoogleOAuthClientConfig;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  nonce: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", args.config.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", args.scopes.join(" "));
  url.searchParams.set("state", args.state);
  url.searchParams.set("nonce", args.nonce);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Every service is consented separately; never merge earlier grants.
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("prompt", "select_account consent");
  if (args.loginHint) {
    url.searchParams.set("login_hint", args.loginHint);
  }
  return url.toString();
}

export type GoogleTokenResponse = {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  scopes: string[];
  expiresIn: number;
};

export async function exchangeAuthorizationCode(args: {
  fetch: FetchLike;
  config: GoogleOAuthClientConfig;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    code_verifier: args.codeVerifier,
    client_id: args.config.clientId,
    redirect_uri: args.redirectUri
  });
  if (args.config.clientSecret) {
    body.set("client_secret", args.config.clientSecret);
  }
  let response: Response;
  try {
    response = await args.fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    });
  } catch {
    throw new GoogleOAuthError("GOOGLE_TOKEN_NETWORK_ERROR");
  }
  if (!response.ok) {
    throw new GoogleOAuthError("GOOGLE_TOKEN_EXCHANGE_FAILED");
  }
  const json = (await response.json()) as Record<string, unknown>;
  if (typeof json.access_token !== "string") {
    throw new GoogleOAuthError("GOOGLE_TOKEN_EXCHANGE_FAILED");
  }
  return {
    accessToken: json.access_token,
    ...(typeof json.id_token === "string"
      ? { idToken: json.id_token }
      : {}),
    ...(typeof json.refresh_token === "string"
      ? { refreshToken: json.refresh_token }
      : {}),
    scopes:
      typeof json.scope === "string"
        ? json.scope.split(/\s+/).filter(Boolean)
        : [],
    expiresIn:
      typeof json.expires_in === "number"
        ? json.expires_in
        : 0
  };
}

export async function revokeGoogleToken(
  fetchImpl: FetchLike,
  token: string
): Promise<boolean> {
  try {
    const response = await fetchImpl(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ token })
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type GoogleIdentity = {
  sub: string;
  email: string;
};

const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com"
]);

// The ID token comes straight from Google's token endpoint over TLS, so per
// OpenID Connect Core 3.1.3.7 the claims are checked without fetching JWKS.
// Never use this for ID tokens that arrive any other way.
export function validateIdTokenFromTokenEndpoint(args: {
  idToken: string;
  clientId: string;
  nonce: string;
  nowMs: number;
  clockSkewMs?: number;
}): GoogleIdentity {
  const parts = args.idToken.split(".");
  if (parts.length !== 3) {
    throw new GoogleOAuthError("GOOGLE_ID_TOKEN_INVALID");
  }
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8")
    ) as Record<string, unknown>;
  } catch {
    throw new GoogleOAuthError("GOOGLE_ID_TOKEN_INVALID");
  }
  const skew = args.clockSkewMs ?? 5 * 60 * 1000;
  const audiences = Array.isArray(claims.aud)
    ? claims.aud
    : [claims.aud];
  const checks = [
    typeof claims.iss === "string" &&
      GOOGLE_ISSUERS.has(claims.iss),
    audiences.includes(args.clientId),
    audiences.length === 1 ||
      claims.azp === args.clientId,
    typeof claims.exp === "number" &&
      claims.exp * 1000 + skew > args.nowMs,
    typeof claims.iat === "number" &&
      claims.iat * 1000 - skew < args.nowMs,
    claims.nonce === args.nonce,
    typeof claims.sub === "string" &&
      claims.sub.length > 0 &&
      claims.sub.length <= 255,
    claims.email_verified === true,
    typeof claims.email === "string"
  ];
  if (checks.some((ok) => !ok)) {
    throw new GoogleOAuthError("GOOGLE_ID_TOKEN_INVALID");
  }
  return {
    sub: claims.sub as string,
    email: claims.email as string
  };
}
