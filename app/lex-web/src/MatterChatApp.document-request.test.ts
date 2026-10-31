import { describe, expect, it } from "vitest";
import { directImageType, pendingFileMessage, directDocumentRequest, letterDocumentPlan, pleadingPipelineNeeded, refersToLastAnswer } from "./MatterChatApp.js";

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

  it("„proszę o …, docx” i „potrzebuję pozwu … w docx” to prośba o plik pisma (test 500)", () => {
    expect(directDocumentRequest("ZUS odmówił mi zasiłku chorobowego. Decyzja doręczona 25.09.2026. Proszę o odwołanie, docx.")?.format).toBe("docx");
    expect(directDocumentRequest("Doręczono mi nakaz zapłaty (doręczenie 15.10.2026). Proszę o sprzeciw — docx.")).toEqual({ format: "docx", documentType: "pleading" });
    expect(directDocumentRequest("Potrzebuję pozwu o zapłatę do sądu, w docx. Dłużnik ma siedzibę w Krakowie.")).toEqual({ format: "docx", documentType: "pleading" });
    expect(directDocumentRequest("Proszę o wyjaśnienie, co oznacza przedawnienie.")).toBeNull();
    expect(directDocumentRequest("Potrzebuję porady, czy mogę odstąpić od umowy.")).toBeNull();
  });

  it("„proszę o napisanie umowy”, „napisz umowę”, „proszę o dokument” to prośba o dokument", () => {
    for (const text of [
      "Proszę o napisanie umowy najmu lokalu mieszkalnego.",
      "Napisz umowę zlecenia dla grafika.",
      // Before: the contract mode in the chat; now a document request the server sends back to
      // the contract workflow (WORKFLOW_PIPELINE_REQUIRED) or renders when that workflow ended.
      "Napisz umowę o dzieło dla grafika",
      "Poproszę o sporządzenie wezwania do zapłaty.",
      "Proszę o wygenerowanie pełnomocnictwa.",
      "Proszę o dokument potwierdzający zwrot kaucji.",
      "Proszę o pismo do ZUS w sprawie zasiłku.",
      "Potrzebuję pozwu o zapłatę 14 500 zł."
    ]) {
      expect(directDocumentRequest(text), text).not.toBeNull();
    }
    expect(directDocumentRequest("Proszę o napisanie umowy najmu lokalu mieszkalnego.")?.documentType).toBe("contract");
  });

  it("prośba o wyjaśnienie, pozwolenie lub umówienie nie jest prośbą o dokument", () => {
    for (const text of [
      "Proszę o wyjaśnienie, co oznacza przedawnienie.",
      "Proszę o umówienie spotkania.",
      "Czy potrzebuję pozwolenia na budowę garażu?",
      // The document is what the answer is for (live C08-004).
      "W uchwale III CZP 11/20 SN przyjął teorię salda, prawda? Potrzebuję do pisma.",
      "Potrzebuję tego na rozprawę, jaki jest termin na apelację?",
      "Przeanalizuj tę umowę o pracę, reprezentuję pracownika."
    ]) {
      expect(directDocumentRequest(text), text).toBeNull();
    }
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
  ] as const)("generuje plik: %s", (text, documentType) => {
    expect(directDocumentRequest(text)).toEqual({ format: "docx", documentType });
  });

  it.each([
    // Frazy zgłoszone w weryfikacji 2026-10-06/07: typ + jawny format oraz typ + „jako plik".
    ["Sporządź wezwanie do zapłaty w wordzie", "docx", "letter"],
    ["zapisz opinię jako plik", "docx", "opinion"],
    ["Sporządź opinię prawną w formacie odt", "odt", "opinion"],
    ["Wyeksportuj pozew do pliku docx", "docx", "pleading"],
    ["Przerób tę reklamację na dokument do pobrania", "docx", "letter"]
  ] as const)("frazy odmienione i z sygnałem pliku: %s", (text, format, documentType) => {
    expect(directDocumentRequest(text)).toEqual({ format, documentType });
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
    "Zredaguj paragraf 5 tej umowy",
    "Jaki dokument muszę złożyć w urzędzie?"
  ])("nie generuje pliku (analiza, weryfikacja, pytanie, tryb umowy): %s", (text) => {
    expect(directDocumentRequest(text)).toBeNull();
  });
});

