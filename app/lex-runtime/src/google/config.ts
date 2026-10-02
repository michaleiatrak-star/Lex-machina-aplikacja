import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// OAuth client of type "Desktop app" from Google Cloud Console. Google treats
// the desktop client secret as non-confidential; PKCE protects the code.
export type GoogleOAuthClientConfig = {
  clientId: string;
  clientSecret?: string;
};

export const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT =
  "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT =
  "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALLBACK_PATH =
  "/oauth/google/callback";

// Narrowest scope per feature. Each optional service gets its own consent
// and its own token; only "identity" and "recoveryEscrow" are used today.
export const GOOGLE_SCOPES = {
  identity: ["openid", "email"],
  recoveryEscrow: [
    "https://www.googleapis.com/auth/drive.appdata"
  ],
  drive: [
    "https://www.googleapis.com/auth/drive.file"
  ],
  gmailRead: [
    "https://www.googleapis.com/auth/gmail.readonly"
  ],
  gmailSend: [
    "https://www.googleapis.com/auth/gmail.send"
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar.app.created"
  ]
} as const;

function defaultClientFile(): string {
  return path.join(
    process.env.LEX_DATA_DIR ??
      path.join(os.homedir(), ".lex-machina", "data"),
    "google",
    "oauth-client.json"
  );
}

// The publisher's client, shipped with the app so end users only click
// "Sign in with Google" and never touch Google Cloud.
export function bundledClientFile(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "config",
    "google-oauth-client.json"
  );
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

// Order: LEX_GOOGLE_OAUTH_CLIENT_ID / _SECRET, a local override file, then
// the client bundled with the app. Files use the JSON downloaded from Google
// Cloud Console ({"installed": {...}}). Returns null when none exists:
// Google features stay off.
export function loadGoogleOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrideFile: string =
    env.LEX_GOOGLE_OAUTH_CLIENT_FILE ??
      defaultClientFile(),
  bundledFile: string = bundledClientFile()
): GoogleOAuthClientConfig | null {
  const envId = nonEmpty(env.LEX_GOOGLE_OAUTH_CLIENT_ID);
  if (envId) {
    const secret = nonEmpty(
      env.LEX_GOOGLE_OAUTH_CLIENT_SECRET
    );
    return secret
      ? { clientId: envId, clientSecret: secret }
      : { clientId: envId };
  }
  const clientFile = [overrideFile, bundledFile].find(
    (file) => existsSync(file)
  );
  if (!clientFile) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(clientFile, "utf8"));
  } catch {
    throw new Error("GOOGLE_OAUTH_CLIENT_FILE_INVALID");
  }
  const installed =
    parsed &&
    typeof parsed === "object" &&
    "installed" in parsed
      ? (parsed as { installed: unknown }).installed
      : parsed;
  const record =
    installed && typeof installed === "object"
      ? (installed as Record<string, unknown>)
      : {};
  const clientId = nonEmpty(record.client_id);
  if (!clientId) {
    throw new Error("GOOGLE_OAUTH_CLIENT_FILE_INVALID");
  }
  const clientSecret = nonEmpty(record.client_secret);
  return clientSecret
    ? { clientId, clientSecret }
    : { clientId };
}
