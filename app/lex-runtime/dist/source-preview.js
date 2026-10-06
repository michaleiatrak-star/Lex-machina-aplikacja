// Preview of an official legal source page (search results: CBOSA, SAOS, EUREKA,
// UODO, ISAP/ELI, EUR-Lex, SN; KRS and NBP from their open APIs) inside the app. The desktop CSP forbids framing
// foreign sites, so the runtime fetches the page from an allow-listed official host
// and returns it without scripts; the UI shows it in a sandboxed frame.
export const SOURCE_PREVIEW_HOSTS = new Set([
    "orzeczenia.nsa.gov.pl",
    "www.saos.org.pl",
    "saos.org.pl",
    "eureka.mf.gov.pl",
    "orzeczenia.uodo.gov.pl",
    "uodo.gov.pl",
    "isap.sejm.gov.pl",
    "api.sejm.gov.pl",
    "eli.gov.pl",
    "eur-lex.europa.eu",
    "curia.europa.eu",
    "sn.pl",
    "www.sn.pl",
    // Official open-data APIs rendered as a readable page (KRS odpis, NBP rates).
    "api-krs.ms.gov.pl",
    "orzeczenia.uzp.gov.pl",
    "api.nbp.pl",
    // Common courts (aggregate portal) and the Constitutional Tribunal.
    "orzeczenia.ms.gov.pl",
    "ipo.trybunal.gov.pl",
    "otkzu.trybunal.gov.pl"
]);
// Portals of single common courts: orzeczenia.{city}.sr|so|sa.gov.pl.
export const COURT_PORTAL_HOST = /^orzeczenia\.[a-z0-9-]{2,40}\.(sr|so|sa)\.gov\.pl$/;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 20_000;
export function allowedPreviewUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error("SOURCE_PREVIEW_URL_INVALID");
    }
    if (url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443") ||
        !(SOURCE_PREVIEW_HOSTS.has(url.hostname.toLowerCase()) || COURT_PORTAL_HOST.test(url.hostname.toLowerCase()))) {
        throw new Error("SOURCE_PREVIEW_HOST_NOT_ALLOWED");
    }
    return url;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
