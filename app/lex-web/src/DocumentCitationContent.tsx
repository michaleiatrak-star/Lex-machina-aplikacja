import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { WorkspaceDocumentCitation } from "./workspace-client.js";
import { getAnonymizedVersion, type AnonymizedVersion } from "./api.js";
import { SourceLinkedText, type SourceClaim } from "./SourceLinkedText.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { InfoTip } from "./InfoTip";

function HighlightedContext({
  citation
}: {
  citation: WorkspaceDocumentCitation;
}) {
  const start = citation.highlightStart;
  const end = citation.highlightEnd;
  if (
    start === undefined ||
    end === undefined ||
    start < 0 ||
    end < start ||
    end > citation.contextText.length
  ) {
    return <pre className="document-citation-context">{citation.contextText}</pre>;
  }
  return (
    <pre className="document-citation-context">
      {citation.contextText.slice(0, start)}
      <mark id={`highlight-${citation.citationId}`}>
        {citation.contextText.slice(start, end)}
      </mark>
      {citation.contextText.slice(end)}
    </pre>
  );
}

// Cały dokument z akt: wszystkie fragmenty po kolei, cytowane miejsca podświetlone,
// wybrane przewinięte do widoku.
function FullDocument({
  caseId,
  selected,
  citations
}: {
  caseId: string;
  selected: WorkspaceDocumentCitation;
  citations: WorkspaceDocumentCitation[];
}) {
  const [version, setVersion] = useState<AnonymizedVersion | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setVersion(null);
    setError("");
    getAnonymizedVersion(caseId, selected.documentId)
      .then((loaded) => { if (!cancelled) setVersion(loaded); })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => { cancelled = true; };
  }, [caseId, selected.documentId]);
  useEffect(() => {
    if (!version) return;
    document.getElementById(`full-${selected.citationId}`)?.scrollIntoView({ block: "center" });
  }, [version, selected.citationId]);

  if (error) return <p className="document-citation-error">Nie udało się wczytać dokumentu: {error}</p>;
  if (!version) return <p>Wczytywanie całego dokumentu…</p>;
  const sameDocument = citations.filter((item) => item.documentId === selected.documentId);
  return (
    <div className="document-citation-full">
      {version.chunks.map((chunk) => {
        const marks = sameDocument
          .filter((item) =>
            item.chunkIndex === chunk.index &&
            item.contextText === chunk.text &&
            item.highlightStart !== undefined &&
            item.highlightEnd !== undefined &&
            item.highlightEnd <= chunk.text.length)
          .sort((a, b) => a.highlightStart! - b.highlightStart!);
        const cited = sameDocument.find((item) => item.chunkIndex === chunk.index);
        const parts: ReactNode[] = [];
        let cursor = 0;
        for (const mark of marks) {
          if (mark.highlightStart! < cursor) continue;
          parts.push(chunk.text.slice(cursor, mark.highlightStart));
          parts.push(
            <mark key={mark.citationId} id={`full-${mark.citationId}`} className={mark.citationId === selected.citationId ? "is-selected" : undefined}>
              {chunk.text.slice(mark.highlightStart, mark.highlightEnd)}
            </mark>
          );
          cursor = mark.highlightEnd!;
        }
        parts.push(chunk.text.slice(cursor));
        return (
          <section
            key={chunk.index}
            id={
              selected.chunkIndex === chunk.index &&
              !marks.some((mark) => mark.citationId === selected.citationId)
                ? `full-${selected.citationId}`
                : undefined
            }
            className={cited ? "document-citation-full-chunk is-cited" : "document-citation-full-chunk"}
          >
            <small>s. {chunk.pageStart}{chunk.pageEnd !== chunk.pageStart ? `–${chunk.pageEnd}` : ""}</small>
            <pre>{parts}</pre>
          </section>
        );
      })}
    </div>
  );
}

// The text the user marked in the viewer, else the quoted words, else the passage.
export function askAboutText(citation: WorkspaceDocumentCitation, viewer: HTMLElement | null): string {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  const marked =
    selection && viewer && selection.rangeCount > 0 && viewer.contains(selection.anchorNode)
      ? selection.toString().trim()
      : "";
  const highlighted =
    citation.highlightStart !== undefined && citation.highlightEnd !== undefined
      ? citation.contextText.slice(citation.highlightStart, citation.highlightEnd)
      : "";
  const passage = (marked || citation.quote || highlighted || citation.contextText).replace(/\s+/gu, " ").trim();
  const shown = passage.length > 600 ? `${passage.slice(0, 600)}…` : passage;
  return `Wyjaśnij ten fragment (${citation.label}): „${shown}”\n`;
}

