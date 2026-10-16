import { DEFAULT_PDF_MAX_BYTES, LocalPdfTextExtractor, PdfTextExtractionError } from "./pdf-text-extractor.js";
import { articleWording, extractPageFootnotes } from "./core-law-footnotes.js";
import { todayWarsaw } from "./warsaw-date.js";
import { anchoredUrl, htmlUnitFragment, pageFragment, pdfArticlePage } from "./source-anchor.js";
const NSA_WSA_SNAPSHOT_HOSTS = new Set([
    "nsa.gov.pl",
    "orzeczenia.nsa.gov.pl"
]);
export const OFFICIAL_LEGAL_SOURCE_HOSTS = [
    "eli.gov.pl",
    "isap.sejm.gov.pl",
    "api.sejm.gov.pl",
    "orzeczenia.ms.gov.pl",
    "www.orzeczenia.ms.gov.pl",
    "nsa.gov.pl",
    "orzeczenia.nsa.gov.pl",
    "sn.pl",
    "www.sn.pl"
];
const OFFICIAL_SOURCE_HOSTS = new Set([
    ...OFFICIAL_LEGAL_SOURCE_HOSTS
]);
const MAX_SOURCE_CHARS = 2_000_000;
const MAX_EVIDENCE_CHARS = 12_000;
function decodeHtmlEntities(value) {
    const named = {
        nbsp: " ",
        sect: "§",
        amp: "&",
        quot: '"',
        apos: "'",
        lt: "<",
        gt: ">"
    };
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, token) => {
        const lower = token.toLocaleLowerCase("en");
        if (lower.startsWith("#x")) {
            const code = Number.parseInt(lower.slice(2), 16);
            return Number.isFinite(code)
                ? String.fromCodePoint(code)
                : match;
        }
        if (lower.startsWith("#")) {
            const code = Number.parseInt(lower.slice(1), 10);
            return Number.isFinite(code)
                ? String.fromCodePoint(code)
                : match;
        }
        return named[lower] ?? match;
    });
}
// "Art. 11<sup>1</sup>", "art. 11¹" and "art. 11^1" are one unit, never Art. 11 or Art. 111.
const SUPERSCRIPT_DIGITS = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
export function superscriptsAsCaret(value) {
    return value
        .replace(/<sup\b[^>]*>\s*(\d{1,3})\s*<\/sup>/giu, "^$1")
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu, (digits) => `^${[...digits].map((digit) => SUPERSCRIPT_DIGITS[digit]).join("")}`)
        // The PDF text extractor writes a superscript as " [1] " ("Art. 449 [1] .").
        .replace(/(\d)\s*\[(\d{1,3})\](?=\s|[.,;§)]|$)/gu, "$1^$2")
        .replace(/(\d)\s+\^(\d)/gu, "$1^$2");
}
const SOURCE_FETCH_TIMEOUT_MS = 60_000;
function readableText(value) {
    return decodeHtmlEntities(superscriptsAsCaret(value)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
        .replace(/<\s*(?:br\b[^>]*|\/?(?:body|main|section|article|header|footer|title|p|div|li|tr|td|th|h[1-6])\b[^>]*)>/giu, "\n")
        .replace(/<[^>]+>/g, " "))
        .normalize("NFKC")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\f\v]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^$()|[\]\\{}]/g, (match) => "\\" + match);
}
function articleSection(claim, body) {
    const article = articleToken(claim);
    if (!article)
        return null;
    const readable = readableText(body);
    const strictHeading = new RegExp("(?:^|\\n)\\s*Art\\.?\\s+" +
        escapeRegExp(article) +
        "(?=\\s*(?:\\.|§|$))", "u");
    const fallbackHeading = new RegExp("\\bArt\\.?\\s+" +
        escapeRegExp(article) +
        "(?=\\s*(?:\\.|§|$))", "u");
    const match = strictHeading.exec(readable) ??
        fallbackHeading.exec(readable);
    if (!match)
        return null;
    const start = match.index +
        (match[0].startsWith("\n") ? 1 : 0);
    const afterHeading = match.index + match[0].length;
    const nextHeading = /\n\s*Art\.?\s+\d+(?:\^\d+)?[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*(?=\s*(?:\.|§|$))/u.exec(readable.slice(afterHeading));
    const end = nextHeading
        ? afterHeading + nextHeading.index
        : readable.length;
    const section = readable.slice(start, end).trim();
    return section ? section.slice(0, MAX_EVIDENCE_CHARS) : null;
}
function normalize(value) {
    return value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/giu, " ")
        .replace(/&sect;/giu, "§")
        .replace(/&amp;/giu, "&")
        .normalize("NFKC")
        .toLocaleLowerCase("pl")
        .replace(/[.,;:()[\]{}§]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function articleToken(claim) {
    const match = superscriptsAsCaret(claim).match(/\bart\.?\s+(\d+(?:\^\d+)?[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*)/iu);
    return match?.[1]?.toLocaleLowerCase("pl") ?? null;
}
function journalTokens(claim) {
    const normalized = normalize(claim);
    const year = normalized.match(/\b(20\d{2}|19\d{2})\b/u)?.[1];
    const position = normalized.match(/\bpoz\s+(\d+)\b/u)?.[1];
    return [year, position].filter((value) => Boolean(value));
}
function caseSignature(claim) {
    const normalized = normalize(claim.replace(/^.*?sygn\.?\s*(?:akt\s*)?/iu, ""));
    return normalized || null;
}
function titleMatches(expectedTitle, body, kind) {
    if (kind !== "statute" && kind !== "journal") {
        return true;
    }
    const expected = normalize(expectedTitle ?? "");
    if (expected.length < 4)
        return false;
    return normalize(body).includes(expected);
}
function matchesClaim(claim, kind, body) {
    const haystack = normalize(body);
    if (!haystack)
        return false;
    if (kind === "statute") {
        return Boolean(articleSection(claim, body));
    }
    if (kind === "journal") {
        const tokens = journalTokens(claim);
        return tokens.length >= 2 && tokens.every((token) => haystack.includes(token));
    }
    if (kind === "case") {
        const signature = caseSignature(claim);
        return Boolean(signature && haystack.includes(signature));
    }
    return haystack.includes(normalize(claim));
}
function evidenceSnippet(claim, kind, body) {
    if (kind === "statute") {
        return articleSection(claim, body) ?? undefined;
    }
    const normalizedBody = normalize(body);
    const needle = kind === "case"
        ? caseSignature(claim) ?? normalize(claim)
        : normalize(claim);
    if (!needle)
        return undefined;
    const index = normalizedBody.indexOf(needle);
    if (index < 0)
        return undefined;
    const start = Math.max(0, index - 160);
    return normalizedBody
        .slice(start, start + MAX_EVIDENCE_CHARS)
        .trim();
}
function sourceTier(host) {
    return host === "eli.gov.pl" ||
        host === "isap.sejm.gov.pl" ||
        host === "api.sejm.gov.pl"
        ? "R1"
        : "R2A";
}
function isPdfResponse(url, contentType) {
    return (contentType.includes("application/pdf") ||
        url.pathname.toLowerCase().endsWith(".pdf"));
}
export class LegalSourceVerificationError extends Error {
    code;
    constructor(message, code, options) {
        super(message, options);
        this.code = code;
        this.name = "LegalSourceVerificationError";
    }
}
// ELI HTML puts each footnote into a tooltip at its marker ("<a class=\"gloss-link\"><sup>25)</sup>
// <span class=\"tooltip-text\">W brzmieniu ustalonym przez…</span></a>"); readable text had the
// footnote inside the provision. The marker stays as "25 )" (the form the PDF reading gives) and
// the footnote text goes to the map the wording choice reads.
const GLOSS_LINK = /<a\b[^>]*class="[^"]*gloss-link[^"]*"[^>]*>\s*<sup>\s*(\d{1,3})\s*\)\s*<\/sup>\s*<span class="tooltip-text">([\s\S]*?)<\/span>\s*<\/a>/giu;
export function htmlFootnotes(html) {
    const footnotes = {};
    const marked = html.replace(GLOSS_LINK, (_match, number, note) => {
        footnotes[number] ??= readableText(note).replace(/\s+/gu, " ").trim();
        return ` ${number} )`;
    });
    return { html: marked, footnotes };
}
const REPEALED_ARTICLE = /^Art\.?\s*[^\s.]+\s*\.?\s*\((?:uchylony|uchylona|uchylone|skreślony|pominięty)\)/iu;
/**
 * The article as in force on `today`: of two wordings the consolidated text prints (the current
 * one and one entering into force later, told apart by the footnotes) the current one, a unit
 * added with a future date left out; the later wording comes back as `pending`.
 */
export function statuteWording(section, footnotes, today) {
    const marked = Object.keys(footnotes).length > 0 && /\d{1,3} \)/u.test(section);
    const wording = marked ? articleWording(section, footnotes, today) : null;
    // A page header of the Journal ("Dziennik Ustaw – 46 – Poz. 1245") is not provision text.
    const evidence = (wording?.text ?? section)
        .replace(/^\s*Dziennik Ustaw\s*[–-]\s*\d+\s*[–-]\s*Poz\.\s*\d+\s*$/gmu, "")
        .replace(/\n{2,}/gu, "\n")
        .trim();
    return {
        evidence,
        // Footnote markers ("13 )") out of the later wording as out of the evidence.
        pending: (wording?.pending ?? []).map((item) => ({
            from: item.from,
            text: item.text
                .replace(/(?<![\p{L}\d])(\d{1,3}) \)/gu, (marker, number) => (footnotes[number] === undefined ? marker : ""))
                .replace(/[ \t]{2,}/gu, " ")
                .slice(0, 2_000)
        })),
        unresolved: wording?.unresolved ?? false,
        repealed: REPEALED_ARTICLE.test(evidence),
        footnotes: marked
    };
}
const escapeUnit = (value) => value.replace(/[.*+?^$()|[\]\\{}]/gu, "\\$&");
/**
 * The unit the claim names below the article (§ 3, ust. 2, or pkt 2c when neither): in force,
 * repealed, printed only for later (pendingWording), or absent from an article that has units
 * of that kind. Not checked when the article shows no such units (a layout we do not read).
 */
