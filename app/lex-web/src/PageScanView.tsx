import { useEffect, useRef, useState } from "react";
import { getDocumentPageScan, type DocumentPageScan } from "./api.js";

/**
 * The scan of one page next to its text in the preview: the user compares the reading with
 * the original instead of guessing. The focused OCR line is framed and scrolled into view.
 */
export function PageScanView(props: {
  caseId: string;
  documentId: string;
  page: number;
  // What to frame: an OCR line by index (doubtful line, corrected word) or the line holding
  // a character offset of the page text (a click in the text).
  focus: { line: number } | { offset: number } | null;
  text: string;
  // Bumped by the parent when the page text changes (hand correction): load again.
  revision?: number;
  // The page text comes from OCR: a missing image is then not "read exactly".
  ocr?: boolean;
}) {
  const cache = useRef(new Map<string, DocumentPageScan | null>());
  const [scan, setScan] = useState<DocumentPageScan | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const focusRef = useRef<HTMLDivElement | null>(null);
  const key = `${props.documentId}:${props.page}:${props.revision ?? 0}`;

  useEffect(() => {
    let active = true;
    setError("");
    if (cache.current.has(key)) {
      setScan(cache.current.get(key)!);
      return;
    }
    setScan(undefined);
    getDocumentPageScan(props.caseId, props.documentId, props.page).then(
      (result) => {
        cache.current.set(key, result);
        if (active) setScan(result);
      },
      (failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : String(failure));
      }
    );
    return () => {
      active = false;
    };
  }, [key, props.caseId, props.documentId, props.page]);

  const focusLine = scan && props.focus ? ("line" in props.focus ? props.focus.line : lineAt(scan.lines, props.text, props.focus.offset)) : null;
  const box = scan && focusLine !== null ? scan.lines[focusLine]?.box ?? null : null;

  useEffect(() => {
    focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }, [box, zoom]);

  return (
    <div className="page-scan" aria-label={`Skan strony ${props.page}`}>
      <div className="page-scan-head">
        <strong>Oryginał · s. {props.page}</strong>
        <div className="page-scan-zoom" role="group" aria-label="Powiększenie skanu">
          {[1, 1.5, 2.5].map((value) => (
            <button key={value} type="button" aria-pressed={zoom === value} onClick={() => setZoom(value)}>
              {value === 1 ? "Cała strona" : `${value * 100}%`}
            </button>
          ))}
        </div>
      </div>
      <div className="page-scan-viewport">
        {error ? (
          <p className="field-error">Nie udało się wczytać skanu: {error}</p>
        ) : scan === undefined ? (
          <p className="page-scan-empty">Wczytuję skan…</p>
        ) : scan === null ? (
          <p className="page-scan-empty">
            {props.ocr
              ? "Obraz tej strony nie został zachowany (limit rozmiaru obrazów dokumentu). Porównaj tekst z oryginałem pliku."
              : "Ta strona nie ma skanu: tekst pochodzi z warstwy tekstowej pliku i jest odczytany dokładnie."}
          </p>
        ) : (
          <div className="page-scan-sheet" style={{ width: `${zoom * 100}%` }}>
            <img src={`data:${scan.mediaType};base64,${scan.data}`} alt={`Skan strony ${props.page}`} draggable={false} />
            {box ? (
              <div
                ref={focusRef}
                className="page-scan-focus"
                style={{
                  left: `${(box[0] / scan.width) * 100}%`,
                  top: `${(box[1] / scan.height) * 100}%`,
                  width: `${((box[2] - box[0]) / scan.width) * 100}%`,
                  height: `${((box[3] - box[1]) / scan.height) * 100}%`
                }}
              />
            ) : null}
          </div>
        )}
      </div>
      {scan && props.focus && "line" in props.focus && !box ? (
        <small className="page-scan-note">
          {scan.lines.length ? "Ta linia nie ma ramki na skanie." : "Tekst strony poprawiony ręcznie: linie nie są już zaznaczane na skanie."}
        </small>
      ) : null}
    </div>
  );
}

/** The OCR line holding a character of the page text: the lines follow each other in the text. */
export function lineAt(lines: ReadonlyArray<{ text: string }>, text: string, offset: number): number | null {
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const at = text.indexOf(lines[index]!.text, cursor);
    // A line changed by hand is skipped; the ones after it are still found.
    if (at < 0) continue;
    if (offset >= at && offset <= at + lines[index]!.text.length) return index;
    cursor = at + lines[index]!.text.length;
  }
  return null;
}
