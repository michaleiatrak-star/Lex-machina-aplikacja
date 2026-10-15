// Which pages of each case document the model actually read in a turn: the chunks sent with
// the message and the ones it read with read_case_file. A document read in part is not a
// finished analysis; the chat says so and offers to read the rest.
export function mergeRanges(ranges) {
    const sorted = ranges
        .filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start)
        .map(([start, end]) => [start, end])
        .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const range of sorted) {
        const last = merged.at(-1);
        if (last && range[0] <= last[1] + 1)
            last[1] = Math.max(last[1], range[1]);
        else
            merged.push(range);
    }
    return merged;
}
/** Pages of 1..total not in the ranges. */
export function missingPages(total, ranges) {
    const missing = [];
    let next = 1;
    for (const [start, end] of mergeRanges(ranges)) {
        if (start > next)
            missing.push([next, Math.min(start - 1, total)]);
        next = Math.max(next, end + 1);
    }
    if (next <= total)
        missing.push([next, total]);
    return missing.filter(([start, end]) => start <= end);
}
/** Per document: the pages read across all sources of the turn (or the thread). */
export function documentCoverage(reads) {
    const byDocument = new Map();
    for (const read of reads) {
        const total = read.totalPages ?? 0;
        if (!Number.isInteger(total) || total < 1)
            continue;
        const entry = byDocument.get(read.documentId) ?? { totalPages: total, ranges: [] };
        entry.totalPages = Math.max(entry.totalPages, total);
        if (read.title && !entry.title)
            entry.title = read.title;
        for (const chunk of read.chunks)
            entry.ranges.push([chunk.pageStart, Math.min(chunk.pageEnd, entry.totalPages)]);
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
