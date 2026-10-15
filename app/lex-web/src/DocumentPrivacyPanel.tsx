import {
  useEffect,
  useRef,
  useState
} from "react";
import {
  ApiError,
  detectDocument,
  finalizeDocument,
  keepAllDirectives,
  reviewDocument,
  uploadCaseFile,
  type DocumentAttachmentSelection,
  type DocumentIngestionResponse,
  type DocumentReviewResponse,
  type PagePrivacyDirective,
  type ProcessingProgress,
  type StoredUploadResponse
} from "./api.js";
import { progressLabel, progressPercent, trackProgress } from "./processing-progress.js";
import { documentFailure, type DocumentFailure } from "./document-errors.js";
import type { DocumentDropOutcome } from "./document-drop-queue.js";
import { PrivacyPreview } from "./PrivacyPreview.js";

export type PrivacyDecisionMode =
  | "AUTO_PSEUDONYMIZE"
  | "MANUAL"
  | "KEEP_CLEAR";

export type DocumentPrivacyDraft = {
  file: File;
  fileName: string;
  review: DocumentReviewResponse;
  directives: PagePrivacyDirective[];
  privacyMode: PrivacyDecisionMode;
};

export type DocumentProcessingEvent = {
  fileName: string;
  stage:
    | "ANALYZING"
    | "OCR_COMPLETE"
    | "PRIVACY_REQUIRED"
    | "PRIVACY_STAGED"
    | "FINALIZED"
    | "ARCHIVE_STORED";
  documentId?: string;
  totalPages?: number;
  ocrPages?: number;
  suggestions?: number;
  privacyMode?: PrivacyDecisionMode;
};


type FinalizedBatchItem = {
  fileName: string;
  result: DocumentIngestionResponse;
  selectedChunkIndices: number[];
};

function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start < b.end && a.end > b.start;
}

function sourceText(
  review: DocumentReviewResponse,
  range: { page: number; start: number; end: number }
): string {
  const text = review.pages.find(
    (item) => item.page === range.page
  )?.text ?? "";
  return text.slice(range.start, range.end);
}

function decisionModeLabel(mode: PrivacyDecisionMode): string {
  if (mode === "AUTO_PSEUDONYMIZE") {
    return "Automatyczna anonimizacja / pseudonimizacja";
  }
  if (mode === "KEEP_CLEAR") {
    return "Bez anonimizacji (tekst jawny)";
  }
  return "Wykrywanie automatyczne + Twoje decyzje w podglądzie";
}

function decisionLabel(directive: PagePrivacyDirective): string {
  if (directive.action === "KEEP") {
    return "POZOSTAW JAWNE";
  }
  if (directive.action === "LABEL") {
    return `ETYKIETA${directive.label ? `: ${directive.label}` : ""}`;
  }
  return `PSEUDONIMIZUJ${directive.kind ? ` · ${directive.kind}` : ""}${
    directive.label ? ` · ${directive.label}` : ""
  }`;
}

function finalDecisionForSuggestion(
  draft: DocumentPrivacyDraft,
  suggestion: DocumentReviewResponse["suggestions"][number]
): string {
  const override = draft.directives.find(
    (directive) =>
      directive.page === suggestion.page &&
      rangesOverlap(directive, suggestion)
  );
  if (override) {
    return decisionLabel(override);
  }
  return `PSEUDONIMIZUJ AUTOMATYCZNIE · ${suggestion.kind}`;
}

