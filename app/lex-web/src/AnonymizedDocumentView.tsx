import { t } from "./i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  addToAnonymization,
  anonymizedDocx,
  approveAnonymizedVersion,
  editAnonymizedText,
  getAnonymizedVersion,
  removeFromAnonymization,
  updateAnonymizationForms,
  updateAnonymizationGrammar,
  type AnonymizedVersion,
  type KeyGrammar,
  type PiiKind,
  type PrivacyKeyEntry
} from "./api.js";
import { KIND_LABEL, PrivacyKeyTable } from "./PrivacyKeyTable.js";
import { modelExportFilename, modelExportText } from "./model-export.js";
import { downloadBlob } from "./download-file.js";

const DOCX_ERRORS: Record<string, string> = {
  DOCX_ANONYMIZED_SOURCE_CHANGED: t("Plik przetworzono starszą wersją aplikacji (bez przypisów, nagłówków i komentarzy). Przetwórz go ponownie, potem pobierz .docx."),
  DOCX_ANONYMIZED_ALIGNMENT_FAILED: t("Wersji zanonimizowanej nie da się dopasować do pliku. Przetwórz plik ponownie."),
  DOCX_ANONYMIZED_TEXT_MISMATCH: t("Kontrola zgodności nie przeszła - plik nie został wydany."),
  DOCX_ANONYMIZED_LEAK: t("Kontrola szczelności znalazła dane poza tekstem (pole, łącze, właściwości) - plik nie został wydany."),
  DOCX_ANONYMIZED_UNSUPPORTED: t("Ten dokument nie ma jednej strony tekstu Word - .docx niedostępny.")
};

function docxErrorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error);
  return DOCX_ERRORS[code] ?? `Nie udało się utworzyć .docx: ${code}`;
}
import { InfoTip } from "./InfoTip";

const TOKEN = /(\[PII:[A-Z_]+:\d{4}(?:\|[A-Z]{2,4})?\])/;
const PAGE_HEADER = /\[STRONA (\d+)(?: · CZĘŚĆ (\d+)\/(\d+))? · [A-Z]+\]\n?/g;

/** Stored page headers as visible page boundaries ("Strona 3 z 12"). */
function withPages(text: string, totalPages: number, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PAGE_HEADER)) {
    if (match.index! > cursor) out.push(<span key={`${key}-${cursor}`}>{text.slice(cursor, match.index)}</span>);
    const part = match[2] && match[2] !== "1" ? t(" (ciąg dalszy)") : "";
    out.push(
      <span key={`${key}-p${match.index}`} className="anonymized-page">
        {t("Strona")} {match[1]} z {totalPages}{part}
      </span>
    );
    cursor = match.index! + match[0].length;
  }
  if (cursor < text.length) out.push(<span key={`${key}-${cursor}`}>{text.slice(cursor)}</span>);
  return out;
}

function renderProtected(text: string, totalPages: number, onToken: (token: string) => void): ReactNode[] {
  return text.split(TOKEN).map((part, index) =>
    index % 2 === 1 ? (
      <button
        key={index}
        type="button"
        className="anonymized-token"
        title={t("Pokaż w kluczu")}
        onClick={() => onToken(part.replace(/\|[A-Z]{2,4}\]$/, "]"))}
      >
        {part}
      </button>
    ) : (
      <span key={index}>{withPages(part, totalPages, `s${index}`)}</span>
    )
  );
}

function renderMarked(
  text: string,
  marks: Array<{ start: number; end: number; token: string; kind: string }>,
  totalPages: number,
  onToken: (token: string) => void
): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  marks.forEach((mark, index) => {
    if (mark.start > cursor) {
      out.push(<span key={`t${index}`}>{withPages(text.slice(cursor, mark.start), totalPages, `t${index}`)}</span>);
    }
    out.push(
      <mark
        key={`m${index}`}
        className={`anonymized-mark anonymized-${mark.kind.toLowerCase()}`}
        title={`${KIND_LABEL[mark.kind] ?? mark.kind} → ${mark.token}`}
        role="button"
        tabIndex={0}
        onClick={() => onToken(mark.token)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onToken(mark.token);
        }}
      >
        {text.slice(mark.start, mark.end)}
      </mark>
    );
    cursor = mark.end;
  });
  out.push(<span key="tail">{withPages(text.slice(cursor), totalPages, "tail")}</span>);
  return out;
}

