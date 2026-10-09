import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { domainHintPrompt, rankDomains, parseFlashRouting } from "../src/domain-module-map.js";
import { resolveAdditionalSkills } from "../src/skill-selection.js";
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

  // Audyt 2026-10-09c: sprawy wymagające 2–3 dziedzin (tests/fixtures/routing-multidomain.json).
  // Bez tej poprawki: obie dziedziny wskazane w 62,8% spraw, ścieżka silnika (pisma) 16,8%.
  describe("multi-domain fixture", () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/routing-multidomain.json"), "utf8")) as Array<{ q: string; dr: string[]; mods?: Record<string, string> }>;
    const covered = (list: string[], required: string[]) => required.every((dr) => list.some((name) => name.startsWith(dr)));

    it("names every domain the case needs", () => {
      const all = fixture.filter((item) => covered(domains(item.q), item.dr)).length / fixture.length;
      const first = fixture.filter((item) => item.dr.includes(domains(item.q)[0] ?? "")).length / fixture.length;
      expect(all).toBeGreaterThanOrEqual(0.77);
      expect(first).toBeGreaterThanOrEqual(0.96);
    });

    it("gives the document path the same domains as the chat hint", () => {
      for (const item of fixture) {
        const flash = rank(item.q).map((domain) => domain.skill);
        if (!flash.length) continue;
        const selected = resolveAdditionalSkills(registry, item.q, flash[0]!, true, []).domainSkills;
        expect(selected, item.q).toEqual(expect.arrayContaining(flash));
      }
    });

    it("points to the act module of each domain", () => {
      for (const item of fixture) {
        for (const [dr, module] of Object.entries(item.mods ?? {})) {
          const hint = rank(item.q).find((domain) => domain.skill.startsWith(dr))?.modules.map((entry) => entry.resource).join(" ") ?? "";
          expect(hint, item.q).toContain(module);
        }
      }
    });
  });

  it("keeps the second domain of the matter next to the criminal or foreign one", () => {
    // Before: DR-03 (kwalifikator) took the second place of DR-04.
    expect(domains("Pracodawca nie wypłacił mi wynagrodzenia, a monitoring w szatni nagrywa pracowników. Co grozi szefowi karnie?")).toEqual(
      expect.arrayContaining(["dr-03", "dr-04", "dr-11"])
    );
    expect(domains("Czy nasz kontrahent z Rosji jest na liście sankcyjnej UE i co grozi za obejście sankcji?")).toEqual(
      expect.arrayContaining(["dr-03", "dr-14", "dr-15"])
    );
    expect(domains("Rozwód z orzeczeniem o winie i alimenty na dzieci.").length).toBe(1);
  });

  it("names DR-14 alone for a foreign element when no phrase names the matter", () => {
    expect(domains("Firma z Czech nie zapłaciła mi za dostawę towaru.")).toEqual(["dr-14"]);
    expect(domains("Karta Polaka — konsul odmówił mi jej przyznania.")).toEqual(["dr-05", "dr-14"]);
  });

  it("recognises violence told object first", () => {
    expect(criminalMatter("Szef mnie uderzył w pracy")).toBe(true);
    expect(criminalMatter("Mnie bolała głowa w pracy")).toBe(false);
  });

  it("asks the model to read the domains the case's kind or own phrases name, not those of one word", () => {
    const criminal = domainHintPrompt(rank("Pracodawca nie wypłacił mi wynagrodzenia, a monitoring w szatni nagrywa pracowników. Co grozi szefowi karnie?"));
    expect(criminal).toMatch(/Sprawa wielodziedzinowa: oprócz dr-04-\S+ przeczytaj SKILL\.md dr-03-\S+, dr-11-/);
    const oneWord = domainHintPrompt(rank("Fałszywy podpis na umowie, fałszerstwo dokumentu"));
    expect(oneWord).toMatch(/Dziedzina możliwa \(jedno wspólne słowo\): dr-02-/);
    expect(oneWord).not.toMatch(/wielodziedzinowa/);
    expect(domainHintPrompt(rank("Chcę rozwodu z orzeczeniem o winie męża i alimentów na dzieci."))).not.toMatch(/wielodziedzinowa|możliwa/);
  });
});
