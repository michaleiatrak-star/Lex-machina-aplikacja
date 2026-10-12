import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoreLawIndex, checkArticleExtraction, htmlToText, splitArticles } from "../src/core-law-index.js";
import { CoreLawToolRuntime } from "../src/core-law-tool-runtime.js";
import { normalizeArticleId, pdfArticleAnchors } from "../src/source-anchor.js";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function corpus(rows: string[]): string {
  const root = tempDir("lex-core-corpus-");
  fs.mkdirSync(path.join(root, "prawo-polskie-v2"));
  fs.writeFileSync(path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"), rows.join("\n") + "\n");
  return root;
}

const noPdf = { extract: async () => ({ text: "", pages: 0, truncated: false }) };

// Obwieszczenie t.j. jak DU/2026/1245: w pkt 2 przytoczony przepis ustawy zmieniającej
// z numerem, który ma też artykuł samego kodeksu.
const KP_TJ_HTML =
  "<p>1. Na podstawie art. 16 ust. 1 ustawy ogłasza się w załączniku do niniejszego obwieszczenia jednolity tekst ustawy.</p>" +
  "<p>2. Podany w załączniku tekst jednolity nie obejmuje art. 6 ustawy zmieniającej, który stanowi:</p>" +
  "<p>Art. 6. Uprawnienia pracownicze wynikające z wliczenia okresów przysługują od dnia nabycia.</p>" +
  "<p>Załącznik do obwieszczenia Marszałka Sejmu Rzeczypospolitej Polskiej</p>" +
  "<p>USTAWA z dnia 26 czerwca 1974 r. Kodeks pracy</p>" +
  "<p>Art. 1. Kodeks pracy określa prawa i obowiązki pracowników i pracodawców.</p>" +
  "<p>Art. 6. Prawo kodeksu w brzmieniu samego aktu.</p>" +
  "<p>Art. 11. Nawiązanie stosunku pracy wymaga zgodnego oświadczenia woli.</p>" +
  "<p>Art. 11<sup>1</sup>. Pracodawca jest obowiązany szanować godność pracownika.</p>";

describe("artykuły z indeksem górnym i obwieszczenia t.j.", () => {
  it("dzieli „Art. 11[1].” z PDF na osobny artykuł 11¹, także z literą po indeksie", () => {
    const text = [
      "Art. 11. Nawiązanie stosunku pracy.",
      "Art. 11[1]. Pracodawca szanuje godność.",
      "Art. 11 [2] . Równe prawa pracowników.",
      "Art. 151[9a]. Praca w niedzielę.",
      "Art. 12. (uchylony)"
    ].join("\n");
    const { order, articles } = splitArticles(text);
    expect(order).toEqual(["11", "11¹", "11²", "151⁹a", "12"]);
    expect(articles["11"]).not.toContain("godność");
    expect(articles["11¹"]).toContain("godność");
    expect(pdfArticleAnchors(["Art. 11. A", "Art. 11[1]. B"])).toEqual({ "11": "page=1", "11¹": "page=2" });
  });

  it("zakres „Art. 133–142. (pominięte)” to wpis każdego numeru, nie luka ani część art. 132", () => {
    const text = ["Art. 132. Orzekanie w sprawach.", "Art. 133–142. (pominięte)", "Art. 143. Dalej."].join("\n");
    const { order, articles } = splitArticles(text);
    expect(order).toEqual(["132", ...Array.from({ length: 10 }, (_, i) => String(133 + i)), "143"]);
    expect(articles["132"]).not.toContain("pominięte");
    expect(articles["137"]).toBe("Art. 133–142. (pominięte)");
    expect(checkArticleExtraction(text, order)).toMatchObject({ gaps: [], suspectArticles: [] });
  });

  it("indeks górny jako cyfry oddzielone spacją („Art. 6 1 .”) i litera za indeksem w HTML", () => {
    expect(splitArticles("Art. 6. Definicje.\nArt. 6 1 . Rozpowszechnianie.\nArt. 6 2 . Dalej.").order).toEqual(["6", "6¹", "6²"]);
    expect(splitArticles(htmlToText("<p>Art. 300<sup>71</sup>a. Rada nadzorcza.</p><p>Art. 301. Dalej.</p>")).order).toEqual(["300⁷¹a", "301"]);
  });

  it("luka po rozdziale uchylonym w całości nie oznacza artykułu jako podejrzanego", () => {
    const text = "Art. 103. Spory.\nRozdział 13\n(uchylony)\nRozdział 14\nOdpowiedzialność karna\nArt. 115. Kto przywłaszcza.";
    expect(checkArticleExtraction(text, splitArticles(text).order)).toMatchObject({ gaps: [], suspectArticles: [] });
  });

  it("<sup> w HTML nie skleja numeru (art. 11¹, nie art. 111)", () => {
    const { order } = splitArticles(htmlToText("<p>Art. 11<sup>1</sup>. Tekst.</p><p>Art. 12. Dalej.</p>"));
    expect(order).toEqual(["11¹", "12"]);
  });

  it("numer z cytatu w każdym zapisie daje ten sam klucz", () => {
    for (const raw of ["11¹", "art. 11[1]", "11 [1]", "11^1", "Art. 11¹"]) expect(normalizeArticleId(raw)).toBe("11¹");
    expect(normalizeArticleId("151[9a]")).toBe("151⁹a");
    expect(normalizeArticleId("17A")).toBe("17a");
  });

  it("artykuły t.j. tylko z załącznika obwieszczenia; art. 11¹ do odczytu", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/references")) return Response.json({});
      if (url.endsWith("/DU/2026/1245")) {
        return Response.json({ title: "Obwieszczenie — Kodeks pracy", type: "Obwieszczenie", status: "obowiązujący", textHTML: true });
      }
      if (url.endsWith("/DU/2026/1245/text.html")) return new Response(KP_TJ_HTML);
      return Response.json({ title: "Inny akt", textHTML: false, textPDF: false });
    };
    const index = new CoreLawIndex(tempDir("lex-core-store-"), fetcher as never, noPdf as never, () => Date.now(), 0);
    index.load(corpus(["| Kodeks pracy | Dz.U. 2026 poz. 1245 t.j. | dr-04 | ✅ |"]));
    await index.refresh({ force: true });

    const record = index.currentRecord("DU/2026/1245")!;
    expect(record.articleOrder).toEqual(["1", "6", "11", "11¹"]);
    expect(record.articles["6"]).toContain("brzmieniu samego aktu");

    const [read] = await new CoreLawToolRuntime(index).runTools([
      { id: "1", name: "read_core_law_article", input: { act: "DU/2026/1245", article: "11[1]" } }
    ]);
    expect(JSON.parse(read!.content).text).toContain("szanować godność");
  });

  it("artykuł drukowany w HTML t.j. dwa razy: brzmienie obowiązujące wg odnośników (u.ś.u.d.e. art. 3b)", async () => {
    const gloss = (n: string, text: string) =>
      `<A class="gloss-link tooltip" href="#gloss-0:${n}:"><sup>${n})</sup><span class="tooltip-text"><span class="pro-gloss-inner">${text}</span></span></A>`;
    const html =
      `<p>Art. 1. Ustawa określa zasady.</p>` +
      `<p>Art. 3b${gloss("6", "Obowiązuje do wejścia w życie zmiany, o której mowa w odnośniku 7.")}. Stare brzmienie przepisu.</p>` +
      `<p>Art. 3b${gloss("7", "W brzmieniu ustalonym przez ustawę, która wejdzie w życie z dniem 10 listopada 2024 r.")}. 1. Nowe brzmienie przepisu.</p>` +
      `<p>Art. 4. Dalej.</p>`;
    const fetcher = async (url: string) => {
      if (url.endsWith("/references")) return Response.json({});
      if (url.endsWith("/DU/2024/1513")) return Response.json({ title: "Obwieszczenie — u.ś.u.d.e.", type: "Obwieszczenie", status: "obowiązujący", textHTML: true });
      if (url.endsWith("/DU/2024/1513/text.html")) return new Response(html);
      return Response.json({ title: "Inny akt", textHTML: false, textPDF: false });
    };
    const index = new CoreLawIndex(tempDir("lex-core-store-"), fetcher as never, noPdf as never, () => Date.parse("2026-10-12T10:00:00Z"), 0);
    index.load(corpus(["| u.ś.u.d.e. | Dz.U. 2024 poz. 1513 t.j. | dr-11 | ✅ |"]));
    await index.refresh({ force: true });
    const record = index.currentRecord("DU/2024/1513")!;
    expect(record.articleOrder).toEqual(["1", "3b", "4"]);
    expect(record.articles["3b"]).toContain("Nowe brzmienie");
    expect(record.articles["3b"]).not.toContain("Stare brzmienie");
    expect(record.footnotes?.["7"]).toContain("10 listopada 2024");
  });

  it("nowelizacja pobrana przy sprawdzaniu t.j. nie zostaje na liście jako niepobrana", async () => {
    const fetcher = async (url: string) => {
      if (url.endsWith("/DU/2023/501/references")) {
        return Response.json({
          "Nowelizacje po tekście jednolitym": [
            { act: { ELI: "DU/2026/184", title: "Ustawa o zmianie ustawy o rzeczach znalezionych", promulgation: "2026-02-18" } }
          ]
        });
      }
      if (url.endsWith("/references")) return Response.json({});
      if (url.endsWith("/DU/2023/501")) {
        return Response.json({ title: "Obwieszczenie — rzeczy znalezione", status: "obowiązujący", textHTML: true });
      }
      if (url.endsWith("/DU/2023/501/text.html")) return new Response("<p>Art. 1. Ustawa określa zasady.</p>");
      if (url.endsWith("/DU/2026/184")) {
        return Response.json({ title: "Ustawa o zmianie ustawy o rzeczach znalezionych", status: "obowiązujący", textHTML: true });
      }
      if (url.endsWith("/DU/2026/184/text.html")) return new Response("<p>Art. 1. W ustawie wprowadza się zmiany.</p>");
      return Response.json({ title: "Inny akt", textHTML: false, textPDF: false });
    };
    const index = new CoreLawIndex(tempDir("lex-core-store-"), fetcher as never, noPdf as never, () => Date.now(), 0);
    index.load(
      corpus([
        "| Rzeczy znalezione | Dz.U. 2023 poz. 501 t.j. | dr-02 | ✅ |",
        "| Nowelizacja rzeczy znalezionych | Dz.U. 2026 poz. 184 | dr-02 | ✅ |"
      ])
    );
    await index.refresh({ force: true });
    await index.refresh();

    const act = index.status().acts.find((item) => item.eli === "DU/2026/184")!;
    expect(act.state).not.toBe("MISSING");
    expect(act.articleCount).toBe(1);
  });
});
