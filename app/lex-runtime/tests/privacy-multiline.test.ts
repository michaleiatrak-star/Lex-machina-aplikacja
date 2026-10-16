import { describe, expect, it } from "vitest";
import { detectFirmNames } from "../src/privacy/firm-names.js";
import { CompositeRecognizer, degradedRecognizers } from "../src/privacy/gazetteer-ner.js";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";
import { detectStreetAddresses } from "../src/privacy/street-addresses.js";

const values = (spans: Array<{ value: string }>) => spans.map((span) => span.value);

describe("addresses without the Python gazetteer, also across lines", () => {
  it("a street and its house number on two lines, a word split at the line end, capitals", () => {
    expect(values(detectStreetAddresses("z siedzibą w Warszawie przy ul. Śródziemnomorskiej\n11/5, do reprezentowania"))).toEqual([
      "ul. Śródziemnomorskiej\n11/5"
    ]);
    expect(values(detectStreetAddresses("zamieszkały przy ul. Śródziemno-\nmorskiej 11/5 oraz UL. DŁUGA 5 m. 3"))).toEqual([
      "ul. Śródziemno-\nmorskiej 11/5",
      "UL. DŁUGA 5 m. 3"
    ]);
    expect(values(detectStreetAddresses("Sz.P. Jan Nowak\nul. Azot 2A/31, 43-600 Jaworzno"))).toEqual(["ul. Azot 2A/31, 43-600 Jaworzno"]);
    expect(values(detectStreetAddresses("ul. Lipowa 7\nTel. 32-111 22 33"))).toEqual(["ul. Lipowa 7"]);
  });

  it("no address in plain legal text", () => {
    expect(detectStreetAddresses("Na podstawie art. 484 § 2 KC wnoszę o zmniejszenie kary w terminie 7 dni.")).toEqual([]);
  });

  it("the pseudonymizer masks them when every name recognizer is down", async () => {
    const down = { recognize: async () => [] };
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), down).pseudonymize(
      "Komandytowa z siedzibą w Warszawie przy ul. Śródziemnomorskiej\n11/5, do reprezentowania"
    );
    expect(result.text).not.toContain("Śródziemnomorskiej");
    expect(result.text).not.toContain("11/5");
  });
});

describe("brand of a law office ([FIRMA])", () => {
  it("before the office on its line or as the line above, and its OCR spelling later", () => {
    const text = [
      "LORICA IURIS",
      "Kancelaria Adwokatów i Radców Prawnych",
      "adres do doręczeń:",
      "Lorica luris Kancelaria Adwokatów i Radców Prawnych",
      "z LORICA IURIS Kancelarii Adwokatów i Radców Prawnych Ciecierski Rak Spółka",
      "Komandytowa z siedzibą w Warszawie"
    ].join("\n");
    expect(values(detectFirmNames(text)).sort()).toEqual(["Ciecierski Rak", "LORICA IURIS", "LORICA IURIS", "Lorica luris"].sort());
  });

  it("no brand from a sentence, a role or a heading word", () => {
    expect(values(detectFirmNames("Pełnomocnik z kancelarii adwokackiej wniósł pismo."))).toEqual([]);
    expect(values(detectFirmNames("Powód\nKancelaria Radcy Prawnego"))).toEqual([]);
    expect(values(detectFirmNames("Sąd Rejonowy. Kancelaria Notarialna przesłała odpis."))).toEqual([]);
  });
});

describe("a local recognizer that does not start is reported, not silent", () => {
  it("names the recognizer down until it works again", async () => {
    class LocalGazetteerRecognizer {
      ok = false;
      async recognize() {
        if (!this.ok) throw new Error("GAZETTEER_FAILED:1:No module named morfeusz2");
        return [];
      }
    }
    const gazetteer = new LocalGazetteerRecognizer();
    const composite = new CompositeRecognizer([gazetteer, { recognize: async () => [] }]);
    await composite.recognize("Jan Kowalski mieszka w Krakowie.");
    expect(degradedRecognizers()).toEqual([
      { name: "Morfeusz (słownik imion, nazwisk i adresów)", reason: "GAZETTEER_FAILED:1:No module named morfeusz2" }
    ]);
    gazetteer.ok = true;
    await composite.recognize("Jan Kowalski mieszka w Krakowie.");
    expect(degradedRecognizers()).toEqual([]);
  });
});

describe("start check of the local recognizers", () => {
  it("reports a recognizer that fails or finds no person, with the reason; a working one is OK", async () => {
    class LocalGazetteerRecognizer {
      async recognize(): Promise<never> {
        throw new Error("GAZETTEER_FAILED:1:No module named morfeusz2");
      }
    }
    class LocalStanzaNamedEntityRecognizer {
      async recognize() {
        return [];
      }
    }
    const statuses = await new CompositeRecognizer([new LocalGazetteerRecognizer(), new LocalStanzaNamedEntityRecognizer()]).selfTest();
    expect(statuses).toEqual([
      { name: "Morfeusz (słownik imion, nazwisk i adresów)", ok: false, reason: "GAZETTEER_FAILED:1:No module named morfeusz2" },
      { name: "Stanza (rozpoznawanie nazw w zdaniu)", ok: false, reason: "SELF_TEST_NO_PERSON" }
    ]);
    expect(degradedRecognizers().map((item) => item.name)).toHaveLength(2);
    const working = { recognize: async (text: string) => [{ start: 8, end: 20, kind: "PERSON" as const, value: text.slice(8, 20) }] };
    Object.defineProperty(working, "constructor", { value: LocalStanzaNamedEntityRecognizer });
    await new CompositeRecognizer([working]).selfTest();
    expect(degradedRecognizers().map((item) => item.name)).toEqual(["Morfeusz (słownik imion, nazwisk i adresów)"]);
  });
});
