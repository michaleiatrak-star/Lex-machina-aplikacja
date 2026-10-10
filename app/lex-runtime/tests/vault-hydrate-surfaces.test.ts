import { describe, expect, it } from "vitest";
import { PseudonymizationVault } from "../src/privacy/pseudonymizer.js";
import type { PersonEntity } from "../src/privacy/person-morphology.js";

function entity(canonical: string, gender: PersonEntity["gender"], forms: string[]): PersonEntity {
  const cases = ["nom", "gen", "dat", "acc", "inst", "loc", "voc"];
  return {
    canonical,
    gender,
    genderAlternatives: [],
    status: "gender_ambiguous",
    warnings: [],
    forms: Object.fromEntries(cases.map((key, index) => [key, { text: forms[index] ?? forms[0]! }])) as never
  };
}

describe("klucz wczytany z zapisu", () => {
  it("łączy osobę po zapisanej powierzchni tak samo jak w tej samej sesji", () => {
    // "Martynie Jurdze" odczytane jako mężczyzna "Martyn Jurda": formy nie zawierają powierzchni.
    const first = entity("Martyn Jurda", "m1", ["Martyn Jurda", "Martyna Jurdy"]);
    const second = entity("Martyna Jurda", "f", ["Martyna Jurda", "Martynie Jurdze"]);

    const live = new PseudonymizationVault();
    const token = live.getOrCreate("PERSON", "Martynie Jurdze", first);
    const restored = new PseudonymizationVault(live.snapshot());

    expect(live.getOrCreate("PERSON", "Martyna Jurda", second)).toBe(token);
    expect(restored.getOrCreate("PERSON", "Martyna Jurda", second)).toBe(token);
  });
});
