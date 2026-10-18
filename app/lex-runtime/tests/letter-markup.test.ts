import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateLegalDocumentAst } from "../src/legal-document-ast.js";
import { LegalDocumentAstGenerator } from "../src/legal-document-ast-generator.js";
import { LocalLegalDocumentRenderer } from "../src/legal-document-renderer.js";
import { isLetterMarkup, letterMarkupAst, markupInlines } from "../src/letter-markup.js";
import { SESSION_EXECUTION_INTERNAL, type SessionExecutor } from "../src/session-executor.js";

// A letter in the model's markup made into the document AST by the application, in the
// office's layout (fictitious parties).
const letter = [
  "@MIEJSCE_DATA: Kraków, dnia 3 marca 2026 r.",
  "@STRONA: Wnioskodawca:",
  "[LMPII:D01:PERSON:0001|NOM]",
  "ul. Polna 1, 30-001 Kraków",
  "",
  "@ADRESAT:",
  "Przykład Finanse S.A.",
  "ul. Leśna 2, 00-001 Warszawa",
  "@DOTYCZY: umowy pożyczki nr 1/2025 z dnia 2 stycznia 2025 r.",
  "@TYTUL: REKLAMACJA",
  "@PODSTAWA: (art. 5 ustawy o rozpatrywaniu reklamacji)",
  "@SEKCJA: I. Żądanie",
  "1. **Żądanie główne:** zwrot kwoty 1 000,00 zł;",
  "2. **Żądanie ewentualne:** korekta harmonogramu.",
  "@SEKCJA: II. Uzasadnienie",
  "Pożyczkodawca pobrał odsetki od kwoty składki od [LMPII:D01:PERSON:0001|GEN].",
  "- pierwsza rata;",
  "- druga rata.",
  "@PODPIS:",
  "",
  "@ZALACZNIKI:",
  "1. umowa pożyczki;",
  "2. harmonogram."
].join("\n");

const options = { documentType: "letter" as const, styleProfile: "lex-office-tnr-v1" as const };