export function DocumentPrivacyPanel({
  caseId,
  incomingFile,
  queuedFiles,
  onIncomingFileConsumed,
  onAttachmentSelectionChange,
  onCaseFilesChange,
  onProcessingEvent,
  processingOptionsFor,
  onFilesChosen
}: {
  caseId: string;
  incomingFile?: File | null;
  // The whole queue (incomingFile first): read before the first preview.
  queuedFiles?: File[];
  // Per-file processing chosen before upload (AI personal-data check, AI OCR fix).
  processingOptionsFor?: (file: File) => { localAi?: boolean; ocrFix?: boolean } | undefined;
  onIncomingFileConsumed?: (outcome: DocumentDropOutcome) => void;
  onAttachmentSelectionChange?: (
    selection: DocumentAttachmentSelection | null
  ) => void;
  onCaseFilesChange?: () => void;
  onProcessingEvent?: (
    event: DocumentProcessingEvent
  ) => void;
  // Several files chosen at once go to the parent's queue (read one after another).
  onFilesChosen?: (files: File[]) => void;
}) {
  const autoStartedFiles =
    useRef<WeakSet<File>>(new WeakSet());
  const activeFileRef =
    useRef<File | null>(null);
  // The file each preview belongs to: "Zatwierdź plik" stages that file, whatever else
  // started in the meantime (the next file of the queue, a new case).
  const reviewFiles = useRef(new Map<string, File>());
  // Each read gets a number; a read overtaken by a newer one (or by a case change) is dropped.
  const openCall = useRef(0);
  const [activeFileName, setActiveFileName] =
    useState("");
  const [review, setReview] =
    useState<DocumentReviewResponse | null>(
      null
    );
  const [directives, setDirectives] =
    useState<PagePrivacyDirective[]>([]);
  const [loading, setLoading] =
    useState(false);
  // Stage and page of the document being read (OCR, detection, local AI).
  const [progress, setProgress] =
    useState<ProcessingProgress | null>(null);
  const [batchFinalizing, setBatchFinalizing] =
    useState(false);
  const [error, setError] = useState("");
  // The file that failed to read: plain message, code for the details, retry or not.
  const [failure, setFailure] = useState<DocumentFailure | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [batchDrafts, setBatchDrafts] =
    useState<DocumentPrivacyDraft[]>([]);
  const [finalizedBatch, setFinalizedBatch] =
    useState<FinalizedBatchItem[]>([]);
  const [archiveUpload, setArchiveUpload] =
    useState<StoredUploadResponse | null>(null);
  // Several files: all are read first (OCR, vision model, text models stopped), then their
  // personal data detected (the text model starts once), then the preview of each.
  const prepared =
    useRef(new Map<File, Promise<DocumentReviewResponse>>());
  const preparing =
    useRef<Promise<unknown>>(Promise.resolve());

  // Before the effect below: a case change drops what was read for the previous case, and
  // the file at the head of the queue is read again for the new one (it no longer hangs).
  useEffect(() => {
    openCall.current += 1;
    setBatchDrafts([]);
    setFinalizedBatch([]);
    setReview(null);
    setDirectives([]);
    activeFileRef.current = null;
    reviewFiles.current.clear();
    prepared.current.clear();
    autoStartedFiles.current = new WeakSet();
  }, [caseId]);

  useEffect(() => {
    if (!incomingFile) return;
    if (autoStartedFiles.current.has(incomingFile)) return;
    autoStartedFiles.current.add(incomingFile);
    void openFile(incomingFile);
  }, [incomingFile, caseId]);

  const isArchive = (file: File) =>
    file.type === "application/zip" || file.name.toLowerCase().endsWith(".zip");

  /**
   * Reads the files not read yet: the OCR of all of them first, then the detection of
   * personal data of each. With the local AI the text model is stopped for the OCR (the
   * vision model gets its memory) and started once, before the first detection.
   */
  function prepare(files: File[]): Map<File, Promise<DocumentReviewResponse>> {
    const fresh = files.filter((file) => !isArchive(file) && !prepared.current.has(file));
    if (fresh.length && caseId) {
      const reads = new Map<File, Promise<DocumentReviewResponse>>();
      let chain = preparing.current.catch(() => undefined);
      for (const file of fresh) {
        const read = chain.then(() => {
          const tracker = trackProgress(caseId, setProgress);
          return reviewDocument(file, caseId, { ...processingOptionsFor?.(file), detect: false }, tracker.progressId).finally(() => {
            tracker.stop();
            setProgress(null);
          });
        });
        reads.set(file, read);
        chain = read.catch(() => undefined);
      }
      for (const file of fresh) {
        const detected = chain.then(async () => {
          const read = await reads.get(file)!;
          const tracker = trackProgress(caseId, setProgress);
          return detectDocument(caseId, read.documentId, { localAi: processingOptionsFor?.(file)?.localAi === true }, tracker.progressId).finally(() => {
            tracker.stop();
            setProgress(null);
          });
        });
        prepared.current.set(file, detected);
        chain = detected.catch(() => undefined);
      }
      preparing.current = chain;
    }
    return prepared.current;
  }

  // The whole queue is read before the first preview.
  useEffect(() => {
    if (queuedFiles?.length) prepare(queuedFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedFiles, caseId]);

  async function openFile(
    file: File | undefined
  ): Promise<void> {
    if (!file) return;
    const call = ++openCall.current;
    setLoading(true);
    setError("");
    setFailure(null);
    setActiveFileName(file.name);
    activeFileRef.current = file;
    setReview(null);
    setArchiveUpload(null);
    setDirectives([]);
    if (batchDrafts.length === 0) {
      setFinalizedBatch([]);
    }
    onProcessingEvent?.({
      fileName: file.name,
      stage: "ANALYZING"
    });

    try {
      if (!caseId) {
        throw new Error("CASE_STORAGE_NOT_READY");
      }

      if (isArchive(file)) {
        const stored =
          await uploadCaseFile(
            caseId,
            file
          );
        setArchiveUpload(stored);
        activeFileRef.current = null;
        setActiveFileName("");
        onCaseFilesChange?.();
        onProcessingEvent?.({
          fileName: file.name,
          stage: "ARCHIVE_STORED"
        });
        onIncomingFileConsumed?.("STORED");
        return;
      }

      // The next files of the queue are already read; their failures show when they come up.
      // Forgotten either way: a retry reads the file again.
      const result = await prepare([file]).get(file)!.finally(() => prepared.current.delete(file));
      if (call !== openCall.current) return;
      reviewFiles.current.set(result.documentId, file);
      setReview(result);
      onCaseFilesChange?.();
      const ocrPages = result.pages.filter(
        (item) => item.source === "OCR"
      ).length;
      if (ocrPages > 0) {
        onProcessingEvent?.({
          fileName: file.name,
          stage: "OCR_COMPLETE",
          documentId: result.documentId,
          totalPages: result.totalPages,
          ocrPages
        });
      }
      onProcessingEvent?.({
        fileName: file.name,
        stage: "PRIVACY_REQUIRED",
        documentId: result.documentId,
        totalPages: result.totalPages,
        ocrPages,
        suggestions: result.suggestions.length
      });
    } catch (cause) {
      if (call !== openCall.current) return;
      const failed = documentFailure(cause);
      setFailure(failed);
      setError(failed.message);
    } finally {
      if (call === openCall.current) setLoading(false);
    }
  }

  // Back to one file of the batch: its preview with the decisions made so far.
  function editDraft(
    draft: DocumentPrivacyDraft
  ): void {
    activeFileRef.current = draft.file;
    reviewFiles.current.set(draft.review.documentId, draft.file);
    setActiveFileName(draft.fileName);
    setDirectives(draft.directives);
    setReview(draft.review);
    setError("");
    setArchiveUpload(null);
  }


  function stageWith(
    review: DocumentReviewResponse,
    decisions: PagePrivacyDirective[],
    mode: PrivacyDecisionMode
  ): void {
    const file = reviewFiles.current.get(review.documentId) ?? activeFileRef.current;
    if (!file) {
      // Never a silent click: the preview stays and says what to do.
      setError("Nie udało się zatwierdzić: ten podgląd nie jest już powiązany z plikiem. Wybierz plik ponownie.");
      return;
    }
    const draft: DocumentPrivacyDraft = {
      file,
      fileName:
        file.name ||
        activeFileName ||
        review.documentId,
      review,
      directives: decisions,
      privacyMode: mode
    };
    setBatchDrafts((current) => {
      const existing = current.findIndex(
        (item) => item.review.documentId === review.documentId
      );
      if (existing < 0) {
        return [...current, draft];
      }
      return current.map((item, index) =>
        index === existing ? draft : item
      );
    });
    onProcessingEvent?.({
      fileName: draft.fileName,
      stage: "PRIVACY_STAGED",
      documentId: review.documentId,
      totalPages: review.totalPages,
      ocrPages: review.pages.filter(
        (item) => item.source === "OCR"
      ).length,
      suggestions: review.suggestions.length,
      privacyMode: mode
    });
    setReview(null);
    setDirectives([]);
    activeFileRef.current = null;
    setActiveFileName("");
    onIncomingFileConsumed?.("READY");
  }

  async function finalizeBatch(): Promise<void> {
    if (
      batchFinalizing ||
      batchDrafts.length === 0 ||
      incomingFile ||
      loading
    ) return;
    setBatchFinalizing(true);
    setError("");
    const successful: FinalizedBatchItem[] = [];
    const failed: DocumentPrivacyDraft[] = [];
    const failures: string[] = [];

    for (const draft of batchDrafts) {
      try {
        // The batch preview (detections, local AI hints, doubtful OCR lines) was confirmed.
        const result = await finalizeDocument(
          caseId,
          draft.review.documentId,
          draft.directives,
          undefined,
          true
        );
        const selectedChunkIndices = result.chunks
          .slice(0, 32)
          .map((chunk) => chunk.index);
        successful.push({
          fileName: draft.fileName,
          result,
          selectedChunkIndices
        });
        if (selectedChunkIndices.length > 0) {
          onAttachmentSelectionChange?.({
            caseId,
            documentId: result.documentId,
            chunkIndices: selectedChunkIndices
          });
        }
        onProcessingEvent?.({
          fileName: draft.fileName,
          stage: "FINALIZED",
          documentId: result.documentId,
          totalPages: result.totalPages,
          ocrPages: result.ocrPages,
          suggestions: result.privacy.findings,
          privacyMode: draft.privacyMode
        });
      } catch (cause) {
        failed.push(draft);
        failures.push(
          `${draft.fileName}: ${
            cause instanceof Error
              ? cause.message
              : "DOCUMENT_PRIVACY_FINALIZATION_FAILED"
          }`
        );
      }
    }

    setFinalizedBatch((current) => [
      ...current.filter(
        (item) =>
          !successful.some(
            (next) => next.result.documentId === item.result.documentId
          )
      ),
      ...successful
    ]);
    setBatchDrafts(failed);
    onCaseFilesChange?.();
    if (failures.length > 0) {
      setError(
        `Nie zatwierdzono ${failures.length} plików. ${failures.join(" · ")}`
      );
    }
    setBatchFinalizing(false);
  }

  function setChunkSelected(
    documentId: string,
    index: number,
    selected: boolean
  ): void {
    setFinalizedBatch((current) =>
      current.map((item) => {
        if (item.result.documentId !== documentId) {
          return item;
        }
        const next = selected
          ? [...new Set([
              ...item.selectedChunkIndices,
              index
            ])].sort((a, b) => a - b)
          : item.selectedChunkIndices.filter(
              (chunkIndex) => chunkIndex !== index
            );
        if (next.length > 32) {
          setError(
            "Do jednej sesji można dołączyć maksymalnie 32 chunki z jednego dokumentu. Wybierz mniejszy zakres."
          );
          return item;
        }
        setError("");
        onAttachmentSelectionChange?.(
          next.length > 0
            ? {
                caseId,
                documentId,
                chunkIndices: next
              }
            : null
        );
        return {
          ...item,
          selectedChunkIndices: next
        };
      })
    );
  }

  return (
    <section className="document-workbench">
      <div className="document-workbench-head">
        <div>
          <p className="eyebrow">
            Dokumenty lokalne
          </p>
          <h3>
            OCR automatyczny i anonimizacja per plik
          </h3>
          <p>
            Zdjęcia są od razu kierowane do lokalnego OCR. PDF jest analizowany strona po stronie:
            jeśli ma użyteczną warstwę tekstową, OCR nie jest potrzebny, a strony skanowane są OCR-owane
            automatycznie. Kilka plików: najpierw OCR wszystkich (w trybie z AI pracuje wtedy tylko model
            wizyjny), potem wykrywanie danych osobowych (model tekstowy uruchamia się raz), potem podgląd
            każdego pliku: niepewne linie OCR, wskazania AI i zaczernienia do sprawdzenia i poprawy.
          </p>
          <p>
            Każdy plik otrzymuje osobny documentId i osobną zaszyfrowaną mapę reidentyfikacji. Model AI
            niczego nie odkrywa sam: jego wskazania są podpowiedziami w podglądzie. Przed zastosowaniem
            zobaczysz jeszcze zbiorczy podgląd wszystkich plików i Twoich decyzji.
          </p>
          {activeFileName ? (
            <small>
              Aktualny plik: {activeFileName}
            </small>
          ) : null}
        </div>

        <label className="file-button">
          {loading
            ? progress
              ? progressLabel(progress)
              : "Przetwarzanie…"
            : onFilesChosen
              ? "Wybierz pliki: PDF, dokumenty, arkusze, zdjęcia lub ZIP (także kilka naraz)"
              : "Wybierz PDF, dokument, arkusz, zdjęcie lub ZIP"}
          <input
            type="file"
            accept=".pdf,.docx,.odt,.xlsx,.xlsm,.csv,.tsv,.txt,.md,.zip,application/pdf,application/zip,text/plain,text/markdown,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroenabled.12,image/jpeg,image/png,image/webp,image/tiff"
            multiple={Boolean(onFilesChosen)}
            disabled={loading || batchFinalizing || !caseId}
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []);
              if (onFilesChosen && chosen.length > 1) {
                event.target.value = "";
                onFilesChosen(chosen);
                return;
              }
              void openFile(
                chosen[0]
              );
              event.currentTarget.value = "";
            }}
          />
        </label>
        {loading && progress ? (
          <div className="workspace-progress" role="status" aria-live="polite">
            <progress max={100} value={progressPercent(progress)} />
            <small>{progressLabel(progress)}</small>
          </div>
        ) : null}
      </div>

      {error && (
        <div className="alert alert-error document-failure" role="alert">
          <span>
            {activeFileName ? <strong>{activeFileName}: </strong> : null}
            {error}
          </span>
          {failure ? (
            <details className="document-failure-code">
              <summary>Szczegóły techniczne</summary>
              <code>{failure.code}</code>
            </details>
          ) : null}
          {failure ? (
            <div className="document-failure-actions">
              {failure.retryable && (activeFileRef.current || incomingFile) ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void openFile(activeFileRef.current ?? incomingFile ?? undefined)}
                >
                  Ponów
                </button>
              ) : null}
              <button
                type="button"
                disabled={loading}
                onClick={() => replaceInputRef.current?.click()}
              >
                Wybierz plik ponownie
              </button>
              <input
                ref={replaceInputRef}
                type="file"
                hidden
                aria-label="Wybierz plik ponownie"
                onChange={(event) => {
                  const replacement = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (replacement) void openFile(replacement);
                }}
              />
              {incomingFile ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setReview(null);
                    setDirectives([]);
                    setArchiveUpload(null);
                    activeFileRef.current = null;
                    setActiveFileName("");
                    setError("");
                    setFailure(null);
                    onIncomingFileConsumed?.("SKIPPED");
                  }}
                >
                  Pomiń ten plik
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {archiveUpload && (
        <div className="document-finalized">
          <strong>
            Archiwum zapisane i rozpakowane lokalnie
          </strong>
          <span>
            {archiveUpload.filename} · {archiveUpload.extracted.length} plików ·
            {" "}{archiveUpload.extracted.filter((item) => item.processable).length} możliwych do dalszego przetwarzania
          </span>
          {archiveUpload.extracted.length > 0 && (
            <ul>
              {archiveUpload.extracted.slice(0, 20).map((entry) => (
                <li key={entry.relativePath}>
                  {entry.relativePath}
                  {entry.processable ? " · obsługiwalny" : " · zapisany tylko lokalnie"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {review ? (
        <PrivacyPreview
          key={review.documentId}
          caseId={caseId}
          review={review}
          fileName={activeFileName || review.documentId}
          keepClear={false}
          initialDirectives={directives}
          confirmLabel="Zatwierdź plik"
          confirmError={error || undefined}
          busy={loading || batchFinalizing}
          onConfirm={(decisions, current) =>
            stageWith(current, decisions, decisions.length ? "MANUAL" : "AUTO_PSEUDONYMIZE")
          }
          onKeepClear={(current) => {
            if (
              window.confirm(
                `„${activeFileName || current.documentId}” bez anonimizacji: do modelu trafi tekst jawny z danymi osobowymi. Kontynuować?`
              )
            ) {
              stageWith(current, keepAllDirectives(current), "KEEP_CLEAR");
            }
          }}
          onCancel={() => {
            setReview(null);
            setDirectives([]);
            activeFileRef.current = null;
            setActiveFileName("");
            onIncomingFileConsumed?.("SKIPPED");
          }}
        />
      ) : null}

      {batchDrafts.length > 0 && !review && !incomingFile && !loading ? (
        <div className="privacy-decisions privacy-batch-preview">
          <div className="privacy-decision-head">
            <div>
              <p className="eyebrow">Przed zatwierdzeniem</p>
              <h3>
                Zbiorczy podgląd anonimizacji · {batchDrafts.length} plików
              </h3>
              <p>
                To jest wersja robocza. Poniżej dla każdego pliku widać elementy wykryte automatycznie,
                Twoje ręczne zaznaczenia i końcową decyzję, która zostanie zastosowana. Każdy plik nadal
                zachowuje własny documentId i własną zaszyfrowaną mapę reidentyfikacji.
              </p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={batchFinalizing}
              onClick={() => void finalizeBatch()}
            >
              {batchFinalizing
                ? "Zatwierdzanie…"
                : `Zatwierdź decyzje dla ${batchDrafts.length} plików`}
            </button>
          </div>

          {batchDrafts.map((draft) => {
            const manualOnly = draft.directives.filter(
              (directive) =>
                !draft.review.suggestions.some(
                  (suggestion) =>
                    suggestion.page === directive.page &&
                    rangesOverlap(directive, suggestion)
                )
            );
            return (
              <details
                key={draft.review.documentId}
                className="privacy-batch-file"
                open
              >
                <summary>
                  <strong>{draft.fileName}</strong>
                  {" · "}{decisionModeLabel(draft.privacyMode)}
                  {" · "}{draft.review.suggestions.length} wykryć
                  {" · "}{draft.directives.length} decyzji w podglądzie
                </summary>

                {draft.review.pages.some((page) => page.review?.length) ? (
                  <div className="privacy-preview-todo">
                    <strong>Odczyt niepewny - porównaj ze skanem przed zatwierdzeniem</strong>
                    <small>Pismo odręczne, pieczątki lub rozmazany druk. Popraw tekst strony: „Wróć do podglądu tego pliku”, potem „Popraw tekst strony”.</small>
                    <ul>
                      {draft.review.pages.flatMap((page) =>
                        (page.review ?? []).map((line, index) => (
                          <li key={`${page.page}-${index}`}>s. {page.page} · „{line.text}”</li>
                        ))
                      )}
                    </ul>
                  </div>
                ) : null}

                <div className="privacy-review-grid">
                  <section className="privacy-document">
                    <h4>Wykryte automatycznie</h4>
                    {draft.review.suggestions.length === 0 ? (
                      <p className="field-help">
                        Nie wykryto automatycznych elementów do anonimizacji.
                      </p>
                    ) : (
                      <ul>
                        {draft.review.suggestions.map((suggestion, index) => (
                          <li key={`${suggestion.page}-${suggestion.start}-${suggestion.end}-${index}`}>
                            <span>
                              s. {suggestion.page} · {suggestion.kind} ·{" "}
                              „{sourceText(draft.review, suggestion)}”
                            </span>
                            <strong>
                              {finalDecisionForSuggestion(draft, suggestion)}
                            </strong>
                            {suggestion.aiNotPerson &&
                            !draft.directives.some(
                              (directive) => directive.page === suggestion.page && rangesOverlap(directive, suggestion)
                            ) ? (
                              <button
                                type="button"
                                title="Lokalne AI uznało, że to nie osoba. Bez kliknięcia zostaje zamaskowane."
                                onClick={() =>
                                  setBatchDrafts((current) =>
                                    current.map((item) =>
                                      item.review.documentId === draft.review.documentId
                                        ? {
                                            ...item,
                                            privacyMode: "MANUAL",
                                            directives: [
                                              ...item.directives,
                                              { page: suggestion.page, start: suggestion.start, end: suggestion.end, action: "KEEP" }
                                            ]
                                          }
                                        : item
                                    )
                                  )
                                }
                              >
                                Odkryj · AI: {suggestion.aiNotPerson}
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <aside className="privacy-controls">
                    <h4>Moje decyzje w podglądzie</h4>
                    {draft.privacyMode !== "MANUAL" || draft.directives.length === 0 ? (
                      <p className="field-help">
                        {draft.privacyMode === "MANUAL"
                          ? "Brak zmian w podglądzie; wykrycia automatyczne zostaną pseudonimizowane."
                          : "Bez zmian w podglądzie."}
                      </p>
                    ) : (
                      <ul>
                        {draft.directives.map((directive, index) => (
                          <li key={`${directive.page}-${directive.start}-${directive.end}-${index}`}>
                            s. {directive.page} · {decisionLabel(directive)} ·{" "}
                            „{sourceText(draft.review, directive)}”
                          </li>
                        ))}
                      </ul>
                    )}

                    <h4>Końcowa decyzja dla pliku</h4>
                    <p>
                      <strong>{decisionModeLabel(draft.privacyMode)}</strong>
                    </p>
                    <p className="field-help">
                      Wykrycia bez ręcznej decyzji są pseudonimizowane automatycznie. Ręczne KEEP i LABEL
                      wyłączają nakładające się wykrycie automatyczne, a ręczne PSEUDONYMIZE ma pierwszeństwo.
                    </p>
                    {manualOnly.length > 0 ? (
                      <div>
                        <strong>Dodatkowe ręczne elementy poza auto-wykryciami</strong>
                        <ul>
                          {manualOnly.map((directive, index) => (
                            <li key={`${directive.page}-${directive.start}-${index}`}>
                              s. {directive.page} · {decisionLabel(directive)} ·{" "}
                              „{sourceText(draft.review, directive)}”
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      disabled={batchFinalizing}
                      onClick={() => editDraft(draft)}
                    >
                      Wróć do podglądu tego pliku
                    </button>
                  </aside>
                </div>
              </details>
            );
          })}

          <p className="field-help">
            Zatwierdzenie jest wykonywane osobno dla każdego documentId. Jeśli pojedynczy plik zgłosi błąd,
            pliki zatwierdzone poprawnie pozostaną gotowe, a niezatwierdzony plik wróci do tego podglądu.
          </p>
        </div>
      ) : null}

      {finalizedBatch.length > 0 && (
        <div className="privacy-decisions">
          <div className="privacy-decision-head">
            <div>
              <strong>
                Zatwierdzone dokumenty: {finalizedBatch.length}
              </strong>
              <p>
                Mapy reidentyfikacji pozostają odrębne dla każdego documentId, zaszyfrowane lokalnie
                i nie są przekazywane providerowi.
              </p>
            </div>
          </div>

          {finalizedBatch.map((item) => (
            <details
              key={item.result.documentId}
              className="attachment-selector"
            >
              <summary>
                <strong>{item.fileName}</strong>
                {" · "}{item.result.totalPages} stron
                {" · "}{item.result.ocrPages} OCR
                {" · "}{item.result.privacy.findings} anonimizacji
                {" · "}{item.result.chunks.length} chunków
              </summary>

              <div className="attachment-selector-head">
                <div>
                  <strong>Chunki do analizy AI</strong>
                  <p>
                    Maksymalnie 32 chunki z dokumentu są zaznaczane automatycznie po zatwierdzeniu.
                    Możesz zmienić wybór.
                  </p>
                </div>
                <span>
                  {item.selectedChunkIndices.length}/32 wybranych
                </span>
              </div>

              {item.result.chunks.length <= 32 && (
                <div className="attachment-actions">
                  <button
                    type="button"
                    onClick={() => {
                      const all = item.result.chunks.map(
                        (chunk) => chunk.index
                      );
                      setFinalizedBatch((current) =>
                        current.map((entry) =>
                          entry.result.documentId === item.result.documentId
                            ? {
                                ...entry,
                                selectedChunkIndices: all
                              }
                            : entry
                        )
                      );
                      onAttachmentSelectionChange?.({
                        caseId,
                        documentId: item.result.documentId,
                        chunkIndices: all
                      });
                    }}
                  >
                    Zaznacz wszystkie
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFinalizedBatch((current) =>
                        current.map((entry) =>
                          entry.result.documentId === item.result.documentId
                            ? {
                                ...entry,
                                selectedChunkIndices: []
                              }
                            : entry
                        )
                      );
                      onAttachmentSelectionChange?.(null);
                    }}
                  >
                    Wyczyść wybór
                  </button>
                </div>
              )}

              <div className="attachment-chunk-list">
                {item.result.chunks.map((chunk) => (
                  <label
                    key={chunk.index}
                    className="attachment-chunk"
                  >
                    <input
                      type="checkbox"
                      checked={item.selectedChunkIndices.includes(
                        chunk.index
                      )}
                      onChange={(event) =>
                        setChunkSelected(
                          item.result.documentId,
                          chunk.index,
                          event.target.checked
                        )
                      }
                    />
                    <span>
                      Chunk {chunk.index} · strony{" "}
                      {chunk.pageStart}-{chunk.pageEnd}
                    </span>
                    <small>
                      {chunk.text.length.toLocaleString(
                        "pl-PL"
                      )} znaków
                    </small>
                  </label>
                ))}
              </div>

              {item.result.chunks.length > 32 && (
                <p className="field-help">
                  Dokument ma więcej niż 32 chunki. Pierwsze 32 zostały zaznaczone automatycznie;
                  kolejne partie możesz analizować osobno.
                </p>
              )}

              <p className="field-help">
                Uwaga: fragmenty oznaczone jako KEEP pozostają jawne zgodnie z decyzją użytkownika
                i mogą trafić do providera, jeśli wybierzesz zawierający je chunk.
              </p>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
