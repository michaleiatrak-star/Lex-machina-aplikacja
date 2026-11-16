import { describe, expect, it } from "vitest";
import { caseIssue, relevantClause } from "../src/case-issue.js";
import { matchingTags, wsdRulingsByIssue, wsdTags, wsdTopicPrompt } from "../src/courts/wsd-topics.js";
import type { WsdFetch } from "../src/courts/wsd-portal.js";

const KEA_16 =
  "§ 16. W razie konieczności przytoczenia drastycznych okoliczności lub wyrażeń adwokat powinien nadać swemu wystąpieniu taką formę, aby nie uchybiać powadze sądu, władz i godności zawodu adwokackiego. W korespondencji zawodowej należy przestrzegać właściwych form. Nie wolno używać wyrażeń czy zwrotów obraźliwych ani grozić ściganiem karnym lub dyscyplinarnym.";
// RD 121/26: the decision refusing to open disciplinary proceedings, in its own words.
const FILE =
  "POSTANOWIENIE o odmowie wszczęcia dochodzenia. Zastępca Rzecznika Dyscyplinarnego Izby Adwokackiej. Zakaz z § 16 KEA chroni przed wykorzystywaniem groźby ścigania karnego jako środka nacisku. Pismo adwokata nie zapowiada złożenia zawiadomienia o przestępstwie.";

describe("the case's legal issue (RD 121/26)", () => {
  it("takes the clause of § 16 KEA the file speaks of, not the whole paragraph", () => {
    expect(relevantClause(KEA_16, FILE)).toBe("grozić ściganiem karnym lub dyscyplinarnym");
  });

  it("asks the WSD and SN portals by the norm and the common courts by the decision challenged", () => {
    const issue = caseIssue([{ code: "KEA", paragraph: "16", text: KEA_16 }], FILE, "przygotuj podważenie postanowienia zastępcy rzecznika dyscyplinarnego");
    expect(issue.barDisciplinary).toBe(true);
    expect(issue.queries.map((item) => item.query)).toEqual([
      "grozić ściganiem karnym dyscyplinarnym site:wsd.adwokatura.pl",
      "grozić ściganiem karnym dyscyplinarnym adwokat site:sn.pl",
      "odmowa wszczęcia przedwczesna niekompletny materiał dowodowy site:orzeczenia.ms.gov.pl",
      "odmowa wszczęcia przedwczesna niekompletny materiał dowodowy site:sn.pl"
    ]);
  });

  it("no rule and no setting: no issue queries", () => {
    expect(caseIssue([], "Umowa najmu lokalu.", "czy mogę wypowiedzieć umowę").queries).toEqual([]);
  });
});

const W = "https://wsd.adwokatura.pl";
const tagLink = (slug: string, name: string) => `<a href="${W}/rejestry/listHaslaTag/${slug}" title="${name}"><div>${name}</div></a>`;
const ruling = (signature: string, title: string) =>
  `<html><h1>${title}</h1><article>Strona główna / Orzecznictwo / ${title} Teza o groźbie. Sygnatura: </strong> ${signature} </article><h3>Tagi</h3>${tagLink("grozba-120", "groźba spowodowania postępowania karnego lub dyscyplinarnego")}</html>`;

