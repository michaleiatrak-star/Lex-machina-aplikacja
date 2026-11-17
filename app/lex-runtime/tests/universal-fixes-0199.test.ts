import { describe, expect, it } from "vitest";
import { admissions, letterBody } from "../src/admission-check.js";
import { requiredPassages } from "../src/answer-strength.js";
import { legible } from "../src/challenge-map.js";
import { classifyDocument } from "../src/document-kind.js";
import { argumentSchemaGaps } from "../src/pleading-standard.js";
import { ownLetter } from "../src/pleading-goals.js";
import { statuteQuoteFindings } from "../src/quote-source-check.js";
import { recordParties, recordPartiesPrompt } from "../src/record-parties.js";
import { documentHeadings } from "../src/session-executor.js";

const PROTOCOL = `Sygn. akt XI P 27/26
PROTOKÓŁ
Dnia 13 listopada 2026 r.
Sąd Okręgowy w Katowicach XI Wydział Pracy
Protokolant: st. sekr. sąd. A
Na rozprawie w sprawie z powództwa Jana Nowaka
przeciwko Alfa spółka z o.o. w Katowicach
o wynagrodzenie
Świadek Adam Kowal - lat 41, zawód mechanik.`;

describe("universal fixes 0.1.99 (user's app transcripts, 2026-11-17)", () => {
  it("a hearing protocol is a court record, its parties and case come from its heading, a witness is never a party", () => {
    expect(classifyDocument({ text: PROTOCOL }).kind.startsWith("PROTOKOL")).toBe(true);
    const parties = recordParties("d1", PROTOCOL)!;
    expect(parties).toMatchObject({ signature: "XI P 27/26", claimant: "Jana Nowaka", respondent: "Alfa spółka z o.o. w Katowicach", witnesses: ["Adam Kowal"] });
    const prompt = recordPartiesPrompt([{ ...parties, label: "protokół" }]);
    expect(prompt).toContain("świadek nigdy nie jest stroną");
    expect(prompt).toContain("najnowszego protokołu");
  });

  it("the domain is read from the documents' headings", () => {
    expect(documentHeadings([{ chunks: [{ text: PROTOCOL }] }, { sourceScope: "FIRM_TEMPLATE", chunks: [{ text: "wzór pozwu" }] }])).toContain("Wydział Pracy");
  });

  it("charges come only from the party's own letter, not from the opponent's counsel's", () => {
    expect(ownLetter("Zawiadomienie. Działając w imieniu Pani Anny Z., reprezentowanej przez adwokata, zarzucam…")).toBe(false);
    expect(ownLetter("Ja, Jan Nowak, działając w imieniu własnym, zarzucam adwokatowi naruszenie § 16 KEA.")).toBe(true);
  });

  it("an evidence motion in the plural or in a list after 'Wnoszę o:' counts", () => {
    const answer = "### UZASADNIENIE\nFakt ⬛ do wykazania.\n\nWnoszę o:\n1. dopuszczenie i przeprowadzenie dowodów z dokumentów.";
    expect(argumentSchemaGaps(answer).map((gap) => gap.element)).not.toContain("WNIOSEK DOWODOWY");
  });

  it("a concession in the notes outside the letter is not the party's word", () => {
    const answer = `=== PISMO ===\n${"Treść pisma. ".repeat(30)}\nUwagi poza pismem\nTeza rzecznika jest trafna co do RODO.`;
    expect(letterBody(answer)).not.toContain("trafna");
    expect(admissions(answer)).toEqual([]);
  });

  it("a quote marked with its case document is not compared with the provision beside it", () => {
    const statutes = [{ claim: "art. 190a § 1 KK", evidence: "Kto przez uporczywe nękanie innej osoby…" }];
    expect(statuteQuoteFindings("Zgodnie z art. 190a § 1 k.k. adwokat pisał: „każda taka sytuacja będzie traktowana jako nękanie” [[LEXDOC:d:1]].", statutes)).toEqual([]);
  });

  it("a garbled scan sentence is not legible; an ordinary legal one is", () => {
    expect(legible("Zakaz s 8 18 KE* chran poż przed nie stanowi naruszenia zasad.")).toBe(false);
    expect(legible("Brak jest podstaw do przyjęcia, że adwokat naruszył art. 17 § 1 pkt 2 k.p.k.")).toBe(true);
  });

  it("a passage about another case is never required", () => {
    const passages = [
      { documentId: "d", chunkIndex: 0, page: 1, text: "W sprawie VIII W 633/25 świadek zeznała inaczej.", weight: 1 },
      { documentId: "d", chunkIndex: 1, page: 1, text: "Świadek nie słyszał o zakazie kontaktu.", weight: 0.9 }
    ];
    expect(requiredPassages(passages, []).map((passage) => passage.chunkIndex)).toEqual([1]);
  });
});
