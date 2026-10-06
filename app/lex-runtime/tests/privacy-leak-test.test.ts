import { describe, expect, it } from "vitest";
import { sealResidualValues } from "../src/privacy/pseudonymizer.js";

describe("leak test of the outgoing text", () => {
  const original = "Jan Kowalski (PESEL 80010112345) pozwał spółkę. Pełnomocnik Jan Kowalski żąda zapłaty; Jan Kowalskiego nie dotyczy.";
  it("seals a second occurrence of a replaced value with the same token, longest value first", () => {
    const findings = [
      { start: 0, end: 12, token: "[OSOBA_1]" },
      { start: 20, end: 31, token: "[PESEL_1]" }
    ];
    expect(original.slice(0, 12)).toBe("Jan Kowalski");
    expect(original.slice(20, 31)).toBe("80010112345");
    // The recognizer replaced the first mention only; the same full value later in the text was missed.
    const protectedText = "[OSOBA_1] (PESEL [PESEL_1]) pozwał spółkę. Pełnomocnik Jan Kowalski żąda zapłaty; Jan Kowalskiego nie dotyczy.";
    const sealed = sealResidualValues(original, protectedText, findings);
    // A whole-word match only: "Jan Kowalskiego" (another form) is left to the pseudonymizer's inflection.
    expect(sealed.text).toBe("[OSOBA_1] (PESEL [PESEL_1]) pozwał spółkę. Pełnomocnik [OSOBA_1] żąda zapłaty; Jan Kowalskiego nie dotyczy.");
    expect(sealed.sealed).toBe(1);
  });
  it("changes nothing when the text is already tight; skips values shorter than 3 characters", () => {
    const tight = "[OSOBA_1] pozwał spółkę.";
    expect(sealResidualValues("Jo pozwał spółkę.", tight, [{ start: 0, end: 2, token: "[OSOBA_1]" }])).toEqual({ text: tight, sealed: 0 });
  });
});
