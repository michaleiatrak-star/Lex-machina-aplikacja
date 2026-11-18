import { describe, expect, it } from "vitest";
import { QUOTE_UNSOURCED_MARKER } from "../src/document-citations.js";
import { documentQuoteFindings, quoteCorrectionPrompt, statuteQuoteFindings } from "../src/quote-source-check.js";

const kc = [{ claim: "art. 483 § 1 KC", evidence: "§ 1. Można zastrzec w umowie, że naprawienie szkody wynikłej z niewykonania lub nienależytego wykonania zobowiązania niepieniężnego nastąpi przez zapłatę określonej sumy (kara umowna)." }];

describe("quote against its source (user 2026-11-08)", () => {
  it("a quote of a provision that is not its verified wording is a finding, with the wording", () => {
    const answer = "Zgodnie z art. 483 § 1 KC karę można zastrzec „za niewykonanie każdego zobowiązania pieniężnego lub niepieniężnego”.";
    const found = statuteQuoteFindings(answer, kc);
    expect(found).toHaveLength(1);
    expect(found[0]!.wording).toContain("zobowiązania niepieniężnego");
    expect(quoteCorrectionPrompt(found)).toContain("Zastąp cytat dosłownym fragmentem");
  });

  it("the exact wording passes, also with the provision named after the quote and other punctuation", () => {
    expect(statuteQuoteFindings("Kara umowna dotyczy „niewykonania lub nienależytego wykonania zobowiązania niepieniężnego”, art. 483 § 1 KC.", kc)).toEqual([]);
  });

  it("a quote of another country's article read in this turn is checked the same way", () => {
    const ch = [{ claim: "art. 2 (CH)", evidence: "1 Jedermann hat in der Ausübung seiner Rechte und in der Erfüllung seiner Pflichten nach Treu und Glauben zu handeln." }];
    expect(statuteQuoteFindings("Art. 2 ZGB: „Jedermann hat bei der Ausübung seiner Rechte ehrlich zu handeln”.", ch)).toHaveLength(1);
  });

  it("a quote the document gate marked becomes a document finding", () => {
    const marked = `Umowa przewiduje, że „Wykonawca przenosi prawa także do utworów przyszłych” ${QUOTE_UNSOURCED_MARKER}.`;
    expect(documentQuoteFindings(marked)).toEqual([{ kind: "DOCUMENT", quote: "Wykonawca przenosi prawa także do utworów przyszłych" }]);
  });
});

describe("the quote's source is the provision of the same act, or another source the model read", () => {
  const ledger = [
    { claim: "art. 4 pkt 1 RODO", evidence: "1) „dane osobowe” oznaczają wszelkie informacje o zidentyfikowanej lub możliwej do zidentyfikowania osobie fizycznej" },
    { claim: "art. 17 § 1 pkt 2 k.p.k.", evidence: "Art. 17. § 1. Nie wszczyna się postępowania, a wszczęte umarza, gdy: 2) czyn nie zawiera znamion czynu zabronionego" },
    { claim: "art. 17 ust. 3 lit. e RODO", evidence: "3. Ust. 1 i 2 nie mają zastosowania, w zakresie w jakim przetwarzanie jest niezbędne: e) do ustalenia, dochodzenia lub obrony roszczeń." },
    { claim: "art. 190a KK", evidence: "Art. 190a. § 1. Kto przez uporczywe nękanie innej osoby wzbudza u niej poczucie zagrożenia" }
  ];

  it("an article of the same number in another act is not the quote's source", () => {
    const answer = "Przepis przejściowy (art. 4 ust. 1 tej ustawy) stosuje przepisy dotychczasowe „do postępowań wszczętych i niezakończonych przed dniem wejścia w życie niniejszej ustawy”.";
    expect(statuteQuoteFindings(answer, ledger)).toEqual([]);
  });

  it("a code named after the provision picks that code's record", () => {
    const passes = "Prawa do usunięcia nie stosuje się, gdy przetwarzanie jest niezbędne „do ustalenia, dochodzenia lub obrony roszczeń” (art. 17 ust. 3 lit. e RODO).";
    expect(statuteQuoteFindings(passes, ledger)).toEqual([]);
    const wrong = "Według art. 17 § 1 pkt 2 k.p.k. nie wszczyna się postępowania, gdy „czyn nie zawiera żadnych znamion przestępstwa”.";
    expect(statuteQuoteFindings(wrong, ledger)).toHaveLength(1);
  });

  it("words of a case document or a ruling read in the turn are not a misquoted provision", () => {
    const letter = "Mocodawcy podejmą bez dalszego uprzedzenia wszelkie dostępne kroki prawne.";
    const answer = "Pismo wskazuje art. 190a kk i „podejmą bez dalszego uprzedzenia wszelkie dostępne kroki prawne”.";
    expect(statuteQuoteFindings(answer, ledger, [letter])).toEqual([]);
    expect(statuteQuoteFindings(answer, ledger)).toHaveLength(1);
    const marked = `${answer} Wcześniej: „podejmą bez dalszego uprzedzenia wszelkie dostępne kroki prawne” [[LEXDOC:d1:0]].`;
    expect(statuteQuoteFindings(marked, ledger)).toEqual([]);
  });
});
