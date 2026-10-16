import { describe, expect, it } from "vitest";
import { CompositeRecognizer } from "../src/privacy/gazetteer-ner.js";
import { detectPeselNames, nominativeCandidates } from "../src/privacy/pesel-names.js";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";

describe("names from the PESEL registers without the Python gazetteer", () => {
  it("a given name with a surname in any case and order; not a patron, a court or a firm", () => {
    const text =
      "Sz.P. Michał Wiatrak\nreprezentowana przez radcę prawnego Pawła Raka. Wnosi przeciwko Janowi Kowalskiemu i Annie Nowak. " +
      "Szpital im. Jana Pawła II. Sąd Rejonowy w Krakowie. Wiatrak Michał\nadwokata Katarzyny Oksiędzkiej. Human Park Global. Kodeks Cywilny.";
    expect(detectPeselNames(text).map((span) => span.value)).toEqual([
      "Michał Wiatrak", "Pawła Raka", "Janowi Kowalskiemu", "Annie Nowak", "Wiatrak Michał", "Katarzyny Oksiędzkiej"
    ]);
  });

  it("reads inflected forms back to the nominative", () => {
    expect(nominativeCandidates("Kowalskiemu")).toContain("Kowalski");
    expect(nominativeCandidates("Oksiędzkiej")).toContain("Oksiędzka");
    expect(nominativeCandidates("Filipka")).toContain("Filipek");
  });

  it("the pseudonymizer uses them when Morfeusz is down and Stanza finds nothing", async () => {
    class LocalGazetteerRecognizer {
      async recognize(): Promise<never> {
        throw new Error("GAZETTEER_FAILED:1:No module named morfeusz2");
      }
    }
    const stanza = { recognize: async () => [] };
    const recognizer = new CompositeRecognizer([new LocalGazetteerRecognizer(), stanza]);
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), recognizer).pseudonymize(
      "Sz.P. Michał Wiatrak\nul. Azot 2A/31, 43-600 Jaworzno\nreprezentowana przez radcę prawnego Pawła Raka"
    );
    for (const leaked of ["Michał", "Wiatrak", "Azot", "Raka"]) expect(result.text).not.toContain(leaked);
  });
});
