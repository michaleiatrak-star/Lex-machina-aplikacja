import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBelgium, readDenmark, readGermany, readItaly, readNetherlands } from "../src/eli/readers.js";

// Fragments of the official answers read on 2026-11-08 (tests/fixtures/eli-readers).
const fixture = (name: string): string => fs.readFileSync(path.join(import.meta.dirname, "fixtures/eli-readers", name), "utf8");

describe("national readers (official sources that answer with the text)", () => {
  it("DK: § with Stk. from LexDania XML; LBK is a consolidated text published as its own act", () => {
    const reading = readDenmark(fixture("dk-retsplejeloven.xml"), "retsinformation.dk/eli/lta/2014/1308/xml");
    expect(reading.title).toBe("Bekendtgørelse af lov om rettens pleje");
    expect(reading.version).toMatch(/^LBK/u);
    expect(reading.articles.map((article) => article.unit)).toEqual(["§ 1", "§ 1 a", "§ 2", "§ 3"]);
    expect(reading.articles[0]!.text).toContain("De almindelige domstole er Højesteret");
    expect(reading.articles[0]!.text).toContain("Stk. 2.");
  });

  it("NL: articles of wetten.overheid.nl without the page's action lists", () => {
    const reading = readNetherlands(fixture("nl-bw1.html"), "wetten.overheid.nl/BWBR0002656");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2"]);
    expect(reading.articles[0]!.text).toMatch(/^1 Allen die zich in Nederland bevinden/u);
    expect(reading.articles[0]!.text).not.toMatch(/LiDO|permanente link/u);
  });

  it("BE: Justel articles with the amending acts and their dates in force", () => {
    const reading = readBelgium(fixture("be-banques.html"), "ejustice.just.fgov.be/eli/loi/2014/04/25/2014003194/justel");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1er", "2"]);
    expect(reading.articles[1]!.amendments).toContainEqual({ act: "L 2016-03-13/07", inForce: "2016-03-23" });
    expect(reading.status).toMatch(/bez mocy prawnej/u);
  });

  it("IT: Normattiva article with its update notes, accents decoded", () => {
    const reading = readItaly(fixture("it-cc.html"), "normattiva.it");
    expect(reading.articles[0]!.unit).toBe("1");
    expect(reading.articles[0]!.text).toMatch(/^È approvato il testo del Codice civile/u);
    expect(reading.articles[0]!.amendments[0]!.act).toMatch(/D\.Lgs\. Luogotenenziale 14 settembre 1944, n\. 287/u);
  });

  it("DE: one norm of gesetze-im-internet.de, its Absätze, marked unofficial", () => {
    const reading = readGermany(fixture("de-bgb-433.html"), "gesetze-im-internet.de/bgb/__433.html");
    expect(reading.title).toBe("Bürgerliches Gesetzbuch (BGB)");
    expect(reading.articles[0]!.heading).toBe("§ 433 Vertragstypische Pflichten beim Kaufvertrag");
    expect(reading.articles[0]!.text.split("\n")).toHaveLength(2);
    expect(reading.status).toMatch(/nieurzędowy/u);
  });
});

describe("legislation PDF: text layer read, a scan goes to OCR/RAG", () => {
  it("a PDF with text is read; an image-only PDF is a RAG candidate, not a wording", async () => {
    const { readLegislationPdf } = await import("../src/eli/readers.js");
    const text = await readLegislationPdf(new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, "fixtures/eli-readers/tekst.pdf"))));
    expect(text.kind).toBe("TEKST");
    expect(text.kind === "TEKST" && text.text).toContain("Art. 2. Przepisy stosuje sie odpowiednio.");
    const scan = await readLegislationPdf(new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, "fixtures/eli-readers/skan.pdf"))));
    expect(scan.kind).toBe("SKAN");
    expect(scan.kind === "SKAN" && scan.note).toMatch(/kandydat do OCR i indeksu RAG/u);
  });
});

