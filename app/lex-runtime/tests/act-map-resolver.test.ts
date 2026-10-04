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

  it("electromobility goes to the transport module (map row fixed in DR-09 3.43)", () => {
    const result = pick("ustawa o elektromobilności i paliwach alternatywnych");
    expect(result.modules.map((item) => path.basename(item.resource))).toEqual(["mod-ustawa-transport-drogowy-kolejowy-lotniczy-morski.md"]);
    expect(result.rejected).toEqual([]);
  });

  it("a map row pointing to a module that does not cover the act is rejected", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "act-map-"));
    const skill = path.join(root, "dr-09-test");
    fs.mkdirSync(path.join(skill, "modules"), { recursive: true });
    fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: dr-09-test\ndescription: test\nversion: \"1.0\"\n---\n# DR\n");
    fs.writeFileSync(path.join(skill, "MAPA-AKTOW.md"), "| Akt / zakres | Bieżąca podstawa | Moduł / routing | Status |\n|---|---|---|---|\n| Ustawa o elektromobilności i paliwach alternatywnych | Dz.U. 2026 poz. 1243 | `mod-inny` | ✅ |\n");
    fs.writeFileSync(path.join(skill, "modules", "mod-inny.md"), "# Inny moduł\nCertyfikaty budynków.\n");
    const local = new LexSkillRegistry(root);
    local.scan();
    const result = resolveActModulesWithChecks(local, "ustawa o elektromobilności i paliwach alternatywnych");
    expect(result.modules).toEqual([]);
    expect(result.rejected.map((item) => path.basename(item.resource))).toEqual(["mod-inny.md"]);
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