// The frame is sandboxed without scripts anyway; removing active content keeps the
// document small and inert. A <base> makes relative links and images resolvable.
export function inertHtml(html, url) {
    const cleaned = html
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
        .replace(/<script\b[^>]*\/?>/gi, "")
        .replace(/<(iframe|frame|frameset|object|embed|applet|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<(iframe|frame|object|embed|applet|meta\s+http-equiv)\b[^>]*>/gi, "")
        .replace(/<base\b[^>]*>/gi, "")
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/(href|src|action)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, "$1=\"#\"");
    const base = `<base href="${escapeHtml(url)}">`;
    return /<head\b[^>]*>/i.test(cleaned)
        ? cleaned.replace(/<head\b[^>]*>/i, (head) => `${head}${base}`)
        : `<!doctype html><html><head>${base}<meta charset="utf-8"></head><body>${cleaned}</body></html>`;
}
function charsetOf(contentType, head) {
    const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
    if (fromHeader)
        return fromHeader;
    const sniff = head.subarray(0, 4096).toString("latin1");
    return /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1] ?? "utf-8";
}
function decode(data, charset) {
    try {
        return new TextDecoder(charset.toLowerCase()).decode(data);
    }
    catch {
        return new TextDecoder("utf-8").decode(data);
    }
}
// Text a reader would see: without tags, styles and whitespace runs.
export function visibleText(html) {
    return html
        .replace(/<(style|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}
// Portals that render the document with JavaScript (the frame runs none)
// leave an empty shell; say so instead of showing a blank frame.
function scriptOnlyNotice(url) {
    return inertHtml(`<p>Ta strona źródła wyświetla treść wyłącznie przez JavaScript, którego podgląd w aplikacji nie uruchamia (bezpieczeństwo). Użyj „Pokaż treść” albo „Otwórz w źródle”.</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`, url);
}
const EUREKA_HOST = "eureka.mf.gov.pl";
const EUREKA_DOCUMENT_PATH = /^\/informacje\/podglad\/(\d{1,10})\/?$/;
// EUREKA (Ministry of Finance) is a JavaScript application: its document page
// is an empty shell without scripts. The same document comes from the portal's
// public API (the source of "Pokaż treść"), rendered here as a static page.
export async function eurekaDocumentPreview(url, fetcher) {
    const id = url.hostname === EUREKA_HOST ? EUREKA_DOCUMENT_PATH.exec(url.pathname)?.[1] : undefined;
    if (!id)
        return null;
    const response = await fetcher(`https://${EUREKA_HOST}/api/public/v1/informacje/${id}`, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok)
        throw new Error(`SOURCE_PREVIEW_HTTP_${response.status}`);
    const raw = JSON.parse((await readLimited(response)).toString("utf8"));
    const fields = new Map((raw.dokument?.fields ?? []).map((field) => [field.key, field.value]));
    const text = (key) => (typeof fields.get(key) === "string" ? fields.get(key) : "");
    const body = text("TRESC_INTERESARIUSZ") || text("TRESC");
    if (!body && !text("TEZA"))
        throw new Error("SOURCE_PREVIEW_EMPTY");
    const meta = [text("SYG") && `Sygnatura: ${escapeHtml(text("SYG"))}`, text("DT_WYD") && `data wydania: ${escapeHtml(text("DT_WYD").slice(0, 10))}`]
        .filter(Boolean)
        .join(" · ");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(text("TEZA") || text("SYG"))}</title></head><body style="font-family:Calibri,Arial,sans-serif;margin:16px;line-height:1.45"><h1 style="font-size:1.2em">${escapeHtml(text("TEZA"))}</h1><p style="color:#555">${meta} · źródło: EUREKA (Ministerstwo Finansów)</p><hr>${body}</body></html>`;
    return { kind: "html", url: url.toString(), html: inertHtml(html, url.toString()) };
}
// ISAP pages sit behind a bot challenge (Imperva): the runtime gets "Pardon Our
// Interruption" or a redirect loop instead of the act. The same act comes from the
// Sejm ELI API: its HTML text, or the PDF when the act has no HTML text (most
// consolidated texts).
const ISAP_DOC = /^W(DU|MP)(\d{4})(\d{3})(\d{4})$/;
const ELI_ACT_PATH = /^\/eli\/acts\/(DU|MP)\/(\d{4})\/(\d{1,6})\/?$/;
export function eliActForPreview(url) {
    if (url.hostname === "isap.sejm.gov.pl") {
        const id = url.searchParams.get("id") ?? /\/(W(?:DU|MP)\d{11})\//.exec(url.pathname)?.[1] ?? "";
        const match = ISAP_DOC.exec(id);
        return match && Number(match[4]) > 0 ? `${match[1]}/${match[2]}/${Number(match[4])}` : null;
    }
    if (url.hostname === "api.sejm.gov.pl") {
        const match = ELI_ACT_PATH.exec(url.pathname);
        return match ? `${match[1]}/${match[2]}/${Number(match[3])}` : null;
    }
    return null;
}
async function getJson(url, fetcher) {
    const response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (response.status === 404)
        return null;
    if (!response.ok)
        throw new Error(`SOURCE_PREVIEW_HTTP_${response.status}`);
    return JSON.parse((await readLimited(response)).toString("utf8"));
}
export async function eliActPreview(url, fetcher) {
    const eli = eliActForPreview(url);
    if (!eli)
        return null;
    const base = `https://api.sejm.gov.pl/eli/acts/${eli}`;
    const meta = (await getJson(base, fetcher));
    if (!meta)
        throw new Error("SOURCE_PREVIEW_HTTP_404");
    if (meta.textHTML)
        return `${base}/text.html`;
    if (meta.textPDF)
        return `${base}/text.pdf`;
    throw new Error("SOURCE_PREVIEW_EMPTY");
}
const PAGE_CSS = "body{font-family:Calibri,Arial,sans-serif;margin:16px;line-height:1.45;font-size:14px}" +
    "table{border-collapse:collapse;margin:6px 0}td,th{border:1px solid #ccc;padding:3px 6px;vertical-align:top;text-align:left}" +
    "th{background:#f3f3f3}dl{margin:4px 0 4px 12px}dt{font-weight:600;margin-top:4px}dd{margin:0 0 0 12px}" +
    "h1{font-size:1.2em}h2{font-size:1.05em;margin:18px 0 6px;border-bottom:1px solid #ccc}.sub{color:#555}";
function page(title, subtitle, body, url) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body><h1>${escapeHtml(title)}</h1><p class="sub">${subtitle}</p>${body}</body></html>`;
    return { kind: "html", url, html: inertHtml(html, url) };
}
// "dataRejestracjiWKRS" -> "data rejestracji w KRS"; "dzial1" -> "Dział 1"
export function fieldLabel(key) {
    const dzial = /^dzial(\d)$/i.exec(key);
    if (dzial)
        return `Dział ${dzial[1]}`;
    return key
        .replace(/([a-ząćęłńóśźż0-9])([A-ZĄĆĘŁŃÓŚŹŻ])/g, "$1 $2")
        .replace(/([A-ZĄĆĘŁŃÓŚŹŻ])(?=[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż])/g, "$1 ")
        .toLocaleLowerCase("pl")
        .replace(/\bw k r s\b/g, "w KRS")
        .replace(/\b(krs|nip|regon|pkd|pesel)\b/g, (word) => word.toUpperCase());
}
// Free text in the register may carry a PESEL; the register masks only fields.
export function maskPesel(value) {
    return value
        .replace(/(PESEL\s*:?\s*)(\d)\d{10}/gi, "$1$2**********")
        .replace(/\b(\d)\d{10}\b/g, "$1**********");
}
function scalar(value) {
    if (typeof value === "boolean")
        return value ? "tak" : "nie";
    return escapeHtml(maskPesel(String(value)));
}
// Nested register data as definition lists; arrays of flat objects as tables.
export function renderRecord(value, depth = 0) {
    if (value === null || value === undefined || value === "")
        return "—";
    if (typeof value !== "object")
        return scalar(value);
    if (depth > 8)
        return "…";
    if (Array.isArray(value)) {
        if (!value.length)
            return "—";
        const flat = value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item) &&
            Object.values(item).every((v) => v === null || typeof v !== "object"));
        if (flat) {
            const columns = [...new Set(value.flatMap((item) => Object.keys(item)))];
            return `<table><tr>${columns.map((c) => `<th>${escapeHtml(fieldLabel(c))}</th>`).join("")}</tr>${value
                .map((item) => `<tr>${columns.map((c) => `<td>${renderRecord(item[c], depth + 1)}</td>`).join("")}</tr>`)
                .join("")}</table>`;
        }
        return `<ol>${value.map((item) => `<li>${renderRecord(item, depth + 1)}</li>`).join("")}</ol>`;
    }
    const entries = Object.entries(value);
    if (!entries.length)
        return "—";
    return `<dl>${entries.map(([key, item]) => `<dt>${escapeHtml(fieldLabel(key))}</dt><dd>${renderRecord(item, depth + 1)}</dd>`).join("")}</dl>`;
}
const KRS_ODPIS = /^\/api\/krs\/OdpisAktualny\/(\d{10})$/;
// KRS open API: the current extract (odpis aktualny), every section, as a page.
export async function krsOdpisPreview(url, fetcher) {
    const numer = url.hostname === "api-krs.ms.gov.pl" ? KRS_ODPIS.exec(url.pathname)?.[1] : undefined;
    if (!numer)
        return null;
    const rejestr = url.searchParams.get("rejestr") === "S" ? "S" : "P";
    const raw = (await getJson(`https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${numer}?rejestr=${rejestr}&format=json`, fetcher));
    if (!raw?.odpis?.dane)
        throw new Error("SOURCE_PREVIEW_HTTP_404");
    const header = raw.odpis.naglowekA ?? {};
    const dzial1 = raw.odpis.dane.dzial1;
    const name = typeof dzial1?.danePodmiotu?.nazwa === "string" ? dzial1.danePodmiotu.nazwa : `KRS ${numer}`;
    const sections = Object.entries(raw.odpis.dane)
        .map(([key, value]) => `<h2>${escapeHtml(fieldLabel(key))}</h2>${renderRecord(value)}`)
        .join("");
    return page(name, `Odpis aktualny z Krajowego Rejestru Sądowego, KRS ${escapeHtml(numer)}, rejestr ${rejestr === "S" ? "stowarzyszeń i fundacji (S)" : "przedsiębiorców (P)"} · stan z dnia ${scalar(header.stanZDnia ?? "—")} · odpis z ${scalar(header.dataCzasOdpisu ?? "—")} · źródło: Otwarte API KRS (Ministerstwo Sprawiedliwości). Wnioski w toku nie są widoczne w odpisie.`, `<h2>Nagłówek</h2>${renderRecord(header)}${sections}`, url.toString());
}
const NBP_RATE = /^\/api\/exchangerates\/rates\/a\/([a-z]{3})\/(\d{4}-\d{2}-\d{2})\/?$/i;
// NBP exchange rates: table A (mid) and, where published, table C (buy/sell).
export async function nbpRatePreview(url, fetcher) {
    const match = url.hostname === "api.nbp.pl" ? NBP_RATE.exec(url.pathname) : null;
    if (!match)
        return null;
    const code = match[1].toLowerCase();
    const date = match[2];
    const base = "https://api.nbp.pl/api/exchangerates/rates";
    const a = (await getJson(`${base}/a/${code}/${date}/?format=json`, fetcher));
    const rowA = a?.rates?.[0];
    if (!rowA)
        throw new Error("SOURCE_PREVIEW_HTTP_404");
    const c = (await getJson(`${base}/c/${code}/${date}/?format=json`, fetcher).catch(() => null));
    const rowC = c?.rates?.[0];
    const upper = code.toUpperCase();
    const row = (table, no, day, kind, rate) => `<tr><td>${table}</td><td>${scalar(no ?? "—")}</td><td>${scalar(day ?? "—")}</td><td>${kind}</td><td>${scalar(rate ?? "—")}</td></tr>`;
    const rows = [
        row("A", rowA.no, rowA.effectiveDate, "kurs średni", rowA.mid),
        ...(rowC
            ? [
                row("C", rowC.no, rowC.effectiveDate, "kurs kupna", rowC.bid),
                row("C", rowC.no, rowC.effectiveDate, "kurs sprzedaży", rowC.ask)
            ]
            : [])
    ];
    return page(`Kurs ${upper}/PLN z dnia ${date}`, `${escapeHtml(a?.currency ?? "")} · źródło: API Narodowego Banku Polskiego (tabele kursów A i C)`, `<table><tr><th>Tabela</th><th>Numer</th><th>Data</th><th>Kurs</th><th>PLN za 1 ${escapeHtml(upper)}</th></tr>${rows.join("")}</table>${rowC ? "" : "<p>NBP nie opublikował kursu kupna i sprzedaży tej waluty z tego dnia (tabela C obejmuje wybrane waluty).</p>"}`, url.toString());
}
// EUR-Lex pages answer every client without a browser with an AWS WAF challenge
// (HTTP 202 and a JavaScript page). The same document in Polish comes from the
// EU Publications Office repository (Cellar) by CELEX number, as XHTML.
const CELEX = /^[0-9A-Z]{6,20}(?:\([0-9]+\))?$/;
const CELLAR_HOST = "publications.europa.eu";
export function celexForPreview(url) {
    if (url.hostname !== "eur-lex.europa.eu")
        return null;
    const uri = url.searchParams.get("uri") ?? "";
    const celex = /^CELEX:(.+)$/i.exec(uri)?.[1]?.toUpperCase() ?? "";
    return CELEX.test(celex) ? celex : null;
}
export async function eurLexPreview(url, fetcher) {
    const celex = celexForPreview(url);
    if (!celex)
        return null;
    let next = new URL(`https://${CELLAR_HOST}/resource/celex/${encodeURIComponent(celex)}`);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const response = await fetcher(next.toString(), {
            method: "GET",
            redirect: "manual",
            headers: { Accept: "application/xhtml+xml, text/html;q=0.9", "Accept-Language": "pol" },
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location)
                throw new Error("SOURCE_PREVIEW_REDIRECT_INVALID");
            next = new URL(location, next);
            // Cellar redirects to http://publications.europa.eu/...; the same path over https.
            if (next.hostname !== CELLAR_HOST)
                throw new Error("SOURCE_PREVIEW_HOST_NOT_ALLOWED");
            next.protocol = "https:";
            continue;
        }
        if (response.status === 404)
            throw new Error("SOURCE_PREVIEW_NO_POLISH_TEXT");
        if (!response.ok)
            throw new Error(`SOURCE_PREVIEW_HTTP_${response.status}`);
        const data = await readLimited(response);
        const text = decode(data, charsetOf(response.headers.get("content-type") ?? "", data));
        // Links and the stylesheet stay relative to EUR-Lex, where the reader opens the act.
        return { kind: "html", url: url.toString(), html: inertHtml(text.replace(/^<\?xml[^>]*\?>\s*/, ""), url.toString()) };
    }
    throw new Error("SOURCE_PREVIEW_TOO_MANY_REDIRECTS");
}
async function readLimited(response) {
    const declared = Number(response.headers.get("content-length"));
    if (declared && declared > MAX_BYTES)
        throw new Error("SOURCE_PREVIEW_TOO_LARGE");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_BYTES)
        throw new Error("SOURCE_PREVIEW_TOO_LARGE");
    return body;
}
export async function fetchSourcePreview(value, fetcher = globalThis.fetch.bind(globalThis)) {
    let url = allowedPreviewUrl(value);
    const eureka = await eurekaDocumentPreview(url, fetcher);
    if (eureka)
        return eureka;
    const krs = await krsOdpisPreview(url, fetcher);
    if (krs)
        return krs;
    const nbp = await nbpRatePreview(url, fetcher);
    if (nbp)
        return nbp;
    const eurLex = await eurLexPreview(url, fetcher);
    if (eurLex)
        return eurLex;
    const eliText = await eliActPreview(url, fetcher);
    if (eliText)
        url = allowedPreviewUrl(eliText);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const response = await fetcher(url.toString(), {
            method: "GET",
            redirect: "manual",
            headers: { Accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location)
                throw new Error("SOURCE_PREVIEW_REDIRECT_INVALID");
            // Redirects stay on the allow-list, like the first request.
            url = allowedPreviewUrl(new URL(location, url).toString());
            continue;
        }
        if (!response.ok)
            throw new Error(`SOURCE_PREVIEW_HTTP_${response.status}`);
        const contentType = response.headers.get("content-type") ?? "";
        const data = await readLimited(response);
        if (/application\/pdf/i.test(contentType) || data.subarray(0, 5).toString("latin1") === "%PDF-") {
            return { kind: "pdf", url: url.toString(), data };
        }
        const text = decode(data, charsetOf(contentType, data));
        if (/html|xml/i.test(contentType) || /^\s*</.test(text)) {
            const html = inertHtml(text, url.toString());
            return {
                kind: "html",
                url: url.toString(),
                html: /<script\b/i.test(text) && visibleText(html).length < 40
                    ? scriptOnlyNotice(url.toString())
                    : html
            };
        }
        return {
            kind: "html",
            url: url.toString(),
            html: inertHtml(`<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`, url.toString())
        };
    }
    throw new Error("SOURCE_PREVIEW_TOO_MANY_REDIRECTS");
}
