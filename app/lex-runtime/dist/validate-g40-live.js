import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LegalFederationToolRuntime } from "./legal-federation-tool-runtime.js";
import { LEX_MCP_SERVER_IDS, LexMcpConnectorStore } from "./lex-mcp-connectors.js";
// G40 — konektory MCP Lex Machina (audyt-systemu-v4/mcp-servers/dist/lex-mcp.mjs):
// każdy serwer bez klucza musi odpowiedzieć listą narzędzi; EUREKA dodatkowo zapytaniem na żywo.
const skillsRoot = process.env.LEX_SKILLS_PATH?.trim() ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Wersja rozwojowa rozpakowana");
async function main() {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-g40-"));
    const connectors = new LexMcpConnectorStore(skillsRoot, stateDir, path.join(stateDir, "brak-claude-desktop", "claude_desktop_config.json"));
    const runtime = new LegalFederationToolRuntime(undefined, undefined, connectors);
    const sources = LEX_MCP_SERVER_IDS.filter((source) => source !== "ceidg" || connectors.ceidgKey());
    try {
        const [coverage] = await runtime.runTools([
            { id: "g40-coverage", name: "federated_legal_coverage", input: {} }
        ]);
        if (!coverage || coverage.content.includes("SOURCE_UNAVAILABLE")) {
            throw new Error("G40_COVERAGE_FAILED");
        }
        for (const source of sources) {
            const [result] = await runtime.runTools([
                { id: `g40-${source}`, name: "list_federated_legal_sources", input: { sourceId: source } }
            ]);
            const payload = JSON.parse(result?.content ?? "{}");
            if (payload.status !== "OK" || !payload.tools?.length) {
                throw new Error(`G40_SOURCE_UNAVAILABLE:${source}:${(result?.content ?? "<missing>").slice(0, 800)}`);
            }
            console.log("G40_SOURCE_PASS", source, payload.tools.map((tool) => tool.name).join(","));
        }
        const [probe] = await runtime.runTools([
            { id: "g40-eureka-search", name: "search_federated_legal_sources", input: { source: "eureka", query: "VAT", limit: 1 } }
        ]);
        const probeStatus = JSON.parse(probe?.content ?? "{}").status;
        if (!probe || probeStatus === "SOURCE_UNAVAILABLE" || probeStatus === "ERROR") {
            throw new Error(`G40_EUREKA_LIVE_SEARCH_FAILED:${(probe?.content ?? "<missing>").slice(0, 800)}`);
        }
        console.log("G40_LIVE_QUERY_PASS", "eureka");
        console.log("G40_LEX_MCP_CONNECTORS_PASS", sources.join(","));
    }
    finally {
        await runtime.close();
        fs.rmSync(stateDir, { recursive: true, force: true });
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});
