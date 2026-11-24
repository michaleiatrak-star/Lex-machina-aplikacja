import { describe, expect, it } from "vitest";
import { wholeFirmName } from "../src/privacy/firm-names.js";

const at = (text: string, part: string) => ({ start: text.indexOf(part), end: text.indexOf(part) + part.length });

describe("a firm's name is masked whole or not at all (REGULY-ANONIMIZACJI [FIRMA])", () => {
  it("common words of a department or trade are not masked", () => {
    const text = "Powód pracował w Zakładzie Obróbki Cieplnej jako hartownik.";
    expect(wholeFirmName(text, at(text, "Obróbki Cieplnej"))).toBeNull();
  });
  it("a chain with the firm's own word is one span", () => {
    const text = "Powód pracował w Zakładzie Obróbki Cieplnej TERMEX w Katowicach.";
    const span = wholeFirmName(text, at(text, "Obróbki Cieplnej"));
    expect(span && text.slice(span.start, span.end)).toBe("Zakładzie Obróbki Cieplnej TERMEX");
    const brand = "Umowę podpisało Przedsiębiorstwo Usługowe Mar-Pol z siedzibą w Lublinie.";
    const whole = wholeFirmName(brand, at(brand, "Mar-Pol"));
    expect(whole && brand.slice(whole.start, whole.end)).toBe("Przedsiębiorstwo Usługowe Mar-Pol");
  });
  it("a public body stays; a mention outside a chain is left as found", () => {
    const zus = "Decyzję wydał Zakład Ubezpieczeń Społecznych Oddział w Lublinie.";
    expect(wholeFirmName(zus, at(zus, "Ubezpieczeń Społecznych"))).toBeNull();
    const plain = "Umowę zawarto z Mostbud sp. z o.o.";
    expect(wholeFirmName(plain, at(plain, "Mostbud"))).toBeUndefined();
  });
});

describe("in the anonymizer", () => {
  it("a recognizer's fragment of a department name is not masked; a brand chain is one token", async () => {
    const { LocalPolishPseudonymizer, PseudonymizationVault } = await import("../src/privacy/pseudonymizer.js");
    const { peselRegistersAvailable } = await import("../src/privacy/pesel-names.js");
    const run = async (text: string, part: string) => {
      const start = text.indexOf(part);
      const recognizer = { recognize: async () => [{ start, end: start + part.length, kind: "PERSON" as const, value: part, confidence: 0.8 }] };
      return (await new LocalPolishPseudonymizer(new PseudonymizationVault(), recognizer).pseudonymize(text)).text;
    };
    const department = await run("Powód pracował w Zakładzie Obróbki Cieplnej jako hartownik.", "Obróbki Cieplnej");
    // Without the PESEL registers every word may be a name: nothing is unmasked on a guess.
    if (peselRegistersAvailable()) expect(department).toContain("Zakładzie Obróbki Cieplnej");
    const brand = await run("Powód pracował w Zakładzie Obróbki Cieplnej TERMEX w Katowicach.", "TERMEX");
    expect(brand).not.toMatch(/Obróbki|TERMEX/u);
  });
});
