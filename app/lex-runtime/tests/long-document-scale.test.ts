import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { keepResponseAlive } from "../src/http/app.js";
import { LegalDocumentAstGenerator, LOCAL_SOURCE_CHARS } from "../src/legal-document-ast-generator.js";
import {
  checkPart,
  continuationBlock,
  isComplete,
  joinParts,
  LONG_DOCUMENT_MAX_PARTS,
  longDocumentRule,
  parsePart,
  splitSourceText,
  validPlan,
  withPart,
  wordCoverage,
  type LongDocumentPlan,
  type LongDocumentState
} from "../src/long-document.js";
import { SESSION_EXECUTION_INTERNAL, type SessionExecutor } from "../src/session-executor.js";

// A regulation of 330 § in 22 parts, ~700 characters a §: ~230 000 characters, over 65 000
// tokens even at 3 characters per token (Polish runs nearer 2.5).
const PARTS = 22;
const PER_PART = 15;
const clause = (n: number) =>
  `@SEKCJA: § ${n}. Postanowienie ${n}\n1. Sprzedawca i Klient stosują postanowienie numer ${n} w zakresie zamówień, płatności, dostaw i reklamacji, a Sprzedawca informuje Klienta o każdej zmianie tego postanowienia z wyprzedzeniem co najmniej czternastu dni kalendarzowych na trwałym nośniku.\n2. Klient może złożyć zastrzeżenia do postanowienia ${n} w terminie trzydziestu dni od otrzymania informacji, a Sprzedawca rozpatruje je w terminie czternastu dni i odpowiada na adres poczty elektronicznej wskazany przez Klienta przy rejestracji Konta.\n3. Postanowienie ${n} nie ogranicza praw Konsumenta wynikających z bezwzględnie obowiązujących przepisów prawa.`;

const plan: LongDocumentPlan = validPlan({
  tytul: "Regulamin platformy",
  czesci: Array.from({ length: PARTS }, (_, index) => ({ czesc: index + 1, paragrafy: [index * PER_PART + 1, (index + 1) * PER_PART] }))
})!;

function partAnswer(k: number): string {
  const body = Array.from({ length: PER_PART }, (_, index) => clause((k - 1) * PER_PART + index + 1)).join("\n\n");
  const head = k === 1 ? `\`\`\`plan-pisma\n${JSON.stringify(plan)}\n\`\`\`\n[CZĘŚĆ 1/${PARTS}]\n@TYTUL: Regulamin platformy\n\n` : `[CZĘŚĆ ${k}/${PARTS}]\n`;
  const end = k === PARTS ? "\n\n@PODPIS: Zarząd" : "";
  return `${head}${body}${end}\n[KONIEC CZĘŚCI ${k}/${PARTS}]`;
}

function session(answer: string) {
  return {
    sessionId: "session_scale",
    status: "DRAFT_PRESENTABLE",
    provider: "openai",
    model: "test",
    primarySkill: "pisma-proste-v2",
    answer,
    finalization: "PASS",
    blockedReferences: [],
    verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
    evidence: [],
    audit: { result: "PASS", eventCount: 1, closed: true },
    [SESSION_EXECUTION_INTERNAL]: { verificationRecords: [], auditEvents: [] }
  };
}

const FRAGMENT = /# TEKST PISMA DO ODWZOROWANIA — [^\n]*\n[^\n]*\n([\s\S]*?)\n\n# /u;

async function generate(text: string, model: string) {
  const queries: string[] = [];
  const result = await new LegalDocumentAstGenerator({
    execute: async (input: { query: string }) => {
      queries.push(input.query);
      return session(FRAGMENT.exec(input.query)![1]!);
    }
  } as unknown as Pick<SessionExecutor, "execute">).generate({
    query: "Wygeneruj plik.",
    provider: model.startsWith("local/") ? "local" : "openai",
    model,
    primarySkill: "pisma-proste-v2",
    mode: "PRAWNIK",
    documentType: "letter",
    styleProfile: "lex-classic-clean-v1",
    aliases: { schemaVersion: 1, entries: [] },
    sourceText: { label: "długie pismo", text }
  } as never);
  return { result, queries };
}

