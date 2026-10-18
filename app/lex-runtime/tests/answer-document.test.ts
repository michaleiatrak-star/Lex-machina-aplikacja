import { describe, expect, it } from "vitest";
import { answerLetterMarkup } from "../src/answer-document.js";
import { letterMarkupAst } from "../src/letter-markup.js";
import { legalDocumentPlainText, validateLegalDocumentAst } from "../src/legal-document-ast.js";

// The shape of a pisma-proste answer after "przygotuj dokument": the answer's sentence, the
// title, the parties under it, a heading, the body with a provision's link and its marker, the
// demands, the signer, the skill's report and the disclaimer.
const ANSWER = [
  "Przygotowałem wersję dokumentu na podstawie poprzedniego wyniku, bez dodawania nowych wątków.",
  "",
  "**ODPOWIEDŹ NA WEZWANIE DO ZAPŁATY**",
  "",
  "Jan Kowalski  ",
  "ul. Polna 1, 00-001 Warszawa",
  "",
  "Do:  ",
  "Kancelaria Przykładowa  ",
  "ul. Leśna 2, 00-002 Warszawa",
  "",
  "### Odpowiedź",
  "",
  "W odpowiedzi na pismo z 3 grudnia 2024 r. kwestionuję roszczenie co do zasady i wysokości.",
  "",
  "Kara umowna może zabezpieczać wykonanie zobowiązania niepieniężnego — [art. 483 § 1 KC.](https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf#page=50) ✅ [VER: [art. 483 § 1 KC](https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf#page=50), 2026-10-18]",
  "",
  "Wzywam zatem do:",
  "",
  "1. wycofania żądania zapłaty 60 000 zł;",
  "2. przedstawienia wyliczenia kwoty 60 000 zł.",
  "",
  "Jan Kowalski",
  "",
  "### Status dokumentu",
  "",
  "- Podstawowe przepisy zostały zweryfikowane.",
  "",
  "⚖️ Ważna informacja: Niniejsza analiza ma charakter wyłącznie informacyjny."
].join("\n");

describe("a letter of a chat answer as a file, without a model turn", () => {
  it("keeps the letter's wording: title, parties, heading, body, demands and signer; drops the answer's sentence, the report and the disclaimer", () => {
    const markup = answerLetterMarkup(ANSWER)!;
    expect(markup).toContain("@TYTUL: ODPOWIEDŹ NA WEZWANIE DO ZAPŁATY");
    expect(markup).toContain("@NADAWCA:\nJan Kowalski\nul. Polna 1, 00-001 Warszawa");
    expect(markup).toContain("@ADRESAT:\nKancelaria Przykładowa\nul. Leśna 2, 00-002 Warszawa");
    expect(markup).toContain("@SEKCJA: Odpowiedź");
    expect(markup).toContain("@PODPIS:\nJan Kowalski");
    expect(markup).not.toMatch(/Przygotowałem|Status dokumentu|zweryfikowane|Ważna informacja|https:/u);

    const ast = letterMarkupAst(markup, { documentType: "letter", styleProfile: "lex-office-tnr-v1" });
    const validated = validateLegalDocumentAst(ast, []);
    expect(validated.aliasesUsed).toEqual([]);
    const text = legalDocumentPlainText(validated.ast);
    expect(text).toContain("niepieniężnego — art. 483 § 1 KC. ✅ [VER: art. 483 § 1 KC, 2026-10-18]");
    expect(text).toContain("wycofania żądania zapłaty 60 000 zł;");
    expect(validated.ast.blocks.find((block) => block.type === "list")).toMatchObject({ ordered: true });
    expect(validated.ast.blocks.at(-1)).toMatchObject({ type: "signature" });
  });

  it("finds no letter in an answer without a title in capitals", () => {
    expect(answerLetterMarkup("Kara umowna może zabezpieczać wyłącznie zobowiązanie niepieniężne.\n\nCzy mam przygotować pismo?")).toBeNull();
  });

  it("a place and date line and the sender above the title stay in their order", () => {
    const markup = answerLetterMarkup(
      ["Warszawa, dnia 1 października 2026 r.", "", "Jan Kowalski", "ul. Polna 1, 00-001 Warszawa", "", "WEZWANIE DO ZAPŁATY", "", "Wzywam do zapłaty kwoty 1 000 zł w terminie 7 dni.", "", "Z poważaniem", "", "Jan Kowalski"].join("\n")
    )!;
    expect(markup.split("\n").filter((line) => line.startsWith("@"))).toEqual(["@MIEJSCE_DATA: Warszawa, dnia 1 października 2026 r.", "@NADAWCA:", "@TYTUL: WEZWANIE DO ZAPŁATY", "@PODPIS:"]);
    expect(markup).toContain("Z poważaniem");
  });
});
