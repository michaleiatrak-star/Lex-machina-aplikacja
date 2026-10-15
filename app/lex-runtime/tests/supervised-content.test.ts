import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateMandatoryPath, loadMandatoryPathModel, type TurnFacts } from "../src/mandatory-path.js";
import { CAUSAL_RESOURCE, isoDates, supervisedChecks } from "../src/supervised-content.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const model = loadMandatoryPathModel((resource) => {
  try {
    return fs.readFileSync(path.join(CORPUS, resource), "utf8");
  } catch {
    return null;
  }
});
const TIMELINE = [...isoDates("9.10.2024 porozumienie; 3 grudnia 2024 wezwanie; 2024-12-10 doręczenie")];

describe("nadzór treści: związek przyczynowy", () => {
  const causal = (answer: string, read: string[] = [CAUSAL_RESOURCE]) =>
    supervisedChecks({ query: "Czy wypowiedzenie spowodowało rozstrój zdrowia?", answer, readResources: new Set(read) })[0]!;

  it("kolejność dat nie dowodzi związku: bez badania połączeń krok ma BRAK i prośbę o poprawkę", () => {
    const check = causal("Rozstrój zdrowia nastąpił po wypowiedzeniu, więc wypowiedzenie go spowodowało.");
    expect(check).toMatchObject({ status: "MISSING", correction: expect.stringContaining("MOD-GRAF-PRZYCZYNOWY") });
    expect(check.evidence).toContain("sama kolejność zdarzeń nie dowodzi związku");
  });

  it("badanie połączeń (csqn, post hoc, alternatywy) po wczytaniu modułu spełnia krok", () => {
    expect(causal("Test csqn: bez wypowiedzenia ... Ryzyko post hoc: ... Alternatywne wyjaśnienie: wcześniejsza choroba.").status).toBe("MET");
    expect(causal("Test csqn: ...", []).status).toBe("MISSING");
  });

  it("pytanie bez związku przyczynowego: nie dotyczy", () => {
    expect(supervisedChecks({ query: "Jaki jest termin na apelację?", answer: "14 dni.", readResources: new Set() })[0]!.status).toBe("NOT_TRIGGERED");
  });
});

describe("nadzór treści: oś czasu sprawy z pamięci", () => {
  const timeline = (query: string, answer: string) =>
    supervisedChecks({ query, answer, readResources: new Set(), timelineDates: TIMELINE })[1]!;

  it("daty w różnych zapisach są tą samą datą", () => {
    expect([...isoDates("dnia 3.12.2024 oraz 3 grudnia 2024 i 2024-12-03")]).toEqual(["2024-12-03"]);
  });

  it("przekazana i potrzebna: odpowiedź musi odwołać się do zdarzeń z osi", () => {
    expect(timeline("Przygotuj odpowiedź na pozew.", "Pozew jest bezzasadny.")).toMatchObject({
      status: "MISSING",
      evidence: "przekazana (3 dat); odpowiedź nie odwołuje się do żadnego zdarzenia z osi"
    });
    expect(timeline("Przygotuj odpowiedź na pozew.", "Wezwanie z 3 grudnia 2024 r. doręczono 10.12.2024.")).toMatchObject({ status: "MET" });
  });

  it("prośba niezwiązana z przebiegiem zdarzeń albo brak osi: nie dotyczy", () => {
    expect(timeline("Jak się nazywa ten sąd?", "Sąd Rejonowy.").status).toBe("NOT_TRIGGERED");
    expect(supervisedChecks({ query: "Przeanalizuj sprawę.", answer: "x", readResources: new Set() })[1]!.status).toBe("NOT_TRIGGERED");
  });
});

describe("rejestr ścieżki obowiązkowej", () => {
  it("pokazuje oba kroki nadzoru w warstwie SKILL z wynikiem i dowodem", () => {
    const facts: TurnFacts = {
      profile: "PELNY",
      contextResources: new Set(model.core.map((item) => item.resource)),
      query: "Czy wypowiedzenie spowodowało rozstrój zdrowia?",
      answer: "Odpowiedź.",
      legal: true,
      criminal: false,
      documents: false,
      documentsTruncated: false,
      documentGeneration: false,
      foreignJurisdiction: false,
      federationTools: false,
      records: [],
      events: [],
      loadedSkills: ["prawny-router-v3"],
      primarySkill: "AUTO",
      finalization: "PASS",
      supervised: supervisedChecks({ query: "Czy wypowiedzenie spowodowało rozstrój zdrowia?", answer: "Odpowiedź.", readResources: new Set(), timelineDates: TIMELINE })
    };
    const report = evaluateMandatoryPath(model, facts);
    expect(report.steps.find((step) => step.id === "ZWIAZEK-PRZYCZYNOWY")).toMatchObject({ layer: "SKILL", status: "MISSING" });
    expect(report.steps.find((step) => step.id === "OS-CZASU-SPRAWY")).toMatchObject({ layer: "SKILL", status: "MISSING" });
    expect(report.missing).toEqual(expect.arrayContaining(["ZWIAZEK-PRZYCZYNOWY", "OS-CZASU-SPRAWY"]));
  });
});
