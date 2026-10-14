import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

// Turns with a delivered document (HTTP series of 2026-10-14): editing the delivered letter,
// a letter drafted from a delivered decision, hearing preparation, case law for the case,
// and firm templates, which are never the user's material.

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const executor = new SafeSessionExecutor(registry, new ProviderGateway(new ProviderRegistry()));
const file = (text: string, sourceScope?: string) => [{ chunks: [{ text }], ...(sourceScope ? { sourceScope } : {}) }];
const SPRZECIW =
  "SPRZECIW OD NAKAZU ZAPŁATY\nSąd Rejonowy w Krakowie, sygn. akt I Nc 100/26\nPozwany: Jan Kowalski\n" +
  "Zaskarżam nakaz zapłaty w całości i wnoszę o oddalenie powództwa. Uzasadnienie: roszczenie jest przedawnione.";
const POZEW =
  "POZEW O ZAPŁATĘ\nSąd Rejonowy w Krakowie\nPowód: Jan Kowalski\nPozwany: ABC sp. z o.o.\n" +
  "Wnoszę o zasądzenie kwoty 10 000 zł wraz z odsetkami. Uzasadnienie: pozwany nie zapłacił faktury nr 1/2026. Dowód: faktura.";
const DECYZJA =
  "DECYZJA nr 12/2026\nPrezydent Miasta Krakowa, na podstawie art. 104 Kodeksu postępowania administracyjnego, " +
  "orzeka: odmówić udzielenia zezwolenia. Uzasadnienie: wnioskodawca nie spełnił wymagań. Pouczenie: od decyzji " +
  "służy odwołanie do Samorządowego Kolegium Odwoławczego w terminie 14 dni od dnia doręczenia.";
const WEZWANIE =
  "PRZEDSĄDOWE WEZWANIE DO ZAPŁATY\nKraków, 1 października 2026 r.\nWzywam ABC sp. z o.o. do zapłaty kwoty 5 000 zł " +
  "tytułem faktury nr 7/2026 w terminie 7 dni od doręczenia, pod rygorem skierowania sprawy na drogę sądową.";

describe("editing a delivered letter is Test A", () => {
  it("an editing verb aimed at the delivered pleading", () => {
    expect(executor.pleadingRedactionFor("Popraw styl tego sprzeciwu.", file(SPRZECIW))).toBe(true);
    expect(executor.pleadingRedactionFor("Wygładź styl tego pozwu.", file(POZEW))).toBe(true);
  });

  it("a delivered simple letter is edited by pisma-proste-v2", () => {
    expect(executor.executiveSkillsWithMaterials("Przeredaguj wezwanie do zapłaty na bardziej stanowcze.", file(WEZWANIE))).toEqual(["pisma-proste-v2"]);
  });

  it("a review or a new substance is not an edit", () => {
    expect(executor.pleadingRedactionFor("Przeanalizuj ten pozew.", file(POZEW))).toBe(false);
    expect(executor.pleadingRedactionFor("Popraw ten pozew i dodaj zarzut przedawnienia.", file(POZEW))).toBe(false);
  });
});

describe("a letter from a delivered decision is the next stage", () => {
  it("odwołanie and skarga kasacyjna hand over to pisma-procesowe-v3", () => {
    expect(executor.executiveSkillsWithMaterials("Napisz odwołanie od tej decyzji.", file(DECYZJA))).toEqual(["analiza-sadowa-v6", "pisma-procesowe-v3"]);
    expect(executor.executiveSkillsWithMaterials("Przeanalizuj decyzję i napisz odwołanie.", file(DECYZJA))).toEqual(["analiza-sadowa-v6", "pisma-procesowe-v3"]);
  });
});

describe("named tasks with the case files", () => {
  it("hearing preparation and case law for the case", () => {
    expect(executor.executiveSkillsWithMaterials("Przygotuj przesłuchanie powoda.", file(POZEW))).toEqual(["przesluchanie-swiadkow-v2-min90"]);
    expect(executor.executiveSkillsWithMaterials("Znajdź orzecznictwo do tej sprawy.", file(POZEW))).toEqual(["orzeczenia-sadowe-v2"]);
  });
});

describe("firm templates", () => {
  it("\"popraw ten wzór\" is editing a letter, not the analysis of a received demand", () => {
    expect(executor.executiveSkillsWithMaterials("Popraw ten wzór wezwania.", file(WEZWANIE, "FIRM_TEMPLATE"))[0]).not.toBe("analiza-sadowa-v6");
  });

  it("comparing a contract with the firm's template stays with the contract", () => {
    expect(executor.executiveSkillsWithMaterials("Sprawdź tę umowę najmu i porównaj z naszym wzorem.", [
      { chunks: [{ text: "UMOWA NAJMU LOKALU\n§ 1. Wynajmujący oddaje Najemcy w najem lokal. § 2. Czynsz wynosi 3 000 zł miesięcznie. § 3. Umowa zawarta na czas nieokreślony." }] }
    ])).toEqual(["analizator-umow-v1"]);
  });
});
