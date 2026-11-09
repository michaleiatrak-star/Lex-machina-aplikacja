import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cutUsSection, readUsStateSection, US_JURISDICTIONS, usJurisdiction, usJurisdictionOfHost, usSectionToken } from "../src/eli/us-states.js";
import { nationalLawCountry, readNationalLaw } from "../src/eli/national-law.js";
import { HOSTS_WITHOUT_INTERMEDIATE } from "../src/eli/us-tls.js";
import { californiaUnit, parseLawSections } from "../src/eli/us-ca-pubinfo.js";

// Official state code pages read on 2026-11-09 (tests/fixtures/eli-readers/us-*).
const page = (name: string): string => fs.readFileSync(path.join(import.meta.dirname, "fixtures/eli-readers", name), "utf8");
const first = (html: string, unit: string) => readUsStateSection(html, unit)[0]!;

describe("US states, DC and territories: registry", () => {
  it("50 states, the District of Columbia and 5 territories, each once", () => {
    const codes = US_JURISDICTIONS.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(US_JURISDICTIONS.filter((item) => item.kind === "stan")).toHaveLength(50);
    expect(US_JURISDICTIONS.filter((item) => item.kind === "dystrykt").map((item) => item.code)).toEqual(["US-DC"]);
    expect(US_JURISDICTIONS.filter((item) => item.kind === "terytorium").map((item) => item.code).sort()).toEqual(["US-AS", "US-GU", "US-MP", "US-PR", "US-VI"]);
  });

  it("every reader has its hosts and a sample that answered; the rest say why there is none", () => {
    for (const item of US_JURISDICTIONS) {
      if (item.reading === "HTML" || item.reading === "PDF" || item.reading === "ZBIORCZE") {
        expect(item.hosts, item.code).toBeDefined();
        expect(item.sample, item.code).toBeDefined();
        expect(item.hosts!.test(new URL(item.sample!.url).hostname), item.code).toBe(true);
      } else {
        expect(item.note.length, item.code).toBeGreaterThan(20);
      }
    }
    expect(US_JURISDICTIONS.filter((item) => item.reading === "HTML" || item.reading === "PDF" || item.reading === "ZBIORCZE").length).toBeGreaterThanOrEqual(42);
  });

  it("state hosts belong to the US legal system; lookup by code", () => {
    expect(nationalLawCountry("www.revisor.mn.gov")).toBe("US");
    expect(usJurisdictionOfHost("tcss.legis.texas.gov")?.code).toBe("US-TX");
    expect(usJurisdiction("ny")?.reading).toBe("BLOKADA");
    expect(usJurisdiction("US-CA")?.reading).toBe("ZBIORCZE");
    expect(HOSTS_WITHOUT_INTERMEDIATE.test("www.cga.ct.gov")).toBe(true);
    expect(HOSTS_WITHOUT_INTERMEDIATE.test("www.ilga.gov")).toBe(true);
    expect(HOSTS_WITHOUT_INTERMEDIATE.test("www.revisor.mn.gov")).toBe(false);
  });
});

