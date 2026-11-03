import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Microsoft Entra ID application of type "Mobile and desktop applications" (public client:
// no secret, PKCE protects the code; redirect URI http://127.0.0.1 with any port).
export type MicrosoftOAuthClientConfig = {
  clientId: string;
  // "organizations" (work and school accounts, SharePoint), "common", "consumers" or a tenant id.
  tenant: string;
};

export const MICROSOFT_CALLBACK_PATH = "/oauth/microsoft/callback";
export const GRAPH = "https://graph.microsoft.com/v1.0";

export function authorityEndpoints(tenant: string): { authorize: string; token: string } {
  const base = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
  return { authorize: `${base}/authorize`, token: `${base}/token` };
}

// Read-only: OneDrive files, files shared with the user and SharePoint document libraries.
export function microsoftScopes(tenant: string): string[] {
  const base = ["openid", "profile", "email", "offline_access", "User.Read", "Files.Read.All"];
  // SharePoint sites exist only for work and school accounts.
  return tenant === "consumers" ? base : [...base, "Sites.Read.All"];
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const TENANT = /^(?:common|organizations|consumers|[0-9a-f-]{36}|[A-Za-z0-9.-]{1,100}\.onmicrosoft\.com)$/u;
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function defaultClientFile(): string {
  return path.join(process.env.LEX_DATA_DIR ?? path.join(os.homedir(), ".lex-machina", "data"), "microsoft", "oauth-client.json");
}

// The publisher's application, shipped with the app (config/microsoft-oauth-client.json).
export function bundledMicrosoftClientFile(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "config", "microsoft-oauth-client.json");
}

// Order: LEX_MICROSOFT_OAUTH_CLIENT_ID (+ _TENANT), a local file, then the bundled one.
// File: {"client_id": "...", "tenant": "organizations"}. None: Microsoft features stay off.
export function loadMicrosoftOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrideFile: string = env.LEX_MICROSOFT_OAUTH_CLIENT_FILE ?? defaultClientFile(),
  bundledFile: string = bundledMicrosoftClientFile()
): MicrosoftOAuthClientConfig | null {
  const pick = (clientId: string | undefined, tenant: string | undefined): MicrosoftOAuthClientConfig => {
    const id = clientId ?? "";
    const realm = tenant ?? "organizations";
    if (!CLIENT_ID.test(id) || !TENANT.test(realm)) throw new Error("MICROSOFT_OAUTH_CLIENT_INVALID");
    return { clientId: id, tenant: realm };
  };
  const envId = nonEmpty(env.LEX_MICROSOFT_OAUTH_CLIENT_ID);
  if (envId) return pick(envId, nonEmpty(env.LEX_MICROSOFT_OAUTH_TENANT));
  const file = [overrideFile, bundledFile].find((candidate) => existsSync(candidate));
  if (!file) return null;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("MICROSOFT_OAUTH_CLIENT_INVALID");
  }
  return pick(nonEmpty(record.client_id), nonEmpty(record.tenant));
}
