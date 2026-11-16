import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { passageUsed, strengthCorrection, strengthGaps } from "../src/answer-strength.js";

const P = (chunkIndex: number, text: string) => ({ documentId: "doc_protocol", chunkIndex, page: chunkIndex + 1, text });
const PASSAGES = [
  P(3, "Każda taka sytuacja będzie traktowana jako nękanie i będzie zgłaszana do odpowiednich organów."),
  P(4, "Wskazania wymaga, że Zgłaszająca złożyła zawiadomienie o możliwości popełnienia przestępstwa z art. 190a."),
  P(5, "Policja i prokuratura będą mogły ocenić te fakty, a ich praca doprowadzi do wyjaśnienia sprawy."),
  P(6, "oraz zapowiada wszelkie dostępne kroki prawne, adwokat naruszył § 16 KEA."),
  P(7, "zostały podjęte próby w postaci złożenia zawiadomień o możliwości popełnienia przestępstwa")
];
const RULINGS = ["SDI 9/12", "WSD 127/12", "WSD 77/22", "WSD 108/22", "SDI 27/13"];

describe("strength of a pleading after it is written (RD 121/26)", () => {
  it("the application's draft of 0.1.93: passages left out, two rulings of eight, theses conceded", () => {
    const draft = [
      "zapowiedź „wszelkie dostępne kroki prawne” bez uprzedzenia (§ 16 KEA).",
      "„zostały podjęte próby w postaci złożenia zawiadomień o możliwości popełnienia przestępstwa”.",
      "SDI 9/12 oraz WSD 127/12.",
      "| T5 (pismo nie powołuje RODO) | **bez odpowiedzi**: teza trafna |"
    ].join("\n");
    const gaps = strengthGaps(draft, PASSAGES, RULINGS);
    expect(gaps.map((gap) => gap.kind)).toEqual(["PASSAGE", "CASE_LAW", "CONCEDED"]);
    expect(gaps[0]!.detail).toContain("będzie zgłaszana do odpowiednich organów");
    expect(gaps[1]!.label).toBe("orzecznictwo: powołane 2 z 5 odczytanych");
    const instruction = strengthCorrection(gaps);
    expect(instruction).toContain("co najmniej trzy orzeczenia");
    expect(instruction).toContain("spółka ich nie ma");
  });

  it("a strong draft passes: passages quoted or marked, three rulings, nothing conceded", () => {
    const draft = [
      "oświadczył, że każda sytuacja „będzie traktowana jako nękanie i będzie zgłaszana do odpowiednich organów”",
      "[[LEXDOC:doc_protocol:4]] [[LEXDOC:doc_protocol:5]] [[LEXDOC:doc_protocol:6]]",
      "SDI 9/12, WSD 127/12 i WSD 77/22."
    ].join("\n");
    expect(strengthGaps(draft, PASSAGES, RULINGS)).toEqual([]);
    expect(passageUsed("tekst bez cytatu", PASSAGES[0]!)).toBe(false);
  });

  it("the real 0.1.93 draft of RD 121/26 is caught (when the test files are present)", () => {
    const file = "/tmp/claude-0/-home-user-lex-machina/94e67631-7449-5bf1-befa-fad0c239395b/scratchpad/chat/rd093.md";
    if (!fs.existsSync(file)) return;
    const kinds = strengthGaps(fs.readFileSync(file, "utf8"), PASSAGES, ["SDI 9/12", "WSD 127/12", "WSD 77/22", "WSD 108/22", "WSD 88/16", "WSD 36/19", "SDI 27/13", "SDI 23/07"]).map((gap) => gap.kind);
    expect(kinds).toContain("CASE_LAW");
    expect(kinds).toContain("CONCEDED");
    expect(kinds).toContain("PASSAGE");
  });
});

describe("a deferral with empty control blocks is still a deferral (RD 121/26, 0.1.94 run 3)", async () => {
  const { emptyDeferral } = await import("../src/answer-corrections.js");
  it("is caught", () => {
    const answer = "Czekam na wynik niezależnej recenzji projektu, zanim oddam gotowe pismo.\n\nCN-GATE\nOś sporu 1: … norma centralna: ⬛ niewskazana.\n" + "  CN-1 czasowy: ⬛ brak normy do oceny.\n".repeat(60) + "\nREM-GATE\nREM-0 próby: 0";
    expect(emptyDeferral(answer)).toBe(true);
  });
});
