import { useEffect, useState } from "react";
import { ApiError, copyCaseLaw, previewCaseLaw, type CaseLawCopy, type CaseLawPreview as Preview } from "./api.js";
import { SourcePreviewFrame } from "./SourcePreviewFrame.js";

// Hosts of judgments, decisions and interpretations: the full text is previewed.
const CASE_HOSTS =
  /(^|\.)(sn\.pl|orzeczenia\.nsa\.gov\.pl|saos\.org\.pl|orzeczenia\.uzp\.gov\.pl|eureka\.mf\.gov\.pl|uodo\.gov\.pl|curia\.europa\.eu|orzeczenia\.ms\.gov\.pl|orzeczenia\.[a-z0-9-]+\.(sr|so|sa)\.gov\.pl|ipo\.trybunal\.gov\.pl|otkzu\.trybunal\.gov\.pl|etpcz\.ms\.gov\.pl)$/i;

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

// Repertories of Sąd Najwyższy (as in the runtime's court-of-signature).
const SN_REPERTORIES =
  "CSKP|CSK|NKK|KK|UK|NSNC|NSNU|NKN|CNPP|CNP|SDI|ZK|CZP|KZP|UZP|PZP|NSNZP|SNO|DSI|DSP|CZ|KO|KSP|NSW";
const SN_SIGNATURE = new RegExp(`(?<![\\p{L}\\d])(?:[IVXL]{1,5}\\s+)?(?:${SN_REPERTORIES})\\s+\\d{1,6}\\/\\d{2,4}(?![\\p{L}\\d])`, "u");

export type CaseLawReference =
  | { kind: "CARD"; cardUrl: string }
  | { kind: "SIGNATURE"; signature: string; link: string }
  | { kind: "BLOB_WITHOUT_SIGNATURE"; link: string };

/**
 * Decisions the user points to in a message: a card (sn.pl ?orzeczenie=ID,
 * CBOSA /doc/…, UZP, SAOS), or a blob:/old PDF address of sn.pl. A blob:
 * address lives only in the browser tab that made it, so the decision is
 * taken from sn.pl by the signature in the same message.
 */
export function caseLawReferences(text: string): CaseLawReference[] {
  const found: CaseLawReference[] = [];
  const signature = SN_SIGNATURE.exec(text.normalize("NFKC"))?.[0]?.replace(/\s+/g, " ");
  for (const match of text.matchAll(/(?:blob:)?https?:\/\/[^\s<>"')\]]+/giu)) {
    const link = match[0].replace(/[.,;:]+$/, "");
    if (/^blob:/i.test(link) || /\/sites\/orzecznictwo\//i.test(link)) {
      found.push(signature ? { kind: "SIGNATURE", signature, link } : { kind: "BLOB_WITHOUT_SIGNATURE", link });
      continue;
    }
    // Cards of single decisions only (not search pages or news).
    if (
      /sn\.pl\/.*[?&]orzeczenie=[\w-]{6,80}/iu.test(link) ||
      /orzeczenia\.nsa\.gov\.pl\/doc\/[0-9A-F]{6,}/iu.test(link) ||
      /saos\.org\.pl\/judgments\/\d+/iu.test(link) ||
      /orzeczenia\.uzp\.gov\.pl\/Home\/Details\/\d+/iu.test(link) ||
      /orzeczenia\.(ms|[a-z0-9-]+\.(sr|so|sa))\.gov\.pl\/(content|details)\/\$N\/[\w.-]{10,}/iu.test(link) ||
      /(ipo|otkzu)\.trybunal\.gov\.pl\/\S*(dokument|sprawa|Sprawa)=?/u.test(link) ||
      // OTK ZU: position of the official collection (/2023/A/43) or its PDF (downloadOTK?mpo=).
      /otkzu\.trybunal\.gov\.pl\/(\d{4}\/[AB]\/\d+|downloadOTK\?mpo=\d+)/u.test(link) ||
      // ECHR (Ministry of Justice database): text or details of a decision.
      /etpcz\.ms\.gov\.pl\/(etpccontent|detailsetpc)\/\$N\/[\w.-]{10,}/iu.test(link)
    ) {
      found.push({ kind: "CARD", cardUrl: link });
    }
  }
  return found.filter((item, index) => found.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === index).slice(0, 3);
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
  onSaveToCase?: (file: File) => Promise<unknown>;
  // The case whose copy of the decision is used for marking the quote.
  caseId?: string;
}) {
  const { sourceUrl, passage, signature, attributed, onSaveToCase, caseId } = props;
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
      ...(attributed ? { attributed } : {}),
      ...(caseId ? { caseId } : {})
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
  }, [sourceUrl, passage, signature, attributed, caseId]);

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
      const file = caseLawDocument(await copyCaseLaw({ sourceUrl, ...(signature ? { signature } : {}), ...(caseId ? { caseId } : {}) }));
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
