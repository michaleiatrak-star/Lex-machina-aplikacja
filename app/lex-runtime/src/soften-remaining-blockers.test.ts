import { describe, expect, it } from "vitest";
import { FinalizationGate, softenRemainingBlockers, UNCONFIRMED_CASE_MARKER_TEXT } from "./finalization-gate.js";
import { VerificationLedger } from "./verification-ledger.js";

// User 2026-11-15: a gate the corrective rounds did not settle gives warnings, not a blocked answer.
describe("ostatnia runda bramki G8: ⚠️ zamiast blokady", () => {
  it("sygnatura z pamięci modelu i zmyślony znacznik ✅: ⚠️ z powodem, żadnego ✅", () => {
    const ledger = new VerificationLedger();
    const text = [
      "Sąd Apelacyjny w Warszawie w wyroku VI ACa 999/20 przyjął, że kara umowna podlega miarkowaniu.",
      "Podstawa: art. 484 § 2 KC ✅ [VER: ELI DU/2025/1071, zmyślony]."
    ].join("\n");
    const gate = new FinalizationGate();
    expect(gate.evaluate(text, ledger).result).toBe("BLOCKED");
    const softened = softenRemainingBlockers(text, gate.evaluate(text, ledger));
    expect(softened.text).toContain(`VI ACa 999/20 ${UNCONFIRMED_CASE_MARKER_TEXT}`);
    expect(softened.text).not.toContain("✅");
    expect(softened.text).toMatch(/art\. 484 § 2 KC ⚠️ \[NIEWERYFIKOWANE\]/u);
    expect(softened.marked).toEqual(expect.arrayContaining(["VI ACa 999/20"]));
    expect(gate.evaluate(softened.text, ledger).result).not.toBe("BLOCKED");
  });
});