describe("WSD register by the issue (tags)", () => {
  const tags = wsdTags(
    tagLink("grozba-spowodowania-postepowania-karnego-lub-dyscyplinarnego-120", "groźba spowodowania postępowania karnego lub dyscyplinarnego") +
      tagLink("przeciwnik-procesowy-149", "przeciwnik procesowy") +
      tagLink("podpis-pod-pismem-procesowym-146", "podpis pod pismem procesowym") +
      tagLink("prawo-dyscyplinarne-procesowe-55", "prawo dyscyplinarne procesowe") +
      tagLink("przeslanka-procesowa-12", "przesłanka procesowa")
  );

  it("the tag of the issue first; common words (procesowy, dyscyplinarny, prze-) choose nothing alone", () => {
    const chosen = matchingTags(tags, "grozić ściganiem karnym lub dyscyplinarnym\npismo adwokata do przeciwnika procesowego");
    expect(chosen[0]?.name).toBe("groźba spowodowania postępowania karnego lub dyscyplinarnego");
    expect(chosen.map((tag) => tag.name)).not.toContain("prawo dyscyplinarne procesowe");
    expect(chosen.map((tag) => tag.name)).not.toContain("przesłanka procesowa");
  });

  it("reads the rulings of the chosen tag, newest first, and portal hits before them", async () => {
    const pages: Record<string, string> = {
      [`${W}/rejestry/listHasla`]: tags.map((tag) => tagLink(tag.url.replace(`${W}/rejestry/listHaslaTag/`, ""), tag.name)).join(""),
      [`${W}/rejestry/listHaslaTag/grozba-spowodowania-postepowania-karnego-lub-dyscyplinarnego-120`]:
        `<a href="${W}/rejestry/show/orzeczenie-wkd-z-dnia-28-kwietnia-1962r-1668">a</a><a href="${W}/rejestry/show/wyrok-sadu-najwyzszego-z-dnia-10-maja-2012-r-1407">b</a>`,
      [`${W}/rejestry/show/orzeczenie-wkd-z-dnia-28-kwietnia-1962r-1668`]: ruling("WKD 48/62", "Orzeczenie WKD z dnia 28 kwietnia 1962 r."),
      [`${W}/rejestry/show/wyrok-sadu-najwyzszego-z-dnia-10-maja-2012-r-1407`]: ruling("SDI 9/12", "Wyrok Sądu Najwyższego z dnia 10 maja 2012 r."),
      [`${W}/rejestry/show/orzeczenie-wsd-z-dnia-7-listopada-2017-r-1151`]: ruling("WSD 128/17", "Orzeczenie WSD z dnia 7 listopada 2017 r.")
    };
    const fetchImpl: WsdFetch = async (url) => (pages[url] ? { ok: true, status: 200, text: async () => pages[url]! } : { ok: false, status: 404, text: async () => "" });
    const found = await wsdRulingsByIssue("grozić ściganiem karnym lub dyscyplinarnym", { fetchImpl, extraUrls: [`${W}/rejestry/show/orzeczenie-wsd-z-dnia-7-listopada-2017-r-1151`] });
    expect(found.tags).toEqual(["groźba spowodowania postępowania karnego lub dyscyplinarnego"]);
    expect(found.rulings.map((item) => item.signature)).toEqual(["WSD 128/17", "SDI 9/12", "WKD 48/62"]);
    expect(found.rulings[1]?.viaTag).toBe("groźba spowodowania postępowania karnego lub dyscyplinarnego");
    const prompt = wsdTopicPrompt(found);
    expect(prompt).toContain("## SDI 9/12 — Wyrok Sądu Najwyższego z dnia 10 maja 2012 r.");
    expect(prompt).toContain("cytuj wyłącznie z tego tekstu");
  });
});

describe("WSD second round: the rulings the first ones cite", async () => {
  const { wsdSecondRound, citedDisciplinarySignatures } = await import("../src/courts/wsd-topics.js");
  it("looks up WSD 90/06 cited in SDI 9/12, not the ones already found", async () => {
    expect(citedDisciplinarySignatures("Kasacja od orzeczenia WSD 90/06; zob. SDI 23/07 i SDI 9/12.")).toEqual(["WSD 90/06", "SDI 23/07", "SDI 9/12"]);
    const asked: string[] = [];
    const first = {
      tags: ["groźba spowodowania postępowania karnego lub dyscyplinarnego"],
      rulings: [
        { url: "u1", title: "Wyrok SN z 10 maja 2012 r.", signature: "SDI 9/12", tags: [], viaTag: "t", text: "Kasacja od orzeczenia WSD 90/06; por. SDI 23/07." },
        { url: "u2", title: "Postanowienie SN", signature: "SDI 23/07", tags: [], viaTag: "t", text: "" },
        { url: "u3", title: "Orzeczenie WSD", signature: "WSD 127/12", tags: [], viaTag: "t", text: "" }
      ]
    };
    const second = await wsdSecondRound(first, {
      find: async (signature) => (asked.push(signature), { status: "FOUND", url: "https://wsd.adwokatura.pl/rejestry/show/x-1", title: "Orzeczenie WSD z 2006 r.", text: "Teza." }),
      search: null
    });
    expect(asked).toEqual(["WSD 90/06"]);
    expect(second).toEqual([expect.objectContaining({ signature: "WSD 90/06", viaTag: "powołane w SDI 9/12" })]);
  });
});
