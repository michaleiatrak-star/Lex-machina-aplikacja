import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { startToolBridge } from "./lex-tool-bridge.js";
const COMMAND_TIMEOUT_MS = 20 * 60 * 1000;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const STATUS_TIMEOUT_MS = 15_000;
// stream-json prints its init event before the API request; silence past this
// window means the client is stuck before inference (not a slow answer).
const CLAUDE_FIRST_OUTPUT_TIMEOUT_MS = 120_000;
const OPTIONAL_ACCOUNT_CLIENT_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const TOOL_SENTINEL = "LEX_TOOL_CALLS_JSON:";
let anthropicOAuthToken = null;
function currentAnthropicOAuthToken() {
    return anthropicOAuthToken
        ?.toString("utf8") ??
        process.env
            .CLAUDE_CODE_OAUTH_TOKEN
            ?.trim() ??
        null;
}
function replaceAnthropicOAuthToken(token) {
    anthropicOAuthToken
        ?.fill(0);
    anthropicOAuthToken =
        token
            ? Buffer.from(token, "utf8")
            : null;
}
import { ACCOUNT_SESSION_MODELS } from "./model-families.js";
const ACCOUNT_MODEL_IDS = {
    openai: "account/openai/default",
    anthropic: "account/anthropic/default",
    xai: "account/xai/default",
    google: "account/google/default"
};
const CLI_NAMES = {
    openai: "codex",
    anthropic: "claude",
    xai: "grok",
    google: "gemini"
};
const OPTIONAL_ACCOUNT_CLIENTS = {
    openai: {
        packageName: "@openai/codex",
        version: "0.154.0",
        binary: "codex"
    },
    anthropic: {
        packageName: "@anthropic-ai/claude-code",
        version: "2.1.278",
        binary: "claude"
    },
    google: {
        packageName: "@google/gemini-cli",
        version: "0.62.0",
        binary: "gemini"
    },
    // Official Grok Build CLI (npm publisher xai-security, security@x.ai);
    // bin/grok is a Node launcher, so the npm .cmd shim works on Windows.
    xai: {
        packageName: "@xai-official/grok",
        version: "1.0.44",
        binary: "grok"
    }
};
export function accountSessionResumeMode(provider) {
    // Gemini never resumes a CLI session: Lex sends the whole context itself.
    return provider === "anthropic" || provider === "google"
        ? "LEX_CONTEXT_ONLY"
        : "LAST_OR_NEW";
}
export function isMissingResumableSessionMessage(value) {
    const normalized = value
        .toLocaleLowerCase("en")
        .replace(/[\r\n]+/g, " ");
    return [
        "no session",
        "no saved session",
        "no previous session",
        "no resumable session",
        "no conversation",
        "no previous conversation",
        "unknown session",
        "session not found",
        "session does not exist",
        "no matching session",
        "conversation not found"
    ].some((needle) => normalized.includes(needle));
}
function accountSessionStateRoot() {
    const configured = process.env
        .LEX_ACCOUNT_SESSION_STATE_ROOT
        ?.trim();
    return configured
        ? path.resolve(configured)
        : path.resolve(os.homedir(), ".lex-machina", "account-sessions");
}
function claudeSessionsRoot() {
    const configured = process.env
        .LEX_CLAUDE_SESSIONS_ROOT
        ?.trim();
    return configured
        ? path.resolve(configured)
        : path.resolve(os.homedir(), ".claude", "projects");
}
export async function discoverLatestClaudeSessionId() {
    let projects;
    try {
        projects =
            await fsp.readdir(claudeSessionsRoot(), {
                withFileTypes: true
            });
    }
    catch {
        return null;
    }
    let best = null;
    for (const project of projects
        .filter((entry) => entry.isDirectory())
        .slice(0, 2_000)) {
        const projectRoot = path.join(claudeSessionsRoot(), project.name);
        let entries;
        try {
            entries =
                await fsp.readdir(projectRoot, {
                    withFileTypes: true
                });
        }
        catch {
            continue;
        }
        for (const entry of entries.slice(0, 10_000)) {
            if (!entry.isFile() ||
                !entry.name.endsWith(".jsonl")) {
                continue;
            }
            const id = entry.name.slice(0, -".jsonl".length);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
                continue;
            }
            try {
                const stat = await fsp.stat(path.join(projectRoot, entry.name));
                if (!best ||
                    stat.mtimeMs >
                        best.mtimeMs) {
                    best = {
                        id,
                        mtimeMs: stat.mtimeMs
                    };
                }
            }
            catch {
                // A session may disappear during cleanup; skip it.
            }
        }
    }
    return best?.id ?? null;
}
function grokSessionsRoot() {
    const configured = process.env
        .LEX_GROK_SESSIONS_ROOT
        ?.trim();
    if (configured) {
        return path.resolve(configured);
    }
    const grokHome = process.env
        .GROK_HOME
        ?.trim();
    return grokHome
        ? path.resolve(grokHome, "sessions")
        : path.resolve(os.homedir(), ".grok", "sessions");
}
function uuidFromName(value) {
    const match = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match?.[0] ?? null;
}
export async function discoverLatestGrokSessionId() {
    const root = grokSessionsRoot();
    let best = null;
    let visited = 0;
    const walk = async (current, depth) => {
        if (depth > 4 ||
            visited >= 20_000) {
            return;
        }
        let entries;
        try {
            entries =
                await fsp.readdir(current, {
                    withFileTypes: true
                });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (visited >= 20_000) {
                return;
            }
            visited += 1;
            const fullPath = path.join(current, entry.name);
            const id = uuidFromName(entry.name);
            if (id) {
                try {
                    const stat = await fsp.stat(fullPath);
                    if (!best ||
                        stat.mtimeMs >
                            best.mtimeMs) {
                        best = {
                            id,
                            mtimeMs: stat.mtimeMs
                        };
                    }
                }
                catch {
                    // Session entry can disappear during cleanup.
                }
            }
            if (entry.isDirectory()) {
                await walk(fullPath, depth + 1);
            }
        }
    };
    await walk(root, 0);
    const resolved = best;
    return resolved?.id ?? null;
}
function continuityFingerprint(continuityKey) {
    return createHash("sha256")
        .update(continuityKey, "utf8")
        .digest("hex")
        .slice(0, 24);
}
function accountSessionStatePath(provider, continuityKey) {
    const suffix = continuityKey
        ? "-" +
            continuityFingerprint(continuityKey)
        : "";
    return path.join(accountSessionStateRoot(), provider +
        suffix +
        ".json");
}
async function hasPinnedAccountSession(provider) {
    try {
        const entries = await fsp.readdir(accountSessionStateRoot(), {
            withFileTypes: true
        });
        return entries.some((entry) => entry.isFile() &&
            entry.name.startsWith(provider + "-") &&
            entry.name.endsWith(".json"));
    }
    catch {
        return false;
    }
}
async function readAccountSessionId(provider, continuityKey) {
    try {
        const raw = await fsp.readFile(accountSessionStatePath(provider, continuityKey), "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed.sessionId ===
            "string" &&
            /^[A-Za-z0-9_.:-]{8,256}$/.test(parsed.sessionId)) {
            return parsed.sessionId;
        }
    }
    catch {
        // Missing or stale local continuity metadata is equivalent to no session.
    }
    return null;
}
async function writeAccountSessionId(provider, sessionId, continuityKey) {
    if (!/^[A-Za-z0-9_.:-]{8,256}$/.test(sessionId)) {
        return;
    }
    const root = accountSessionStateRoot();
    await fsp.mkdir(root, {
        recursive: true
    });
    await fsp.writeFile(accountSessionStatePath(provider, continuityKey), JSON.stringify({
        schemaVersion: 2,
        provider,
        sessionId,
        ...(continuityKey
            ? {
                continuityHash: continuityFingerprint(continuityKey)
            }
            : {}),
        updatedAt: new Date().toISOString()
    }, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600
    });
}
async function clearAccountSessionId(provider, continuityKey) {
    await fsp.rm(accountSessionStatePath(provider, continuityKey), {
        force: true
    }).catch(() => { });
}
function parseCodexThreadId(stdout) {
    for (const line of stdout.split(/\r?\n/)) {
        try {
            const event = JSON.parse(line);
            if (event.type ===
                "thread.started" &&
                typeof event.thread_id ===
                    "string" &&
                event.thread_id) {
                return event.thread_id;
            }
        }
        catch {
            // Non-JSON lines are ignored.
        }
    }
    return null;
}
function parseCodexFinalText(stdout) {
    let finalText = "";
    for (const line of stdout.split(/\r?\n/)) {
        try {
            const event = JSON.parse(line);
            if (event.type !==
                "item.completed" ||
                !event.item ||
                typeof event.item !==
                    "object" ||
                Array.isArray(event.item)) {
                continue;
            }
            const item = event.item;
            if (item.type ===
                "agent_message" &&
                typeof item.text ===
                    "string" &&
                item.text.trim()) {
                finalText =
                    item.text.trim();
            }
        }
        catch {
            // Non-JSON lines are ignored.
        }
    }
    return finalText || null;
}
function claudeResultPayload(stdout) {
    const candidates = [
        stdout.trim(),
        ...stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .reverse()
    ];
    for (const candidate of candidates) {
        if (!candidate.startsWith("{"))
            continue;
        try {
            const payload = JSON.parse(candidate);
            if (payload &&
                typeof payload === "object" &&
                (payload.type === "result" ||
                    (payload.type === undefined &&
                        "result" in payload))) {
                return payload;
            }
        }
        catch {
            // Partial or non-JSON lines are ignored.
        }
    }
    return null;
}
export function claudeResultReady(stdout) {
    return claudeResultPayload(stdout) !== null;
}
export function parseClaudeResult(stdout) {
    const payload = claudeResultPayload(stdout);
    if (!payload)
        return null;
    const isError = payload.is_error === true ||
        (typeof payload.subtype === "string" &&
            payload.subtype.startsWith("error"));
    const errors = Array.isArray(payload.errors)
        ? payload.errors
            .filter((item) => typeof item === "string")
            .join(" ")
        : "";
    const resultText = typeof payload.result ===
        "string"
        ? payload.result.trim()
        : "";
    const text = isError
        ? [resultText, errors]
            .filter(Boolean)
            .join(" ")
            .trim()
        : resultText;
    if (!text && !isError)
        return null;
    const sessionId = typeof payload.session_id ===
        "string" &&
        payload.session_id
        ? payload.session_id
        : null;
    return {
        text,
        sessionId,
        isError
    };
}
export function claudeAutomationCredentialMode(env = process.env) {
    if (env.CLAUDE_CODE_OAUTH_TOKEN
        ?.trim()) {
        return "ACCESS_TOKEN";
    }
    if (env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN
        ?.trim() &&
        env.CLAUDE_CODE_OAUTH_SCOPES
            ?.trim()) {
        return "REFRESH_TOKEN";
    }
    return "INTERACTIVE";
}
function accountEnvironment(provider) {
    const env = {
        ...process.env
    };
    if (provider === "openai") {
        delete env.OPENAI_API_KEY;
    }
    else if (provider === "anthropic") {
        delete env.ANTHROPIC_API_KEY;
        delete env.ANTHROPIC_AUTH_TOKEN;
        // A runtime started from inside a Claude Code shell must not make the
        // provider subprocess believe it is a nested Claude Code session.
        delete env.CLAUDECODE;
        env.CLAUDE_CODE_MCP_STARTUP_WAIT_MS = "0";
        env.MCP_CONNECTION_NONBLOCKING = "true";
        const token = currentAnthropicOAuthToken();
        if (token) {
            env.CLAUDE_CODE_OAUTH_TOKEN =
                token;
        }
        else {
            delete env.CLAUDE_CODE_OAUTH_TOKEN;
        }
    }
    else if (provider === "google") {
        // The Google account (Login with Google) must be used, never an API key.
        delete env.GEMINI_API_KEY;
        delete env.GOOGLE_API_KEY;
        delete env.GOOGLE_GENERATIVE_AI_API_KEY;
        delete env.GOOGLE_GENAI_USE_VERTEXAI;
        delete env.GOOGLE_GENAI_USE_GCA;
        env.GEMINI_CLI_NO_RELAUNCH = "true";
    }
    else {
        delete env.XAI_API_KEY;
    }
    return env;
}
function installHint(provider) {
    if (provider === "openai") {
        return "Codex CLI nie jest częścią instalatora. Po wybraniu połączenia konta ChatGPT Lex Machina pobierze przypiętą wersję klienta do prywatnego katalogu użytkownika.";
    }
    if (provider === "anthropic") {
        return "Claude Code nie jest częścią instalatora. Po wybraniu połączenia konta Claude Lex Machina pobierze przypiętą wersję klienta do prywatnego katalogu użytkownika.";
    }
    if (provider === "google") {
        return "Gemini CLI nie jest częścią instalatora. Po wybraniu połączenia konta Google Gemini Lex Machina pobierze przypiętą wersję klienta do prywatnego katalogu użytkownika.";
    }
    return "Grok Build nie jest częścią instalatora. Po wybraniu połączenia konta Grok Lex Machina pobierze przypiętą wersję klienta do prywatnego katalogu użytkownika.";
}
// Gemini CLI keeps its Google-account login in ~/.gemini (oauth_creds.json);
// settings.json selects the auth method.
function geminiHome() {
    const home = process.env.GEMINI_CLI_HOME?.trim() || os.homedir();
    return path.join(home, ".gemini");
}
export function geminiGoogleLoginPresent(dir = geminiHome()) {
    return existsSync(path.join(dir, "oauth_creds.json"));
}
// Selects "Login with Google" (a personal Google account / Gemini subscription)
// without touching the user's other Gemini CLI settings.
export async function selectGeminiGoogleLogin(dir = geminiHome()) {
    const file = path.join(dir, "settings.json");
    let settings = {};
    try {
        const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            settings = parsed;
        }
    }
    catch {
        // No or unreadable settings: start a new file.
    }
    const security = settings.security && typeof settings.security === "object" && !Array.isArray(settings.security)
        ? { ...settings.security }
        : {};
    const auth = security.auth && typeof security.auth === "object" && !Array.isArray(security.auth)
        ? { ...security.auth }
        : {};
    if (auth.selectedType === "oauth-personal")
        return;
    auth.selectedType = "oauth-personal";
    security.auth = auth;
    settings.security = security;
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(settings, null, 2) + "\n", "utf8");
}
// Headless Gemini CLI output (-o json): {"response": "..."} or {"error": {...}}.
export function parseGeminiResult(stdout) {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start < 0 || end < start)
        return { text: null, error: null };
    try {
        const parsed = JSON.parse(stdout.slice(start, end + 1));
        if (parsed.error) {
            return {
                text: null,
                error: {
                    message: String(parsed.error.message ?? "GEMINI_ERROR"),
                    code: typeof parsed.error.code === "number" ? parsed.error.code : null
                }
            };
        }
        return {
            text: typeof parsed.response === "string" ? parsed.response : null,
            error: null
        };
    }
    catch {
        return { text: null, error: null };
    }
}
function cmdQuote(value) {
    const escaped = value
        .replace(/%/g, "%%")
        .replace(/"/g, '""');
    return `"${escaped}"`;
}
export function mergeWindowsCommandPath(currentPath, machinePath, userPath) {
    const seen = new Set();
    const parts = [];
    for (const raw of [
        currentPath,
        machinePath,
        userPath
    ]) {
        for (const item of (raw ?? "")
            .split(";")
            .map((value) => value.trim())
            .filter(Boolean)) {
            const key = item.toLocaleLowerCase("en");
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            parts.push(item);
        }
    }
    return parts.join(";");
}
async function commandLookupEnvironment() {
    if (process.platform !==
        "win32") {
        return process.env;
    }
    const command = [
        "$machine=[Environment]::GetEnvironmentVariable('Path','Machine')",
        "$user=[Environment]::GetEnvironmentVariable('Path','User')",
        "[Console]::Out.Write(($machine + [Environment]::NewLine + $user))"
    ].join(";");
    const result = await runDirect("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        command
    ], undefined, process.env, 5_000).catch(() => null);
    if (!result ||
        result.code !== 0) {
        return process.env;
    }
    const [machinePath = "", userPath = ""] = result.stdout.split(/\r?\n/, 2);
    const pathKey = Object.keys(process.env).find((key) => key.toLocaleLowerCase("en") === "path") ?? "Path";
    const refreshedPath = mergeWindowsCommandPath(process.env[pathKey], machinePath, userPath);
    return {
        ...process.env,
        [pathKey]: refreshedPath
    };
}
function codexAccountModel() {
    return process.env
        .LEX_CODEX_ACCOUNT_MODEL
        ?.trim() ||
        "gpt-5.6-luna";
}
function optionalAccountClientsRoot() {
    const override = process.env
        .LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT
        ?.trim();
    if (override) {
        return path.resolve(override);
    }
    const localAppData = process.env
        .LOCALAPPDATA
        ?.trim();
    return localAppData
        ? path.join(localAppData, "LexMachina", "optional-tools", "account-clients")
        : path.join(os.homedir(), ".lex-machina", "optional-tools", "account-clients");
}
function optionalAccountClientExecutable(provider) {
    const spec = OPTIONAL_ACCOUNT_CLIENTS[provider];
    if (!spec) {
        return null;
    }
    const suffix = process.platform === "win32"
        ? `${spec.binary}.cmd`
        : spec.binary;
    const candidate = path.join(optionalAccountClientsRoot(), provider, "node_modules", ".bin", suffix);
    return existsSync(candidate)
        ? candidate
        : null;
}
async function optionalAccountClientMatchesPinnedVersion(provider) {
    const spec = OPTIONAL_ACCOUNT_CLIENTS[provider];
    if (!spec)
        return false;
    try {
        const packagePath = path.join(optionalAccountClientsRoot(), provider, "node_modules", ...spec.packageName.split("/"), "package.json");
        const parsed = JSON.parse(await fsp.readFile(packagePath, "utf8"));
        return parsed.version === spec.version;
    }
    catch {
        return false;
    }
}
function privateCodexExecutable() {
    const override = process.env
        .LEX_CODEX_CLI
        ?.trim();
    if (override &&
        existsSync(override)) {
        return override;
    }
    return (optionalAccountClientExecutable("openai") ??
        (existsSync(path.resolve(process.cwd(), "node_modules", ".bin", process.platform === "win32"
            ? "codex.cmd"
            : "codex"))
            ? path.resolve(process.cwd(), "node_modules", ".bin", process.platform === "win32"
                ? "codex.cmd"
                : "codex")
            : null));
}
function privateClaudeExecutable() {
    const override = process.env
        .LEX_CLAUDE_CLI
        ?.trim();
    if (override &&
        existsSync(override)) {
        return override;
    }
    return (optionalAccountClientExecutable("anthropic") ??
        (existsSync(path.resolve(process.cwd(), "node_modules", ".bin", process.platform === "win32"
            ? "claude.cmd"
            : "claude"))
            ? path.resolve(process.cwd(), "node_modules", ".bin", process.platform === "win32"
                ? "claude.cmd"
                : "claude")
            : null));
}
export function codexExecArgs(workDir, outputPath, model = codexAccountModel(), tail = ["-"]) {
    return [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--disable",
        "plugins",
        "--disable",
        "apps",
        "--disable",
        "multi_agent",
        "--disable",
        "remote_plugin",
        "--disable",
        "shell_tool",
        "--disable",
        "unified_exec",
        "--config",
        "mcp_servers={}",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--model",
        model,
        "--cd",
        workDir,
        "--json",
        "--output-last-message",
        outputPath,
        ...tail
    ];
}
export function claudeHeadlessArgs(systemPrompt, tail = []) {
    // stream-json + --verbose emits an init event before the API request and a
    // final `result` line; Lex settles on that line instead of waiting for the
    // process to exit (Windows child processes can keep claude.exe alive).
    // --strict-mcp-config without --mcp-config starts no MCP servers at all:
    // --restricted alone still launches user/project MCP servers.
    return [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--restricted",
        "--strict-mcp-config",
        "--tools",
        "",
        "--disallowedTools",
        "mcp__*",
        "--system-prompt",
        systemPrompt,
        "--system-prompt-snapshot",
        "off",
        ...tail
    ];
}
/**
 * Claude with read-only file tools confined to the legal corpus (--restricted
 * limits Read/Glob/Grep to the working directory; dontAsk refuses anything not
 * allowed) and the Lex runtime tools over one MCP server. No shell, no web,
 * no writes, no MCP servers of the account.
 */
