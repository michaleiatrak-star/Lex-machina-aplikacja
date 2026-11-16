import { describe, expect, it } from "vitest";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";

describe("a dash at a name's edge is punctuation (RD 121/26: \"Ciecierskiego-\")", () => {
  it("the token stands for the name without the dash; the dash stays in the text", async () => {
    const text = "Za pozwanego pełnomocnik adw. Andrzej Ciecierski- pełnomocnictwo w aktach.";
    const start = text.indexOf("Andrzej");
    const recognizer = { recognize: async () => [{ start, end: start + "Andrzej Ciecierski-".length, kind: "PERSON" as const, value: "Andrzej Ciecierski-", confidence: 0.95, source: "AUTO" as const }] };
    const vault = new PseudonymizationVault();
    const result = await new LocalPolishPseudonymizer(vault, recognizer).pseudonymize(text);
    expect(result.text).toMatch(/\[PII:PERSON:\d{4}\]- pełnomocnictwo/u);
    const token = /\[PII:PERSON:\d{4}\]/u.exec(result.text)![0];
    expect(vault.restore(token, null).text).toBe("Andrzej Ciecierski");
  });
});
