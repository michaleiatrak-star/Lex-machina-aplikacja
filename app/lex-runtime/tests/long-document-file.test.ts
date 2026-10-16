import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LONG_SOURCE_CHARS, LegalDocumentAstGenerator } from "../src/legal-document-ast-generator.js";
import { joinParts, splitSourceText, type LongDocumentState } from "../src/long-document.js";
import { SESSION_EXECUTION_INTERNAL, type SessionExecutor } from "../src/session-executor.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/long-document/${name}`, import.meta.url), "utf8");

function claimState(): LongDocumentState {
  const plan = JSON.parse(fixture("pozew-plan.json"));
  return {
    id: "ld_test",
    plan,
    parts: [1, 2, 3, 4, 5].map((k) => ({ k, text: fixture(`pozew-${k}.txt`), at: "2026-10-16T00:00:00.000Z" })),
    updatedAt: "2026-10-16T00:00:00.000Z"
  };
}

const FRAGMENT = /# TEKST PISMA DO ODWZOROWANIA — [^\n]*\n[^\n]*\n([\s\S]*?)\n\n# /u;

function session(answer: string) {
  return {
    sessionId: "session_test",
    status: "DRAFT_PRESENTABLE",
    provider: "openai",
    model: "test",
    primarySkill: "pisma-procesowe-v3",
    answer,
    finalization: "PASS",
    blockedReferences: [],
    verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
    evidence: [],
    audit: { result: "PASS", eventCount: 1, closed: true },
    [SESSION_EXECUTION_INTERNAL]: { verificationRecords: [], auditEvents: [] }
  };
}

const request = (text: string, documentType: "letter" | "pleading" | "contract" = "pleading") => ({
  query: "Wygeneruj plik.",
  provider: "openai",
  model: "test",
  primarySkill: "pisma-procesowe-v3",
  mode: "PRAWNIK",
  documentType,
  styleProfile: "lex-classic-clean-v1",
  aliases: { schemaVersion: 1, entries: [] },
  sourceText: { label: "długie pismo", text }
});

describe("długie pismo: jeden plik z części", () => {
  const joined = joinParts(claimState());

  it("połączony pozew przekracza próg i dzieli się na granicach sekcji", () => {
    expect(joined.length).toBeGreaterThan(LONG_SOURCE_CHARS);
    const pieces = splitSourceText(joined);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(14_000);
    expect(pieces.join("\n\n").replace(/\s+/gu, " ").trim()).toBe(joined.replace(/\s+/gu, " ").trim());
    for (const piece of pieces.slice(1)) expect(piece.trimStart()).toMatch(/^@SEKCJA:|^\S/u);
  });

  it("generator przenosi fragmenty po kolei i składa jeden dokument", async () => {
    const queries: string[] = [];
    const result = await new LegalDocumentAstGenerator({
      execute: async (input: { query: string }) => {
        queries.push(input.query);
        return session(FRAGMENT.exec(input.query)![1]!);
      }
    } as unknown as Pick<SessionExecutor, "execute">).generate(request(joined) as never);
    const pieces = splitSourceText(joined);
    expect(queries).toHaveLength(pieces.length);
    expect(queries[0]).toContain(`FRAGMENT 1 Z ${pieces.length}`);
    expect(queries.at(-1)).toContain("To koniec pisma");
    const text = JSON.stringify(result.ast.blocks);
    expect(text).toContain("POZEW O ZAPŁATĘ");
    expect(result.ast.blocks.filter((block) => block.type === "signature")).toHaveLength(1);
    const headings = result.ast.blocks.filter((block) => block.type === "heading").map((block) => JSON.stringify(block));
    expect(new Set(headings).size).toBe(headings.length);
  });

  it("fragment przeniesiony w połowie: jedna runda naprawcza", async () => {
    const queries: string[] = [];
    await new LegalDocumentAstGenerator({
      execute: async (input: { query: string }) => {
        queries.push(input.query);
        const piece = FRAGMENT.exec(input.query)![1]!;
        const second = input.query.includes("FRAGMENT 2 Z");
        return session(second && !input.query.includes("BŁĄD POPRZEDNIEJ WERSJI") ? piece.slice(0, piece.length / 2) : piece);
      }
    } as unknown as Pick<SessionExecutor, "execute">).generate(request(joined) as never);
    expect(queries.some((query) => /BŁĄD POPRZEDNIEJ WERSJI FRAGMENTU 2: fragment niekompletny/u.test(query))).toBe(true);
  });

  it("fragment stale niekompletny: DOCUMENT_PART_INVALID, nie krótszy plik", async () => {
    const failure = await new LegalDocumentAstGenerator({
      execute: async (input: { query: string }) => {
        const piece = FRAGMENT.exec(input.query)![1]!;
        return session(input.query.includes("FRAGMENT 2 Z") ? piece.slice(0, piece.length / 3) : piece);
      }
    } as unknown as Pick<SessionExecutor, "execute">).generate(request(joined) as never).catch((error: unknown) => error);
    expect((failure as Error).message).toBe("DOCUMENT_PART_INVALID:2");
  });

  it("nieznany znacznik we fragmencie: runda naprawcza tego fragmentu", async () => {
    const queries: string[] = [];
    await new LegalDocumentAstGenerator({
      execute: async (input: { query: string }) => {
        queries.push(input.query);
        const piece = FRAGMENT.exec(input.query)![1]!;
        const bad = input.query.includes("FRAGMENT 2 Z") && !input.query.includes("BŁĄD POPRZEDNIEJ WERSJI");
        return session(bad ? `@USTEP: 1.\n${piece}` : piece);
      }
    } as unknown as Pick<SessionExecutor, "execute">).generate(request(joined) as never);
    expect(queries.some((query) => query.includes("FRAGMENTU 2: błąd znaczników: LETTER_MARKUP_UNKNOWN_MARKER:USTEP"))).toBe(true);
  });

  it("umowa zachowuje typ dokumentu", async () => {
    const result = await new LegalDocumentAstGenerator({
      execute: async (input: { query: string }) => session(FRAGMENT.exec(input.query)![1]!)
    } as unknown as Pick<SessionExecutor, "execute">).generate(request(joined, "contract") as never);
    expect(result.ast.documentType).toBe("contract");
  });
});
