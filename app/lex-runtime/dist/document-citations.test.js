import { describe, expect, it } from "vitest";
import { QUOTE_MISMATCH_MARKER, QUOTE_UNSOURCED_MARKER, processDocumentCitationMarkers } from "./document-citations.js";
const attachments = [
    {
        caseId: "case_" + "a".repeat(32),
        documentId: "document_" + "b".repeat(32),
        sourceScope: "MANUAL",
        chunks: [
            {
                index: 1,
                pageStart: 3,
                pageEnd: 3,
                text: "[STRONA 3 · DIGITAL]\nPozwany zobowiązał się zapłacić kwotę 10 000 zł do dnia 15 maja 2026 r. Pozostała część dokumentu."
            }
        ]
    }
];
describe("local document citations", () => {
    it("creates an in-chat reference and exact highlight only for a real attached chunk", () => {
        const result = processDocumentCitationMarkers(`Z dokumentu wynika: „Pozwany zobowiązał się zapłacić kwotę 10 000 zł do dnia 15 maja 2026 r.”[[LEXDOC:${attachments[0].documentId}:1]]`, attachments);
        expect(result.rejectedMarkers).toBe(0);
        expect(result.text).toContain("[[LEXDOCREF:docref_1]]");
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0]?.pageStart).toBe(3);
        expect(result.citations[0]?.highlightStart).toBeGreaterThanOrEqual(0);
        expect(result.citations[0]?.contextText.slice(result.citations[0]?.highlightStart, result.citations[0]?.highlightEnd)).toContain("Pozwany zobowiązał się zapłacić");
    });
    it("a signature from the case's documents links to the passage that names it (RD 121/26)", () => {
        const docs = [{ ...attachments[0], chunks: [{ index: 2, pageStart: 1, pageEnd: 1, text: "SENTENCJA\nSygn. akt VIII W 633/25\nWyrok w imieniu Rzeczypospolitej Polskiej" }] }];
        const result = processDocumentCitationMarkers("Sąd uniewinnił skarżącego (sygn. akt VIII W 633/25 ⚠️ [NIEWERYFIKOWANE: z materiałów sprawy]). Inna sprawa I C 1/26 ⚠️ [NIEWERYFIKOWANE: z materiałów sprawy].", docs);
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0]).toMatchObject({ pageStart: 1, chunkIndex: 2 });
        expect(result.citations[0]?.contextText.slice(result.citations[0]?.highlightStart, result.citations[0]?.highlightEnd)).toBe("VIII W 633/25");
        expect(result.text).toContain("z materiałów sprawy] [[LEXDOCREF:docref_1]])");
        // Not in any document: the marker stays without a link.
        expect(result.text).toContain("I C 1/26 ⚠️ [NIEWERYFIKOWANE: z materiałów sprawy].");
    });
    it("a quote with editorial endings in brackets is found; a changed word is not (RD 121/26)", () => {
        const docs = [{ ...attachments[0], chunks: [{ index: 4, pageStart: 2, pageEnd: 2, text: "Moi Mocodawcy oraz Wspólnicy, Członkowie Zarządu oraz kadra pracownicza Spółek nie życzą sobie kontaktu, także pocztą tradycyjną." }] }];
        const found = processDocumentCitationMarkers("Pismo obejmuje „Wspólnik[ów], Członk[ów] Zarządu oraz kadr[ę] pracownicz[ą] Spółek” oraz „poczt[ę] tradycyjn[ą]” i inne drogi.", docs);
        expect(found.text).not.toContain(QUOTE_UNSOURCED_MARKER);
        expect(found.citations.length).toBeGreaterThanOrEqual(1);
        const changed = processDocumentCitationMarkers("Pismo obejmuje „Wspólnik[ów], Członk[ów] Rady oraz kadr[ę] pracownicz[ą] Spółek”.", docs);
        expect(changed.text).toContain(QUOTE_UNSOURCED_MARKER);
    });
    it("drops an invented marker instead of exposing a fake deep link", () => {
        const result = processDocumentCitationMarkers("Rzekomy cytat. [[LEXDOC:document_ffffffffffffffffffffffffffffffff:99]]", attachments);
        expect(result.rejectedMarkers).toBe(1);
        expect(result.citations).toEqual([]);
        expect(result.text).not.toContain("LEXDOC");
    });
    it("links a real chunk without claiming a highlight when the wording is not verbatim", () => {
        const result = processDocumentCitationMarkers(`Dokument wskazuje termin zapłaty.[[LEXDOC:${attachments[0].documentId}:1]]`, attachments);
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0]?.highlightStart).toBeUndefined();
        expect(result.citations[0]?.highlightEnd).toBeUndefined();
    });
    const pleading = {
        caseId: "case_" + "a".repeat(32),
        documentId: "document_" + "c".repeat(32),
        sourceScope: "CASE_KNOWLEDGE",
        chunks: [
            { index: 0, pageStart: 1, pageEnd: 1, text: "ODPOWIEDŹ NA POZEW\nPozwany wnosi o oddalenie powództwa w całości." },
            {
                index: 1,
                pageStart: 2,
                pageEnd: 2,
                text: "Pozwany podnosi, że towar został dostarczony z opóźnieniem nieprzekraczają-\ncym trzech dni, a powód nie zgłosił reklamacji w terminie umownym."
            }
        ]
    };
    const pleadingRef = (chunk) => `[[LEXDOC:${pleading.documentId}:${chunk}]]`;
    it("marks a linked quote whose wording is not in the document", () => {
        const result = processDocumentCitationMarkers(`Pozwany twierdzi: „towar dostarczono bez żadnego opóźnienia”${pleadingRef(1)}.`, [pleading]);
        expect(result.citations[0]?.quoteFidelity).toBe("NOT_FOUND");
        expect(result.text).toContain(`[[LEXDOCREF:docref_1]] ${QUOTE_MISMATCH_MARKER}`);
        expect(result.quoteFindings.mismatched).toBe(1);
    });
    it("accepts a faithful quote across line-break hyphenation, case, typography and [...] elisions", () => {
        const result = processDocumentCitationMarkers(`W odpowiedzi na pozew: „towar został dostarczony z opóźnieniem nieprzekraczającym trzech dni [...] powód nie zgłosił reklamacji”${pleadingRef(1)}.`, [pleading]);
        const citation = result.citations[0];
        expect(citation.quoteFidelity).toBe("EXACT");
        expect(result.text).not.toContain(QUOTE_MISMATCH_MARKER);
        expect(citation.contextText.slice(citation.highlightStart, citation.highlightEnd))
            .toMatch(/^towar .* powód nie zgłosił reklamacji$/s);
    });
    it("re-anchors a quote cited with the wrong chunk to the passage that holds it", () => {
        const result = processDocumentCitationMarkers(`„powód nie zgłosił reklamacji w terminie umownym”${pleadingRef(0)}`, [pleading]);
        expect(result.citations[0]).toMatchObject({ chunkIndex: 1, pageStart: 2, quoteFidelity: "EXACT" });
    });
    it("links an unmarked quote found verbatim in a case document", () => {
        const result = processDocumentCitationMarkers("Strona przeciwna pisze, że „pozwany wnosi o oddalenie powództwa w całości”.", [pleading]);
        expect(result.quoteFindings.autoLinked).toBe(1);
        expect(result.citations[0]).toMatchObject({ chunkIndex: 0, quoteFidelity: "EXACT" });
        expect(result.text).toContain("”[[LEXDOCREF:docref_1]].");
    });
    it("flags an unmarked quote attributed to a pleading that no document contains", () => {
        const result = processDocumentCitationMarkers("Pozwany w odpowiedzi na pozew przyznał: „dług istnieje i zostanie spłacony w całości”.", [pleading]);
        expect(result.quoteFindings.unsourced).toBe(1);
        expect(result.text).toContain(`spłacony w całości” ${QUOTE_UNSOURCED_MARKER}.`);
    });
    it("leaves statute wording, the user's own words and short terms alone", () => {
        const text = [
            "Pozwany powołuje art. 6 k.c., który stanowi: „ciężar udowodnienia faktu spoczywa na osobie, która z faktu tego wywodzi skutki prawne”.",
            "Powód w wiadomości napisał: „chcę odzyskać całą zapłaconą kwotę za towar”.",
            "Umowa używa pojęcia „siła wyższa”."
        ].join("\n\n");
        const result = processDocumentCitationMarkers(text, [pleading], {
            otherTexts: ["Użytkownik: chcę odzyskać całą zapłaconą kwotę za towar"]
        });
        expect(result.text).toBe(text);
        expect(result.quoteFindings).toEqual({ autoLinked: 0, mismatched: 0, unsourced: 0 });
    });
    it("does not claim a mismatch when only a digest of the passage was available", () => {
        const digest = {
            ...pleading,
            chunks: [{ ...pleading.chunks[1], representation: "EXTRACTIVE_DIGEST", text: "Pozwany podnosi opóźnienie dostawy." }]
        };
        const result = processDocumentCitationMarkers(`„towar został dostarczony z opóźnieniem trzech dni”${pleadingRef(1)}`, [digest]);
        expect(result.citations[0]?.quoteFidelity).toBe("DIGEST_UNCHECKED");
        expect(result.text).not.toContain(QUOTE_MISMATCH_MARKER);
    });
    it("binds a marker set after italics to its quote, without a second link (C12-018)", () => {
        const result = processDocumentCitationMarkers(`Pozew: *„Pozwany wnosi o oddalenie powództwa w całości.”* ${pleadingRef(0)}`, [pleading]);
        expect(result.citations).toHaveLength(1);
        expect(result.citations[0]?.quoteFidelity).toBe("EXACT");
        expect(result.quoteFindings.autoLinked).toBe(0);
    });
    it("leaves statute wording read in this turn alone, even when called a document's text (C12-011)", () => {
        const text = "Tekst dokumentu: „W transakcjach handlowych - z wyłączeniem transakcji, w których dłużnikiem jest podmiot publiczny - wierzycielowi przysługują odsetki”.";
        const result = processDocumentCitationMarkers(text, [pleading], {
            otherTexts: ["Art. 7.\n\n1.\n\nW transakcjach handlowych - z wyłączeniem transakcji, w których dłużnikiem jest podmiot\npubliczny - wierzycielowi przysługują odsetki"]
        });
        expect(result.text).toBe(text);
    });
});
