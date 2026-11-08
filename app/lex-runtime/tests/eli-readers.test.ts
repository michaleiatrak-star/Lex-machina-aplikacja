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