export function claudeCorpusArgs(systemPrompt, mcpConfigPath, tail = []) {
    return [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--restricted",
        "--strict-mcp-config",
        "--mcp-config",
        mcpConfigPath,
        "--tools",
        "Read,Glob,Grep",
        "--allowedTools",
        "Read,Glob,Grep,mcp__lex",
        "--disallowedTools",
        "Bash,Write,Edit,NotebookEdit,WebFetch,WebSearch",
        "--permission-mode",
        "dontAsk",
        "--system-prompt",
        systemPrompt,
        "--system-prompt-snapshot",
        "off",
        ...tail
    ];
}
/** Tool uses of a Claude stream-json run, in order. */
export function claudeToolUses(stdout) {
    const uses = [];
    for (const line of stdout.split(/\r?\n/)) {
        if (!line.startsWith("{"))
            continue;
        try {
            const event = JSON.parse(line);
            if (event.type !== "assistant" || !Array.isArray(event.message?.content))
                continue;
            for (const block of event.message.content) {
                if (block?.type === "tool_use" && typeof block.name === "string") {
                    uses.push({
                        name: block.name,
                        input: block.input && typeof block.input === "object" && !Array.isArray(block.input)
                            ? block.input
                            : {}
                    });
                }
            }
        }
        catch {
            // Not an event line.
        }
    }
    return uses;
}
/**
 * Native Reads of the run, for the audit. A failed Read ("File does not exist")
 * is not a read: it must not count as a loaded skill, and it is what the
 * anomaly journal reports.
 */
