import { describe, expect, it } from "vitest";
import { addMissingVerificationMarkers, FinalizationGate, markUnverifiedReferences } from "../src/finalization-gate.js";
import { evaluateStatusConsistency, reconcileStatusMarkers, unifyConflictingProvisions } from "../src/status-consistency-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";

const KPC = "https://api.sejm.gov.pl/eli/acts/DU/2026/468/text.pdf";
const KC = "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf";
const ledgerOf = (records: Array<[string, string]>) => {
  const ledger = new VerificationLedger();
  for (const [claim, sourceUrl] of records) {
    ledger.add({ claim, kind: "statute", status: "VERIFIED", sourceUrl, fetchedAt: "2026-10-19T10:00:00.000Z", sourceTier: "R1", verificationMethod: "web_fetch_pdf" });
  }
  return ledger;
};
const marked = (text: string, ledger: VerificationLedger) => {
  const report = new FinalizationGate().evaluate(text, ledger);
  return reconcileStatusMarkers(addMissingVerificationMarkers(markUnverifiedReferences(text, report), report), ledger).text;
};

describe("przepis zweryfikowany w rozmowie zostaje zweryfikowany w piśmie", () => {
  it("„art. 187 § 1 pkt 3 Kodeksu postępowania cywilnego”: znacznik nie rozcina powołania, ✅ z rejestru", () => {
    const ledger = ledgerOf([["art. 187 § 1 pkt 3 KPC", KPC]]);
    const out = marked("W wezwaniu powołano art. 187 § 1 pkt 3 Kodeksu postępowania cywilnego.\nTeza o art. 187 § 1 pkt 3 KPC nie wynika z dokumentu.", ledger);
    expect(out).not.toContain("NIEWERYFIKOWANE");
    expect(out).toContain("art. 187 § 1 pkt 3 Kodeksu postępowania cywilnego.");
    expect(evaluateStatusConsistency(out, ledger).result).toBe("PASS");
  });

  it("zweryfikowany paragraf obejmuje swoje punkty", () => {
    const ledger = ledgerOf([["art. 187 § 1 KPC", KPC]]);
    expect(ledger.latest("art. 187 § 1 pkt 3 KPC")?.status).toBe("VERIFIED");
    expect(ledger.latest("art. 188 § 1 pkt 3 KPC")).toBeUndefined();
  });
});

describe("sprzeczne znaczniki bez rozstrzygnięcia w rejestrze: draft, nie blokada", () => {
  it("przepis bez rekordu dostaje ⚠️ we wszystkich miejscach, zweryfikowany obok zachowuje ✅", () => {
    const ledger = ledgerOf([["art. 1 KC", KC]]);
    const marker = `✅ [VER: ${KC}, 2026-10-19]`;
    const text = `Zob. art. 5 KC i art. 1 KC ${marker}\nPonadto art. 5 KC ⚠️ [NIEWERYFIKOWANE].`;
    expect(evaluateStatusConsistency(text, ledger).result).toBe("BLOCKED");
    const { text: out, unified } = unifyConflictingProvisions(text, ledger);
    expect(unified).toEqual(["art. 5 kc"]);
    expect(out.split("\n")[0]).toBe(`Zob. art. 5 KC ⚠️ [NIEWERYFIKOWANE] i art. 1 KC ${marker}`);
    expect(evaluateStatusConsistency(out, ledger).findings.filter((f) => f.code === "CONFLICTING_STATUS")).toEqual([]);
  });
});