export function DocumentCitationContent({
  content,
  citations = [],
  onOpenUrl,
  markdown = true,
  caseId,
  sources,
  onAskAbout
}: {
  content: string;
  // "Zapytaj o ten fragment": puts the passage into the message box (nothing is sent).
  onAskAbout?: (text: string) => void;
  citations?: WorkspaceDocumentCitation[];
  // Sprawa, z której akt można wczytać cały cytowany dokument.
  caseId?: string;
  // Zweryfikowane przepisy: opis linku VER zamiast adresu.
  sources?: SourceClaim[];
  onOpenUrl?: (url: string) => Promise<void> | void;
  // Model answers: tables, lists, bold; a user's own text stays as typed.
  markdown?: boolean;
}) {
  const [selected, setSelected] = useState<WorkspaceDocumentCitation | null>(null);
  const [whole, setWhole] = useState(false);
  const viewerRef = useRef<HTMLElement>(null);
  const byMarker = useMemo(
    () => new Map(citations.map((item) => [item.marker, item])),
    [citations]
  );
  // Citation markers and links inside paragraphs, lists and table cells.
  const renderText = (text: string, key: string, before = "") =>
    text.split(/(\[\[LEXDOCREF:docref_\d+\]\])/g).map((part, index, parts) => {
      const citation = byMarker.get(part);
      if (!citation) {
        return (
          <SourceLinkedText
            key={`${key}-${index}`}
            content={part}
            onOpenUrl={onOpenUrl}
            {...(sources ? { sources } : {})}
            before={before + parts.slice(0, index).join("")}
          />
        );
      }
      return (
        <button
          key={`${key}-${citation.citationId}-${index}`}
          type="button"
          className="document-citation-link"
          title={`Przejdź do cytowanego fragmentu: ${citation.label}`}
          aria-controls={`citation-${citation.citationId}`}
          onClick={() => { setSelected(citation); setWhole(false); }}
        >
          [{citation.label}]
        </button>
      );
    });

  useEffect(() => {
    if (!selected) return;
    viewerRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
    viewerRef.current?.focus({ preventScroll: true });
  }, [selected]);

  return (
    <>
      <div className="chat-message-content">
        {markdown ? <MarkdownContent content={content} renderText={renderText} /> : renderText(content, "plain")}
      </div>

      {citations.length > 0 ? (
        <details className="chat-evidence document-citation-list">
          <summary>Dokumenty z akt cytowane w odpowiedzi ({citations.length})</summary>
          <ul>
            {citations.map((citation) => (
              <li key={citation.citationId}>
                <strong>{citation.label}</strong>
                {citation.quoteFidelity === "NOT_FOUND" ? <em className="document-citation-mismatch">cytat niezgodny z dokumentem</em> : null}
                {citation.quote ? <span>„{citation.quote.length > 160 ? `${citation.quote.slice(0, 160)}…` : citation.quote}”</span> : null}
                <button type="button" className="chat-secondary-action" onClick={() => { setSelected(citation); setWhole(false); }}>
                  Fragment
                </button>
                {caseId || citation.caseId ? (
                  <button type="button" className="chat-secondary-action" onClick={() => { setSelected(citation); setWhole(true); }}>
                    Cały dokument z zaznaczeniem
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {selected ? (
        <aside
          ref={viewerRef}
          id={`citation-${selected.citationId}`}
          className="document-citation-viewer"
          aria-label="Cytowany fragment dokumentu"
          aria-live="polite"
          tabIndex={-1}
        >
          <div className="document-citation-head">
            <div>
              <strong>{selected.label}</strong>
              <small>
                dokument {selected.documentId} · chunk {selected.chunkIndex}
                {selected.caseId ? ` · sprawa ${selected.caseId.slice(0, 14)}…` : ""}
              </small>
            </div>
            <div>
              {caseId || selected.caseId ? (
                <button type="button" onClick={() => setWhole((value) => !value)}>
                  {whole ? "Tylko fragment" : "Cały dokument"}
                </button>
              ) : null}
              {onAskAbout ? (
                <button type="button" onClick={() => onAskAbout(askAboutText(selected, viewerRef.current))}>
                  Zapytaj o ten fragment
                </button>
              ) : null}
              <button type="button" onClick={() => setSelected(null)}>
                Zamknij
              </button>
            </div>
          </div>
          {whole && (caseId || selected.caseId) ? (
            <FullDocument caseId={(selected.caseId ?? caseId)!} selected={selected} citations={citations} />
          ) : (
            <HighlightedContext citation={selected} />
          )}
          <div className="document-citation-foot">
            <span>
              Strona {selected.pageStart}
              {selected.pageEnd !== selected.pageStart ? `–${selected.pageEnd}` : ""}
            </span>
            {selected.quoteFidelity === "NOT_FOUND" ? (
              <strong className="document-citation-mismatch">
                Cytat niezgodny z dokumentem
                <InfoTip>Słów przytoczonych w odpowiedzi nie ma w tym dokumencie. Sprawdź brzmienie w źródle przed użyciem.</InfoTip>
              </strong>
            ) : selected.quoteFidelity === "DIGEST_UNCHECKED" ? (
              <span>
                Cytatu nie sprawdzono
                <InfoTip>Model widział ten fragment w skrócie, więc dosłowności cytatu nie dało się porównać z pełnym tekstem.</InfoTip>
              </span>
            ) : selected.highlightStart !== undefined && selected.highlightEnd !== undefined ? (
              <strong>Dokładny cytat zaznaczony w źródle</strong>
            ) : (
              <span>
                Bez dokładnego cytatu
                <InfoTip>Odpowiedź opiera się na tym fragmencie, ale nie cytuje go dosłownie.</InfoTip>
              </span>
            )}
          </div>
        </aside>
      ) : null}
    </>
  );
}
