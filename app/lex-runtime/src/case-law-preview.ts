import { supremeCourtFullTextHtml, type CaseLawFetch } from "./case-law-verifier.js";
import { LocalPdfTextExtractor } from "./pdf-text-extractor.js";
import { allowedPreviewUrl, fetchSourcePreview, type PreviewFetch } from "./source-preview.js";
import { createHash } from "node:crypto";
import { caseLawRepository, courtOfCard, type StoredCaseLaw } from "./case-law-store.js";
import { decodeEntities, documentText } from "./official-text.js";

export { documentText };

/**
 * The whole text of a judgment, decision or interpretation (SN, NSA/WSA,
 * common courts via SAOS, KIO, EUREKA, UODO, TSUE) with the passage the answer
 * relies on marked: the model may have read the decision wrongly, so the user
 * checks the cited passage in its full context. Fetched from the official
 * source (allow-listed hosts), never from the model.
 */
export type CaseLawPreview = {
  url: string;
  html: string;
  anchor: string;
  // EXACT: the cited passage; PARTIAL: its beginning; SIGNATURE: no passage
  // found, the case number is marked; NONE: nothing to mark.
  match: "EXACT" | "PARTIAL" | "SIGNATURE" | "NONE";
  chars: number;
  // LOCAL: the copy saved in the application when the decision was first downloaded.
  source?: "LOCAL" | "NETWORK";
  storedAt?: string;
};

export const CASE_PREVIEW_ANCHOR = "lex-case-quote";
const CACHE_MS = 30 * 60_000;
const CACHE_ITEMS = 30;
const MAX_FRAGMENT = 4000;
const SAOS_JUDGMENT = /^\/judgments\/(\d{1,12})\/?$/;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}


