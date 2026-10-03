// Interpretacje podatkowe (KIS, MF) wg PRAWO-HARDGATE: sygnatura sprawdzana w EUREKA
// (RZĄD 2A, shared/HIERARCHIA-ZRODEL.md) przed powołaniem, jak sygnatura orzeczenia.
// ✅ [VER] potwierdza istnienie i treść interpretacji; status aktualności EUREKA idzie
// do znacznika, a interpretacja nadal nie jest źródłem prawa (brzmienie przepisu z ELI).
const EUREKA = "https://eureka.mf.gov.pl";
const API = `${EUREKA}/api/public/v1`;
const PORTAL = `${EUREKA}/informacje/podglad`;
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;
const STATUS_CODE = {
    "27": "Aktualna",
    "28": "Robocza",
    "29": "Nieaktualna/Zmieniona/Wygaszona/Archiwalna",
    "30": "Nieaktualna",
    "33": "Usunięta"
};
// 0114-KDIP1-2.4012.345.2024.1.RD, 0115-KDIT1.4011.1.2023.1.MR (KIS od 2017);
// IPPP1/4512-123/15-2/AW, ILPP1/4512-1-1/16-2/JSK (izby skarbowe do 2017);
// DD10.8201.1.2020, PT8.8101.1.2023 (interpretacje ogólne MF).
const SIGNATURE_PATTERNS = [
    /\b\d{4}-[A-Z]{2,7}\d?(?:-\d{1,2})?\.\d{3,4}\.\d{1,6}\.\d{4}(?:\.\d{1,3})?(?:\.[A-Z]{1,4})?\b/gu,
    /\b(?:IPP|IBP|ITP|ILP|IPT|IPTP|IBPB|IPPB|ITPB|ILPB)[A-Z]?\d?\/[0-9A-Z]{3,5}-[0-9-]{1,12}\/\d{2}(?:-\d{1,3})?\/[A-Z]{2,4}\b/gu,
    /\b(?:DD|PT|DT|DOP|DPP|DCT|DAS)\d{1,2}\.\d{4}\.\d{1,5}\.\d{4}\b/gu
];
export function canonicalInterpretationSignature(value) {
    return value.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}
/** Sygnatury interpretacji w wierszu (kanoniczne, w kolejności wystąpienia). */
export function interpretationSignaturesInLine(lineText) {
    const found = [];
    for (const pattern of SIGNATURE_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of lineText.matchAll(pattern)) {
            if (found.some((item) => item.at <= match.index && match.index < item.at + item.value.length))
                continue;
            found.push({ at: match.index, value: match[0] });
        }
    }
    return found.sort((a, b) => a.at - b.at).map((item) => canonicalInterpretationSignature(item.value));
}
function normalized(value) {
    return value.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("pl").trim();
}
function textFromHtml(html) {
    return html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
        .replace(/&amp;/g, "&")
        .replace(/[ \t]+/g, " ")
        .trim();
}
async function json(fetcher, url, init) {
    const response = await fetcher(url, {
        ...init,
        redirect: "error",
        headers: { Accept: "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!response.ok)
        throw new Error(`EUREKA_HTTP_${response.status}`);
    if (!(response.headers.get("content-type") ?? "").includes("json"))
        throw new Error("EUREKA_NOT_JSON");
    const body = await response.text();
    if (body.length > MAX_BYTES)
        throw new Error("EUREKA_TOO_LARGE");
    return JSON.parse(body);
}
function statusLabel(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    return STATUS_CODE[String(raw)] ?? (typeof raw === "string" ? raw : "nieznany");
}
export async function verifyInterpretation(args) {
    const signature = canonicalInterpretationSignature(args.signature);
    if (interpretationSignaturesInLine(signature)[0] !== signature) {
        return { status: "NOT_FOUND", reason: "INTERPRETATION_SIGNATURE_FORMAT" };
    }
    const fetcher = args.fetcher ?? globalThis.fetch.bind(globalThis);
    let rows;
    try {
        const raw = (await json(fetcher, `${API}/wyszukiwarka/informacje/?size=20&page=0&sort=DT_WYD%2Cdesc`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filter: { SYG: signature },
                columns: ["ID_INFORMACJI", "SYG", "DT_WYD", "TEZA", "KATEGORIA_INFORMACJI", "STATUS_INFORMACJI"],
                searchInFullPhrase: false,
                searchInContent: false,
                searchInSynonyms: false,
                warunkiDodatkowe: []
            })
        }));
        rows = raw.results ?? [];
    }
    catch (error) {
        return { status: "SOURCE_UNAVAILABLE", reason: error instanceof Error ? error.message : "EUREKA_FAILED" };
    }
    // Filtr SYG jest prefiksowy: tylko identyczna sygnatura potwierdza podaną.
    const exact = rows.filter((row) => canonicalInterpretationSignature(String(row.SYG ?? "")) === signature);
    if (exact.length === 0)
        return { status: "NOT_FOUND", reason: "EUREKA_NO_EXACT_SIGNATURE" };
    if (exact.length > 1)
        return { status: "AMBIGUOUS", reason: "EUREKA_MANY_DOCUMENTS" };
    const id = String(exact[0].ID_INFORMACJI ?? "");
    if (!/^\d{1,10}$/.test(id))
        return { status: "NOT_FOUND", reason: "EUREKA_NO_DOCUMENT_ID" };
    let fields;
    try {
        const document = (await json(fetcher, `${API}/informacje/${id}`, { method: "GET" }));
        fields = new Map((document.dokument?.fields ?? []).map((field) => [field.key, field.value]));
    }
    catch (error) {
        return { status: "SOURCE_UNAVAILABLE", reason: error instanceof Error ? error.message : "EUREKA_FAILED" };
    }
    const field = (key) => (typeof fields.get(key) === "string" ? fields.get(key) : "");
    if (canonicalInterpretationSignature(field("SYG")) !== signature) {
        return { status: "NOT_FOUND", reason: "EUREKA_DOCUMENT_SIGNATURE_MISMATCH" };
    }
    const thesis = field("TEZA");
    const body = textFromHtml(field("TRESC_INTERESARIUSZ") || field("TRESC"));
    const eurekaStatus = statusLabel(fields.get("STATUS_INFORMACJI") ?? exact[0].STATUS_INFORMACJI);
    const issuedAt = (field("DT_WYD") || String(exact[0].DT_WYD ?? "")).slice(0, 10) || undefined;
    const base = { eurekaStatus, current: eurekaStatus === "Aktualna", ...(thesis ? { thesis } : {}), ...(issuedAt ? { issuedAt } : {}) };
    if (args.quote?.trim() && !normalized(`${thesis}\n${body}`).includes(normalized(args.quote))) {
        return { status: "QUOTE_MISMATCH", reason: "INTERPRETATION_QUOTE_NOT_IN_TEXT", ...base };
    }
    const record = {
        claim: signature,
        kind: "interpretation",
        status: "VERIFIED",
        sourceUrl: `${PORTAL}/${id}`,
        sourceTier: "R2A",
        fetchedAt: (args.now ?? (() => new Date()))().toISOString(),
        toolCallId: args.toolCallId,
        verificationMethod: "web_fetch",
        evidence: [thesis, body].filter(Boolean).join("\n").slice(0, 3_000),
        interpretationStatus: eurekaStatus
    };
    return { status: "VERIFIED", record, ...base };
}
