// Sprawdza WYŁĄCZNIE protokół MCP (handshake, lista narzędzi) — bez zapytań sieciowych.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert";

const OCZEKIWANE = ["kio_pobierz", "kio_sprawdz_sygnature", "kio_szukaj"];
const transport = new StdioClientTransport({ command: "node", args: ["kio-mcp-server.js"] });
const client = new Client({ name: "test-protokolu", version: "2.0.0" });
await client.connect(transport);
const nazwy = (await client.listTools()).tools.map((t) => t.name).sort();
await client.close();
assert.deepStrictEqual(nazwy, [...OCZEKIWANE].sort(), `narzędzia: ${nazwy}`);
console.log(`PROTOKÓŁ MCP OK: ${nazwy.join(", ")}`);
console.log("Treść niesprawdzona tym testem — uruchom ../test_na_zywo.mjs");
