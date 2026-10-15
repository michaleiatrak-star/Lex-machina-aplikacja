import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnfinishedAnalysis, finishAnalysisMessage, unfinishedDocuments } from "./document-coverage-view.js";

const doc = "doc_0123456789abcdef01234567";

describe("dokument przeczytany częściowo w analizie", () => {
  it("jest niedokończoną pracą, dopóki kolejne tury nie przeczytają reszty", () => {
    const first = { documentAnalysis: true, documentCoverage: [{ documentId: doc, title: "akta.pdf", totalPages: 40, pages: [[1, 12]] as Array<[number, number]>, status: "PARTIAL" as const }] };
    const open = unfinishedDocuments([first]);
    expect(open).toEqual([{ documentId: doc, title: "akta.pdf", totalPages: 40, read: [[1, 12]], missing: [[13, 40]] }]);
    expect(finishAnalysisMessage("akta.pdf", open[0]!)).toBe(
      "Dokończ analizę dokumentu „akta.pdf”: przeczytaj nieprzeczytane strony 13–40 z 40 (read_case_file, kolejne fragmenty) i uzupełnij wcześniejszy wynik. Nie powtarzaj stron już omówionych (1–12)."
    );
    const rest = { documentCoverage: [{ documentId: doc, totalPages: 40, pages: [[13, 40]] as Array<[number, number]>, status: "PARTIAL" as const }] };
    expect(unfinishedDocuments([first, rest])).toEqual([]);
  });

  it("zwykłe pytanie (bez analizy) nie otwiera pracy do dokończenia", () => {
    expect(unfinishedDocuments([{ documentCoverage: [{ documentId: doc, totalPages: 40, pages: [[3, 4]], status: "PARTIAL" }] }])).toEqual([]);
  });

  it("pokazuje strony przeczytane i brakujące z przyciskiem", () => {
    const html = renderToStaticMarkup(
      <UnfinishedAnalysis items={[{ documentId: doc, totalPages: 40, read: [[1, 12]], missing: [[13, 40]] }]} label={() => "akta.pdf"} disabled={false} onFinish={() => undefined} />
    );
    expect(html).toContain("Analiza niedokończona");
    expect(html).toContain("nieprzeczytane s. 13–40");
    expect(html).toContain("Dokończ analizę");
  });
});
