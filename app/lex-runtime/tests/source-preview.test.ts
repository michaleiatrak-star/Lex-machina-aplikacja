import { describe, expect, it } from "vitest";
import { allowedPreviewUrl, fetchSourcePreview, inertHtml } from "../src/source-preview.js";

function page(body: BodyInit, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

describe("podgląd strony źródła (Wyszukiwanie)", () => {
  it("tylko HTTPS i oficjalne domeny źródeł", () => {
    expect(allowedPreviewUrl("https://orzeczenia.nsa.gov.pl/doc/ABC").hostname).toBe("orzeczenia.nsa.gov.pl");
    for (const bad of [
      "http://orzeczenia.nsa.gov.pl/doc/ABC",
      "https://evil.example/doc",
      "https://orzeczenia.nsa.gov.pl.evil.example/",
      "https://user:pass@orzeczenia.nsa.gov.pl/",
      "https://127.0.0.1/",
      "nie-url"
    ]) {
      expect(() => allowedPreviewUrl(bad)).toThrow(/SOURCE_PREVIEW_(HOST_NOT_ALLOWED|URL_INVALID)/);
    }
  });

  it("usuwa skrypty, ramki i atrybuty zdarzeń; dodaje <base>", () => {
    const html = inertHtml(
      '<html><head><title>T</title><script>alert(1)</script></head><body onload="x()"><a href="javascript:evil()">a</a><iframe src="https://x"></iframe><p>Wyrok</p></body></html>',
      "https://orzeczenia.nsa.gov.pl/doc/ABC"
    );
    expect(html).not.toMatch(/<script|onload|javascript:|<iframe/i);
    expect(html).toContain('<base href="https://orzeczenia.nsa.gov.pl/doc/ABC">');
    expect(html).toContain("<p>Wyrok</p>");
  });

  it("przekierowanie poza listę domen jest odrzucane", async () => {
    await expect(
      fetchSourcePreview("https://orzeczenia.nsa.gov.pl/doc/ABC", async () =>
        page("", { location: "https://evil.example/" }, 302)
      )
    ).rejects.toThrow("SOURCE_PREVIEW_HOST_NOT_ALLOWED");
  });

  it("przekierowanie w obrębie listy i dekodowanie windows-1250", async () => {
    const calls: string[] = [];
    const preview = await fetchSourcePreview("https://orzeczenia.nsa.gov.pl/doc/ABC", async (input) => {
      calls.push(input);
      if (calls.length === 1) return page("", { location: "/doc/DEF" }, 301);
      // "Sąd" w windows-1250: ą = 0xB9.
      return page(new Uint8Array([0x3c, 0x70, 0x3e, 0x53, 0xb9, 0x64, 0x3c, 0x2f, 0x70, 0x3e]), {
        "content-type": "text/html; charset=windows-1250"
      });
    });
    expect(calls[1]).toBe("https://orzeczenia.nsa.gov.pl/doc/DEF");
    expect(preview).toMatchObject({ kind: "html", url: "https://orzeczenia.nsa.gov.pl/doc/DEF" });
    expect(preview.kind === "html" && preview.html).toContain("<p>Sąd</p>");
  });

  it("PDF jest zwracany jako plik do przeglądarki PDF", async () => {
    const preview = await fetchSourcePreview("https://isap.sejm.gov.pl/x.pdf", async () =>
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), { headers: { "content-type": "application/pdf" } })
    );
    expect(preview.kind).toBe("pdf");
  });
});

