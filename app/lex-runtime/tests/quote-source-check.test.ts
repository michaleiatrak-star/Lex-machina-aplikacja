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
