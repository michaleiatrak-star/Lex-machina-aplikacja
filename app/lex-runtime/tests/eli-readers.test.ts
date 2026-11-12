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

describe("Turkey: Mevzuat Bilgi Sistemi HTML", () => {
  it("TR: Madde N with its paragraphs, section headings end an article, amendment note with the amending law", async () => {
    const { readTurkey } = await import("../src/eli/readers.js");
    const reading = readTurkey(fixture("tr-medeni-kanunu.html"), "mevzuat.gov.tr 1/4721/5");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2", "27"]);
    expect(reading.articles[0]!.text).toMatch(/^Madde 1 - Kanun, sözüyle ve özüyle/u);
    expect(reading.articles[0]!.text).toContain("yargı kararlarından yararlanır.");
    expect(reading.articles[0]!.text).not.toContain("Hukukî ilişkilerin kapsamı");
    expect(reading.articles[2]!.amendments).toContainEqual({ act: "Değişik ikinci fıkra: 2024-11-14, Kanun 7532 md. 12" });
  });

  it("TR: the official host goes to the HTML reader, the article asked for as \"Madde 27\"", async () => {
    const { readNationalLaw } = await import("../src/eli/national-law.js");
    const body = new TextEncoder().encode(fixture("tr-medeni-kanunu.html"));
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => "text/html; charset=utf-8" }, arrayBuffer: async () => body.buffer });
    const answer = await readNationalLaw({ url: "https://www.mevzuat.gov.tr/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=1&MevzuatNo=4721&MevzuatTertip=5", unit: "Madde 27", country: "TR" }, fetchImpl as never);
    expect(answer.country).toBe("TR");
    expect(answer.articles).toHaveLength(1);
    expect(answer.articles[0]!.text).toContain("Adın değiştirilmesi, ancak haklı sebeplere");
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

describe("Luxembourg: Legilux Akoma Ntoso", () => {
  it("top-level articles; the provision an amending act quotes stays in its text", async () => {
    const { readLuxembourg } = await import("../src/eli/readers.js");
    const reading = readLuxembourg(fixture("lu-loi-2016.xml"), "data.legilux.public.lu/eli/etat/leg/loi/2016/05/23/n2/jo/fr/xml");
    expect(reading.articles.map((article) => article.unit)).not.toContain("170-1");
    const second = reading.articles.find((article) => article.unit === "2")!;
    expect(second.text).toMatch(/^Le Code civil est complété comme suit/u);
    expect(second.text).toContain("Art. 170-1.");
  });
});

describe("Finland: Finlex Akoma Ntoso", () => {
  it("Finnish consolidated text, amending act at the section, no legal force", async () => {
    const { readFinland } = await import("../src/eli/readers.js");
    const reading = readFinland(fixture("fi-oikeustoimilaki.xml"), "opendata.finlex.fi/…/statute-consolidated/1929/228");
    expect(reading.title).toBe("Laki varallisuusoikeudellisista oikeustoimista");
    expect(reading.version).toBe("ujednolicony do 2004/128");
    expect(reading.status).toMatch(/bez mocy urzędowej/u);
    const s36 = reading.articles.find((article) => article.unit === "36")!;
    expect(s36.text).toMatch(/^Jos oikeustoimen ehto on kohtuuton/u);
    expect(s36.amendments).toEqual([{ act: "17.12.1982/956" }]);
    expect(reading.articles).toHaveLength(42);
  });

  it("chapters restarting the numbering: unit names the chapter", async () => {
    const { readFinland } = await import("../src/eli/readers.js");
    const reading = readFinland(fixture("fi-rikoslaki-luvut.xml"), "opendata.finlex.fi/…/statute-consolidated/1889/39-001/fin@20150564");
    const legality = reading.articles.find((article) => article.unit === "3 luku 1")!;
    expect(legality.heading).toBe("3 luku 1 § Laillisuusperiaate");
    expect(legality.text).toMatch(/^Rikokseen syylliseksi saa katsoa vain/u);
  });
});

describe("Estonia: Riigi Teataja XML", () => {
  it("paragraphs with their sections and the amending act of a section", async () => {
    const { readEstonia } = await import("../src/eli/readers.js");
    const reading = readEstonia(fixture("ee-volaoigusseadus.xml"), "riigiteataja.ee/public-api/api/v1/akt/120062026018/blob-xml");
    expect(reading.title).toBe("Võlaõigusseadus");
    expect(reading.version).toBe("wersja od 2026-09-01 do 2026-12-31");
    const s106 = reading.articles.find((article) => article.unit === "106")!;
    expect(s106.heading).toBe("§ 106. Vastutusest vabastamise või vastutuse piiramise kokkulepe");
    expect(s106.text).toMatch(/^\(1\) Võlgnik ja võlausaldaja võivad eelnevalt kokku leppida/u);
    expect(reading.articles.find((article) => article.unit === "1")!.amendments[0]).toEqual({ act: "RT I, 131122013001", inForce: "2014-06-13" });
  });
});

describe("readers added 2026-11-08: SK, HR, XK, SI, IS, FO, canon law", () => {
  it("SK: version in force on a day from the Slov-Lex history, § with its odseky", async () => {
    const { slovakVersions, slovakVersionOn, readSlovakia } = await import("../src/eli/readers.js");
    const versions = slovakVersions(fixture("sk-40-1964-index.html"));
    expect(slovakVersionOn(versions, "1970-01-01")).toMatchObject({ file: "19690701.html", amendments: ["58/1969 Zb."] });
    const latest = slovakVersionOn(versions, "2026-11-08")!;
    const reading = readSlovakia(fixture("sk-40-1964-20260731.html"), "x", latest);
    expect(reading.articles.map((article) => article.unit)).toEqual(["415", "417"]);
    expect(reading.articles[1]!.text).toContain("ohrozený má právo");
    expect(reading.articles[1]!.text).not.toContain("DRUHÁ HLAVA");
  });

  it("HR: Članak N. with its paragraph, the bold title of the next article is not part of it", async () => {
    const { readCroatia } = await import("../src/eli/readers.js");
    const reading = readCroatia(fixture("hr-zoo-35-2005.html"), "x");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2", "3"]);
    expect(reading.articles[0]!.text).not.toContain("Sloboda uređivanja");
  });

  it("XK: Neni N from the act's text; status and amending acts from ActDetail", async () => {
    const { readKosovo } = await import("../src/eli/readers.js");
    const reading = readKosovo(fixture("xk-act-document.html"), "x", fixture("xk-act-detail.html"));
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2", "3"]);
    expect(reading.status).toMatch(/UCHYLONY/u);
    expect(reading.articles[0]!.amendments[0]).toMatchObject({ inForce: "2012-11-09" });
  });

  it("SI: PISRS card picks the newest NPB with HTML; N. člen without the next article's title", async () => {
    const { pisrsCard, readPisrs, readSlovenia } = await import("../src/eli/readers.js");
    const card = pisrsCard(fixture("si-pisrs-zako1263.json"));
    expect(card.versions.map((version) => version.name)).toEqual(["Osnovni", "NPB 1", "NPB 2", "NPB 3", "NPB 4"]);
    const reading = readPisrs(fixture("si-pisrs-oz-npb4.html"), "x", card, "NPB 4");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2"]);
    expect(reading.articles[0]!.text).not.toContain("Dispozitivna narava");
    expect(reading.status).toMatch(/nieurzędowy/u);
    expect(readSlovenia(fixture("si-ul-2001-4186.html"), "x").articles.map((article) => article.unit)).toEqual(["1", "2", "3"]);
  });

  it("IS: articles and amending laws with dates in force; marked unofficial", async () => {
    const { readIceland } = await import("../src/eli/readers.js");
    const reading = readIceland(fixture("is-1944-33.xml"), "x", "158a");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2"]);
    expect(reading.articles[0]!.amendments).toContainEqual({ act: "L. 51/1959", inForce: "1959-08-20" });
    expect(reading.status).toMatch(/nieurzędowa/u);
  });

  it("FO: § N from Lógasavnið", async () => {
    const { readFaroe } = await import("../src/eli/readers.js");
    const reading = readFaroe(fixture("fo-logtingslog-94-2026.html"), "x");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2"]);
    expect(reading.articles[1]!.text).toBe("§ 2\nHenda løgtingslóg kemur í gildi 1. januar 2027.");
  });

  it("canon law: Can. N, § entities decoded, headings end a canon", async () => {
    const { readCanonLaw } = await import("../src/eli/readers.js");
    const first = readCanonLaw(fixture("va-cic-liberI.html"), "x");
    expect(first.articles.map((article) => article.unit)).toEqual(["1", "2", "3", "7"]);
    expect(first.articles[2]!.text).not.toContain("TITULUS");
    const sixth = readCanonLaw(fixture("va-cic-liberVI.html"), "x");
    expect(sixth.articles[0]!.text).toMatch(/^Can\. 1311 — § 1\. Nativum/u);
    expect(sixth.articles[0]!.text).toContain("§ 2. Qui Ecclesiae");
  });

  it("canon law is read whatever country is chosen; another country's source is not", async () => {
    const { readNationalLaw } = await import("../src/eli/national-law.js");
    const body = new TextEncoder().encode(fixture("va-cic-liberVI.html"));
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, arrayBuffer: async () => body.buffer });
    const canon = await readNationalLaw({ url: "https://www.vatican.va/archive/cod-iuris-canonici/latin/documents/cic_liberVI_la.html", unit: "can. 1311", country: "PL" }, fetchImpl as never);
    expect(canon.articles).toHaveLength(1);
    await expect(readNationalLaw({ url: "https://narodne-novine.nn.hr/clanci/sluzbeni/2005_03_35_707.html", unit: "2", country: "AT" }, fetchImpl as never)).rejects.toThrow("NATIONAL_LAW_COUNTRY_DISABLED:HR");
  });
});


