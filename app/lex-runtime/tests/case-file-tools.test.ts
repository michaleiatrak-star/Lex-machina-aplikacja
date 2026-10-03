import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderAdapter, ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { CaseFileToolRuntime, type CaseFileAccess } from "../src/case-file-tool-runtime.js";
import {
  DocumentAliasRegistry,
  SESSION_EXECUTION_INTERNAL,
  SafeSessionExecutor,
  markPages,
  namespaceChunkTokens,
  namespaceDocumentAttachmentTokens
} from "../src/session-executor.js";

const DR = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
const CASE = "case_0123456789abcdef0123456789abcdef";
const IN_CONTEXT = "doc_aaaaaaaaaaaaaaaaaaaaaaaa";
const OUTSIDE = "doc_bbbbbbbbbbbbbbbbbbbbbbbb";
const SHARED = "doc_cccccccccccccccccccccccc";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function registry(): LexSkillRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-case-files-"));
  roots.push(root);
  for (const name of ["prawny-router-v3", "prawo-polskie-v2", DR]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\nversion: "1.0"\ndescription: "test"\n---\n# ${name}\n`);
  }
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  fs.writeFileSync(path.join(root, "shared", "PRAWO-HARDGATE.md"), "# hard gate\n");
  fs.mkdirSync(path.join(root, "prawny-router-v3", "references"), { recursive: true });
  fs.writeFileSync(path.join(root, "prawny-router-v3", "references", "KROK0A-anonimizer.md"), "# anon\n");
  fs.writeFileSync(path.join(root, "prawny-router-v3", "references", "KROK1-detekcja.md"), "# detect\n");
  fs.writeFileSync(path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"), DR + "\n");
  const result = new LexSkillRegistry(root);
  result.scan();
  return result;
}

const STORED: Record<string, Array<{ index: number; pageStart: number; pageEnd: number; text: string }>> = {
  [IN_CONTEXT]: [{ index: 1, pageStart: 1, pageEnd: 1, text: "[STRONA 1 · DIGITAL]\nUmowa zawarta przez [PII:PERSON:0001]." }],
  [OUTSIDE]: [
    { index: 1, pageStart: 1, pageEnd: 1, text: "[STRONA 1 · DIGITAL]\nWstęp." },
    { index: 2, pageStart: 2, pageEnd: 3, text: "[STRONA 2 · DIGITAL]\nTermin zapłaty faktury upłynął, [PII:PERSON:0001] nie zapłacił." }
  ],
  [SHARED]: [{ index: 1, pageStart: 1, pageEnd: 1, text: "[STRONA 1 · DIGITAL]\nWezwanie do zapłaty od [PII:PERSON:0002]." }]
};

function access(log: string[] = []): CaseFileAccess {
  return {
    caseId: CASE,
    listDocuments: async () =>
      Object.entries(STORED).map(([documentId, chunks]) => ({ documentId, totalPages: 3, chunks: chunks.length })),
    search: async (query) => {
      log.push(`search:${query}`);
      return Object.entries(STORED).flatMap(([documentId, chunks]) =>
        chunks
          .filter((chunk) => chunk.text.toLowerCase().includes("zapła"))
          .map((chunk) => ({ caseId: CASE, documentId, chunkIndex: chunk.index, pageStart: chunk.pageStart, pageEnd: chunk.pageEnd, score: 1, text: chunk.text }))
      );
    },
    readChunks: async (documentId, indices) => {
      log.push(`read:${documentId}:${indices.join(",")}`);
      const chunks = (STORED[documentId] ?? []).filter((chunk) => indices.includes(chunk.index));
      if (chunks.length !== indices.length) throw new Error("UNKNOWN_DOCUMENT_CHUNK");
      return { totalPages: 3, chunks };
    },
    sharedKey: (documentId) => documentId === SHARED
  };
}

