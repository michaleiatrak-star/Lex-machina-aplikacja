import { describe, expect, it } from "vitest";
import { CaseLawPreviewService, documentText, markPassage } from "../src/case-law-preview.js";

const KIO_HTML = `<html><head><title>KIO</title><script>x()</script></head><body>
<h1>WYROK</h1><p>z dnia 3 marca 2025 r.</p><p>Sygn. akt: KIO 512/25</p>
<p>Krajowa Izba Odwoławcza w składzie: Przewodniczący: Jan Nowak</p>
<p>Izba zważyła, co następuje: zamawiający nie może żądać od wykonawcy dokumentów, które są w&nbsp;jego posiadaniu. Odwołanie zasługiwało na uwzględnienie.</p>
<p>Uzasadnienie dalsze, kontekst rozstrzygnięcia.</p></body></html>`;

function fetcher(routes: Record<string, { body: string; type: string }>) {
  const calls: string[] = [];
  const fetch = async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(route.body, { status: 200, headers: { "content-type": route.type } });
  };
  return { fetch, calls };
}

describe("full text of a decision with the cited passage marked", () => {
  it("keeps paragraphs and drops markup", () => {
    const text = documentText(KIO_HTML);
    expect(text).toContain("Sygn. akt: KIO 512/25\n\nKrajowa Izba");
    expect(text).not.toContain("x()");
    expect(text).toContain("w jego posiadaniu");
  });

  it("marks the exact passage regardless of case, quotes, dots and spacing; else its beginning; else the signature", () => {
    const text = documentText(KIO_HTML);
    const exact = markPassage(text, "Zamawiający nie może żądać od wykonawcy dokumentów,  które są w jego posiadaniu", "KIO 512/25");
    expect(exact.match).toBe("EXACT");
    expect(text.slice(exact.start, exact.end)).toBe("zamawiający nie może żądać od wykonawcy dokumentów, które są w jego posiadaniu");
    const partial = markPassage(
      text,
      "zamawiający nie może żądać od wykonawcy dokumentów, które są w jego posiadaniu, a także dokumentów dostępnych w bazach publicznych oraz rejestrach, co przesądza o zasadności każdego odwołania",
      "KIO 512/25"
    );
    expect(partial.match).toBe("PARTIAL");
    const signature = markPassage(text, "Izba uznała, że termin jest zawity", "KIO 512/25");
    expect(signature.match).toBe("SIGNATURE");
    expect(text.slice(signature.start, signature.end)).toBe("KIO 512/25");
  });

  it("fetches the official page (KIO) and returns the whole text with the anchor", async () => {
    const url = "https://orzeczenia.uzp.gov.pl/Home/Details/12345";
    const { fetch } = fetcher({ [url]: { body: KIO_HTML, type: "text/html; charset=utf-8" } });
    const preview = await new CaseLawPreviewService(fetch as never, () => Date.parse("2026-10-04T12:00:00Z")).preview({
      sourceUrl: url,
      passage: "zamawiający nie może żądać od wykonawcy dokumentów",
      signature: "KIO 512/25",
      attributed: "Zamawiający nie może żądać dokumentów, które posiada (KIO 512/25)."
    });
    expect(preview.match).toBe("EXACT");
    expect(preview.html).toContain('<mark id="lex-case-quote">zamawiający nie może żądać od wykonawcy dokumentów</mark>');
    expect(preview.html).toContain("Uzasadnienie dalsze, kontekst rozstrzygnięcia.");
    expect(preview.html).toContain("Odpowiedź przypisuje temu rozstrzygnięciu");
    expect(preview.html).not.toContain("<script");
  });

  it("reads SAOS judgments from the SAOS API and refuses other hosts", async () => {
    const { fetch, calls } = fetcher({
      "https://www.saos.org.pl/api/judgments/777": {
        body: JSON.stringify({ data: { textContent: "<p>Sygn. akt I ACa 1/24</p><p>Sąd Apelacyjny uznał, że roszczenie jest przedawnione w całości.</p>" } }),
        type: "application/json"
      }
    });
    const service = new CaseLawPreviewService(fetch as never);
    const preview = await service.preview({ sourceUrl: "https://www.saos.org.pl/judgments/777", passage: "roszczenie jest przedawnione" });
    expect(preview.match).toBe("EXACT");
    expect(calls).toEqual(["https://www.saos.org.pl/api/judgments/777"]);
    await expect(service.preview({ sourceUrl: "https://example.com/wyrok" })).rejects.toThrow("SOURCE_PREVIEW_HOST_NOT_ALLOWED");
  });
});
