import { describe, expect, it } from "vitest";
import { applyArticleChanges, articleChanges } from "../src/amendment-instructions.js";
import { amendmentMentionsArticle, amendmentPartFor } from "../src/temporal-source-freshness.js";

// Layout of Dz.U. 2025 poz. 1423 (KP), 1818 (KK, KW) and 1508 (KC) as their PDF text reads.
const KP_1423 = `DZIENNIK USTAW RZECZYPOSPOLITEJ POLSKIEJ Poz. 1423
Art. 1. W ustawie z dnia 26 czerwca 1974 r. – Kodeks pracy (Dz. U. z 2025 r. poz. 277 i 807) wprowadza się następujące
zmiany:
1) art. 302 otrzymuje brzmienie:
„Art. 302. Do okresu zatrudnienia wlicza się okres służby w Policji, Urzędzie Ochrony Państwa, Agencji Bez-
pieczeństwa Wewnętrznego.”;
2) po art. 302 dodaje się art. 302^1 w brzmieniu:
„Art. 302^1. § 1. Do okresu zatrudnienia wlicza się okresy działalności, o której mowa w art. 8 ust. 6 ustawy.
§ 2. Do okresu zatrudnienia wlicza się okresy:
1) wykonywania umowy zlecenia,
2) wykonywania umowy agencyjnej.”.
Dziennik Ustaw –2– Poz. 1423
Art. 2. W ustawie z dnia 6 czerwca 1997 r. – Kodeks karny wykonawczy (Dz. U. z 2025 r. poz. 911) w art. 128 § 1 otrzymuje brzmienie:
„§ 1. Nowe brzmienie.”.
Art. 3. Ustawa wchodzi w życie z dniem 1 stycznia 2026 r.`;

const KK_1818 = `USTAWA z dnia 7 listopada 2025 r. o zmianie ustawy – Kodeks karny, ustawy – Kodeks wykroczeń
Art. 1. W ustawie z dnia 6 czerwca 1997 r. – Kodeks karny (Dz. U. z 2025 r. poz. 383) wprowadza się następujące zmiany:
1) w art. 217a dotychczasową treść oznacza się jako § 1 i dodaje się § 2 w brzmieniu:
„§ 2. Jeżeli sprawca czynu określonego w § 1 naraża pokrzywdzonego, podlega karze pozbawienia wolności od 3 miesięcy do lat 5.”;
2) w art. 222:
a) po § 1 dodaje się § 1a w brzmieniu:
„§ 1a. Jeżeli sprawca czynu określonego w § 1 naraża pokrzywdzonego, podlega karze pozbawienia wolności od 3 miesięcy do lat 5.”,
b) § 2 otrzymuje brzmienie:
„§ 2. Jeżeli czyn określony w § 1 lub 1a wywołało niewłaściwe zachowanie się funkcjonariusza, sąd może zastosować nadzwyczajne złagodzenie kary.”;
3) w art. 231b:
a) uchyla się § 2,
b) dodaje się § 3 w brzmieniu:
„§ 3. Ściganie następuje na wniosek pokrzywdzonego.”.
Art. 2. W ustawie z dnia 20 maja 1971 r. – Kodeks wykroczeń (Dz. U. z 2025 r. poz. 734) w art. 51:
1) w § 2 wyrazy „podlega karze aresztu, ograniczenia wolności albo grzywny” zastępuje się wyrazami „podlega karze aresztu, ograniczenia wolności albo grzywny nie niższej niż 1000 złotych”;
2) po § 2 dodaje się § 2a w brzmieniu:
„§ 2a. Tej samej karze podlega, kto dopuszcza się czynu określonego w § 1 w zakładzie leczniczym.”.
Art. 3. Ustawa wchodzi w życie po upływie 14 dni od dnia ogłoszenia.`;

const part = (body: string, title: string) => amendmentPartFor(body, title);

