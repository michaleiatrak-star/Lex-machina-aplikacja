import { describe, expect, it } from "vitest";
import { CompositeRecognizer } from "../src/privacy/gazetteer-ner.js";
import { PartialRecognitionError, stanzaParts } from "../src/privacy/stanza-ner.js";

describe("Stanza reads a long document in parts (another user's computer: one request ran past the limit)", () => {
  it("parts of at most 4000 characters at line boundaries, covering the whole text in order", () => {
    const text = Array.from({ length: 300 }, (_, index) => `Akapit ${index} pozwu z opisem stanu faktycznego sprawy.`).join("\n");
    const parts = stanzaParts(text);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((part) => part.text.length <= 4_000)).toBe(true);
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.slice(1).every((part) => text[part.start - 1] === "\n")).toBe(true);
  });

  it("a short text is one part", () => {
    expect(stanzaParts("Powód Jan Kowalski")).toEqual([{ start: 0, text: "Powód Jan Kowalski" }]);
  });

  it("what the answered parts found stays protected when another part timed out", async () => {
    const partial = new PartialRecognitionError("TIMEOUT_PARTIAL: 1 z 3 części", [{ start: 0, end: 12, kind: "PERSON", value: "Jan Kowalski" }]);
    const composite = new CompositeRecognizer([{ recognize: async () => { throw partial; } }]);
    expect((await composite.recognize("Jan Kowalski pozwał spółkę.")).map((span) => span.value)).toEqual(["Jan Kowalski"]);
  });
});
