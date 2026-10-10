import { describe, expect, it } from "vitest";
import { chunkDocumentPages } from "../src/document-ingestion.js";

const fragmentLimit = 1024 - 96;

describe("dzielenie długiej strony na fragmenty", () => {
  it("nie tnie tokenu ani pary surogatów i niczego nie gubi", () => {
    for (let shift = 0; shift < 30; shift += 1) {
      const text = "a".repeat(fragmentLimit - 10 - shift) + "[PII:PERSON:0001|GEN] oraz [LMPII:D01:PERSON:0002] 😀" + "b".repeat(2000);
      const chunks = chunkDocumentPages([{ page: 1, text, source: "DIGITAL" }], 1024);
      const parts = chunks.map((chunk) => chunk.text.replace(/^\[STRONA 1 · CZĘŚĆ \d+\/\d+ · DIGITAL\]\n/, ""));
      expect(parts.join("")).toBe(text);
      const joined = chunks.map((chunk) => chunk.text).join("\n\n");
      expect(joined).toContain("[PII:PERSON:0001|GEN]");
      expect(joined).toContain("[LMPII:D01:PERSON:0002]");
      expect(joined).toContain("😀");
      for (const part of parts) expect(part.length).toBeLessThanOrEqual(fragmentLimit);
    }
  });
});
