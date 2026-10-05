import { useEffect, useState } from "react";
import { ApiError, copyCaseLaw, previewCaseLaw, type CaseLawCopy, type CaseLawPreview as Preview } from "./api.js";
import { SourcePreviewFrame } from "./SourcePreviewFrame.js";

// Hosts of judgments, decisions and interpretations: the full text is previewed.
const CASE_HOSTS = /(^|\.)(sn\.pl|orzeczenia\.nsa\.gov\.pl|saos\.org\.pl|orzeczenia\.uzp\.gov\.pl|eureka\.mf\.gov\.pl|uodo\.gov\.pl|curia\.europa\.eu)$/i;

export function isCaseLawSource(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return CASE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** The answer's line citing the signature: what the decision is said to hold. */
export function attributedSentence(answer: string | undefined, signature: string | undefined): string | undefined {
  if (!answer || !signature) return undefined;
  const wanted = signature.replace(/\s+/g, " ").trim().toLocaleUpperCase("pl");
  return answer
    .split(/\r?\n/)
    .map((line) => line.replace(/✅\s*\[[^\]]*\]|⚠️?\s*\[[^\]]*\]|🔗\s*\[[^\]]*\]/gu, "").trim())
    .find((line) => line.replace(/\s+/g, " ").toLocaleUpperCase("pl").includes(wanted));
}

/**
 * The decision as a text document for the case's files (local RAG): the card
 * is the source, the text is the copy downloaded into the application.
 */
export function caseLawDocument(copy: CaseLawCopy): File {
  const title = [copy.court, copy.form, copy.signature, copy.date].filter(Boolean).join(" ");
  const header = [
    `Orzeczenie: ${title || copy.cardUrl}`,
    `Karta orzeczenia (źródło): ${copy.cardUrl}`,
    `Tekst pobrany: ${copy.fetchedAt.slice(0, 16).replace("T", " ")} UTC · SHA-256: ${copy.sha256}`,
    ""
  ].join("\n");
  const name = `Orzeczenie ${(copy.signature ?? copy.court).replace(/[\\/:*?"<>|]+/g, "-").trim()}${copy.date ? ` z ${copy.date}` : ""}.txt`;
  return new File([`${header}\n${copy.text}\n`], name, { type: "text/plain" });
}

const ERRORS: Record<string, string> = {
  SOURCE_PREVIEW_HOST_NOT_ALLOWED: "Pełny tekst jest dostępny tylko z oficjalnych źródeł orzeczeń i interpretacji.",
  CASE_PREVIEW_TEXT_EMPTY: "Źródło nie zwróciło tekstu rozstrzygnięcia."
};

/**
 * The whole judgment, decision or interpretation from its official source with
 * the passage the answer relies on marked: the model may have read it wrongly,
 * so the context is checked by hand.
 */
export function CaseLawPreview(props: {
  sourceUrl: string;
  passage?: string;
  signature?: string;
  attributed?: string;
  // Saves the decision in the case's files; resolves to the stored file name.
  onSaveToCase?: (file: File) => Promise<void>;
}) {
  const { sourceUrl, passage, signature, attributed, onSaveToCase } = props;
  const [saving, setSaving] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "done"; name: string } | { kind: "error"; message: string }>({
    kind: "idle"
  });
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; preview: Preview } | { kind: "error"; message: string }>({
    kind: "loading"
  });

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    previewCaseLaw({
      sourceUrl,
      ...(passage ? { passage } : {}),
      ...(signature ? { signature } : {}),
      ...(attributed ? { attributed } : {})
    })
      .then((preview) => active && setState({ kind: "ready", preview }))
      .catch((failure: unknown) => {
        if (!active) return;
        const code = failure instanceof ApiError ? failure.code : failure instanceof Error ? failure.message : String(failure);
        setState({ kind: "error", message: ERRORS[code] ?? `Nie udało się wczytać pełnego tekstu (${code}).` });
      });
    return () => {
      active = false;
    };
  }, [sourceUrl, passage, signature, attributed]);

  if (state.kind === "loading") return <p className="field-help">Wczytywanie pełnego tekstu ze źródła…</p>;
  if (state.kind === "error") {
    return (
      <>
        <p className="chat-inline-error">{state.message}</p>
        <SourcePreviewFrame target={{ kind: "url", url: sourceUrl }} />
      </>
    );
  }
  const { preview } = state;
  const save = async () => {
    if (!onSaveToCase) return;
    setSaving({ kind: "saving" });
    try {
      const file = caseLawDocument(await copyCaseLaw({ sourceUrl, ...(signature ? { signature } : {}) }));
      await onSaveToCase(file);
      setSaving({ kind: "done", name: file.name });
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : failure instanceof Error ? failure.message : String(failure);
      setSaving({ kind: "error", message: ERRORS[code] ?? `Nie udało się zapisać w aktach (${code}).` });
    }
  };
  return (
    <>
      {onSaveToCase ? (
        <p className="field-help">
          <button type="button" className="chat-secondary-action" disabled={saving.kind === "saving" || saving.kind === "done"} onClick={() => void save()}>
            {saving.kind === "saving" ? "Zapisywanie w aktach…" : saving.kind === "done" ? "Zapisano w aktach sprawy" : "Zapisz w aktach sprawy"}
          </button>{" "}
          {saving.kind === "done" ? `${saving.name} (z linkiem do karty orzeczenia)` : null}
          {saving.kind === "error" ? <span className="chat-inline-error">{saving.message}</span> : null}
        </p>
      ) : null}
      <SourcePreviewFrame
        target={{ kind: "record", key: `case:${preview.url}:${passage ?? signature ?? ""}`, html: preview.html, ...(preview.match === "NONE" ? {} : { anchor: preview.anchor }) }}
      />
    </>
  );
}
