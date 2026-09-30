import { useEffect, useState } from "react";
import { ApiError, previewMcpSource } from "./api.js";
import { PdfPreview } from "./PdfPreview.js";

const ERRORS: Record<string, string> = {
  SOURCE_PREVIEW_HOST_NOT_ALLOWED: "Podgląd jest dostępny tylko dla oficjalnych źródeł (CBOSA, SAOS, EUREKA, UODO, ISAP/ELI, EUR-Lex, SN). Użyj „Otwórz w źródle”.",
  SOURCE_PREVIEW_TOO_LARGE: "Strona źródła jest zbyt duża do podglądu. Użyj „Otwórz w źródle”."
};

// The source page, fetched by the runtime without scripts, in a sandboxed frame
// (no scripts, no forms, no navigation of the app); a PDF opens in the PDF viewer.
export function SourcePreviewFrame(props: { url: string }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "html"; blobUrl: string }
    | { kind: "pdf"; blob: Blob }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;
    setState({ kind: "loading" });
    void previewMcpSource(props.url)
      .then((preview) => {
        if (cancelled) return;
        if (preview.kind === "pdf") {
          const bytes = Uint8Array.from(atob(preview.base64), (char) => char.charCodeAt(0));
          setState({ kind: "pdf", blob: new Blob([bytes], { type: "application/pdf" }) });
          return;
        }
        blobUrl = URL.createObjectURL(new Blob([preview.html], { type: "text/html;charset=utf-8" }));
        setState({ kind: "html", blobUrl });
      })
      .catch((failure) => {
        if (cancelled) return;
        const code = failure instanceof ApiError ? failure.code : failure instanceof Error ? failure.message : String(failure);
        setState({ kind: "error", message: ERRORS[code] ?? `Nie udało się wczytać źródła (${code}).` });
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [props.url]);

  if (state.kind === "loading") return <p className="field-help">Wczytywanie źródła…</p>;
  if (state.kind === "error") return <p className="chat-inline-error">{state.message}</p>;
  if (state.kind === "pdf") return <PdfPreview blob={state.blob} filename={props.url} />;
  return (
    <iframe
      className="source-preview-frame"
      title={`Podgląd źródła: ${props.url}`}
      src={state.blobUrl}
      sandbox=""
      referrerPolicy="no-referrer"
    />
  );
}
