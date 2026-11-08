import { describe, expect, it } from "vitest";
import { ELI_COUNTRIES, eliAddress, eliCapabilityNotice } from "../src/eli/eli-countries.js";

// Every builder reproduces the example of the country's page in the EUR-Lex ELI register.
const EXAMPLES: Array<[string, Parameters<typeof eliAddress>[1], string]> = [
  ["PL", { type: "DU", year: 2026, number: "795", version: "tj" }, "https://eli.gov.pl/eli/DU/2026/795/tj/pol/pdf"],
  ["AT", { type: "I", year: 2018, number: "30", pointInTime: "20180516" }, "https://www.ris.bka.gv.at/eli/bgbl/I/2018/30/20180516"],
  ["BE", { type: "loi", year: 2014, month: 4, day: 25, number: "2014003194" }, "https://www.ejustice.just.fgov.be/eli/loi/2014/04/25/2014003194/justel"],
  ["DK", { type: "lta", year: 2014, number: "1308" }, "https://www.retsinformation.dk/eli/lta/2014/1308"],
  ["FR", { type: "loi", year: 2023, month: 4, day: 14, number: "2023-270" }, "https://www.legifrance.gouv.fr/eli/loi/2023/4/14/2023-270/jo/texte"],
  ["IT", { type: "sg", year: 2015, month: 4, day: 16, number: "15G00055" }, "https://www.gazzettaufficiale.it/eli/id/2015/04/16/15G00055/sg"],
  ["LU", { type: "loi", year: 2017, month: 6, day: 13, number: "a566" }, "http://data.legilux.public.lu/eli/etat/leg/loi/2017/06/13/a566/jo"],
  ["PT", { type: "lei", year: 2006, month: 6, day: 30, number: "26" }, "http://data.dre.pt/eli/lei/26/2006/06/30/p/dre/pt/html"],
  ["RS", { type: "skupstina/zakon", year: 2013, number: "45/4" }, "http://www.pravno-informacioni-sistem.rs/SlGlasnikPortal/eli/rep/sgrs/skupstina/zakon/2013/45/4/reg"],
  ["ES", { type: "l", year: 2015, month: 10, day: 1, number: "39", pointInTime: "20220713" }, "https://www.boe.es/eli/es/l/2015/10/01/39/con/20220713/spa/html"],
  ["CH", { type: "cc", year: 1958, number: "505_527_527", language: "fr" }, "https://fedlex.data.admin.ch/eli/cc/1958/505_527_527/fr"]
];

describe("ELI of the civil-law countries (EUR-Lex ELI register, 2026-11-08)", () => {
  it.each(EXAMPLES)("%s: the register's example address", (code, ref, expected) => {
    expect(eliAddress(code, ref)).toBe(expected);
  });

  it("builds no address without a documented template and says so", () => {
    for (const code of ["DE", "CZ", "SK", "HU", "GR", "RO", "LT", "NL", "SE", "FI", "NO", "HR", "AL"]) {
      expect(eliAddress(code, { type: "x", year: 2020, number: "1" })).toBeNull();
      expect(eliCapabilityNotice(code)).toMatch(/nie podaje szablonu|wdrożenie w toku|404|405|rejestr/u);
    }
  });

  it("every country has a source; no common-law country; Poland alone reads the text", () => {
    for (const country of ELI_COUNTRIES) {
      expect(country.source).toMatch(/^https?:\/\//u);
      expect(country.text?.reading).toBeTruthy();
      expect(["IE", "UK", "CY"]).not.toContain(country.code);
    }
    expect(ELI_COUNTRIES.filter((country) => country.level === "PEŁNA").map((country) => country.code)).toEqual(["PL"]);
    expect(eliCapabilityNotice("ES")).toContain("nie odczyta ani nie sprawdzi brzmienia");
  });
});

describe("ELI APIs of the countries (checked 2026-11-08)", () => {
  it("every API has its kind, auth and the result of the live probe; Poland and the EU are free", async () => {
    const { EU_ELI } = await import("../src/eli/eli-countries.js");
    for (const country of ELI_COUNTRIES.filter((item) => item.api)) {
      expect(country.api!.url).toMatch(/^https:\/\//u);
      expect(country.api!.checked).not.toBe("");
    }
    expect(ELI_COUNTRIES.find((item) => item.code === "PL")!.api!.auth).toBe("brak");
    expect(EU_ELI.kind).toBe("SPARQL");
    expect(eliCapabilityNotice("FR")).toContain("wymaga klucza");
  });
});

describe("coverage: the EU of civil law, Turkey, Ukraine, Moldova and the Balkans outside the EU", () => {
  it("every one of them is in the register, with its text reading status", () => {
    const eu = ["AT", "BE", "BG", "HR", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
    const others = ["TR", "UA", "MD", "RS", "ME", "MK", "BA", "XK", "AL", "IS", "LI", "MC", "SM", "AD"];
    const codes = new Set(ELI_COUNTRIES.map((country) => country.code));
    expect([...eu, ...others].filter((code) => !codes.has(code))).toEqual([]);
    expect(ELI_COUNTRIES.filter((country) => country.text?.reading === "CZYTNIK").map((country) => country.code).sort()).toEqual(["AT", "BE", "CH", "CZ", "DE", "DK", "ES", "IT", "NL"]);
  });
});
