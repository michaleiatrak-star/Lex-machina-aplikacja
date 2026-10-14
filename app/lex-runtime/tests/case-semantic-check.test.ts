import { describe, expect, it } from "vitest";
import { citedDocuments } from "../src/case-content-grounding.js";
import { parseSemanticVerdicts, relevantExcerpt, semanticJudgePrompt, semanticProblems } from "../src/case-semantic-check.js";

const SN_TEXT = JSON.stringify({
  sygnatura: "I KZP 3/24",
  tresc: "Uchwała składu siedmiu sędziów. Udział w składzie sądu osoby powołanej na wniosek KRS w nowym składzie (tzw. neosędziów) nie powoduje automatycznie nieważności orzeczenia; konieczna jest ocena okoliczności konkretnej sprawy."
});

describe("cited documents", () => {
  it("finds judgments, tax interpretations, TK, KIO and verified provisions with their source text", () => {
    const answer = [
      "Uchwała SN sygn. I KZP 3/24 dotyczy neosędziów.",
      "",
      "Interpretacja 0114-KDIP4-2.4012.123.2024.1.AB uznała prawo do odliczenia.",
      "",
      "Wyrok TK K 3/21 oraz wyrok KIO 1234/24 omówiono niżej.",
      "",
      "Art. 415 KC stanowi o odpowiedzialności za szkodę wyrządzoną z winy."
    ].join("\n");
    const sources = [
      SN_TEXT,
      "{\"sygnatura\":\"0114-KDIP4-2.4012.123.2024.1.AB\",\"tresc\":\"Stanowisko wnioskodawcy jest prawidłowe.\"}",
      "{\"sygnatura\":\"K 3/21\",\"tresc\":\"Trybunał orzekł...\"}",
      "{\"sygnatura\":\"KIO 1234/24\",\"tresc\":\"Izba oddaliła odwołanie...\"}",
      "{\"claim\":\"art. 415 KC\",\"status\":\"VERIFIED\",\"evidence\":\"Kto z winy swej wyrządził drugiemu szkodę, obowiązany jest do jej naprawienia.\"}"
    ];
    const cited = citedDocuments(answer, sources);
    expect(cited.map((document) => [document.kind, document.signature])).toEqual([
      ["case", "I KZP 3/24"],
      ["interpretation", "0114-KDIP4-2.4012.123.2024.1.AB"],
      ["other", "K 3/21"],
      ["other", "KIO 1234/24"],
      ["statute", "Art. 415 KC"]
    ]);
    expect(cited.at(-1)!.text).toContain("Kto z winy swej wyrządził");
  });

  it("skips a signature no source returned", () => {
    expect(citedDocuments("Wyrok SN sygn. II CSK 1/20.", [SN_TEXT])).toEqual([]);
  });
});

describe("semantic verdicts", () => {
  const documents = citedDocuments("Uchwała SN sygn. I KZP 3/24: wyroki z udziałem neosędziów są nieważne.", [SN_TEXT]);

  it("keeps a verdict whose quote is in the document", () => {
    const check = parseSemanticVerdicts(
      'Ocena: {"verdicts":[{"signature":"I KZP 3/24","topic":"MATCH","claim":"UNSUPPORTED","reason":"Uchwała mówi odwrotnie.","quote":"nie powoduje automatycznie nieważności orzeczenia"}]}',
      documents
    );
    expect(check.rejected).toEqual([]);
    expect(semanticProblems(check)).toMatchObject([{ signature: "I KZP 3/24", claim: "UNSUPPORTED" }]);
  });

  it("rejects a verdict quoting words the document does not have", () => {
    const check = parseSemanticVerdicts(
      '{"verdicts":[{"signature":"I KZP 3/24","topic":"NO_MATCH","claim":"UNSUPPORTED","reason":"x","quote":"orzeczenie dotyczy przedawnienia roszczeń"}]}',
      documents
    );
    expect(check.verdicts).toEqual([]);
    expect(check.rejected).toEqual(["I KZP 3/24"]);
  });

  it("survives a non-JSON answer of the judge", () => {
    expect(parseSemanticVerdicts("Nie potrafię ocenić.", documents)).toEqual({ verdicts: [], rejected: [] });
  });

  it("sends the head and the passages closest to the question from a long document", () => {
    const filler = "Sąd rozważył zarzuty proceduralne dotyczące doręczeń. ".repeat(400);
    const text = `Wyrok WSA sygn. II SA/Wa 1/26 z 1.02.2026 r. ${filler} Pełnomocnik powołał nieistniejące orzeczenia wygenerowane przez narzędzie sztucznej inteligencji. ${filler}`;
    const excerpt = relevantExcerpt(text, "wyrok o halucynacjach sztucznej inteligencji pełnomocnika", "pełnomocnik powołał nieistniejące orzeczenia");
    expect(excerpt.startsWith("Wyrok WSA sygn. II SA/Wa 1/26")).toBe(true);
    expect(excerpt).toContain("narzędzie sztucznej inteligencji");
    expect(excerpt.length).toBeLessThan(8_000);
    expect(semanticJudgePrompt("pytanie", documents)).toContain("DOKUMENT D1: orzeczenie I KZP 3/24");
  });
});