describe("Georgia (Matsne) and unit matching", () => {
  it("GE: consolidated publications with dates; მუხლი N. from p.muxlixml with its paragraphs", async () => {
    const { matsneVersions, readMatsne } = await import("../src/eli/readers.js");
    const html = fixture("ge-civil-code-ka.html");
    expect(matsneVersions(html).slice(0, 2)).toEqual([{ publication: "140", date: "2026-06-25" }, { publication: "139", date: "2026-06-23" }]);
    const reading = readMatsne(html, "https://matsne.gov.ge/ka/document/view/31702?publication=140");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2", "3"]);
    expect(reading.status).toMatch(/urzędowy/u);
  });

  it("\"Article 2\" is article 2 (the longer word is cut first)", async () => {
    const { readNationalLaw } = await import("../src/eli/national-law.js");
    const body = new TextEncoder().encode(fixture("va-cic-liberVI.html"));
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, arrayBuffer: async () => body.buffer });
    const answer = await readNationalLaw({ url: "https://www.vatican.va/archive/cod-iuris-canonici/latin/documents/cic_liberVI_la.html", unit: "Canon 1312", country: "IT" }, fetchImpl as never);
    expect(answer.articles.map((article) => article.unit)).toEqual(["1312"]);
  });
});

describe("Paragraf Lex (RS, ME, BA)", () => {
  it("Član N with its paragraphs; a removed range and the next title are not part of the article; marked unofficial", async () => {
    const { readParagraf } = await import("../src/eli/readers.js");
    const reading = readParagraf(fixture("rs-paragraf-zoo.html"), "x", "RS");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2", "10"]);
    expect(reading.articles[1]!.text).not.toContain("Brisano");
    expect(reading.articles[1]!.text).not.toContain("Autonomija volje");
    expect(reading.status).toMatch(/nieurzędowy/u);
  });
});

