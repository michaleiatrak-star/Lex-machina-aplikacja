import { describe, expect, it } from "vitest";
import { documentParts, fullDocumentMatrix, explicitNoFacts, type ModelCall } from "../src/fact-matrix.js";
import { buildRegister, matrixColumns, registerGaps, registerTable } from "../src/document-register.js";
import { confirmedSteps, stFinal, verified } from "../src/step-register.js";
import { chargeGoal, officialFactGoals, partyCharges, unaddressedCharges } from "../src/pleading-goals.js";
import { admissions, citedProvisions } from "../src/admission-check.js";
import { deadlineProvisions } from "../src/deadline-wording.js";
import { argumentSchemaGaps, refusalOnExplanations } from "../src/pleading-standard.js";
import { factRows } from "../src/fact-matrix.js";

const doc = (record: string, documentId: string, text: string) => ({ record, documentId, chunks: [{ index: 0, text }] });

describe("RD 121/26: every document is read (fact-matrix fullDocumentMatrix)", () => {
  it("cuts a large document into parts of about 20k characters", () => {
    const paragraph = "Akapit protokołu z rozprawy z dnia 16 października 2025 r. ".repeat(20);
    const big = doc("D01 — protokół", "d1", Array.from({ length: 50 }, () => paragraph).join("\n\n"));
    const parts = documentParts(big, 20_000);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[0]!.part).toBe(`D01 — protokół (cz. 1/${parts.length})`);
    expect(parts.every((part) => part.units.reduce((sum, unit) => sum + unit.text.length, 0) <= 21_000)).toBe(true);
  });

  it("reads every part, sends an empty part back once and accepts only an explicit no-facts answer", async () => {
    const documents = [
      doc("D01 — protokół", "d1", "Pełnomocnik oświadczył, że każda taka sytuacja będzie traktowana jako nękanie i będzie zgłaszana do odpowiednich organów."),
      doc("D02 — koperta", "d2", "Potwierdzenie odbioru przesyłki poleconej."),
      doc("D03 — pismo", "d3", "Pismo bez treści dotyczącej tematów sprawy, nieczytelny skan.")
    ];
    const calls: string[] = [];
    const call: ModelCall = async (system, user) => {
      calls.push(system.slice(0, 120));
      if (/Etap 1/u.test(system)) return { text: '{"temat": "zapowiedź zgłaszania", "cechy": ["treść"], "dokumenty": ["D01 — protokół"]}', failure: "" };
      if (user.includes("## D01")) return { text: '{"temat": "zapowiedź zgłaszania", "cecha": "treść", "wartosc": "nękanie zgłaszane organom", "cytat": "każda taka sytuacja będzie traktowana jako nękanie"}', failure: "" };
      if (/KONTROLA POKRYCIA/u.test(system) && user.includes("## D02")) return { text: '{"brak": "brak faktów do tematów", "powod": "potwierdzenie odbioru"}', failure: "" };
      return { text: "", failure: "" };
    };
    const result = await fullDocumentMatrix(documents, "podważenie postanowienia", call, { concurrency: 3 });
    expect(result.coverage.map((item) => item.state)).toEqual(["READ", "NO_FACTS", "GAP"]);
    // D02 and D03 went back once (coverage check), D01 did not.
    expect(calls.filter((item) => /KONTROLA POKRYCIA/u.test(item)).length).toBe(2);
    expect(explicitNoFacts('{"brak": "brak faktów do tematów", "powod": "x"}')).toBe("x");
    expect(explicitNoFacts('{"temat": "a"}')).toBeNull();
  });
});

describe("register D01..DN and the matrix columns", () => {
  const documents = Array.from({ length: 10 }, (_, index) => ({
    documentId: `d${index + 1}`,
    label: index === 0 ? "postanowienie" : index === 1 ? "protokół" : "dokument",
    kind: index === 0 ? "POSTANOWIENIE" : index === 1 ? "PROTOKOL" : "INNE",
    category: index === 0 ? "ORZECZENIE" : index === 1 ? "DOWOD" : "INNE",
    chars: 1_000 * (index + 1),
    firstChunk: 0
  }));

  it("gives own columns to the challenged decision, protocols and the largest, the rest to one column", () => {
    const columns = matrixColumns(documents, "d1");
    expect(columns.get("d1")).toBe("D01 zaskarżone rozstrzygnięcie");
    expect(columns.get("d2")).toBe("D02 protokół");
    expect(columns.get("d10")).toBe("D10 dokument");
    expect(columns.get("d3")).toBe("Pozostałe dokumenty (4)");
    expect(new Set(columns.values()).size).toBe(7);
  });

  it("marks unread documents as gaps and prints the table", () => {
    const register = buildRegister(documents.slice(0, 3), [
      { record: "D01 — postanowienie", documentId: "d1", parts: 1, facts: 5, state: "READ", reasons: [] },
      { record: "D02 — protokół", documentId: "d2", parts: 2, facts: 0, state: "GAP", reasons: ["D02 (cz. 2/2): limit czasu"] }
    ]);
    expect(registerGaps(register).map((entry) => entry.id)).toEqual(["D02", "D03"]);
    const table = registerTable(register, false);
    expect(table).toContain("przeczytano 1/3");
    expect(table).not.toContain("LEXDOC");
  });
});

