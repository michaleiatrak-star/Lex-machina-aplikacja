import { useState } from "react";
import { renameCaseArtifact } from "./api.js";
import {
  artifactRenameErrorMessage,
  artifactStemProblem,
  splitArtifactFilename
} from "./artifact-filename.js";

// Renames a document made by a model (case files and chat card): the user edits
// the name, the extension stays; the runtime validates again and stores it.
export function ArtifactRenameForm(props: {
  caseId: string;
  artifactId: string;
  filename: string;
  onRenamed: (filename: string) => void;
  onCancel: () => void;
}) {
  const { stem: initialStem, extension } = splitArtifactFilename(props.filename);
  const [stem, setStem] = useState(initialStem);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problem = artifactStemProblem(stem, extension);

  async function save(): Promise<void> {
    if (problem || busy) return;
    if (stem.trim() + extension === props.filename) {
      props.onCancel();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await renameCaseArtifact(props.caseId, props.artifactId, stem + extension);
      props.onRenamed(result.filename);
    } catch (failure) {
      setError(artifactRenameErrorMessage(failure instanceof Error ? failure.message : String(failure)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="artifact-rename-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label>
        Nowa nazwa pliku{" "}
        <input
          value={stem}
          autoFocus
          maxLength={180}
          aria-invalid={problem ? true : undefined}
          onChange={(event) => setStem(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onCancel();
          }}
        />
        {extension ? <span className="artifact-rename-extension">{extension}</span> : null}
      </label>
      <button type="submit" disabled={busy || Boolean(problem)}>Zapisz nazwę</button>
      <button type="button" disabled={busy} onClick={props.onCancel}>Anuluj</button>
      {problem && stem !== initialStem ? <p className="chat-inline-error">{problem}</p> : null}
      {error ? <p className="chat-inline-error">{error}</p> : null}
    </form>
  );
}
