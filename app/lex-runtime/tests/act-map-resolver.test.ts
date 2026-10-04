import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateMandatoryPath } from "../src/mandatory-path.js";
import { resolveActModulesWithChecks } from "../src/act-map-resolver.js";
import { LexSkillRegistry } from "../src/registry.js";

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const pick = (text: string) => resolveActModulesWithChecks(registry, text);
const names = (text: string) => pick(text).modules.map((item) => `${item.rule}:${path.basename(item.resource)}`);

describe("MAPA-AKTOW resolved mechanically", () => {
  it("PRZEPIS: the module whose declared article range holds the article", () => {
    expect(names("Zarzut z art. 148 § 1 KK")).toEqual(["PRZEPIS:mod-KK-art148-162-przeciwko-zyciu-zdrowiu.md"]);
    expect(names("art. 233 § 1 k.k. fałszywe zeznania")).toEqual(["PRZEPIS:mod-KK-art233-244b-przeciwko-wymiarowi-sprawiedliwosci.md"]);
    expect(names("mandat, art. 92a KW")[0]).toBe("PRZEPIS:mod-KW-art70-118-bezpieczenstwo-osoba-zdrowie.md");
  });

  it("the module's own heading wins over a too broad map row (art. 278 KK is no forgery)", () => {
    expect(names("Oskarżony o kradzież z art. 278 k.k.")).toEqual(["PRZEPIS:mod-KK-current-state-COV.md"]);
  });

  it("DZU and NAZWA", () => {
    expect(names("Dz.U. 2025 poz. 1490 — licencja")).toEqual(["DZU:mod-ustawa-transport-drogowy-kolejowy-lotniczy-morski.md"]);
    expect(names("Szkody łowieckie w uprawach")).toEqual(["NAZWA:mod-szkody-lowieckie-szacowanie-odszkodowanie.md"]);
    expect(names("Spadek po ojcu — zachowek")).toEqual(["NAZWA:mod-KC-spadki-zachowek-dzial-rozrzadzenia.md"]);
  });

  it("a map row pointing to a module that does not cover the act is rejected", () => {
    const result = pick("ustawa o elektromobilności i paliwach alternatywnych");
    expect(result.modules).toEqual([]);
    expect(result.rejected.map((item) => path.basename(item.resource))).toEqual(["mod-ustawa-charakterystyka-energetyczna.md"]);
  });

  it("nothing for questions that name no act, article or scope", () => {
    for (const text of ["Co mam zrobić?", "Napisz pozew o zapłatę", "Przygotuj raport dla klienta", "Kontrahent nie płaci faktury"]) {
      expect(names(text)).toEqual([]);
    }
  });

  it("the trace requires the mechanically resolved modules", () => {
    const resource = "dr-03-prawo-karne-wykroczenia-egzekucja/modules/mod-KK-art148-162-przeciwko-zyciu-zdrowiu.md";
    const step = (events: Array<{ type: string; target: string; status: string; detail?: Record<string, unknown> }>) =>
      evaluateMandatoryPath({ core: [], full: [], triggered: [] } as never, {
        profile: "LEKKI", contextResources: new Set(), query: "art. 148 KK", answer: "", legal: true, criminal: true, documents: false,
        documentsTruncated: false, documentGeneration: false, foreignJurisdiction: false, federationTools: true, records: [], events,
        loadedSkills: [], primarySkill: "AUTO", finalization: "PASS"
      } as never).steps.find((item) => item.id === "MODUŁ-AKTU:dr-03-prawo-karne-wykroczenia-egzekucja");
    const gate = { type: "gate", target: "ACT_MAP_MODULES", status: "OK", detail: { detail: `dr-03-prawo-karne-wykroczenia-egzekucja:${resource}:PRZEPIS` } };
    expect(step([gate])).toMatchObject({ requirement: "CORE", status: "MISSING" });
    expect(step([gate, { type: "resource_read", target: resource, status: "OK", detail: { detail: "runtime-preload;act-map;PRZEPIS" } }])).toMatchObject({ status: "MET", by: "APLIKACJA" });
  });
});
