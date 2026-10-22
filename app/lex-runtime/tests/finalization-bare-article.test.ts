import { describe, expect, it } from "vitest";
import { FinalizationGate, addMissingVerificationMarkers, expectedVerificationMarker, markUnverifiedReferences, UNVERIFIED_MARKER_TEXT } from "../src/finalization-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";

// Próba generalna 0.1.45: prosta odpowiedź o przedawnieniu ceny sprzedaży była blokowana,
// bo "art. 118" bez nazwy aktu i "2 lata" w nagłówku nie łączyły się z rekordami ELI.
function ledger(): VerificationLedger {
  const result = new VerificationLedger();
  const base = { kind: "statute" as const, status: "VERIFIED" as const, sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf", sourceTier: "R1" as const, fetchedAt: "2026-10-22T00:00:00Z" };
  result.add({
    ...base, claim: "art. 554 KC", toolCallId: "v554",
    evidence: "Art. 554. Roszczenia z tytułu sprzedaży dokonanej w zakresie działalności przedsiębiorstwa sprzedawcy, roszczenia rzemieślników z takiego tytułu oraz roszczenia prowadzących gospodarstwa rolne z tytułu sprzedaży płodów rolnych i leśnych przedawniają się z upływem lat dwóch."
  });
  result.add({
    ...base, claim: "art. 118 KC", toolCallId: "v118",
    evidence: "Art. 118. Jeżeli przepis szczególny nie stanowi inaczej, termin przedawnienia wynosi sześć lat, a dla roszczeń o świadczenia okresowe oraz roszczeń związanych z prowadzeniem działalności gospodarczej - trzy lata. Koniec terminu przedawnienia przypada na ostatni dzień roku kalendarzowego, chyba że termin przedawnienia jest krótszy niż dwa lata."
  });
  return result;
}

describe("a bare article and a period in a heading", () => {
  it("takes 'art. 118' for the only verified art. 118 (KC) and '2 lata' in the heading from the answer's provisions", () => {
    const records = ledger();
    const m554 = expectedVerificationMarker(records.latest("art. 554 KC")!)!;
    const m118 = expectedVerificationMarker(records.latest("art. 118 KC")!)!;
    const text = [
      "## Termin przedawnienia: 2 lata",
      "",
      `**Podstawa prawna:** art. 554 Kodeksu cywilnego ${m554}`,
      `Zwykle roszczenia firm przedawniają się po 3 latach. Tak stanowi art. 118 KC ${m118}.`,
      "Przy sprzedaży przepisem szczególnym wobec Art. 118 jest art. 554, dlatego obowiązuje termin 2 lata."
    ].join("\n");
    const gate = new FinalizationGate();
    const report = gate.evaluate(text, records);
    const repaired = addMissingVerificationMarkers(markUnverifiedReferences(text, report), report);
    expect(repaired).not.toContain(UNVERIFIED_MARKER_TEXT);
    expect(gate.evaluate(repaired, records).result).toBe("PASS");
  });

  it("does not take a bare article for another act's article, nor a number missing from every provision", () => {
    const records = ledger();
    const report = new FinalizationGate().evaluate(["Rozporządzenie Rady Ministrów: art. 118.", "Termin wynosi 7 lat."].join("\n"), records);
    expect(report.findings.map((finding) => finding.status)).toEqual(["MISSING_LEDGER_RECORD", "UNVERIFIED_NOT_MARKED"]);
  });
});
