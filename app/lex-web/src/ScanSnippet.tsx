import { useEffect, useState } from "react";
import type { DocumentPageScan } from "./api.js";
import { loadPageScan } from "./page-scan-cache.js";

/**
 * The fragment of the scan holding one OCR line, in a bubble next to its correction: the user
 * compares the reading with the original where it is typed, without looking for it on the page.
 */
export function ScanSnippet(props: { caseId: string; documentId: string; page: number; line: number; revision?: number; onClose: () => void }) {
  const [scan, setScan] = useState<DocumentPageScan | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setScan(undefined);
    loadPageScan(props.caseId, props.documentId, props.page, props.revision).then(
      (result) => active && setScan(result),
      () => active && setScan(null)
    );
    return () => {
      active = false;
    };
  }, [props.caseId, props.documentId, props.page, props.revision]);

  const box = scan?.lines[props.line]?.box ?? null;
  let body;
  if (scan === undefined) body = <small>Wczytuję fragment skanu…</small>;
  else if (!scan || !box) body = <small>Brak ramki tej linii na skanie: porównaj w podglądzie strony obok.</small>;
  else {
    // The line with a margin of half its height (a word cut on the edge is still readable).
    const margin = Math.max(6, (box[3] - box[1]) / 2);
    const left = Math.max(0, box[0] - margin);
    const top = Math.max(0, box[1] - margin);
    const width = Math.min(scan.width, box[2] + margin) - left;
    const height = Math.min(scan.height, box[3] + margin) - top;
    body = (
      <svg
        className="scan-snippet-image"
        viewBox={`${left} ${top} ${width} ${height}`}
        style={{ aspectRatio: `${width} / ${height}` }}
        role="img"
        aria-label={`Fragment skanu strony ${props.page}`}
      >
        <image href={`data:${scan.mediaType};base64,${scan.data}`} x={0} y={0} width={scan.width} height={scan.height} />
      </svg>
    );
  }
  return (
    <div className="scan-snippet" role="dialog" aria-label={`Fragment skanu, s. ${props.page}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      {body}
      <button type="button" className="scan-snippet-close" aria-label="Zamknij fragment skanu" onClick={props.onClose}>
        ×
      </button>
    </div>
  );
}