describe("szkic i gotowy dokument po cyklu pisma", () => {
  const base = {
    status: "DRAFT_PRESENTABLE",
    answer: "Kraków, dnia 3 marca 2026 r.\nAdresat: Spółka Przykład sp. z o.o., ul. Polna 1, 00-001 Warszawa\nODPOWIEDŹ NA WEZWANIE DO ZAPŁATY\nW odpowiedzi na wezwanie z dnia 20 lutego 2026 r. oświadczam, że kwestionuję roszczenie w całości. Wezwanie nie wskazuje podstawy faktycznej ani sposobu wyliczenia kwoty, a dołączone dokumenty nie potwierdzają wykonania usługi w terminie. Wzywam do przedstawienia dokumentów, na których oparto żądanie, w terminie 14 dni.\nNiniejsze pismo nie stanowi uznania roszczenia.\nZ poważaniem\n[podpis]",
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

  it("pismo procesowe: szkic sam po projekcie W2, gotowy dokument przy FINAL, bez pliku po innych krokach", () => {
    const view = (documentStatus: "DRAFT" | "FINAL", checkpoint?: string) => ({
      ...base,
      processWorkflow: { stage: "W3", documentStatus, ...(checkpoint ? { draftWritten: { version: 1, checkpoint } } : {}) }
    });
    expect(letterDocumentPlan(view("DRAFT") as never)).toBeNull();
    expect(letterDocumentPlan(view("DRAFT", "CP-QUALITY") as never)).toBeNull();
    expect(letterDocumentPlan(view("DRAFT", "CP-ATAK") as never)).toEqual({ documentType: "pleading", stage: "DRAFT" });
    expect(letterDocumentPlan(view("FINAL") as never)).toEqual({ documentType: "pleading", stage: "FINAL" });
  });

  it("pismo proste wybrane przez router w AUTO tworzy plik samo", () => {
    expect(letterDocumentPlan({ ...base, taskSkill: "pisma-proste-v2" } as never)).toEqual({ documentType: "letter", stage: "FINAL" });
    expect(letterDocumentPlan({ ...base, taskSkill: "analizator-umow-v1" } as never)).toBeNull();
  });

  it("pismo procesowe w AUTO bez pipeline'u: aplikacja proponuje pipeline, który sam zrobi plik", () => {
    expect(pleadingPipelineNeeded({ status: "DRAFT_PRESENTABLE", taskSkill: "pisma-procesowe-v3" } as never)).toBe(true);
    expect(
      pleadingPipelineNeeded({ status: "DRAFT_PRESENTABLE", taskSkill: "pisma-procesowe-v3", processWorkflow: { stage: "W1" } } as never)
    ).toBe(false);
    expect(pleadingPipelineNeeded({ status: "DRAFT_PRESENTABLE", taskSkill: "pisma-proste-v2" } as never)).toBe(false);
  });

  it("zwykła odpowiedź albo zablokowana sesja nie tworzy pliku", () => {
    expect(letterDocumentPlan({ ...base, workflow: { id: "LEGAL_QUERY_V1", result: "PASS", requiredResources: [], missingResources: [] } } as never)).toBeNull();
    expect(letterDocumentPlan({ ...base, status: "BLOCKED", workflow: { id: "SIMPLE_LETTER_V1" } } as never)).toBeNull();
  });
});

describe("plik z odpowiedzi, która sama jest pismem (bez tury modelu)", () => {
  it("„ok daj mi pismo” i „wygeneruj to w docx” to plik ostatniego pisma; nowe pismo nie", () => {
    for (const text of ["ok daj mi pismo", "daj mi pismo", "wygeneruj to w pliku docx", "Pobierz gotowe pismo", "zapisz powyższe jako plik", "wygeneruj odpowiedź w postaci dokumentu docx", "daj analizę w wordzie"]) {
      expect(refersToLastAnswer(text)).toBe(true);
    }
    for (const text of ["Przygotuj pismo do pracodawcy", "Napisz wezwanie do zapłaty", "daj mi nowe pismo", "napisz odpowiedź na pozew w docx"]) {
      expect(refersToLastAnswer(text)).toBe(false);
    }
  });

  it("pismo zachowane przez serwer (answerDocument) daje plan mechaniczny, nawet gdy pismo kończy się samym podpisem", () => {
    const result = {
      status: "DRAFT_PRESENTABLE",
      answer: "ODPOWIEDŹ NA WEZWANIE\n\nTreść pisma.\n\nJan Kowalski",
      taskSkill: "pisma-proste-v2",
      finalization: "PASS",
      verification: { records: 1, verified: 1, supported: 0, unverified: 0 },
      answerDocument: { sessionId: "session-1" }
    };
    expect(letterDocumentPlan(result as never)).toEqual({ documentType: "letter", stage: "FINAL", source: "ANSWER", answerSessionId: "session-1" });
    expect(letterDocumentPlan({ ...result, answer: result.answer + " [UZUPEŁNIJ]" } as never)).toMatchObject({ stage: "DRAFT", source: "ANSWER" });
  });
});

describe("plik dodany w czacie wstrzymuje wiadomość", () => {
  it("komunikat podaje stan tego pliku, nie trzy możliwe przyczyny (live C11-012)", () => {
    expect(pendingFileMessage("wyrok-skan.png", "FAILED", "brak silnika OCR")).toContain("nie został odczytany: brak silnika OCR");
    expect(pendingFileMessage("wyrok-skan.png", "PROCESSING")).toContain("jest jeszcze przetwarzany");
    expect(pendingFileMessage(undefined, "PENDING")).toMatch(/^Dodany plik czeka na Twoją decyzję/u);
  });
});

describe("obraz wysyłany do modelu w oryginale", () => {
  it("tylko PNG i JPEG (po typie albo rozszerzeniu)", () => {
    expect(directImageType({ name: "wyrok-skan.png", type: "" })).toBe("image/png");
    expect(directImageType({ name: "zdjecie.JPG", type: "" })).toBe("image/jpeg");
    expect(directImageType({ name: "x", type: "image/jpeg" })).toBe("image/jpeg");
    expect(directImageType({ name: "pozew.pdf", type: "application/pdf" })).toBeNull();
  });
});