describe("letter markup", () => {
  it("parts become blocks with their roles; labels bold; aliases typed with their case; lists grouped", () => {
    expect(isLetterMarkup(letter)).toBe(true);
    const ast = letterMarkupAst(letter, options);
    const kinds = ast.blocks.map((block) => (block.type === "paragraph" ? `p:${block.role ?? "-"}` : block.type === "heading" ? `h${block.level}` : block.type));
    expect(kinds).toEqual([
      "p:place_date", "p:party", "p:addressee", "p:subject", "h1", "p:basis",
      "h2", "list", "h2", "p:-", "list", "signature", "h2", "list"
    ]);
    const party = ast.blocks[1]!;
    expect(party.type === "paragraph" && party.content[0]).toEqual({ type: "text", text: "Wnioskodawca:", bold: true });
    const addressee = ast.blocks[2]!;
    expect(addressee.type === "paragraph" && addressee.content[0]).toEqual({ type: "text", text: "Przykład Finanse S.A.", bold: true });
    const demands = ast.blocks[7]!;
    expect(demands.type === "list" && demands.ordered && demands.items[0]![0]).toEqual({ type: "text", text: "Żądanie główne:", bold: true });
    const body = ast.blocks[9]!;
    expect(body.type === "paragraph" && body.content.find((node) => node.type === "pii_ref")).toEqual({ type: "pii_ref", alias: "[LMPII:D01:PERSON:0001]", case: "GEN" });
    const signature = ast.blocks[11]!;
    // No signer known: a field to fill in under the signature line.
    expect(signature.type === "signature" && signature.content).toEqual([{ type: "text", text: "……………………………………\n[imię i nazwisko]" }]);
  });

  it("a letter without its title, an unknown marker: errors for the repair round", () => {
    expect(() => letterMarkupAst("@MIEJSCE_DATA: Kraków\nTreść.", options)).toThrow("LETTER_MARKUP_TITLE_MISSING");
    expect(() => letterMarkupAst("@TYTUL: PISMO\n@UWAGI: x\nTreść.", options)).toThrow("LETTER_MARKUP_UNKNOWN_MARKER:UWAGI");
    expect(() => letterMarkupAst("Szanowni Państwo", options)).toThrow("LETTER_MARKUP_MISSING");
    expect(markupInlines("a **b** c")).toEqual([{ type: "text", text: "a " }, { type: "text", text: "b", bold: true }, { type: "text", text: " c" }]);
  });

  it("the generator takes the markup: no JSON, the AST made by the application", async () => {
    let query = "";
    const answer = "@MIEJSCE_DATA: Kraków, dnia 3 marca 2026 r.\n@TYTUL: WEZWANIE DO ZAPŁATY\nWzywam do zapłaty kwoty 1 000,00 zł.\n@PODPIS:\nJan Przykładowy";
    const generator = new LegalDocumentAstGenerator({
      execute: async (request: { query: string }) => {
        query = request.query;
        return {
          sessionId: "session_test",
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
    } as unknown as Pick<SessionExecutor, "execute">);
    const result = await generator.generate({
      query: "Wygeneruj pismo.",
      provider: "openai",
      model: "test",
      primarySkill: "pisma-proste-v2",
      mode: "PRAWNIK",
      documentType: "letter",
      styleProfile: "lex-office-tnr-v1",
      aliases: { schemaVersion: 1, entries: [] }
    } as never);
    expect(query).toContain("LETTER MARKUP");
    expect(query).not.toContain("Return ONLY one JSON object");
    expect(result.ast.blocks.map((block) => block.type)).toEqual(["paragraph", "heading", "paragraph", "signature"]);
  });
});

function unzip(data: Uint8Array, part: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-office-"));
  const file = path.join(dir, "package.zip");
  fs.writeFileSync(file, data);
  try {
    return execFileSync("python3", ["-I", "-c", "import sys,zipfile;sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())", file, part], { encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("office letter layout (lex-office-tnr-v1)", () => {
  const renderer = new LocalLegalDocumentRenderer({ timeoutMs: 20_000 });
  const ast = validateLegalDocumentAst(
    letterMarkupAst(letter.replace(/\[LMPII:D01:PERSON:0001\|(?:NOM|GEN)\]/gu, "Jan Przykładowy"), options),
    []
  ).ast;

  for (const format of ["docx", "odt"] as const) {
    it(`${format}: the file's text equals the render's text`, async () => {
      const rendered = await renderer.render(format, ast);
      const checked = await renderer.validate(format, rendered.data);
      expect(checked.text.replace(/\s+/g, " ").trim()).toBe(rendered.text.replace(/\s+/g, " ").trim());
    });
  }

  it("docx: Times New Roman 12, margins 2.5/2 cm, addressee from 9 cm, bold labels, points 1), centred title", async () => {
    const rendered = await renderer.render("docx", ast);
    const xml = unzip(rendered.data, "word/document.xml");
    const styles = unzip(rendered.data, "word/styles.xml");
    expect(styles).toContain('w:ascii="Times New Roman"');
    expect(styles).not.toContain("Arial");
    expect(xml).toContain('<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1417"');
    const paragraphs = xml.split("<w:p>").slice(1);
    expect(paragraphs.find((item) => item.includes("Kraków, dnia"))).toContain('<w:jc w:val="right"/>');
    expect(paragraphs.find((item) => item.includes("Przykład Finanse"))).toContain('<w:ind w:left="5103"/>');
    expect(paragraphs.find((item) => item.includes("Przykład Finanse"))).toMatch(/<w:rPr><w:b\/><\/w:rPr><w:t>Przykład Finanse S\.A\.<\/w:t>/u);
    expect(paragraphs.find((item) => item.includes("Dotyczy:"))).toMatch(/<w:b\/><\/w:rPr><w:t xml:space="preserve">Dotyczy: <\/w:t>/u);
    expect(paragraphs.find((item) => item.includes("REKLAMACJA"))).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain(">1) </w:t>");
    expect(paragraphs.find((item) => item.includes("(art. 5 ustawy"))).toContain('<w:jc w:val="center"/>');
  });
});

describe("numbered points through a letter", () => {
  const renderer = new LocalLegalDocumentRenderer({ timeoutMs: 20_000 });
  const markup = [
    "@TYTUL: POZEW",
    "@SEKCJA: III. Uzasadnienie",
    "@PODSEKCJA: 1. Strony",
    "1. Powód zawarł umowę.",
    "2. Pozwany odebrał roboty.",
    "",
    "@PODSEKCJA: 2. Faktury",
    "23. Powód wystawił faktury.",
    "",
    "24. Pozwany nie zapłacił:",
    "1) faktury nr 3,",
    "2) faktury nr 4.",
    "@PODPIS: r.pr. X"
  ].join("\n");
  const ast = validateLegalDocumentAst(letterMarkupAst(markup, options), []).ast;

  it("a list keeps its first number; a number out of sequence starts a new list", () => {
    const lists = ast.blocks.filter((block) => block.type === "list") as Array<{ start?: number; items: unknown[] }>;
    expect(lists.map((list) => [list.start ?? 1, list.items.length])).toEqual([[1, 2], [23, 1], [24, 1], [1, 2]]);
  });

  it("docx and odt number 23 and 24, not 1", async () => {
    const docx = await renderer.render("docx", ast);
    expect(docx.text).toMatch(/23[.)]\s+Powód wystawił faktury/u);
    expect(docx.text).toMatch(/24[.)]\s+Pozwany nie zapłacił/u);
    expect(docx.text).not.toMatch(/\b1[.)]\s+Powód wystawił faktury/u);
    const odt = await renderer.render("odt", ast);
    expect(unzip(odt.data, "content.xml")).toContain('<text:list-item text:start-value="23">');
  });

  it("AST: a start below 1 or not an integer is rejected", () => {
    const bad = (start: unknown) => () => validateLegalDocumentAst({ ...ast, blocks: [{ type: "list", ordered: true, start, items: [[{ type: "text", text: "x" }]] }] }, []);
    expect(bad(0)).toThrow("AST_LIST_INVALID");
    expect(bad(2.5)).toThrow("AST_LIST_INVALID");
    expect(bad(7)).not.toThrow();
  });
});

describe("list of attachments: its own numbering from 1", () => {
  const renderer = new LocalLegalDocumentRenderer({ timeoutMs: 20_000 });
  const ast = (tail: string) =>
    validateLegalDocumentAst(letterMarkupAst(["@TYTUL: POZEW", "@SEKCJA: III. Uzasadnienie", "71. Powód wezwał pozwanego.", "72. Pozwany nie zapłacił.", tail, ...(tail.includes("@PODPIS") ? [] : ["@PODPIS: r.pr. X"])].join("\n"), options), []).ast;
  const lists = (value: ReturnType<typeof ast>) => value.blocks.filter((block) => block.type === "list") as Array<{ start?: number; items: unknown[] }>;

  it("@ZALACZNIKI with the points' numbers continued and blank lines: one list from 1", async () => {
    const value = ast("@PODPIS: r.pr. X\n@ZALACZNIKI:\n73. Umowa\n\n74. Faktura\n75. Wezwanie");
    expect(lists(value).map((list) => [list.start ?? 1, list.items.length])).toEqual([[71, 2], [1, 3]]);
    const text = (await renderer.render("docx", value)).text;
    expect(text).toMatch(/1[.)]\s+Umowa/u);
    expect(text).toMatch(/3[.)]\s+Wezwanie/u);
    expect(text).not.toMatch(/73[.)]\s+Umowa/u);
  });

  it("a section heading „IV. Załączniki” and a plain line „Załączniki:” open the list too", () => {
    expect(lists(ast("@SEKCJA: IV. Załączniki\n5. Umowa\n6. Faktura")).at(-1)).toMatchObject({ items: [expect.anything(), expect.anything()] });
    expect(lists(ast("@SEKCJA: IV. Załączniki\n5. Umowa\n6. Faktura")).at(-1)?.start).toBeUndefined();
    expect(lists(ast("Załączniki:\n4. Umowa")).at(-1)?.start).toBeUndefined();
  });

  it("a sentence about attachments is not the list; points after another section keep their numbers", () => {
    expect(lists(ast("Załączniki do umowy stanowią jej integralną część.\n73. Pozwany milczał.")).at(-1)?.start).toBe(73);
    expect(lists(ast("@SEKCJA: IV. Załączniki\n1. Umowa\n@SEKCJA: V. Wnioski\n73. Wniosek")).at(-1)?.start).toBe(73);
  });
});
