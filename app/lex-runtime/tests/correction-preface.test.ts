import { describe, expect, it } from "vitest";
import { withoutCorrectionPreface } from "../src/execution-engine.js";

describe("correcting round: the answer, not a report on the round", () => {
  it("drops a preface about the correction (live C02-011)", () => {
    const answer = "Tak, Policja może kazać mężowi wyjść z mieszkania.\n\nDalsza treść.";
    expect(withoutCorrectionPreface(`Sprawdziłam wszystkie przepisy w źródłach urzędowych i przeszłam przez kwalifikator karny. Poniżej pełna, poprawiona odpowiedź.\n\n${answer}`)).toBe(answer);
    expect(withoutCorrectionPreface(`Poniżej poprawiona wersja odpowiedzi.\n${answer}`)).toBe(answer);
  });

  it("keeps an answer that opens with its own content", () => {
    const answer = "Poniżej opisuję, co Pani grozi i co zrobić.\n\nTreść.";
    expect(withoutCorrectionPreface(answer)).toBe(answer);
    expect(withoutCorrectionPreface("Jedna linia: poprawiona odpowiedź.")).toBe("Jedna linia: poprawiona odpowiedź.");
  });
});
