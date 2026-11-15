import { describe, expect, it } from "vitest";
import { FinalizationGate, markUnverifiedReferences } from "../src/finalization-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";

// Live test 2026-11-15: "art. 278" named in the application's own note was marked at the start
// of "art. 278 § 4 KK" earlier on the line: "art. 278 ⚠️ [NIEWERYFIKOWANE] § 4 KK".
describe("marker placement for an unverified provision", () => {
  it("never splits a longer citation and never marks a mention inside the application's note", () => {
    const text =
      "Wyjątek: osoba najbliższa — art. 278 § 4 KK, co nie wchodzi w grę. ⚠️ [PRZEPIS ODCZYTANY, TEZA POTWIERDZONA CZĘŚCIOWO: Brzmienie dotyczy art. 278 i nie wspomina o rozdziale. Brzmienie: „Kto zabiera…”] Rozdział zaczyna art. 278 KK.";
    const report = new FinalizationGate().evaluate(text, new VerificationLedger());
    const marked = markUnverifiedReferences(text, report);
    expect(marked).not.toMatch(/art\. 278 ⚠️ \[NIEWERYFIKOWANE\] §/u);
    expect(marked).toContain("art. 278 § 4 KK ⚠️ [NIEWERYFIKOWANE]");
    expect(marked).not.toMatch(/dotyczy art\. 278 ⚠️/u);
  });
});

describe("a lead's signature is not from the case's materials", () => {
  it("a signature found only by a web search gets plain ⚠️, the user's own one 'z materiałów sprawy'", async () => {
    const { VerificationLedger } = await import("../src/verification-ledger.js");
    const ledger = new VerificationLedger();
    ledger.addLeadCase("SDI 7/12");
    ledger.addMaterialCase("I C 900/26");
    const text = "Tego dnia SN wydał też SDI 7/12. Sprawa użytkownika: I C 900/26.";
    const report = new FinalizationGate().evaluate(text, ledger);
    const marked = markUnverifiedReferences(text, report, new Set(ledger.caseReferences()), new Set(), new Set(ledger.leadCases()));
    expect(marked).toContain("SDI 7/12 ⚠️ [NIEWERYFIKOWANE]");
    expect(marked).not.toContain("SDI 7/12 ⚠️ [NIEWERYFIKOWANE: z materiałów sprawy]");
    expect(marked).toContain("I C 900/26 ⚠️ [NIEWERYFIKOWANE: z materiałów sprawy]");
  });
});
