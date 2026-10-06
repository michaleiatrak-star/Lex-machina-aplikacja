import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rankDomains, parseFlashRouting } from "../src/domain-module-map.js";
import { criminalMatter } from "../src/matter-signals.js";
import { LexSkillRegistry } from "../src/registry.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

// Audyt 2026-10-05: sprawy z dwóch dziedzin, ich moduły i kwalifikator karny.
describe("two DR domains of one case", () => {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();
  const rows = parseFlashRouting(fs.readFileSync(path.join(CORPUS, "prawo-polskie-v2/SKILL.md"), "utf8"));
  const rank = (text: string) => rankDomains(registry, rows, text);
  const domains = (text: string) => rank(text).map((domain) => domain.skill.slice(0, 5));
  const firstModule = (text: string, skill: string) => rank(text).find((domain) => domain.skill.startsWith(skill))?.modules[0]?.resource ?? "";

  const cases: Array<[string, string[]]> = [
    ["Pracodawca nie wypłacił mi wynagrodzenia i podrobił mój podpis na liście płac.", ["dr-03", "dr-04"]],
    ["Pijany kierowca potrącił mnie na pasach. Jak dochodzić odszkodowania z OC i co grozi mu karnie?", ["dr-02", "dr-03"]],
    ["Gmina odmówiła wydania decyzji o warunkach zabudowy. Czy mogę wnieść skargę do WSA?", ["dr-05", "dr-08"]],
    ["Pracodawca zainstalował monitoring w szatni i przetwarza moje dane biometryczne bez zgody.", ["dr-04", "dr-11"]],
    ["Odziedziczyłem mieszkanie po ojcu, czy zapłacę podatek od spadków i darowizn?", ["dr-02", "dr-06"]],
    ["Urząd skarbowy zarzuca mi pustą fakturę VAT i grozi postępowaniem karnym skarbowym.", ["dr-03", "dr-06"]]
  ];
  it.each(cases)("%s", (text, expected) => {
    expect(domains(text)).toEqual(expect.arrayContaining(expected));
  });

  it("does not add a second domain from procedural words alone", () => {
    expect(domains("ZUS odmówił mi renty z tytułu niezdolności do pracy. Jak się odwołać?")).toEqual(["dr-04"]);
    expect(domains("Chcę rozwodu z orzeczeniem o winie męża i alimentów na dzieci.")).toEqual(["dr-02"]);
  });

  it("points to the act module of the case", () => {
    expect(firstModule("Chcę rozwodu z orzeczeniem o winie i alimentów na dzieci.", "dr-02")).toMatch(/mod-KRO-rodzinne/);
    expect(firstModule("Pijany kierowca potrącił pieszego, co grozi mu karnie?", "dr-03")).toMatch(/mod-PRD-nowe-przestepstwa-drogowe/);
    expect(firstModule("Decyzja o warunkach zabudowy, plan miejscowy", "dr-08")).toMatch(/mod-MPZP-WZ-planowanie-przestrzenne/);
  });

  it("recognises a criminal matter without the word 'przestępstwo' (Karne: +kwalifikator)", () => {
    for (const text of ["co grozi mu karnie?", "podrobił mój podpis", "pijany kierowca potrącił pieszego", "ukradł mi telefon", "zostałem pobity"]) {
      expect(criminalMatter(text)).toBe(true);
    }
    expect(criminalMatter("kara umowna za opóźnienie dostawy")).toBe(false);
  });
});
