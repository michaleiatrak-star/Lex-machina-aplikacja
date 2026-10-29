import { describe, expect, it } from "vitest";
import { completeBareArticleActs, FinalizationGate, expectedVerificationMarker } from "../src/finalization-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";

// W3 i test 500: model powołuje "art. 36a" bez aktu (43% odpowiedzi); bramki zgadywały akt i
// zgłaszały konflikty statusów. Akt z rejestru tury dopisuje aplikacja, bez rundy modelu.
const base = { kind: "statute" as const, status: "VERIFIED" as const, sourceTier: "R1" as const, fetchedAt: "2026-10-29T00:00:00Z" };

function ledger(...records: Array<{ claim: string; evidence?: string }>): VerificationLedger {
  const result = new VerificationLedger();
  records.forEach((record, index) => result.add({ ...base, ...record, toolCallId: `v${index}`, sourceUrl: `https://api.sejm.gov.pl/eli/acts/DU/2026/${100 + index}/text.pdf` }));
  return result;
}

describe("act of a bare article from the turn's verified records", () => {
  it("writes the one verified act after a bare article, before its marker, and the gate reads it", () => {
    const records = ledger({ claim: "art. 36a ustawy o kosztach sądowych w sprawach cywilnych" });
    const marker = expectedVerificationMarker(records.latest("art. 36a ustawy o kosztach sądowych w sprawach cywilnych")!)!;
    const text = `Opłata stała wynosi 100 zł (art. 36a ${marker}).`;
    const { text: out, completed } = completeBareArticleActs(text, records);
    expect(out).toBe(`Opłata stała wynosi 100 zł (art. 36a ustawy o kosztach sądowych w sprawach cywilnych ${marker}).`);
    expect(completed).toHaveLength(1);
  });

  it("leaves a code's article with 'ust.' (another act's unit) and an article written with another act elsewhere", () => {
    const records = ledger({ claim: "art. 35 KPA", evidence: "Art. 35. § 1. Organy administracji publicznej obowiązane są załatwiać sprawy bez zbędnej zwłoki. § 3. Załatwienie sprawy …" });
    expect(completeBareArticleActs("Organ wzywa do usunięcia braków (art. 35 ust. 3).", records).completed).toEqual([]);
    const both = ["Termin: art. 35 KPA.", "Wezwanie: art. 35 ust. 3 Prawa budowlanego.", "Dlatego art. 35 rozstrzyga."].join("\n");
    expect(completeBareArticleActs(both, records).completed).toEqual([]);
  });

  it("leaves an article verified in two acts, and one already named in words", () => {
    const records = ledger({ claim: "art. 11 KC" }, { claim: "art. 11 Prawa upadłościowego" });
    expect(completeBareArticleActs("Zob. art. 11.", records).completed).toEqual([]);
    const one = ledger({ claim: "art. 70c Ordynacji podatkowej" });
    expect(completeBareArticleActs("Zawiadomienie z art. 70c Ordynacji podatkowej doręcza się podatnikowi.", one).completed).toEqual([]);
  });

  it("makes a bare article the gate could not place a verified one", () => {
    const records = ledger({ claim: "art. 49g Prawa budowlanego" }, { claim: "art. 7 KPA" });
    const m49 = expectedVerificationMarker(records.latest("art. 49g Prawa budowlanego")!)!;
    const m7 = expectedVerificationMarker(records.latest("art. 7 KPA")!)!;
    const text = `Organ stosuje art. 7 KPA ${m7}, a opłatę legalizacyjną ustala art. 49g ${m49}.`;
    const completed = completeBareArticleActs(text, records);
    expect(completed.text).toContain("art. 49g Prawa budowlanego");
    expect(new FinalizationGate().evaluate(completed.text, records).result).toBe("PASS");
  });
});
