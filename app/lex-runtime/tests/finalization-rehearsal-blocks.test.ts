import { describe, expect, it } from "vitest";
import { FinalizationGate, addMissingVerificationMarkers, expectedVerificationMarker, markUnverifiedReferences, UNVERIFIED_MARKER_TEXT } from "../src/finalization-gate.js";
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

describe("live rehearsal over the Claude account (C07-001, C03-016)", () => {
  it("a verified provision shown ⚠️ in every place is understated, not blocking", async () => {
    const { evaluateStatusConsistency } = await import("../src/status-consistency-gate.js");
    const ledger = new VerificationLedger();
    ledger.add({ ...base, kind: "statute", claim: "art. 1088 KC", toolCallId: "a", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf", currentEli: "DU/2026/795" });
    const text = [`Art. 1088 KC ${UNVERIFIED_MARKER_TEXT} jest uchylony.`, `Zapis o uchyleniu art. 1088 KC ${UNVERIFIED_MARKER_TEXT} nie odpowiada na pytanie.`].join("\n");
    expect(evaluateStatusConsistency(text, ledger).result).toBe("PASS");
  });

  it("drops another provision's real marker copied onto a line, keeps the line's own", () => {
    const ledger = new VerificationLedger();
    ledger.add({ ...base, kind: "statute", claim: "art. 477^9 § 1 KPC", toolCallId: "a", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/468/text.pdf#page=93" });
    ledger.add({ ...base, kind: "statute", claim: "art. 477^9 § 3 KPC", toolCallId: "b", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/468/text.pdf#page=92" });
    const m1 = expectedVerificationMarker(ledger.latest("art. 477^9 § 1 KPC")!)!;
    const m3 = expectedVerificationMarker(ledger.latest("art. 477^9 § 3 KPC")!)!;
    const text = [`Termin: art. 477^9 § 1 KPC ${m1}.`, `Odrzucenie spóźnionego odwołania: art. 477^9 § 3 KPC ${m1}.`].join("\n");
    const gate = new FinalizationGate();
    const report = gate.evaluate(text, ledger);
    expect(report.result).toBe("BLOCKED");
    const repaired = addMissingVerificationMarkers(text, report);
    expect(repaired.split("\n")[1]).toContain(m3);
    expect(repaired.split("\n")[1]).not.toContain(m1);
    expect(gate.evaluate(repaired, ledger).result).toBe("PASS");
  });
});

describe("powołanie z ustępem i cudzy znacznik z rejestru (test 500, C12 na żywo)", () => {
  it("art. X ust. Y jest wykrywane z ustępem; znacznik art. 35 KPA przy art. 35 ust. 3 Prawa budowlanego nie przechodzi jako VERIFIED", async () => {
    const { detectLegalReferences } = await import("../src/finalization-gate.js");
    expect(detectLegalReferences("Podstawa: art. 6 ust. 4 ustawy o ochronie praw lokatorów.").filter((item) => item.kind === "statute").map((item) => item.claim)).toEqual(["art. 6 ust. 4"]);
    expect(detectLegalReferences("Zob. art. 10 ust. 1 pkt 2 ustawy.").filter((item) => item.kind === "statute").map((item) => item.claim)).toEqual(["art. 10 ust. 1 pkt 2"]);
  });
});

describe("cudzy znacznik z rejestru przy powołaniu z ustępem (test 500, zrzut 1792713885540)", () => {
  it("znacznik art. 35 KPA zdjęty z wiersza o art. 35 ust. 3 Prawa budowlanego, właściwy dopisany", async () => {
    const { FinalizationGate, addMissingVerificationMarkers, expectedVerificationMarker, verifiedLedgerMarkers } = await import("../src/finalization-gate.js");
    const { VerificationLedger } = await import("../src/verification-ledger.js");
    const ledger = new VerificationLedger();
    // Daty rekordów na dziś: wynik nie zależy od dnia uruchomienia testu.
    const now = new Date().toISOString();
    for (const record of RECORDS_35) ledger.add({ ...record, fetchedAt: now, freshnessCheckedAt: now } as never);
    const kpa = expectedVerificationMarker(ledger.all().find((record) => record.claim === "art. 35 KPA")!)!;
    const own = expectedVerificationMarker(ledger.all().find((record) => record.claim.startsWith("art. 35 ust. 3"))!)!;
    const text = `Treść: urząd nie wydał postanowienia z art. 35 ust. 3, więc odmowa była przedwczesna. ${kpa}`;
    const report = new FinalizationGate().evaluate(text, ledger);
    expect(report.result).toBe("BLOCKED");
    const fixed = addMissingVerificationMarkers(text, report, verifiedLedgerMarkers(ledger));
    expect(fixed).not.toContain(kpa);
    expect(fixed).toContain(own);
    expect(new FinalizationGate().evaluate(fixed, ledger).result).not.toBe("BLOCKED");
  });
});

const RECORDS_35 = [{"claim": "art. 35 ust. 3 Prawa budowlanego", "kind": "statute", "sourceUrl": "https://api.sejm.gov.pl/eli/acts/DU/2026/524/text.pdf", "sourceTier": "R1", "toolCallId": "toolu_0159WdYu83ijgknGodwvqQEh", "verificationMethod": "file_read", "sourceFormat": "PDF", "temporalMode": "CURRENT", "currentEli": "DU/2026/524", "status": "VERIFIED", "sourceAnchorUrl": "https://api.sejm.gov.pl/eli/acts/DU/2026/524/text.pdf#page=38", "fetchedAt": "2026-10-22T20:32:42.484Z", "retrieval": "RAG", "temporalFreshnessStatus": "CURRENT", "freshnessCheckedAt": "2026-10-22T23:58:45.460Z", "evidence": "Art. 35. 1. Przed wydaniem decyzji o pozwoleniu na budowę lu"}, {"claim": "art. 35 KPA", "kind": "statute", "sourceUrl": "https://api.sejm.gov.pl/eli/acts/DU/2025/1691/text.pdf", "sourceTier": "R1", "toolCallId": "gate-i-auto-1", "verificationMethod": "file_read", "sourceFormat": "PDF", "temporalMode": "CURRENT", "currentEli": "DU/2025/1691", "status": "VERIFIED", "sourceAnchorUrl": "https://api.sejm.gov.pl/eli/acts/DU/2025/1691/text.pdf#page=8", "fetchedAt": "2026-10-22T20:19:42.721Z", "retrieval": "RAG", "temporalFreshnessStatus": "CURRENT", "freshnessCheckedAt": "2026-10-22T23:58:31.628Z", "evidence": "Art. 35. § 1. Organy administracji publicznej obowiązane są "}];

describe("sygnatura podana jako przykład a sygnatura sprawy użytkownika (test 500, C12-008)", () => {
  it("przykład po „np.” dostaje ⚠️ zamiast blokady; sygnatura akt użytkownika przechodzi bez oznaczeń", async () => {
    const { FinalizationGate, markUnverifiedReferences, addMissingVerificationMarkers } = await import("../src/finalization-gate.js");
    const { VerificationLedger } = await import("../src/verification-ledger.js");
    const example = "**Pismo zawiera 19 pól do uzupełnienia.** Podaj dane, np. „sygn. I Nc 123/26; instalacja nie grzeje”, a wstawię je.";
    const ledger = new VerificationLedger();
    const report = new FinalizationGate().evaluate(example, ledger);
    expect(report.result).toBe("BLOCKED");
    const marked = addMissingVerificationMarkers(markUnverifiedReferences(example, report, new Set(), new Set()), report);
    expect(marked).toMatch(/I Nc 123\/26[^\n]*⚠️/u);
    expect(new FinalizationGate().evaluate(marked, ledger).result).not.toBe("BLOCKED");

    const own = new VerificationLedger();
    own.addCaseFileNumber("I Nc 123/26");
    expect(new FinalizationGate().evaluate("Sprzeciw od nakazu zapłaty w sprawie sygn. I Nc 123/26.", own).result).not.toBe("BLOCKED");
  });
});

describe("orzeczenie z materiałów sprawy (dokumenty użytkownika, kancelarii, równoległe postępowania)", () => {
  it("dostaje ⚠️ ze wskazaniem źródła i nie blokuje; zwykła niepotwierdzona sygnatura dostaje samo ⚠️", async () => {
    const { FinalizationGate, markUnverifiedReferences, addMissingVerificationMarkers, CASE_MATERIAL_MARKER_TEXT } = await import("../src/finalization-gate.js");
    const { VerificationLedger } = await import("../src/verification-ledger.js");
    const ledger = new VerificationLedger();
    ledger.addCaseReference("II C 456/25");
    const text = "W równoległej sprawie sygn. II C 456/25 sąd uznał roszczenie za zasadne.";
    const report = new FinalizationGate().evaluate(text, ledger);
    const marked = addMissingVerificationMarkers(markUnverifiedReferences(text, report, new Set(ledger.caseReferences()), new Set()), report);
    expect(marked).toContain(`II C 456/25 ${CASE_MATERIAL_MARKER_TEXT}`);
    expect(new FinalizationGate().evaluate(marked, ledger).result).not.toBe("BLOCKED");
  });
});
