import { useEffect, useState } from "react";
import { ApiError, previewProvision, type ProvisionPreview as Preview } from "./api.js";
import { SourcePreviewFrame } from "./SourcePreviewFrame.js";

/**
 * The cited provision from the local copy of the ELI text, opened on the
 * marked passage; without a local copy, the official source in the frame.
 */
export function ProvisionPreview({ claim, sourceUrl }: { claim: string; sourceUrl?: string }) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; preview: Preview } | { kind: "missing" } | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    previewProvision(claim, sourceUrl)
      .then((preview) => active && setState({ kind: "ready", preview }))
      .catch((failure: unknown) => {
        if (!active) return;
        if (failure instanceof ApiError && failure.code === "PROVISION_NOT_IN_LOCAL_COPY") setState({ kind: "missing" });
        else setState({ kind: "error", message: failure instanceof Error ? failure.message : String(failure) });
      });
    return () => {
      active = false;
    };
  }, [claim, sourceUrl]);

  if (state.kind === "loading") return <p className="field-help">Wczytywanie przepisu…</p>;
  if (state.kind === "error") return <p className="chat-inline-error">Nie udało się wczytać przepisu ({state.message}).</p>;
  if (state.kind === "missing") {
    return sourceUrl ? (
      <>
        <p className="field-help">Tego przepisu nie ma w lokalnej kopii; poniżej oficjalny tekst bez zaznaczenia.</p>
        <SourcePreviewFrame target={{ kind: "url", url: sourceUrl }} />
      </>
    ) : (
      <p className="field-help">Tego przepisu nie ma w lokalnej kopii.</p>
    );
  }
  const { preview } = state;
  return (
    <>
      {!preview.unitFound ? (
        <p className="field-help">Nie wyodrębniono {preview.unit} w tekście kopii; zaznaczono cały artykuł.</p>
      ) : null}
      <SourcePreviewFrame
        target={{ kind: "record", key: `${preview.eli}:${preview.article}:${preview.unit ?? ""}`, html: preview.html, anchor: preview.anchor }}
      />
    </>
  );
}
