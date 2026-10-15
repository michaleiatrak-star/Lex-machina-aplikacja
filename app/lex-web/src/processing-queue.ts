import type { DocumentProcessingMode } from "./document-processing-mode.js";

// The files of a case waiting for OCR and anonymization, processed one at a time in the
// order added. OCR of all queued files comes first, then their personal data (the local
// text model starts once), then the preview of each. Files can be added while it runs.
export type ProcessingQueueStatus =
  | "QUEUED" // waits for OCR
  | "READING" // OCR running
  | "READ" // read; waits for the personal data step
  | "DETECTING" // personal data being found
  | "READY" // waits for the user's preview
  | "FAILED";

export type ProcessingQueueEntry = {
  itemId: string;
  filename: string;
  mode: DocumentProcessingMode;
  status: ProcessingQueueStatus;
  error?: string;
};

const ACTIVE: ReadonlySet<ProcessingQueueStatus> = new Set(["QUEUED", "READING", "READ", "DETECTING"]);

export function isActiveEntry(entry: ProcessingQueueEntry): boolean {
  return ACTIVE.has(entry.status);
}

/** New files go to the end; a file already waiting keeps its place; a failed one is queued again. */
export function enqueueFiles(
  queue: readonly ProcessingQueueEntry[],
  files: ReadonlyArray<Pick<ProcessingQueueEntry, "itemId" | "filename" | "mode">>
): ProcessingQueueEntry[] {
  const next = queue.filter((entry) => !(entry.status === "FAILED" && files.some((file) => file.itemId === entry.itemId)));
  for (const file of files) {
    if (next.some((entry) => entry.itemId === file.itemId)) continue;
    next.push({ itemId: file.itemId, filename: file.filename, mode: file.mode, status: "QUEUED" });
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

export function nextToRead(queue: readonly ProcessingQueueEntry[]): ProcessingQueueEntry | undefined {
  return queue.find((entry) => entry.status === "QUEUED");
}

export function readEntries(queue: readonly ProcessingQueueEntry[]): ProcessingQueueEntry[] {
  return queue.filter((entry) => entry.status === "READ");
}

export type ProcessingQueueSummary = { waiting: number; running: number; ready: number; failed: number; total: number };

export function queueSummary(queue: readonly ProcessingQueueEntry[]): ProcessingQueueSummary {
  const count = (status: ProcessingQueueStatus) => queue.filter((entry) => entry.status === status).length;
  return {
    waiting: count("QUEUED") + count("READ"),
    running: count("READING") + count("DETECTING"),
    ready: count("READY"),
    failed: count("FAILED"),
    total: queue.length
  };
}

const LABELS: Record<ProcessingQueueStatus, string> = {
  QUEUED: "w kolejce do OCR",
  READING: "OCR…",
  READ: "odczytany, czeka na anonimizację",
  DETECTING: "wykrywanie danych osobowych…",
  READY: "gotowy - czeka na podgląd",
  FAILED: "błąd"
};

export function queueStatusLabel(entry: ProcessingQueueEntry, queue: readonly ProcessingQueueEntry[]): string {
  if (entry.status === "QUEUED") {
    const position = queue.filter((other) => other.status === "QUEUED").indexOf(entry) + 1;
    return `${LABELS.QUEUED} (${position}.)`;
  }
  return LABELS[entry.status];
}
