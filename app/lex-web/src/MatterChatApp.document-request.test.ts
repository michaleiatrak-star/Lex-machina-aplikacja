import { describe, expect, it } from "vitest";
import { directDocumentRequest, letterDocumentPlan } from "./MatterChatApp.js";

describe("rozpoznanie prośby o plik pisma", () => {
  it("doc, docx, Word i „plik” z czasownikiem to generowanie .docx", () => {
    for (const text of [
      "Wygeneruj plik doc z napisem ok",
      "wygeneruj plik docx z napisem ok",
      "Przygotuj to w Wordzie",
      "daj plik z tym pismem",
      "ok wygeneruj to w pliku docx"
    ]) {
      expect(directDocumentRequest(text)?.format).toBe("docx");
    }
    expect(directDocumentRequest("zapisz jako odt")?.format).toBe("odt");
  });

  it("szkic z panelu pipeline'u to plik pisma procesowego", () => {
    expect(directDocumentRequest("Przygotuj plik docx: pismo procesowe z zapisanego projektu sprawy.")).toEqual({
      format: "docx",
      documentType: "pleading"
    });
  });

  it("zwykłe pytanie nie uruchamia generowania pliku", () => {
    expect(directDocumentRequest("Jaki jest termin przedawnienia?")).toBeNull();
    expect(directDocumentRequest("co jest w tym pliku?")).toBeNull();
  });
});

describe("żądanie dokumentu a analiza i weryfikacja dokumentu", () => {
  it.each([
    ["wygeneruj to w postaci dokumentu do pobrania", "other"],
    ["Daj mi to do pobrania", "other"],
    ["Zapisz tę odpowiedź jako plik", "other"],
    ["Przygotuj pismo do pracodawcy", "other"],
    ["Napisz wezwanie do zapłaty", "letter"],
    ["Przygotuj reklamację butów", "letter"],
    ["Sporządź opinię prawną", "opinion"],
    ["Napisz apelację od wyroku", "pleading"],
    ["Przygotuj odpowiedź na pozew", "pleading"],
    ["Wygeneruj umowę w Wordzie", "contract"],
    ["Daj tę umowę do pobrania", "contract"],
    ["Przeanalizuj ten dokument i wygeneruj raport w pliku docx", "report"]
  ])("generuje plik: %s", (text, documentType) => {
    expect(directDocumentRequest(text)).toEqual({ format: "docx", documentType });
  });

  it.each([
    "Przeanalizuj dokument",
    "Wykonaj analizę prawną dokumentu, wskaż wadliwe zapisy",
    "Zweryfikuj ten dokument pod kątem błędów",
    "Sprawdź plik, czy jest kompletny",
    "Co jest w tym pliku?",
    "Czy w pliku są błędy?",
    "Przygotuj analizę tego dokumentu",
    "Oceń pismo przeciwnika",
    "Napisz umowę o dzieło dla grafika",
    "Zredaguj paragraf 5 tej umowy",
    "Jaki dokument muszę złożyć w urzędzie?"
  ])("nie generuje pliku (analiza, weryfikacja, pytanie, tryb umowy): %s", (text) => {
    expect(directDocumentRequest(text)).toBeNull();
  });
});

describe("szkic i gotowy dokument po cyklu pisma", () => {
  const base = {
    status: "DRAFT_PRESENTABLE",
    answer: "TREŚĆ PISMA ...",
    finalization: "PASS",
    gateI: { gate: "G39I", result: "PASS" },
    verification: { records: 1, verified: 1, supported: 0, unverified: 0 }
  } as const;

  it("pismo proste: gotowy dokument, gdy wszystkie bramki przeszły; inaczej szkic", () => {
    expect(letterDocumentPlan({ ...base, workflow: { id: "SIMPLE_LETTER_V1", result: "PASS", requiredResources: [], missingResources: [] } } as never))
      .toEqual({ documentType: "letter", stage: "FINAL" });
    expect(letterDocumentPlan({
      ...base,
      verification: { records: 2, verified: 1, supported: 0, unverified: 1 },
      workflow: { id: "SIMPLE_LETTER_V1", result: "PASS", requiredResources: [], missingResources: [] }
    } as never)).toEqual({ documentType: "letter", stage: "DRAFT" });
  });

  it("pismo procesowe: bez pliku na etapach (szkic tylko na żądanie), gotowy dokument przy statusie FINAL", () => {
    const view = (documentStatus: "DRAFT" | "FINAL") => ({ ...base, processWorkflow: { stage: "W2", documentStatus } });
    expect(letterDocumentPlan(view("DRAFT") as never)).toBeNull();
    expect(letterDocumentPlan(view("FINAL") as never)).toEqual({ documentType: "pleading", stage: "FINAL" });
  });

  it("zwykła odpowiedź albo zablokowana sesja nie tworzy pliku", () => {
    expect(letterDocumentPlan({ ...base, workflow: { id: "LEGAL_QUERY_V1", result: "PASS", requiredResources: [], missingResources: [] } } as never)).toBeNull();
    expect(letterDocumentPlan({ ...base, status: "BLOCKED", workflow: { id: "SIMPLE_LETTER_V1" } } as never)).toBeNull();
  });
});
