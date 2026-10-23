import { describe, expect, it } from "vitest";
import { FinalizationGate, expectedVerificationMarker, markUnverifiedReferences, UNVERIFIED_MARKER_TEXT } from "../src/finalization-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";

// Test 500: blokady całej odpowiedzi z powodu jednego powołania (zrzuty finalizacji).
const base = { status: "VERIFIED" as const, sourceTier: "R1" as const, fetchedAt: "2026-10-22T00:00:00Z" };

describe("rehearsal finalization blocks", () => {
  it("reads 'art. 35 ust. 3 Prawa budowlanego' as that act, not as KPA named elsewhere in the answer", () => {
    const ledger = new VerificationLedger();
    ledger.add({ ...base, kind: "statute", claim: "art. 35 KPA", toolCallId: "a", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/1691/text.pdf", currentEli: "DU/2025/1691" });
    ledger.add({ ...base, kind: "statute", claim: "art. 35 ust. 3 Prawa budowlanego", toolCallId: "b", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/524/text.pdf", currentEli: "DU/2026/524" });
    const kpa = expectedVerificationMarker(ledger.latest("art. 35 KPA")!)!;
    const pb = expectedVerificationMarker(ledger.latest("art. 35 ust. 3 Prawa budowlanego")!)!;
    const text = [`Organ działa w terminie (art. 35 KPA ${kpa}).`, `Najpierw wzywa do usunięcia nieprawidłowości (art. 35 ust. 3 Prawa budowlanego ${pb}).`].join("\n");
    expect(new FinalizationGate().evaluate(text, ledger).result).toBe("PASS");
  });

  it("does not block a verified provision shown more cautiously with its own unverified marker", () => {
    const ledger = new VerificationLedger();
    ledger.add({ ...base, kind: "statute", claim: "art. 70c OP", toolCallId: "a", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/111/text.pdf" });
    const report = new FinalizationGate().evaluate(`Zawiadomienie z art. 70c OP ${UNVERIFIED_MARKER_TEXT} doręcza się przed upływem terminu.`, ledger);
    expect(report.result).toBe("DEGRADED");
  });

  it("accepts the Dz.U. address of the consolidated text a verified provision was read from", () => {
    const ledger = new VerificationLedger();
    ledger.add({ ...base, kind: "statute", claim: "art. 148 § 1 KK", toolCallId: "a", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2019/1950/text.html", currentEli: "DU/2019/1950" });
    const marker = expectedVerificationMarker(ledger.latest("art. 148 § 1 KK")!)!;
    const report = new FinalizationGate().evaluate(`Norma: art. 148 § 1 KK (t.j. Dz.U. 2019 poz. 1950) ${marker}`, ledger);
    expect(report.findings.find((finding) => finding.reference.kind === "journal")?.status).toBe("VERIFIED");
  });

  it("marks a signature the answer itself calls unconfirmed instead of blocking, and keeps blocking one given as certain", () => {
    const ledger = new VerificationLedger();
    const text = [
      "Sprawdziłem uchwałę I FPS 1/21, ale CBOSA zwróciła HTTP 503, więc nie mogę potwierdzić jej treści.",
      "Dotyczy to też uchwały I FPS 1/21.",
      "Sąd Apelacyjny w wyroku VI ACa 999/20 przyjął, że tak."
    ].join("\n");
    const gate = new FinalizationGate();
    const marked = markUnverifiedReferences(text, gate.evaluate(text, ledger));
    expect(marked.split("\n")[1]).toContain(`I FPS 1/21 ${UNVERIFIED_MARKER_TEXT}`);
    expect(marked.split("\n")[2]).not.toContain(UNVERIFIED_MARKER_TEXT);
    expect(gate.evaluate(marked, ledger).findings.filter((finding) => finding.status === "MISSING_LEDGER_RECORD").map((finding) => finding.reference.claim)).toEqual(["VI ACa 999/20"]);
  });
});

describe("status consistency on rehearsal answers", () => {
  it("keeps art. 110¹ apart from a verified art. 110 and the ⚠️ after a Dz.U. address with that address", async () => {
    const { reconcileStatusMarkers, evaluateStatusConsistency } = await import("../src/status-consistency-gate.js");
    const ledger = new VerificationLedger();
    ledger.add({ ...base, kind: "statute", claim: "art. 110 KC", toolCallId: "a", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf", currentEli: "DU/2026/795" });
    ledger.add({ ...base, kind: "statute", claim: "art. 418 KC", toolCallId: "b", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf#page=43", currentEli: "DU/2026/795" });
    const m110 = expectedVerificationMarker(ledger.latest("art. 110 KC")!)!;
    const m418 = expectedVerificationMarker(ledger.latest("art. 418 KC")!)!;
    const superscript = [`Przepis art. 110 KC ${m110} dotyczy czego innego.`, `Zapis art. 110¹ KC ${UNVERIFIED_MARKER_TEXT} nie został odczytany.`].join("\n");
    expect(evaluateStatusConsistency(superscript, ledger).result).toBe("PASS");

    const journal = `Tekst jednolity zawiera zmianę z Dz.U. 2026 poz. 507 ${UNVERIFIED_MARKER_TEXT}. Dla art. 418 KC ${UNVERIFIED_MARKER_TEXT} nie ma ona znaczenia.`;
    const reconciled = reconcileStatusMarkers(journal, ledger).text;
    expect(reconciled).toContain(`Dz.U. 2026 poz. 507 ${UNVERIFIED_MARKER_TEXT}`);
    expect(reconciled).toContain(`art. 418 KC ${m418}`);
  });
});
