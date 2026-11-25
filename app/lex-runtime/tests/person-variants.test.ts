import { describe, expect, it } from "vitest";
import { genderLegend, grammaticalGender } from "../src/privacy/identity-legend.js";
import { samePerson } from "../src/privacy/person-identity.js";
import { PERSON_CASES, type PersonEntity } from "../src/privacy/person-morphology.js";

// Synthetic names only (task 07): one person written in two transliterations, by initial, inflected.
const person = (canonical: string, gender: PersonEntity["gender"] = "m1"): PersonEntity => ({
  canonical,
  gender,
  genderAlternatives: [],
  status: "ok",
  forms: Object.fromEntries(PERSON_CASES.map((personCase) => [personCase, { text: canonical, source: "sgjp", confidence: 1 }])) as PersonEntity["forms"],
  warnings: []
});

describe("one person under one symbol across spellings", () => {
  const witness = person("Jurij Dorn");

  it("another transliteration of the given name, the surname inflected, an initial", () => {
    expect(samePerson("Yurii Dorn", undefined, [witness])?.entity).toBe(witness);
    expect(samePerson("Iurii Dorna", undefined, [witness])?.entity).toBe(witness);
    expect(samePerson("J. Dorn", undefined, [witness])?.entity).toBe(witness);
  });

  it("another person of the same surname: not joined, left for the preview", () => {
    const sister = person("Olena Dorn", "f");
    expect(samePerson("Yurii Dorn", undefined, [witness, sister])).toBeNull();
    expect(samePerson("O. Dorn", undefined, [witness, sister])).toBeNull();
    expect(samePerson("Piotr Dorn", undefined, [witness])).toBeNull();
  });

  it("the legend gives the grammatical gender of a symbol, never the name", () => {
    expect(grammaticalGender("Anna Wiśniewska")).toBe("żeński");
    expect(grammaticalGender("Jurij Dorn")).toBe("męski");
    expect(grammaticalGender("Kuba Lis")).toBe("męski");
    expect(grammaticalGender("Zawadzka")).toBe("żeński");
    const names: Record<string, string> = { "[PII:PERSON:0001]": "Jurij Dorn", "[PII:PERSON:0002]": "Olena Dorn" };
    const legend = genderLegend(Object.keys(names), (token) => names[token] ?? null);
    expect(legend).toContain("- męski: [PII:PERSON:0001]");
    expect(legend).toContain("- żeński: [PII:PERSON:0002]");
    expect(legend).not.toMatch(/Jurij|Olena|Dorn/u);
  });
});
