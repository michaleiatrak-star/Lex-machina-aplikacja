import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addresseeCourt, courtOfCaseDocuments, courtOfDocument, validCaseCourt } from "../src/courts/case-court.js";
import {
  appealCourt,
  courtBase,
  courtByName,
  courtOfCommune,
  courtOfUnit,
  courtsHearing,
  courtsInText,
  districtCourt
} from "../src/courts/court-base.js";
import { locateCourt, parseAddress, type FetchText } from "../src/courts/court-locator.js";
import { CourtToolRuntime } from "../src/courts/court-tool-runtime.js";

// GUGiK answers (UUG geocoder, ULDK cadastre, PRG court areas) recorded on 17.10.2026 for the
// addresses below; app/courts/check_court_base_prg.py checks the whole base against PRG.
const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/courts/gugik-recorded-2026-10-17.json"), "utf8")) as {
  responses: Record<string, string>;
  cases: Array<{ address: string; expected: string; status: string; sr: string | null }>;
};

const replay: FetchText = async (url) => {
  const body = recorded.responses[url];
  if (body === undefined) throw new Error(`NOT_RECORDED ${url}`);
  return { ok: true, status: 200, text: async () => body };
};

describe("court base from the regulation (t.j. Dz.U. 2026 poz. 492)", () => {
  const base = courtBase();

  it("11 appeal, 47 regional, 319 district courts; every district court reaches its appeal court", () => {
    expect([base.sa.length, base.so.length, base.sr.length]).toEqual([11, 47, 319]);
    for (const court of base.sr) {
      const so = districtCourt(court.so);
      expect(so, court.nazwa).not.toBeNull();
      expect(appealCourt(so!.sa), so!.nazwa).not.toBeNull();
    }
    expect(base.problemy).toEqual([]);
  });

  it("every commune of PRG belongs to one district court, nine cities to several", () => {
    const codes = base.sr.flatMap((court) => court.terc);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length + Object.keys(base.miasta_dzielone).length).toBe(2479);
    expect(Object.values(base.miasta_dzielone).map((city) => [city.nazwa, city.sady.length]).sort((a, b) => String(a[0]).localeCompare(String(b[0]), "pl"))).toEqual([
      ["Gdańsk", 2], ["Katowice", 2], ["Kraków", 4], ["Lublin", 2], ["Łódź", 2], ["Poznań", 3], ["Szczecin", 2], ["Warszawa", 7], ["Wrocław", 3]
    ]);
  });

  it("where PRG lags behind the regulation, the regulation decides (Czeladź, Grójec, Sławno)", () => {
    expect(courtOfCommune("2401021")).toMatchObject({ court: { nazwa: "Sąd Rejonowy w Czeladzi" } });
    expect(courtOfCommune("140605")).toMatchObject({ court: { nazwa: "Sąd Rejonowy w Grójcu" } });
    expect(courtOfCommune("3213011")).toMatchObject({ court: { nazwa: "Sąd Rejonowy w Sławnie" } });
    expect(courtOfCommune("146510_8")).toMatchObject({ split: { nazwa: "Warszawa" } });
    expect(courtOfUnit("146510_8")).toMatchObject({ unit: "Śródmieście", court: { nazwa: "Sąd Rejonowy dla Warszawy-Śródmieścia w Warszawie" } });
    expect(courtOfUnit("106103_9")).toMatchObject({ unit: "Górna", court: { nazwa: "Sąd Rejonowy dla Łodzi-Widzewa w Łodzi" } });
  });

  it("kinds of cases: a court without a department is pointed to the courts of its region that have it", () => {
    const sokolka = courtByName("Sąd Rejonowy w Sokółce")!;
    expect(sokolka.zakres).not.toContain("gospodarcze");
    expect(courtsHearing("gospodarcze", "Sąd Okręgowy w Białymstoku").map((court) => court.nazwa)).toEqual(["Sąd Rejonowy w Białymstoku"]);
  });

  it("court names in a text: nominative, genitive, m.st., hyphens split by a line break", () => {
    const text = "Do Sądu Rejonowego dla Krakowa-Śródmieścia w Krakowie. Sąd Rejonowy dla m.st. Warszawy w Warszawie oraz Sąd Okręgowy Warszawa -\nPraga w Warszawie.";
    expect(courtsInText(text).map((item) => item.court.nazwa)).toEqual([
      "Sąd Rejonowy dla Krakowa-Śródmieścia w Krakowie",
      "Sąd Rejonowy dla miasta stołecznego Warszawy w Warszawie",
      "Sąd Okręgowy Warszawa-Praga w Warszawie"
    ]);
  });
});

