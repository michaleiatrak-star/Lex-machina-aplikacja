import { describe, expect, it } from "vitest";
import {
  DocumentAstSessionBlockedError,
  LegalDocumentAstGenerator,
  cleanAstMarkup,
  normalizeAstBlocks,
  normalizeAstHeader
} from "../src/legal-document-ast-generator.js";
import { validateLegalDocumentAst } from "../src/legal-document-ast.js";
import { ExportGateBlockedError } from "../src/document-authoring-service.js";
import { rebuildGenerationExportState, validateLocalHybridDocument } from "../src/document-generation-validation.js";
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

  it("niepoprawny AST: jedna runda naprawcza z błędem walidacji; blokada bramek bez ponowienia", async () => {
    const queries: string[] = [];
    const session = (answer: string, finalization = "PASS") => ({
      sessionId: "session_test",
      status: finalization === "PASS" ? "DRAFT_PRESENTABLE" : "BLOCKED",
      provider: "openai",
      model: "test",
      primarySkill: "dr-01-prawo-cywilne",
      answer,
      finalization,
      blockedReferences: [],
      verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
      evidence: [],
      audit: { result: "PASS", eventCount: 1, closed: true },
      [SESSION_EXECUTION_INTERNAL]: { verificationRecords: [], auditEvents: [] }
    });
    const valid = JSON.stringify({ schemaVersion: "1", locale: "pl-PL", documentType: "letter", styleProfile: "lex-classic-clean-v1", blocks: [{ type: "paragraph", content: [{ type: "text", text: "ok" }] }] });
    const request = {
      query: "Wygeneruj pismo.",
      provider: "openai",
      model: "test",
      primarySkill: "dr-01-prawo-cywilne",
      mode: "PRAWNIK",
      documentType: "letter",
      styleProfile: "lex-classic-clean-v1",
      aliases: { schemaVersion: 1, entries: [] }
    } as const;
    const repaired = await new LegalDocumentAstGenerator({
      execute: async (input: { query: string }) => {
        queries.push(input.query);
        return session(queries.length === 1 ? "Oto pismo: Szanowni Państwo, ..." : valid);
      }
    } as unknown as Pick<SessionExecutor, "execute">).generate(request as never);
    expect(repaired.ast.blocks).toHaveLength(1);
    expect(queries).toHaveLength(2);
    // A letter is asked for in the letter markup; prose about it gets the markup's repair round.
    expect(queries[0]).toContain("LETTER MARKUP");
    expect(queries[1]).toContain("BŁĄD WALIDACJI POPRZEDNIEJ ODPOWIEDZI: LETTER_MARKUP_MISSING");

    let calls = 0;
    const blocked = await new LegalDocumentAstGenerator({
      execute: async () => {
        calls += 1;
        return session(valid, "BLOCKED");
      }
    } as unknown as Pick<SessionExecutor, "execute">).generate(request as never).catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(DocumentAstSessionBlockedError);
    expect(calls).toBe(1);
  });

  it("ujednolica kształt bloków (AST_INLINE_ARRAY_INVALID) bez zmiany treści", () => {
    const variants = [
      [{ type: "paragraph", content: "ok" }],
      [{ type: "paragraph", text: "ok" }],
      [{ type: "paragraph", content: { type: "text", text: "ok" } }],
      [{ type: "paragraph", content: ["ok"] }],
      [{ type: "paragraph", content: [{ text: "ok" }] }],
      ["ok"],
      [{ type: "text", text: "ok" }]
    ];
    for (const variantBlocks of variants) {
      const ast = validateLegalDocumentAst(
        normalizeAstBlocks(normalizeAstHeader({ blocks: variantBlocks }, request)),
        []
      ).ast;
      expect(ast.blocks).toEqual([{ type: "paragraph", content: [{ type: "text", text: "ok" }] }]);
    }
    const mixed = validateLegalDocumentAst(
      normalizeAstBlocks(normalizeAstHeader({
        title: "Wezwanie",
        blocks: [
          { type: "h2", content: "Tytuł" },
          { type: "list", items: ["a", { text: "b" }] },
          { type: "table", rows: [["x", { text: "y" }]] }
        ]
      }, request)),
      []
    ).ast;
    expect(mixed.title).toEqual([{ type: "text", text: "Wezwanie" }]);
    expect(mixed.blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(mixed.blocks[1]).toMatchObject({ type: "list", ordered: false });
    expect(mixed.blocks[2]).toMatchObject({ type: "table" });
  });

  it("pozycje listy jako {children} albo list_item (RD 121/26, AST_INLINE_TYPE_UNSUPPORTED)", () => {
    const ast = validateLegalDocumentAst(
      normalizeAstBlocks(normalizeAstHeader({
        title: "Zażalenie",
        blocks: [{ type: "list", ordered: true, items: [
          { children: [{ type: "text", text: "uchylenie postanowienia" }] },
          { type: "list_item", content: [{ type: "text", text: "dowody" }] },
          { inlines: "akta" }
        ] }]
      }, request)),
      []
    ).ast;
    expect(ast.blocks[0]).toMatchObject({ type: "list", ordered: true, items: [
      [{ type: "text", text: "uchylenie postanowienia" }],
      [{ type: "text", text: "dowody" }],
      [{ type: "text", text: "akta" }]
    ] });
  });

  it("typy inline innych formatów i blok z „content” i „inlines” naraz (AST_INLINE_TYPE_UNSUPPORTED) bez zmiany treści", () => {
    const ast = validateLegalDocumentAst(
      normalizeAstBlocks(normalizeAstHeader({
        schemaVersion: "1",
        documentType: "other",
        blocks: [
          { type: "paragraph", inlines: [{ type: "text", text: "Jan Kowalski" }, { type: "line_break" }, { type: "text", text: "ul. Polna 1" }], content: [{ type: "paragraph", content: [{ type: "text", text: "Jan Kowalski" }] }] },
          { type: "heading", level: 1, inlines: [{ type: "strong", text: "ODPOWIEDŹ NA WEZWANIE" }], content: [] },
          { type: "paragraph", content: [{ type: "text", text: "Zgodnie z " }, { type: "link", label: "art. 483 § 1 KC", href: "https://api.sejm.gov.pl/eli" }, { type: "emphasis", content: [{ type: "text", text: " – kara umowna" }] }] }
        ]
      }, { documentType: "other", styleProfile: "lex-classic-clean-v1" })),
      []
    ).ast;
    expect(ast.blocks).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Jan Kowalski" }, { type: "text", text: "\n" }, { type: "text", text: "ul. Polna 1" }] },
      { type: "heading", level: 1, content: [{ type: "text", text: "ODPOWIEDŹ NA WEZWANIE", bold: true }] },
      { type: "paragraph", content: [{ type: "text", text: "Zgodnie z " }, { type: "text", text: "art. 483 § 1 KC" }, { type: "text", text: " – kara umowna" }] }
    ]);
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
    let accountContinuity: string | undefined;
    let threadEvidence: unknown;
    let signatureSearch: unknown;
    const sessions: Pick<SessionExecutor, "execute"> = {
      execute: async (request) => {
        query = request.query;
        documentAstOutput = request.documentAstOutput;
        accountContinuity = request.accountContinuity;
        threadEvidence = request.threadEvidence;
        signatureSearch = request.caseSignatureSearch;
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
      // The thread's evidence reaches the file's session (RD 121/26).
      threadEvidence: { schemaVersion: 1, updatedAt: "2026-10-30T10:00:00Z", provisions: [], skills: [], sources: [], caseReferences: ["VIII W 633/25"] },
      caseSignatureSearch: { search: async () => [] },
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

    expect(threadEvidence).toMatchObject({ caseReferences: ["VIII W 633/25"] });
    expect(signatureSearch).toBeDefined();
    expect(query).toContain("[PII:PERSON:0001] -> [LMPII:D01:PERSON:0001]");
    expect(query).not.toContain("Jan Kowalski");
    // Sesja generatora: wynik to JSON AST, nie sekcje tekstowe workflow pisma.
    expect(documentAstOutput).toBe(true);
    // Konto ChatGPT/Claude: sesja generatora nie wznawia wspólnego wątku CLI.
    expect(accountContinuity).toBe("none");
    expect(query).toContain("Never output routing keys");
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

describe("czat w tekście AST (Markdown) przebudowany przed walidacją", () => {
  const para = (text: string) => ({ blocks: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const blocks = (text: string) => (cleanAstMarkup(para(text)) as { blocks: unknown[] }).blocks;

  it("zdejmuje wyróżnienia i nagłówki Markdown, zostawia pola do wypełnienia", () => {
    expect(blocks("**Powód:** Jan Kowalski")).toEqual([{ type: "paragraph", content: [{ type: "text", text: "Powód: Jan Kowalski" }] }]);
    expect(blocks("## Uzasadnienie")).toEqual([{ type: "heading", level: 2, content: [{ type: "text", text: "Uzasadnienie" }] }]);
    expect(blocks("Data: __________")).toEqual([{ type: "paragraph", content: [{ type: "text", text: "Data: __________" }] }]);
    expect(blocks("art. 5 *k.c.*")).toEqual([{ type: "paragraph", content: [{ type: "text", text: "art. 5 *k.c.*" }] }]);
  });

  it("listę, tabelę i akapity z jednego akapitu rozbija na bloki", () => {
    expect(blocks("Wnoszę o:\n1. zasądzenie\n2. koszty")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Wnoszę o:" }] },
      { type: "list", ordered: true, items: [[{ type: "text", text: "zasądzenie" }], [{ type: "text", text: "koszty" }]] }
    ]);
    expect(blocks("| Kwota | Data |\n|---|---|\n| 100 zł | 1.10.2026 |")[0]).toMatchObject({ type: "table" });
    expect(blocks("Pierwszy.\n\nDrugi.")).toHaveLength(2);
    expect(blocks("```\nTekst\n```")).toEqual([{ type: "paragraph", content: [{ type: "text", text: "Tekst" }] }]);
  });

  it("wyliczenie literowe zostaje literowe (lit. a), numeracja modelu w liście znika", () => {
    expect(blocks("a) pierwszy\nb) drugi")).toEqual([{ type: "paragraph", content: [{ type: "text", text: "a) pierwszy\nb) drugi" }] }]);
    const list = cleanAstMarkup({ blocks: [{ type: "list", ordered: true, items: [[{ type: "text", text: "1. zasądzenie" }], [{ type: "text", text: "" }]] }] });
    expect(list).toEqual({ blocks: [{ type: "list", ordered: true, items: [[{ type: "text", text: "zasądzenie" }]] }] });
  });
});

describe("pismo z niezweryfikowanym przepisem: projekt po decyzji użytkownika (ZAKAZ-14)", () => {
  const ast = JSON.stringify({
    schemaVersion: "1",
    documentType: "letter",
    locale: "pl-PL",
    styleProfile: "lex-classic-clean-v1",
    blocks: [{ type: "paragraph", content: [{ type: "text", text: "Wnoszę o zmniejszenie kary na podstawie art. 484 § 2 KC." }] }]
  });
  // The session of the report: ELI unavailable, the local copy has amendments after the t.j.
  const degraded = (extra: { type: string; target: string }[] = []) => ({
    sessionId: "session_draft",
    status: "DRAFT_PRESENTABLE",
    provider: "openai",
    model: "test",
    primarySkill: "pisma-proste-v2",
    answer: ast,
    finalization: "DEGRADED",
    workflow: { id: "SIMPLE_LETTER_V1", result: "BLOCKED", missingResources: [] },
    blockedReferences: [
      { claim: "art. 484 § 2", kind: "statute", line: 1, status: "UNVERIFIED_MARKED" },
      { claim: "art. 484 § 2", kind: "statute", line: 3, status: "UNVERIFIED_MARKED" }
    ],
    verification: { records: 8, verified: 7, supported: 0, unverified: 1 },
    evidence: [],
    audit: { result: "BLOCKED", eventCount: 9, closed: true, violations: ["blocked_event_present"] },
    [SESSION_EXECUTION_INTERNAL]: {
      verificationRecords: [],
      auditEvents: [
        { sequence: 1, timestamp: "", type: "tool_decision", target: "verify_legal_reference", status: "BLOCKED", detail: { reason: "TEMPORAL_POST_TJ_AMENDMENTS" } },
        { sequence: 2, timestamp: "", type: "gate", target: "G39I_WORKFLOW_CONTRACT", status: "BLOCKED" },
        { sequence: 3, timestamp: "", type: "gate", target: "G39I_TURN_STATE", status: "BLOCKED" },
        { sequence: 4, timestamp: "", type: "gate", target: "G39I_COMMON_LEGAL_INVARIANTS", status: "BLOCKED" },
        { sequence: 5, timestamp: "", type: "gate", target: "G39H_WORKFLOW_FINALIZATION", status: "BLOCKED" },
        ...extra.map((event, index) => ({ sequence: 6 + index, timestamp: "", ...event, status: "BLOCKED" }))
      ]
    }
  });
  const request: Parameters<LegalDocumentAstGenerator["generate"]>[0] = {
    query: "ok, wygeneruj dokument",
    provider: "openai",
    model: "test",
    primarySkill: "pisma-proste-v2",
    mode: "LAIK",
    documentType: "letter",
    styleProfile: "lex-classic-clean-v1",
    aliases: { schemaVersion: 1, entries: [] }
  };
  const generator = (extra?: { type: string; target: string }[]) =>
    new LegalDocumentAstGenerator({ execute: async () => degraded(extra) } as unknown as Pick<SessionExecutor, "execute">);

  it("bez decyzji: pytanie o projekt z listą powołań, nie blokada sesji", async () => {
    const failure = await generator().generate(request).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ExportGateBlockedError);
    const blocked = failure as ExportGateBlockedError;
    expect(blocked.message).toBe("READY_DOCUMENT_EXPORT_GATE_BLOCKED:UNVERIFIED_REFERENCE_REQUIRES_HUMAN_DECISION");
    expect(blocked.draftAvailable).toBe(true);
    expect(blocked.references).toEqual([{ claim: "art. 484 § 2", status: "UNVERIFIED_MARKED", line: 1 }]);
  });

  it("po decyzji: AST i kontekst projektu; HYBRID-VAL i audyt eksportu nie blokują już weryfikacji", async () => {
    const generated = await generator().generate({ ...request, acceptUnverified: true });
    expect(generated.validationContext.acceptedUnverifiedSource).toEqual({ claims: ["art. 484 § 2"] });
    expect(validateLocalHybridDocument("Wnoszę o zmniejszenie kary.", generated.validationContext)).toEqual({ result: "PASS", reasons: [] });
    const { audit } = rebuildGenerationExportState(generated.validationContext);
    expect(audit.validateCompletion({ requireVerification: false }).violations).not.toContain("blocked_event_present");
    // Without the decision the same source still blocks the file.
    const { acceptedUnverifiedSource: _accepted, ...plain } = generated.validationContext;
    expect(validateLocalHybridDocument("Wnoszę o zmniejszenie kary.", plain).reasons).toContain("SOURCE_SESSION_BLOCKED_EVENT");
  });

  it("inna blokada (brak zasobu) nadal blokuje, także po decyzji", async () => {
    const failure = await generator([{ type: "resource_read", target: "shared/NIEISTNIEJE.md" }])
      .generate({ ...request, acceptUnverified: true })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DocumentAstSessionBlockedError);
  });
});