// One comparable form for the source text and the cited passage: case, dots,
// quotation marks, dashes and whitespace do not decide a match (as in the
// SN quote check). map[i] is the source index of normalized character i.
function comparable(value: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let space = true;
  for (let index = 0; index < value.length; index += 1) {
    let char = value[index]!.normalize("NFKC");
    if (char === "." || char === "­") continue;
    if (/\s/u.test(char)) {
      if (!space) {
        text += " ";
        map.push(index);
      }
      space = true;
      continue;
    }
    if (/[„”“"«»‘’‚']/u.test(char)) char = '"';
    else if (/[–—‑]/u.test(char)) char = "-";
    for (const part of char.toLocaleUpperCase("pl")) {
      text += part;
      map.push(index);
    }
    space = false;
  }
  return { text: text.trimEnd(), map };
}

function findRange(source: string, fragment: string): { start: number; end: number } | null {
  const haystack = comparable(source);
  const needle = comparable(fragment).text.trim();
  if (needle.length < 8) return null;
  const at = haystack.text.indexOf(needle);
  if (at < 0) return null;
  return { start: haystack.map[at]!, end: haystack.map[at + needle.length - 1]! + 1 };
}

/** The cited passage, else its beginning, else the case number. */
export function markPassage(
  text: string,
  passage: string | undefined,
  signature: string | undefined
): { start: number; end: number; match: CaseLawPreview["match"] } {
  const cited = passage?.trim().slice(0, MAX_FRAGMENT);
  if (cited) {
    const exact = findRange(text, cited);
    if (exact) return { ...exact, match: "EXACT" };
    for (const length of [240, 120, 60]) {
      if (cited.length <= length) continue;
      const head = cited.slice(0, length).replace(/\s+\S*$/u, "");
      const partial = findRange(text, head);
      if (partial) return { ...partial, match: "PARTIAL" };
    }
  }
  const number = signature?.trim();
  const found = number ? findRange(text, number) : null;
  return found ? { ...found, match: "SIGNATURE" } : { start: 0, end: 0, match: "NONE" };
}

const MATCH_NOTE: Record<CaseLawPreview["match"], string> = {
  EXACT: "Zaznaczono fragment, na który powołuje się odpowiedź. Przed użyciem sprawdź jego kontekst w całym rozstrzygnięciu.",
  PARTIAL:
    "Zaznaczono początek przywołanego fragmentu; dalsza część nie zgadza się dosłownie z tekstem źródła. Sprawdź ręcznie, co faktycznie stwierdzono.",
  SIGNATURE:
    "Przywołanego fragmentu nie znaleziono dosłownie w tekście źródła (parafraza albo błąd modelu); zaznaczono sygnaturę. Zweryfikuj ręcznie, czy rozstrzygnięcie mówi to, co przypisuje mu odpowiedź.",
  NONE: "Nie było czego zaznaczyć (brak cytatu i sygnatury w tekście). Zweryfikuj rozstrzygnięcie ręcznie."
};

export function renderCaseLawPreview(input: {
  url: string;
  text: string;
  passage?: string;
  signature?: string;
  // The answer's sentence citing this decision: what to check it against.
  attributed?: string;
  fetchedAt: string;
}): CaseLawPreview {
  const range = markPassage(input.text, input.passage, input.signature);
  const body =
    range.match === "NONE"
      ? escapeHtml(input.text)
      : `${escapeHtml(input.text.slice(0, range.start))}<mark id="${CASE_PREVIEW_ANCHOR}">${escapeHtml(input.text.slice(range.start, range.end))}</mark>${escapeHtml(input.text.slice(range.end))}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${escapeHtml(input.url)}"><title>${escapeHtml(input.signature ?? "Orzeczenie")}</title><style>
body{font-family:Calibri,Arial,sans-serif;margin:16px;line-height:1.5;color:#1d1d1f;background:#fff}
.lex-head{border:1px solid #d0d4da;border-radius:6px;padding:8px 12px;margin-bottom:12px;background:#f6f7f9;font-size:.92em}
.lex-head p{margin:4px 0}.lex-note{color:#7a4b00}
.lex-text{white-space:pre-wrap}
mark{background:#ffe066;padding:1px 0;scroll-margin-top:40vh}
@media (prefers-color-scheme:dark){body{background:#1e1f22;color:#e8e8ea}.lex-head{background:#2a2c30;border-color:#44474d}.lex-note{color:#f0c060}mark{background:#8a6d00;color:#fff}}
</style></head><body><div class="lex-head"><p><b>Pełny tekst${input.signature ? ` · ${escapeHtml(input.signature)}` : ""}</b></p><p>Karta orzeczenia (źródło): <a href="${escapeHtml(input.url)}">${escapeHtml(input.url)}</a> · tekst pobrany ${escapeHtml(input.fetchedAt.slice(0, 16).replace("T", " "))} UTC i zapisany w aplikacji; cytat zaznaczono na tej kopii</p>${input.attributed ? `<p>Odpowiedź przypisuje temu rozstrzygnięciu: <i>${escapeHtml(input.attributed.slice(0, 1500))}</i></p>` : ""}<p class="lex-note">${MATCH_NOTE[range.match]}</p></div><div class="lex-text">${body}</div></body></html>`;
  return { url: input.url, html, anchor: CASE_PREVIEW_ANCHOR, match: range.match, chars: input.text.length };
}

export class CaseLawPreviewService {
  private readonly cache = new Map<string, { text: string; at: number }>();

  constructor(
    private readonly fetcher: PreviewFetch = globalThis.fetch.bind(globalThis),
    private readonly now: () => number = Date.now
  ) {}

  /**
   * The stored copy of a decision (downloaded now if missing): kept in the
   * case (when given) and, with the library enabled, catalogued there.
   */
  async copy(input: { sourceUrl: string; signature?: string; caseId?: string }): Promise<StoredCaseLaw> {
    const url = allowedPreviewUrl(input.sourceUrl).toString();
    const repository = caseLawRepository();
    const stored = repository?.get(url, input.caseId);
    const text = stored?.text ?? (await this.text(url)).trim();
    if (text.length < 40) throw new Error("CASE_PREVIEW_TEXT_EMPTY");
    const fetchedAt = stored?.fetchedAt ?? new Date(this.now()).toISOString();
    const entry = {
      ...(stored ?? {}),
      cardUrl: url,
      text,
      fetchedAt,
      ...(input.signature && !stored?.signature ? { signature: input.signature } : {})
    };
    return (
      repository?.put(entry, input.caseId) ?? {
        court: courtOfCard(url),
        ...entry,
        sha256: createHash("sha256").update(text).digest("hex")
      }
    );
  }

  async preview(input: { sourceUrl: string; passage?: string; signature?: string; attributed?: string; caseId?: string }): Promise<CaseLawPreview> {
    const url = allowedPreviewUrl(input.sourceUrl).toString();
    // The local copy first (the case's, then the library's): the quote is
    // marked on what was downloaded once.
    const repository = caseLawRepository();
    const stored = repository?.get(url, input.caseId) ?? null;
    const text = stored?.text ?? (await this.text(url));
    if (text.length < 40) throw new Error("CASE_PREVIEW_TEXT_EMPTY");
    const saved =
      repository?.put({ ...(stored ?? {}), cardUrl: url, text, ...(input.signature && !stored?.signature ? { signature: input.signature } : {}) }, input.caseId) ??
      stored;
    const rendered = renderCaseLawPreview({
      url,
      text,
      ...(input.passage ? { passage: input.passage } : {}),
      ...(input.signature ? { signature: input.signature } : {}),
      ...(input.attributed ? { attributed: input.attributed } : {}),
      fetchedAt: saved?.fetchedAt ?? new Date(this.now()).toISOString()
    });
    return { ...rendered, source: stored ? "LOCAL" : "NETWORK", ...(saved ? { storedAt: saved.fetchedAt } : {}) };
  }

  private async text(url: string): Promise<string> {
    const cached = this.cache.get(url);
    if (cached && this.now() - cached.at < CACHE_MS) return cached.text;
    const text = await this.fetchText(url);
    this.cache.delete(url);
    this.cache.set(url, { text, at: this.now() });
    while (this.cache.size > CACHE_ITEMS) this.cache.delete(this.cache.keys().next().value!);
    return text;
  }

  private async fetchText(url: string): Promise<string> {
    const sn = await supremeCourtFullTextHtml(url, this.fetcher as CaseLawFetch);
    if (sn) return documentText(sn);
    const parsed = new URL(url);
    const saos = /(^|\.)saos\.org\.pl$/.test(parsed.hostname) ? SAOS_JUDGMENT.exec(parsed.pathname)?.[1] : undefined;
    if (saos) {
      // The SAOS page is built by JavaScript; the API gives the same judgment text.
      const response = await this.fetcher(`https://www.saos.org.pl/api/judgments/${saos}`, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`CASE_PREVIEW_HTTP_${response.status}`);
      const payload = (await response.json()) as { data?: { textContent?: unknown } };
      if (typeof payload.data?.textContent === "string") return documentText(payload.data.textContent);
      throw new Error("CASE_PREVIEW_TEXT_EMPTY");
    }
    const page = await fetchSourcePreview(url, this.fetcher);
    if (page.kind === "pdf") {
      const extracted = await new LocalPdfTextExtractor(undefined, { lines: true }).extract(page.data);
      return extracted.text.replace(/[ \t]+/g, " ").trim();
    }
    return documentText(page.html);
  }
}