describe("pismo ponad 65 000 tokenów: 22 części", () => {
  let state: LongDocumentState = { id: "scale", plan, parts: [], updatedAt: "2026-10-17T00:00:00.000Z" };
  for (let k = 1; k <= PARTS; k += 1) {
    const part = parsePart(partAnswer(k))!;
    const check = checkPart(part, plan, state.parts);
    if (check.ok) state = withPart(state, part, "2026-10-17T00:00:00.000Z");
  }
  const whole = joinParts(state);

  it("plan do 30 części; 31 części odrzucone", () => {
    expect(LONG_DOCUMENT_MAX_PARTS).toBe(30);
    const parts = (n: number) => ({ tytul: "X", czesci: Array.from({ length: n }, (_, index) => ({ czesc: index + 1 })) });
    expect(validPlan(parts(30))?.czesci).toHaveLength(30);
    expect(validPlan(parts(31))).toBeNull();
    expect(plan.czesci).toHaveLength(PARTS);
  });

  it("każda część przyjęta, całość kompletna i ponad 65 000 tokenów", () => {
    expect(state.parts).toHaveLength(PARTS);
    expect(isComplete(state)).toBe(true);
    expect(whole.length / 3).toBeGreaterThan(65_000);
    expect([...whole.matchAll(/@SEKCJA: § (\d+)\./gu)].map((match) => Number(match[1]))).toEqual(Array.from({ length: PARTS * PER_PART }, (_, index) => index + 1));
  });

  it("blok ostatniej części: plan 22 części, ostatni §, bez utraty planu", () => {
    const block = continuationBlock({ ...state, parts: state.parts.filter((item) => item.k < PARTS) }, PARTS);
    expect(block).toContain(`CZĘŚĆ ${PARTS} Z ${PARTS}`);
    expect(block).toContain(`Ostatni paragraf poprzednich części: § ${(PARTS - 1) * PER_PART}.`);
    expect(block).toContain(`"czesc":${PARTS}`);
    expect(block.length).toBeLessThan(6_000);
  });

  it("plik: fragmenty do 14 000 znaków, bez utraty słów, jeden podpis", async () => {
    const pieces = splitSourceText(whole);
    expect(pieces.length).toBeGreaterThanOrEqual(15);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(14_000);
    expect(wordCoverage(whole, pieces.join("\n\n"))).toBe(1);
    const { result, queries } = await generate(whole, "gpt-test");
    expect(queries).toHaveLength(pieces.length);
    expect(result.ast.blocks.filter((block) => block.type === "signature")).toHaveLength(1);
  });

  it("model lokalny: fragmenty do 5 000 znaków, każdy w jednej odpowiedzi", async () => {
    const pieces = splitSourceText(whole, LOCAL_SOURCE_CHARS);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(LOCAL_SOURCE_CHARS);
    const { queries } = await generate(whole, "local/bielik-11b");
    expect(queries).toHaveLength(pieces.length);
    expect(queries[0]).toContain(`FRAGMENT 1 Z ${pieces.length}`);
  });
});

describe("model lokalny: części mieszczące się w 4 096 tokenach", () => {
  it("reguła: części po ok. 2 strony, próg ok. 3 strony, granica ok. 60 stron", () => {
    const local = longDocumentRule(true);
    expect(local).toContain("ok. 3 strony");
    expect(local).toContain("po ok. 2 strony");
    expect(local).toContain("przekracza możliwości modelu lokalnego");
    const hosted = longDocumentRule(false);
    expect(hosted).toContain("ok. 10 stron");
    expect(hosted).toContain("po ok. 6–8 stron");
    expect(hosted).toContain("2–30 części");
  });

  it("krótkie pismo dla modelu lokalnego (ponad 5 000 znaków) idzie do pliku we fragmentach", async () => {
    const text = `@TYTUL: Wezwanie\n\n${Array.from({ length: 10 }, (_, index) => clause(index + 1)).join("\n\n")}\n\n@PODPIS: X`;
    expect(text.length).toBeGreaterThan(LOCAL_SOURCE_CHARS);
    expect((await generate(text, "local/bielik-11b")).queries.length).toBeGreaterThan(1);
    expect((await generate(text, "gpt-test")).queries).toHaveLength(1);
  });

  it("część ucięta na limicie: odrzucona, ponowienie z prośbą o zwięźlejszy tekst i rozmiarem", () => {
    const cut = partAnswer(2).replace(`[KONIEC CZĘŚCI 2/${PARTS}]`, "") + "\n\n[ODPOWIEDŹ UCIĘTA: model osiągnął limit długości odpowiedzi także po kontynuacji.]";
    const first = parsePart(partAnswer(1))!;
    const state = withPart({ id: "l", plan, parts: [], updatedAt: "x" }, first, "x");
    const check = checkPart(parsePart(cut)!, plan, state.parts);
    expect(check.ok).toBe(false);
    expect(check.problems.join(" ")).toMatch(/ucięta/u);
    const block = continuationBlock(state, 2, check.problems, { local: true });
    expect(block).toContain("Model lokalny: część musi zmieścić się w jednej odpowiedzi");
    expect(block).toContain("napisz ją zwięźlej");
    expect(continuationBlock(state, 2)).not.toContain("zwięźlej");
  });
});

describe("plik długiego pisma: połączenie podtrzymane ponad limit proxy", () => {
  const app = (delayMs: number, status: number) => {
    const server = express();
    server.use(express.json());
    server.post("/gen", async (req, res) => {
      if (req.body?.keepAlive === true) keepResponseAlive(res, { afterMs: 20, intervalMs: 20 });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      res.status(status).json(status >= 400 ? { error: "EXPORT_GATE_BLOCKED" } : { artifactId: "a" });
    });
    return server;
  };

  it("długa praca: 200 od razu, spacje, właściwy status w deferredStatus", async () => {
    const response = await request(app(150, 422)).post("/gen").send({ keepAlive: true }).buffer(true).parse((res, done) => {
      let text = "";
      res.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
      res.on("end", () => done(null, text));
    });
    expect(response.status).toBe(200);
    const text = String(response.body);
    expect(text).toMatch(/^ +\{/u);
    expect(JSON.parse(text)).toEqual({ error: "EXPORT_GATE_BLOCKED", deferredStatus: 422 });
  });

  it("szybka odpowiedź albo bez keepAlive: zwykły status", async () => {
    expect((await request(app(0, 201)).post("/gen").send({ keepAlive: true })).status).toBe(201);
    const plain = await request(app(80, 409)).post("/gen").send({});
    expect(plain.status).toBe(409);
    expect(plain.body).toEqual({ error: "EXPORT_GATE_BLOCKED" });
  });
});
