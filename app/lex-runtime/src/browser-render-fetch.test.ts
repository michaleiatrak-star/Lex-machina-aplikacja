import { afterEach, describe, expect, it } from "vitest";
import { SafeAuxiliarySourceFetcher, type AuxiliaryDnsResolver, type AuxiliaryTransport } from "./auxiliary-source-fetcher.js";
import { configurePageRenderer, type PageRenderer } from "./browser-render.js";

const resolver: AuxiliaryDnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];
const html = (body: string): AuxiliaryTransport => async () => ({ statusCode: 200, contentType: "text/html; charset=utf-8", body: new TextEncoder().encode(body) });
const LONG = "Interpretacja indywidualna 0114-KDIP1-2.4012.123.2026 w sprawie VAT od najmu krótkoterminowego. ".repeat(10);

function renderer(page: { text: string; finalUrl?: string } | null): PageRenderer & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    render: async (url) => (asked.push(url), page ? { text: page.text, title: "Eureka", finalUrl: page.finalUrl ?? url } : null)
  };
}

afterEach(() => configurePageRenderer(null));

describe("czytanie stron przez przeglądarkę w Dockerze", () => {
  it("strona aplikacji JavaScript (sama rama HTML): tekst z przeglądarki", async () => {
    const browser = renderer({ text: LONG });
    configurePageRenderer(browser);
    const result = await new SafeAuxiliarySourceFetcher(resolver, html("<html><body><div id=app></div><script src=a.js></script></body></html>")).fetch("https://eureka.mf.gov.pl/informacje/podglad/123");
    expect(browser.asked).toEqual(["https://eureka.mf.gov.pl/informacje/podglad/123"]);
    expect(result.text).toContain("0114-KDIP1-2.4012.123.2026");
  });

  it("zwykła strona z treścią: bez przeglądarki; bez przeglądarki w Dockerze: jak dotąd", async () => {
    const browser = renderer({ text: LONG });
    configurePageRenderer(browser);
    await new SafeAuxiliarySourceFetcher(resolver, html(`<html><body><p>${LONG}</p></body></html>`)).fetch("https://www.sn.pl/x");
    expect(browser.asked).toEqual([]);
    configurePageRenderer(null);
    const plain = await new SafeAuxiliarySourceFetcher(resolver, html("<html><body><p>Krótka strona.</p></body></html>")).fetch("https://www.sn.pl/y");
    expect(plain.text).toContain("Krótka strona.");
  });

  it("bot check: przeglądarka czyta stronę; captcha w przeglądarce to nadal weryfikacja dla użytkownika", async () => {
    const challenge: AuxiliaryTransport = async () => ({ statusCode: 403, contentType: "text/html", body: new TextEncoder().encode("blocked") });
    configurePageRenderer(renderer({ text: LONG }));
    const read = await new SafeAuxiliarySourceFetcher(resolver, challenge).fetch("https://orzeczenia.ms.gov.pl/content/x");
    expect(read.text).toContain("Interpretacja indywidualna");
    configurePageRenderer(renderer({ text: `Nasze systemy wykryły nietypowy ruch pochodzący z Twojej sieci. ${LONG}` }));
    await expect(new SafeAuxiliarySourceFetcher(resolver, challenge).fetch("https://orzeczenia.ms.gov.pl/content/x")).rejects.toMatchObject({ code: "AUX_SOURCE_BROWSER_CHECK" });
  });

  it("przekierowanie przeglądarki na adres prywatny: wynik odrzucony", async () => {
    configurePageRenderer(renderer({ text: LONG, finalUrl: "https://192.168.1.1/admin" }));
    const result = await new SafeAuxiliarySourceFetcher(resolver, html("<html><body><div id=app></div></body></html>")).fetch("https://eureka.mf.gov.pl/a").catch((error: unknown) => error);
    expect(JSON.stringify(result)).not.toContain("0114-KDIP1");
  });
});
