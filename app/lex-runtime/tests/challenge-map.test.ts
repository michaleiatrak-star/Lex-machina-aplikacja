import { describe, expect, it } from "vitest";
import { challengeMapPrompt, challengedDecision, decisionTheses, isChallenge } from "../src/challenge-map.js";

// RD 121/26: the reasons of the decision refusing to open disciplinary proceedings (abridged).
const DECISION = `POSTANOWIENIE o odmowie wszczęcia dochodzenia dyscyplinarnego
Zastępca Rzecznika Dyscyplinarnego Izby Adwokackiej w Katowicach na zasadzie art. 95n pkt 1 PrAdw w zw. z art. 305 § 1 i art. 17 § 1 pkt 2 k.p.k. postanawia odmówić wszczęcia dochodzenia.
UZASADNIENIE
Zakaz z § 16 KEA chroni przed wykorzystywaniem groźby ścigania karnego jako środka nacisku. Taka sytuacja nie zachodzi.
Pismo nie zapowiada złożenia zawiadomienia o przestępstwie, a ocena ta dotyczy wyłącznie tego zachowania, którego zaprzestania mocodawcy żądają.
Zastrzeżenie, że dalsze kontakty będą traktowane jako działanie umyślne, służy natomiast udokumentowaniu braku zgody na kontakt.
Pismo z dnia 4 maja 2026 roku jest wyważone, rzeczowe i pozbawione gróźb.
Opisane zachowanie nie zawiera znamion przewinienia dyscyplinarnego, co zgodnie z art. 17 § 1 pkt 2 k.p.k. uzasadnia odmowę.
Od niniejszego postanowienia służy zażalenie. Zażalenie należy złożyć w 3 egzemplarzach.`;
const VERDICT = "WYROK W IMIENIU RZECZYPOSPOLITEJ POLSKIEJ Sygn. akt VIII W 633/25 Sąd Rejonowy uniewinnia obwinionego.";

describe("challenge map: the grounds answer the decision's reasons (RD 121/26)", () => {
  it("a challenge of the rzecznik's decision: that decision, not the verdict in the files", () => {
    const question = "przygotuj podważenie postanowienia zastępcy rzecznika dyscyplinarnego";
    expect(isChallenge(question)).toBe(true);
    expect(isChallenge("streść protokół rozprawy")).toBe(false);
    const decision = challengedDecision([{ documentId: "doc_verdict", text: VERDICT }, { documentId: "doc_decision", text: DECISION }], question);
    expect(decision?.documentId).toBe("doc_decision");
  });

  it("the reasons are the theses; the instruction on the remedy is not; abbreviations do not cut them", () => {
    const theses = decisionTheses(DECISION).map((thesis) => thesis.text);
    expect(theses).toContain("Taka sytuacja nie zachodzi.");
    expect(theses).toContain("Pismo nie zapowiada złożenia zawiadomienia o przestępstwie, a ocena ta dotyczy wyłącznie tego zachowania, którego zaprzestania mocodawcy żądają.");
    expect(theses).toContain("Pismo z dnia 4 maja 2026 roku jest wyważone, rzeczowe i pozbawione gróźb.");
    expect(theses).toContain("Opisane zachowanie nie zawiera znamion przewinienia dyscyplinarnego, co zgodnie z art. 17 § 1 pkt 2 k.p.k. uzasadnia odmowę.");
    expect(theses.some((thesis) => /zażalenie/u.test(thesis))).toBe(false);
    const prompt = challengeMapPrompt({ documentId: "doc_decision", label: "postanowienie" }, decisionTheses(DECISION));
    expect(prompt).toContain("T1. „");
    expect(prompt).toContain("nigdy osobny zarzut");
  });
});
