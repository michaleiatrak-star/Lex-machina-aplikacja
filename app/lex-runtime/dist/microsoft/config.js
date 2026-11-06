import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const MICROSOFT_CALLBACK_PATH = "/oauth/microsoft/callback";
export const GRAPH = "https://graph.microsoft.com/v1.0";
export function authorityEndpoints(tenant) {
    const base = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
    return { authorize: `${base}/authorize`, token: `${base}/token` };
}
// Read-only: OneDrive files, files shared with the user and SharePoint document libraries.
export function microsoftScopes(tenant) {
    const base = ["openid", "profile", "email", "offline_access", "User.Read", "Files.Read.All"];
    // SharePoint sites exist only for work and school accounts.
    return tenant === "consumers" ? base : [...base, "Sites.Read.All"];
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
const TENANT = /^(?:common|organizations|consumers|[0-9a-f-]{36}|[A-Za-z0-9.-]{1,100}\.onmicrosoft\.com)$/u;
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function defaultClientFile() {
    return path.join(process.env.LEX_DATA_DIR ?? path.join(os.homedir(), ".lex-machina", "data"), "microsoft", "oauth-client.json");
}
// The publisher's application, shipped with the app (config/microsoft-oauth-client.json).
export function bundledMicrosoftClientFile() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "config", "microsoft-oauth-client.json");
}
// Order: LEX_MICROSOFT_OAUTH_CLIENT_ID (+ _TENANT), a local file, then the bundled one.
// File: {"client_id": "...", "tenant": "organizations"}. None: Microsoft features stay off.
export function loadMicrosoftOAuthConfig(env = process.env, overrideFile = env.LEX_MICROSOFT_OAUTH_CLIENT_FILE ?? defaultClientFile(), bundledFile = bundledMicrosoftClientFile()) {
    const pick = (clientId, tenant) => {
        const id = clientId ?? "";
        const realm = tenant ?? "organizations";
        if (!CLIENT_ID.test(id) || !TENANT.test(realm))
            throw new Error("MICROSOFT_OAUTH_CLIENT_INVALID");
        return { clientId: id, tenant: realm };
    };
    const envId = nonEmpty(env.LEX_MICROSOFT_OAUTH_CLIENT_ID);
    if (envId)
        return pick(envId, nonEmpty(env.LEX_MICROSOFT_OAUTH_TENANT));
    const file = [overrideFile, bundledFile].find((candidate) => existsSync(candidate));
    if (!file)
        return null;
    let record;
    try {
        record = JSON.parse(readFileSync(file, "utf8"));
    }
    catch {
        throw new Error("MICROSOFT_OAUTH_CLIENT_INVALID");
    }
    return pick(nonEmpty(record.client_id), nonEmpty(record.tenant));
}