describe("an amendment's own points for the article", () => {
  it("a new wording of the whole article is read verbatim, the line-end hyphen joined", () => {
    const [change] = articleChanges(part(KP_1423, "Ustawa z dnia 26 czerwca 1974 r. - Kodeks pracy"), "302")!;
    expect(change).toMatchObject({ kind: "REPLACED" });
    expect(change!.wording).toBe("Art. 302. Do okresu zatrudnienia wlicza się okres służby w Policji, Urzędzie Ochrony Państwa, Agencji Bezpieczeństwa Wewnętrznego.");
  });

  it("an article named only inside another's new wording is not changed (art. 8 in art. 302^1)", () => {
    const kp = part(KP_1423, "Kodeks pracy");
    expect(amendmentMentionsArticle(kp.toLocaleLowerCase("pl"), "8")).toBe(true);
    expect(articleChanges(kp, "8")).toEqual([]);
    // "po art. 302 dodaje się art. 302^1" adds an article; art. 302's own change is point 1.
    expect(articleChanges(kp, "302")).toHaveLength(1);
  });

  it("units changed, added and repealed, and the act's other parts kept apart", () => {
    const kk = part(KK_1818, "Ustawa z dnia 6 czerwca 1997 r. - Kodeks karny");
    expect(articleChanges(kk, "222")!.map((change) => change.kind)).toEqual(["CHANGED"]);
    expect(articleChanges(kk, "222")![0]!.instruction).toMatch(/^2\) w art\. 222: a\) po § 1 dodaje się § 1a .* b\) § 2 otrzymuje brzmienie: „§ 2\. Jeżeli czyn/u);
    expect(articleChanges(kk, "231b")![0]!.instruction).toContain("uchyla się § 2");
    // Art. 51 of the Kodeks wykroczeń is in the act's other part.
    expect(articleChanges(kk, "51")).toEqual([]);
    const kw = part(KK_1818, "Ustawa z dnia 20 maja 1971 r. - Kodeks wykroczeń");
    const [change] = articleChanges(kw, "51")!;
    expect(change!.substitutions).toEqual([
      { from: "podlega karze aresztu, ograniczenia wolności albo grzywny", to: "podlega karze aresztu, ograniczenia wolności albo grzywny nie niższej niż 1000 złotych" }
    ]);
  });

  it("a repeal of the article, alone or in a range, is a repeal; a unit's repeal is not", () => {
    expect(articleChanges("Art. 1. Uchyla się art. 188–192.", "190a")![0]!.kind).toBe("REPEALED");
    expect(articleChanges("Art. 1. W ustawie z dnia … (Dz. U. poz. 1) wprowadza się następujące zmiany: 1) art. 12 uchyla się; 2) w art. 13 uchyla się § 2.", "12")![0]!.kind).toBe("REPEALED");
    expect(articleChanges("Art. 1. W ustawie z dnia … (Dz. U. poz. 1) wprowadza się następujące zmiany: 1) art. 12 uchyla się; 2) w art. 13 uchyla się § 2.", "13")![0]!.kind).toBe("CHANGED");
    expect(articleChanges("Art. 1. Uchyla się art. 12 ust. 2.", "12")![0]!.kind).toBe("CHANGED");
  });

  it("a wording without its quoted text cannot be read: null (the check fails closed)", () => {
    expect(articleChanges("Art. 1. W art. 190a § 1 wyrazy X zastępuje się wyrazami Y.", "190a")).toBeNull();
    expect(articleChanges("Art. 1. Art. 189, 190a i 191 otrzymują brzmienie:", "190a")).toBeNull();
  });

  it("several articles given one new wording: the article's own part of it", () => {
    const [change] = articleChanges("Art. 1. Art. 189 i 190a otrzymują brzmienie: „Art. 189. Pierwszy. Art. 190a. § 1. Drugi.”.", "190a")!;
    expect(change).toMatchObject({ kind: "REPLACED", wording: "Art. 190a. § 1. Drugi." });
  });

  it("a superscript the PDF lost (647^1 printed 6471) still names the article", () => {
    const kc = "Art. 1. W ustawie z dnia 23 kwietnia 1964 r. – Kodeks cywilny (Dz. U. z 2025 r. poz. 1071) w art. 6471: 1) § 1 otrzymuje brzmienie: „§ 1. Inwestor odpowiada solidarnie.”; Art. 2. Do umów zawartych przed dniem wejścia w życie stosuje się przepisy dotychczasowe.";
    expect(amendmentMentionsArticle(kc.toLocaleLowerCase("pl"), "647^1")).toBe(true);
    expect(articleChanges(kc, "647^1")![0]!.kind).toBe("CHANGED");
    expect(amendmentMentionsArticle(kc.toLocaleLowerCase("pl"), "647")).toBe(false);
  });
});

