import { getDocumentPageScan, type DocumentPageScan } from "./api.js";

// Line frames as first read. A hand-corrected page comes back without them, but the image and
// the place of each line do not change: the bubble and the frame on the scan still show it.
const firstLines = new Map<string, DocumentPageScan["lines"]>();

export function withRememberedLines(documentId: string, page: number, scan: DocumentPageScan | null): DocumentPageScan | null {
  if (!scan) return scan;
  const key = `${documentId}:${page}`;
  if (scan.lines.length) {
    if (!firstLines.has(key)) firstLines.set(key, scan.lines);
    return scan;
  }
  const earlier = firstLines.get(key);
  return earlier ? { ...scan, lines: earlier } : scan;
}

const loads = new Map<string, Promise<DocumentPageScan | null>>();

/** One request per page and text revision, shared by the scan pane and the bubbles. */
export function loadPageScan(caseId: string, documentId: string, page: number, revision = 0): Promise<DocumentPageScan | null> {
  const key = `${documentId}:${page}:${revision}`;
  let load = loads.get(key);
  if (!load) {
    load = getDocumentPageScan(caseId, documentId, page).then((scan) => withRememberedLines(documentId, page, scan));
    load.catch(() => loads.delete(key));
    loads.set(key, load);
  }
  return load;
}
