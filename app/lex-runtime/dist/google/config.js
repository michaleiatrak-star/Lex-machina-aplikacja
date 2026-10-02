import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALLBACK_PATH = "/oauth/google/callback";
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
};
function defaultClientFile() {
    return path.join(process.env.LEX_DATA_DIR ??
        path.join(os.homedir(), ".lex-machina", "data"), "google", "oauth-client.json");
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim()
        ? value.trim()
        : undefined;
}
// Reads LEX_GOOGLE_OAUTH_CLIENT_ID / LEX_GOOGLE_OAUTH_CLIENT_SECRET, or the
// client JSON downloaded from Google Cloud Console ({"installed": {...}}).
// Returns null when nothing is configured: Google features stay off.
export function loadGoogleOAuthConfig(env = process.env, clientFile = env.LEX_GOOGLE_OAUTH_CLIENT_FILE ??
    defaultClientFile()) {
    const envId = nonEmpty(env.LEX_GOOGLE_OAUTH_CLIENT_ID);
    if (envId) {
        const secret = nonEmpty(env.LEX_GOOGLE_OAUTH_CLIENT_SECRET);
        return secret
            ? { clientId: envId, clientSecret: secret }
            : { clientId: envId };
    }
    if (!existsSync(clientFile)) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(clientFile, "utf8"));
    }
    catch {
        throw new Error("GOOGLE_OAUTH_CLIENT_FILE_INVALID");
    }
    const installed = parsed &&
        typeof parsed === "object" &&
        "installed" in parsed
        ? parsed.installed
        : parsed;
    const record = installed && typeof installed === "object"
        ? installed
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
