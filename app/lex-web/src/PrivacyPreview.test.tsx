import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocumentReviewResponse } from "./api.js";
import { lineAt } from "./PageScanView.js";
import { PrivacyPreview, recognizerReason } from "./PrivacyPreview.js";

const text = "Wilk zaatakował owce. Kowal złożył zeznania. Data doręczenia 810.2024";
const review: DocumentReviewResponse = {
  documentId: "doc_0123456789abcdef01234567",
  mediaType: "application/pdf",
  complete: true,
  totalPages: 1,
  pages: [
    {
      page: 1,
      text,
      source: "OCR",
      corrections: [{ line: 0, from: "Pawla", to: "Pawła" }],
      review: [{ line: 2, text: "Data doręczenia 810.2024", score: 0.7, reason: "LOW_CONFIDENCE" }]
    }
  ],
  suggestions: [
    { page: 1, start: 0, end: 4, kind: "PERSON", aiNotPerson: "słowo pospolite" },
    { page: 1, start: 22, end: 27, kind: "PERSON" }
  ]
};

describe("preview before a document is finalized", () => {
  it("lists what to decide first, then the text with every detection masked", () => {
    const html = renderToStaticMarkup(
      <PrivacyPreview caseId="case_1" review={review} fileName="pismo.pdf" keepClear={false} onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(html).toContain("Do decyzji");
    expect(html).toContain("AI: słowo pospolite");
    expect(html).toContain("Odkryj");
    expect(html).toContain("„Data doręczenia 810.2024”");
    expect(html).toContain("Popraw tekst strony");
    expect(html).toContain("„Pawla” → „Pawła”");
    expect(html).toContain("Zakryte zostanie: 2");
    // The AI hint is still masked until the user unmasks it.
    expect(html).toMatch(/class="privacy-preview-mark is-ai-hint"[^>]*>Wilk<\/mark>/);
  });

  it("OCR only: no masks, the text and the doubtful lines to check", () => {
    const html = renderToStaticMarkup(
      <PrivacyPreview caseId="case_1" review={review} fileName="pismo.pdf" keepClear onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(html).toContain("Tekst bez anonimizacji");
    expect(html).not.toContain("AI: słowo pospolite");
    expect(html).toContain("Popraw tekst strony");
    expect(html).not.toContain("privacy-preview-mark");
  });

  it("a scanned document: the original next to the text, doubtful lines and fixes point at it", () => {
    const html = renderToStaticMarkup(
      <PrivacyPreview caseId="case_1" review={review} fileName="pismo.pdf" keepClear={false} onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(html).toContain("privacy-preview is-split");
    expect(html).toContain("Oryginał · s. 1");
    expect(html.match(/Pokaż na skanie/g)).toHaveLength(2);
  });

  it("says which local recognizer is down: addresses and surnames may be missing", () => {
    const down = { ...review, recognizerWarnings: [{ name: "Morfeusz (słownik imion, nazwisk i adresów)", reason: "GAZETTEER_FAILED:1" }] };
    const html = renderToStaticMarkup(
      <PrivacyPreview caseId="case_1" review={down} fileName="pismo.pdf" keepClear={false} onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(html).toContain("Nie działa Morfeusz (słownik imion, nazwisk i adresów): błąd uruchomienia - zgłoś szczegóły techniczne.");
    expect(recognizerReason("GAZETTEER_FAILED:1:ModuleNotFoundError: No module named 'morfeusz2'")).toContain("brak biblioteki Morfeusz");
    expect(recognizerReason("SELF_TEST_NO_PERSON")).toContain("nie rozpoznaje nazwisk");
    expect(recognizerReason("GAZETTEER_FAILED:1:ImportError: DLL load failed while importing morfeusz2: Nie można odnaleźć określonego modułu.")).toContain("Visual C++");
    expect(recognizerReason("Gazetteer worker exited with code 1: FileNotFoundError: [Errno 2] No such file or directory: 'surnames_pesel.tsv'")).toContain("brak pliku słownika");
    expect(recognizerReason("PermissionError: [WinError 5] Odmowa dostępu")).toContain("uprawnień");
  });

  it("a document with a text layer only: no scan pane", () => {
    const digital = { ...review, pages: review.pages.map((page) => ({ ...page, source: "DIGITAL" as const, corrections: [], review: [] })) };
    const html = renderToStaticMarkup(
      <PrivacyPreview caseId="case_1" review={digital} fileName="pismo.pdf" keepClear={false} onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(html).not.toContain("is-split");
    expect(html).not.toContain("Pokaż na skanie");
  });
});

describe("line of the scan under a click in the text", () => {
  const lines = [{ text: "Wezwanie do zapłaty" }, { text: "nienakłaniania osoby" }];
  const page = "Wezwanie do zapłaty\nnienakłaniania osoby";

  it("finds the OCR line holding the character", () => {
    expect(lineAt(lines, page, 3)).toBe(0);
    expect(lineAt(lines, page, 25)).toBe(1);
  });

  it("gives nothing when the text no longer follows the lines", () => {
    expect(lineAt(lines, "Tekst poprawiony ręcznie", 3)).toBeNull();
    // A line changed by hand does not hide the ones after it.
    expect(lineAt(lines, "Wezwanie do zapłaty!\nnienakłaniania osoby", 25)).toBe(1);
  });
});
