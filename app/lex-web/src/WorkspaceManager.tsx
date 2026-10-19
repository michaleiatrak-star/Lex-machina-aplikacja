import { InfoTip } from "./InfoTip";
import { GoogleImportDialog } from "./GoogleIntegrationPanel.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  deanonymizeUpload,
  detectDocument,
  finalizeDocument,
  getVisionOcrStatus,
  type DocumentReviewResponse,
  type PagePrivacyDirective,
  getProcessingProgress,
  joinSharedKey,
  keepAllDirectives,
  listCaseArtifacts,
  isDesktopShell,
  newProgressId,
  listCaseFiles,
  processStoredCaseFile,
  searchCaseKnowledge,
  uploadCaseFile,
  type CaseArtifact,
  type CaseKnowledgeHit,
  type ProcessingProgress,
  type StoredUploadResponse,
  type LocalModelsResponse,
  getLocalModels,
} from "./api.js";
import {
  filterWorkspaceItems,
  type DocumentScopeFilter,
  type DocumentTypeFilter
} from "./search-filters.js";
import {
  createWorkspaceFolder,
  deleteWorkspaceFolder,
  deleteWorkspaceItem,
  getWorkspace,
  moveWorkspaceItem,
  openWorkspaceItemInSystem,
  getEditableItem,
  previewWorkspaceItem,
  renderEditable,
  type EditableBlock,
  type EditableDocument,
  type EditableFormat,
  type EditableSheets,
  type WorkspaceFolder,
  type WorkspaceItem,
  type WorkspaceResponse
} from "./workspace-client.js";
import { PdfPreview } from "./PdfPreview.js";
import { TextFileEditor } from "./TextFileEditor.js";
import { DocumentEditor } from "./DocumentEditor.js";
import { SheetEditor } from "./SheetEditor.js";
import { documentFormatFor, sheetFormatFor } from "./office-editing.js";
import { progressLabel, progressPercent } from "./processing-progress.js";
import { OCR_MODELS_INCOMPLETE, privacyConfirmFailure } from "./document-errors.js";
import {
  clearFinished,
  enqueueFiles,
  isActiveEntry,
  nextToRead,
  queueStatusLabel,
  queueSummary,
  readEntries,
  removeQueued,
  stopQueued,
  updateEntry,
  type ProcessingQueueEntry
} from "./processing-queue.js";
import { AnonymizedDocumentView } from "./AnonymizedDocumentView.js";
import { PrivacyPreview, type PrivacyPreviewRequest } from "./PrivacyPreview.js";
import { ArtifactDeanonymize } from "./ArtifactDeanonymize.js";
import { ArtifactRenameForm } from "./ArtifactRenameForm.js";
import { decodeTextFile } from "./text-editing.js";
import {
  DEFAULT_DOCUMENT_PROCESSING_MODE,
  DOCUMENT_PROCESSING_MODES,
  processingModeKeepsClearText,
  processingModeLabel,
  processingModeOptions,
  processingModeUsesLocalAi,
  processingModeUsesVision,
  type DocumentProcessingMode
} from "./document-processing-mode.js";

const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|xml|log)$/i;
const DOCUMENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text"
]);
const SHEET_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "text/csv",
  "text/tab-separated-values"
]);

export function previewKind(
  mediaType: string,
  filename: string
): "text" | "pdf" | "image" | "document" | "sheet" | "none" {
  const type = mediaType.split(";")[0]!.trim().toLowerCase();
  if (type === "application/pdf" || /\.pdf$/i.test(filename)) return "pdf";
  if (type.startsWith("image/")) return "image";
  if (DOCUMENT_TYPES.has(type) || /\.(docx|odt)$/i.test(filename)) return "document";
  if (SHEET_TYPES.has(type) || /\.(xlsx|xlsm|csv|tsv)$/i.test(filename)) return "sheet";
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    TEXT_EXTENSIONS.test(filename)
  ) {
    return "text";
  }
  return "none";
}

export function documentProcessingFailureMessage(
  failure: unknown
): string {
  if (!(failure instanceof Error)) {
    return String(failure);
  }
  const code =
    failure instanceof ApiError
      ? failure.code
      : failure.message;
  const reason =
    failure instanceof ApiError
      ? failure.reason ?? ""
      : "";
  if (code.startsWith("DESKTOP_RUNTIME_PROXY_FAILED")) {
    return `Przetwarzanie dokumentu nie zakończyło się w limicie czasu połączenia z lokalnym runtime. Kod: ${code}`;
  }
  if (code !== "STORED_FILE_PROCESSING_FAILED") {
    return code;
  }
  if (reason === "LOCAL_PRIVACY_MODEL_NOT_READY") {
    return "Nie udało się przetworzyć dokumentu: tryb „z AI” wymaga uruchomionego modelu lokalnego. Użyj „Uruchom model lokalny” albo wybierz tryb bez AI.";
  }
  if (reason === "LOCAL_PRIVACY_MODEL_FAILED") {
    return "Nie udało się przetworzyć dokumentu: lokalny model nie odpowiedział podczas sprawdzania pliku. Spróbuj ponownie albo wybierz tryb bez AI.";
  }
  if (reason === "OCR_MODELS_INCOMPLETE") return OCR_MODELS_INCOMPLETE;
  const cause =
    reason === "OCR_REQUIRED" || reason === "OCR_ENGINE_MISSING"
      ? "dokument wymaga OCR, ale lokalny silnik OCR nie jest zainstalowany lub jest niekompletny"
      : reason === "OCR_ENGINE_START_FAILED"
        ? "nie udało się uruchomić lokalnego silnika OCR (Python)"
      : reason.startsWith("OCR_")
        ? "lokalny OCR nie przetworzył stron wymagających rozpoznania tekstu"
        : reason.startsWith("DOCUMENT_")
          ? "dokument przekracza limity bezpieczeństwa przetwarzania"
          : reason
            ? "błąd lokalnego przetwarzania dokumentu"
            : "nieokreślony błąd lokalnego przetwarzania dokumentu";
  return `Nie udało się przetworzyć dokumentu: ${cause}.${reason ? ` Kod: ${reason}` : ""}`;
}

function canRunPrivacyPipeline(
  item: WorkspaceItem
): boolean {
  return (
    item.kind === "UPLOAD" &&
    !item.archive &&
    (
      item.mediaType.startsWith("image/") ||
      item.mediaType === "application/pdf" ||
      item.mediaType === "text/plain" ||
      item.mediaType === "text/markdown" ||
      item.mediaType === "text/csv" ||
      item.mediaType === "text/tab-separated-values" ||
      item.mediaType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      item.mediaType ===
        "application/vnd.oasis.opendocument.text" ||
      item.mediaType ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      item.mediaType ===
        "application/vnd.ms-excel.sheet.macroenabled.12"
    )
  );
}