/**
 * The anonymized version of a case document next to its key. Selecting text
 * adds it to the anonymization; the key lets the user correct case forms or
 * take a value out. Every change saves the version and the key together.
 */
export function AnonymizedDocumentView(props: {
  caseId: string;
  documentId: string;
  filename: string;
  // The stored file behind the document: a .docx can be downloaded anonymized as .docx.
  uploadId?: string;
  readOnly: boolean;
  initialTab?: "marked" | "text" | "key";
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [version, setVersion] = useState<AnonymizedVersion | null>(null);
  const [tab, setTab] = useState<"marked" | "text" | "key">(props.initialTab ?? "marked");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [editingChunk, setEditingChunk] = useState<{ index: number; text: string } | null>(null);
  const [selection, setSelection] = useState("");
  const [kind, setKind] = useState<PiiKind>("PERSON");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // Legend and key first, then the text: for a model outside Lex Machina.
  const exportText = (): string =>
    version
      ? modelExportText({
          filename: props.filename,
          modelKey: version.modelKey ?? null,
          totalPages: version.totalPages,
          chunks: version.chunks
        })
      : "";
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setVersion(null);
    getAnonymizedVersion(props.caseId, props.documentId)
      .then((next) => {
        if (!cancelled) setVersion(next);
      })
      .catch((failure) => {
        if (!cancelled) setStatus(t("Nie udało się wczytać: {failure}", { failure: failure instanceof Error ? failure.message : String(failure) }));
      });
    return () => {
      cancelled = true;
    };
  }, [props.caseId, props.documentId]);

  async function apply(action: () => Promise<AnonymizedVersion>, done: (next: AnonymizedVersion) => string): Promise<void> {
    setBusy(true);
    setStatus("");
    try {
      const next = await action();
      setVersion(next);
      setStatus(done(next));
      props.onChanged?.();
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : String(failure);
      setStatus(
        code === "PRIVACY_EDIT_TEXT_NOT_FOUND"
          ? t("Tego tekstu nie ma w wersji zanonimizowanej (może już jest zastąpiony symbolem).")
          : code === "PRIVACY_EDIT_UNKNOWN_TOKEN"
            ? t("Poprawka zawiera symbol, którego nie ma w kluczu tego dokumentu (np. zmieniony numer). Przywróć symbol w pierwotnej postaci.")
          : t("Nie udało się zapisać: {code}", { code: code })
      );
    } finally {
      setBusy(false);
    }
  }

  function captureSelection(): void {
    const selected = window.getSelection();
    const container = textRef.current;
    if (!selected || !container || selected.rangeCount === 0) return;
    if (!container.contains(selected.anchorNode) || !container.contains(selected.focusNode)) return;
    const text = selected.toString().replace(/\s+/g, " ").trim();
    if (text && !/[[\]]/.test(text)) setSelection(text.slice(0, 300));
  }

  function protect(): void {
    const text = selection.trim();
    if (!text) return;
    void apply(
      () => addToAnonymization(props.caseId, props.documentId, text, kind),
      (next) => {
        const added = next as AnonymizedVersion & { token: string; replaced: number };
        setSelection("");
        setHighlight(added.token);
        return t("Zanonimizowano jako {token} (wystąpienia: {replaced}). Klucz zaktualizowano.", { token: added.token, replaced: added.replaced });
      }
    );
  }

  function remove(entry: PrivacyKeyEntry): void {
    if (!window.confirm(t("Przywrócić jawną wartość w miejsce {token} i usunąć symbol z klucza?", { token: entry.token }))) return;
    void apply(
      () => removeFromAnonymization(props.caseId, props.documentId, entry.token),
      (next) =>
        t("Przywrócono jawną wartość (wystąpienia: {restored})", { restored: (next as AnonymizedVersion & { restored: number }).restored }) +
        (entry.forms ? t(" w mianowniku - sprawdź odmianę w tekście.") : ".")
    );
  }

  function saveForms(entry: PrivacyKeyEntry, forms: Record<string, string>): void {
    if (!Object.keys(forms).length) return;
    void apply(
      () => updateAnonymizationForms(props.caseId, props.documentId, entry.token, forms),
      () => t("Zapisano formy dla {token}; będą użyte przy przywracaniu danych.", { token: entry.token })
    );
  }

  function saveGrammar(entry: PrivacyKeyEntry, grammar: KeyGrammar): void {
    void apply(
      () => updateAnonymizationGrammar(props.caseId, props.documentId, entry.token, grammar),
      () => t("Zapisano, kim jest {token}; model dostanie to w kluczu, a odmiana przy przywracaniu się zmieniła.", { token: entry.token })
    );
  }

  return (
    <section className="workspace-preview anonymized-view" aria-label={t("Wersja zanonimizowana")}>
      <div className="workspace-preview-head">
        <div>
          <strong>{t("Wersja zanonimizowana:")} {props.filename}</strong>
          <InfoTip>{t("Powiązana z oryginałem i kluczem anonimizacji. Tylko tę wersję widzą modele.")}</InfoTip>
          <small>{props.documentId}</small>
        </div>
        <div>
          <div className="text-editor-modes" role="group" aria-label={t("Widok")}>
            <button type="button" aria-pressed={tab === "marked"} onClick={() => setTab("marked")}>{t("Zaznaczenia w tekście")}</button>
            <button type="button" aria-pressed={tab === "text"} onClick={() => setTab("text")}>{t("Wersja dla modelu")}</button>
            <button type="button" aria-pressed={tab === "key"} onClick={() => setTab("key")}>
              {t("Klucz (")}{version?.entries.length ?? 0})
            </button>
          </div>
          {version ? (
            <>
              <button
                type="button"
                title={t("Legenda, klucz symboli i tekst ze stronami - do wklejenia w zewnętrzny czat, bez danych osobowych")}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(exportText())
                    .then(() => setStatus(t("Skopiowano wersję dla modelu z legendą i kluczem.")))
                    .catch(() => setStatus(t("Nie udało się skopiować - użyj „Pobierz .txt”.")));
                }}
              >
                {t("Kopiuj dla modelu (z kluczem)")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void downloadBlob(
                    new Blob([exportText()], { type: "text/plain;charset=utf-8" }),
                    modelExportFilename(props.filename)
                  )
                    .then((savedPath) => {
                      if (savedPath) setStatus(`Zapisano: ${savedPath}`);
                    })
                    .catch((error) =>
                      setStatus(t("Nie udało się zapisać pliku: {error}", { error: error instanceof Error ? error.message : String(error) }))
                    );
                }}
              >
                {t("Pobierz .txt dla modelu")}
              </button>
              {props.uploadId && /\.docx$/i.test(props.filename) ? (
                <button
                  type="button"
                  title={t("Oryginalny plik Word z symbolami zamiast danych: formatowanie, przypisy, komentarze, nagłówki i stopki zachowane; autorzy i metadane usunięte")}
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void anonymizedDocx(props.caseId, props.uploadId!, props.documentId)
                      .then(async (file) => {
                        const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
                        const savedPath = await downloadBlob(new Blob([bytes], { type: file.mediaType }), file.filename);
                        const media = file.warnings.find((warning) => warning.startsWith("MEDIA_NOT_ANONYMIZED:"));
                        setStatus(
                          [
                            savedPath ? `Zapisano: ${savedPath}` : "Pobrano zanonimizowany .docx.",
                            media ? t("Uwaga: obrazy i osadzone obiekty ({value}) nie są anonimizowane - sprawdź je przed wysłaniem.", { value: media.split(":")[1] }) : ""
                          ].filter(Boolean).join(" ")
                        );
                      })
                      .catch((error) => setStatus(docxErrorText(error)))
                      .finally(() => setBusy(false));
                  }}
                >
                  {t("Pobierz zanonimizowany .docx")}
                </button>
              ) : null}
            </>
          ) : null}
          <button type="button" onClick={props.onClose}>{t("Zamknij")}</button>
        </div>
      </div>

      {version?.reviewed === false ? (
        <div className="privacy-preview-todo" role="status">
          <strong>{t("Dokument nie jest zatwierdzony")}</strong>
          <small>
            {t("Przetworzono go bez podglądu. Do zatwierdzenia nie trafi do modelu spoza tego komputera.")}
          </small>
          {props.readOnly ? null : (
            <div>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void apply(
                    () => approveAnonymizedVersion(props.caseId, props.documentId),
                    () => t("Zatwierdzono. Dokument może trafić do wybranego modelu.")
                  )
                }
              >
                {t("Zatwierdzam po sprawdzeniu")}
              </button>
            </div>
          )}
        </div>
      ) : null}
      {!version ? (
        <p className="privacy-key-empty">{status || "Wczytywanie…"}</p>
      ) : tab !== "key" ? (
        <>
          {props.readOnly ? null : (
            <div className="text-editor-toolbar anonymized-toolbar">
              <input
                aria-label={t("Tekst do anonimizacji")}
                placeholder={t("Zaznacz tekst poniżej albo wpisz go tutaj")}
                value={selection}
                onChange={(event) => setSelection(event.target.value)}
              />
              <select aria-label={t("Rodzaj danych")} value={kind} onChange={(event) => setKind(event.target.value as PiiKind)}>
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <button type="button" disabled={busy || !selection.trim()} onClick={protect}>
                {t("Anonimizuj wszystkie wystąpienia")}
              </button>
            </div>
          )}
          <div className="anonymized-text" ref={textRef} onMouseUp={captureSelection} onKeyUp={captureSelection}>
            {tab === "marked" ? (
              <>
                <p className="anonymized-legend">
                  {t("Zaznaczone słowa model widzi jako symbole.")}
                  <InfoTip>{t("Najedź na słowo, aby zobaczyć symbol, kliknij, aby przejść do klucza. Zaznacz inny fragment, aby go zanonimizować.")}</InfoTip>
                </p>
                {version.highlighted.map((chunk) => (
                  <article key={chunk.index}>
                    <small>
                      s. {chunk.pageStart}
                      {chunk.pageEnd !== chunk.pageStart ? `–${chunk.pageEnd}` : ""}
                    </small>
                    <p>{renderMarked(chunk.text, chunk.marks, version.totalPages, (token) => {
                      setHighlight(token);
                      setTab("key");
                    })}</p>
                  </article>
                ))}
              </>
            ) : version.chunks.map((chunk) => (
              <article key={chunk.index}>
                <small>
                  s. {chunk.pageStart}
                  {chunk.pageEnd !== chunk.pageStart ? `–${chunk.pageEnd}` : ""}
                  {props.readOnly || editingChunk?.index === chunk.index ? null : (
                    <button
                      type="button"
                      className="anonymized-edit-button"
                      title={t("Popraw błąd odczytu albo zakryj ręcznie dane, których wykrywanie nie znalazło; symbole zostaw bez zmian")}
                      onClick={() => setEditingChunk({ index: chunk.index, text: chunk.text })}
                    >
                      {t("Popraw tekst")}
                    </button>
                  )}
                </small>
                {editingChunk?.index === chunk.index ? (
                  <div className="anonymized-edit">
                    <textarea
                      aria-label={`Tekst fragmentu ze s. ${chunk.pageStart}`}
                      value={editingChunk.text}
                      rows={Math.min(24, Math.max(6, editingChunk.text.split("\n").length + 1))}
                      onChange={(event) => setEditingChunk({ index: chunk.index, text: event.target.value })}
                    />
                    <div>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy || !editingChunk.text.trim()}
                        onClick={() =>
                          void apply(
                            () => editAnonymizedText(props.caseId, props.documentId, chunk.index, editingChunk.text),
                            () => {
                              setEditingChunk(null);
                              return t("Zapisano poprawkę wersji zanonimizowanej. Oryginał i klucz bez zmian.");
                            }
                          )
                        }
                      >
                        {t("Zapisz poprawkę")}
                      </button>
                      <button type="button" onClick={() => setEditingChunk(null)}>
                        {t("Anuluj")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p>
                    {renderProtected(chunk.text, version.totalPages, (token) => {
                      setHighlight(token);
                      setTab("key");
                    })}
                  </p>
                )}
              </article>
            ))}
          </div>
        </>
      ) : (
        <PrivacyKeyTable
          entries={version.entries}
          highlight={highlight}
          busy={busy}
          {...(props.readOnly ? {} : { onRemove: remove, onSaveForms: saveForms, onSaveGrammar: saveGrammar })}
        />
      )}
      {status && version ? <p className="text-editor-status" role="status">{status}</p> : null}
    </section>
  );
}
