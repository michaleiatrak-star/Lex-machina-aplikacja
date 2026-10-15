import { describe, expect, it } from "vitest";
import { answerCorrection, removedSentences, validAnswerCorrections } from "../src/answer-corrections.js";

describe("record of a correcting round", () => {
  const first = [
    "Wezwanie jest nieważne, bo nie wskazuje podstawy prawnej.",
    "Art. 6 KC ustanawia ciężar dowodu po stronie osoby wywodzącej skutki prawne. ✅ [VER: art. 6 KC, 2026-10-15]",
    "- Kwota 60 000 zł na pewno nie jest należna."
  ].join("\n");
  const corrected = "Art. 6 KC ustanawia ciężar dowodu po stronie osoby wywodzącej skutki prawne. ✅ [VER: art. 6 KC, 2026-10-15]\nKwestionuję zasadność żądania.";

  it("lists the sentences of the first version the corrected one dropped, verbatim", () => {
    expect(removedSentences(first, corrected)).toEqual([
      "Wezwanie jest nieważne, bo nie wskazuje podstawy prawnej.",
      "Kwota 60 000 zł na pewno nie jest należna."
    ]);
  });

  it("an answer only supplemented removes nothing", () => {
    expect(removedSentences(corrected, `${corrected}\nDodatkowe zdanie o terminie przedawnienia roszczenia.`)).toEqual([]);
  });

  it("is a valid stored record", () => {
    const record = answerCorrection("CASE_GROUNDING", ["art. 6 KC: teza nie wynika z tekstu"], first, corrected);
    expect(validAnswerCorrections([record])).toBe(true);
    expect(validAnswerCorrections([{ ...record, round: "OTHER" }])).toBe(false);
  });
});