/** Short file type for the list ("DOCX", "PDF"); the full media type is in the tooltip. */
function fileTypeLabel(item: { filename: string; mediaType: string }): string {
  const extension = /\.([a-z0-9]{1,6})$/i.exec(item.filename)?.[1];
  if (extension) return extension.toUpperCase();
  const subtype = item.mediaType.split(";")[0]!.split("/")[1] ?? "";
  return subtype.length <= 8 ? subtype.toUpperCase() : "PLIK";
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function folderPath(folder: WorkspaceFolder, all: WorkspaceFolder[]): string {
  const names = [folder.name];
  let current = folder;
  const seen = new Set([folder.folderId]);
  while (current.parentId) {
    const parent = all.find((item) => item.folderId === current.parentId);
    if (!parent || seen.has(parent.folderId)) break;
    seen.add(parent.folderId);
    names.unshift(parent.name);
    current = parent;
  }
  return names.join(" / ");
}

function folderDepth(folder: WorkspaceFolder, all: WorkspaceFolder[]): number {
  let depth = 0;
  let parentId = folder.parentId;
  const seen = new Set<string>();
  while (parentId && depth < 8) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = all.find((item) => item.folderId === parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

type PrivacyPreviewQueueItem = {
  item: WorkspaceItem;
  mode: DocumentProcessingMode;
  request: PrivacyPreviewRequest;
};

export function WorkspaceManager({
  caseId,
  title,
  canWrite,
  refreshToken = 0,
  onArtifactRenamed
}: {
  caseId: string;
  title: string;
  canWrite: boolean;
  refreshToken?: number;
  // The chat cards show the same name, so the chat is told about a rename.
  onArtifactRenamed?: (artifactId: string, filename: string) => void;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [documentSearch, setDocumentSearch] =
    useState("");
  const [
    documentScope,
    setDocumentScope
  ] =
    useState<DocumentScopeFilter>(
      "ALL_CASE"
    );
  const [
    documentType,
    setDocumentType
  ] =
    useState<DocumentTypeFilter>(
      "ALL"
    );
  const [knowledgeHits, setKnowledgeHits] =
    useState<CaseKnowledgeHit[]>([]);
  const [
    knowledgeSearchBusy,
    setKnowledgeSearchBusy
  ] = useState(false);
  const [
    knowledgeSearchError,
    setKnowledgeSearchError
  ] = useState("");
  const [busy, setBusy] = useState(false);
  // Processing mode chosen per file (OCR only / with AI / anonymization).
  const [modeByItem, setModeByItem] = useState<Record<string, DocumentProcessingMode>>({});
  const modeFor = (item: WorkspaceItem): DocumentProcessingMode =>
    modeByItem[item.itemId] ?? DEFAULT_DOCUMENT_PROCESSING_MODE;
  const [localRuntime, setLocalRuntime] = useState<LocalModelsResponse["runtime"] | null>(null);
  const [localAiMessage, setLocalAiMessage] = useState("");
  // The processed file waiting for the user's confirmation in its preview; the next ones of
  // "Przetwórz wszystkie" wait in the queue.
  const [privacyPreview, setPrivacyPreview] = useState<PrivacyPreviewQueueItem | null>(null);
  const queuedPreviews = useRef<PrivacyPreviewQueueItem[]>([]);
  const privacyPreviewRef = useRef<PrivacyPreviewQueueItem | null>(null);
  // Why confirming the open preview failed, shown in the preview itself.
  const [previewError, setPreviewError] = useState("");
  const showPrivacyPreview = (next: PrivacyPreviewQueueItem | null) => {
    setPreviewError("");
    privacyPreviewRef.current = next;
    setPrivacyPreview(next);
  };
  const nextPreview = () => {
    const done = privacyPreviewRef.current;
    // A file of the queue leaves its list once its preview is confirmed or skipped.
    if (done) setQueue((current) => current.filter((entry) => !(entry.itemId === done.item.itemId && entry.status === "READY")));
    showPrivacyPreview(queuedPreviews.current.shift() ?? null);
  };
  // A file read by the queue while another preview is open waits for its turn.
  const offerPreview = (next: PrivacyPreviewQueueItem) => {
    if (privacyPreviewRef.current) queuedPreviews.current.push(next);
    else showPrivacyPreview(next);
  };
  // Files waiting for OCR and anonymization, processed one at a time in the order added;
  // the panel stays usable and more files can join while it runs.
  const [queue, setQueueState] = useState<ProcessingQueueEntry[]>([]);
  const queueRef = useRef<ProcessingQueueEntry[]>([]);
  const setQueue = (change: (current: ProcessingQueueEntry[]) => ProcessingQueueEntry[]) => {
    queueRef.current = change(queueRef.current);
    setQueueState(queueRef.current);
  };
  const queueRunning = useRef(false);
  const queuedItems = useRef(new Map<string, WorkspaceItem>());
  const caseRef = useRef(caseId);
  caseRef.current = caseId;
  const inQueue = (item: WorkspaceItem) => queue.some((entry) => entry.itemId === item.itemId && isActiveEntry(entry));
  const queueActive = queue.some(isActiveEntry);
  useEffect(() => {
    // Another case: its files are not this queue's; the file being read finishes and is dropped.
    queueRef.current = [];
    setQueueState([]);
    queuedItems.current.clear();
    queuedPreviews.current = [];
    showPrivacyPreview(null);
  }, [caseId]);
  const localAiReady = Boolean(localRuntime?.configured && localRuntime.state === "READY");
  useEffect(() => {
    let cancelled = false;
    getLocalModels()
      .then((models) => {
        if (!cancelled) setLocalRuntime(models.runtime);
      })
      .catch(() => {
        if (!cancelled) setLocalRuntime(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [artifacts, setArtifacts] = useState<CaseArtifact[]>([]);
  const [deanonymizing, setDeanonymizing] = useState<string | null>(null);
  const [renamingArtifact, setRenamingArtifact] = useState<string | null>(null);
  const [fileDeanonymize, setFileDeanonymize] = useState<{ itemId: string; documentId: string } | null>(null);
  const [caseFiles, setCaseFiles] =
    useState<StoredUploadResponse[]>([]);
  const [progressByItem, setProgressByItem] =
    useState<Record<string, Pick<ProcessingProgress, "stage" | "done" | "total">>>({});
  const [anonymized, setAnonymized] = useState<{
    item: WorkspaceItem;
    documentId: string;
    tab: "marked" | "text" | "key";
  } | null>(null);
    const [preview, setPreview] = useState<{
    item: WorkspaceItem;
    url?: string;
    pdf?: Blob;
    text?: string;
    encoding?: string;
    page?: number;
    document?: EditableDocument;
    sheet?: EditableSheets;
    supported: boolean;
  } | null>(null);

  async function refresh(): Promise<void> {
    if (!caseId) {
      setWorkspace(null);
      setCaseFiles([]);
      setArtifacts([]);
      return;
    }
    const [next, files] =
      await Promise.all([
        getWorkspace(caseId),
        listCaseFiles(caseId)
      ]);
    setWorkspace(next);
    setCaseFiles(files.uploads);
    setArtifacts(await listCaseArtifacts(caseId).catch(() => []));
    if (
      selectedFolder &&
      !next.folders.some(
        (item) =>
          item.folderId ===
          selectedFolder
      )
    ) {
      setSelectedFolder(null);
    }
  }

  const processedEntries = (workspace?.items ?? [])
    .filter((entry) => entry.kind === "UPLOAD")
    .map((entry) => ({
      filename: entry.filename,
      processing: caseFiles.find((file) => file.uploadId === entry.itemId)?.processing
    }))
    .filter((entry) => entry.processing && entry.processing.anonymized !== false);
  // Keys to deanonymize with: the case's shared key once, then documents that
  // still have their own key.
  const sharedKeyDocument = processedEntries.find((entry) => entry.processing!.sharedKey);
  const processedDocuments = [
    ...(sharedKeyDocument
      ? [{ filename: "Klucz sprawy (wspólny dla dokumentów)", documentId: sharedKeyDocument.processing!.documentId }]
      : []),
    ...processedEntries
      .filter((entry) => !entry.processing!.sharedKey)
      .map((entry) => ({ filename: `${entry.filename} (klucz osobny)`, documentId: entry.processing!.documentId }))
  ];
  const ownKeyDocuments = processedEntries.filter((entry) => !entry.processing!.sharedKey);

  async function joinAllKeys(): Promise<void> {
    await run(async () => {
      let remapped = 0;
      for (const entry of ownKeyDocuments) {
        remapped += (await joinSharedKey(caseId, entry.processing!.documentId)).remapped;
      }
      setNotice(
        `Połączono klucze ${ownKeyDocuments.length} dokumentów w klucz sprawy (przenumerowane symbole: ${remapped}). ` +
          "Ta sama osoba ma teraz jeden symbol we wszystkich dokumentach sprawy."
      );
    });
  }

  function processingFor(
    item: WorkspaceItem
  ): StoredUploadResponse["processing"] | undefined {
    return caseFiles.find(
      (file) =>
        file.uploadId ===
        item.itemId
    )?.processing;
  }

  // "Od razu do kolejki": files added in a group are read one after another without a click.
  const [autoQueue, setAutoQueue] = useState(false);
  const [googleImport, setGoogleImport] = useState(false);
  const pendingAutoQueue = useRef(new Set<string>());
  useEffect(() => {
    if (!workspace || !pendingAutoQueue.current.size) return;
    const items = workspace.items.filter((item) => pendingAutoQueue.current.has(item.itemId));
    if (!items.length) return;
    for (const item of items) pendingAutoQueue.current.delete(item.itemId);
    void processAll(items.filter((item) => canRunPrivacyPipeline(item) && !processingFor(item)));
  }, [workspace]);

  async function addFiles(
    files: FileList | null
  ): Promise<void> {
    if (
      !files ||
      files.length === 0
    ) {
      return;
    }
    await run(async () => {
      for (
        const file of
        Array.from(files)
      ) {
        const stored =
          await uploadCaseFile(
            caseId,
            file
          );
        if (autoQueue) pendingAutoQueue.current.add(stored.uploadId);
        if (selectedFolder) {
          await moveWorkspaceItem(
            caseId,
            stored.uploadId,
            selectedFolder
          );
        }
      }
      setNotice(
        autoQueue
          ? `Dodano ${files.length} plik(ów) do akt sprawy i do kolejki przetwarzania.`
          : `Dodano ${files.length} plik(ów) do akt sprawy.`
      );
    });
  }

  // Files from Gmail or Drive: stored by the runtime, then the same path as added files.
  async function addImported(uploadIds: string[]): Promise<void> {
    for (const uploadId of uploadIds) {
      if (autoQueue) pendingAutoQueue.current.add(uploadId);
      if (selectedFolder) await moveWorkspaceItem(caseId, uploadId, selectedFolder);
    }
    setNotice(`Dodano ${uploadIds.length} plik(ów) z Google do akt sprawy${autoQueue ? " i do kolejki przetwarzania" : ""}.`);
    await refresh();
  }

  // The models a mode needs: the vision model (OCR with AI) and an installed text model (anonymization with AI).
  async function modeReady(mode: DocumentProcessingMode, ocrFix = true): Promise<boolean> {
    // The text model is started by the runtime right before the anonymization; it only has to be installed.
    if (processingModeUsesLocalAi(mode) && !localRuntime?.configured) {
      setLocalAiMessage(
        `„${processingModeLabel(mode)}” wymaga zainstalowanego modelu lokalnego (panel lokalnej AI).`
      );
      return false;
    }
    if (processingModeUsesVision(mode) && ocrFix) {
      const vision = await getVisionOcrStatus().catch(() => null);
      if (!vision?.installed || !vision.engineInstalled) {
        setLocalAiMessage(
          `„${processingModeLabel(mode)}” wymaga modelu wizyjnego: zainstaluj go w panelu lokalnej AI.`
        );
        return false;
      }
    }
    return true;
  }

  // Stage and page counts of one file while its request runs; text never leaves the runtime.
  async function withItemProgress<T>(item: Pick<WorkspaceItem, "itemId">, action: (progressId: string) => Promise<T>): Promise<T> {
    const progressId = newProgressId();
    setProgressByItem((current) => ({ ...current, [item.itemId]: { stage: "READING" } }));
    const timer = window.setInterval(() => {
      void getProcessingProgress(caseId, progressId)
        .then((progress) => {
          if (progress) {
            setProgressByItem((current) =>
              current[item.itemId] ? { ...current, [item.itemId]: progress } : current
            );
          }
        })
        .catch(() => undefined);
    }, 500);
    try {
      return await action(progressId);
    } finally {
      window.clearInterval(timer);
      setProgressByItem((current) => {
        const { [item.itemId]: _done, ...rest } = current;
        return rest;
      });
    }
  }

  async function runAutomaticPrivacy(
    item: WorkspaceItem,
    mode: DocumentProcessingMode,
    // false = run the same mode again without the AI's OCR corrections
    ocrFix = true
  ): Promise<void> {
    if (!(await modeReady(mode, ocrFix))) return;
    await withItemProgress(item, (progressId) => runAutomaticPrivacySteps(item, progressId, mode, ocrFix));
  }

  /**
   * Files join the queue of the case; it reads them one at a time in the order added: the OCR
   * of every queued file first (with the AI, only the vision model works), then their personal
   * data (the text model starts once), then the preview of each, one after another.
   */
  async function processAll(items: WorkspaceItem[], clearConfirmed = false): Promise<void> {
    const fresh = items.filter((item) => !inQueue(item));
    if (!fresh.length) return;
    const modes = [...new Set(fresh.map(modeFor))];
    for (const mode of modes) if (!(await modeReady(mode))) return;
    const clear = fresh.filter((item) => processingModeKeepsClearText(modeFor(item)));
    if (
      clear.length &&
      !clearConfirmed &&
      !window.confirm(
        `${clear.map((item) => `„${item.filename}”`).join(", ")}: bez anonimizacji - tekst jawny trafi do modelu. Kontynuować?`
      )
    ) {
      return;
    }
    setError("");
    for (const item of fresh) queuedItems.current.set(item.itemId, item);
    setQueue((current) =>
      enqueueFiles(current, fresh.map((item) => ({ itemId: item.itemId, filename: item.filename, mode: modeFor(item) })))
    );
    void runQueue();
  }

  async function runQueue(): Promise<void> {
    if (queueRunning.current) return;
    queueRunning.current = true;
    const runCase = caseId;
    const reviews = new Map<string, DocumentReviewResponse>();
    try {
      while (caseRef.current === runCase) {
        const next = nextToRead(queueRef.current);
        if (next) {
          setQueue((current) => updateEntry(current, next.itemId, { status: "READING" }));
          try {
            const review = await withItemProgress(next, (progressId) =>
              processStoredCaseFile(runCase, next.itemId, undefined, progressId, { ...processingModeOptions(next.mode), detect: false })
            );
            reviews.set(next.itemId, review);
            setQueue((current) => updateEntry(current, next.itemId, { status: "READ" }));
          } catch (failure) {
            setQueue((current) => updateEntry(current, next.itemId, { status: "FAILED", error: documentProcessingFailureMessage(failure) }));
          }
          continue;
        }
        const read = readEntries(queueRef.current);
        if (!read.length) break;
        for (const entry of read) {
          if (caseRef.current !== runCase) break;
          const review = reviews.get(entry.itemId);
          const item = queuedItems.current.get(entry.itemId);
          if (!review || !item) {
            setQueue((current) => updateEntry(current, entry.itemId, { status: "FAILED", error: "Brak wyniku odczytu - dodaj plik ponownie." }));
            continue;
          }
          const keepClear = processingModeKeepsClearText(entry.mode);
          setQueue((current) => updateEntry(current, entry.itemId, { status: "DETECTING" }));
          try {
            const detected = keepClear
              ? review
              : await withItemProgress(entry, (progressId) =>
                  detectDocument(runCase, review.documentId, { localAi: processingModeOptions(entry.mode)?.localAi === true }, progressId)
                );
            reviews.delete(entry.itemId);
            setQueue((current) => updateEntry(current, entry.itemId, { status: "READY" }));
            offerPreview({ item, mode: entry.mode, request: { caseId: runCase, review: detected, fileName: entry.filename, keepClear } });
          } catch (failure) {
            setQueue((current) => updateEntry(current, entry.itemId, { status: "FAILED", error: documentProcessingFailureMessage(failure) }));
          }
        }
      }
    } finally {
      queueRunning.current = false;
      if (caseRef.current === runCase) {
        const summary = queueSummary(queueRef.current);
        if (summary.ready) setNotice(`Kolejka zakończona: ${summary.ready} plików czeka na podgląd i zatwierdzenie${summary.failed ? `, ${summary.failed} z błędem` : ""}.`);
        await refresh().catch(() => undefined);
      }
    }
  }

  function showAnonymized(item: WorkspaceItem, tab: "marked" | "text" | "key"): void {
    const documentId = processingFor(item)?.documentId;
    if (!documentId) return;
    if (preview?.item.itemId !== item.itemId) setPreview(null);
    setAnonymized({ item, documentId, tab });
  }

  async function runAutomaticPrivacySteps(
    item: WorkspaceItem,
    progressId: string,
    mode: DocumentProcessingMode,
    ocrFix: boolean
  ): Promise<void> {
    const keepClear = processingModeKeepsClearText(mode);
    const options = processingModeOptions(mode);
    await run(async () => {
      const review =
        await processStoredCaseFile(
          caseId,
          item.itemId,
          undefined,
          progressId,
          options ? { ...options, ...(ocrFix ? {} : { ocrFix: false }) } : undefined
        );
      // Finalized only after the preview (doubtful OCR lines, local AI hints, masks) is confirmed.
      offerPreview({
        item,
        mode,
        request: {
          caseId,
          review,
          fileName: item.filename,
          keepClear,
          ...(review.pages.some((page) => page.corrections?.length) && ocrFix
            ? { onUndoOcrFixes: () => { showPrivacyPreview(null); void runAutomaticPrivacy(item, mode, false); } }
            : {})
        }
      });
    });
  }

  async function confirmPrivacyPreview(directives: PagePrivacyDirective[]): Promise<void> {
    const pending = privacyPreview;
    if (!pending) return;
    setPreviewError("");
    await run(async () => {
      let result: Awaited<ReturnType<typeof finalizeDocument>>;
      try {
        result = await finalizeDocument(caseId, pending.request.review.documentId, directives, undefined, true);
      } catch (failure) {
        setPreviewError(privacyConfirmFailure(failure));
        return;
      }
      nextPreview();
      setNotice(
        `„${pending.item.filename}”: zatwierdzono po podglądzie · ${result.ocrPages} stron OCR · ${result.privacy.findings} anonimizacji · osobny vault/deanonimizator zapisany dla ${result.documentId}.`
      );
    });
  }

  useEffect(() => {
    let cancelled = false;
    if (!caseId) {
      setWorkspace(null);
      return;
    }
    setError("");
    void Promise.all([
      getWorkspace(caseId),
      listCaseFiles(caseId)
    ])
      .then(([next, files]) => {
        if (!cancelled) {
          setWorkspace(next);
          setCaseFiles(files.uploads);
        }
      })
      .then(() => listCaseArtifacts(caseId))
      .then((list) => {
        if (!cancelled && list) setArtifacts(list);
      })
      .catch((failure) => {
        if (!cancelled) {
          setError(documentProcessingFailureMessage(failure));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshToken]);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview?.url]);

  useEffect(() => {
    const query =
      documentSearch.trim();
    if (
      !caseId ||
      query.length < 2
    ) {
      setKnowledgeHits([]);
      setKnowledgeSearchError("");
      setKnowledgeSearchBusy(false);
      return;
    }

    let cancelled = false;
    setKnowledgeSearchBusy(true);
    setKnowledgeSearchError("");
    const timer =
      window.setTimeout(
        () => {
          void searchCaseKnowledge(
            caseId,
            query,
            24
          )
            .then((result) => {
              if (!cancelled) {
                setKnowledgeHits(
                  result.hits
                );
              }
            })
            .catch((failure) => {
              if (!cancelled) {
                setKnowledgeHits([]);
                setKnowledgeSearchError(
                  failure instanceof Error
                    ? failure.message
                    : String(
                        failure
                      )
                );
              }
            })
            .finally(() => {
              if (!cancelled) {
                setKnowledgeSearchBusy(
                  false
                );
              }
            });
        },
        250
      );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    caseId,
    documentSearch
  ]);

  const folders = useMemo(
    () => [...(workspace?.folders ?? [])].sort((a, b) =>
      folderPath(a, workspace?.folders ?? []).localeCompare(
        folderPath(b, workspace?.folders ?? []),
        "pl"
      )
    ),
    [workspace]
  );

  const rootFolderName =
    workspace?.caseDisplayName
      ?.trim() ||
    "Sprawa bez nazwy";

  const visibleItems =
    useMemo(() => {
      if (!workspace) {
        return [];
      }
      return filterWorkspaceItems(
        workspace,
        {
          query:
            documentSearch,
          selectedFolder,
          scope:
            documentScope,
          type:
            documentType,
          caseFiles,
          knowledgeHits
        }
      ).map(
        (entry) =>
          entry.item
      );
    }, [
      workspace,
      selectedFolder,
      documentSearch,
      documentScope,
      documentType,
      caseFiles,
      knowledgeHits
    ]);
  // Shown files never processed: "Przetwórz wszystkie", each in its chosen mode.
  const unprocessed = visibleItems.filter((item) => canRunPrivacyPipeline(item) && !processingFor(item) && !inQueue(item));

  function knowledgeHitFor(
    item: WorkspaceItem
  ): CaseKnowledgeHit | undefined {
    const documentId =
      caseFiles.find(
        (file) =>
          file.uploadId ===
          item.itemId
      )?.processing
        ?.documentId;
    if (!documentId) {
      return undefined;
    }
    return knowledgeHits.find(
      (hit) =>
        hit.documentId ===
        documentId
    );
  }

  function itemFolderLabel(
    item: WorkspaceItem
  ): string {
    if (!workspace) {
      return rootFolderName;
    }
    const folderId =
      workspace.itemLocations[
        item.itemId
      ] ?? null;
    if (!folderId) {
      return rootFolderName;
    }
    const folder =
      folders.find(
        (entry) =>
          entry.folderId ===
          folderId
      );
    return folder
      ? `${rootFolderName} / ${folderPath(
          folder,
          folders
        )}`
      : rootFolderName;
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(documentProcessingFailureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveRendered(
    filename: string,
    format: EditableFormat,
    model: EditableDocument | EditableSheets,
    delimiter?: string
  ): Promise<void> {
    const blob = await renderEditable(caseId, { format, model, ...(delimiter ? { delimiter } : {}) });
    const stored = await uploadCaseFile(caseId, new File([blob], filename, { type: blob.type }));
    if (selectedFolder) {
      await moveWorkspaceItem(caseId, stored.uploadId, selectedFolder);
    }
    await refresh();
  }

  async function saveEditedDocument(
    filename: string,
    format: "docx" | "odt",
    blocks: EditableBlock[]
  ): Promise<void> {
    await saveRendered(filename, format, { kind: "document", blocks });
  }

  async function saveEditedSheet(
    filename: string,
    format: "xlsx" | "csv" | "tsv",
    model: EditableSheets
  ): Promise<void> {
    await saveRendered(filename, format, model, format === "csv" ? model.delimiter : undefined);
  }

  async function saveEditedText(
    filename: string,
    text: string
  ): Promise<void> {
    const markdown = /\.(md|markdown)$/i.test(filename);
    const stored = await uploadCaseFile(
      caseId,
      new File([text], filename, {
        type: markdown ? "text/markdown" : "text/plain"
      })
    );
    if (selectedFolder) {
      await moveWorkspaceItem(caseId, stored.uploadId, selectedFolder);
    }
    await refresh();
  }

  async function showPreview(
    item: WorkspaceItem,
    page?: number
  ): Promise<void> {
    setBusy(true);
    setError("");
    // A processed document opens next to its anonymized version (no separate button).
    const documentId = processingFor(item)?.anonymized !== false ? processingFor(item)?.documentId : undefined;
    setAnonymized(documentId ? { item, documentId, tab: "marked" } : null);
    try {
      if (preview?.url) URL.revokeObjectURL(preview.url);
      const pageProps = page ? { page } : {};
      const officeKind = previewKind(item.mediaType, item.filename);
      if (officeKind === "document" || officeKind === "sheet") {
        const editable = await getEditableItem(caseId, item.itemId);
        setPreview(
          editable.model.kind === "document"
            ? { item, document: editable.model, ...pageProps, supported: true }
            : { item, sheet: editable.model, ...pageProps, supported: true }
        );
        return;
      }
      const result = await previewWorkspaceItem(caseId, item.itemId);
      const kind = previewKind(result.mediaType, item.filename);
      if (kind === "text") {
        const decoded = decodeTextFile(new Uint8Array(await result.blob.arrayBuffer()));
        setPreview({
          item,
          text: decoded.text,
          encoding: decoded.encoding,
          ...pageProps,
          supported: true
        });
        return;
      }
      if (kind === "pdf") {
        setPreview({ item, pdf: result.blob, ...pageProps, supported: true });
        return;
      }
      if (kind === "image") {
        setPreview({
          item,
          url: URL.createObjectURL(result.blob),
          ...pageProps,
          supported: true
        });
        return;
      }
      setPreview({ item, supported: false });
    } catch (failure) {
      setError(documentProcessingFailureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function openInSystem(item: WorkspaceItem): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await openWorkspaceItemInSystem(caseId, item.itemId);
    } catch (failure) {
      setError(documentProcessingFailureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!caseId) {
    return (
      <article className="chat-card workspace-manager">
        <h3>{title}</h3>
        <p>Najpierw wybierz sprawę.</p>
      </article>
    );
  }

  return (
    <article className="chat-card workspace-manager">
      <div className="chat-card-heading workspace-manager-heading">
        <div>
          <p className="eyebrow">Struktura katalogów</p>
          <h2>
            {title}
            <InfoTip>
              Foldery to szyfrowana struktura sprawy. „Główny katalog” jest wyświetlany pod nazwą sprawy: <strong>{rootFolderName}</strong>.
            </InfoTip>
          </h2>
        </div>
        <div className="workspace-header-actions">
          <label className="workspace-search">
            <span>Szukaj dokumentów</span>
            <input
              type="search"
              value={documentSearch}
              placeholder="Nazwa, treść, typ lub ID dokumentu"
              aria-label="Szukaj dokumentów w sprawie"
              onChange={(event) =>
                setDocumentSearch(
                  event.target.value
                )
              }
            />
          </label>
          <label className="workspace-filter">
            <span>Zakres</span>
            <select
              value={documentScope}
              disabled={
                !documentSearch.trim()
              }
              aria-label="Zakres wyszukiwania dokumentów"
              onChange={(event) =>
                setDocumentScope(
                  event.target
                    .value as DocumentScopeFilter
                )
              }
            >
              <option value="ALL_CASE">
                Cała sprawa
              </option>
              <option value="CURRENT_FOLDER">
                Bieżący folder
              </option>
            </select>
          </label>
          <label className="workspace-filter">
            <span>Typ</span>
            <select
              value={documentType}
              aria-label="Typ dokumentu"
              onChange={(event) =>
                setDocumentType(
                  event.target
                    .value as DocumentTypeFilter
                )
              }
            >
              <option value="ALL">
                Wszystkie
              </option>
              <option value="PDF">
                PDF
              </option>
              <option value="OFFICE">
                Office / ODT
              </option>
              <option value="IMAGE">
                Obrazy
              </option>
              <option value="TEXT">
                Tekst
              </option>
              <option value="ARCHIVE">
                Archiwa
              </option>
              <option value="TEMPLATE">
                Wzory
              </option>
            </select>
          </label>
          {documentSearch.trim() ||
          documentType !== "ALL" ||
          documentScope !== "ALL_CASE" ? (
            <button
              type="button"
              className="chat-secondary-action"
              onClick={() => {
                setDocumentSearch("");
                setDocumentScope(
                  "ALL_CASE"
                );
                setDocumentType(
                  "ALL"
                );
              }}
            >
              Wyczyść filtry
            </button>
          ) : null}
          {canWrite ? (
            <span className="workspace-local-ai-group">
              <small className="workspace-local-ai-state">
                Model tekstowy dla plików: {localAiReady ? "działa" : localRuntime?.configured ? "uruchomi się przed anonimizacją" : "nie zainstalowany"}
              </small>
              <InfoTip>Model tekstowy (np. Bielik) wskazuje dane osobowe w „anonimizacji z AI”. Uruchamia się sam, a na czas OCR jest wstrzymywany.</InfoTip>
              {localAiMessage ? <small className="workspace-local-ai-state" role="status">{localAiMessage}</small> : null}
            </span>
          ) : null}
          {canWrite ? (
            <span className="workspace-auto-queue-group">
              <label className="workspace-auto-queue">
                <input type="checkbox" checked={autoQueue} onChange={(event) => setAutoQueue(event.target.checked)} />
                Od razu do kolejki
              </label>
              <InfoTip>Dodane pliki od razu przechodzą OCR i anonimizację w domyślnym sposobie.</InfoTip>
            </span>
          ) : null}
          {canWrite ? (
            <label className="chat-secondary-action workspace-file-upload">
              + Dodaj pliki
              <input
                type="file"
                multiple
                hidden
                disabled={busy}
                onChange={(event) => {
                  void addFiles(
                    event.currentTarget.files
                  );
                  event.currentTarget.value = "";
                }}
              />
            </label>
          ) : null}
          {canWrite ? (
            <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => setGoogleImport(true)}>
              Importuj z Google
            </button>
          ) : null}
          {googleImport ? (
            <GoogleImportDialog caseId={caseId} onImported={addImported} onClose={() => setGoogleImport(false)} />
          ) : null}
          {canWrite && (unprocessed.length > 1 || (queueActive && unprocessed.length > 0)) ? (
            <span>
              <button
                type="button"
                className="chat-secondary-action"
                disabled={busy}
                onClick={() => void processAll(unprocessed)}
              >
                {queueActive ? `Dodaj do kolejki (${unprocessed.length})` : `Przetwórz wszystkie (${unprocessed.length})`}
              </button>
              <InfoTip>Najpierw OCR wszystkich plików, potem anonimizacja, potem podgląd każdego do zatwierdzenia. W trakcie można dodawać pliki.</InfoTip>
            </span>
          ) : null}
          <button
            type="button"
            className="chat-secondary-action"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Odśwież
          </button>
        </div>
      </div>

      <div className="workspace-manager-grid">
        <aside className="workspace-tree" aria-label="Foldery workspace">
          <button
            type="button"
            className={selectedFolder === null ? "workspace-folder active" : "workspace-folder"}
            onClick={() => setSelectedFolder(null)}
          >
            📁 {rootFolderName}
          </button>
          {folders.map((folder) => (
            <div key={folder.folderId} className="workspace-folder-row">
              <button
                type="button"
                className={selectedFolder === folder.folderId ? "workspace-folder active" : "workspace-folder"}
                style={{ paddingLeft: `${12 + folderDepth(folder, folders) * 14}px` }}
                title={folderPath(folder, folders)}
                onClick={() => setSelectedFolder(folder.folderId)}
              >
                📁 {folder.name}
              </button>
              {canWrite ? (
                <button
                  type="button"
                  className="workspace-icon-button"
                  title="Usuń pusty folder"
                  disabled={busy}
                  onClick={() => void run(async () => {
                    await deleteWorkspaceFolder(caseId, folder.folderId);
                    if (selectedFolder === folder.folderId) setSelectedFolder(null);
                  })}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}

          {canWrite ? (
            <div className="workspace-new-folder">
              <input
                value={newFolderName}
                maxLength={120}
                placeholder="Nazwa folderu"
                onChange={(event) => setNewFolderName(event.target.value)}
              />
              <button
                type="button"
                disabled={busy || !newFolderName.trim()}
                onClick={() => void run(async () => {
                  await createWorkspaceFolder(caseId, newFolderName.trim(), selectedFolder);
                  setNewFolderName("");
                })}
              >
                + Folder
              </button>
            </div>
          ) : null}
        </aside>

        <section className="workspace-items" aria-label="Pliki workspace">
          <div className="workspace-location-line">
            <strong>
              {documentSearch.trim()
                ? documentScope ===
                    "ALL_CASE"
                  ? "Wyniki w całej sprawie"
                  : "Wyniki w bieżącym folderze"
                : selectedFolder
                  ? folderPath(folders.find((item) => item.folderId === selectedFolder)!, folders)
                  : rootFolderName}
            </strong>
            <span>
              {visibleItems.length}
              {documentSearch.trim()
                ? " wyników"
                : " plików"}
              {knowledgeSearchBusy
                ? " · szukam w treści…"
                : ""}
            </span>
          </div>

          {visibleItems.length === 0 ? (
            <p className="workspace-empty">
              {documentSearch.trim()
                ? "Nie znaleziono dokumentów pasujących do wyszukiwania."
                : "Ten folder jest pusty."}
            </p>
          ) : (
            <ul className="workspace-file-list workspace-file-actions-list">
              {visibleItems.map((item) => (
                <li key={item.itemId}>
                  <div>
                    <strong title={item.filename}>{item.filename}</strong>
                    <span title={item.mediaType}>
                      {item.kind === "TEMPLATE" ? "Wzór" : "Dokument"} · {fileTypeLabel(item)} · {bytesLabel(item.bytes)}
                    </span>
                    {documentSearch.trim() ? (
                      <>
                        <small className="workspace-search-path">
                          {itemFolderLabel(
                            item
                          )}
                        </small>
                        {knowledgeHitFor(
                          item
                        ) ? (
                          <small className="workspace-search-snippet">
                            s. {knowledgeHitFor(item)!.pageStart}
                            {knowledgeHitFor(item)!.pageEnd !==
                            knowledgeHitFor(item)!.pageStart
                              ? `–${knowledgeHitFor(item)!.pageEnd}`
                              : ""}
                            {" · "}
                            {knowledgeHitFor(item)!.text}
                          </small>
                        ) : null}
                      </>
                    ) : null}
                    {item.kind === "UPLOAD" ? (
                      <small className="workspace-processing-status">
                        {processingFor(item) ? (
                          processingFor(item)!.anonymized === false ? (
                            <span className="anonymized-badge clear-text-badge" title="Przetworzony bez anonimizacji: tekst trafia do modeli w jawnej postaci">
                              Tekst jawny (bez anonimizacji)
                            </span>
                          ) : (
                            <span className="anonymized-badge" title="Dokument ma wersję zanonimizowaną i klucz anonimizacji">
                              {processingFor(item)!.sharedKey ? "Zanonimizowany · klucz sprawy" : "Zanonimizowany · klucz osobny"}
                            </span>
                          )
                        ) : null}
                        {processingFor(item)?.reviewed === false ? (
                          <span className="anonymized-badge clear-text-badge" title="Nie trafi do modelu spoza komputera, dopóki nie zatwierdzisz podglądu">
                            Niezatwierdzony
                          </span>
                        ) : null}
                        <span>
                          {processingFor(item)
                            ? processingFor(item)!.ocrPages > 0
                              ? `OCR: ${processingFor(item)!.ocrPages} z ${processingFor(item)!.totalPages} stron`
                              : `Tekst cyfrowy · ${processingFor(item)!.totalPages} ${processingFor(item)!.totalPages === 1 ? "strona" : "stron"}`
                            : "Nieprzetworzony - wybierz sposób przetwarzania i „Przetwórz”"}
                        </span>
                      </small>
                    ) : null}
                    {progressByItem[item.itemId] ? (
                      <div className="workspace-progress" role="status" aria-live="polite">
                        <progress max={100} value={progressPercent(progressByItem[item.itemId]!)} />
                        <small>{progressLabel(progressByItem[item.itemId]!)}</small>
                      </div>
                    ) : null}
                  </div>
                  <div className="workspace-item-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void showPreview(
                          item,
                          knowledgeHitFor(
                            item
                          )?.pageStart
                        )
                      }
                    >
                      {knowledgeHitFor(item)
                        ? `Podgląd s. ${knowledgeHitFor(item)!.pageStart}`
                        : "Podgląd"}
                    </button>
                    {processingFor(item)?.reviewed === false ? (
                      <button
                        type="button"
                        className="primary-button"
                        disabled={busy}
                        title="Dokument nie został jeszcze zatwierdzony po podglądzie i nie trafi do modelu spoza komputera"
                        onClick={() => showAnonymized(item, "marked")}
                      >
                        Podgląd i zatwierdzenie
                      </button>
                    ) : null}
                    {processingFor(item) && processingFor(item)!.anonymized !== false ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          title="Symbole zastępcze i dane, które zastępują (tylko na tym komputerze)"
                          onClick={() => showAnonymized(item, "key")}
                        >
                          Klucz anonimizacji
                        </button>
                      </>
                    ) : null}
                    {canWrite &&
                    item.kind === "UPLOAD" &&
                    !processingFor(item) &&
                    processedDocuments.length > 0 &&
                    /\.(txt|md|markdown|csv|tsv|docx|odt|xlsx|xlsm)$/i.test(item.filename) ? (
                      <button
                        type="button"
                        disabled={busy}
                        title="Plik z symbolami (np. odpowiedź zewnętrznego modelu): podstawia dane z klucza wybranego dokumentu"
                        onClick={() =>
                          setFileDeanonymize({ itemId: item.itemId, documentId: processedDocuments[0]!.documentId })
                        }
                      >
                        Deanonimizuj plik
                      </button>
                    ) : null}
                    {isDesktopShell() ? (
                      <button type="button" disabled={busy} onClick={() => void openInSystem(item)}>
                        Otwórz w systemie
                      </button>
                    ) : null}

                    {canWrite && inQueue(item) ? (
                      <span className="workspace-process" role="status">
                        <small>Kolejka: {queueStatusLabel(queue.find((entry) => entry.itemId === item.itemId)!, queue)}</small>
                        {queue.some((entry) => entry.itemId === item.itemId && entry.status === "QUEUED") ? (
                          <button type="button" onClick={() => setQueue((current) => removeQueued(current, item.itemId))}>
                            Usuń z kolejki
                          </button>
                        ) : null}
                      </span>
                    ) : canWrite && canRunPrivacyPipeline(item) ? (
                      <span className="workspace-process">
                        <select
                          aria-label={`Sposób przetwarzania: ${item.filename}`}
                          value={modeFor(item)}
                          disabled={busy}
                          title={DOCUMENT_PROCESSING_MODES.find((entry) => entry.mode === modeFor(item))?.title}
                          onChange={(event) =>
                            setModeByItem((current) => ({
                              ...current,
                              [item.itemId]: event.target.value as DocumentProcessingMode
                            }))
                          }
                        >
                          {DOCUMENT_PROCESSING_MODES.map((entry) => (
                            <option key={entry.mode} value={entry.mode} title={entry.title}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const mode = modeFor(item);
                            if (
                              processingModeKeepsClearText(mode) &&
                              !window.confirm(
                                `„${item.filename}” zostanie przetworzony bez anonimizacji. Wybrany do czatu trafi do modelu z danymi osobowymi w jawnej postaci. Kontynuować?`
                              )
                            ) {
                              return;
                            }
                            // One file at a time: while the queue runs, the file joins it.
                            if (queueActive) void processAll([item], true);
                            else void runAutomaticPrivacy(item, mode);
                          }}
                        >
                          {queueActive ? "Do kolejki" : "Przetwórz"}
                        </button>
                      </span>
                    ) : null}
                    {canWrite ? (
                      <div className="workspace-item-end">
                      <label className="workspace-move" title="Przenieś do folderu">
                        Folder
                        <select
                          value={workspace?.itemLocations[item.itemId] ?? ""}
                          disabled={busy}
                          aria-label={`Folder pliku ${item.filename}`}
                          onChange={(event) => void run(async () => {
                            await moveWorkspaceItem(caseId, item.itemId, event.target.value || null);
                          })}
                        >
                          <option value="">Główny ({rootFolderName})</option>
                          {folders.map((folder) => (
                            <option key={folder.folderId} value={folder.folderId}>
                              {folderPath(folder, folders)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="workspace-delete"
                        disabled={busy}
                        onClick={() => void run(async () => {
                          if (!window.confirm(`Usunąć plik „${item.filename}”?`)) return;
                          await deleteWorkspaceItem(caseId, item.itemId);
                          if (preview?.item.itemId === item.itemId) setPreview(null);
                        })}
                      >
                        Usuń
                      </button>
                      </div>
                    ) : null}
                  </div>
                  {fileDeanonymize?.itemId === item.itemId ? (
                    <div className="artifact-deanonymize">
                      <label>
                        Klucz dokumentu źródłowego{" "}
                        <select
                          value={fileDeanonymize.documentId}
                          onChange={(event) =>
                            setFileDeanonymize({ itemId: item.itemId, documentId: event.target.value })
                          }
                        >
                          {processedDocuments.map((entry) => (
                            <option key={entry.documentId} value={entry.documentId}>{entry.filename}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="chat-primary-action"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await deanonymizeUpload(caseId, item.itemId, fileDeanonymize.documentId);
                            setFileDeanonymize(null);
                            setNotice(
                              `Utworzono „${result.upload.filename}”: przywrócono ${result.restored} wartości.` +
                                (result.unresolved.length
                                  ? ` Symbole spoza klucza zostały bez zmian: ${result.unresolved.join(", ")}.`
                                  : "")
                            );
                          })
                        }
                      >
                        Deanonimizuj
                      </button>
                      <button type="button" onClick={() => setFileDeanonymize(null)}>Anuluj</button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canWrite && ownKeyDocuments.length > 0 && processedEntries.length > 1 ? (
        <p className="workspace-shared-key-note">
          {ownKeyDocuments.length} dokument(y) mają osobny klucz sprzed wprowadzenia klucza sprawy, więc ta sama
          osoba może mieć w nich różne symbole.{" "}
          <button type="button" disabled={busy} onClick={() => void joinAllKeys()}>
            Połącz klucze sprawy
          </button>
          <small>
            {" "}Dokumenty z symbolami utworzone wcześniej z tych plików deanonimizuj przed połączeniem.
          </small>
        </p>
      ) : null}

      {artifacts.length > 0 ? (
        <section className="workspace-artifacts" aria-label="Dokumenty utworzone przez model">
          <h4>Dokumenty utworzone przez model</h4>
          <ul>
            {artifacts.map((artifact) => {
              const source = artifact.sourceArtifactId
                ? artifacts.find((entry) => entry.artifactId === artifact.sourceArtifactId)
                : undefined;
              const derived = artifacts.filter((entry) => entry.sourceArtifactId === artifact.artifactId);
              const item: WorkspaceItem = {
                kind: "ARTIFACT",
                itemId: artifact.artifactId,
                filename: artifact.filename,
                mediaType: artifact.mediaType,
                bytes: artifact.bytes,
                createdAt: artifact.createdAt,
                archive: false
              };
              return (
                <li key={artifact.artifactId}>
                  <div>
                    <strong>{artifact.filename}</strong>
                    <small>
                      {new Date(artifact.createdAt).toLocaleString("pl-PL")} · {bytesLabel(artifact.bytes)}
                    </small>
                    <small className="workspace-processing-status">
                      {artifact.sensitivity === "PROTECTED" ? (
                        <span className="anonymized-badge">Z symbolami</span>
                      ) : (
                        <span className="anonymized-badge deanonymized-badge">Deanonimizowany</span>
                      )}
                      {source ? ` powstał z: ${source.filename}` : ""}
                      {derived.length ? ` · wersja z danymi: ${derived.map((entry) => entry.filename).join(", ")}` : ""}
                    </small>
                  </div>
                  <div className="workspace-item-actions">
                    <button type="button" disabled={busy} onClick={() => void showPreview(item)}>Podgląd</button>
                    {isDesktopShell() ? (
                      <button type="button" disabled={busy} onClick={() => void openInSystem(item)}>
                        Otwórz w systemie
                      </button>
                    ) : null}
                    {canWrite ? (
                      <button type="button" disabled={busy} onClick={() => setRenamingArtifact(artifact.artifactId)}>
                        Zmień nazwę
                      </button>
                    ) : null}
                    {canWrite && artifact.sensitivity === "PROTECTED" ? (
                      <button type="button" disabled={busy} onClick={() => setDeanonymizing(artifact.artifactId)}>
                        Deanonimizuj
                      </button>
                    ) : null}
                  </div>
                  {renamingArtifact === artifact.artifactId ? (
                    <ArtifactRenameForm
                      caseId={caseId}
                      artifactId={artifact.artifactId}
                      filename={artifact.filename}
                      onRenamed={(filename) => {
                        setRenamingArtifact(null);
                        setArtifacts((current) =>
                          current.map((entry) =>
                            entry.artifactId === artifact.artifactId ? { ...entry, filename } : entry
                          )
                        );
                        setNotice(`Zmieniono nazwę na „${filename}”.`);
                        onArtifactRenamed?.(artifact.artifactId, filename);
                      }}
                      onCancel={() => setRenamingArtifact(null)}
                    />
                  ) : null}
                  {deanonymizing === artifact.artifactId ? (
                    <ArtifactDeanonymize
                      caseId={caseId}
                      artifact={artifact}
                      onDone={(message) => {
                        setNotice(message);
                        void refresh();
                      }}
                      onCancel={() => setDeanonymizing(null)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* The original and its anonymized version side by side: corrections checked against the source. */}
      <div className={preview && anonymized && preview.item.itemId === anonymized.item.itemId ? "workspace-side-by-side" : "workspace-preview-stack"}>
      {preview ? (
        <section className="workspace-preview" aria-label="Podgląd pliku">
          <div className="workspace-preview-head">
            <div>
              <strong>{preview.item.filename}</strong>
              <small>
                {preview.item.mediaType}
                {preview.page
                  ? ` · trafienie na s. ${preview.page}`
                  : ""}
              </small>
            </div>
            <button type="button" onClick={() => setPreview(null)}>Zamknij</button>
          </div>
          {preview.text !== undefined ? (
            <TextFileEditor
              key={preview.item.itemId}
              filename={preview.item.filename}
              mediaType={preview.item.mediaType}
              initialText={preview.text}
              encoding={preview.encoding ?? "utf-8"}
              readOnly={!canWrite}
              onSave={saveEditedText}
            />
          ) : preview.document ? (
            <DocumentEditor
              key={preview.item.itemId}
              filename={preview.item.filename}
              format={documentFormatFor(preview.item.mediaType, preview.item.filename)}
              blocks={preview.document.blocks}
              readOnly={!canWrite}
              onSave={saveEditedDocument}
            />
          ) : preview.sheet ? (
            <SheetEditor
              key={preview.item.itemId}
              filename={preview.item.filename}
              format={sheetFormatFor(preview.item.mediaType, preview.item.filename)}
              model={preview.sheet}
              macros={/\.xlsm$/i.test(preview.item.filename) || preview.item.mediaType.includes("macroenabled")}
              readOnly={!canWrite}
              onSave={saveEditedSheet}
            />
          ) : preview.pdf ? (
            <PdfPreview
              blob={preview.pdf}
              filename={preview.item.filename}
              {...(preview.page ? { initialPage: preview.page } : {})}
            />
          ) : preview.url ? (
            <img src={preview.url} alt={`Podgląd ${preview.item.filename}`} />
          ) : (
            <p>
              Brak bezpiecznego podglądu tego formatu. Użyj „Otwórz w systemie”.
            </p>
          )}
        </section>
      ) : null}
      {anonymized ? (
        <AnonymizedDocumentView
          key={`${anonymized.documentId}-${anonymized.tab}`}
          caseId={caseId}
          documentId={anonymized.documentId}
          filename={anonymized.item.filename}
          {...(anonymized.item.itemId.startsWith("upload_") ? { uploadId: anonymized.item.itemId } : {})}
          readOnly={!canWrite}
          initialTab={anonymized.tab}
          onClose={() => setAnonymized(null)}
        />
      ) : null}
      </div>

      {knowledgeSearchError &&
      documentSearch.trim().length >= 2 ? (
        <p className="workspace-search-note">
          Wyszukiwanie po nazwie działa. Indeks treści dokumentów jest chwilowo niedostępny: {knowledgeSearchError}
        </p>
      ) : null}
      {queue.length ? (
        <section className="workspace-queue" aria-label="Kolejka przetwarzania">
          <header>
            <strong>
              Kolejka przetwarzania · {(() => {
                const summary = queueSummary(queue);
                return `w toku ${summary.running} · czeka ${summary.waiting} · do podglądu ${summary.ready}${summary.failed ? ` · błędy ${summary.failed}` : ""}`;
              })()}
            </strong>
            {queue.some((entry) => entry.status === "QUEUED") ? (
              <button type="button" onClick={() => setQueue(stopQueued)} title="Pliki czekające na OCR wypadają z kolejki; bieżący plik kończy się normalnie">
                Zatrzymaj kolejkę
              </button>
            ) : null}
            {queue.some((entry) => !isActiveEntry(entry)) ? (
              <button type="button" onClick={() => setQueue(clearFinished)}>
                Wyczyść zakończone
              </button>
            ) : null}
          </header>
          <ol>
            {queue.map((entry) => (
              <li key={entry.itemId} className={`workspace-queue-${entry.status.toLowerCase()}`}>
                <span>{entry.filename}</span>
                <small>{queueStatusLabel(entry, queue)}</small>
                {progressByItem[entry.itemId] ? (
                  <progress max={100} value={progressPercent(progressByItem[entry.itemId]!)} />
                ) : null}
                {entry.status === "FAILED" ? (
                  <>
                    <small className="chat-inline-error">{entry.error}</small>
                    {queuedItems.current.get(entry.itemId) ? (
                      <button type="button" disabled={busy} onClick={() => void processAll([queuedItems.current.get(entry.itemId)!])}>
                        Ponów
                      </button>
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {notice ? <p className="workspace-notice">{notice}</p> : null}
      {privacyPreview ? (
        <PrivacyPreview
          {...privacyPreview.request}
          busy={busy}
          confirmError={previewError}
          onConfirm={(directives) => void confirmPrivacyPreview(directives)}
          onCancel={nextPreview}
        />
      ) : null}
      {error ? <p className="chat-inline-error">{error}</p> : null}
    </article>
  );
}
