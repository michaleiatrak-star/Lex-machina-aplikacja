import { describe, expect, it } from "vitest";
import { identityLegendPrompt, personTokens, samePersonGroups } from "../src/privacy/identity-legend.js";

// RD 121/26: the user in the question, the acquitted in the verdict (another case form), the
// attorney in full in one document and by surname alone in another; a second Kowalski and a
// Kowalska are not joined to anybody.
const names: Record<string, string> = {
  "[PII:PERSON:0001]": "Michał Wiatrak",
  "[LMPII:D02:PERSON:0003]": "Michała Wiatraka",
  "[LMPII:D04:PERSON:0001]": "Andrzej Ciecierski",
  "[LMPII:D05:PERSON:0002]": "Ciecierski",
  "[LMPII:D05:PERSON:0007]": "Jan Kowalski",
  "[LMPII:D06:PERSON:0001]": "Anna Kowalska",
  "[LMPII:D06:PERSON:0002]": "Kowalski"
};

describe("the same person under the symbols of different documents (RD 121/26)", () => {
  const tokens = personTokens([
    "Działam jako pokrzywdzony [PII:PERSON:0001].",
    "uniewinnia obwinionego [LMPII:D02:PERSON:0003]; adw. [LMPII:D04:PERSON:0001]",
    "adw. [LMPII:D05:PERSON:0002] i [LMPII:D05:PERSON:0007]; [LMPII:D06:PERSON:0001], [LMPII:D06:PERSON:0002]"
  ]);
  const groups = samePersonGroups(tokens, (token) => names[token] ?? null);

  it("joins case forms and a surname alone to the one full name", () => {
    expect(groups).toContainEqual(["[PII:PERSON:0001]", "[LMPII:D02:PERSON:0003]"]);
    expect(groups).toContainEqual(["[LMPII:D04:PERSON:0001]", "[LMPII:D05:PERSON:0002]"]);
  });

  it("never joins different persons: Jan Kowalski is not Anna Kowalska; the surname alone stays with Jan only when unique", () => {
    expect(groups.flat()).not.toContain("[LMPII:D06:PERSON:0001]");
    expect(groups.some((group) => group.includes("[LMPII:D05:PERSON:0007]") && group.includes("[LMPII:D06:PERSON:0001]"))).toBe(false);
  });

  it("the legend names symbols only and marks the user's", () => {
    const prompt = identityLegendPrompt(groups, new Set(["[PII:PERSON:0001]"]));
    expect(prompt).toContain("[PII:PERSON:0001] = [LMPII:D02:PERSON:0003] (osoba wymieniona w pytaniu użytkownika)");
    expect(prompt).not.toMatch(/Wiatrak|Ciecierski/u);
  });
});
