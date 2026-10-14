import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateCheckpointOutput } from "../src/process-checkpoint-contract.js";
import { createDeterministicWorkflowPlan, evaluateDeterministicWorkflowOutput } from "../src/deterministic-workflow.js";
import { classifyDocument } from "../src/document-kind.js";
import { FinalizationGate, ownCaseFileNumbers } from "../src/finalization-gate.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { schemaCatalog, skillModules } from "../src/skill-module-map.js";
import { decideTask, opponentPleadingTrigger } from "../src/task-routing.js";
import { VerificationLedger } from "../src/verification-ledger.js";

// Replies to a delivered document (pozew, nakaz, apelacja, wezwanie or zarządzenie sądu) and
// documents used as evidence: what the application decides before the model writes anything.
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();
const executor = new SafeSessionExecutor(registry, new ProviderGateway(new ProviderRegistry())) as unknown as {
  taskRoutes(): Parameters<typeof decideTask>[0];
  activationMatrix(): Parameters<typeof decideTask>[1];
  redactionTest(): Parameters<typeof decideTask>[4];
};

const DOCS = {
  pozew: "Sąd Rejonowy dla Krakowa-Śródmieścia w Krakowie\nPowód: ABC sp. z o.o.\nPozwany: Jan Kowalski\nWartość przedmiotu sporu: 12 000 zł\nPOZEW O ZAPŁATĘ\nw postępowaniu upominawczym\nWnoszę o wydanie nakazu zapłaty w postępowaniu upominawczym.",
  sprzeciw: "Sąd Rejonowy w Krakowie\nSygn. akt I Nc 1234/26\nSPRZECIW OD NAKAZU ZAPŁATY\nZaskarżam w całości nakaz zapłaty z dnia 3.09.2026 r.",
  nakaz: "Sygn. akt I Nc 1234/26\nNAKAZ ZAPŁATY W POSTĘPOWANIU UPOMINAWCZYM\nReferendarz sądowy nakazuje pozwanemu, aby zapłacił powodowi kwotę 12 000 zł albo wniósł sprzeciw.",
  apelacja: "Sąd Okręgowy w Krakowie\nSygn. akt I C 500/25\nAPELACJA powoda od wyroku Sądu Rejonowego.\nZaskarżam wyrok w całości.",
  odpowiedzNaApelacje: "Sąd Okręgowy w Krakowie\nSygn. akt II Ca 77/26\nODPOWIEDŹ NA APELACJĘ\nWnoszę o oddalenie apelacji powoda w całości.",
  zarzadzenie: "Sąd Rejonowy w Krakowie I Wydział Cywilny\nSygn. akt I C 900/26\nZARZĄDZENIE\nPrzewodniczący zarządza: doręczyć pozwanemu odpis pozwu i zobowiązać go do złożenia odpowiedzi na pozew w terminie dwóch tygodni pod rygorem pominięcia spóźnionych twierdzeń i dowodów.",
  wezwanieSadu: "Sąd Rejonowy w Krakowie\nSygn. akt I C 900/26\nWEZWANIE\nSąd wzywa pełnomocnika powoda do uzupełnienia braków formalnych pozwu przez złożenie odpisu pełnomocnictwa w terminie 7 dni pod rygorem zwrotu pozwu.",
  wezwanieZaplaty: "Warszawa, 1.08.2026\nPRZEDSĄDOWE WEZWANIE DO ZAPŁATY\nWzywam Pana do zapłaty kwoty 12 000 zł w terminie 7 dni, w przeciwnym razie wystąpię o wydanie nakazu zapłaty.",
  pismoPrzygotowawcze: "Sąd Rejonowy w Krakowie\nSygn. akt I C 900/26\nPISMO PRZYGOTOWAWCZE POWODA\nW odpowiedzi na odpowiedź na pozew powód podtrzymuje żądanie pozwu.",
  aktOskarzenia: "Prokuratura Rejonowa Kraków-Krowodrza\nAKT OSKARŻENIA\nOskarżam Jana Kowalskiego o czyn z art. 278 § 1 k.k.",
  faktura: "FAKTURA VAT nr 5/2025\nSprzedawca: ABC sp. z o.o.\nNabywca: Jan Kowalski\nRazem brutto: 12 000 zł",
  umowa: "UMOWA O ROBOTY BUDOWLANE\nzawarta w dniu 1.03.2025 r. w Krakowie\n§ 1. Wykonawca zobowiązuje się..."
} as const;
type Doc = keyof typeof DOCS;

