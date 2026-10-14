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
    // Read after a prefix the name may run into the owner's name; the pseudonymizer cuts it
    // where a recognized person starts (test below).
    expect(found).toEqual(["Transkom", "Transkom", "Marex Marek Nowak"]);
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

describe("firm names: gaps found by the 5000-mention comparison corpus", () => {
  const values = (text: string) => detectFirmNames(text).map((span) => span.value);

  it("legal form in capitals (headings, KRS extracts)", () => {
    expect(values("POZWANY: TERMEX SP. Z O.O. z siedzibą w Krakowie")).toEqual(["TERMEX"]);
    expect(values("BUD-REM SPÓŁKA AKCYJNA")).toEqual(["BUD-REM"]);
  });

  it("several name words after a prefix, \"spółce\" included", () => {
    expect(values("Roszczenie dotyczy spółce Nordic Trade Group.")).toEqual(["Nordic Trade Group"]);
    expect(values("Zarząd P.H.U. Złota Rączka podjął uchwałę.")).toEqual(["Złota Rączka"]);
  });

  it("a trade adjective after the prefix is not the name; a trade noun needs one", () => {
    expect(values("Firma Handlowa Budex wystawiła fakturę.")).toEqual(["Budex"]);
    expect(values("Faktury wystawiał Zakład Usługowy Mar-Pol.")).toEqual(["Mar-Pol"]);
    expect(values("Biuro Rachunkowe Bilans prowadzi księgi.")).toEqual(["Bilans"]);
    expect(values("Zakład Ubezpieczeń Społecznych Oddział w Łodzi. Biuro Rzecznika Praw Obywatelskich.")).toEqual([]);
  });

  it("an inflected later mention", () => {
    expect(values("Umowę zawarto z Transkom sp. z o.o. Rozliczono się z Transkomem. Budex S.A. i Budeksowi.")).toEqual([
      "Transkom", "Transkomem", "Budex", "Budeksowi"
    ]);
  });

  it("a name in capitals and later in normal spelling; generic words inside a name after P.H.U.", () => {
    expect(values("Pozwaną jest DOMBUD SP. Z O.O. Przedstawiciel Dombud nie stawił się.")).toEqual(["DOMBUD", "Dombud"]);
    expect(values("Faktury wystawiała P.H.U. Mazowieckie Centrum Logistyki.")).toEqual(["Mazowieckie Centrum Logistyki"]);
    expect(values("Faktury wystawiała F.H.U. Biuro Rachunkowe Bilans.")).toEqual(["Biuro Rachunkowe Bilans"]);
  });

  it("public bodies and sentence ends stay", () => {
    expect(values("Odpowiada spółka Skarbu Państwa.")).toEqual([]);
    expect(values("Magazyn jest w Gdyni. Spółka akcyjna zawarła umowę.")).toEqual([]);
  });

  it("one token per firm across its case forms; the owner keeps a person token", async () => {
    const text = "Umowę zawarto z Transkom sp. z o.o. Rozliczono się z Transkomem. Firma P.H.U. Marex Marek Nowak.";
    const owner = text.indexOf("Marek Nowak");
    const recognizer = { recognize: async () => [{ start: owner, end: owner + 11, kind: "PERSON" as const, value: "Marek Nowak", confidence: 0.9 }] };
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), recognizer).pseudonymize(text);
    expect(result.text).not.toMatch(/Transkom|Marex|Marek|Nowak/);
    const byValue = new Map(result.findings.map((finding) => [text.slice(finding.start, finding.end), finding.token]));
    expect(byValue.get("Transkomem")).toBe(byValue.get("Transkom"));
    expect(byValue.get("Marex")).not.toBe(byValue.get("Marek Nowak"));
  });
});

