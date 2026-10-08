import { describe, expect, it } from "vitest";
import { documentCompletenessWarnings } from "../src/document-completeness.js";
import type { LegalDocumentAst } from "../src/legal-document-ast.js";

const base: LegalDocumentAst = {
  schemaVersion: "1",
  documentType: "letter",
  locale: "pl-PL",
  styleProfile: "lex-classic-clean-v1",
  title: [{ type: "text", text: "WEZWANIE DO ZAPŁATY" }],
  blocks: [
    { type: "paragraph", content: [{ type: "text", text: "Wzywam do zapłaty kwoty 1000 zł." }] },
    { type: "signature", content: [{ type: "text", text: "Jan Nowak" }] }
  ]
};

describe("kompletność pisma przed użyciem", () => {
  it("nic nie zgłasza dla kompletnego pisma", () => {
    expect(documentCompletenessWarnings(base, "WEZWANIE DO ZAPŁATY Wzywam do zapłaty kwoty 1000 zł. Jan Nowak")).toEqual([]);
  });

  it("wymienia pola w nawiasach, brak tytułu i brak podpisu", () => {
    const ast: LegalDocumentAst = { ...base, title: undefined as never, blocks: [base.blocks[0]!] };
    delete (ast as { title?: unknown }).title;
    const warnings = documentCompletenessWarnings(ast, "Wzywam do zapłaty [Kwota] w terminie [Termin zapłaty]. [Kwota] [PII:PERSON:0001]");
    expect(warnings).toEqual([
      "pola do uzupełnienia: [Kwota], [Termin zapłaty]",
      "brak tytułu pisma",
      "brak bloku podpisu"
    ]);
  });

  it("nie wymaga podpisu w raporcie", () => {
    expect(documentCompletenessWarnings({ ...base, documentType: "report", blocks: [base.blocks[0]!] }, "Raport")).toEqual([]);
  });
});
