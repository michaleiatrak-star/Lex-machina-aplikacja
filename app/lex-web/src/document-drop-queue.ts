export const MAX_DOCUMENT_DROP_QUEUE = 20;

export const DOCUMENT_FILE_ACCEPT =
  ".pdf,.docx,.odt,.xlsx,.xlsm,.csv,.tsv,.txt,.md,.zip,application/pdf,application/zip,text/plain,text/markdown,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroenabled.12,image/jpeg,image/png,image/webp,image/tiff";

// What became of a file that left the queue. Disjoint: a skipped or failed file is
// never counted as ready (before, every file leaving the queue was "zakończono").
export type DocumentDropOutcome =
  | "READY" // read, personal data decided; waits to be saved in the case
  | "STORED" // saved in the case without processing (archive)
  | "SKIPPED"; // the user skipped it (also after an error)

export type DocumentDropQueueState = {
  files: File[];
  total: number;
  // Files that left the queue, whatever the outcome (ready + stored + skipped).
  completed: number;
  rejected: number;
  ready: number;
  stored: number;
  skipped: number;
};

export function createDocumentDropQueueState():
  DocumentDropQueueState {
  return {
    files: [],
    total: 0,
    completed: 0,
    rejected: 0,
    ready: 0,
    stored: 0,
    skipped: 0
  };
}

export function enqueueDocumentDropFiles(
  state: DocumentDropQueueState,
  incoming: readonly File[]
): DocumentDropQueueState {
  const finished =
    state.files.length === 0 &&
    state.total > 0 &&
    state.completed >= state.total;
  const base = finished
    ? createDocumentDropQueueState()
    : state;
  const nonEmpty =
    incoming.filter(
      (file) =>
        Number.isFinite(file.size) &&
        file.size > 0
    );
  const invalid =
    incoming.length - nonEmpty.length;
  const room =
    Math.max(
      0,
      MAX_DOCUMENT_DROP_QUEUE -
        base.files.length
    );
  const accepted =
    nonEmpty.slice(0, room);
  const rejected =
    invalid +
    Math.max(
      0,
      nonEmpty.length - accepted.length
    );

  if (
    accepted.length === 0 &&
    rejected === 0
  ) {
    return base;
  }

  return {
    files: [
      ...base.files,
      ...accepted
    ],
    total:
      base.total +
      accepted.length,
    completed:
      base.completed,
    rejected:
      base.rejected +
      rejected,
    ready: base.ready,
    stored: base.stored,
    skipped: base.skipped
  };
}

export function consumeDocumentDropFile(
  state: DocumentDropQueueState,
  outcome: DocumentDropOutcome = "READY"
): DocumentDropQueueState {
  if (state.files.length === 0) {
    return state;
  }
  return {
    ...state,
    files:
      state.files.slice(1),
    completed:
      Math.min(
        state.total,
        state.completed + 1
      ),
    ready: state.ready + (outcome === "READY" ? 1 : 0),
    stored: state.stored + (outcome === "STORED" ? 1 : 0),
    skipped: state.skipped + (outcome === "SKIPPED" ? 1 : 0)
  };
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  const word = count === 1 ? one : units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
  return `${count} ${word}`;
}

/** „Plik 2 z 3 · 1 gotowy do zapisania · 1 pominięty” — outcomes kept apart. */
export function documentDropSummary(state: DocumentDropQueueState): string {
  const parts = [
    state.files.length > 0
      ? `plik ${Math.min(state.completed + 1, state.total)} z ${state.total}`
      : `${plural(state.total, "plik", "pliki", "plików")} w kolejce`,
    state.ready ? plural(state.ready, "gotowy do zapisania", "gotowe do zapisania", "gotowych do zapisania") : "",
    state.stored ? plural(state.stored, "zapisany bez przetwarzania", "zapisane bez przetwarzania", "zapisanych bez przetwarzania") : "",
    state.skipped ? plural(state.skipped, "pominięty", "pominięte", "pominiętych") : ""
  ];
  return parts.filter(Boolean).join(" · ");
}

function formatBytes(
  bytes: number
): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(
      bytes / 1024
    ).toFixed(1)} KB`;
  }
  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

function fallbackType(
  file: File
): string {
  const extension =
    file.name
      .split(".")
      .pop()
      ?.trim()
      .toLowerCase();
  return extension
    ? `.${extension}`
    : "typ nieznany";
}

export function describeDocumentFile(
  file: File
): string {
  const type =
    file.type.trim() ||
    fallbackType(file);
  return `${formatBytes(
    file.size
  )} · ${type}`;
}

// What happens to the file now, named by its kind: OCR is mentioned only where a scan
// can need it (images, PDF), a text file is simply read.
export function documentStepLabel(file: File): string {
  const name = file.name.toLowerCase();
  if (/^image\//u.test(file.type) || /\.(?:jpe?g|png|webp|tiff?)$/u.test(name)) {
    return "Rozpoznanie tekstu ze zdjęcia (OCR) i ukrycie danych osobowych";
  }
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return "Odczyt PDF (OCR tylko dla skanowanych stron) i ukrycie danych osobowych";
  }
  if (file.type === "application/zip" || name.endsWith(".zip")) {
    return "Zapis archiwum w aktach sprawy";
  }
  return "Odczytaj i ukryj dane osobowe";
}
