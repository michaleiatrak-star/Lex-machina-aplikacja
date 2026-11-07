import fs from "node:fs";
import path from "node:path";
import { lexMcpPackagePath } from "./lex-mcp-connectors.js";
/**
 * The standalone llama.cpp server with tools on macOS: what configure-llama-native-web.ps1 and
 * start-llama-native-agent.ps1 set up on Windows. llama-server's own Web UI and agent then use the
 * MCP tools (web research, the legal skills, local OCR and anonymization of documents, the Lex
 * Machina legal connectors) directly, without the Lex runtime. The application itself does not
 * use this mode; the user starts it with start-llama-native-agent.sh.
 */
export const LEX_MCP_SERVERS = ["isap", "eurlex", "saos", "cbosa", "krs", "wl", "nbp", "eureka", "sudop", "uodo"];
const BOOTSTRAP_FILES = {
    web: "llama-web-mcp.py",
    legal: "llama-legal-skills-mcp.py",
    documents: "llama-local-documents-mcp.py",
    mistral: "mistral-nemo-web-grounded.jinja",
    bielik: "bielik-web-grounded.jinja",
    policy: "llama-native-system-message.txt"
};
/** Writes the MCP tools, the Web UI settings and the launcher into the local AI folder. */
export function writeNativeAgentMacos(options) {
    const bootstrap = path.join(options.runtimeRoot, "bootstrap");
    const source = (name) => {
        const file = path.join(bootstrap, name);
        if (!fs.existsSync(file))
            throw new Error(`LLAMA_NATIVE_SOURCE_MISSING:${name}`);
        return file;
    };
    const skillsRoot = path.join(options.runtimeRoot, "corpus");
    // The chosen jurisdiction's connectors (field `konektory`), as the application's own MCP client.
    const lexMcp = lexMcpPackagePath(skillsRoot);
    const uodoServer = path.join(options.runtimeRoot, "app", "dist", "uodo-official-mcp-server.js");
    for (const required of [lexMcp, uodoServer, options.python, options.node]) {
        if (!fs.existsSync(required))
            throw new Error(`LLAMA_NATIVE_MCP_RUNTIME_TOOL_MISSING:${required}`);
    }
    const skills = fs
        .readdirSync(skillsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md"))).length;
    if (skills !== 32)
        throw new Error(`LLAMA_NATIVE_LEGAL_SKILL_COUNT_INVALID:expected=32:actual=${skills}`);
    const root = path.resolve(options.localRoot);
    const mcpRoot = path.join(root, "mcp");
    const vaults = path.join(root, "privacy-vaults");
    fs.mkdirSync(mcpRoot, { recursive: true });
    fs.mkdirSync(vaults, { recursive: true, mode: 0o700 });
    const copy = (name, target) => {
        fs.copyFileSync(source(name), target);
        return target;
    };
    const webScript = copy(BOOTSTRAP_FILES.web, path.join(mcpRoot, BOOTSTRAP_FILES.web));
    const legalScript = copy(BOOTSTRAP_FILES.legal, path.join(mcpRoot, BOOTSTRAP_FILES.legal));
    const documentsScript = copy(BOOTSTRAP_FILES.documents, path.join(mcpRoot, BOOTSTRAP_FILES.documents));
    copy(BOOTSTRAP_FILES.mistral, path.join(root, BOOTSTRAP_FILES.mistral));
    copy(BOOTSTRAP_FILES.bielik, path.join(root, BOOTSTRAP_FILES.bielik));
    const connectorPath = [path.dirname(options.node), path.dirname(options.python), process.env.PATH ?? "/usr/bin:/bin"].join(":");
    const servers = {
        web: { command: options.python, args: ["-X", "utf8", webScript], timeout_ms: 45000, env: { PYTHONUTF8: "1", LLAMA_WEB_SEARCH_PROVIDER: "auto" } },
        legal: { command: options.python, args: ["-X", "utf8", legalScript, "--skills-root", skillsRoot], timeout_ms: 30000, env: { PYTHONUTF8: "1" } },
        documents: {
            command: options.python,
            args: ["-X", "utf8", documentsScript, "--runtime-root", options.runtimeRoot, "--vault-root", vaults, "--models-root", options.modelsRoot, "--python", options.python],
            timeout_ms: 900000,
            env: {
                PYTHONUTF8: "1",
                LEX_PADDLE_MODEL_DIR: path.join(options.modelsRoot, "paddle", "official_models"),
                STANZA_RESOURCES_DIR: path.join(options.modelsRoot, "stanza"),
                PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True"
            }
        },
        uodo_official: { command: options.node, args: [uodoServer], timeout_ms: 45000, env: { PATH: connectorPath } }
    };
    for (const server of LEX_MCP_SERVERS) {
        servers[server] = { command: options.node, args: [lexMcp, server], timeout_ms: 90000, env: { PATH: connectorPath } };
    }
    const mcpConfig = path.join(root, "mcp-servers.json");
    fs.writeFileSync(mcpConfig, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
    // The same policy as on Windows; the vault there is DPAPI, here the macOS keychain.
    const systemMessage = fs
        .readFileSync(source(BOOTSTRAP_FILES.policy), "utf8")
        .trim()
        .replace("Surowe wartości pozostają w sejfie DPAPI.", "Surowe wartości pozostają w sejfie zaszyfrowanym kluczem z pęku kluczy macOS.");
    const uiConfig = path.join(root, "llama-ui-config.json");
    fs.writeFileSync(uiConfig, `${JSON.stringify({ systemMessage, agenticMaxTurns: 12, alwaysShowToolCallContent: true, showSystemMessage: true, temperature: 0.3, top_p: 0.9 }, null, 2)}\n`);
    const launcher = path.join(root, "start-llama-native-agent.sh");
    fs.writeFileSync(launcher, LAUNCHER, { mode: 0o755 });
    fs.chmodSync(launcher, 0o755);
    return { launcher, mcpConfig, uiConfig };
}
// Reads config.json at start (model, context, engine): a model or context changed in the
// application is picked up without writing the launcher again.
const LAUNCHER = `#!/bin/bash
# llama.cpp server with its own Web UI and the Lex Machina MCP tools (no Lex runtime).
# Usage: start-llama-native-agent.sh [port]   (default 4318; open http://127.0.0.1:<port>)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
port="\${1:-4318}"
config="$here/config.json"
[ -f "$config" ] || { echo "LLAMA_NATIVE_CONFIG_MISSING:$config" >&2; exit 1; }
field() { /usr/bin/plutil -extract "$1" raw -o - "$config"; }
engine="$(field engine.executable)"
model="$(field model.path)"
model_id="$(field model.id)"
[ -x "$engine" ] || { echo "LLAMA_NATIVE_ENGINE_MISSING" >&2; exit 1; }
[ -f "$model" ] || { echo "LLAMA_NATIVE_MODEL_MISSING" >&2; exit 1; }
export LLAMA_ARG_AGENT=true
export LLAMA_ARG_CORS_ORIGINS=localhost
export LLAMA_ARG_MCP_SERVERS_CONFIG="$here/mcp-servers.json"
export LLAMA_ARG_UI_CONFIG_FILE="$here/llama-ui-config.json"
args=(--model "$model" --alias "$model_id" --host 127.0.0.1 --port "$port"
  --ctx-size "$(field context.requestedTokens)" --parallel 1 --jinja --flash-attn auto
  --cache-type-k q8_0 --cache-type-v q8_0 --n-gpu-layers 999)
case "$model_id" in
  local/mistral-nemo-12b-q4km) args+=(--chat-template-file "$here/mistral-nemo-web-grounded.jinja" --temp 0.3) ;;
  local/bielik-11b-v3-q4km) args+=(--chat-template-file "$here/bielik-web-grounded.jinja" --temp 0.3) ;;
esac
if [ "$(field context.extendedBeyondNative)" = "true" ]; then
  args+=(--rope-scaling yarn --rope-scale "$(field context.ropeScale)" --yarn-orig-ctx "$(field model.nativeContext)")
fi
exec "$engine" "\${args[@]}"
`;
