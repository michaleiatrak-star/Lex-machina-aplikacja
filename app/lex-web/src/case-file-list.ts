import type { ProcessingProgress, StoredUploadResponse } from "./api.js";
import { progressLabel } from "./processing-progress.js";

/** Load state of the case-file list in the chat picker: unknown (failed) is not empty. */
export type CaseFileListLoad = {
  caseId: string;
  status: "loading" | "loaded" | "failed";
  error?: string;
};

// Automatic retries after a failed load while the picker is open; then only the button.
export const CASE_FILE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;
// Refresh period while a file of the case is still being read or anonymized.
export const CASE_FILE_REFRESH_MS = 3_000;

const TIMEOUT = /10060|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|PROXY_FAILED|Failed to fetch|NetworkError/i;

/** Readable Polish for a failed list load; a timeout or proxy error says what it likely is. */
export function caseFileListErrorText(raw: string, retrying: boolean): string {
  const base = TIMEOUT.test(raw)
    ? "Aplikacja nie odpowiedziała w czasie (może być zajęta odczytem OCR)."
    : `Nie udało się odczytać dokumentów sprawy: ${raw}`;
  return retrying ? `${base} Ponawiam…` : base;
}

export type CaseFileListView =
  | { kind: "none" }
  | { kind: "loading"; text: string }
  | { kind: "failed"; text: string }
  | { kind: "empty"; text: string }
  | { kind: "list" };

/** What the picker shows above or instead of the list; never "empty" when the load failed. */
export function caseFileListView(
  load: CaseFileListLoad | null,
  caseId: string,
  count: number,
  retrying: boolean
): CaseFileListView {
  if (!caseId) return count ? { kind: "list" } : { kind: "empty", text: "Brak zapisanych plików w tej sprawie." };
  // A reload after a failure keeps the error on screen until a load succeeds.
  if (load?.caseId === caseId && load.status === "loading" && load.error) {
    return { kind: "failed", text: caseFileListErrorText(load.error, true) };
  }
  if (!load || load.caseId !== caseId || load.status === "loading") {
    return count ? { kind: "list" } : { kind: "loading", text: "Wczytywanie dokumentów sprawy…" };
  }
  if (load.status === "failed") return { kind: "failed", text: caseFileListErrorText(load.error ?? "", retrying) };
  return count ? { kind: "list" } : { kind: "empty", text: "Brak zapisanych plików w tej sprawie." };
}

/** One line with the real state of a case file: in progress, ready, failed or unprocessed. */
export function caseFileStatusText(
  item: Pick<StoredUploadResponse, "processing">,
  state: { busy?: boolean; progress?: ProcessingProgress; error?: string } = {}
): string {
  if (state.progress) {
    const detail = progressLabel(state.progress);
    return state.progress.stage === "READING" || state.progress.stage === "OCR"
      ? `W trakcie odczytu (OCR)… ${detail}`
      : `Anonimizacja w toku… ${detail}`;
  }
  if (state.busy) return "Przetwarzanie w toku…";
  if (state.error) return `Błąd przetwarzania: ${state.error}`;
  const processing = item.processing;
  if (!processing) return "Nieprzetworzony – wybierz anonimizację albo samo OCR";
  if (processing.chunkIndices.length === 0) return "Przetworzony, ale bez tekstu do wysłania";
  const version = processing.anonymized === false ? "tekst jawny (bez anonimizacji)" : "wersja zanonimizowana";
  return (
    `Gotowy · ${version} · ${processing.totalPages} ${processing.totalPages === 1 ? "strona" : "stron"}` +
    (processing.ocrPages > 0 ? ` · OCR ${processing.ocrPages}` : "") +
    (processing.reviewed === false ? " · niepotwierdzony w podglądzie" : "")
  );
}
