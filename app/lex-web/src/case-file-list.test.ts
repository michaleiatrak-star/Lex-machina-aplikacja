import { describe, expect, it } from "vitest";
import { caseFileListErrorText, caseFileListView, caseFileStatusText } from "./case-file-list.js";

const processing = {
  documentId: "d1",
  complete: true as const,
  totalPages: 4,
  digitalPages: 2,
  ocrPages: 2,
  blankPages: 0,
  chunkIndices: [0, 1]
};

describe("case-file list state", () => {
  it("a failed load is never shown as an empty case", () => {
    const view = caseFileListView(
      { caseId: "c1", status: "failed", error: "DESKTOP_RUNTIME_PROXY_FAILED:READ: (os error 10060)" },
      "c1",
      0,
      true
    );
    expect(view.kind).toBe("failed");
    expect(view.kind === "failed" && view.text).toBe(
      "Aplikacja nie odpowiedziała w czasie (może być zajęta odczytem OCR). Ponawiam…"
    );
  });

  it("loading, empty and list", () => {
    expect(caseFileListView({ caseId: "c1", status: "loading" }, "c1", 0, false)).toEqual({
      kind: "loading",
      text: "Wczytywanie dokumentów sprawy…"
    });
    expect(caseFileListView(null, "c1", 0, false).kind).toBe("loading");
    expect(caseFileListView({ caseId: "c1", status: "loaded" }, "c1", 0, false).kind).toBe("empty");
    expect(caseFileListView({ caseId: "c1", status: "loaded" }, "c1", 3, false).kind).toBe("list");
  });

  it("other errors keep their text; no retry note when retries ended", () => {
    expect(caseFileListErrorText("FORBIDDEN", false)).toBe("Nie udało się odczytać dokumentów sprawy: FORBIDDEN");
  });

  it("per-file status", () => {
    expect(caseFileStatusText({})).toBe("Nieprzetworzony – wybierz anonimizację albo samo OCR");
    expect(caseFileStatusText({ processing })).toBe("Gotowy · wersja zanonimizowana · 4 stron · OCR 2");
    expect(caseFileStatusText({ processing: { ...processing, anonymized: false } })).toContain("tekst jawny");
    expect(caseFileStatusText({}, { progress: { stage: "OCR", done: 0, total: 3, updatedAt: "" } })).toMatch(
      /^W trakcie odczytu \(OCR\)…/
    );
    expect(caseFileStatusText({}, { progress: { stage: "PSEUDONYMIZING", updatedAt: "" } })).toMatch(/^Anonimizacja w toku…/);
    expect(caseFileStatusText({}, { error: "timeout" })).toBe("Błąd przetwarzania: timeout");
    expect(caseFileStatusText({}, { busy: true })).toBe("Przetwarzanie w toku…");
  });
});

describe("case-file list retry", () => {
  it("a reload after a failure keeps the error with a retry note", () => {
    const view = caseFileListView({ caseId: "c1", status: "loading", error: "timeout" }, "c1", 0, false);
    expect(view).toEqual({ kind: "failed", text: "Aplikacja nie odpowiedziała w czasie (może być zajęta odczytem OCR). Ponawiam…" });
  });
});
