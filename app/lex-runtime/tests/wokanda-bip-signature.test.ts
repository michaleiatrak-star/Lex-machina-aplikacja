import { describe, expect, it } from "vitest";
import { checkWokanda, detectSearchSystem, isGuardPage, type FetchText, type WokandaCourt } from "../src/courts/wokanda.js";

// A BIP e-wokanda: GET form with a "signature" field, a captcha on the site's other search forms,
// each hearing as a table of label rows (report 2026-11-19, Sąd Okręgowy w Warszawie).
const page = (rows: string) => `<html><body>
<form class="prompts" action="/artykuly/szukaj" method="get"><input name="keyword"/><input type="hidden" name="recaptcha_response"/><div id="mosparo-header-search"></div></form>
<form name="searchForm" action="https://bip.example.so.gov.pl/e-wokanda/szukaj" method="get">
<label for="s">Sygnatura</label><input id="s" type="text" name="signature" value=""/>
<input type="hidden" name="recaptcha_response"/><div id="mosparo-advanced-search"></div></form>
${rows}</body></html>`;
const hearing = `<table><caption>Rozprawa</caption><tbody>
<tr><th scope="row">Wydział</th><td>XII Wydział Karny</td></tr>
<tr><th scope="row">Miejsce rozprawy</th><td> J204 </td></tr>
<tr><th scope="row">Sygnatura</th><td>XII 1Kp 3716/2025</td></tr>
<tr><th scope="row">Data</th><td>18.12.2026 15:30</td></tr>
<tr><th scope="row">Przewodniczący</th><td>Sędzia A</td></tr></tbody></table>`;

const court: WokandaCourt = { nazwa: "Sąd Okręgowy w Warszawie", domena: "warszawa.so.gov.pl", status: "PORTAL", system: "GET_FORM", url: "https://bip.example.so.gov.pl/e-wokanda/szukaj", pole: "signature" };

describe("BIP e-wokanda searched by a 'signature' field", () => {
  it("is a readable search, not a guard page, despite the captcha of other forms", () => {
    const html = page("");
    expect(detectSearchSystem("https://bip.example.so.gov.pl/e-wokanda/1339", html)).toEqual({ system: "GET_FORM", url: "https://bip.example.so.gov.pl/e-wokanda/szukaj", pole: "signature" });
    expect(isGuardPage("https://bip.example.so.gov.pl/e-wokanda/1339", html)).toBe(false);
    expect(isGuardPage("https://x.sr.gov.pl/wokanda", "<p>Trwa weryfikacja przeglądarki...</p>")).toBe(true);
  });

  it("asks with the court's field and reads the label rows (room from 'Miejsce rozprawy')", async () => {
    const asked: string[] = [];
    const fetchText: FetchText = async (url) => {
      asked.push(url);
      return { status: 200, url, text: page(hearing) };
    };
    const result = await checkWokanda(court.nazwa, "XII 1Kp 3716/2025", fetchText, () => new Date("2026-11-19T00:00:00Z"), () => court);
    expect(asked[0]).toBe("https://bip.example.so.gov.pl/e-wokanda/szukaj?signature=XII+1Kp+3716%2F2025");
    expect(result.state).toBe("FOUND");
    expect(result.state === "FOUND" && result.hearings[0]).toMatchObject({ data: "2026-12-18", godzina: "15:30", sala: "J204", wydzial: "XII Wydział Karny" });
  });
});
