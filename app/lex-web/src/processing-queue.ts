import type { DocumentProcessingMode } from "./document-processing-mode.js";

// The files of a case: every added PDF or image is read (OCR) in the background, one at a
// time in the order added, without waiting for the user. Only after the user chooses the way
// and confirms a file ("Przetwórz") does its correction and personal data step run; that file
// goes first (the runtime pauses the background OCR after the page it reads), and once it is
// done the background OCR of the rest goes on.
export type ProcessingQueueStatus =
  | "QUEUED" // waits for OCR
  | "READING" // OCR running
  | "READ" // read; waits for the user's choice, or (approved) for its turn
  | "DETECTING" // correction and personal data, after the user's choice
  | "READY" // waits for the user's preview
  | "FAILED";

export type ProcessingQueueEntry = {
  itemId: string;
  filename: string;
  mode: DocumentProcessingMode;
  // Chosen and confirmed by the user; until then the file is only read.
  approved: boolean;
  status: ProcessingQueueStatus;
  error?: string;
};

type QueuedFile = Pick<ProcessingQueueEntry, "itemId" | "filename" | "mode"> & { approved?: boolean };

const ACTIVE: ReadonlySet<ProcessingQueueStatus> = new Set(["QUEUED", "READING", "READ", "DETECTING"]);

export function isActiveEntry(entry: ProcessingQueueEntry): boolean {
  return ACTIVE.has(entry.status);
}

/** Waiting for OCR, being read or read, and not chosen yet: the user may choose and confirm. */
export function awaitsChoice(entry: ProcessingQueueEntry): boolean {
  return !entry.approved && (entry.status === "QUEUED" || entry.status === "READING" || entry.status === "READ");
}

/**
 * New files go to the end; a file already waiting keeps its place (confirmed, it takes the
 * chosen way); a failed one is queued again.
 */
export function enqueueFiles(
  queue: readonly ProcessingQueueEntry[],
  files: readonly QueuedFile[]
): ProcessingQueueEntry[] {
  const next = queue
    .filter((entry) => !(entry.status === "FAILED" && files.some((file) => file.itemId === entry.itemId)))
    .map((entry) => {
      const file = files.find((item) => item.itemId === entry.itemId);
      return file?.approved && awaitsChoice(entry) ? { ...entry, mode: file.mode, approved: true } : entry;
    });
  for (const file of files) {
    if (next.some((entry) => entry.itemId === file.itemId)) continue;
    next.push({ itemId: file.itemId, filename: file.filename, mode: file.mode, approved: file.approved === true, status: "QUEUED" });
  }
  return next;
}

export function updateEntry(
  queue: readonly ProcessingQueueEntry[],
  itemId: string,
  patch: Partial<Pick<ProcessingQueueEntry, "status" | "error">>
): ProcessingQueueEntry[] {
  return queue.map((entry) => (entry.itemId === itemId ? { ...entry, ...patch } : entry));
}

/** Only a file still waiting for OCR can leave the queue; the one being read finishes. */
export function removeQueued(queue: readonly ProcessingQueueEntry[], itemId: string): ProcessingQueueEntry[] {
  return queue.filter((entry) => !(entry.itemId === itemId && entry.status === "QUEUED"));
}

/** "Zatrzymaj": the files waiting for OCR leave; the one being read and those read go on. */
export function stopQueued(queue: readonly ProcessingQueueEntry[]): ProcessingQueueEntry[] {
  return queue.filter((entry) => entry.status !== "QUEUED");
}

/** Finished entries (waiting for preview, failed) leave the list; the active ones stay. */
export function clearFinished(queue: readonly ProcessingQueueEntry[]): ProcessingQueueEntry[] {
  return queue.filter(isActiveEntry);
}

/** A file the user confirmed is read first. */
export function nextToRead(queue: readonly ProcessingQueueEntry[]): ProcessingQueueEntry | undefined {
  return (
    queue.find((entry) => entry.status === "QUEUED" && entry.approved) ??
    queue.find((entry) => entry.status === "QUEUED")
  );
}

/** Read and confirmed by the user: waits for its correction and personal data step. */
export function nextApproved(queue: readonly ProcessingQueueEntry[]): ProcessingQueueEntry | undefined {
  return queue.find((entry) => entry.status === "READ" && entry.approved);
}

export type ProcessingQueueSummary = {
  waiting: number;
  running: number;
  toChoose: number;
  ready: number;
  failed: number;
  total: number;
};

export function queueSummary(queue: readonly ProcessingQueueEntry[]): ProcessingQueueSummary {
  const count = (test: (entry: ProcessingQueueEntry) => boolean) => queue.filter(test).length;
  return {
    waiting: count((entry) => entry.status === "QUEUED" || (entry.status === "READ" && entry.approved)),
    running: count((entry) => entry.status === "READING" || entry.status === "DETECTING"),
    toChoose: count((entry) => entry.status === "READ" && !entry.approved),
    ready: count((entry) => entry.status === "READY"),
    failed: count((entry) => entry.status === "FAILED"),
    total: queue.length
  };
}

const LABELS: Record<ProcessingQueueStatus, string> = {
  QUEUED: "w kolejce do OCR",
  READING: "OCR w tle…",
  READ: "odczytany - wybierz sposób i kliknij „Przetwórz”",
  DETECTING: "korekta i wykrywanie danych osobowych…",
  READY: "gotowy - czeka na podgląd",
  FAILED: "błąd"
};

export function queueStatusLabel(entry: ProcessingQueueEntry, queue: readonly ProcessingQueueEntry[]): string {
  if (entry.status === "QUEUED") {
    if (entry.approved) return "zatwierdzony - OCR w pierwszej kolejności";
    const position = queue.filter((other) => other.status === "QUEUED").indexOf(entry) + 1;
    return `${LABELS.QUEUED} (${position}.)`;
  }
  if (entry.status === "READING" && entry.approved) return "OCR (zatwierdzony)…";
  if (entry.status === "READ" && entry.approved) return "zatwierdzony - czeka na korektę";
  return LABELS[entry.status];
}
