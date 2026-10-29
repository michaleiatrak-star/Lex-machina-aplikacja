import { describe, expect, it } from "vitest";
import { answerCorrection, emptyDeferral, removedSentences, validAnswerCorrections } from "../src/answer-corrections.js";

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

  it("a sentence the round only added an act name to is kept, not removed", () => {
    const before = "Wyjątek z art. 17 ust. 3 lit. e chroni dane potrzebne do dochodzenia roszczeń.";
    expect(removedSentences(before, "Wyjątek z art. 17 ust. 3 lit. e RODO chroni dane potrzebne do dochodzenia roszczeń.")).toEqual([]);
    expect(removedSentences(before, "Wyjątek z art. 17 RODO nie ma tu zastosowania.")).toEqual([before]);
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

describe("an answer without substance", () => {
  it("a deferral without a question or a list of what is missing is caught; questions and letters are not", () => {
    const deferral =
      "Nie mogę jeszcze sporządzić bezpiecznej, kompletnej odpowiedzi procesowej bez domknięcia wymaganych kontroli dokumentu i podstaw prawnych. Dalsza odpowiedź zostanie przygotowana po ich zakończeniu.\n⚖️ Ważna informacja: Niniejsza analiza ma charakter wyłącznie informacyjny.";
    expect(emptyDeferral(deferral)).toBe(true);
    const missing =
      "Nie mogę bezpiecznie przygotować finalnego pisma na tym etapie bez danych krytycznych:\n* dane i adres nadawcy;\n* miejscowość sporządzenia;\n* adres adresata.\nPo ich podaniu przygotuję projekt.";
    expect(emptyDeferral(missing)).toBe(false);
    expect(emptyDeferral("Nie mogę jeszcze odpowiedzieć: czy doszło do zapłaty?")).toBe(false);
    expect(emptyDeferral("Wezwanie nie wskazuje konkretnych naruszeń, więc kwestionuję je w całości.")).toBe(false);
    // An announced verification ("muszę najpierw zweryfikować… Następnie przedstawię…") is no answer either.
    expect(emptyDeferral("Przygotuję odpowiedź, ale do jej bezpiecznego sporządzenia muszę najpierw zweryfikować przepisy dotyczące zakazu konkurencji. Następnie przedstawię gotowy projekt pisma.")).toBe(true);
    expect(emptyDeferral("Aby przygotować dokument, potrzebuję jeszcze potwierdzenia podstaw prawnych dotyczących zakazu konkurencji.")).toBe(true);
    expect(emptyDeferral("**Nie mogę jeszcze sporządzić** odpowiedzi; zostanie przygotowana po weryfikacji.")).toBe(true);
  });
});
