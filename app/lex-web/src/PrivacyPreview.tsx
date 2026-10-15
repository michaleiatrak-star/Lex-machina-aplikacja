import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  editDocumentPage,
  keepAllDirectives,
  type DocumentReviewResponse,
  type PagePrivacyDirective,
  type PiiKind
} from "./api.js";
import { PageScanView } from "./PageScanView.js";
import { KIND_LABEL } from "./PrivacyKeyTable.js";

/**
 * The preview every processed document passes before it is finalized: what to decide first
 * (doubtful OCR lines, matches the local AI read as no person, words the OCR correction
 * changed), then the text with the masks. A click on a mask leaves it in clear text, a
 * selection is masked. Automatic detection is the proposal; the user confirms it here.
 */
export type PrivacyPreviewRequest = {
  caseId: string;
  review: DocumentReviewResponse;
  fileName: string;
  // OCR only: nothing is masked, the preview checks the text.
  keepClear: boolean;
  // Runs the processing again without the local model's OCR corrections.
  onUndoOcrFixes?: () => void;
};

type Suggestion = DocumentReviewResponse["suggestions"][number];

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && a.end > b.start;

export function PrivacyPreview(props: PrivacyPreviewRequest & {
  busy?: boolean;
  // Decisions made earlier (back to a file in the batch preview).
  initialDirectives?: PagePrivacyDirective[];
  confirmLabel?: string;
  // The review is passed back: the user may have corrected page texts.
  onConfirm: (directives: PagePrivacyDirective[], review: DocumentReviewResponse) => void;
  onCancel: () => void;
  // The whole file in clear text, without anonymization (the user's explicit choice).
  onKeepClear?: (review: DocumentReviewResponse) => void;
}) {
  const [review, setReview] = useState(props.review);
  const [directives, setDirectives] = useState<PagePrivacyDirective[]>(props.initialDirectives ?? []);
  const [markAction, setMarkAction] = useState<"PSEUDONYMIZE" | "LABEL">("PSEUDONYMIZE");
  const [markLabel, setMarkLabel] = useState("");
  const [editing, setEditing] = useState<{ page: number; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<{ page: number; start: number; end: number } | null>(null);
  const [kind, setKind] = useState<PiiKind>("PERSON");
  const [error, setError] = useState("");
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  // Scanned pages: the original is shown next to the text, the page in view follows the text.
  const scanned = review.pages.some((page) => page.source === "OCR");
  const [scanPage, setScanPage] = useState(() => (review.pages.find((page) => page.source === "OCR") ?? review.pages[0])?.page ?? 1);
  const [scanFocus, setScanFocus] = useState<{ line: number } | { offset: number } | null>(null);
  const [scanRevision, setScanRevision] = useState(0);

  // The doubtful line selected in the page text when its correction opens.
  const [editLine, setEditLine] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const area = editRef.current;
    if (!area || !editLine) return;
    const at = area.value.indexOf(editLine);
    setEditLine(null);
    if (at < 0) return;
    area.focus();
    area.setSelectionRange(at, at + editLine.length);
    // Brings the selection into view: the share of the text before it, of the full height.
    area.scrollTop = Math.max(0, (at / Math.max(1, area.value.length)) * area.scrollHeight - area.clientHeight / 3);
  }, [editLine]);

  // While the text pane scrolls to a page on request, its scrolling does not move the scan.
  const jumpUntil = useRef(0);

  function showOnScan(page: number, focus: { line: number } | { offset: number } | null, scrollText = false): void {
    setScanPage(page);
    setScanFocus(focus);
    if (scrollText) {
      jumpUntil.current = Date.now() + 1200;
      pageRefs.current.get(page)?.closest("article")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // The page whose top is closest above the top of the text pane is the one being read.
  function followScroll(container: HTMLElement): void {
    if (editing || Date.now() < jumpUntil.current) return;
    const top = container.getBoundingClientRect().top + 40;
    let current = review.pages[0]?.page;
    for (const page of review.pages) {
      const element = pageRefs.current.get(page.page);
      if (element && element.getBoundingClientRect().top <= top) current = page.page;
    }
    if (current !== undefined && current !== scanPage) showOnScan(current, null);
  }

  const kept = (page: number, range: { start: number; end: number }) =>
    directives.some((item) => item.page === page && item.action === "KEEP" && overlaps(item, range));
  const aiHints = review.suggestions.filter((item) => item.aiNotPerson && !props.keepClear);
  const doubtful = review.pages.flatMap((page) => (page.review ?? []).map((line) => ({ page: page.page, line: line.line, text: line.text })));
  const fixes = review.pages.flatMap((page) => (page.corrections ?? []).map((fix) => ({ page: page.page, ...fix })));
  const masked = props.keepClear
    ? 0
    : review.suggestions.filter((item) => !kept(item.page, item)).length +
      directives.filter((item) => item.action !== "KEEP").length;
  const clear = directives.filter((item) => item.action === "KEEP").length;

  function toggleKeep(suggestion: Suggestion): void {
    setDirectives((current) =>
      kept(suggestion.page, suggestion)
        ? current.filter((item) => !(item.page === suggestion.page && item.action === "KEEP" && overlaps(item, suggestion)))
        : [...current, { page: suggestion.page, start: suggestion.start, end: suggestion.end, action: "KEEP" }]
    );
  }

  function captureSelection(page: number): void {
    const container = pageRefs.current.get(page);
    const selected = window.getSelection();
    if (!container || !selected || selected.rangeCount === 0) return;
    const range = selected.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = start + range.toString().length;
    // A click or a selection shows its line on the scan.
    if (scanned) showOnScan(page, { offset: start });
    if (end > start) setSelection({ page, start, end });
  }

  function maskSelection(): void {
    if (!selection) return;
    const label = markLabel.trim();
    if (markAction === "LABEL" && !label) {
      setError("Wpisz etykietę, którą zastąpić zaznaczony fragment.");
      return;
    }
    setError("");
    setDirectives((current) => [
      ...current,
      markAction === "LABEL"
        ? { ...selection, action: "LABEL", label }
        : { ...selection, action: "PSEUDONYMIZE", kind, ...(label ? { label } : {}) }
    ]);
    setSelection(null);
    setMarkLabel("");
    window.getSelection()?.removeAllRanges();
  }

  async function savePage(): Promise<void> {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const result = await editDocumentPage(props.caseId, review.documentId, editing.page, editing.text);
      setReview((current) => ({
        ...current,
        pages: current.pages.map((page) => (page.page === editing.page ? result.page : page)),
        suggestions: [...current.suggestions.filter((item) => item.page !== editing.page), ...result.suggestions]
      }));
      // Offsets of the old text no longer apply.
      setDirectives((current) => current.filter((item) => item.page !== editing.page));
      setEditing(null);
      setScanFocus(null);
      setScanRevision((value) => value + 1);
    } catch (failure) {
      setError(`Nie udało się zapisać tekstu strony: ${failure instanceof Error ? failure.message : String(failure)}`);
    } finally {
      setSaving(false);
    }
  }

  const pages = useMemo(
    () =>
      review.pages.map((page) => {
        // OCR only: the text as it will be sent, nothing masked.
        if (props.keepClear) return { page: page.page, parts: [page.text] as ReactNode[] };
        const marks = [
          ...review.suggestions.filter((item) => item.page === page.page).map((item) => ({ ...item, user: false })),
          ...directives
            .filter((item) => item.page === page.page && item.action !== "KEEP")
            .map((item) => ({
              page: item.page,
              start: item.start,
              end: item.end,
              kind: item.action === "LABEL" ? `Etykieta: ${item.label ?? ""}` : item.kind ?? "CUSTOM",
              user: true
            }))
        ].sort((a, b) => a.start - b.start || b.end - a.end);
        const parts: ReactNode[] = [];
        let at = 0;
        for (const mark of marks) {
          if (mark.start < at) continue;
          if (mark.start > at) parts.push(page.text.slice(at, mark.start));
          const text = page.text.slice(mark.start, mark.end);
          const open = !mark.user && kept(page.page, mark);
          parts.push(
            <mark
              key={`${mark.start}-${mark.end}`}
              className={`privacy-preview-mark${open ? " is-clear" : ""}${mark.user ? " is-user" : ""}${"aiNotPerson" in mark && mark.aiNotPerson ? " is-ai-hint" : ""}`}
              title={
                mark.user
                  ? `${KIND_LABEL[mark.kind] ?? mark.kind} - Twoje zaznaczenie; kliknij, aby cofnąć`
                  : open
                    ? "Zostanie jawne - kliknij, aby zakryć"
                    : `${KIND_LABEL[mark.kind] ?? mark.kind} - zostanie zakryte; kliknij, aby zostawić jawne`
              }
              onClick={() =>
                mark.user
                  ? setDirectives((current) =>
                      current.filter((item) => !(item.page === mark.page && item.start === mark.start && item.end === mark.end && item.action !== "KEEP"))
                    )
                  : toggleKeep(mark as Suggestion)
              }
            >
              {text}
            </mark>
          );
          at = mark.end;
        }
        if (at < page.text.length) parts.push(page.text.slice(at));
        return { page: page.page, parts };
      }),
    // kept() reads directives
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [review, directives, props.keepClear]
  );

  return (
    <section className={scanned ? "privacy-preview is-split" : "privacy-preview"} aria-label={`Podgląd przed zatwierdzeniem: ${props.fileName}`}>
      <header className="privacy-preview-head">
        <div>
          <strong>Podgląd przed zatwierdzeniem: {props.fileName}</strong>
          <small>
            {props.keepClear
              ? "Tekst bez anonimizacji - sprawdź odczyt, zanim trafi do modelu."
              : `Zakryte zostanie: ${masked} · zostawione jawne z Twojej decyzji: ${clear}. Kliknij zaznaczenie, aby zostawić je jawne; zaznacz tekst, aby go zakryć.`}
          </small>
        </div>
        <div className="privacy-preview-actions">
          {review.pages.length > 1 ? (
            <select
              id="privacy-preview-page-jump"
              aria-label="Przejdź do strony"
              value=""
              onChange={(event) => {
                showOnScan(Number(event.target.value), null, true);
              }}
            >
              <option value="">Przejdź do strony…</option>
              {review.pages.map((page) => (
                <option key={page.page} value={page.page}>s. {page.page}</option>
              ))}
            </select>
          ) : null}
          <button type="button" onClick={props.onCancel} disabled={props.busy}>
            Anuluj
          </button>
          {props.onKeepClear && !props.keepClear ? (
            <button
              type="button"
              disabled={props.busy || saving || editing !== null}
              title="Cały plik bez anonimizacji: do modelu trafi tekst jawny z danymi osobowymi"
              onClick={() => props.onKeepClear!(review)}
            >
              Bez anonimizacji
            </button>
          ) : null}
          <button
            type="button"
            className="primary-button"
            disabled={props.busy || saving || editing !== null}
            onClick={() => props.onConfirm(props.keepClear ? keepAllDirectives(review) : directives, review)}
          >
            {props.busy ? "Zatwierdzam…" : props.confirmLabel ?? "Zatwierdź"}
          </button>
        </div>
      </header>

      {aiHints.length || doubtful.length || fixes.length ? (
        <div className="privacy-preview-todo">
          <strong>Do decyzji</strong>
          {aiHints.length ? (
            <div>
              <small>Lokalne AI uznało te wykrycia za nie-osoby. Bez Twojej decyzji zostaną zakryte.</small>
              <ul>
                {aiHints.map((item) => (
                  <li key={`ai-${item.page}-${item.start}`}>
                    <span>
                      s. {item.page} · „{review.pages.find((page) => page.page === item.page)?.text.slice(item.start, item.end)}” · AI: {item.aiNotPerson}
                    </span>
                    <button type="button" onClick={() => toggleKeep(item)}>
                      {kept(item.page, item) ? "Zakryj z powrotem" : "Odkryj"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {doubtful.length ? (
            <div>
              <small>Odczyt niepewny (pismo odręczne, pieczątki, rozmazany druk): porównaj z oryginałem obok i popraw tekst strony.</small>
              <ul>
                {doubtful.map((line, index) => (
                  <li key={`ocr-${line.page}-${index}`}>
                    <span>s. {line.page} · „{line.text}”</span>
                    <span className="privacy-preview-todo-actions">
                      {scanned ? (
                        <button type="button" onClick={() => showOnScan(line.page, { line: line.line }, true)}>
                          Pokaż na skanie
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          if (scanned) showOnScan(line.page, { line: line.line });
                          setEditing({ page: line.page, text: review.pages.find((page) => page.page === line.page)?.text ?? "" });
                          setEditLine(line.text);
                        }}
                      >
                        Popraw tekst strony
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {fixes.length ? (
            <div>
              <small>Słowa poprawione po OCR (odstępy, ogonki, model wizyjny lub Bielik): {fixes.length}.</small>
              <ul>
                {fixes.slice(0, 50).map((fix, index) => (
                  <li key={`fix-${fix.page}-${index}`}>
                    <span>s. {fix.page} · „{fix.from}” → „{fix.to}”</span>
                    {scanned ? (
                      <button type="button" onClick={() => showOnScan(fix.page, { line: fix.line }, true)}>
                        Pokaż na skanie
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {props.onUndoOcrFixes ? (
                <button type="button" onClick={props.onUndoOcrFixes}>
                  Przetwórz ponownie bez korekt modelu
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!props.keepClear && selection ? (
        <div className="privacy-preview-selection">
          <span>„{review.pages.find((page) => page.page === selection.page)?.text.slice(selection.start, selection.end)}”</span>
          <select
            id="privacy-preview-action"
            aria-label="Co zrobić z zaznaczeniem"
            value={markAction}
            onChange={(event) => setMarkAction(event.target.value as "PSEUDONYMIZE" | "LABEL")}
          >
            <option value="PSEUDONYMIZE">Zakryj symbolem</option>
            <option value="LABEL">Zastąp etykietą</option>
          </select>
          {markAction === "PSEUDONYMIZE" ? (
            <select id="privacy-preview-kind" aria-label="Rodzaj danych" value={kind} onChange={(event) => setKind(event.target.value as PiiKind)}>
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          ) : null}
          <input
            id="privacy-preview-label"
            aria-label="Etykieta"
            placeholder={markAction === "LABEL" ? "np. POWÓD" : "Własna etykieta (opcjonalnie)"}
            value={markLabel}
            onChange={(event) => setMarkLabel(event.target.value)}
          />
          <button type="button" onClick={maskSelection}>
            {markAction === "LABEL" ? "Zastąp etykietą" : "Zakryj zaznaczenie"}
          </button>
        </div>
      ) : null}

      <div className={scanned ? "privacy-preview-split" : "privacy-preview-body"}>
        {scanned ? (
          <PageScanView
            caseId={props.caseId}
            documentId={review.documentId}
            page={editing?.page ?? scanPage}
            focus={scanFocus}
            text={review.pages.find((page) => page.page === (editing?.page ?? scanPage))?.text ?? ""}
            revision={scanRevision}
            ocr={review.pages.find((page) => page.page === (editing?.page ?? scanPage))?.source === "OCR"}
          />
        ) : null}
        <div className="privacy-preview-work">
          {editing ? (
            <div className="privacy-preview-edit">
              <strong>Tekst strony {editing.page}</strong>
              <textarea
                id="privacy-preview-page-text"
                ref={editRef}
                lang="pl"
                onSelect={scanned ? (event) => setScanFocus({ offset: event.currentTarget.selectionStart }) : undefined}
                aria-label={`Tekst strony ${editing.page}`}
                value={editing.text}
                onChange={(event) => setEditing({ ...editing, text: event.target.value })}
                rows={scanned ? 26 : 14}
              />
              <div className="privacy-preview-actions">
                <button type="button" onClick={() => setEditing(null)} disabled={saving}>
                  Anuluj poprawkę
                </button>
                <button type="button" className="primary-button" onClick={() => void savePage()} disabled={saving}>
                  {saving ? "Zapisuję…" : "Zapisz tekst strony"}
                </button>
              </div>
            </div>
          ) : null}
          {editing && scanned ? null : (
            <div className="privacy-preview-pages" onScroll={scanned ? (event) => followScroll(event.currentTarget) : undefined}>
              {pages.map((page) => (
                <article key={page.page}>
                  <small>s. {page.page}</small>
                  <div
                    className="privacy-preview-text"
                    ref={(element) => {
                      if (element) pageRefs.current.set(page.page, element);
                    }}
                    onMouseUp={() => captureSelection(page.page)}
                  >
                    {page.parts}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}
