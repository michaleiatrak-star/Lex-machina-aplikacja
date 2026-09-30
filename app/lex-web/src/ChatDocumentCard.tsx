import { useState } from "react";
import {
  downloadGeneratedArtifact,
  isDesktopShell,
  listCaseArtifacts,
  type CaseArtifact
} from "./api.js";
import { ArtifactDeanonymize } from "./ArtifactDeanonymize.js";
import { DocumentEditor } from "./DocumentEditor.js";
import { downloadBlob } from "./download-file.js";
import {
  getEditableItem,
  openWorkspaceItemInSystem,
  type EditableBlock,
  type GeneratedDocumentRef
} from "./workspace-client.js";

// A document generated in a chat message, shown like a file in a chat app:
// download, preview in place, open in Word (desktop) and machine deanonymization
// of the alias symbols (the password confirms, values come from the case key).
export function ChatDocumentCard(props: {
  caseId: string;
  document: GeneratedDocumentRef;
  canWrite: boolean;
}) {
  const { caseId, document } = props;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<EditableBlock[] | null>(null);
  const [deanonymize, setDeanonymize] = useState<CaseArtifact | null>(null);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-document-card">
      <div className="chat-document-card-head">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
          <path
            d="M6 2h8l4 4v16H6z M14 2v4h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        <div>
          <strong>{document.filename}</strong>
          <small>
            {document.format.toUpperCase()}
            {document.tokenized ? " · z symbolami danych osobowych" : ""}
          </small>
        </div>
      </div>
      <div className="chat-document-card-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const blob = await downloadGeneratedArtifact(caseId, document.artifactId);
              const saved = await downloadBlob(blob, document.filename);
              setStatus(saved ? `Zapisano: ${saved}` : "Pobieranie rozpoczęte.");
            })
          }
        >
          Pobierz
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (preview) {
                setPreview(null);
                return;
              }
              const editable = await getEditableItem(caseId, document.artifactId);
              if (editable.model.kind !== "document") throw new Error("PREVIEW_UNSUPPORTED");
              setPreview(editable.model.blocks);
            })
          }
        >
          {preview ? "Zwiń podgląd" : "Podgląd"}
        </button>
        {isDesktopShell() ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => openWorkspaceItemInSystem(caseId, document.artifactId))}
          >
            Otwórz w Wordzie
          </button>
        ) : null}
        {document.tokenized && props.canWrite ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (deanonymize) {
                  setDeanonymize(null);
                  return;
                }
                const artifact = (await listCaseArtifacts(caseId))
                  .find((item) => item.artifactId === document.artifactId);
                if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
                setDeanonymize(artifact);
              })
            }
          >
            Deanonimizuj
          </button>
        ) : null}
      </div>
      {status ? <p className="chat-inline-success">{status}</p> : null}
      {error ? <p className="chat-inline-error">{error}</p> : null}
      {deanonymize ? (
        <ArtifactDeanonymize
          caseId={caseId}
          artifact={deanonymize}
          // Stays open: after finalizing it offers the one-time download of the
          // deanonymized file; "Zamknij" closes it.
          onDone={(message) => setStatus(message)}
          onCancel={() => setDeanonymize(null)}
        />
      ) : null}
      {preview ? (
        <div className="chat-document-preview">
          <DocumentEditor
            filename={document.filename}
            format={document.format}
            blocks={preview}
            readOnly
            onSave={async () => undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