describe("maiden names", () => {
  it("the word after \"z d.\" or \"z domu\" is a surname", async () => {
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault()).pseudonymize("Edyta Dudek z d. Kot oraz Anna Lis z domu Wróbel-Nowak.");
    expect(result.text).not.toMatch(/Kot|Wróbel-Nowak/);
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

  it("the town of an address written in capitals (\"UL. MONIUSZKI 167/26 W ŁODZI\")", async () => {
    expect(await found("Adres do doręczeń: UL. MONIUSZKI 167/26 W ŁODZI.")).toContain("ŁODZI");
    expect(await found("SĄD OKRĘGOWY W ŁODZI")).toEqual([]);
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

describe("a surname with two declensions in SGJP (Stępień: Stępnia / Stępienia)", () => {
  const form = (text: string) => ({ text, source: "sgjp", confidence: 1 });
  const person = (forms: Record<string, string>) => ({
    canonical: forms.NOM!,
    gender: "m1" as const,
    genderAlternatives: [],
    status: "ok" as const,
    warnings: [],
    forms: Object.fromEntries(Object.entries(forms).map(([kase, text]) => [kase, form(text)])) as never
  });
  const generated = person({ NOM: "Wojciech Stępień", GEN: "Wojciecha Stępienia", DAT: "Wojciechowi Stępieniowi", ACC: "Wojciecha Stępienia", INS: "Wojciechem Stępieniem", LOC: "Wojciechu Stępieniu", VOC: "Wojciechu Stępieniu" });
  const fromText = person({ NOM: "Wojciech Stępień", GEN: "Wojciecha Stępnia", DAT: "Wojciechowi Stępniowi", ACC: "Wojciecha Stępnia", INS: "Wojciechem Stępniem", LOC: "Wojciechu Stępniu", VOC: "Wojciechu Stępniu" });

  it("the variant the document uses decides the restored forms (found on 36 of 10 000 documents)", async () => {
    const { restoreWithReport } = await import("../src/privacy/restoration-report.js");
    const vault = new PseudonymizationVault();
    const token = vault.getOrCreate("PERSON", "Wojciech Stępień", generated);
    expect(vault.getOrCreate("PERSON", "Wojciecha Stępnia", fromText)).toBe(token);
    const restored = restoreWithReport(`Doręczyć ${token.slice(0, -1)}|DAT]. Wezwać ${token.slice(0, -1)}|ACC].`, vault).text;
    expect(restored).toBe("Doręczyć Wojciechowi Stępniowi. Wezwać Wojciecha Stępnia.");
    expect(restoreWithReport(`${token.slice(0, -1)}|NOM]`, vault).text).toBe("Wojciech Stępień");
  });

  it("a surface already in the paradigm changes nothing", () => {
    const vault = new PseudonymizationVault();
    const token = vault.getOrCreate("PERSON", "Wojciech Stępień", generated);
    vault.getOrCreate("PERSON", "Wojciecha Stępienia", generated);
    vault.getOrCreate("PERSON", "Wojciechowi Stępniowi", person({ ...Object.fromEntries(Object.entries(fromText.forms).map(([k, v]) => [k, (v as { text: string }).text])), NOM: "Wojciech Stępniow" }));
    expect(vault.restore(token, "DAT").text).toBe("Wojciechowi Stępieniowi");
  });
});

describe("a name in capitals above the same name written normally", () => {
  it("„NICOLE BARAN” in a heading is masked when „Nicole Baran” is recognized below (leak found on the 10 000 corpus)", async () => {
    const text = "POWÓDKA: NICOLE BARAN\nPowódka Nicole Baran wniosła pozew.";
    const start = text.indexOf("Nicole Baran");
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), {
      recognize: async () => [{ start, end: start + 12, kind: "PERSON" as const, value: "Nicole Baran" }]
    }).pseudonymize(text);
    expect(result.text).not.toContain("BARAN");
    expect(result.text).not.toContain("Baran");
  });
});

describe("leaks found on the full 10 000 run", () => {
  const recognizing = (...names: string[]) => ({
    recognize: async (text: string) =>
      names.flatMap((name) => {
        const start = text.indexOf(name);
        return start < 0 ? [] : [{ start, end: start + name.length, kind: "PERSON" as const, value: name }];
      })
  });

  it("a double surname cut at the hyphen by the recognizer is masked whole", async () => {
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), recognizing("Nicole Brzezińska")).pseudonymize("/-/ Nicole Brzezińska-Król\n");
    expect(result.text).not.toContain("Król");
  });

  it("the bare surname of a recognized person inside a sentence, not at its start", async () => {
    const text = "Pozwana Anna Lis zawarła umowę. Prezes spotkał się z Lis w biurze. Lis w lesie to inne słowo.";
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), recognizing("Anna Lis")).pseudonymize(text);
    expect(result.text).toContain("spotkał się z [PII:PERSON:");
    expect(result.text).toContain(". Lis w lesie");
  });
});