describe("US state section reader (one reader, the number decides)", () => {
  it("unit forms: §, Sec., code abbreviation", () => {
    expect(usSectionToken("§ 13-1105")).toBe("13-1105");
    expect(usSectionToken("Sec. 11.41.100")).toBe("11.41.100");
    expect(usSectionToken("RCW 9A.32.030")).toBe("9A.32.030");
  });

  it("WV: the section text, not the copy in the side panel with bill history", () => {
    const article = first(page("us-wv-61-2-1.html"), "61-2-1");
    expect(article.heading).toMatch(/^§61-2-1\. First and second degree murder/u);
    expect(article.text).toContain("Murder by poison, lying in wait");
    expect(article.text).not.toContain("Bill History");
  });

  it("WA: page title and breadcrumbs skipped, the heading with its catchline on the next line", () => {
    const article = first(page("us-wa-9a-32-030.html"), "9A.32.030");
    expect(article.text).toMatch(/^RCW 9A\.32\.030\nMurder in the first degree\./u);
  });

  it("ME: §201 with its numbered subsections (\"1.\" is not the next section)", () => {
    const article = first(page("us-me-17a-201.html"), "§201");
    expect(article.text).toMatch(/^§201\. Murder\n1\.\nA person is guilty of murder/u);
    expect(article.text).not.toMatch(/§202\. /u);
  });

  it("MO: a bare number in the history table is not a heading", () => {
    expect(first(page("us-mo-565-020.html"), "565.020").text).toMatch(/^565\.020\. First degree murder/u);
  });

  it("FL: number and title glued in the page; em space after the number", () => {
    expect(first(page("us-fl-782-04.html"), "782.04").text).toMatch(/^782\.04 Murder\.—\n\(1\)\(a\) The unlawful killing/u);
  });

  it("HI: the section, not its Commentary", () => {
    const article = first(page("us-hi-707-701.html"), "707-701");
    expect(article.text).toMatch(/^§707-701 Murder in the first degree\./u);
  });

  it("DE: one section cut from a subchapter page, up to the next §", () => {
    const article = first(page("us-de-t11-c5-sc2.html"), "§ 636");
    expect(article.text).toMatch(/^§ 636\. Murder in the first degree; class A felony\./u);
    expect(article.text).not.toMatch(/§ 637/u);
  });

  it("ID: the section heading after the site's menus", () => {
    expect(first(page("us-id-18-4001.html"), "18-4001").text).toMatch(/^18-4001\. Murder defined\./u);
  });

  it("PDF text: the heading with a catchline wins over references and the table of contents", () => {
    const lines = [
      "§21-701.7. Murder in the first degree. ............ 29",
      "§21-701.8. Murder in the second degree. ............ 30",
      "1. First degree murder as defined in Section 701.7 of this",
      "§21-701.7. Murder in the first degree.",
      "A. A person commits murder in the first degree when that person, unlawfully and with malice aforethought, causes the death of another human being.",
      "§21-701.8. Murder in the second degree."
    ];
    const [article] = cutUsSection(lines, "§21-701.7");
    expect(article!.text).toMatch(/^§21-701\.7\. Murder in the first degree\.\nA\. A person commits/u);
    expect(cutUsSection(lines, undefined)).toEqual([]);
  });

  it("readNationalLaw: a state page, unit required, country US", async () => {
    const body = fs.readFileSync(path.join(import.meta.dirname, "fixtures/eli-readers", "us-wa-9a-32-030.html"));
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => "text/html; charset=utf-8" }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
    const answer = await readNationalLaw({ url: "https://app.leg.wa.gov/RCW/default.aspx?cite=9A.32.030", unit: "9A.32.030", country: "US" }, fetchImpl as never);
    expect(answer.country).toBe("US");
    expect(answer.title).toBe("Revised Code of Washington (Waszyngton)");
    expect(answer.articles[0]!.text).toContain("Murder in the first degree.");
    const none = await readNationalLaw({ url: "https://app.leg.wa.gov/RCW/default.aspx?cite=9A.32.030", country: "US" }, fetchImpl as never);
    expect(none.note).toMatch(/podaj jednostkę/u);
  });
});

describe("California: Legislative Counsel bulk database (pubinfo) by byte ranges", () => {
  it("unit: code abbreviation or name, and the section", () => {
    expect(californiaUnit("PEN 187")).toEqual({ code: "PEN", section: "187" });
    expect(californiaUnit("Penal Code § 187")).toEqual({ code: "PEN", section: "187" });
    expect(californiaUnit("Civil Code 1714")).toEqual({ code: "CIV", section: "1714" });
    expect(californiaUnit("XYZ 1")).toBeNull();
  });

  it("LAW_SECTION_TBL rows: the active row gives the text file and the history", () => {
    // Row as in pubinfo_2025.zip (read 2026-11-09).
    const row = "`PEN187.202326014`\t`PEN`\t`187.`\t`2023`\t`260`\t`14`\t2024-01-01 00:00:00\t`id_ce651269`\tNULL\t`8.`\t`1.`\t`1.`\tNULL\t`Amended by Stats. 2023, Ch. 260, Sec. 14.   (SB 345)   Effective January 1, 2024.`\tLAW_SECTION_TBL_69792.lob\t`Y`\t`LEG_ESI`\t2026-09-26 01:01:15";
    const rows = parseLawSections(row);
    expect(rows.get("PEN 187")).toMatchObject({ lob: "LAW_SECTION_TBL_69792.lob", active: true, history: expect.stringMatching(/^Amended by Stats\. 2023, Ch\. 260/u) });
  });
});

describe("New Jersey statutes file and Puerto Rico consolidated laws (line text)", () => {
  it("NJ STATUTES.TXT: index line, then the section with its tab layout", () => {
    // Lines as in STATUTES-TEXT.zip ("UPDATED THROUGH P.L.2026, c.50"), read 2026-11-09.
    const lines = ["2C:11-3  Murder.", "\t2C:11-3.\tMurder.", "", "\ta.\tExcept as provided in N.J.S.2C:11-4, criminal homicide constitutes murder when:", "\t(1)\tThe actor purposely causes death or serious bodily injury resulting in death; or", "2C:11-4  Manslaughter.", "\t2C:11-4.\tManslaughter."];
    const [article] = cutUsSection(lines, "2C:11-3");
    expect(article!.text).toMatch(/^2C:11-3\. Murder\.\na\. Except as provided/u);
    expect(article!.text).not.toContain("Manslaughter");
  });

  it("PR: Artículo N with its L.P.R.A. citation, up to the next Artículo", () => {
    const lines = ["Artículo 93. — Grados de asesinato. (33 L.P.R.A. § 5142)", "Constituye asesinato en primer grado:", "(a) Todo asesinato perpetrado por medio de veneno, acecho o tortura, o con premeditación.", "Artículo 94. — Asesinato atenuado. (33 L.P.R.A. § 5143)"];
    const [article] = cutUsSection(lines, "Artículo 93");
    expect(article!.text).toMatch(/^Artículo 93\. — Grados de asesinato\./u);
    expect(article!.text).not.toContain("Artículo 94");
  });
});