describe("the wording in force after the amendments", () => {
  it("a new wording replaces the consolidated one; a unique word substitution is applied", () => {
    expect(applyArticleChanges("Art. 302. Stare.", [{ kind: "REPLACED", instruction: "…", wording: "Art. 302. Nowe." }])).toEqual({ text: "Art. 302. Nowe.", applied: true });
    const kw = applyArticleChanges("§ 2. Kto …, podlega karze aresztu, ograniczenia wolności albo grzywny.", [
      { kind: "CHANGED", instruction: "w § 2 wyrazy „a” zastępuje się wyrazami „b”", substitutions: [{ from: "podlega karze aresztu, ograniczenia wolności albo grzywny", to: "podlega karze aresztu, ograniczenia wolności albo grzywny nie niższej niż 1000 złotych" }] }
    ]);
    expect(kw).toEqual({ text: "§ 2. Kto …, podlega karze aresztu, ograniczenia wolności albo grzywny nie niższej niż 1000 złotych.", applied: true });
  });

  it("a unit added or replaced is not applied mechanically: the points go with the text", () => {
    expect(applyArticleChanges("§ 1. A. § 2. B.", [{ kind: "CHANGED", instruction: "w art. 222: b) § 2 otrzymuje brzmienie: „§ 2. C.”" }]).applied).toBe(false);
  });
});

import { OfficialLegalSourceVerifier } from "../src/legal-source-verifier.js";
describe("the verifier reads the article after the amendments in force", () => {
  const tj = (body: string) =>
    new OfficialLegalSourceVerifier(
      async () => new Response(`<html><head><title>Kodeks karny</title></head><body>${body}</body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
      () => "2026-11-17T10:00:00.000Z"
    );
  const request = (claim: string, articleChanges: NonNullable<Parameters<OfficialLegalSourceVerifier["verify"]>[0]["articleChanges"]>) => ({
    claim,
    kind: "statute" as const,
    url: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.html",
    expectedTitle: "Kodeks karny",
    toolCallId: "t1",
    articleChanges
  });
  const art222 = "<h2>Art. 222.</h2><p>§ 1. Kto narusza nietykalność cielesną funkcjonariusza, podlega grzywnie.</p><p>§ 2. Stare brzmienie paragrafu drugiego.</p>";
  const changes = [
    {
      eli: "DU/2025/1818",
      from: "2026-01-02",
      kind: "CHANGED" as const,
      instruction: "2) w art. 222: a) po § 1 dodaje się § 1a w brzmieniu: „§ 1a. Jeżeli sprawca naraża pokrzywdzonego.”, b) § 2 otrzymuje brzmienie: „§ 2. Nowe brzmienie paragrafu drugiego.”, c) uchyla się § 3"
    }
  ];

  it("a unit the amendment added is verified from its text; the amendment's points go with the evidence", async () => {
    const result = await tj(art222).verify(request("art. 222 § 1a KK", changes));
    expect(result.record.status).toBe("VERIFIED");
    expect(result.record.evidence).toContain("Nowe brzmienie paragrafu drugiego");
    expect(result.record.evidence).toContain("Zmiany artykułu wprowadzone po tekście jednolitym");
  });

  it("a unit the amendment repealed is not verified", async () => {
    const result = await tj(`${art222}<p>§ 3. Trzeci.</p>`).verify(request("art. 222 § 3 KK", changes));
    expect(result.record.status).toBe("UNVERIFIED");
    expect(JSON.stringify(result.record)).toContain("uchylona nowelą");
  });

  it("a whole new wording is the evidence, the old one gone", async () => {
    const result = await tj(art222).verify(request("art. 222 KK", [{ eli: "DU/2026/9", kind: "REPLACED", instruction: "art. 222 otrzymuje brzmienie: „Art. 222. Całkiem nowy.”", wording: "Art. 222. Całkiem nowy." }]));
    expect(result.record).toMatchObject({ status: "VERIFIED", evidence: "Art. 222. Całkiem nowy." });
  });
});