export function reportNativeReads(corpus, stdout) {
    for (const use of claudeToolUses(stdout)) {
        if (use.name !== "Read")
            continue;
        const relative = corpusRelativePath(corpus.root, use.input.file_path);
        if (!relative)
            continue;
        if (statSync(path.join(corpus.root, relative), { throwIfNoEntry: false })?.isFile()) {
            corpus.onRead?.(relative);
        }
        else {
            corpus.onMissing?.(relative);
        }
    }
}
/** Corpus-relative path of a native Read, or null when it is outside the corpus. */
export function corpusRelativePath(root, filePath) {
    if (typeof filePath !== "string" || !filePath)
        return null;
    const relative = path.relative(path.resolve(root), path.resolve(root, filePath));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        return null;
    return relative.split(path.sep).join("/");
}
export function lexToolsMcpServerPath() {
    return fileURLToPath(new URL("./lex-tools-mcp.js", import.meta.url));
}
export function sanitizeAccountCliFailureDetail(value) {
    return value
        .replace(/sk-ant-[A-Za-z0-9_-]+/gi, "[REDACTED_TOKEN]")
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]{20,}\b/gi, "Bearer [REDACTED_TOKEN]")
        .replace(/[\r\n]+/g, " ")
        .trim()
        .slice(-1200);
}
export function classifyAccountCliFailureDetail(detail) {
    const lower = detail.toLowerCase();
    // The service refuses the account's plan for this client, e.g. Google since
    // 2026-10: IneligibleTierError UNSUPPORTED_CLIENT for the free "Gemini Code
    // Assist for individuals" tier in Gemini CLI. Logging in again cannot help.
    if (/ineligibletiererror|unsupported_client|ineligibletiers|no longer supported for gemini code assist/.test(lower)) {
        return "ACCOUNT_SESSION_PLAN_UNSUPPORTED";
    }
    if (/model.{0,80}(not supported|unsupported|not available)|not supported when using codex with a chatgpt account|model metadata.*not found/.test(lower)) {
        return "ACCOUNT_SESSION_MODEL_UNSUPPORTED";
    }
    if (/401|unauthorized|not logged in|login required|authentication.*failed|credentials.*missing|oauth.{0,80}expired|token.{0,80}expired|invalid bearer token|could not be refreshed/.test(lower)) {
        return "ACCOUNT_SESSION_AUTH_EXPIRED";
    }
    if (/rate limit|too many requests|at capacity|capacity|quota exceeded|usage limit/.test(lower)) {
        return "ACCOUNT_SESSION_CAPACITY";
    }
    if (/usage policy|prompt was flagged|invalid prompt/.test(lower)) {
        return "ACCOUNT_SESSION_PROMPT_REJECTED";
    }
    if (/unknown (?:option|argument|feature|config)|unrecognized (?:option|argument)|invalid value.*features\.|failed to parse.*config/.test(lower)) {
        return "ACCOUNT_SESSION_CLI_INCOMPATIBLE";
    }
    return "ACCOUNT_SESSION_CLI_FAILED";
}
async function resolveCommand(command) {
    const probe = process.platform === "win32" ? "where.exe" : "which";
    const env = await commandLookupEnvironment();
    const result = await runDirect(probe, [command], undefined, env, 5_000).catch(() => null);
    if (!result || result.code !== 0)
        return null;
    return pickResolvedCommand(result.stdout);
}
/**
 * `where.exe claude` lists the extensionless POSIX shim of an npm global
 * install first (e.g. %APPDATA%\npm\claude). Node cannot spawn it, which
 * surfaced as an uncoded "Provider odrzucił" failure. Only runnable Windows
 * candidates are accepted, .exe first.
 */
export function pickResolvedCommand(whereOutput, platform = process.platform) {
    const candidates = whereOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (platform !== "win32") {
        return candidates[0] ?? null;
    }
    for (const extension of [".exe", ".cmd", ".bat", ".com"]) {
        const match = candidates.find((candidate) => candidate.toLowerCase().endsWith(extension));
        if (match)
            return match;
    }
    return null;
}
async function resolveAccountExecutable(provider) {
    const command = CLI_NAMES[provider];
    // Status must probe the same client that executes requests.
    if (provider === "anthropic") {
        const pinned = privateClaudeExecutable();
        if (pinned) {
            return pinned;
        }
    }
    // Match the proven ChatGPT behavior for both account providers:
    // prefer the user's normally installed official CLI, then use the
    // optional private client provisioned on demand by Lex Machina.
    const systemExecutable = await resolveCommand(command);
    if (systemExecutable) {
        return systemExecutable;
    }
    if (provider === "openai") {
        return privateCodexExecutable();
    }
    if (provider === "anthropic") {
        return privateClaudeExecutable();
    }
    if (provider === "google" || provider === "xai") {
        return optionalAccountClientExecutable(provider);
    }
    return null;
}
/**
 * cmd.exe line for a .cmd/.bat shim: `/s /c "<line>"` strips only the outer
 * quotes, so every quoted part survives. It must be passed verbatim: Node's
 * default argv quoting turns the inner quotes into \" which cmd.exe does not
 * understand ('"C:\...\npm.cmd\"' is not recognized). % is not doubled here:
 * that escape exists only inside batch files.
 */
