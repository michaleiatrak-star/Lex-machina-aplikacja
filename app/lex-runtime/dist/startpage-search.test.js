import { afterEach, describe, expect, it } from "vitest";
import { clearLawSourceSession, isChallengePage, lawSourceSessionHeaders, setLawSourceSession } from "./eli/law-source-sessions.js";
import { PublicWebSearch, parseStartpageHtml } from "./web-search.js";
import { effectiveSearchOrder } from "./web-search-settings.js";
const HOST = "www.startpage.com";
// Two markups seen on Startpage (2024-2026), its own link and an ad.
const RESULTS = `
<div class="result css-1"><a class="result-title result-link css-2" href="https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19820160124" target="_blank"><h2 class="wgl-title css-3">Prawo o <b>adwokaturze</b></h2></a>
<p class="description css-4">Ustawa z dnia 26 maja 1982 r. &amp; odpowiedzialność dyscyplinarna</p></div>
<div class="w-gl__result"><a class="w-gl__result-title result-link" href="https://www.sn.pl/sites/orzecznictwo/Orzeczenia3/SDI%208-12.pdf"><h3>Postanowienie SN SDI 8/12</h3></a>
<p class="w-gl__description">Sąd Najwyższy w sprawie dyscyplinarnej adwokata</p></div>
<a class="result-link" href="https://www.startpage.com/do/settings">Ustawienia</a>
<a class="result-title result-link" href="https://www.startpage.com/do/dsearch?ad=1"><h2>Reklama</h2></a>`;
const ANUBIS = `<!doctype html><html><head><script src="/.within.website/x/cmd/anubis/static/js/main.mjs"></script></head><body>Verifying your request... Loading...</body></html>`;
const SUSPENDED = `<html><body><h1>Dostęp tymczasowo zawieszony</h1>Aby zapobiec możliwemu nadużyciu naszego serwisu, Twoja możliwość połączenia się ze Startpage została tymczasowo zawieszona.</body></html>`;
function settings(startpageSession) {
    return () => ({ searxngUrl: "", order: [], lastTest: null, firecrawlConfigured: false, startpageSession, startpageSessionKeep: false, startpageSessionSaved: false });
}
const DDG = '<div class="result"><a class="result__a" href="https://isap.sejm.gov.pl/x">Kodeks cywilny</a><a class="result__snippet">art. 415</a></div>';
afterEach(() => clearLawSourceSession(HOST));
describe("Startpage na sesji użytkownika", () => {
    it("czyta wyniki obu wersji strony; pomija linki i reklamy Startpage", () => {
        const hits = parseStartpageHtml(RESULTS, 10);
        expect(hits).toEqual([
            { title: "Prawo o adwokaturze", url: "https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19820160124", snippet: "Ustawa z dnia 26 maja 1982 r. & odpowiedzialność dyscyplinarna" },
            { title: "Postanowienie SN SDI 8/12", url: "https://www.sn.pl/sites/orzecznictwo/Orzeczenia3/SDI%208-12.pdf", snippet: "Sąd Najwyższy w sprawie dyscyplinarnej adwokata" }
        ]);
        expect(parseStartpageHtml(RESULTS, 1)).toHaveLength(1);
    });
    it("strona Anubisa i strona zawieszenia dostępu to weryfikacja, nie brak wyników", () => {
        expect(isChallengePage(200, ANUBIS)).toBe(true);
        expect(isChallengePage(200, SUSPENDED)).toBe(true);
        expect(isChallengePage(200, RESULTS)).toBe(false);
    });
    it("bez sesji: okno Startpage do potwierdzenia, wyniki daje następna wyszukiwarka", async () => {
        const asked = [];
        const fetchImpl = (async (input) => {
            asked.push(new URL(String(input)).host);
            return new Response(DDG, { headers: { "content-type": "text/html" } });
        });
        const result = await new PublicWebSearch({}, fetchImpl, undefined, 0, settings(true)).search("odpowiedzialność dyscyplinarna adwokata", 3);
        expect(result.provider).toBe("duckduckgo");
        expect(result.verificationRequired).toBe(`LAW_SOURCE_VERIFICATION_REQUIRED:${HOST}`);
        expect(asked).toEqual(["html.duckduckgo.com"]);
    });
    it("z sesją: zapytanie z ciasteczkami i User-Agentem okna; ponowna weryfikacja usuwa sesję", async () => {
        setLawSourceSession(HOST, "within.website-x-cmd-anubis-auth=abc; preferences=x", "Mozilla/5.0 Test");
        const seen = [];
        let page = RESULTS;
        const fetchImpl = (async (input, init) => {
            const url = new URL(String(input));
            if (url.host === HOST) {
                seen.push(init?.headers);
                expect(url.pathname).toBe("/sp/search");
                expect(url.searchParams.get("query")).toBe("SDI 8/12");
                return new Response(page, { headers: { "content-type": "text/html" } });
            }
            return new Response(DDG, { headers: { "content-type": "text/html" } });
        });
        const search = new PublicWebSearch({}, fetchImpl, undefined, 0, settings(true));
        const first = await search.search("SDI 8/12", 5);
        expect(first.provider).toBe("startpage");
        expect(first.hits).toHaveLength(2);
        expect(seen[0]).toMatchObject({ cookie: "within.website-x-cmd-anubis-auth=abc; preferences=x", "user-agent": "Mozilla/5.0 Test" });
        page = ANUBIS;
        const second = await search.search("SDI 8/12", 5);
        expect(second.provider).toBe("duckduckgo");
        expect(second.verificationRequired).toBe(`LAW_SOURCE_VERIFICATION_REQUIRED:${HOST}`);
        expect(lawSourceSessionHeaders(HOST)).toBeNull();
    });
    it("kolejność: wynik testu; bez testu Startpage za SearXNG; wyłączony Startpage nie jest pytany", () => {
        expect(effectiveSearchOrder(settings(true)())[0]).toBe("startpage");
        expect(effectiveSearchOrder({ ...settings(true)(), searxngUrl: "http://127.0.0.1:8888" }).slice(0, 3)).toEqual(["searxng", "startpage", "duckduckgo"]);
        expect(effectiveSearchOrder({ ...settings(true)(), searxngUrl: "http://127.0.0.1:8888", order: ["startpage", "searxng"] }).slice(0, 2)).toEqual(["startpage", "searxng"]);
        expect(effectiveSearchOrder(settings(false)())).not.toContain("startpage");
    });
});