describe("address to court (GUGiK services, recorded)", () => {
  it.each(recorded.cases.map((item) => [item.address, item]))("%s", async (_address, item) => {
    const result = await locateCourt(item.address, { fetchText: replay });
    expect({ status: result.status, sr: result.sr?.nazwa ?? null }).toEqual({ status: item.status, sr: item.sr });
  });

  it("the recorded cases: 39 of 42 found, every found court the expected one; three ask for an existing number", () => {
    const found = recorded.cases.filter((item) => item.status === "FOUND");
    expect(found).toHaveLength(39);
    expect(found.every((item) => item.sr === item.expected)).toBe(true);
    expect(recorded.cases.filter((item) => item.status !== "FOUND").map((item) => item.address)).toEqual([
      "ul. Marymoncka 100, Warszawa", "ul. Wielicka 100, Kraków", "ul. Rokicińska 100, Łódź"
    ]);
  });

  it("a street name alone never finds a village of that name (Wyszków, not Kościuszki near Goleniów)", async () => {
    const result = await locateCourt("ul. Tadeusza Kościuszki 50, 07-200 Wyszków", { fetchText: replay });
    expect(result.sr?.nazwa).toBe("Sąd Rejonowy w Wyszkowie");
    expect(result.so?.nazwa).toBe("Sąd Okręgowy w Ostrołęce");
    // § 1: Sąd Apelacyjny w Białymstoku covers the regional court in Ostrołęka.
    expect(result.sa?.nazwa).toBe("Sąd Apelacyjny w Białymstoku");
    expect(result.sr?.adres).toMatch(/07-200 Wyszków$/u);
  });

  it("addresses as letters write them", () => {
    expect(parseAddress("ul. Długa 12/3, 31-147 Kraków")).toMatchObject({ street: "ul. Długa", number: "12/3", locality: "Kraków", postalCode: "31-147" });
    expect(parseAddress("Krupówki 12 m. 3, 34-500 Zakopane")).toMatchObject({ street: "Krupówki", number: "12", locality: "Zakopane" });
    expect(parseAddress("Kołbaskowo 106, 72-001 Kołbaskowo")).toMatchObject({ locality: "Kołbaskowo", number: "106" });
    expect(parseAddress("Ignacego Buszy nr 1; 63-900 Rawicz")).toMatchObject({ street: "Ignacego Buszy", number: "1", locality: "Rawicz" });
    expect(parseAddress("Przemysłowa 1 B, 24-300 Opole Lubelskie")).toMatchObject({ street: "Przemysłowa", number: "1B" });
  });

  it("near a boundary of a split city: both courts, none chosen", async () => {
    const fetchText: FetchText = async (url) => {
      if (url.includes("uug")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ results: { 1: { city: "Szczecin", street: "1 Maja", number: "20", teryt: "326201", x: "100", y: "200", accuracy: "1", code: "71-627" } } }) };
      }
      const wide = /BBOX=1[67]\d\./u.test(url);
      return { ok: true, status: 200, text: async () => `<ms:JPT_NAZWA_>Sąd Rejonowy Szczecin-Centrum w Szczecinie</ms:JPT_NAZWA_>${wide ? "<ms:JPT_NAZWA_>Sąd Rejonowy Szczecin-Prawobrzeże i Zachód w Szczecinie</ms:JPT_NAZWA_>" : ""}` };
    };
    const result = await locateCourt("ul. 1 Maja 20, 71-627 Szczecin", { fetchText });
    expect(result.status).toBe("NEAR_BOUNDARY");
    expect(result.candidates?.map((court) => court.nazwa)).toEqual(["Sąd Rejonowy Szczecin-Centrum w Szczecinie", "Sąd Rejonowy Szczecin-Prawobrzeże i Zachód w Szczecinie"]);
  });

  it("services down: no court invented; a whole-commune town gives its court as a candidate", async () => {
    const down: FetchText = async () => {
      throw new Error("ECONNREFUSED");
    };
    const town = await locateCourt("ul. Rynek 8, 17-120 Brańsk", { fetchText: down });
    expect(town.status).toBe("SERVICE_UNAVAILABLE");
    expect(town.sr).toBeUndefined();
    expect(town.candidates?.map((court) => court.nazwa)).toEqual(["Sąd Rejonowy w Bielsku Podlaskim"]);
    const city = await locateCourt("ul. Długa 1, 80-827 Gdańsk", { fetchText: down });
    expect(city.candidates?.map((court) => court.nazwa)).toEqual(["Sąd Rejonowy Gdańsk-Południe w Gdańsku", "Sąd Rejonowy Gdańsk-Północ w Gdańsku"]);
  });
});