function runtime(aliases = new DocumentAliasRegistry(), maxTurnChars?: number): CaseFileToolRuntime {
  return new CaseFileToolRuntime(access(), {
    inContext: new Map([[IN_CONTEXT, new Set([1])]]),
    prefixFor: (documentId) => aliases.prefixFor(documentId),
    namespace: namespaceChunkTokens,
    markPages,
    ...(maxTurnChars ? { maxTurnChars } : {})
  });
}

const parse = (content: unknown) => JSON.parse(String(content));

describe("document alias prefixes", () => {
  it("numbers only own-key documents, so D01 restores from the right document", () => {
    const aliases = new DocumentAliasRegistry();
    const namespaced = namespaceDocumentAttachmentTokens(
      [
        { documentId: SHARED, sharedKey: true, chunks: [{ index: 1, pageStart: 1, pageEnd: 1, text: "[PII:PERSON:0001]" }] },
        { documentId: OUTSIDE, chunks: [{ index: 1, pageStart: 1, pageEnd: 1, text: "[PII:PERSON:0001]" }] }
      ],
      aliases
    );
    expect(namespaced[0]!.chunks[0]!.text).toBe("[PII:PERSON:0001]");
    expect(namespaced[1]!.chunks[0]!.text).toBe("[LMPII:D01:PERSON:0001]");
    // Before: [SHARED, OUTSIDE], so D01 was restored with the shared key.
    expect(aliases.documentIds()).toEqual([OUTSIDE]);
  });
});

describe("case file tools", () => {
  it("lists the matter's documents with what is already in context", async () => {
    const [result] = await runtime().runTools([{ id: "1", name: "list_case_files", input: {} }]);
    const body = parse(result!.content);
    expect(body.documents).toEqual([
      { documentId: IN_CONTEXT, totalPages: 3, chunks: 1, inContext: "FULL" },
      { documentId: OUTSIDE, totalPages: 3, chunks: 2, inContext: "NONE" },
      { documentId: SHARED, totalPages: 3, chunks: 1, inContext: "NONE" }
    ]);
  });

  it("searches the whole files and keeps the documents' symbols apart", async () => {
    const aliases = new DocumentAliasRegistry();
    aliases.prefixFor(IN_CONTEXT);
    const log: string[] = [];
    const tools = new CaseFileToolRuntime(access(log), {
      inContext: new Map([[IN_CONTEXT, new Set([1])]]),
      prefixFor: (documentId) => aliases.prefixFor(documentId),
      namespace: namespaceChunkTokens,
      markPages
    });
    const [result] = await tools.runTools([
      { id: "1", name: "search_case_files", input: { query: "termin zapłaty [LMPII:D01:PERSON:0001|GEN]" } }
    ]);
    expect(log).toEqual(["search:termin zapłaty"]);
    const body = parse(result!.content);
    expect(body.hits.map((hit: { documentId: string }) => hit.documentId)).toEqual([OUTSIDE, SHARED]);
    expect(body.hits[0].snippet).toContain("[LMPII:D02:PERSON:0001]");
    expect(body.hits[1].snippet).toContain("[PII:PERSON:0002]");
    expect(aliases.documentIds()).toEqual([IN_CONTEXT, OUTSIDE]);
  });

  it("reads whole chunks with page markers and records them for citations", async () => {
    const tools = runtime();
    const [result] = await tools.runTools([{ id: "1", name: "read_case_file", input: { documentId: OUTSIDE, chunks: [2] } }]);
    const body = parse(result!.content);
    expect(body.chunks[0].text).toContain("=== STRONA 2/3 ===");
    expect(body.chunks[0].text).toContain("[LMPII:D01:PERSON:0001] nie zapłacił");
    expect(tools.readChunks()).toEqual([{ documentId: OUTSIDE, chunks: [STORED[OUTSIDE]![1]] }]);
    expect(tools.auditEvents()[0]).toMatchObject({ tool: "read_case_file", target: OUTSIDE, decision: "ALLOW" });
  });

  it("blocks invalid reads and reads over the turn budget", async () => {
    const tools = runtime(new DocumentAliasRegistry(), 60);
    const results = await tools.runTools([
      { id: "1", name: "read_case_file", input: { documentId: "../x", chunks: [1] } },
      { id: "2", name: "read_case_file", input: { documentId: OUTSIDE, chunks: [1, 2, 3, 4, 5, 6, 7] } },
      { id: "3", name: "read_case_file", input: { documentId: OUTSIDE, chunks: [2] } },
      { id: "4", name: "read_case_file", input: { documentId: OUTSIDE, chunks: [9] } }
    ]);
    expect(results.map((result) => parse(result.content).error)).toEqual([
      "INVALID_DOCUMENT_ID",
      "INVALID_DOCUMENT_CHUNK_SELECTION",
      "CASE_FILE_TURN_BUDGET_EXCEEDED",
      "UNKNOWN_DOCUMENT_CHUNK"
    ]);
    expect(tools.readChunks()).toEqual([]);
  });
});

