import { describe, expect, it } from "vitest";
import { peselFacts } from "../src/privacy/identifiers.js";
import { peselCheckText } from "../src/privacy/pesel-check.js";
import { LocalPolishPseudonymizer, PseudonymizationVault, organizationEntity } from "../src/privacy/pseudonymizer.js";

describe("PESEL check before the analysis (user question 2026-11-08)", () => {
  it("reads the sex and the date; an invalid number gives null", () => {
    expect(peselFacts("44051401458")).toEqual({ sex: "m", birthDate: "1944-05-14" });
    expect(peselFacts("02270803624")).toEqual({ sex: "f", birthDate: "2002-07-08" });
    expect(peselFacts("44051401459")).toBeNull();
  });

  it("masks a labelled PESEL with a wrong check digit and reports it; flags a sex that disagrees", async () => {
    const vault = new PseudonymizationVault();
    const text = "Pani Ewa, PESEL 44051401458, oraz Pan Adam, PESEL 44051401459. Pani Maria, PESEL 02270803624.";
    const result = await new LocalPolishPseudonymizer(vault).pseudonymize(text);
    expect(result.text).not.toMatch(/\d{11}/u);
    const report = peselCheckText([result.text], vault);
    expect(report).toContain("NIEZGODNY z płcią: numer oznacza: mężczyzna, a osoba „Pani” to kobieta");
    expect(report).toContain("NIEPRAWIDŁOWY");
    expect(report).toContain("poprawny i zgodny z płcią osoby „Pani” (kobieta)");
    expect(report).not.toMatch(/\d{11}/u);
  });

  it("uses the key's gender of the person token before the number", () => {
    const vault = new PseudonymizationVault();
    const person = vault.getOrCreate("PERSON", "Anna Nowak", { ...organizationEntity("Anna Nowak"), type: undefined, warnings: [], gender: "f" } as never);
    const pesel = vault.getOrCreate("PESEL", "44051401458");
    expect(peselCheckText([`${person}, PESEL ${pesel}`], vault)).toContain(`osoba ${person} to kobieta`);
  });
});