const decide = (question: string, docs: Doc[] = []) => {
  const decision = decideTask(
    executor.taskRoutes(),
    executor.activationMatrix(),
    question,
    docs.map((doc) => classifyDocument({ text: DOCS[doc] })),
    executor.redactionTest(),
    { skill: "pisma-proste-v2", entries: schemaCatalog(registry, "pisma-proste-v2") }
  );
  return decision ? { skills: [decision.primary, ...(decision.then ? [decision.then] : [])], redaction: (decision.modules ?? []).some((module) => /MOD-REDAKCJA/u.test(module)) } : null;
};

describe("kind of a delivered document", () => {
  it.each([
    ["sprzeciw", "SPRZECIW"],
    ["nakaz", "NAKAZ_ZAPLATY"],
    ["odpowiedzNaApelacje", "ODPOWIEDZ_NA_SRODEK"],
    ["zarzadzenie", "WEZWANIE_SADU_STANOWISKO"],
    ["wezwanieSadu", "WEZWANIE_SADU_BRAKI"],
    ["wezwanieZaplaty", "WEZWANIE"],
    ["pismoPrzygotowawcze", "PISMO_PRZYGOTOWAWCZE"],
    ["pozew", "POZEW"]
  ] as const)("%s → %s", (doc, kind) => {
    expect(classifyDocument({ text: DOCS[doc] }).kind).toBe(kind);
  });
});

describe("the task with a delivered document", () => {
  it.each<[string, Doc[], string[]]>([
    // A new reply to the delivered pleading, not the redaction of that pleading (Test A).
    ["Zredaguj odpowiedź na ten pozew.", ["pozew"], ["analiza-sadowa-v6", "pisma-procesowe-v3"]],
    ["Wzmocnij ton i napisz odpowiedź na pozew.", ["pozew"], ["analiza-sadowa-v6", "pisma-procesowe-v3"]],
    // A question about the pleading is an analysis, not the pleading pipeline.
    ["Dostałem pozew, co mam zrobić?", ["pozew"], ["analiza-sadowa-v6"]],
    ["Wyjaśnij mi ten pozew.", ["pozew"], ["analiza-sadowa-v6"]],
    ["Ile mam czasu na odpowiedź na pozew?", ["pozew"], ["analiza-sadowa-v6"]],
    // The analysis row first, the letter the user asked for as its next stage.
    ["Przeanalizuj pozew i przygotuj odpowiedź na pozew z wnioskami dowodowymi.", ["pozew", "umowa"], ["analiza-sadowa-v6", "pisma-procesowe-v3"]],
    ["Przygotuj odpowiedź na akt oskarżenia.", ["aktOskarzenia"], ["analiza-sadowa-v6", "pisma-procesowe-v3"]],
    ["Odpowiedz na pismo przygotowawcze powoda.", ["pismoPrzygotowawcze"], ["analiza-sadowa-v6", "pisma-procesowe-v3"]],
    ["Wykorzystaj te dokumenty jako dowody w pozwie o zapłatę.", ["faktura", "umowa"], ["analizator-dowodow-v3", "pisma-procesowe-v3"]],
    ["Potrzebuję odpowiedzi na pozew, który dostałem.", ["pozew"], ["analiza-sadowa-v6", "pisma-procesowe-v3"]],
    // Router R-3.54-b: the court's letter decides between a pleading and a simple letter.
    ["Przygotuj pismo w odpowiedzi na zarządzenie sądu.", ["zarzadzenie"], ["pisma-procesowe-v3"]],
    ["Odpowiedz na wezwanie sądu.", ["wezwanieSadu"], ["pisma-proste-v2"]],
    ["Sąd wezwał mnie do złożenia odpowiedzi na pozew w terminie 14 dni. Co mam napisać?", [], ["pisma-procesowe-v3"]],
    ["Sąd wezwał mnie do uzupełnienia braków formalnych pozwu. Jak odpowiedzieć?", [], ["pisma-proste-v2"]],
    // A payment demand stays the demand path.
    ["Jak odpowiedzieć na to wezwanie do zapłaty?", ["wezwanieZaplaty"], ["analizator-dowodow-v3", "pisma-proste-v2"]],
    // One's own simple letter delivered and checked.
    ["Sprawdź mój sprzeciw od nakazu.", ["sprzeciw"], ["pisma-proste-v2"]],
    ["Dostałem nakaz zapłaty, chcę złożyć sprzeciw.", [], ["pisma-proste-v2"]]
  ])("%s %j → %j", (question, docs, skills) => {
    const decision = decide(question, docs);
    expect(decision?.skills).toEqual(skills);
    expect(decision?.redaction).toBe(false);
  });

  it("keeps Test A for the user's own reply", () => {
    expect(decide("Popraw to pismo — to moja odpowiedź na pozew, skróć ją.", ["pozew"])?.redaction).toBe(true);
    expect(decide("Zredaguj odpowiedź na pozew.", ["odpowiedzNaApelacje"])?.redaction).toBe(true);
  });

  it("loads the opponent attack engine in W1 of a reply to a delivered pleading", () => {
    const modules = (question: string, doc: Doc) =>
      skillModules(registry, "pisma-procesowe-v3", {
        text: [question, DOCS[doc], opponentPleadingTrigger(question, [classifyDocument({ text: DOCS[doc] })])].join("\n"),
        stage: "W1"
      }).map((entry) => entry.resource);
    expect(modules("Przygotuj odpowiedź na pozew.", "pozew")).toContain("pisma-procesowe-v3/references/engines/opponent-pleading-attack-engine-v9.md");
    expect(modules("Napisz pozew o zapłatę.", "faktura")).not.toContain("pisma-procesowe-v3/references/engines/opponent-pleading-attack-engine-v9.md");
  });
});

