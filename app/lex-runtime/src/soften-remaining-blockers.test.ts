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

  // Live test 2026-11-27 (contract, Sonnet): the ✅ of art. 484 § 2 KC a few words after "art. 6 ustawy
  // lokatorskiej" was taken as art. 6's own marker, nothing was inserted, the turn stayed blocked.
  it("a ✅ of another provision a few words on does not stand for the claim's marker", () => {
    const ledger = new VerificationLedger();
    ledger.add({"claim": "art. 484 § 2 KC", "kind": "statute", "sourceUrl": "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf", "sourceTier": "R1", "toolCallId": "c7", "verificationMethod": "file_read", "sourceFormat": "PDF", "temporalMode": "CURRENT", "currentEli": "DU/2026/795", "status": "VERIFIED", "sourceAnchorUrl": "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf#page=50", "fetchedAt": "2026-11-19T11:05:29.646Z", "retrieval": "RAG", "temporalFreshnessStatus": "CURRENT", "freshnessCheckedAt": "2026-11-27T00:50:26.844Z", "evidence": "Art. 484. § 1. W razie niewykonania lub nienależytego wykonania zobowiązania kara umowna należy się wierzycielowi w zastrzeżonej na ten wypadek wysokości bez względu na wysokość poniesionej szkody. Żądanie odszkodowania\nprzenoszącego wysokość zastrzeżonej kary nie jest dopuszczalne, chyba że strony inaczej postanowiły.\n§ 2. Jeżeli zobowiązanie zostało w znacznej części wykonane, dłużnik może żądać"});
    const text = "  - Wynik: art. 484 § 2 KC stosuje się; art. 6 ustawy lokatorskiej warunkowo ✅ [VER: https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf#page=50, 2026-11-19, ŹRÓDŁO: RAG (kopia t.j. z ELI)]";
    const gate = new FinalizationGate();
    expect(gate.evaluate(text, ledger).result).toBe("BLOCKED");
    const softened = softenRemainingBlockers(text, gate.evaluate(text, ledger));
    expect(softened.text).toContain("art. 6 ⚠️ [NIEWERYFIKOWANE]");
    expect(gate.evaluate(softened.text, ledger).result).not.toBe("BLOCKED");
  });
});