describe("court_for_address: the alias restored in the application, the address never returned", () => {
  it("restores the alias, returns the courts without the address or the commune", async () => {
    const tool = new CourtToolRuntime((token) => (token === "[LMPII:D01:ADDRESS:0002]" ? "ul. Tadeusza Kościuszki 50, 07-200 Wyszków" : null), replay);
    const [result] = await tool.runTools([{ id: "c1", name: "court_for_address", input: { address: "[LMPII:D01:ADDRESS:0002|LOC]", basis: "pozwany, art. 27 § 1 KPC", kind: "cywilne" } }]);
    const content = JSON.parse(result!.content);
    expect(content).toMatchObject({ status: "FOUND", sr: { nazwa: "Sąd Rejonowy w Wyszkowie" }, kind: { requested: "cywilne", heard: true }, podstawaWlasciwosci: "pozwany, art. 27 § 1 KPC" });
    // The court's own seat is in the result; the party's address and commune are not.
    expect(result!.content).not.toMatch(/Tadeusza Kościuszki 50|"place"|"gmina"|"terc"/u);
    expect(tool.courts()).toEqual(expect.arrayContaining(["Sąd Rejonowy w Wyszkowie", "Sąd Okręgowy w Ostrołęce", "Sąd Apelacyjny w Białymstoku"]));
    expect(tool.auditEvents()).toEqual([{ tool: "court_for_address", status: "FOUND", method: "AKT_GMINA", court: "Sąd Rejonowy w Wyszkowie", disclosed: ["ADDRESS"] }]);
  });

  it("an alias unknown in the case: no lookup", async () => {
    let asked = false;
    const tool = new CourtToolRuntime(() => null, async () => {
      asked = true;
      throw new Error("no");
    });
    const [result] = await tool.runTools([{ id: "c1", name: "court_for_address", input: { address: "[PII:ADDRESS:0009]", basis: "x" } }]);
    expect(JSON.parse(result!.content).status).toBe("ADDRESS_INCOMPLETE");
    expect(asked).toBe(false);
  });
});

describe("the court of a case", () => {
  const summons = [
    "Sąd Rejonowy dla Krakowa-Podgórza w Krakowie",
    "I Wydział Cywilny",
    "ul. Przy Rondzie 7, 31-547 Kraków",
    "Sygn. akt I C 1234/26",
    "",
    "WEZWANIE",
    "Sąd wzywa pozwanego do złożenia odpowiedzi na pozew w terminie dwóch tygodni."
  ].join("\n");

  it("from a court's letter: court, department, signature", () => {
    expect(courtOfDocument(summons)).toEqual({ nazwa: "Sąd Rejonowy dla Krakowa-Podgórza w Krakowie", wydzial: "I Wydział Cywilny", sygnatura: "I C 1234/26" });
  });

  it("the documents of a case: the court with a signature wins over one merely mentioned", () => {
    const letter = "Pismo do Sądu Okręgowego w Krakowie w innej sprawie.";
    expect(courtOfCaseDocuments([{ documentId: "d1", text: letter }, { documentId: "d2", text: summons }])).toMatchObject({ nazwa: "Sąd Rejonowy dla Krakowa-Podgórza w Krakowie", sygnatura: "I C 1234/26", documentId: "d2" });
    expect(courtOfCaseDocuments([{ text: "Umowa najmu lokalu." }])).toBeNull();
  });

  it("a letter's addressee from its head; the record validated", () => {
    expect(addresseeCourt("=== PISMO ===\nKraków, 17 października 2026 r.\n\nSąd Rejonowy w Wyszkowie\nI Wydział Cywilny\n\nPOZEW")).toBe("Sąd Rejonowy w Wyszkowie");
    expect(validCaseCourt({ nazwa: "Sąd Rejonowy w Nibylandii", zrodlo: "AKTA", at: "x" })).toBeNull();
    expect(validCaseCourt({ nazwa: "sąd rejonowy w wyszkowie", zrodlo: "PISMO", at: "x" })).toEqual({ nazwa: "Sąd Rejonowy w Wyszkowie", zrodlo: "PISMO", at: "x" });
  });
});