describe("podgląd EUREKA i stron wymagających JavaScript", () => {
  it("EUREKA: dokument z publicznego API zamiast pustej powłoki aplikacji", async () => {
    const calls: string[] = [];
    const preview = await fetchSourcePreview("https://eureka.mf.gov.pl/informacje/podglad/711644", async (input) => {
      calls.push(input);
      return new Response(
        JSON.stringify({
          dokument: {
            fields: [
              { key: "ID_INFORMACJI", value: "711644" },
              { key: "TEZA", value: "Zwolnienie z akcyzy alkoholu etylowego" },
              { key: "SYG", value: "0111-KDIB3-3.4013.256.2026.2.AM" },
              { key: "DT_WYD", value: "2026-09-23T01:00:00.000Z" },
              { key: "TRESC_INTERESARIUSZ", value: '<p onclick="x()">Treść interpretacji</p><script>evil()</script>' }
            ]
          }
        }),
        { headers: { "content-type": "application/json" } }
      );
    });
    expect(calls).toEqual(["https://eureka.mf.gov.pl/api/public/v1/informacje/711644"]);
    expect(preview.kind).toBe("html");
    const html = preview.kind === "html" ? preview.html : "";
    expect(html).toContain("Zwolnienie z akcyzy alkoholu etylowego");
    expect(html).toContain("0111-KDIB3-3.4013.256.2026.2.AM");
    expect(html).toContain("Treść interpretacji");
    expect(html).not.toMatch(/<script|onclick/i);
  });

  it("pusta powłoka aplikacji JavaScript daje komunikat zamiast pustej ramki", async () => {
    const preview = await fetchSourcePreview("https://orzeczenia.uodo.gov.pl/decision/x", async () =>
      page('<html><head><script src="app.js"></script></head><body><div id="root"></div></body></html>')
    );
    expect(preview.kind === "html" && preview.html).toContain("wyłącznie przez JavaScript");
  });

  it("ISAP (ochrona przed botami) → tekst aktu z Sejm ELI: HTML albo PDF", async () => {
    const requested: string[] = [];
    const fetcher = async (url: string) => {
      requested.push(url);
      if (url === "https://api.sejm.gov.pl/eli/acts/DU/2025/383") return Response.json({ textHTML: false, textPDF: true });
      if (url === "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf")
        return new Response(Buffer.from("%PDF-1.7 x"), { headers: { "content-type": "application/pdf" } });
      if (url === "https://api.sejm.gov.pl/eli/acts/DU/2024/1000") return Response.json({ textHTML: true });
      if (url === "https://api.sejm.gov.pl/eli/acts/DU/2024/1000/text.html") return page("<p>Art. 1. Tekst.</p>");
      return page("Pardon Our Interruption", {}, 200);
    };
    const pdf = await fetchSourcePreview("https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000383", fetcher);
    expect(pdf.kind).toBe("pdf");
    expect(requested.some((url) => url.includes("isap.sejm.gov.pl"))).toBe(false);
    const html = await fetchSourcePreview("https://api.sejm.gov.pl/eli/acts/DU/2024/1000", fetcher);
    expect(html.kind === "html" && html.html).toContain("Art. 1. Tekst.");
  });

  it("KRS: cały odpis aktualny z API jako strona, PESEL w treści wolnej zamaskowany", async () => {
    const fetcher = async (url: string) => {
      expect(url).toBe("https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000028860?rejestr=P&format=json");
      return Response.json({
        odpis: {
          naglowekA: { stanZDnia: "17.09.2026", dataCzasOdpisu: "01.10.2026 18:16:37" },
          dane: {
            dzial1: { danePodmiotu: { nazwa: "ORLEN SPÓŁKA AKCYJNA", identyfikatory: { nip: "7740001454" } } },
            dzial2: { prokurenci: [{ nazwisko: "K*****", rodzajProkury: "ŁĄCZNA Z X (PESEL:82072702612)" }] }
          }
        }
      });
    };
    const preview = await fetchSourcePreview(
      "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000028860?rejestr=P&format=json",
      fetcher
    );
    expect(preview.kind).toBe("html");
    const html = preview.kind === "html" ? preview.html : "";
    expect(html).toContain("ORLEN SPÓŁKA AKCYJNA");
    expect(html).toContain("Dział 2");
    expect(html).toContain("rodzaj prokury");
    expect(html).toContain("stan z dnia 17.09.2026");
    expect(html).not.toMatch(/\d{11}/);
  });

  it("NBP: kurs średni (A) oraz kupna i sprzedaży (C) z tego dnia", async () => {
    const fetcher = async (url: string) =>
      url.includes("/rates/a/")
        ? Response.json({ currency: "euro", code: "EUR", rates: [{ no: "191/A/NBP/2026", effectiveDate: "2026-10-01", mid: 4.377 }] })
        : Response.json({ code: "EUR", rates: [{ no: "191/C/NBP/2026", effectiveDate: "2026-10-01", bid: 4.3202, ask: 4.4074 }] });
    const preview = await fetchSourcePreview(
      "https://api.nbp.pl/api/exchangerates/rates/a/eur/2026-10-01/?format=json",
      fetcher
    );
    const html = preview.kind === "html" ? preview.html : "";
    expect(html).toContain("4.377");
    expect(html).toContain("kurs kupna");
    expect(html).toContain("4.4074");
  });

  it("EUR-Lex (wyzwanie AWS WAF) → polski tekst z Cellar po numerze CELEX", async () => {
    const requested: string[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      requested.push(url);
      if (url === "https://publications.europa.eu/resource/celex/32016R0679") {
        expect((init?.headers as Record<string, string>)["Accept-Language"]).toBe("pol");
        return new Response("", {
          status: 303,
          headers: { location: "http://publications.europa.eu/resource/cellar/3e485e15.0018.03/DOC_1" }
        });
      }
      if (url === "https://publications.europa.eu/resource/cellar/3e485e15.0018.03/DOC_1") {
        return page('<?xml version="1.0"?><html><head><title>RODO</title></head><body><p>Artykuł 1</p></body></html>', {
          "content-type": "application/xhtml+xml;charset=UTF-8"
        });
      }
      return page("<script>awsWaf</script>", {}, 202);
    };
    const preview = await fetchSourcePreview(
      "https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:32016R0679",
      fetcher
    );
    expect(preview.kind === "html" && preview.html).toContain("Artykuł 1");
    expect(requested.some((url) => url.startsWith("https://eur-lex"))).toBe(false);
    await expect(
      fetchSourcePreview("https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:32016R0679", async () =>
        new Response("", { status: 303, headers: { location: "https://evil.example/x" } })
      )
    ).rejects.toThrow("SOURCE_PREVIEW_HOST_NOT_ALLOWED");
  });
});