describe("G8: the proceeding's own case number is not case law", () => {
  const gate = new FinalizationGate();
  it("passes a case number from the case's documents or the pleading header", () => {
    const ledger = new VerificationLedger();
    for (const signature of ownCaseFileNumbers([DOCS.zarzadzenie], "")) ledger.addCaseFileNumber(signature);
    expect(gate.evaluate("W sprawie o sygn. akt I C 900/26 należy złożyć odpowiedź na pozew.", ledger).result).toBe("PASS");
    expect(gate.evaluate("Sąd Rejonowy w Krakowie\nSygn. akt I C 900/26\nODPOWIEDŹ NA POZEW\nW niniejszej sprawie (sygn. akt I C 900/26) wnoszę o oddalenie powództwa.", new VerificationLedger()).result).toBe("PASS");
  });

  it("still blocks an unverified judgment, also next to the case's own number", () => {
    const ledger = new VerificationLedger();
    for (const signature of ownCaseFileNumbers([DOCS.zarzadzenie], "W mojej sprawie sygn. akt I C 900/26")) ledger.addCaseFileNumber(signature);
    expect(gate.evaluate("Zgodnie z wyrokiem SN z dnia 1 marca 2020 r., sygn. akt III CZP 12/21, roszczenie wygasa.", ledger).result).toBe("BLOCKED");
    expect(gate.evaluate("W sprawie o sygn. akt I C 900/26 należy złożyć odpowiedź.", new VerificationLedger()).result).toBe("BLOCKED");
  });

  it("does not take a judgment the user asks about or a top court's judgment as the user's case", () => {
    expect(ownCaseFileNumbers([], "Sprawdź wyrok SN sygn. akt III CZP 12/21 w mojej sprawie.")).toEqual([]);
    expect(ownCaseFileNumbers(["SĄD NAJWYŻSZY\nUchwała z dnia 1.03.2021 r., sygn. akt III CZP 12/21"], "")).toEqual([]);
  });
});

describe("mechanical output checks", () => {
  it("an evidence report keeps its order when a heading's word appears earlier in the prose", () => {
    const plan = createDeterministicWorkflowPlan(registry, "analizator-dowodow-v3");
    const report = [
      "RAPORT DOWODOWY — sprawa",
      "POZYCJA PROCESOWA: UMIARKOWANA",
      "HIERARCHIA:",
      "A (2): D1, D2",
      "WALIDACJA: brak sprzeczności z prawem; terminy: brak",
      "POKRYCIE: 80%",
      "DOWODY DO PISMA (top 3):",
      "TERMINY: brak zawitych terminów",
      "SPRZECZNOŚCI (podsumowanie): 1",
      "REKOMENDACJE:",
      "1. Uzupełnić D3"
    ].join("\n");
    expect(evaluateDeterministicWorkflowOutput(plan, report).result).toBe("PASS");
  });

  it("a finding inside a checkpoint report is not that checkpoint's N/A", () => {
    expect(evaluateCheckpointOutput("CP-1d", "[CP-1d] Anomalia podmiotowa nie zachodzi — strony zgodne z KRS.").missing).not.toContain("CP-1d_NA_NIEDOZWOLONE");
    expect(evaluateCheckpointOutput("CP-1c-skan", "[CP-1c-skan] Dowód nr 3 nie dotyczy przesłanki wymagalności.").notApplicable).toBeNull();
    expect(evaluateCheckpointOutput("CP-1c-skan", "[CP-1c-skan] — nie dotyczy (brak dowodów w aktach)").notApplicable).toMatch(/brak dowodów/u);
  });
});
