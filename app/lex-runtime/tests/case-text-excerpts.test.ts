import { describe, expect, it } from "vitest";
import { caseTextExcerpt, caseTextPortion, holdCaseLawText, quotesForSignature } from "../src/case-law-texts.js";
import { documentCoveragePrompt } from "../src/context-orchestrator.js";

const LONG = `${"Wstęp orzeczenia. ".repeat(400)}Tu stoi kluczowa teza: profesjonalnemu pełnomocnikowi nie wolno ani pisemnie ani nawet ustnie uciekać się do groźby. ${"Dalsze uzasadnienie. ".repeat(1500)}`;

describe("long rulings: excerpts around what the case file quotes, the rest in portions", () => {
  it("quotes the file attributes to a signature", () => {
    const file = "Sąd Najwyższy w wyroku SDI 9/12 wskazał, że „profesjonalnemu pełnomocnikowi nie wolno ani pisemnie ani nawet ustnie uciekać się do groźby”. Inny wyrok I C 1/20 „zupełnie inny cytat z innego wyroku”.";
    expect(quotesForSignature(file, "SDI 9/12")[0]).toMatch(/^profesjonalnemu pełnomocnikowi/u);
  });
  it("a long text: the beginning and the quoted passage within the budget, the rest named", () => {
    const out = caseTextExcerpt(LONG, ["profesjonalnemu pełnomocnikowi nie wolno ani pisemnie ani nawet ustnie"], 6_000);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThan(6_400);
    expect(out.text.startsWith("Wstęp orzeczenia.")).toBe(true);
    expect(out.text).toContain("nie wolno ani pisemnie ani nawet ustnie");
    expect(out.text).toMatch(/doczytaj read_case_law_text z offset=\d+/u);
  });
  it("a short text stays whole; held texts are read in portions", () => {
    expect(caseTextExcerpt("Krótki tekst.", [])).toEqual({ text: "Krótki tekst.", truncated: false, chars: 13 });
    holdCaseLawText("SDI 9/12", "https://www.saos.org.pl/judgments/98038", LONG);
    const first = JSON.parse(caseTextPortion("sdi 9/12", 0));
    expect(first).toMatchObject({ status: "OK", offset: 0, nextOffset: 15_000 });
    expect(JSON.parse(caseTextPortion("SDI 9/12", first.nextOffset)).text.length).toBeGreaterThan(0);
    expect(JSON.parse(caseTextPortion("II CSK 1/20", 0)).status).toBe("NOT_HELD");
  });
});

describe("long documents: the pages the model got, by model", () => {
  const original = [{ documentId: "d1", title: "Akta", totalPages: 30, chunks: Array.from({ length: 30 }, (_, i) => ({ index: i, pageStart: i + 1, pageEnd: i + 1, text: `strona ${i + 1}` })) }] as never;
  const sent = [{ documentId: "d1", title: "Akta", totalPages: 30, chunks: [0, 1, 2, 9].map((i) => ({ index: i, pageStart: i + 1, pageEnd: i + 1, text: "x" })) }] as never;
  it("local model: answer from the pages it got, name the rest", () => {
    const prompt = documentCoveragePrompt(original, sent, { local: true, readTool: null })!;
    expect(prompt).toContain("„Akta” (30 s.): w całości s. 1–3, 10; NIEPRZEKAZANE s. 4–9, 11–30");
    expect(prompt).toContain("zaproponuj odczyt następnej porcji");
  });
  it("hosted model with the document tool: read the rest; a document sent whole: nothing", () => {
    expect(documentCoveragePrompt(original, sent, { local: false, readTool: "read_case_file" })).toContain("doczytaj narzędziem read_case_file");
    expect(documentCoveragePrompt(original, original, { local: true, readTool: null })).toBeNull();
  });
});