describe("case file tools in a session", () => {
  it("lets the model read a document outside the context, cite it and restore its aliases", async () => {
    let params: ProviderStreamParams | undefined;
    const adapter: ProviderAdapter = {
      id: "openai",
      label: "case files",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        params = received;
        await received.runTools?.([{ id: "s", name: "search_case_files", input: { query: "termin zapłaty" } }]);
        await received.runTools?.([{ id: "r", name: "read_case_file", input: { documentId: OUTSIDE, chunks: [2] } }]);
        return {
          fullText: `Według akt „Termin zapłaty faktury upłynął” [[LEXDOC:${OUTSIDE}:2]], a [LMPII:D02:PERSON:0001|NOM] nie zapłacił.`
        };
      }
    };
    const providers = new ProviderRegistry();
    providers.register(adapter);
    const executor = new SafeSessionExecutor(registry(), new ProviderGateway(providers));
    const result = await executor.execute({
      query: "Czy w aktach jest mowa o terminie zapłaty?",
      documentAttachments: [{ documentId: IN_CONTEXT, caseId: CASE, sourceScope: "CASE_KNOWLEDGE", chunks: STORED[IN_CONTEXT]! }],
      caseFiles: access(),
      provider: "openai",
      model: "test",
      primarySkill: DR,
      mode: "PRAWNIK"
    });
    expect(params?.tools?.map((tool) => tool.function.name)).toEqual(
      expect.arrayContaining(["list_case_files", "search_case_files", "read_case_file"])
    );
    expect(params?.systemPrompt).toContain("# AKTA SPRAWY (NARZĘDZIA)");
    expect(result.documentCitations?.[0]).toMatchObject({ caseId: CASE, documentId: OUTSIDE, chunkIndex: 2, pageStart: 2 });
    expect(result[SESSION_EXECUTION_INTERNAL]?.documentAliasDocumentIds).toEqual([IN_CONTEXT, OUTSIDE]);
  });

  it("offers no case file tools to local models", async () => {
    let params: ProviderStreamParams | undefined;
    const adapter: ProviderAdapter = {
      id: "openai",
      label: "local",
      capabilities: { streaming: true, tools: true, reasoning: false, modelDiscovery: false },
      async stream(received) {
        params = received;
        return { fullText: "Gotowe." };
      }
    };
    const providers = new ProviderRegistry();
    providers.register(adapter);
    const executor = new SafeSessionExecutor(registry(), new ProviderGateway(providers));
    await executor.execute({
      query: "Czy w aktach jest mowa o terminie zapłaty?",
      caseFiles: access(),
      provider: "openai",
      model: "local/bielik",
      primarySkill: DR,
      mode: "PRAWNIK"
    });
    expect(params?.tools?.some((tool) => tool.function.name === "search_case_files") ?? false).toBe(false);
  });
});