export function windowsShimCommandLine(executable, args) {
    const quote = (value) => `"${value.replace(/"/g, '""')}"`;
    return `"${[quote(executable), ...args.map(quote)].join(" ")}"`;
}
export function spawnResolved(executable, args, cwd, env) {
    if (process.platform === "win32" &&
        /\.(cmd|bat)$/i.test(executable)) {
        const comspec = process.env.ComSpec || "cmd.exe";
        return spawn(comspec, ["/d", "/s", "/c", windowsShimCommandLine(executable, args)], {
            cwd,
            env,
            windowsHide: true,
            windowsVerbatimArguments: true,
            stdio: ["pipe", "pipe", "pipe"]
        });
    }
    return spawn(executable, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
    });
}
function appendCapture(current, chunk) {
    const next = current + chunk.toString();
    if (Buffer.byteLength(next, "utf8") <= MAX_CAPTURE_BYTES) {
        return next;
    }
    return next.slice(-MAX_CAPTURE_BYTES);
}
function killProcessTree(child) {
    if (process.platform === "win32" &&
        typeof child.pid === "number") {
        // child.kill() on Windows ends only the direct child (e.g. cmd.exe),
        // leaving claude.exe/codex.exe running and holding the pipes open.
        try {
            const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore"
            });
            killer.once("error", () => child.kill());
            return;
        }
        catch {
            // Fall back to the direct kill below.
        }
    }
    child.kill();
}
function runDirect(executable, args, stdinText, env, timeoutMs, cwd, abortSignal, settleOptions = {}) {
    return new Promise((resolve, reject) => {
        const child = spawnResolved(executable, args, cwd, env);
        let stdout = "";
        let stderr = "";
        let settled = false;
        let firstOutputTimer = null;
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (firstOutputTimer) {
                clearTimeout(firstOutputTimer);
            }
            abortSignal?.removeEventListener("abort", onAbort);
            callback();
        };
        const onAbort = () => {
            killProcessTree(child);
            finish(() => {
                const error = new Error("ACCOUNT_SESSION_ABORTED");
                error.name = "AbortError";
                reject(error);
            });
        };
        const timer = setTimeout(() => {
            killProcessTree(child);
            finish(() => reject(new Error(`ACCOUNT_SESSION_COMMAND_TIMEOUT${stderr.trim()
                ? `:${sanitizeAccountCliFailureDetail(stderr)}`
                : ""}`)));
        }, timeoutMs);
        if (settleOptions.firstOutputTimeoutMs) {
            firstOutputTimer = setTimeout(() => {
                if (stdout)
                    return;
                killProcessTree(child);
                finish(() => reject(new Error(`ACCOUNT_SESSION_CLI_STALLED${stderr.trim()
                    ? `:${sanitizeAccountCliFailureDetail(stderr)}`
                    : ""}`)));
            }, settleOptions.firstOutputTimeoutMs);
        }
        abortSignal?.addEventListener("abort", onAbort, { once: true });
        child.stdout.on("data", (chunk) => {
            stdout = appendCapture(stdout, chunk);
            if (!settled &&
                settleOptions.settleOnStdout?.(stdout)) {
                const captured = stdout;
                finish(() => resolve({
                    code: 0,
                    stdout: captured,
                    stderr
                }));
                killProcessTree(child);
            }
        });
        child.stderr.on("data", (chunk) => {
            stderr = appendCapture(stderr, chunk);
            settleOptions.onStderr?.(String(chunk));
        });
        child.stdin.on("error", () => {
            // The client may exit before consuming stdin; the exit handler reports it.
        });
        child.once("error", (error) => {
            const errno = error.code ??
                "UNKNOWN";
            finish(() => reject(new Error(`ACCOUNT_SESSION_CLI_SPAWN_FAILED:${errno}:${sanitizeAccountCliFailureDetail(`${executable}: ${error.message}`)}`)));
        });
        child.once("exit", (code) => {
            finish(() => resolve({
                code: code ?? 1,
                stdout,
                stderr
            }));
        });
        if (stdinText !== undefined) {
            child.stdin.end(stdinText);
        }
        else {
            child.stdin.end();
        }
    });
}
async function ensureAccountExecutable(provider) {
    if (provider === "openai" ||
        provider === "anthropic" ||
        provider === "google" ||
        provider === "xai") {
        const privateExecutable = provider === "openai"
            ? privateCodexExecutable()
            : provider === "google" || provider === "xai"
                ? optionalAccountClientExecutable(provider)
                : privateClaudeExecutable();
        if (privateExecutable &&
            await optionalAccountClientMatchesPinnedVersion(provider)) {
            return privateExecutable;
        }
        // Claude: always run the pinned client, like the working ChatGPT/Codex
        // path. A system-wide Claude Code of another version may reject Lex's
        // headless flags; it shares the same login (~/.claude), so it is only a
        // fallback when provisioning the pinned client fails.
        if (!privateExecutable &&
            (provider === "openai" || provider === "google" || provider === "xai")) {
            const systemExecutable = await resolveCommand(CLI_NAMES[provider]);
            if (systemExecutable) {
                return systemExecutable;
            }
        }
    }
    else {
        const existing = await resolveAccountExecutable(provider);
        if (existing) {
            return existing;
        }
    }
    try {
        return await provisionPinnedAccountClient(provider);
    }
    catch (error) {
        if (provider === "anthropic") {
            const systemExecutable = await resolveCommand(CLI_NAMES[provider]);
            if (systemExecutable) {
                return systemExecutable;
            }
        }
        throw error;
    }
}
const provisionListeners = new Map();
const provisionsInFlight = new Map();
// One npm install per provider at a time: login and an explicit provision
// request must not install into the same directory concurrently.
function provisionPinnedAccountClient(provider) {
    const running = provisionsInFlight.get(provider);
    if (running)
        return running;
    const started = provisionPinnedAccountClientOnce(provider).finally(() => provisionsInFlight.delete(provider));
    provisionsInFlight.set(provider, started);
    return started;
}
async function directorySize(root) {
    let total = 0;
    const pending = [root];
    while (pending.length) {
        const dir = pending.pop();
        let entries;
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory())
                pending.push(full);
            else if (entry.isFile()) {
                try {
                    total += (await fsp.stat(full)).size;
                }
                catch {
                    // File replaced while npm unpacks; the next tick counts it.
                }
            }
        }
    }
    return total;
}
// npm does not put its own Node on PATH for package install scripts, and the
// desktop runtime's Node is bundled (not installed system-wide). Without this,
// "postinstall: node …" (Grok Build, Gemini CLI dependencies) fails with
// "'node' is not recognized" on a PC without a system Node.
export function npmInstallEnvironment(npmExecutable, base = process.env, nodeExecutable = process.execPath) {
    const env = { ...base, npm_config_update_notifier: "false" };
    const pathKeys = Object.keys(env).filter((key) => /^path$/i.test(key));
    const pathKey = pathKeys[0] ?? (process.platform === "win32" ? "Path" : "PATH");
    const existing = pathKeys
        .flatMap((key) => (env[key] ?? "").split(path.delimiter))
        .filter(Boolean);
    const nodeDirs = [path.dirname(nodeExecutable), path.dirname(npmExecutable)].filter((dir, index, all) => all.indexOf(dir) === index);
    for (const key of pathKeys)
        delete env[key];
    env[pathKey] = [...nodeDirs, ...existing.filter((dir) => !nodeDirs.includes(dir))].join(path.delimiter);
    return env;
}
/** npm-cli.js next to an npm launcher (Node for Windows layout and node/bin/npm). */
export function npmCliScript(npmExecutable) {
    const dir = path.dirname(npmExecutable);
    for (const candidate of [
        path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
        path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
    ]) {
        if (existsSync(candidate))
            return candidate;
    }
    return null;
}
// The npm error lines (not the http progress lines) explain a failed install.
export function npmFailureDetail(stderr) {
    const lines = stderr.split(/\r?\n/).filter((line) => /npm (error|ERR!)/i.test(line));
    return (lines.length ? lines.join("\n") : stderr).trim().slice(-1200);
}
// npm --loglevel=http prints one "http fetch GET 200 <url>" line per package.
export function countNpmFetches(chunk) {
    return chunk.match(/http fetch GET 20\d /g)?.length ?? 0;
}
async function provisionPinnedAccountClientOnce(provider) {
    const spec = OPTIONAL_ACCOUNT_CLIENTS[provider];
    if (!spec) {
        return null;
    }
    const runtimeRoot = process.env
        .LEX_RUNTIME_ROOT
        ?.trim();
    const npmOverride = process.env
        .LEX_NPM_CLI
        ?.trim();
    const runtimeNpm = runtimeRoot
        ? path.join(runtimeRoot, "node", process.platform === "win32"
            ? "npm.cmd"
            : "bin/npm")
        : null;
    const npmExecutable = (npmOverride &&
        existsSync(npmOverride))
        ? npmOverride
        : (runtimeNpm &&
            existsSync(runtimeNpm))
            ? runtimeNpm
            : await resolveCommand("npm");
    if (!npmExecutable) {
        throw new Error(`ACCOUNT_SESSION_CLI_PROVISIONER_NOT_AVAILABLE:${provider}`);
    }
    // npm.cmd only starts node with npm-cli.js; calling it directly avoids
    // cmd.exe and its quoting (an install path with spaces, "Lex Machina").
    const npmCli = npmCliScript(npmExecutable);
    const installRoot = path.join(optionalAccountClientsRoot(), provider);
    await fsp.mkdir(installRoot, {
        recursive: true
    });
    const packageSpec = `${spec.packageName}@${spec.version}`;
    const report = provisionListeners.get(provider);
    let packagesFetched = 0;
    report?.({ stage: "DOWNLOADING", packagesFetched, bytesOnDisk: 0 });
    let measuring = false;
    const sizeTimer = report
        ? setInterval(() => {
            if (measuring)
                return;
            measuring = true;
            void directorySize(installRoot)
                .then((bytesOnDisk) => report({ bytesOnDisk }))
                .finally(() => {
                measuring = false;
            });
        }, 2_000)
        : null;
    let result;
    try {
        result =
            await runDirect(npmCli ? process.execPath : npmExecutable, [
                ...(npmCli ? [npmCli] : []),
                "install",
                "--prefix",
                installRoot,
                "--no-audit",
                "--no-fund",
                "--save-exact",
                "--loglevel=http",
                packageSpec
            ], undefined, npmInstallEnvironment(npmExecutable), OPTIONAL_ACCOUNT_CLIENT_INSTALL_TIMEOUT_MS, undefined, undefined, {
                onStderr: (chunk) => {
                    const fetched = countNpmFetches(chunk);
                    if (fetched && report) {
                        packagesFetched += fetched;
                        report({ packagesFetched });
                    }
                }
            });
    }
    finally {
        if (sizeTimer)
            clearInterval(sizeTimer);
    }
    report?.({ stage: "VERIFYING" });
    if (result.code !== 0) {
        throw new Error(`ACCOUNT_SESSION_CLI_PROVISION_FAILED:${provider}:${result.code}:${npmFailureDetail(result.stderr)}`);
    }
    const installed = provider === "openai"
        ? privateCodexExecutable()
        : provider === "google" || provider === "xai"
            ? optionalAccountClientExecutable(provider)
            : privateClaudeExecutable();
    if (!installed) {
        throw new Error(`ACCOUNT_SESSION_CLI_PROVISION_MISSING_BINARY:${provider}`);
    }
    return installed;
}
/**
 * On Windows npm exposes Claude Code as a claude.cmd shim that only forwards
 * to the native bin/claude.exe. Spawning the shim goes through cmd.exe, which
 * re-quotes arguments, and kill() then ends only cmd.exe. Run the native
 * executable directly when the package has already placed it.
 */
export function nativeClaudeExecutable(executable, platform = process.platform) {
    if (platform !== "win32" ||
        !/[\\/]claude\.cmd$/i.test(executable)) {
        return executable;
    }
    const shimDir = path.dirname(executable);
    // node_modules/.bin/claude.cmd (private install) or
    // %APPDATA%/npm/claude.cmd (npm global install).
    for (const packageRoot of [
        path.join(shimDir, ".."),
        path.join(shimDir, "node_modules")
    ]) {
        const candidate = path.join(packageRoot, "@anthropic-ai", "claude-code", "bin", "claude.exe");
        try {
            // The unpopulated postinstall placeholder is a tiny stub.
            if (statSync(candidate).size > 1024 * 1024) {
                return candidate;
            }
        }
        catch {
            // Try the next layout; keep the shim when none is present.
        }
    }
    return executable;
}
async function runCli(provider, args, stdinText, timeoutMs, cwd, abortSignal, settleOptions) {
    const executable = await ensureAccountExecutable(provider);
    if (!executable) {
        throw new Error(`ACCOUNT_SESSION_CLI_NOT_INSTALLED:${provider}`);
    }
    return runDirect(provider === "anthropic"
        ? nativeClaudeExecutable(executable)
        : executable, args, stdinText, accountEnvironment(provider), timeoutMs, cwd, abortSignal, settleOptions);
}
export function accountLoginLaunchMode(provider, platform = process.platform) {
    return platform === "win32"
        ? "VISIBLE_TERMINAL"
        : "CAPTURED";
}
export function accountLoginArgs(provider) {
    if (provider === "openai") {
        // Keep the browser OAuth flow compatible with the proven RC14 behavior.
        // The official Codex client is resolved from the system or provisioned
        // on demand; the login invocation stays in its native ChatGPT flow.
        return ["login"];
    }
    if (provider === "anthropic") {
        // Match ChatGPT's proven browser-login shape: let the official client
        // open its native interactive OAuth flow first.
        return [
            "auth",
            "login"
        ];
    }
    if (provider === "google") {
        // Gemini CLI has no login subcommand: the interactive client starts the
        // "Login with Google" browser flow selected in its settings (see
        // selectGeminiGoogleLogin); the user closes it with /quit.
        return [];
    }
    return ["login"];
}
export function accountLoginFallbackArgs(provider) {
    if (provider === "openai") {
        return [
            "login",
            "--device-auth"
        ];
    }
    if (provider === "anthropic") {
        return [
            "auth",
            "login",
            "--claudeai"
        ];
    }
    return null;
}
export function visibleWindowsLoginLauncher(scriptPath) {
    const escapedScriptPath = scriptPath.replace(/'/g, "''");
    return [
        "$ErrorActionPreference = 'Stop'",
        "$cmd = $env:ComSpec",
        `$script = '${escapedScriptPath}'`,
        "$argLine = '/d /s /c ' + [char]34 + $script + [char]34",
        "$process = Start-Process -FilePath $cmd -ArgumentList $argLine -WindowStyle Normal -PassThru -Wait",
        "exit $process.ExitCode"
    ].join("\r\n");
}
async function runVisibleWindowsLogin(provider, args, timeoutMs) {
    const executable = await ensureAccountExecutable(provider);
    if (!executable) {
        throw new Error(`ACCOUNT_SESSION_CLI_NOT_INSTALLED:${provider}`);
    }
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "lex-account-login-"));
    const scriptPath = path.join(root, "login.cmd");
    const argumentLine = args
        .map(cmdQuote)
        .join(" ");
    const loginLabel = provider === "openai"
        ? "Codex / ChatGPT"
        : provider === "anthropic"
            ? "Claude Code"
            : provider === "google"
                ? "Gemini CLI"
                : "Grok Build";
    const loginCommand = /\.(cmd|bat)$/i.test(executable)
        ? `call ${cmdQuote(executable)} ${argumentLine}`
        : `${cmdQuote(executable)} ${argumentLine}`;
    await fsp.writeFile(scriptPath, [
        "@echo off",
        "setlocal",
        `title Lex Machina - ${loginLabel} login`,
        `echo Lex Machina otworzy logowanie: ${loginLabel}.`,
        "echo Dokoncz oficjalne logowanie w przegladarce i wroc do tego okna, jesli klient poprosi o kod.",
        ...(provider === "google"
            ? ["echo Po zalogowaniu wpisz /quit i nacisnij Enter, aby zamknac Gemini CLI."]
            : []),
        "echo.",
        loginCommand,
        "set \"LEX_EXIT=%ERRORLEVEL%\"",
        "echo.",
        `if not "%LEX_EXIT%"=="0" echo Logowanie ${loginLabel} nie powiodlo sie. Kod: %LEX_EXIT%`,
        "exit /b %LEX_EXIT%"
    ].join("\r\n"), "utf8");
    const launcherPath = path.join(root, "launcher.ps1");
    await fsp.writeFile(launcherPath, visibleWindowsLoginLauncher(scriptPath), "utf8");
    try {
        return await runDirect("powershell.exe", [
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            launcherPath
        ], undefined, accountEnvironment(provider), timeoutMs);
    }
    finally {
        await fsp.rm(root, {
            recursive: true,
            force: true
        }).catch(() => { });
    }
}
/**
 * Grok ACP errors arrive as bare JSON-RPC messages ("Rate limited"); give them
 * the same code as CLI failures so the UI says what happened.
 */
