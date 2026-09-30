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