export function claimedUnitState(claim, evidence, pending) {
    const text = superscriptsAsCaret(claim).replace(/\s+/gu, " ");
    const unit = "(\\d+(?:\\^\\d+)?[a-z]{0,2})(?![a-z\\d])";
    const para = new RegExp(`§\\s*${unit}`, "u").exec(text)?.[1];
    const ust = para ? undefined : new RegExp(`\\bust\\.?\\s*${unit}`, "u").exec(text)?.[1];
    const pkt = para || ust ? undefined : new RegExp(`\\bpkt\\s*${unit}`, "u").exec(text)?.[1];
    const label = para ?? ust ?? pkt;
    if (!label)
        return { state: "NOT_CHECKED" };
    const at = (value) => para
        ? new RegExp(`(?:^|\\n|\\.\\s)§\\s*${escapeUnit(value)}\\s*\\.`, "u")
        : ust
            ? new RegExp(`(?:^|\\n)${escapeUnit(value)}\\s*\\.\\s`, "u")
            : new RegExp(`(?:^|\\n)${escapeUnit(value)}\\)\\s`, "u");
    const anyOfKind = para ? /(?:^|\n|\.\s)§\s*\d/u : ust ? /\n\d+[a-z]*\.\s/u : /\n\d+[a-z]*\)\s/u;
    const found = at(label).exec(evidence);
    if (found) {
        const after = evidence.slice(found.index + found[0].length, found.index + found[0].length + 40);
        return /^\s*\((?:uchylon|skreślon|pominięt)/u.test(after) ? { state: "REPEALED" } : { state: "IN_FORCE" };
    }
    const later = pending.find((item) => at(label).test(`\n${item.text}`));
    if (later)
        return { state: "PENDING", from: later.from };
    // A cut evidence (a very long article) may hold the unit past its end. "§ N." is unmistakable,
    // so a § the article does not have is missing; a "2." or "2)" only when the article shows such units.
    if (evidence.length >= MAX_EVIDENCE_CHARS - 500)
        return { state: "NOT_CHECKED" };
    return para || anyOfKind.test(evidence) ? { state: "MISSING" } : { state: "NOT_CHECKED" };
}
export class OfficialLegalSourceVerifier {
    fetcher;
    now;
    pdfTextExtractor;
    constructor(fetcher = globalThis.fetch.bind(globalThis), now = () => new Date().toISOString(), pdfTextExtractor = 
    // Lines and small print kept: "Art. N." starts a line and the footnotes (small print at
    // the page bottom) say which wording of a unit is in force.
    new LocalPdfTextExtractor(undefined, { lines: true, markSmallLines: true })) {
        this.fetcher = fetcher;
        this.now = now;
        this.pdfTextExtractor = pdfTextExtractor;
    }
    supportsPdf() {
        return Boolean(this.pdfTextExtractor);
    }
    async verify(request) {
        let url;
        try {
            url = new URL(request.url);
        }
        catch {
            throw new LegalSourceVerificationError("Legal source URL is invalid.", "INVALID_SOURCE_URL");
        }
        if (url.protocol !== "https:" ||
            url.username ||
            url.password) {
            throw new LegalSourceVerificationError("Legal verification requires credential-free HTTPS.", "INVALID_SOURCE_URL");
        }
        const host = url.hostname.toLowerCase();
        if (!OFFICIAL_SOURCE_HOSTS.has(host)) {
            throw new LegalSourceVerificationError("Legal source host is not on the official-source allowlist.", "SOURCE_NOT_OFFICIAL");
        }
        let response;
        try {
            response = await this.fetcher(url, {
                method: "GET",
                redirect: "error",
                // A hung official server is an outage (ELI fallback), not a turn waiting forever;
                // the same signal bounds reading the body (a large consolidated act as PDF).
                signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS),
                headers: {
                    Accept: "text/html,application/xhtml+xml,application/json,text/plain,application/pdf;q=0.9,*/*;q=0.1"
                }
            });
        }
        catch (error) {
            // The cause (DNS, refused connection, a redirect, timeout) stays for diagnostics (G17).
            throw new LegalSourceVerificationError("Official legal source could not be fetched without redirects.", "SOURCE_FETCH_FAILED", { cause: error });
        }
        if (!response.ok) {
            throw new LegalSourceVerificationError("Official legal source returned HTTP " + response.status + ".", "SOURCE_FETCH_FAILED");
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        const pdfSource = isPdfResponse(url, contentType);
        let body;
        let pageTexts;
        let footnotes = {};
        if (pdfSource) {
            if (!this.pdfTextExtractor) {
                throw new LegalSourceVerificationError("Official PDF requires a configured local PDF text extractor.", "UNSUPPORTED_SOURCE_CONTENT");
            }
            const contentLength = Number(response.headers.get("content-length") ?? "0");
            if (Number.isFinite(contentLength) &&
                contentLength >
                    DEFAULT_PDF_MAX_BYTES) {
                throw new LegalSourceVerificationError("Official PDF exceeds the configured byte limit.", "SOURCE_TOO_LARGE");
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            try {
                const extracted = await this.pdfTextExtractor.extract(bytes);
                pageTexts = extracted.pageTexts;
                if (pageTexts?.length) {
                    // Footnotes off the page bottoms, kept for the wording choice (not in the provision).
                    const split = extractPageFootnotes(pageTexts);
                    footnotes = split.footnotes;
                    body = split.pages.filter(Boolean).join("\n").slice(0, MAX_SOURCE_CHARS);
                }
                else {
                    body = extracted.text.slice(0, MAX_SOURCE_CHARS);
                }
            }
            catch (error) {
                if (error instanceof
                    PdfTextExtractionError &&
                    error.code === "PDF_TOO_LARGE") {
                    throw new LegalSourceVerificationError("Official PDF exceeds the configured byte limit.", "SOURCE_TOO_LARGE");
                }
                throw new LegalSourceVerificationError("Official PDF could not be converted into verifiable text.", "PDF_EXTRACTION_FAILED");
            }
        }
        else {
            if (contentType &&
                !contentType.includes("text/") &&
                !contentType.includes("html") &&
                !contentType.includes("json") &&
                !contentType.includes("xml")) {
                throw new LegalSourceVerificationError("Official source content is not directly verifiable text.", "UNSUPPORTED_SOURCE_CONTENT");
            }
            body = (await response.text()).slice(0, MAX_SOURCE_CHARS);
            if (request.kind === "statute" && body.includes("gloss-link")) {
                const split = htmlFootnotes(body);
                body = split.html;
                footnotes = split.footnotes;
            }
        }
        const titleMatched = titleMatches(request.expectedTitle, body, request.kind);
        const referenceMatched = matchesClaim(request.claim, request.kind, body);
        const matched = titleMatched &&
            referenceMatched;
        const fetchedAt = this.now();
        const sourceUrl = url.toString();
        const snippet = evidenceSnippet(request.claim, request.kind, body);
        const wording = request.kind === "statute" && snippet
            ? statuteWording(snippet, footnotes, request.asOf ?? todayWarsaw(Date.parse(fetchedAt) || Date.now()))
            : null;
        const evidence = wording?.evidence ?? snippet;
        // Not verified: two wordings without a readable date, a repealed article, or a change not
        // in force printed in the text that its footnotes do not settle.
        const unit = wording ? claimedUnitState(request.claim, wording.evidence, wording.pending) : null;
        const wordingProblem = !wording
            ? null
            : unit?.state === "PENDING"
                ? `Ta jednostka jeszcze nie obowiązuje: tekst jednolity drukuje ją z wejściem w życie${unit.from ? ` z dniem ${unit.from}` : " w późniejszym terminie"}.`
                : unit?.state === "REPEALED"
                    ? "Ta jednostka jest w aktualnym tekście jednolitym uchylona."
                    : unit?.state === "MISSING"
                        ? "Artykuł w aktualnym tekście jednolitym nie ma tej jednostki."
                        : wording.unresolved
                            ? "Tekst jednolity drukuje kilka brzmień tej jednostki i z odnośników nie da się ustalić, które obowiązuje dziś."
                            : wording.repealed
                                ? "Przepis jest w aktualnym tekście jednolitym uchylony."
                                : request.requireFootnoteWording && !wording.pending.length
                                    ? "Tekst jednolity zawiera zmianę tego artykułu, która jeszcze nie obowiązuje, a jego odnośniki nie wskazują brzmienia obowiązującego dziś."
                                    : null;
        const snapshotOnly = NSA_WSA_SNAPSHOT_HOSTS.has(host);
        const sourceAnchorUrl = matched && request.kind === "statute"
            ? anchoredUrl(sourceUrl, pdfSource
                ? pageTexts
                    ? pageFragment(pdfArticlePage(pageTexts, request.claim))
                    : undefined
                : htmlUnitFragment(body, request.claim))
            : undefined;
        const record = matched && !snapshotOnly && !wordingProblem
            ? {
                claim: request.claim,
                kind: request.kind,
                status: "VERIFIED",
                sourceUrl,
                ...(sourceAnchorUrl ? { sourceAnchorUrl } : {}),
                sourceTier: sourceTier(host),
                fetchedAt,
                toolCallId: request.toolCallId,
                verificationMethod: pdfSource
                    ? "web_fetch_pdf"
                    : "web_fetch",
                sourceFormat: pdfSource ? "PDF" : "TEXT",
                ...(evidence ? { evidence } : {}),
                ...(wording?.pending.length ? { pendingWording: wording.pending } : {})
            }
            : {
                claim: request.claim,
                kind: request.kind,
                status: "UNVERIFIED",
                sourceUrl,
                sourceTier: sourceTier(host),
                fetchedAt,
                toolCallId: request.toolCallId,
                verificationMethod: pdfSource
                    ? "web_fetch_pdf"
                    : "web_fetch",
                sourceFormat: pdfSource ? "PDF" : "TEXT",
                ...(snapshotOnly
                    ? {
                        verificationCeiling: "SNAPSHOT_NO_PROMOTION"
                    }
                    : {}),
                evidence: matched && wordingProblem && !snapshotOnly
                    ? `${wordingProblem}${evidence ? `\n${evidence}` : ""}`.slice(0, MAX_EVIDENCE_CHARS)
                    : snapshotOnly && matched
                        ? `NSA/WSA SNAPSHOT (not promoted to VERIFIED): ${evidence ?? "reference found in the fetched CBOSA text"}`
                        : !titleMatched
                            ? "Official source was fetched, but the expected act title was not found."
                            : "Official source was fetched, but the requested reference was not found in the fetched text."
            };
        return {
            record,
            matched,
            host
        };
    }
}
export function isOfficialLegalSourceUrl(value) {
    try {
        const url = new URL(value);
        return (url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            OFFICIAL_SOURCE_HOSTS.has(url.hostname.toLowerCase()));
    }
    catch {
        return false;
    }
}