export function codedGrokFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^[A-Z0-9_]+(?::|$)/.test(message)) {
        return error instanceof Error ? error : new Error(message);
    }
    const detail = sanitizeAccountCliFailureDetail(message);
    return new Error(`${classifyAccountCliFailureDetail(detail)}:xai:1${detail ? `:${detail}` : ""}`);
}
/** Short per-minute request limit (worth waiting for), not a used-up quota. */
export function isTransientRateLimit(error) {
    const message = error instanceof Error ? error.message : String(error);
    return (message.startsWith("ACCOUNT_SESSION_CAPACITY") &&
        /rate.?limit|too many requests|429/i.test(message) &&
        !/usage limit|quota|resets? (?:at|in)|try again (?:at|in) \d+ ?h/i.test(message));
}
// Waits before repeating a model run refused by a short request limit.
const RATE_LIMIT_BACKOFF_MS = [15_000, 45_000];
function normalizeCliFailure(provider, result) {
    const detail = sanitizeAccountCliFailureDetail(result.stderr || result.stdout);
    const code = classifyAccountCliFailureDetail(detail);
    return new Error(`${code}:${provider}:${result.code}${detail ? `:${detail}` : ""}`);
}
export function openAiChatGptAuthenticated(result) {
    if (result.code !== 0) {
        return false;
    }
    const status = (result.stdout + "\n" + result.stderr)
        .toLowerCase();
    if (status.includes("api key") ||
        status.includes("apikey")) {
        return false;
    }
    // Codex versions used by the RC14 line can report the successful browser
    // login simply as "Using ChatGPT", without an additional "logged in" token.
    // Preserve that proven contract while still excluding API-key auth above.
    return (status.includes("using chatgpt") ||
        (status.includes("chatgpt") &&
            (status.includes("logged in") ||
                status.includes("signed in") ||
                status.includes("authenticated"))));
}
export function codexStoredAuthIsChatGpt(raw) {
    try {
        const payload = JSON.parse(raw);
        const mode = typeof payload.auth_mode ===
            "string"
            ? payload.auth_mode
                .trim()
                .toLowerCase()
            : "";
        const storedApiKey = typeof payload.OPENAI_API_KEY ===
            "string" &&
            payload.OPENAI_API_KEY
                .trim().length > 0;
        return (!storedApiKey &&
            (mode === "chatgpt" ||
                mode === "chatgpt_oauth" ||
                mode === "chatgpt-oauth"));
    }
    catch {
        return false;
    }
}
async function storedCodexChatGptAuthPresent() {
    const env = accountEnvironment("openai");
    const codexHome = env.CODEX_HOME
        ?.trim() ||
        path.join(os.homedir(), ".codex");
    try {
        return codexStoredAuthIsChatGpt(await fsp.readFile(path.join(codexHome, "auth.json"), "utf8"));
    }
    catch {
        return false;
    }
}
export function claudeSubscriptionAuthenticated(result) {
    // Claude Code's official auth status contract is its exit code:
    // 0 = authenticated, non-zero = not authenticated / unsupported status.
    // Do not parse human-readable status text; different Claude Code releases
    // mention Console/API configuration fields even for a valid Claude account.
    return result.code === 0;
}
async function assertSubscriptionAccount(provider, abortSignal) {
    if (provider === "anthropic") {
        // The official Claude Code login/status process already owns auth state.
        // Do not add another custom authentication gate here; the actual Claude
        // invocation below is the authoritative end-to-end check.
        return;
    }
    const result = provider === "openai"
        ? await runCli(provider, [
            "login",
            "status"
        ], undefined, STATUS_TIMEOUT_MS, undefined, abortSignal)
        : await runCli(provider, [
            "auth",
            "status"
        ], undefined, STATUS_TIMEOUT_MS, undefined, abortSignal);
    const authenticated = openAiChatGptAuthenticated(result) ||
        (result.code === 0 &&
            await storedCodexChatGptAuthPresent());
    if (!authenticated) {
        throw new Error(`ACCOUNT_SESSION_NOT_SUBSCRIPTION_AUTH:${provider}`);
    }
}
async function runGrokAcp(prompt, cwd, abortSignal, resumeSessionId) {
    const executable = await ensureAccountExecutable("xai");
    if (!executable) {
        throw new Error("ACCOUNT_SESSION_CLI_NOT_INSTALLED:xai");
    }
    return new Promise((resolve, reject) => {
        const proc = spawnResolved(executable, [
            "--no-auto-update",
            "--permission-mode",
            "dontAsk",
            "--disallowed-tools",
            "*",
            "--sandbox",
            "strict",
            "--no-subagents",
            "--no-memory",
            "--disable-web-search",
            "--system-prompt-override",
            "You are the semantic model inside Lex Machina. Lex Machina owns privacy gates, legal-source verification and all tool execution. Current Lex Machina instructions override prior host-session instructions. Do not access local files, external services or host tools.",
            "agent",
            "stdio"
        ], cwd, accountEnvironment("xai"));
        const rl = readline.createInterface({
            input: proc.stdout
        });
        // A client that exits early (not logged in, crash) closes stdin; the
        // write then fails with EPIPE, which must not crash the runtime. The
        // "exit" handler below settles the request.
        proc.stdin.on("error", () => { });
        let nextId = 1;
        let text = "";
        let stderr = "";
        let settled = false;
        const pending = new Map();
        const cleanup = () => {
            rl.close();
            proc.kill();
            abortSignal
                ?.removeEventListener("abort", onAbort);
            for (const item of pending.values()) {
                clearTimeout(item.timer);
            }
            pending.clear();
        };
        const finishReject = (error) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(error);
        };
        const finishResolve = (value) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            resolve(value);
        };
        const onAbort = () => {
            const error = new Error("ACCOUNT_SESSION_ABORTED");
            error.name = "AbortError";
            finishReject(error);
        };
        const request = (method, params, timeoutMs = STATUS_TIMEOUT_MS) => {
            const id = nextId++;
            return new Promise((requestResolve, requestReject) => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    requestReject(new Error(`ACCOUNT_SESSION_ACP_TIMEOUT:${method}`));
                }, timeoutMs);
                pending.set(id, {
                    resolve: requestResolve,
                    reject: requestReject,
                    timer
                });
                proc.stdin.write(JSON.stringify({
                    jsonrpc: "2.0",
                    id,
                    method,
                    params
                }) + "\n");
            });
        };
        abortSignal
            ?.addEventListener("abort", onAbort, {
            once: true
        });
        proc.stderr.on("data", (chunk) => {
            stderr =
                appendCapture(stderr, chunk);
        });
        proc.once("error", (error) => finishReject(error instanceof Error
            ? error
            : new Error(String(error))));
        proc.once("exit", (code) => {
            if (!settled) {
                finishReject(new Error(`ACCOUNT_SESSION_CLI_FAILED:xai:${code ?? "signal"}:${stderr
                    .trim()
                    .slice(-800)
                    .replace(/[\r\n]+/g, " ")}`));
            }
        });
        rl.on("line", (line) => {
            let message;
            try {
                message =
                    JSON.parse(line);
            }
            catch {
                return;
            }
            if (message.method ===
                "session/update") {
                const params = message.params &&
                    typeof message.params ===
                        "object"
                    ? message.params
                    : null;
                const update = params?.update &&
                    typeof params.update ===
                        "object"
                    ? params.update
                    : null;
                const content = update?.content &&
                    typeof update.content ===
                        "object"
                    ? update.content
                    : null;
                if (update
                    ?.sessionUpdate ===
                    "agent_message_chunk" &&
                    typeof content?.text ===
                        "string") {
                    text +=
                        content.text;
                }
                return;
            }
            const id = typeof message.id ===
                "number"
                ? message.id
                : null;
            if (id === null) {
                return;
            }
            const pendingRequest = pending.get(id);
            if (!pendingRequest) {
                return;
            }
            pending.delete(id);
            clearTimeout(pendingRequest.timer);
            if (message.error &&
                typeof message.error ===
                    "object") {
                const error = message.error;
                pendingRequest.reject(new Error(typeof error.message ===
                    "string"
                    ? error.message
                    : "ACCOUNT_SESSION_ACP_ERROR"));
            }
            else {
                pendingRequest.resolve(message.result &&
                    typeof message.result ===
                        "object"
                    ? message.result
                    : {});
            }
        });
        void (async () => {
            try {
                const init = await request("initialize", {
                    protocolVersion: 1,
                    clientCapabilities: {}
                });
                const authMethods = Array.isArray(init.authMethods)
                    ? init.authMethods
                    : [];
                const hasCachedToken = authMethods.some((item) => item &&
                    typeof item ===
                        "object" &&
                    item.id ===
                        "cached_token");
                if (!hasCachedToken) {
                    finishResolve({
                        authenticated: false
                    });
                    return;
                }
                await request("authenticate", {
                    methodId: "cached_token",
                    _meta: {
                        headless: true
                    }
                }, STATUS_TIMEOUT_MS);
                if (prompt === null) {
                    finishResolve({
                        authenticated: true
                    });
                    return;
                }
                const agentCapabilities = init.agentCapabilities &&
                    typeof init.agentCapabilities ===
                        "object" &&
                    !Array.isArray(init.agentCapabilities)
                    ? init.agentCapabilities
                    : null;
                const supportsSessionLoad = agentCapabilities
                    ?.loadSession === true;
                let sessionId = "";
                if (resumeSessionId &&
                    supportsSessionLoad) {
                    try {
                        await request("session/load", {
                            sessionId: resumeSessionId,
                            cwd,
                            mcpServers: []
                        }, STATUS_TIMEOUT_MS);
                        sessionId =
                            resumeSessionId;
                        text = "";
                    }
                    catch {
                        // Older ACP builds or stale IDs fall back to a fresh session.
                        sessionId = "";
                    }
                }
                if (!sessionId) {
                    const session = await request("session/new", {
                        cwd,
                        mcpServers: []
                    });
                    sessionId =
                        typeof session.sessionId ===
                            "string"
                            ? session.sessionId
                            : "";
                }
                if (!sessionId) {
                    throw new Error("ACCOUNT_SESSION_ACP_SESSION_INVALID");
                }
                await request("session/prompt", {
                    sessionId,
                    prompt: [
                        {
                            type: "text",
                            text: prompt
                        }
                    ]
                }, COMMAND_TIMEOUT_MS);
                let lastLength = -1;
                let stableChecks = 0;
                while (stableChecks < 2) {
                    await new Promise((waitResolve) => setTimeout(waitResolve, 150));
                    if (text.length ===
                        lastLength) {
                        stableChecks += 1;
                    }
                    else {
                        lastLength =
                            text.length;
                        stableChecks = 0;
                    }
                }
                const finalText = text.trim();
                if (!finalText) {
                    throw new Error("ACCOUNT_SESSION_EMPTY_RESPONSE:xai");
                }
                finishResolve({
                    authenticated: true,
                    text: finalText,
                    sessionId
                });
            }
            catch (error) {
                finishReject(error instanceof Error
                    ? error
                    : new Error(String(error)));
            }
        })();
    });
}
export function accountSessionModelId(provider) {
    return ACCOUNT_MODEL_IDS[provider];
}
export function isAccountSessionModel(provider, model) {
    return model === ACCOUNT_MODEL_IDS[provider] ||
        accountSessionClientModel(provider, model) !== null;
}
/**
 * The client model of "account/<provider>/<model>"; null for the default
 * (the client decides) or a model not offered for the account session.
 */
