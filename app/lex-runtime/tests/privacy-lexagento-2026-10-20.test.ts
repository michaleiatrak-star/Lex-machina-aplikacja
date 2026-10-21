import { describe, expect, it } from "vitest";
import { detectFirmNames } from "../src/privacy/firm-names.js";
import { CompositeRecognizer, LocalGazetteerRecognizer } from "../src/privacy/gazetteer-ner.js";
import { detectHealthData } from "../src/privacy/health-data.js";
import { detectIdentifiers } from "../src/privacy/identifiers.js";
import { LocalPersonMorphology } from "../src/privacy/person-morphology.js";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";
import { LocalStanzaNamedEntityRecognizer } from "../src/privacy/stanza-ner.js";

// Cases of the 2026-10-20 comparison with LexAgento, checked with the full local stack
// (Stanza, Morfeusz2/SGJP) where it is installed (LEX_NER_PYTHON, STANZA_RESOURCES_DIR).

describe("place and date of birth (deterministic, also with the recognizers down)", () => {
  const values = (text: string, kind: string) => detectIdentifiers(text).filter((span) => span.kind === kind).map((span) => span.value);
  it("masks the town after a birth date or 'urodzony w', and the date after the town", () => {
    const text = "ur. 12.03.1980 r. w Tarnowie, urodzony 5 maja 1975 r. w Nowym Sączu, urodzona w Gdańsku dnia 1.02.1990, miejsce urodzenia: Kraków.";
    expect(values(text, "ADDRESS")).toEqual(["Tarnowie", "Nowym Sączu", "Gdańsku", "Kraków"]);
    expect(values(text, "BIRTH_DATE")).toEqual(expect.arrayContaining(["12.03.1980 r.", "5 maja 1975 r.", "1.02.1990"]));
  });
  it("leaves a court's town and other towns alone", () => {
    expect(values("Sprawa toczy się w Sądzie Rejonowym w Tarnowie. Urodziny obchodził w Krakowie.", "ADDRESS")).toEqual([]);
  });
});

describe("identity card named in the text", () => {
  it("is masked also with a wrong check digit; a bare code of an invoice is not", () => {
    const kinds = (text: string) => detectIdentifiers(text).filter((span) => span.kind === "ID_CARD").map((span) => span.value);
    expect(kinds("legitymujący się dowodem osobistym nr ABC123456")).toEqual(["ABC123456"]);
    expect(kinds("dowód osobisty seria i nr: ABC 123456")).toEqual(["ABC 123456"]);
    expect(kinds("Faktura ABC123456")).toEqual([]);
  });
});

describe("sole trader's firm named after the person", () => {
  it("keeps the trade words readable and the person's name out of the firm span", () => {
    const text = "Powód Jan Nowak prowadzi działalność gospodarczą pod firmą Jan Nowak Usługi Remontowe.";
    expect(detectFirmNames(text).map((span) => span.value)).toEqual([]);
  });
  it("keeps a brand of its own after the name as a firm", () => {
    expect(detectFirmNames("Pozwany Jan Nowak prowadzi firmę Jan Nowak Kowbud.").map((span) => span.value)).toEqual(["Kowbud"]);
  });
  it("leaves a firm of a company as it was", () => {
    expect(detectFirmNames("Umowę zawarto z Budex sp. z o.o.").map((span) => span.value)).toEqual(["Budex"]);
  });
});

describe("health data (art. 9 RODO)", () => {
  it("finds diagnoses, injuries and ICD-10 codes, not a grudge", () => {
    expect(detectHealthData("Powód doznał złamania kości udowej i leczy się z powodu depresji. Rozpoznanie: S72.0, uraz głowy.").map((item) => item.value)).toEqual([
      "złamania kości udowej",
      "depresji",
      "S72.0",
      "uraz głowy"
    ]);
    expect(detectHealthData("Umowa najmu lokalu. Uraz do kierownika.")).toEqual([]);
  });
});

const fullStack = Boolean(process.env.LEX_NER_PYTHON && process.env.STANZA_RESOURCES_DIR);
describe.skipIf(!fullStack)("full local stack: one person, one token", () => {
  it("joins the nominative, the genitive of a surname SGJP does not know and the sole trader's firm", async () => {
    const recognizer = new CompositeRecognizer([new LocalStanzaNamedEntityRecognizer(), new LocalGazetteerRecognizer()]);
    const vault = new PseudonymizationVault();
    const out = await new LocalPolishPseudonymizer(vault, recognizer, new LocalPersonMorphology()).pseudonymize(
      "Powód Grzegorz Brzęczyszczykiewicz, ur. 12.03.1980 r. w Tarnowie, prowadzący działalność gospodarczą pod firmą Grzegorz Brzęczyszczykiewicz Usługi Remontowe, wnosi o zasądzenie na rzecz Grzegorza Brzęczyszczykiewicza kwoty 50 000 zł."
    );
    const persons = [...new Set(out.text.match(/\[PII:PERSON:\d{4}\]/gu) ?? [])];
    expect(persons).toHaveLength(1);
    expect(out.text).toContain(`pod firmą ${persons[0]} Usługi Remontowe`);
    expect(out.text).not.toMatch(/Tarnow|Brzęczyszczykiewicz/u);
    expect(vault.deanonymize(out.text)).toContain("Powód Grzegorz Brzęczyszczykiewicz, ur.");
  }, 300_000);
});
