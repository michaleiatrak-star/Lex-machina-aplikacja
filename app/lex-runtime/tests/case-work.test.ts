import { describe, expect, it } from "vitest";
import { caseWorkBlock, recordCaseWork } from "../src/case-work.js";
import { CAUSAL_QUESTION } from "../src/session-executor.js";

const doc = "doc_0123456789abcdef01234567";

describe("rejestr prac sprawy", () => {
  it("analiza dokumentu: otwarta, dopóki kolejne tury nie przeczytają reszty stron; potem zamknięta", () => {
    const first = recordCaseWork([], {
      now: "2026-10-15T10:00:00.000Z",
      skill: "analiza-sadowa-v6",
      documentAnalysis: true,
      coverage: [{ documentId: doc, title: "akta.pdf", totalPages: 40, pages: [[1, 12]], status: "PARTIAL" }]
    });
    expect(first[0]).toMatchObject({ kind: "DOCUMENT_ANALYSIS", status: "OPEN", pages: [[1, 12]] });
    expect(caseWorkBlock(first)).toContain("OTWARTE: analiza dokumentu „akta.pdf” — przeczytane s. 1–12 z 40, brakuje s. 13–40");
    const done = recordCaseWork(first, {
      now: "2026-10-15T11:00:00.000Z",
      documentAnalysis: true,
      coverage: [{ documentId: doc, totalPages: 40, pages: [[13, 40]], status: "PARTIAL" }]
    });
    expect(done[0]).toMatchObject({ status: "DONE", pages: [[1, 40]], skill: "analiza-sadowa-v6" });
    expect(caseWorkBlock(done)).toContain("ZAMKNIĘTE: analiza dokumentu „akta.pdf” w całości (40 s.)");
  });

  it("zwykłe pytanie nie zapisuje analizy; chronologia i zakończony etap tak, otwarte na początku", () => {
    expect(recordCaseWork([], { now: "2026-10-15T10:00:00.000Z", coverage: [{ documentId: doc, totalPages: 40, pages: [[3, 4]], status: "PARTIAL" }] })).toEqual([]);
    const items = recordCaseWork(
      [{ key: `DOCUMENT_ANALYSIS:${doc}`, kind: "DOCUMENT_ANALYSIS", label: "akta.pdf", status: "OPEN", at: "2026-10-01T10:00:00.000Z", documentId: doc, totalPages: 40, pages: [[1, 2]] }],
      { now: "2026-10-15T10:00:00.000Z", chronologySaved: true, completedWorkflows: ["CHRONOLOGY_V1"] }
    );
    expect(items.map((item) => [item.status, item.kind])).toEqual([
      ["OPEN", "DOCUMENT_ANALYSIS"],
      ["DONE", "CHRONOLOGY"],
      ["DONE", "WORKFLOW"]
    ]);
    expect(caseWorkBlock(items)).toContain("nie wykonuj ich od nowa");
  });
});

describe("pytanie o związek przyczynowy we własnej sprawie", () => {
  it.each([
    ["Czy jest związek przyczynowy między wypadkiem a utratą pracy?", true],
    ["Czy zwolnienie spowodowało pogorszenie zdrowia?", true],
    ["Pokaż, co z czego wynika w tej sprawie.", true],
    ["Czy da się wykluczyć związek między tymi zdarzeniami?", true],
    ["Zbuduj oś czasu zdarzeń.", false],
    ["Jaki jest termin na apelację?", false]
  ])("%s → %s", (question, expected) => {
    expect(CAUSAL_QUESTION.test(question)).toBe(expected);
  });
});