describe("ST-FINAL from the turn's evidence", () => {
  it("is a draft while HYBRID-VALIDATION has not run, verified when every step is confirmed", () => {
    const register = buildRegister([{ documentId: "d1", label: "postanowienie", kind: "POSTANOWIENIE", category: "ORZECZENIE", chars: 100, firstChunk: 0 }], [
      { record: "D01 — postanowienie", documentId: "d1", parts: 1, facts: 3, state: "READ", reasons: [] }
    ]);
    const evidence = {
      register,
      documentsDelivered: true,
      preW2: { schemaLeft: [], gapsLeft: [], requiredMissing: 0 },
      gates: [{ id: "LEGAL_CITATIONS", result: "PASS" }],
      answer: "Treść.\n\nZałączniki:\n1. postanowienie"
    };
    const draft = confirmedSteps(evidence);
    expect(verified(draft)).toBe(false);
    expect(stFinal(draft)).toContain("SZKIC — NIEZWERYFIKOWANY");
    const done = confirmedSteps({ ...evidence, checkpoints: [{ checkpoint: "CP-AUDYT", status: "CLOSED" }] });
    expect(verified(done)).toBe(true);
    expect(stFinal(done)).toContain("PISMO ZWERYFIKOWANE");
    expect(verified(confirmedSteps({ ...evidence, checkpoints: [{ checkpoint: "CP-AUDYT", status: "CLOSED" }], gates: [{ id: "CASE_SIGNATURES", result: "BLOCKED" }] }))).toBe(false);
  });
});

describe("mandatory goals: official facts and the party's charges", () => {
  it("takes a single statement of a protocol on the matter as a goal", () => {
    const rows = factRows([
      { topic: "zapowiedź zgłaszania", attribute: "oświadczenie pełnomocnika", value: "nękanie zgłaszane organom", record: "D02 — protokół", quote: "każda taka sytuacja będzie traktowana jako nękanie", documentId: "d2", chunkIndex: 0 },
      { topic: "data pisma", attribute: "data", value: "4 maja", record: "D05 — pismo", quote: "z dnia 4 maja", documentId: "d5", chunkIndex: 0 }
    ]);
    const goals = officialFactGoals(rows, new Set(["D02 — protokół"]), "nękanie zgłaszanie organom adwokat");
    expect(goals).toHaveLength(1);
    expect(goals[0]!.goal).toContain("każda taka sytuacja będzie traktowana jako nękanie");
  });

  it("turns each charge of the earlier letter into a goal and finds the unanswered ones", () => {
    const charges = partyCharges(
      "Zawiadamiam o przewinieniu. Adwokat naruszył § 16 KEA, zapowiadając zgłaszanie mnie do organów jako nękanie. Ponadto przetwarza moje dane osobowe bez podstawy prawnej, ujawniając je spółkom. Proszę o wszczęcie postępowania."
    );
    expect(charges).toHaveLength(2);
    expect(chargeGoal("D04", charges[0]!)).toContain("podtrzymać z dowodem albo wycofać z podaniem powodu");
    expect(unaddressedCharges("Pismo omawia wyłącznie zapowiedź zgłaszania do organów jako nękanie i § 16 KEA adwokat naruszył.", charges)).toEqual([charges[1]]);
  });
});

describe("admissions, deadlines and evidence motions", () => {
  it("detects a conceded thesis and the provisions to read", () => {
    const draft = "Teza postanowienia w zakresie RODO jest trafna, bo art. 17 ust. 3 lit. e RODO wyłącza prawo do usunięcia.\nW pozostałym zakresie odpieram.";
    expect(admissions(draft)).toHaveLength(1);
    expect(admissions("Organ ma rację co do daty.")).toHaveLength(1);
    expect(admissions("Nie podtrzymuję zarzutu dotyczącego RODO.")).toHaveLength(1);
    expect(citedProvisions(draft).map((item) => item.claim)).toEqual(["art. 17 ust. 3 lit. e RODO"]);
  });

  it("finds the provision that decides a deadline", () => {
    expect(deadlineProvisions("Zażalenie wnosi się w terminie 14 dni od doręczenia (art. 88a ust. 1 Pr. adw.).").map((item) => item.claim)).toEqual([
      "art. 88a ust. 1 Pr. adw."
    ]);
    expect(deadlineProvisions("Zgodnie z art. 6 RODO dane przetwarza się zgodnie z prawem.")).toEqual([]);
  });

  it("requires an evidence motion for a fact outside the material and access to the files after a refusal on explanations", () => {
    const draft = "UZASADNIENIE\n\n## 1. Zapowiedź\nOkoliczność ta nie została udokumentowana, może to potwierdzić świadek.\n\nWnoszę o uchylenie postanowienia.";
    const gaps = argumentSchemaGaps(draft, { refusalOnExplanations: true }).map((gap) => gap.element);
    expect(gaps).toContain("WNIOSEK DOWODOWY");
    expect(gaps).toContain("WNIOSEK O DOSTĘP DO AKT");
    const fixed = `${draft}\nWnoszę o dopuszczenie dowodu z przesłuchania świadka. Wnoszę o udostępnienie akt postępowania, w tym kopii wyjaśnień.`;
    const after = argumentSchemaGaps(fixed, { refusalOnExplanations: true }).map((gap) => gap.element);
    expect(after).not.toContain("WNIOSEK DOWODOWY");
    expect(after).not.toContain("WNIOSEK O DOSTĘP DO AKT");
    expect(
      refusalOnExplanations([
        { kind: "POSTANOWIENIE", category: "ORZECZENIE", text: "POSTANOWIENIE o odmowie wszczęcia. Z wyjaśnień adwokata wynika, że..." }
      ])
    ).toBe(true);
  });
});
