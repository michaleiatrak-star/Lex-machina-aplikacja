import { describe, expect, it } from "vitest";
import { detectFirmNames } from "../src/privacy/firm-names.js";
import { personPart } from "../src/privacy/generic-words.js";
import { LocalGazetteerRecognizer } from "../src/privacy/gazetteer-ner.js";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";
import { placeholderGrammar } from "../src/privacy/token-legend.js";

const python = process.env.LEX_NER_PYTHON;

describe("firm names ([FIRMA], REGULY-ANONIMIZACJI)", () => {
  it("a name before a legal form or after a business prefix, and its later mentions", () => {
    const text = "Pozwana: Transkom sp. z o.o. z siedzibą w Legionowie. Powódka zawarła ze spółką Transkom umowę. Firma P.H.U. Marex Marek Nowak.";
    const found = detectFirmNames(text).map((span) => span.value);
    expect(found).toEqual(["Transkom", "Transkom", "Marex"]);
    expect(detectFirmNames("Kowalski i Wspólnicy sp.k. oraz Inter-Trans S.A.").map((span) => span.value)).toEqual(["Kowalski i Wspólnicy", "Inter-Trans"]);
  });

  it("public bodies and roles stay", () => {
    expect(detectFirmNames("Skarb Państwa reprezentowany przez Starostę. Zakład Ubezpieczeń Społecznych odmówił.")).toEqual([]);
  });

  it("one firm token, marked as a firm in the key, the legal form left in the text", async () => {
    const vault = new PseudonymizationVault();
    const result = await new LocalPolishPseudonymizer(vault).pseudonymize("Pozwana: Transkom sp. z o.o., umowę ze spółką Transkom zawarto w 2024 r.");
    expect(result.text).not.toContain("Transkom");
    expect(result.text).toContain("sp. z o.o.");
    const tokens = new Set(result.findings.map((finding) => finding.token));
    expect(tokens.size).toBe(1);
    expect(placeholderGrammar(result.text, vault)[0]).toMatchObject({ entity: "organization", legalForm: "sp. z o.o." });
  });
});

describe("initials before a surname", () => {
  it("„M. Kozłowska” is a name, not „m.” (miasto); „S. Nowak” keeps the initial", () => {
    const text = "Powódka M. Kozłowska i powód S. Nowak.";
    const m = { start: text.indexOf("M. Kozłowska"), end: text.indexOf("M. Kozłowska") + 12, value: "M. Kozłowska" };
    const s = { start: text.indexOf("S. Nowak"), end: text.indexOf("S. Nowak") + 8, value: "S. Nowak" };
    expect(personPart(text, m)).toEqual(m);
    expect(personPart(text, s)).toEqual(s);
  });
});

describe.skipIf(!python)("gazetteer: register gaps found by the comparison corpus", () => {
  const recognizer = new LocalGazetteerRecognizer({ python: python! });
  const found = async (text: string) => (await recognizer.recognize(text)).map((span) => text.slice(span.start, span.end));

  it("Toruń and Poznań in the locative after an address (soft-consonant genitives of TERYT)", async () => {
    expect(await found("Roboty wykonywano przy ulicy Chopina 159/9 w Toruniu.")).toContain("Toruniu");
    expect(await found("zamieszkała w Poznaniu przy ul. Długiej 5")).toContain("Poznaniu");
    expect(await found("Sąd Okręgowy w Poznaniu oddalił powództwo.")).toEqual([]);
  });

  it("a surname that is also a village before a given name; not the inside of P.H.U.", async () => {
    expect(await found("/-/ NOWAK Beata\n")).toEqual(["NOWAK Beata"]);
    expect(await found("firma P.H.U. Marex Marek Nowak.")).toEqual(["Marek Nowak"]);
  });

  it("a name ends at the line: the address under it is its own span", async () => {
    const vault = new PseudonymizationVault();
    const result = await new LocalPolishPseudonymizer(vault, {
      recognize: async (text: string) => [{ start: 7, end: 7 + "Paweł Kania\nos. Kosmonautów".length, kind: "PERSON" as const, value: text.slice(7, 7 + "Paweł Kania\nos. Kosmonautów".length) }]
    }).pseudonymize("Powód: Paweł Kania\nos. Kosmonautów 86/9");
    expect(result.text.split("\n")[0]).toMatch(/^Powód: \[PII:PERSON:\d{4}\]$/u);
  });
});