describe("common law and mixed systems: statutes and judgments", () => {
  it("GB statute: section with subsections and the amending act from the F-commentary", async () => {
    const { readUnitedKingdom } = await import("../src/eli/readers.js");
    const reading = readUnitedKingdom(fixture("uk-sga-1979-s14.xml"), "x");
    expect(reading.title).toBe("Sale of Goods Act 1979");
    expect(reading.articles[0]!.text).toContain("(2A) For the purposes of this Act, goods are of satisfactory quality");
    expect(reading.articles[0]!.amendments[0]).toMatchObject({ inForce: "1995-01-03" });
  });

  it("GB judgment (Find Case Law): numbered paragraphs, neutral citation, court and date", async () => {
    const { readUkJudgment } = await import("../src/eli/readers.js");
    const reading = readUkJudgment(fixture("uk-uksc-2024-1.xml"), "x");
    expect(reading.title).toContain("Paul and another v Royal Wolverhampton NHS Trust");
    expect(reading.version).toBe("UKSC, 2024-01-11");
    expect(reading.articles[0]!.text).toMatch(/^\[1\] Introduction/u);
    expect(reading.status).toMatch(/orzeczenie/u);
  });

  it("IE: section as enacted, without the 'Act Referred to' table", async () => {
    const { readIreland } = await import("../src/eli/readers.js");
    const reading = readIreland(fixture("ie-1980-40-s2.html"), "x");
    expect(reading.articles.map((article) => article.unit)).toEqual(["2"]);
    expect(reading.articles[0]!.text).not.toContain("Referred");
  });

  it("CY: windows-1253 decoded by its meta charset; marked unofficial", async () => {
    const { readNationalLaw } = await import("../src/eli/national-law.js");
    const body = fs.readFileSync(path.join(import.meta.dirname, "fixtures/eli-readers", "cy-kef149.html"));
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
    const answer = await readNationalLaw({ url: "https://www.cylaw.org/nomoi/enop/non-ind/0_149/full.html", unit: "2", country: "CY" }, fetchImpl as never);
    expect(answer.articles[0]!.text).toMatch(/^2\.-\(1\) Ο Νόμος αυτός ερμηνεύεται/u);
    expect(answer.status).toMatch(/nieurzędowy/u);
  });

  it("IE judgments: page metadata and PDF link; numbered paragraphs, page numbers skipped", async () => {
    const { irishJudgmentPage, judgmentParagraphs } = await import("../src/eli/readers.js");
    expect(irishJudgmentPage(fixture("ie-judgment-page.html"))).toEqual({
      title: "Portmarnock Real Estate Developments Limited -v- An Coimisiún Pleanála",
      court: "High Court",
      judge: "Stack J.",
      citation: "[2026] IEHC 720",
      delivered: "28 Oct 2026",
      pdf: "/judgments/documents/78216"
    });
    const paragraphs = judgmentParagraphs(fixture("ie-judgment-2026-iehc-720.txt"));
    expect(paragraphs.slice(0, 3).map((paragraph) => paragraph.unit)).toEqual(["1", "1.1", "1.2"]);
    expect(paragraphs[2]!.text).toContain("The purpose of the RZLT is to incentivise");
  });

  it("CY judgments: CyLaw open.pl goes to the judgment reader; court from the header, ¶ numbering marked as the reader's", async () => {
    const { readNationalLaw } = await import("../src/eli/national-law.js");
    const body = fs.readFileSync(path.join(import.meta.dirname, "fixtures/eli-readers", "cy-judgment-260-2026.html"));
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
    const answer = await readNationalLaw({ url: "https://www.cylaw.org/cgi-bin/open.pl?file=/courtOfAppeal/2026/202611-260-26PoinEf.html", unit: "¶2", country: "CY" }, fetchImpl as never);
    expect(answer.articles.map((article) => article.text)).toEqual(["(Ποινική Έφεση Αρ.: 260/2026)"]);
    expect(answer.status).toMatch(/numeracja akapitów nadana przez czytnik/u);
  });

  it("RW: RwandaLII Akoma Ntoso articles (One = 1) with the dated version", async () => {
    const { readRwandaLii } = await import("../src/eli/readers.js");
    const reading = readRwandaLii(fixture("rw-law-2008-19.html"), "https://rwandalii.org/akn/rw/act/law/2008/19/eng@2009-04-27");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1", "2", "3"]);
    expect(reading.articles[1]!.text).toMatch(/^Article 2 – Title of the national Anthem/u);
    expect(reading.version).toBe("wersja z 2009-04-27 (RwandaLII)");
    expect(reading.status).toMatch(/art\. 96/u);
  });

  it("RW: a page without the text (the Constitution) is read from its source.pdf", async () => {
    const { readNationalLaw } = await import("../src/eli/national-law.js");
    const asked: string[] = [];
    const page = new TextEncoder().encode('<html><a href="/akn/rw/act/law/2003/nn/eng@2015-12-24/source.pdf">PDF</a></html>');
    const fetchImpl = async (address: string) => {
      asked.push(String(address));
      return asked.length === 1
        ? { ok: true, status: 200, headers: { get: () => "text/html" }, arrayBuffer: async () => page.buffer }
        : { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    await expect(readNationalLaw({ url: "https://rwandalii.org/akn/rw/act/law/2003/nn/eng@2015-12-24", unit: "Article 96", country: "RW" }, fetchImpl as never)).rejects.toThrow();
    expect(asked[1]).toBe("https://rwandalii.org/akn/rw/act/law/2003/nn/eng@2015-12-24/source.pdf");
  });

  it("US Code: section with the edition and the amendment notes", async () => {
    const { readUsCode } = await import("../src/eli/readers.js");
    const reading = readUsCode(fixture("us-15-usc-1.html"), "x");
    expect(reading.articles.map((article) => article.unit)).toEqual(["1"]);
    expect(reading.version).toBe("United States Code, wydanie 2024");
    expect(reading.articles[0]!.amendments[0]!.act).toMatch(/^2004: Pub\. L\. 108–237/u);
  });

  it("US judgment (Caselaw Access Project): official citation, court, date, the opinion", async () => {
    const { readCapCase } = await import("../src/eli/readers.js");
    const reading = readCapCase(fixture("us-cap-347-us-483.json"), "x");
    expect(reading.title).toBe("Brown v. Board of Education, 347 U.S. 483");
    expect(reading.version).toBe("Supreme Court of the United States, 1954-05-17");
    expect(reading.articles[0]!.unit).toBe("majority");
  });

  it("method follows the family: common law asks for precedent, the USA for the state; mixed systems quote their note", async () => {
    const { familyMethod } = await import("../src/jurisdiction.js");
    const { eliCountry } = await import("../src/eli/eli-countries.js");
    expect(familyMethod(eliCountry("GB"))).toContain("ratio decidendi");
    expect(familyMethod(eliCountry("US"))).toContain("prawo federalne i stanowe");
    expect(familyMethod(eliCountry("MT"))).toContain("tekst maltański");
    expect(familyMethod(eliCountry("SE"))).toContain("RODZINA-PRAWA-NORDYCKIE.md");
    expect(familyMethod(eliCountry("FI"))).toContain("bez formalnego stare decisis");
    expect(familyMethod(eliCountry("DE"))).toBe("");
  });
});
