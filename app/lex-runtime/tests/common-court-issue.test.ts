import { describe, expect, it } from "vitest";
import { commonCourtIssuePrompt, commonCourtPage, commonCourtRulingsByIssue } from "../src/courts/common-court-issue.js";
import type { CaseLawSearchResult } from "../src/case-law-search.js";

const RULING =
  "Sygn. akt XII Kp 176/20 POSTANOWIENIE Dnia 8 czerwca 2020 r. Sąd Okręgowy w Warszawie po rozpoznaniu zażalenia na postanowienie o odmowie wszczęcia śledztwa postanawia uchylić zaskarżone postanowienie. UZASADNIENIE " +
  "Okoliczności sprawy nie były przedmiotem ustaleń. ".repeat(40) +
  "Decyzja o odmowie wszczęcia śledztwa była przedwczesna albowiem prokurator dokonał rozstrzygnięcia w oparciu o niekompletny materiał dowodowy. " +
  "Koszty postępowania ponosi Skarb Państwa. ".repeat(40);

describe("common courts' rulings on the procedural setting (RD 121/26: XII Kp 176/20)", () => {
  it("searches the portal with the setting's phrase, reads the ruling and gives the passage on the issue", async () => {
    const asked: string[] = [];
    const search = async (query: string): Promise<CaseLawSearchResult> => {
      asked.push(query);
      return { source: "SAOS", status: "FOUND", query, reason: "COMMON_COURTS_PORTAL", candidates: [{ source: "SAOS", id: "1", caseNumbers: ["XII Kp 176/20"], courtType: "COMMON", sourceUrl: "https://orzeczenia.warszawa.so.gov.pl/details/$N/154505000006006_XII_Kp_000176_2020_Uz_2020-06-08_001", contentScope: "DISCOVERY" }] };
    };
    const read = async () => ({ text: RULING, court: "Sąd Okręgowy w Warszawie", date: "2020-06-08" });
    const rulings = await commonCourtRulingsByIssue(["odmowa wszczęcia przedwczesna niekompletny materiał dowodowy"], { search, read });
    expect(asked).toEqual(["odmowa wszczęcia przedwczesna niekompletny materiał dowodowy"]);
    expect(rulings).toHaveLength(1);
    expect(rulings[0]!.signature).toBe("XII Kp 176/20");
    expect(rulings[0]!.passages).toContain("była przedwczesna albowiem prokurator dokonał rozstrzygnięcia w oparciu o niekompletny materiał dowodowy");
    expect(commonCourtIssuePrompt(rulings)).toContain("## Sąd Okręgowy w Warszawie, 2020-06-08, XII Kp 176/20");
  });

  it("only the common courts' ruling pages are read from the portal search", () => {
    expect(commonCourtPage("https://orzeczenia.ms.gov.pl/details/xyz/1")).toBe(true);
    expect(commonCourtPage("https://orzeczenia.krakow.sa.gov.pl/content/abc/1")).toBe(true);
    expect(commonCourtPage("https://orzeczenia.nsa.gov.pl/doc/ABC")).toBe(false);
    expect(commonCourtPage("https://orzeczenia.ms.gov.pl/search/simple/x")).toBe(false);
    expect(commonCourtPage("https://example.com/details/1")).toBe(false);
  });

  it("no reader (tests, offline): nothing", async () => {
    expect(await commonCourtRulingsByIssue(["odmowa wszczęcia"], { search: null, read: null })).toEqual([]);
  });
});
