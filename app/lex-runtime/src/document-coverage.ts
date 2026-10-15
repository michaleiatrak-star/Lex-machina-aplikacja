// Which pages of each case document the model actually read in a turn: the chunks sent with
// the message and the ones it read with read_case_file. A document read in part is not a
// finished analysis; the chat says so and offers to read the rest.

export type PageRange = [number, number];

export type DocumentCoverage = {
  documentId: string;
  title?: string;
  totalPages: number;
  // Pages read in full, merged ranges (1-based, inclusive).
  pages: PageRange[];
  status: "FULL" | "PARTIAL";
};

type Read = { documentId: string; title?: string; totalPages?: number; chunks: Array<{ pageStart: number; pageEnd: number }> };

export function mergeRanges(ranges: readonly PageRange[]): PageRange[] {
  const sorted = ranges
    .filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start)
    .map(([start, end]) => [start, end] as PageRange)
    .sort((a, b) => a[0] - b[0]);
  const merged: PageRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

/** Pages of 1..total not in the ranges. */
export function missingPages(total: number, ranges: readonly PageRange[]): PageRange[] {
  const missing: PageRange[] = [];
  let next = 1;
  for (const [start, end] of mergeRanges(ranges)) {
    if (start > next) missing.push([next, Math.min(start - 1, total)]);
    next = Math.max(next, end + 1);
  }
  if (next <= total) missing.push([next, total]);
  return missing.filter(([start, end]) => start <= end);
}

/** Per document: the pages read across all sources of the turn (or the thread). */
export function documentCoverage(reads: readonly Read[]): DocumentCoverage[] {
  const byDocument = new Map<string, { title?: string; totalPages: number; ranges: PageRange[] }>();
  for (const read of reads) {
    const total = read.totalPages ?? 0;
    if (!Number.isInteger(total) || total < 1) continue;
    const entry = byDocument.get(read.documentId) ?? { totalPages: total, ranges: [] };
    entry.totalPages = Math.max(entry.totalPages, total);
    if (read.title && !entry.title) entry.title = read.title;
    for (const chunk of read.chunks) entry.ranges.push([chunk.pageStart, Math.min(chunk.pageEnd, entry.totalPages)]);
    byDocument.set(read.documentId, entry);
  }
  return [...byDocument.entries()].map(([documentId, entry]) => {
    const pages = mergeRanges(entry.ranges);
    return {
      documentId,
      ...(entry.title ? { title: entry.title } : {}),
      totalPages: entry.totalPages,
      pages,
      status: missingPages(entry.totalPages, pages).length ? "PARTIAL" : "FULL"
    };
  });
}
