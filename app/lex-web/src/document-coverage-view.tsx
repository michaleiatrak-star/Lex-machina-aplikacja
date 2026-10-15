import type { DocumentCoverageEntry } from "./api.js";

type Range = [number, number];

function merge(ranges: readonly Range[]): Range[] {
  const sorted = ranges.map(([a, b]) => [a, b] as Range).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else out.push(range);
  }
  return out;
}

function missing(total: number, ranges: readonly Range[]): Range[] {
  const gaps: Range[] = [];
  let next = 1;
  for (const [start, end] of merge(ranges)) {
    if (start > next) gaps.push([next, Math.min(start - 1, total)]);
    next = Math.max(next, end + 1);
  }
  if (next <= total) gaps.push([next, total]);
  return gaps;
}

export function formatRanges(ranges: readonly Range[]): string {
  return ranges.map(([start, end]) => (start === end ? `${start}` : `${start}–${end}`)).join(", ");
}

export type UnfinishedDocument = { documentId: string; title?: string; totalPages: number; read: Range[]; missing: Range[] };

/**
 * Documents an analysis in this thread read only in part: the pages of all answers summed up,
 * so a later turn that reads the rest closes the work.
 */
export function unfinishedDocuments(
  messages: ReadonlyArray<{ documentCoverage?: DocumentCoverageEntry[]; documentAnalysis?: boolean }>
): UnfinishedDocument[] {
  const all = new Map<string, { title?: string; totalPages: number; ranges: Range[]; analysed: boolean }>();
  for (const message of messages) {
    for (const entry of message.documentCoverage ?? []) {
      const item = all.get(entry.documentId) ?? { totalPages: entry.totalPages, ranges: [], analysed: false };
      item.totalPages = Math.max(item.totalPages, entry.totalPages);
      if (entry.title && !item.title) item.title = entry.title;
      item.ranges.push(...entry.pages);
      item.analysed ||= message.documentAnalysis === true;
      all.set(entry.documentId, item);
    }
  }
  return [...all.entries()]
    .filter(([, item]) => item.analysed)
    .map(([documentId, item]) => ({
      documentId,
      ...(item.title ? { title: item.title } : {}),
      totalPages: item.totalPages,
      read: merge(item.ranges),
      missing: missing(item.totalPages, item.ranges)
    }))
    .filter((item) => item.missing.length > 0);
}

/** The request sent by "Dokończ analizę": the pages left, without going over the read ones. */
export function finishAnalysisMessage(name: string, item: UnfinishedDocument): string {
  return (
    `Dokończ analizę dokumentu „${name}”: przeczytaj nieprzeczytane strony ${formatRanges(item.missing)} z ${item.totalPages} ` +
    `(read_case_file, kolejne fragmenty) i uzupełnij wcześniejszy wynik. Nie powtarzaj stron już omówionych (${formatRanges(item.read)}).`
  );
}

/** Under an answer: which pages of each document it rests on. */
export function CoverageLine({ entries, label }: { entries: DocumentCoverageEntry[]; label: (entry: DocumentCoverageEntry) => string }) {
  return (
    <small className="chat-coverage-line">
      Przeczytane:{" "}
      {entries
        .map((entry) =>
          entry.status === "FULL"
            ? `${label(entry)} w całości (${entry.totalPages} s.)`
            : `${label(entry)} częściowo: s. ${formatRanges(entry.pages)} z ${entry.totalPages}`
        )
        .join("; ")}
    </small>
  );
}

/** Above the input: the analysis is not closed while pages of a document are unread. */
export function UnfinishedAnalysis({
  items,
  label,
  disabled,
  onFinish
}: {
  items: UnfinishedDocument[];
  label: (item: UnfinishedDocument) => string;
  disabled: boolean;
  onFinish: (text: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="chat-unfinished-analysis" role="status">
      <strong>Analiza niedokończona: praca nad dokumentem nie jest zamknięta</strong>
      <ul>
        {items.map((item) => (
          <li key={item.documentId}>
            <span>
              {label(item)}: przeczytane s. {formatRanges(item.read)} z {item.totalPages}; nieprzeczytane s. {formatRanges(item.missing)}
            </span>
            <button type="button" className="chat-secondary-action" disabled={disabled} onClick={() => onFinish(finishAnalysisMessage(label(item), item))}>
              Dokończ analizę
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
