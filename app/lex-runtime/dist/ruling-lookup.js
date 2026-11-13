import { courtOfSignature } from "./court-of-signature.js";
import { caseFileKey } from "./verification-ledger.js";
// The final gate recognizes "[NIEWERYFIKOWANE: …]" as a disclosed unverified citation.
export const RULING_LEAD_MARKER = (source) => `⚠️ [NIEWERYFIKOWANE: trop ${source} — do potwierdzenia w bazie sądu]`;
export const RULING_NOT_FOUND_MARKER = (tried) => `⚠️ [NIEWERYFIKOWANE: nie znaleziono (${tried.join(", ")})]`;
const MAX_LOOKUPS = 4;
const norm = (value) => value.normalize("NFKC").replace(/^sygn\.?\s*(?:akt\s*)?:?\s*/iu, "").replace(/\s+/g, " ").trim().toUpperCase();
function parse(content) {
    try {
        const value = JSON.parse(content);
        return value && typeof value === "object" ? value : null;
    }
    catch {
        return null;
    }
}
function matching(result, signature) {
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    return candidates.find((candidate) => (candidate.caseNumbers ?? []).some((number) => norm(number) === norm(signature)));
}
/** The user asks about a ruling ("o czym mówi wyrok … sygn. SDI 9/12"), not names their own proceeding. */
export function askedRulingSignatures(userText, signatures) {
    const asks = /o\s+czym\s+(?:mówi|jest)|co\s+(?:orzekł|rozstrzygnął|stwierdził|mówi)|znajdź|wyszukaj|sprawdź|treść|tez[aęy]|streść|omów|przeanalizuj/iu.test(userText);
    return signatures.filter((signature) => {
        const at = userText.toLocaleUpperCase("pl").indexOf(signature.toLocaleUpperCase("pl"));
        const before = at >= 0 ? userText.slice(Math.max(0, at - 160), at) : "";
        const rulingWord = /(?:wyrok|orzeczen|postanowieni|uchwał|sąd\s+najwyższy|\bSN\b|\bNSA\b|\bWSA\b|trybunał)/iu.test(before);
        const ownCase = /(?:moj|nasz|w\s+mojej|w\s+naszej|klient)\p{L}*\s+(?:spraw|postępowani)/iu.test(before);
        return rulingWord && !ownCase && (asks || /\?\s*$/u.test(userText.trim()));
    });
}
export async function lookupRulings(args) {
    const seen = new Set();
    const out = [];
    let id = 0;
    const call = async (runner, name, input) => {
        try {
            const [result] = await runner([{ id: `ruling-lookup-${++id}`, name, input }]);
            return result?.content ?? "";
        }
        catch {
            return "";
        }
    };
    for (const signature of args.signatures) {
        const key = caseFileKey(signature);
        if (!key || seen.has(key) || out.length >= MAX_LOOKUPS)
            continue;
        seen.add(key);
        const court = courtOfSignature(norm(signature));
        const tried = [];
        if (court === "SN") {
            tried.push("sn.pl");
            const raw = await call(args.runVerification, "verify_case_reference", { claim: signature, signature, courtFamily: "SN" });
            const result = parse(raw);
            if (result?.status === "VERIFIED" || result?.status === "SUPPORTED") {
                out.push({ signature, outcome: "VERIFIED", source: "sn.pl", ...(typeof result.sourceUrl === "string" ? { url: result.sourceUrl } : {}), tried, raw });
                continue;
            }
        }
        if (court === "NSA_WSA") {
            tried.push("CBOSA");
            const raw = await call(args.runVerification, "search_case_law", { query: signature, source: "CBOSA" });
            const hit = matching(parse(raw), signature);
            if (hit) {
                args.ledger.addRetrievedCase(signature);
                out.push({ signature, outcome: "OFFICIAL_HIT", source: "CBOSA", ...(hit.sourceUrl ? { url: hit.sourceUrl } : {}), ...(hit.court ? { court: hit.court } : {}), ...(hit.judgmentDate ? { date: hit.judgmentDate } : {}), tried, raw });
                continue;
            }
        }
        if (court !== "NSA_WSA" && court !== "TK" && court !== "KIO") {
            tried.push("SAOS");
            const raw = await call(args.runVerification, "search_case_law", { query: signature, source: "SAOS" });
            const hit = matching(parse(raw), signature);
            if (hit) {
                args.ledger.addCaseMarker(signature, RULING_LEAD_MARKER("SAOS"));
                out.push({
                    signature,
                    outcome: "LEAD",
                    source: "SAOS (R3, kopia nieurzędowa)",
                    ...(hit.sourceUrl ? { url: hit.sourceUrl } : {}),
                    ...(hit.court ? { court: hit.court } : {}),
                    ...(hit.judgmentDate ? { date: hit.judgmentDate } : {}),
                    ...(hit.excerpt ? { excerpt: hit.excerpt } : {}),
                    tried,
                    raw
                });
                continue;
            }
        }
        if (args.runWebSearch) {
            tried.push("wyszukiwarka");
            const raw = await call(args.runWebSearch, "web_search", { query: `"${norm(signature)}" wyrok`, maxResults: 5 });
            const result = parse(raw);
            // web_search answers {results: [{title, url, snippet}]} (legal-federation-tool-runtime.ts).
            const list = Array.isArray(result?.results) ? result.results : Array.isArray(result?.hits) ? result.hits : [];
            const hits = list;
            const hit = hits.find((item) => norm(`${item.title ?? ""} ${item.snippet ?? ""}`).includes(norm(signature)));
            if (hit) {
                args.ledger.addCaseMarker(signature, RULING_LEAD_MARKER("wyszukiwarka"));
                out.push({ signature, outcome: "LEAD", source: "wyszukiwarka (R3, tylko trop)", ...(hit.url ? { url: hit.url } : {}), ...(hit.snippet ? { excerpt: hit.snippet } : {}), tried, raw });
                continue;
            }
        }
        args.ledger.addCaseMarker(signature, RULING_NOT_FOUND_MARKER(tried));
        out.push({ signature, outcome: "NOT_FOUND", source: "", tried });
    }
    return out;
}
/** What the model gets before it answers: only what the sources returned. */
export function rulingLookupPrompt(found) {
    if (!found.length)
        return "";
    const lines = found.map((item) => {
        if (item.outcome === "NOT_FOUND") {
            return `- ${item.signature}: nie znaleziono (sprawdzono: ${item.tried.join(", ")}). Nie opisuj treści tego orzeczenia; napisz wprost, że nie udało się go odczytać.`;
        }
        const where = [item.source, item.court, item.date, item.url].filter(Boolean).join(", ");
        const status = item.outcome === "VERIFIED" ? "zweryfikowane w bazie sądu" : item.outcome === "OFFICIAL_HIT" ? "znalezione w bazie urzędowej (bez pełnej weryfikacji)" : "trop — do potwierdzenia w bazie sądu";
        return `- ${item.signature}: ${status} (${where})${item.excerpt ? `\n  Początek tekstu ze źródła: «${item.excerpt}»` : ""}`;
    });
    return [
        "[Orzeczenia wskazane w pytaniu — sprawdzone przez aplikację przed odpowiedzią:]",
        ...lines,
        "[Opisuj orzeczenie wyłącznie na podstawie tekstu powyżej; czego w nim nie ma, nie dopowiadaj z pamięci. Nie dopisuj własnych znaczników ✅ ani [VER: …] — status nadaje aplikacja.]"
    ].join("\n");
}
/** A question that asks for case law without naming a signature ("znajdź orzecznictwo o zachowku"). */
export function asksForCaseLaw(userText) {
    return /orzecznictw|linia\s+orzecznicz|(?:znajdź|wyszukaj|podaj|wskaż|jakie\s+są|czy\s+są)\s+(?:\p{L}+\s+){0,3}(?:wyrok|orzeczen|uchwał|postanowie)|(?:wyrok|orzeczen|uchwał)\p{L}*\s+(?:\p{L}+\s+){0,3}(?:w\s+sprawie|dotycząc|o\s+)/iu.test(userText);
}
const QUESTION_WORDS = /(?<![\p{L}\p{N}])(?:znajdź|wyszukaj|podaj|wskaż|jaka|jaki|jakie|czy|są|jest|proszę|mi|o|w|we|na|za|po|do|rzecz|sprawach|sprawie|dotyczące|dotyczących|dokonanej|orzecznictwo|orzeczenia|wyroki|wyrok|linia|orzecznicza|sądów|sądu|sąd|najwyższego|uchwały)(?![\p{L}\p{N}])/giu;
/** A neutral search phrase: the question's legal terms, without placeholders of personal data. */
export function caseLawSearchPhrase(protectedQuery) {
    return protectedQuery
        .replace(/\[(?:LMPII:D\d{2}|PII):[A-Z_]+:\d{4}\]/gu, " ")
        .replace(/[?!.,;:„”"()]/gu, " ")
        .replace(QUESTION_WORDS, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .split(" ")
        .filter((word) => word.length > 2)
        .slice(0, 10)
        .join(" ");
}
/** Leads before the answer: SAOS full text and a web search on the question's legal terms (R3). */
export async function searchCaseLawLeads(args) {
    if (args.phrase.split(" ").length < 2)
        return [];
    const leads = [];
    try {
        const [saos] = await args.runVerification([{ id: "case-law-leads-saos", name: "search_case_law", input: { query: args.phrase, source: "SAOS", limit: 5, sort: "cited" } }]);
        const parsed = parse(saos?.content ?? "");
        for (const candidate of (Array.isArray(parsed?.candidates) ? parsed.candidates : []).slice(0, 5)) {
            if (!candidate.sourceUrl)
                continue;
            leads.push({ source: "SAOS", ...(candidate.caseNumbers?.[0] ? { signature: candidate.caseNumbers[0] } : {}), ...(candidate.court ? { court: candidate.court } : {}), ...(candidate.judgmentDate ? { date: candidate.judgmentDate } : {}), url: candidate.sourceUrl });
        }
    }
    catch {
        // SAOS down: the web search may still give leads
    }
    if (args.runWebSearch) {
        try {
            const [web] = await args.runWebSearch([{ id: "case-law-leads-web", name: "web_search", input: { query: `${args.phrase} wyrok sygn.`, maxResults: 5 } }]);
            const parsed = parse(web?.content ?? "");
            const list = (Array.isArray(parsed?.results) ? parsed.results : []);
            for (const hit of list.slice(0, 5))
                if (hit.url)
                    leads.push({ source: "wyszukiwarka", ...(hit.title ? { title: hit.title } : {}), url: hit.url });
        }
        catch {
            // no web search
        }
    }
    return leads;
}
export function caseLawLeadsPrompt(phrase, leads) {
    if (!leads.length)
        return `[Aplikacja przeszukała SAOS i wyszukiwarkę frazą „${phrase}” przed odpowiedzią — bez trafień. Nie podawaj sygnatur z pamięci; szukaj narzędziami albo napisz, że nie znaleziono.]`;
    return [
        `[Tropy orzecznictwa znalezione przez aplikację przed odpowiedzią (fraza „${phrase}”; poziom R3 — treść i tezę sprawdź w źródle narzędziem, zanim je opiszesz):]`,
        ...leads.map((lead) => `- ${lead.source}: ${[lead.signature, lead.court, lead.date, lead.title].filter(Boolean).join(", ")} — ${lead.url}`),
        "[Sygnatury spoza tej listy i spoza wyników narzędzi nie podawaj z pamięci.]"
    ].join("\n");
}
