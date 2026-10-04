import { useEffect, useState } from "react";
import { ApiError, previewCaseLaw, type CaseLawPreview as Preview } from "./api.js";
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

const ERRORS: Record<string, string> = {
  SOURCE_PREVIEW_HOST_NOT_ALLOWED: "Pełny tekst jest dostępny tylko z oficjalnych źródeł orzeczeń i interpretacji.",
  CASE_PREVIEW_TEXT_EMPTY: "Źródło nie zwróciło tekstu rozstrzygnięcia."
};

/**
 * The whole judgment, decision or interpretation from its official source with
 * the passage the answer relies on marked: the model may have read it wrongly,
 * so the context is checked by hand.
 */
export function CaseLawPreview(props: { sourceUrl: string; passage?: string; signature?: string; attributed?: string }) {
  const { sourceUrl, passage, signature, attributed } = props;
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
  return (
    <SourcePreviewFrame
      target={{ kind: "record", key: `case:${preview.url}:${passage ?? signature ?? ""}`, html: preview.html, ...(preview.match === "NONE" ? {} : { anchor: preview.anchor }) }}
    />
  );
}