export function accountSessionClientModel(provider, model) {
    const prefix = `account/${provider}/`;
    if (!model.startsWith(prefix))
        return null;
    const id = model.slice(prefix.length);
    return (ACCOUNT_SESSION_MODELS[provider] ?? []).some((item) => item.id === id)
        ? id
        : null;
}
// Jeden obiekt JSON od pozycji `from` (nawiasy liczone poza napisami); null, gdy niedomknięty.
function jsonObjectAt(text, from) {
    const open = text.indexOf("{", from);
    if (open < 0 || text.slice(from, open).trim())
        return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = open; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === "\\")
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"')
            inString = true;
        else if (char === "{")
            depth += 1;
        else if (char === "}" && --depth === 0)
            return { json: text.slice(open, index + 1), end: index + 1 };
    }
    return null;
}
// Model proszony o wszystkie wywołania w jednej rundzie bywa, że zapisuje kilka linii
// z prefiksem (każda z własnym JSON) albo dopisuje tekst po JSON; wywołania ze wszystkich
// bloków są łączone, tekst poza blokami pomijany.
export function parseToolCalls(text) {
    const normalized = text
        .trim()
        .replace(/^\`\`\`(?:json)?[ \t]*$/gim, "")
        .trim();
    if (!normalized.startsWith(TOOL_SENTINEL)) {
        return null;
    }
    const calls = [];
    let at = 0;
    while ((at = normalized.indexOf(TOOL_SENTINEL, at)) >= 0) {
        const block = jsonObjectAt(normalized, at + TOOL_SENTINEL.length);
        if (!block)
            throw new Error("ACCOUNT_SESSION_TOOL_PROTOCOL_INVALID");
        let parsed;
        try {
            parsed = JSON.parse(block.json);
        }
        catch {
            throw new Error("ACCOUNT_SESSION_TOOL_PROTOCOL_INVALID");
        }
        if (!Array.isArray(parsed.calls)) {
            throw new Error("ACCOUNT_SESSION_TOOL_PROTOCOL_INVALID");
        }
        calls.push(...parsed.calls);
        at = block.end;
    }
    const parsed = { calls };
    const seen = new Set();
    return parsed.calls.map((item, index) => {
        if (!item ||
            typeof item !== "object" ||
            Array.isArray(item)) {
            throw new Error("ACCOUNT_SESSION_TOOL_PROTOCOL_INVALID");
        }
        const record = item;
        const name = typeof record.name === "string"
            ? record.name
            : "";
        let id = typeof record.id === "string" &&
            record.id
            ? record.id
            : `account_tool_${index + 1}`;
        // Kolejne bloki zwykle znów zaczynają od "call_1".
        if (seen.has(id))
            id = `${id}_${index + 1}`;
        seen.add(id);
        const input = record.input &&
            typeof record.input === "object" &&
            !Array.isArray(record.input)
            ? record.input
            : {};
        if (!name) {
            throw new Error("ACCOUNT_SESSION_TOOL_PROTOCOL_INVALID");
        }
        return {
            id,
            name,
            input
        };
    });
}
/**
 * Claude CLI input: plain text, or with images one stream-json user message
 * (text block + image blocks) and the matching --input-format.
 */
export function claudeInput(prompt, images = []) {
    if (!images.length)
        return { stdin: prompt, args: [] };
    return {
        stdin: JSON.stringify({
            type: "user",
            message: {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    ...images.map((image) => ({
                        type: "image",
                        source: { type: "base64", media_type: image.mediaType, data: image.data }
                    }))
                ]
            }
        }) + "\n",
        args: ["--input-format", "stream-json"]
    };
}
export function messageImages(params) {
    return params.messages.flatMap((message) => message.images ?? []);
}
/** The Lex instructions and conversation for a native corpus run (sent on stdin). */
export function buildCorpusPrompt(params) {
    return [
        "You are the semantic model inside Lex Machina.",
        "Lex Machina supplies the complete conversation context for this turn. Do not read or infer context from any separate host-session history.",
        "",
        "SYSTEM:",
        params.systemPrompt,
        "",
        "CONVERSATION:",
        params.messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n"),
        "",
        "Continue the conversation now."
    ].join("\n");
}
function buildAccountPrompt(params, toolTranscript) {
    const messages = params.messages
        .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
        .join("\n\n");
    const toolSchemas = params.tools?.length
        ? JSON.stringify(params.tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters
        })))
        : "[]";
    const toolProtocol = params.tools?.length
        ? [
            "Lex Machina runtime tools are available only through the protocol below.",
            "Do not use any local CLI, filesystem, shell, browser, web-search, plugin or MCP tools.",
            "If a Lex runtime tool is required, output ONLY one line beginning with:",
            `${TOOL_SENTINEL}{"calls":[{"id":"call_1","name":"tool_name","input":{}}]}`,
            "Use only tool names listed in LEX_RUNTIME_TOOLS.",
            // Each round of tool calls is a separate CLI run with the whole context, so
            // independent reads and checks belong in one round (router, SKILL.md, modules,
            // verification of unrelated provisions); only calls that depend on a result wait.
            "Every tool round starts a new model run and costs the user tens of seconds. Put ALL tool calls you already know you need into ONE line with the prefix written once (several entries in one \"calls\" array, never a second prefix or text after the JSON): e.g. the router together with the SKILL.md and modules you expect, or verification of several independent provisions. Make a further round only for calls that depend on results you have not seen yet.",
            "Do not repeat a search or read whose result is already in LEX_RUNTIME_TOOL_TRANSCRIPT. Verify only the provisions you will actually cite in the answer.",
            "After tool results are supplied, continue the task. When no more tools are needed, return the final answer normally.",
            `LEX_RUNTIME_TOOLS=${toolSchemas}`
        ].join("\n")
        : [
            "No Lex runtime tools are available for this turn.",
            "Do not use any local CLI, filesystem, shell, browser, web-search, plugin or MCP tools."
        ].join("\n");
    return [
        "You are the semantic model inside Lex Machina.",
        "The application, not this CLI, owns privacy gates, legal-source verification and tool execution.",
        "Lex Machina supplies the complete conversation context for this turn. Do not read or infer context from any separate host-session history.",
        "Use only the current Lex Machina system instructions and conversation.",
        toolProtocol,
        "",
        "SYSTEM:",
        params.systemPrompt,
        "",
        "CONVERSATION:",
        messages,
        ...(toolTranscript.length
            ? [
                "",
                "LEX_RUNTIME_TOOL_TRANSCRIPT:",
                toolTranscript.join("\n\n")
            ]
            : []),
        "",
        "Continue the conversation now."
    ].join("\n");
}
export class AccountSessionManager {
    anthropicInteractiveLoginConfirmed = false;
    setAnthropicOAuthToken(token) {
        const normalized = token.trim();
        if (normalized.length < 32 ||
            normalized.length > 16_384 ||
            /[\r\n]/.test(normalized)) {
            throw new Error("INVALID_CLAUDE_OAUTH_TOKEN");
        }
        replaceAnthropicOAuthToken(normalized);
    }
    clearAnthropicOAuthToken() {
        replaceAnthropicOAuthToken(null);
    }
    hasAnthropicOAuthToken() {
        return Boolean(currentAnthropicOAuthToken());
    }
    async status(provider) {
        const command = CLI_NAMES[provider];
        const executable = await resolveAccountExecutable(provider);
        if (!executable) {
            return {
                provider,
                command,
                installed: false,
                authenticated: false,
                installHint: installHint(provider),
                resumeMode: accountSessionResumeMode(provider),
                ...(provider === "anthropic"
                    ? {
                        oauthTokenConfigured: this.hasAnthropicOAuthToken()
                    }
                    : {})
            };
        }
        if (provider === "google") {
            return {
                provider,
                command,
                installed: true,
                authenticated: geminiGoogleLoginPresent(),
                installHint: installHint(provider),
                resumeMode: accountSessionResumeMode(provider)
            };
        }
        let result;
        try {
            if (provider === "openai") {
                result = await runCli(provider, ["login", "status"], undefined, STATUS_TIMEOUT_MS);
            }
            else if (provider === "anthropic") {
                // Probe the resolved client directly: a status poll must never
                // trigger the (minutes-long) pinned-client provisioning.
                result = await runDirect(nativeClaudeExecutable(executable), ["auth", "status"], undefined, accountEnvironment(provider), STATUS_TIMEOUT_MS);
            }
            else {
                const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "lex-grok-auth-"));
                try {
                    const probe = await runGrokAcp(null, workDir);
                    result = {
                        code: probe.authenticated
                            ? 0
                            : 1,
                        stdout: "",
                        stderr: ""
                    };
                }
                finally {
                    await fsp.rm(workDir, {
                        recursive: true,
                        force: true
                    }).catch(() => { });
                }
            }
        }
        catch {
            result = {
                code: 1,
                stdout: "",
                stderr: ""
            };
        }
        const authenticated = provider === "openai"
            ? (openAiChatGptAuthenticated(result) ||
                (result.code === 0 &&
                    await storedCodexChatGptAuthPresent()))
            : provider ===
                "anthropic"
                ? (claudeAutomationCredentialMode(accountEnvironment("anthropic")) !==
                    "INTERACTIVE" ||
                    this
                        .anthropicInteractiveLoginConfirmed ||
                    claudeSubscriptionAuthenticated(result))
                : result.code === 0;
        return {
            provider,
            command,
            installed: true,
            authenticated,
            installHint: installHint(provider),
            resumeMode: accountSessionResumeMode(provider),
            ...(provider === "anthropic"
                ? {
                    oauthTokenConfigured: this.hasAnthropicOAuthToken()
                }
                : {})
        };
    }
    async statusAll() {
        return Promise.all(["openai", "anthropic", "xai", "google"]
            .map((provider) => this.status(provider)));
    }
    provisionJobs = new Map();
    // Downloads the pinned client before login as a background job the UI
    // polls: a first Gemini CLI / Grok Build install takes minutes, and the user
    // must see its stage instead of a silent "Logowanie…" until the window opens.
    startProvision(provider) {
        const current = this.provisionJobs.get(provider);
        if (current &&
            current.progress.stage !== "READY" &&
            current.progress.stage !== "FAILED") {
            return this.provisionProgress(provider);
        }
        const startedMs = Date.now();
        const progress = {
            provider,
            stage: "CHECKING",
            startedAt: new Date(startedMs).toISOString(),
            elapsedMs: 0,
            packagesFetched: 0,
            bytesOnDisk: 0
        };
        const job = { startedMs, progress };
        this.provisionJobs.set(provider, job);
        provisionListeners.set(provider, (tick) => {
            Object.assign(job.progress, tick);
        });
        void (async () => {
            try {
                const executable = await ensureAccountExecutable(provider);
                if (!executable) {
                    throw new Error(`ACCOUNT_SESSION_CLI_NOT_INSTALLED:${provider}`);
                }
                job.progress.stage = "VERIFYING";
                job.progress.status = await this.status(provider);
                job.progress.stage = "READY";
            }
            catch (error) {
                job.progress.stage = "FAILED";
                job.progress.error = sanitizeAccountCliFailureDetail(error instanceof Error ? error.message : String(error));
            }
            finally {
                provisionListeners.delete(provider);
            }
        })();
        return this.provisionProgress(provider);
    }
    provisionProgress(provider) {
        const job = this.provisionJobs.get(provider);
        if (!job) {
            return { provider, stage: "IDLE", elapsedMs: 0, packagesFetched: 0, bytesOnDisk: 0 };
        }
        return {
            ...job.progress,
            elapsedMs: Date.now() - job.startedMs
        };
    }
    async login(provider) {
        const current = await this.status(provider);
        if (current.installed &&
            current.authenticated) {
            return current;
        }
        if (provider === "google") {
            await selectGeminiGoogleLogin();
        }
        const args = accountLoginArgs(provider);
        const runLogin = (loginArgs) => accountLoginLaunchMode(provider) ===
            "VISIBLE_TERMINAL"
            ? runVisibleWindowsLogin(provider, loginArgs, AUTH_TIMEOUT_MS)
            : runCli(provider, loginArgs, undefined, AUTH_TIMEOUT_MS);
        let result = await runLogin(args);
        if (result.code !== 0) {
            const fallbackArgs = accountLoginFallbackArgs(provider);
            if (fallbackArgs) {
                result =
                    await runLogin(fallbackArgs);
            }
        }
        if (result.code !== 0) {
            throw normalizeCliFailure(provider, result);
        }
        if (provider ===
            "anthropic") {
            // The visible official Claude Code login process is authoritative.
            // Some releases do not expose a compatible `auth status` command or
            // emit status text that cannot be parsed reliably. The real Claude
            // invocation remains the end-to-end authentication check.
            this
                .anthropicInteractiveLoginConfirmed =
                true;
        }
        const status = await this.status(provider);
        if (!status.authenticated) {
            throw new Error(`ACCOUNT_SESSION_NOT_SUBSCRIPTION_AUTH:${provider}`);
        }
        return status;
    }
    /**
     * One Claude run for an AUTO legal turn: the model reads skills and their
     * subfolders itself and calls the Lex tools over MCP, all in one process,
     * instead of one CLI start and a full re-sent prompt per tool round.
     */
    async runClaudeWithCorpus(args) {
        await assertSubscriptionAccount("anthropic", args.abortSignal);
        const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "lex-account-corpus-"));
        const bridge = await startToolBridge(args.runTools, args.onToolCall);
        try {
            const schemaFile = path.join(workDir, "tools.json");
            await fsp.writeFile(schemaFile, JSON.stringify(args.tools.map((tool) => ({
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters
            }))), { mode: 0o600 });
            const mcpConfig = path.join(workDir, "mcp.json");
            await fsp.writeFile(mcpConfig, JSON.stringify({
                mcpServers: {
                    lex: {
                        type: "stdio",
                        command: process.execPath,
                        args: [lexToolsMcpServerPath()],
                        env: {
                            LEX_TOOL_PIPE: bridge.pipe,
                            LEX_TOOL_TOKEN: bridge.token,
                            LEX_TOOL_SCHEMAS: schemaFile
                        }
                    }
                }
            }), { mode: 0o600 });
            const systemPrompt = "You are the semantic model inside Lex Machina. Lex Machina owns privacy gates and legal-source verification. " +
                "Your working directory is the Lex legal skill corpus: read skills and their modules with Read, Glob and Grep; they are read-only. " +
                "Use the mcp__lex tools for legal verification, case law and legal sources. Do not access anything else. " +
                "A resumed host session is continuity context only: never reuse facts from earlier host turns unless they are also in the current Lex Machina request.";
            const input = claudeInput(args.prompt, args.images);
            const run = (tail) => runCli("anthropic", claudeCorpusArgs(systemPrompt, mcpConfig, [
                ...input.args,
                ...(args.clientModel ? ["--model", args.clientModel] : []),
                ...tail
            ]), input.stdin, COMMAND_TIMEOUT_MS, args.corpus.root, args.abortSignal, { settleOnStdout: claudeResultReady, firstOutputTimeoutMs: CLAUDE_FIRST_OUTPUT_TIMEOUT_MS });
            let result = null;
            const savedSessionId = args.fresh ? null : await readAccountSessionId("anthropic", args.continuityKey);
            if (savedSessionId) {
                result = await run(["--resume", savedSessionId]);
                const outcome = parseClaudeResult(result.stdout);
                if (result.code !== 0 || outcome?.isError) {
                    const detail = `${result.stderr}\n${result.stdout}\n${outcome?.text ?? ""}`;
                    if (!isMissingResumableSessionMessage(detail))
                        throw normalizeCliFailure("anthropic", result);
                    await clearAccountSessionId("anthropic", args.continuityKey);
                    result = null;
                }
            }
            if (!result)
                result = await run([]);
            const parsed = parseClaudeResult(result.stdout);
            if (result.code !== 0 || !parsed || parsed.isError) {
                throw normalizeCliFailure("anthropic", {
                    ...result,
                    code: result.code === 0 ? 1 : result.code,
                    stderr: [result.stderr, parsed?.text ?? ""].filter(Boolean).join("\n")
                });
            }
            reportNativeReads(args.corpus, result.stdout);
            if (parsed.sessionId && !args.fresh) {
                await writeAccountSessionId("anthropic", parsed.sessionId, args.continuityKey);
            }
            return parsed.text;
        }
        finally {
            await bridge.close().catch(() => undefined);
            await fsp.rm(workDir, { recursive: true, force: true }).catch(() => { });
        }
    }
    async runText(provider, prompt, abortSignal, continuityKey, 
    // Claude only (stream-json input); other CLIs get the text.
    images = [], 
    // A model chosen for the account session; null lets the client decide.
    clientModel = null, 
    // Fresh host session: no resume, no takeover of the latest CLI session, no
    // recorded thread (self-contained router and document-generator calls).
    fresh = false) {
        const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "lex-account-session-"));
        const allowExternalTakeover = !fresh &&
            (!continuityKey ||
                !await hasPinnedAccountSession(provider));
        try {
            if (provider === "openai" ||
                provider === "anthropic") {
                await assertSubscriptionAccount(provider, abortSignal);
            }
            if (provider === "openai") {
                const outputPath = path.join(workDir, "last-message.txt");
                const preferredModel = clientModel ??
                    codexAccountModel();
                const candidateModels = [
                    preferredModel,
                    "gpt-5.6-luna",
                    "gpt-5.5",
                    "gpt-5.4-mini"
                ].filter((value, index, all) => all.indexOf(value) === index);
                let result = null;
                let lastFailure = null;
                let savedSessionId = fresh
                    ? null
                    : await readAccountSessionId(provider, continuityKey);
                const runCodex = async (candidateModel, tail) => {
                    await fsp.rm(outputPath, {
                        force: true
                    }).catch(() => { });
                    return runCli(provider, codexExecArgs(workDir, outputPath, candidateModel, tail), prompt, COMMAND_TIMEOUT_MS, workDir, abortSignal);
                };
                for (const candidateModel of candidateModels) {
                    let attempt = null;
                    if (savedSessionId) {
                        const resumed = await runCodex(candidateModel, [
                            "resume",
                            savedSessionId,
                            "-"
                        ]);
                        if (resumed.code === 0) {
                            attempt =
                                resumed;
                        }
                        else {
                            const detail = resumed.stderr +
                                "\n" +
                                resumed.stdout;
                            if (isMissingResumableSessionMessage(detail)) {
                                await clearAccountSessionId(provider, continuityKey);
                                savedSessionId =
                                    null;
                            }
                            else {
                                const failure = normalizeCliFailure(provider, resumed);
                                lastFailure =
                                    failure;
                                if (failure.message
                                    .startsWith("ACCOUNT_SESSION_MODEL_UNSUPPORTED:")) {
                                    continue;
                                }
                                throw failure;
                            }
                        }
                    }
                    if (!attempt &&
                        allowExternalTakeover) {
                        const latest = await runCodex(candidateModel, [
                            "resume",
                            "--last",
                            "--all",
                            "-"
                        ]);
                        if (latest.code === 0) {
                            attempt =
                                latest;
                        }
                        else {
                            const detail = latest.stderr +
                                "\n" +
                                latest.stdout;
                            if (!isMissingResumableSessionMessage(detail)) {
                                const failure = normalizeCliFailure(provider, latest);
                                lastFailure =
                                    failure;
                                if (failure.message
                                    .startsWith("ACCOUNT_SESSION_MODEL_UNSUPPORTED:")) {
                                    continue;
                                }
                                throw failure;
                            }
                        }
                    }
                    if (!attempt) {
                        attempt =
                            await runCodex(candidateModel, ["-"]);
                    }
                    if (attempt.code !== 0) {
                        const failure = normalizeCliFailure(provider, attempt);
                        lastFailure =
                            failure;
                        if (failure.message
                            .startsWith("ACCOUNT_SESSION_MODEL_UNSUPPORTED:")) {
                            continue;
                        }
                        throw failure;
                    }
                    result =
                        attempt;
                    break;
                }
                if (!result) {
                    throw (lastFailure ??
                        new Error("ACCOUNT_SESSION_CLI_FAILED:openai:1"));
                }
                const threadId = parseCodexThreadId(result.stdout);
                if (threadId && !fresh) {
                    await writeAccountSessionId(provider, threadId, continuityKey);
                }
                try {
                    const finalText = await fsp.readFile(outputPath, "utf8");
                    if (finalText.trim()) {
                        return finalText.trim();
                    }
                }
                catch {
                    // Fall through to JSONL parsing.
                }
                const finalText = parseCodexFinalText(result.stdout);
                if (finalText) {
                    return finalText;
                }
                throw new Error("ACCOUNT_SESSION_EMPTY_RESPONSE:openai");
            }
            if (provider ===
                "anthropic") {
                const lexSystemPrompt = "You are the semantic model inside Lex Machina. Lex Machina owns privacy gates, legal-source verification and all tool execution. Current Lex Machina instructions override prior host-session instructions. A resumed host session is continuity context only: never reuse, reveal or infer facts from earlier host turns unless those facts are also present in the current Lex Machina request. Do not access local files, external services or tools.";
                const input = claudeInput(prompt, images);
                const commonArgs = claudeHeadlessArgs(lexSystemPrompt, [
                    ...input.args,
                    ...(clientModel
                        ? ["--model", clientModel]
                        : [])
                ]);
                const hostCwd = workDir;
                const runClaude = async (tail) => {
                    const run = await runCli(provider, [
                        ...commonArgs,
                        ...tail
                    ], input.stdin, COMMAND_TIMEOUT_MS, hostCwd, abortSignal, {
                        settleOnStdout: claudeResultReady,
                        firstOutputTimeoutMs: CLAUDE_FIRST_OUTPUT_TIMEOUT_MS
                    });
                    // An early-settled error result must still take the failure path
                    // (e.g. stale --resume id falls back to a fresh Lex session).
                    const outcome = parseClaudeResult(run.stdout);
                    if (outcome?.isError) {
                        return {
                            code: run.code === 0
                                ? 1
                                : run.code,
                            stdout: "",
                            stderr: [
                                run.stderr.trim(),
                                outcome.text
                            ]
                                .filter(Boolean)
                                .join("\n")
                        };
                    }
                    return run;
                };
                let result = null;
                const savedSessionId = fresh
                    ? null
                    : await readAccountSessionId(provider, continuityKey);
                if (savedSessionId) {
                    result =
                        await runClaude([
                            "--resume",
                            savedSessionId
                        ]);
                    if (result.code !== 0) {
                        const detail = result.stderr +
                            "\n" +
                            result.stdout;
                        if (isMissingResumableSessionMessage(detail)) {
                            await clearAccountSessionId(provider, continuityKey);
                            result =
                                null;
                        }
                        else {
                            throw normalizeCliFailure(provider, result);
                        }
                    }
                }
                if (!result) {
                    result =
                        await runClaude([]);
                }
                if (result.code !== 0) {
                    throw normalizeCliFailure(provider, result);
                }
                const parsed = parseClaudeResult(result.stdout);
                if (!parsed) {
                    throw new Error("ACCOUNT_SESSION_EMPTY_RESPONSE:anthropic");
                }
                if (parsed.sessionId && !fresh) {
                    await writeAccountSessionId(provider, parsed.sessionId, continuityKey);
                }
                return parsed.text;
            }
            if (provider === "google") {
                // Headless Gemini CLI: the prompt on stdin, JSON result, read-only
                // approval mode in an empty temporary workspace; never resumes a
                // session (Lex sends the whole context itself).
                const result = await runCli(provider, [
                    "-p",
                    "",
                    "-o",
                    "json",
                    "--approval-mode",
                    "plan",
                    "--skip-trust",
                    ...(clientModel ? ["-m", clientModel] : [])
                ], prompt, COMMAND_TIMEOUT_MS, workDir, abortSignal);
                const parsed = parseGeminiResult(result.stdout);
                if (parsed.error?.code === 41 ||
                    /auth method|login required|not logged in|oauth/i.test(parsed.error?.message ?? "")) {
                    throw new Error("ACCOUNT_SESSION_NOT_AUTHENTICATED:google");
                }
                if (parsed.error) {
                    throw normalizeCliFailure(provider, {
                        code: result.code === 0 ? 1 : result.code,
                        stdout: "",
                        stderr: parsed.error.message
                    });
                }
                if (result.code !== 0 && !parsed.text) {
                    throw normalizeCliFailure(provider, result);
                }
                if (!parsed.text?.trim()) {
                    throw new Error("ACCOUNT_SESSION_EMPTY_RESPONSE:google");
                }
                return parsed.text.trim();
            }
            const savedSessionId = fresh
                ? null
                : await readAccountSessionId(provider, continuityKey);
            const resumeSessionId = savedSessionId ??
                (allowExternalTakeover
                    ? await discoverLatestGrokSessionId()
                    : null);
            let grok;
            try {
                grok =
                    await runGrokAcp(prompt, workDir, abortSignal, resumeSessionId);
            }
            catch (error) {
                throw codedGrokFailure(error);
            }
            if (!grok.authenticated) {
                throw new Error("ACCOUNT_SESSION_NOT_AUTHENTICATED:xai");
            }
            if (!grok.text) {
                throw new Error("ACCOUNT_SESSION_EMPTY_RESPONSE:xai");
            }
            if (grok.sessionId && !fresh) {
                await writeAccountSessionId(provider, grok.sessionId, continuityKey);
            }
            return grok.text;
        }
        finally {
            await fsp.rm(workDir, {
                recursive: true,
                force: true
            }).catch(() => { });
        }
    }
}
export async function streamAccountSession(manager, provider, params) {
    const allowedTools = new Set((params.tools ?? [])
        .map((tool) => tool.function.name));
    const toolTranscript = [];
    if (provider === "anthropic" && params.nativeCorpus && params.runTools) {
        const text = await manager.runClaudeWithCorpus({
            prompt: buildCorpusPrompt(params),
            images: messageImages(params),
            corpus: params.nativeCorpus,
            tools: params.tools ?? [],
            runTools: params.runTools,
            ...(params.callbacks?.onToolCallStart ? { onToolCall: params.callbacks.onToolCallStart } : {}),
            ...(params.abortSignal ? { abortSignal: params.abortSignal } : {}),
            ...(params.continuityKey ? { continuityKey: params.continuityKey } : {}),
            clientModel: accountSessionClientModel(provider, params.model),
            fresh: params.accountContinuity === "none"
        });
        if (!text.trim())
            throw new Error("ACCOUNT_SESSION_EMPTY_RESPONSE:anthropic");
        params.callbacks?.onContentDelta?.(text);
        return { fullText: text };
    }
    const maxIterations = Math.max(1, Math.min(params.maxIterations ?? 10, 12));
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const runOnce = () => manager.runText(provider, buildAccountPrompt(params, toolTranscript), params.abortSignal, params.continuityKey, provider === "anthropic" ? messageImages(params) : [], accountSessionClientModel(provider, params.model), params.accountContinuity === "none");
        let output;
        for (let attempt = 0;; attempt += 1) {
            try {
                output = await runOnce();
                break;
            }
            catch (error) {
                const wait = RATE_LIMIT_BACKOFF_MS[attempt];
                if (wait === undefined || !isTransientRateLimit(error) || params.abortSignal?.aborted) {
                    throw error;
                }
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, wait);
                    params.abortSignal?.addEventListener("abort", () => {
                        clearTimeout(timer);
                        resolve();
                    }, { once: true });
                });
                if (params.abortSignal?.aborted)
                    throw error;
            }
        }
        const calls = parseToolCalls(output);
        if (!calls) {
            params.callbacks?.onContentDelta?.(output);
            return {
                fullText: output
            };
        }
        if (calls.length === 0 ||
            !params.runTools) {
            throw new Error("ACCOUNT_SESSION_TOOL_PROTOCOL_UNAVAILABLE");
        }
        for (const call of calls) {
            if (!allowedTools.has(call.name)) {
                throw new Error(`ACCOUNT_SESSION_UNKNOWN_TOOL:${call.name}`);
            }
            params.callbacks?.onToolCallStart?.(call);
        }
        const results = await params.runTools(calls);
        for (const call of calls) {
            const result = results.find((item) => item.tool_use_id ===
                call.id);
            if (!result) {
                throw new Error(`ACCOUNT_SESSION_TOOL_RESULT_MISSING:${call.id}`);
            }
            toolTranscript.push([
                `TOOL_CALL ${call.id} ${call.name}`,
                JSON.stringify(call.input),
                `TOOL_RESULT ${call.id}`,
                result.content
            ].join("\n"));
        }
    }
    throw new Error("ACCOUNT_SESSION_MAX_TOOL_ITERATIONS");
}
