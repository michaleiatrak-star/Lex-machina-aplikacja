import { supremeCourtFullTextHtml } from "./case-law-verifier.js";
import { LocalPdfTextExtractor } from "./pdf-text-extractor.js";
import { allowedPreviewUrl, fetchSourcePreview } from "./source-preview.js";
export const CASE_PREVIEW_ANCHOR = "lex-case-quote";
const CACHE_MS = 30 * 60_000;
const CACHE_ITEMS = 30;
const MAX_FRAGMENT = 4000;
const SAOS_JUDGMENT = /^\/judgments\/(\d{1,12})\/?$/;
function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function decodeEntities(value) {
    return value
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d{1,6});/g, (_match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]{1,6});/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&amp;/gi, "&");
}
/** Readable text of a decision page: paragraphs kept, markup and scripts dropped. */
export function documentText(html) {
    return decodeEntities(html
        .replace(/<(script|style|head|title|nav|header|footer|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6]|tr|table|section|article|blockquote)\s*>/gi, "\n")
        .replace(/<(p|div|li|h[1-6]|tr|blockquote)\b[^>]*>/gi, "\n")
        .replace(/<\/t[dh]\s*>/gi, " \t ")
        .replace(/<[^>]+>/g, " "))
        .replace(/[ \t ]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
// One comparable form for the source text and the cited passage: case, dots,
// quotation marks, dashes and whitespace do not decide a match (as in the
// SN quote check). map[i] is the source index of normalized character i.
function comparable(value) {
    let text = "";
    const map = [];
    let space = true;
    for (let index = 0; index < value.length; index += 1) {
        let char = value[index].normalize("NFKC");
        if (char === "." || char === "­")
            continue;
        if (/\s/u.test(char)) {
            if (!space) {
                text += " ";
                map.push(index);
            }
            space = true;
            continue;
        }
        if (/[„”“"«»‘’‚']/u.test(char))
            char = '"';
        else if (/[–—‑]/u.test(char))
            char = "-";
        for (const part of char.toLocaleUpperCase("pl")) {
            text += part;
            map.push(index);
        }
        space = false;
    }
    return { text: text.trimEnd(), map };
}
function findRange(source, fragment) {
    const haystack = comparable(source);
    const needle = comparable(fragment).text.trim();
    if (needle.length < 8)
        return null;
    const at = haystack.text.indexOf(needle);
    if (at < 0)
        return null;
    return { start: haystack.map[at], end: haystack.map[at + needle.length - 1] + 1 };
}
/** The cited passage, else its beginning, else the case number. */
export function markPassage(text, passage, signature) {
    const cited = passage?.trim().slice(0, MAX_FRAGMENT);
    if (cited) {
        const exact = findRange(text, cited);
        if (exact)
            return { ...exact, match: "EXACT" };
        for (const length of [240, 120, 60]) {
            if (cited.length <= length)
                continue;
            const head = cited.slice(0, length).replace(/\s+\S*$/u, "");
            const partial = findRange(text, head);
            if (partial)
                return { ...partial, match: "PARTIAL" };
        }
    }
    const number = signature?.trim();
    const found = number ? findRange(text, number) : null;
    return found ? { ...found, match: "SIGNATURE" } : { start: 0, end: 0, match: "NONE" };
}
const MATCH_NOTE = {
    EXACT: "Zaznaczono fragment, na który powołuje się odpowiedź. Przed użyciem sprawdź jego kontekst w całym rozstrzygnięciu.",
    PARTIAL: "Zaznaczono początek przywołanego fragmentu; dalsza część nie zgadza się dosłownie z tekstem źródła. Sprawdź ręcznie, co faktycznie stwierdzono.",
    SIGNATURE: "Przywołanego fragmentu nie znaleziono dosłownie w tekście źródła (parafraza albo błąd modelu); zaznaczono sygnaturę. Zweryfikuj ręcznie, czy rozstrzygnięcie mówi to, co przypisuje mu odpowiedź.",
    NONE: "Nie było czego zaznaczyć (brak cytatu i sygnatury w tekście). Zweryfikuj rozstrzygnięcie ręcznie."
};
export function renderCaseLawPreview(input) {
    const range = markPassage(input.text, input.passage, input.signature);
    const body = range.match === "NONE"
        ? escapeHtml(input.text)
        : `${escapeHtml(input.text.slice(0, range.start))}<mark id="${CASE_PREVIEW_ANCHOR}">${escapeHtml(input.text.slice(range.start, range.end))}</mark>${escapeHtml(input.text.slice(range.end))}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${escapeHtml(input.url)}"><title>${escapeHtml(input.signature ?? "Orzeczenie")}</title><style>
body{font-family:Calibri,Arial,sans-serif;margin:16px;line-height:1.5;color:#1d1d1f;background:#fff}
.lex-head{border:1px solid #d0d4da;border-radius:6px;padding:8px 12px;margin-bottom:12px;background:#f6f7f9;font-size:.92em}
.lex-head p{margin:4px 0}.lex-note{color:#7a4b00}
.lex-text{white-space:pre-wrap}
mark{background:#ffe066;padding:1px 0;scroll-margin-top:40vh}
@media (prefers-color-scheme:dark){body{background:#1e1f22;color:#e8e8ea}.lex-head{background:#2a2c30;border-color:#44474d}.lex-note{color:#f0c060}mark{background:#8a6d00;color:#fff}}
</style></head><body><div class="lex-head"><p><b>Pełny tekst${input.signature ? ` · ${escapeHtml(input.signature)}` : ""}</b></p><p>Źródło: <a href="${escapeHtml(input.url)}">${escapeHtml(input.url)}</a> · pobrano ${escapeHtml(input.fetchedAt.slice(0, 16).replace("T", " "))} UTC</p>${input.attributed ? `<p>Odpowiedź przypisuje temu rozstrzygnięciu: <i>${escapeHtml(input.attributed.slice(0, 1500))}</i></p>` : ""}<p class="lex-note">${MATCH_NOTE[range.match]}</p></div><div class="lex-text">${body}</div></body></html>`;
    return { url: input.url, html, anchor: CASE_PREVIEW_ANCHOR, match: range.match, chars: input.text.length };
}
export class CaseLawPreviewService {
    fetcher;
    now;
    cache = new Map();
    constructor(fetcher = globalThis.fetch.bind(globalThis), now = Date.now) {
        this.fetcher = fetcher;
        this.now = now;
    }
    async preview(input) {
        const url = allowedPreviewUrl(input.sourceUrl).toString();
        const text = await this.text(url);
        if (text.length < 40)
            throw new Error("CASE_PREVIEW_TEXT_EMPTY");
        return renderCaseLawPreview({
            url,
            text,
            ...(input.passage ? { passage: input.passage } : {}),
            ...(input.signature ? { signature: input.signature } : {}),
            ...(input.attributed ? { attributed: input.attributed } : {}),
            fetchedAt: new Date(this.now()).toISOString()
        });
    }
    async text(url) {
        const cached = this.cache.get(url);
        if (cached && this.now() - cached.at < CACHE_MS)
            return cached.text;
        const text = await this.fetchText(url);
        this.cache.delete(url);
        this.cache.set(url, { text, at: this.now() });
        while (this.cache.size > CACHE_ITEMS)
            this.cache.delete(this.cache.keys().next().value);
        return text;
    }
    async fetchText(url) {
        const sn = await supremeCourtFullTextHtml(url, this.fetcher);
        if (sn)
            return documentText(sn);
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
            if (!response.ok)
                throw new Error(`CASE_PREVIEW_HTTP_${response.status}`);
            const payload = (await response.json());
            if (typeof payload.data?.textContent === "string")
                return documentText(payload.data.textContent);
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
