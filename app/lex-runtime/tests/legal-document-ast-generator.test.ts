import { describe, expect, it } from "vitest";
import {
  DocumentAstSessionBlockedError,
  LegalDocumentAstGenerator,
  normalizeAstHeader
} from "../src/legal-document-ast-generator.js";
import { validateLegalDocumentAst } from "../src/legal-document-ast.js";
import {
  SESSION_EXECUTION_INTERNAL,
  type SessionExecutor
} from "../src/session-executor.js";

describe("nagłówek AST uzupełniany przez runtime (AST_HEADER_INVALID)", () => {
  const request = { documentType: "letter", styleProfile: "lex-classic-clean-v1" } as const;
  const blocks = [{ type: "paragraph", content: [{ type: "text", text: "ok" }] }];

  it("przyjmuje typowe warianty nagłówka od modeli", () => {
    for (const variant of [
      { schemaVersion: 1, locale: "pl", blocks },
      { blocks },
      { document: { schemaVersion: "1", documentType: "list", blocks } },
      { schemaVersion: "1.0", locale: "pl_PL", documentType: "letter", content: blocks }
    ]) {
      const ast = validateLegalDocumentAst(normalizeAstHeader(variant, request), []).ast;
      expect(ast).toMatchObject({
        schemaVersion: "1",
        locale: "pl-PL",
        documentType: "letter",
        styleProfile: "lex-classic-clean-v1"
      });
    }
  });

  it("odrzucony nagłówek: diagnostyka z polami nagłówka, bez treści pisma", async () => {
    const generator = new LegalDocumentAstGenerator({
      execute: async () => ({
        sessionId: "session_test",
        status: "DRAFT_PRESENTABLE",
        provider: "openai",
        model: "test",
        primarySkill: "dr-01-prawo-cywilne",
        answer: JSON.stringify({ schemaVersion: 2, blocks: [{ type: "paragraph", content: [{ type: "text", text: "TAJNE" }] }] }),
        finalization: "PASS",
        blockedReferences: [],
        verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
        evidence: [],
        audit: { result: "PASS", eventCount: 1, closed: true },
        [SESSION_EXECUTION_INTERNAL]: { verificationRecords: [], auditEvents: [] }
      })
    } as Pick<SessionExecutor, "execute">);
    const failure = await generator.generate({
      query: "Wygeneruj docx z napisem ok.",
      provider: "openai",
      model: "test",
      primarySkill: "dr-01-prawo-cywilne",
      mode: "PRAWNIK",
      documentType: "letter",
      styleProfile: "lex-classic-clean-v1",
      aliases: { schemaVersion: 1, entries: [] }
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DocumentAstSessionBlockedError);
    const diagnostic = failure as DocumentAstSessionBlockedError;
    expect(diagnostic.message).toBe("AST_HEADER_INVALID");
    expect(diagnostic.stage).toBe("DOCUMENT_AST_VALIDATION");
    expect(diagnostic.reason).toContain("schemaVersion=2");
    expect(diagnostic.reason).toContain("locale=\"pl-PL\"");
    expect(`${diagnostic.reason} ${diagnostic.description}`).not.toContain("TAJNE");
  });

  it("nie zmienia poprawnego, innego typu dokumentu ani bloków", () => {
    const normalized = normalizeAstHeader(
      { schemaVersion: "1", locale: "pl-PL", documentType: "contract", styleProfile: "lex-classic-clean-v1", blocks },
      request
    ) as { documentType: string; blocks: unknown };
    expect(normalized.documentType).toBe("contract");
    expect(normalized.blocks).toBe(blocks);
    expect(() => validateLegalDocumentAst(normalizeAstHeader({ schemaVersion: 2, blocks }, request), []))
      .toThrow("AST_HEADER_INVALID");
  });
});

describe("LegalDocumentAstGenerator", () => {
  it("accepts provider JSON and validates only declared aliases", async () => {
    let query = "";
    let documentAstOutput: boolean | undefined;
    const sessions: Pick<SessionExecutor, "execute"> = {
      execute: async (request) => {
        query = request.query;
        documentAstOutput = request.documentAstOutput;
        return {
          sessionId: "session_test",
          status: "DRAFT_PRESENTABLE",
          provider: "openai",
          model: "test",
          primarySkill: "dr-01-prawo-cywilne",
          answer: JSON.stringify({
            schemaVersion: "1",
            documentType: "letter",
            locale: "pl-PL",
            styleProfile: "lex-classic-clean-v1",
            blocks: [{
              type: "paragraph",
              content: [
                { type: "text", text: "Klient: " },
                { type: "pii_ref", alias: "[LMPII:D01:PERSON:0001]" }
              ]
            }]
          }),
          finalization: "PASS",
          blockedReferences: [],
          verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
          evidence: [],
          audit: { result: "PASS", eventCount: 4, closed: true },
          [SESSION_EXECUTION_INTERNAL]: {
            verificationRecords: [],
            auditEvents: [
              {
                sequence: 1,
                timestamp: "2026-09-16T10:00:00.000Z",
                type: "session_started",
                target: "session_test",
                status: "OK"
              },
              {
                sequence: 2,
                timestamp: "2026-09-16T10:00:01.000Z",
                type: "skill_read",
                target: "prawny-router-v3",
                status: "OK"
              },
              {
                sequence: 3,
                timestamp: "2026-09-16T10:00:02.000Z",
                type: "provider_start",
                target: "openai",
                status: "OK"
              },
              {
                sequence: 4,
                timestamp: "2026-09-16T10:00:03.000Z",
                type: "provider_end",
                target: "openai",
                status: "OK"
              }
            ]
          }
        };
      }
    };

    const generator = new LegalDocumentAstGenerator(sessions);
    const result = await generator.generate({
      query: "Przygotuj pismo.",
      provider: "openai",
      model: "test",
      primarySkill: "dr-01-prawo-cywilne",
      mode: "PRAWNIK",
      documentType: "letter",
      styleProfile: "lex-classic-clean-v1",
      aliases: {
        schemaVersion: 1,
        entries: [{
          alias: "[LMPII:D01:PERSON:0001]",
          documentId: "doc_0123456789abcdef01234567",
          sourceToken: "[PII:PERSON:0001]",
          kind: "PERSON"
        }]
      }
    });

    expect(query).toContain("[PII:PERSON:0001] -> [LMPII:D01:PERSON:0001]");
    expect(query).not.toContain("Jan Kowalski");
    // Sesja generatora: wynik to JSON AST, nie sekcje tekstowe workflow pisma.
    expect(documentAstOutput).toBe(true);
    expect(result.aliasesUsed).toEqual(["[LMPII:D01:PERSON:0001]"]);
  });

  it("explains a blocked session without leaking the answer", async () => {
    const sessions: Pick<SessionExecutor, "execute"> = {
      execute: async () => ({
        sessionId: "session_blocked",
        status: "BLOCKED",
        provider: "openai",
        model: "test",
        primarySkill: "prawny-router-v3",
        answer: "TAJNA TREŚĆ ODPOWIEDZI",
        finalization: "BLOCKED",
        blockedReferences: [
          { claim: "art. 51 § 1 KW", kind: "statute", line: 3, status: "UNVERIFIED" }
        ],
        verification: { records: 2, verified: 0, supported: 0, unverified: 2 },
        evidence: [],
        audit: { result: "BLOCKED", eventCount: 5, closed: true, violations: ["FINALIZATION_GATE"] },
        [SESSION_EXECUTION_INTERNAL]: {
          verificationRecords: [],
          auditEvents: [
            { sequence: 1, timestamp: "", type: "gate", target: "G36_LEGAL_CORPUS_RUNTIME", status: "BLOCKED", detail: { toolEvents: 3 } },
            { sequence: 2, timestamp: "", type: "resource_read", target: "shared/NIEISTNIEJE.md", status: "BLOCKED", detail: { error: "LEGAL_RESOURCE_NOT_FOUND" } },
            { sequence: 3, timestamp: "", type: "gate", target: "G8", status: "OK" }
          ]
        }
      })
    };
    const failure = await new LegalDocumentAstGenerator(sessions)
      .generate({
        query: "Wzór wezwania do zapłaty.",
        provider: "openai",
        model: "test",
        primarySkill: "prawny-router-v3",
        mode: "PRAWNIK",
        documentType: "letter",
        styleProfile: "lex-classic-clean-v1",
        aliases: { schemaVersion: 1, entries: [] }
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DocumentAstSessionBlockedError);
    const blocked = failure as DocumentAstSessionBlockedError;
    expect(blocked.message).toBe("DOCUMENT_AST_SESSION_BLOCKED");
    expect(blocked.reason).toBe("status=BLOCKED; finalization=BLOCKED; audit=BLOCKED; answer=present");
    expect(blocked.description).toContain("audit.violations: FINALIZATION_GATE");
    expect(blocked.description).toContain("blockedReference[statute/UNVERIFIED]: art. 51 § 1 KW");
    expect(blocked.description).toContain("unverified=2");
    // Nazwa zablokowanej bramki i kod przyczyny (bez treści odpowiedzi).
    expect(blocked.description).toContain("blockedEvent[gate]: G36_LEGAL_CORPUS_RUNTIME");
    expect(blocked.description).toContain("blockedEvent[resource_read]: shared/NIEISTNIEJE.md — LEGAL_RESOURCE_NOT_FOUND");
    expect(blocked.description).not.toContain("G8");
    expect(`${blocked.reason}${blocked.description}`).not.toContain("TAJNA");
  });

  it("rejects an alias invented by the provider", async () => {
    const sessions: Pick<SessionExecutor, "execute"> = {
      execute: async () => ({
        sessionId: "session_test",
        status: "DRAFT_PRESENTABLE",
        provider: "openai",
        model: "test",
        primarySkill: "dr-01-prawo-cywilne",
        answer: JSON.stringify({
          schemaVersion: "1",
          documentType: "letter",
          locale: "pl-PL",
          styleProfile: "lex-classic-clean-v1",
          blocks: [{
            type: "paragraph",
            content: [{ type: "pii_ref", alias: "[LMPII:D01:PERSON:9999]" }]
          }]
        }),
        finalization: "PASS",
        blockedReferences: [],
        verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
        evidence: [],
        audit: { result: "PASS", eventCount: 4, closed: true },
        [SESSION_EXECUTION_INTERNAL]: {
          verificationRecords: [],
          auditEvents: [
            {
              sequence: 1,
              timestamp: "2026-09-16T10:00:00.000Z",
              type: "session_started",
              target: "session_test",
              status: "OK"
            },
            {
              sequence: 2,
              timestamp: "2026-09-16T10:00:01.000Z",
              type: "skill_read",
              target: "prawny-router-v3",
              status: "OK"
            },
            {
              sequence: 3,
              timestamp: "2026-09-16T10:00:02.000Z",
              type: "provider_start",
              target: "openai",
              status: "OK"
            },
            {
              sequence: 4,
              timestamp: "2026-09-16T10:00:03.000Z",
              type: "provider_end",
              target: "openai",
              status: "OK"
            }
          ]
        }
      })
    };
    const generator = new LegalDocumentAstGenerator(sessions);
    await expect(generator.generate({
      query: "Pismo",
      provider: "openai",
      model: "test",
      primarySkill: "dr-01-prawo-cywilne",
      mode: "PRAWNIK",
      documentType: "letter",
      styleProfile: "lex-classic-clean-v1",
      aliases: {
        schemaVersion: 1,
        entries: [{
          alias: "[LMPII:D01:PERSON:0001]",
          documentId: "doc_0123456789abcdef01234567",
          sourceToken: "[PII:PERSON:0001]",
          kind: "PERSON"
        }]
      }
    })).rejects.toThrow("AST_UNKNOWN_PII_ALIAS");
  });
});