describe("Switzerland: Fedlex Akoma Ntoso", () => {
  it("articles without the notes, the amending acts (AS) with their dates in force", async () => {
    const { readSwitzerland } = await import("../src/eli/readers.js");
    const reading = readSwitzerland(fixture("ch-zgb.xml"), "fedlex.data.admin.ch/eli/cc/24/233_245_233/20260701/de");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2", "3"]);
    expect(reading.articles[0]!.text).toMatch(/^1 Das Gesetz findet auf alle Rechtsfragen Anwendung/u);
    expect(reading.articles[0]!.text).not.toContain("in Kraft seit");
    expect(reading.articles[0]!.amendments).toContainEqual({ act: "https://fedlex.data.admin.ch/eli/oc/1999/149", inForce: "2000-01-01" });
  });
});

describe("Czech Republic: e-Sbírka fragments without a key", () => {
  it("articles from the fragments under each Čl., with the version date and the amending acts", async () => {
    const { readCzech } = await import("../src/eli/readers.js");
    const fragments = JSON.parse(fixture("cz-ustava-fragmenty.json")).seznam;
    const meta = JSON.parse(fixture("cz-ustava-metadata.json"));
    const reading = readCzech(fragments, meta, "e-sbirka.gov.cz/sb/1993/1/2026-01-01");
    const first = reading.articles.find((article) => article.unit === "1")!;
    expect(first.text).toMatch(/^\(1\) Česká republika je svrchovaný, jednotný a demokratický právní stát/u);
    expect(reading.articles.find((article) => article.unit === "2")!.text.split("\n")).toHaveLength(4);
    expect(reading.version).toContain("2026-01-01");
    expect(first.amendments).toContainEqual({ act: "87/2024 Sb." });
  });
});

describe("Austria: RIS OGD norm XML", () => {
  it("the § with its text, the last amending act and the date in force", async () => {
    const { readAustria } = await import("../src/eli/readers.js");
    const reading = readAustria(fixture("at-abgb-879.xml"), "ogd.ris.bka.gv.at/Dokumente/Bundesnormen/NOR12018602/NOR12018602.xml");
    const article = reading.articles[0]!;
    expect(article.unit).toBe("879");
    expect(article.text).toMatch(/^§ 879\. \(1\) Ein Vertrag, der gegen ein gesetzliches Verbot oder gegen die guten Sitten verstößt, ist nichtig\./u);
    expect(article.amendments).toEqual([{ act: "BGBl. Nr. 275/1992", inForce: "1992-07-01" }]);
    expect(reading.title).toBe("Allgemeines bürgerliches Gesetzbuch");
  });
});

describe("Monaco and Latvia", () => {
  it("MC: articles with the amending law and its date", async () => {
    const { readMonaco } = await import("../src/eli/readers.js");
    const reading = readMonaco(fixture("mc-code-civil.html"), "legimonaco.mc/code/code-civil/");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2", "3"]);
    expect(reading.articles[0]!.text).toMatch(/^Les lois acquièrent force obligatoire/u);
    expect(reading.articles[0]!.amendments).toContainEqual({ act: "Loi n° 803 du 10 juin 1966", inForce: "1966-06-10" });
  });

  it("LV: Civil Law articles by their number, a following paragraph stays with its article", async () => {
    const { readLatvia } = await import("../src/eli/readers.js");
    const reading = readLatvia(fixture("lv-civillikums.html"), "likumi.lv/ta/id/225418");
    expect(reading.articles.map((article) => article.unit)).toEqual(["122", "123", "124"]);
    expect(reading.articles[1]!.text).toContain("Trešo personu iegūtās tiesības paliek spēkā.");
  });
});

describe("Sweden: Riksdagen consolidated SFS text", () => {
  it("sections by number, the consolidation reference and an amending act at the section", async () => {
    const { readSweden } = await import("../src/eli/readers.js");
    const reading = readSweden(fixture("se-avtalslagen.txt"), "data.riksdagen.se/dokument/sfs-1915-218.text");
    expect(reading.version).toBe("ujednolicony do SFS 1994:1513");
    const s36 = reading.articles.find((article) => article.unit === "36")!;
    expect(s36.text).toMatch(/^36 § Avtalsvillkor får jämkas eller lämnas utan avseende/u);
    expect(s36.amendments.length).toBeGreaterThan(0);
    expect(reading.articles[0]!.unit).toBe("1");
  });
});
