import { describe, expect, it } from "vitest";
import { continuesPipeline } from "./pleading-standard.js";
import { PIPELINE_LETTER_STEPS } from "./session-executor.js";

describe("a reply that continues the started pleading (XI P 27/26, 2026-11-25)", () => {
  it("recognises the chat's and the decision bar's messages", () => {
    for (const text of ["Kontynuuj.", "kontynuuj", "Dalej", "tak", "Zatwierdzam proponowaną strukturę i założenia robocze. Kontynuuj do pisma."]) {
      expect(continuesPipeline(text)).toBe(true);
    }
  });
  it("leaves a new request to the router", () => {
    for (const text of ["Przeanalizuj dowody w sprawie", "Kontynuuj analizę umowy najmu i wskaż ryzyka w § 5", "tak, ale dodaj wniosek o świadka"]) {
      expect(continuesPipeline(text)).toBe(false);
    }
  });
});

describe("correcting rounds in the pleading pipeline", () => {
  it("only in the steps that write or finally check the letter", () => {
    for (const step of ["CP-1a", "CP-1b", "CP-1c-skan", "CP-PD", "CP-FSL-D", "CP-1c-macierz", "CP-1c-lancuch", "CP-1d-anomalie", "CP-1d"]) expect(PIPELINE_LETTER_STEPS.has(step)).toBe(false);
    for (const step of ["CP-W1", "CP-ATAK", "CP-QUALITY", "CP-AUDYT"]) expect(PIPELINE_LETTER_STEPS.has(step)).toBe(true);
  });
});
