import { CoreLawSearchIndex } from "./core-law-search.js";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalPdfTextExtractor } from "./pdf-text-extractor.js";
import { htmlArticleAnchors, pdfArticleAnchors } from "./source-anchor.js";
/**
 * Why the copy of an act cannot be taken as the current wording (verification
 * from the copy is refused and the act must be checked in ELI), or null.
 */
export function coreLawEliCaution(act) {
    if (act.pendingConsolidated)
        return "w ELI jest nowszy tekst jednolity, jeszcze niezastosowany";
    if (act.pendingAmendments.length) {
        return `nowe nowelizacje w ELI, jeszcze niezastosowane (${act.pendingAmendments.length})`;
    }
    if (act.amendmentsAfter.length)
        return `nowelizacje po tekście jednolitym (${act.amendmentsAfter.length})`;
    if (act.textSource === "ocr")
        return "tekst odczytany OCR ze skanu ELI (bez warstwy tekstowej), możliwe błędy odczytu";
    return null;
}
/** Kopia sprzed kotwic jednostek: link bez kotwicy, do ponownego pobrania. */
export function needsAnchorUpgrade(record) {
    return ((record.extraction ?? 0) < 3 &&
        (record.textSource === "html" || record.textSource === "pdf") &&
        record.articleOrder.length > 0);
}
const ELI_API = "https://api.sejm.gov.pl/eli";
// Texts are downloaded once. Consolidated texts are re-checked (ELI relations
// only, no text) at most once a day for new amendments or a newer t.j.
const CHECK_AFTER_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_BLOCK_MS = 60 * 60 * 1000;
const SCHEDULE_TICK_MS = 60 * 60 * 1000;
const REQUEST_GAP_MS = 750;
const REQUEST_TIMEOUT_MS = 90_000;
// Tekst ogłoszony w Dz.U. bywa całym numerem z załącznikami (umowa MRG Polska–Ukraina:
// 608 stron, 8 MB), więc kopia ELI ma własne, wyższe limity niż dokumenty sprawy.
const CORE_LAW_PDF_LIMITS = { maxBytes: 128 * 1024 * 1024, maxPages: 5_000, maxTextChars: 60_000_000 };
const PDF_TIMEOUT_MS = 10 * 60_000;
// Strona, na której po usunięciu nagłówka Dz.U. zostaje mniej znaków, jest skanem.
const OCR_MIN_PAGE_CHARS = 40;
// OCR idzie partiami stron; partia to osobne wywołanie lokalnego OCR.
const OCR_BATCH_PAGES = 25;
const OCR_MAX_PAGES = 1_000;
const MAX_CONSECUTIVE_FAILURES = 5;
// Przy użyciu kopii relacje aktu są sprawdzane w ELI, nie częściej niż raz na kwadrans.
const USE_CHECK_AFTER_MS = 15 * 60 * 1000;
const USE_CHECK_TIMEOUT_MS = 15_000;
// Kopie sprzed kotwic jednostek (extraction < 3) są pobierane ponownie, partiami.
const ANCHOR_UPGRADES_PER_RUN = 5;
const NOTE_CHARS = 400;
// "Dz.U. 2011 Nr 230, poz. 1370", "Dz.U. 2026 poz. 421, 638 i 901", "Dz.U. z 2024 r. poz. 1".
const REF_PATTERN = /Dz\.\s?U\.\s?(?:z\s)?(\d{4})\s?(?:r\.\s?,?\s?)?(?:[Nn]r\s?\d+\s?,?\s)?poz\.\s?(\d+)((?:\s*(?:,|\si)\s*(?:\d{4}\s?poz\.\s?)?\d+(?!\d|\.\d))*)(\s*t\.\s?j\.)?/g;
function cleanNote(line) {
    return line
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, NOTE_CHARS);
}
// "✅ DODANE 2026-10-04 (AUDYT-2026-10-04h):" — a status note of the map, not the act's name.
const STATUS_NOTE = /^[\s✅⚠⛔🟨⬛\uFE0F]*(?:DODANE|DODANY|NOWY|NOWE|ZMIANA|ZMIENIONE|UWAGA|AKTUALIZACJA|SYNCHRONIZACJA|KOREKTA)\b[^:]*:\s*/iu;
function labelFor(line) {
    const bold = /\*\*(?:Baza\s+)?([^*:]{1,40}):\*\*/.exec(line);
    if (bold?.[1] && !STATUS_NOTE.test(`${bold[1]}:`))
        return bold[1].trim();
    if (line.trim().startsWith("|")) {
        const cell = line.split("|")[1]?.replace(/\*\*/g, "").replace(STATUS_NOTE, "").trim();
        if (cell && !/^-+$/.test(cell) && !/^Akt prawny$/i.test(cell) && !/^Zakres$/i.test(cell)) {
            return cell.slice(0, 80);
        }
    }
    return null;
}
function mapFiles(corpusRoot) {
    const files = [];
    for (const entry of fs.readdirSync(corpusRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("dr-"))
            continue;
        const file = path.join(corpusRoot, entry.name, "MAPA-AKTOW.md");
        if (fs.existsSync(file))
            files.push({ domain: entry.name, file });
    }
    const routing = path.join(corpusRoot, "prawo-polskie-v2", "ROUTING-MAP.md");
    if (fs.existsSync(routing)) {
        files.push({ domain: "prawo-polskie-v2", file: routing });
    }
    return files.sort((a, b) => a.domain.localeCompare(b.domain));
}
/**
 * Source registries of a domain (dr-* /references/<zakres>/sources.json): the acts whose
 * full texts the skill ships, e.g. the amendments after the last t.j. of PrUp/PrRestr.
 */
function sourceRegistries(corpusRoot) {
    const files = [];
    for (const entry of fs.readdirSync(corpusRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("dr-"))
            continue;
        const references = path.join(corpusRoot, entry.name, "references");
        let scopes;
        try {
            scopes = fs.readdirSync(references, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const scope of scopes) {
            const file = path.join(references, scope.name, "sources.json");
            if (scope.isDirectory() && fs.existsSync(file))
                files.push({ domain: entry.name, file });
        }
    }
    return files.sort((a, b) => a.file.localeCompare(b.file));
}
// Only amendments: "historyczny_nie_stosuj_jako_biezacy" texts (original acts, superseded
// t.j.) are reference points for a past state, not wording to quote as current law.
const REGISTRY_ROLES = new Set(["nowelizacja"]);
/** All Dz.U. acts named in the domain act maps, the routing map and the source registries. */
export function extractCoreActs(corpusRoot) {
    const acts = new Map();
    const add = (eli, consolidated, domain, label, note) => {
        const current = acts.get(eli) ??
            { eli, consolidated: false, labels: [], domains: [], notes: [] };
        current.consolidated ||= consolidated;
        if (label && !current.labels.includes(label))
            current.labels.push(label);
        if (!current.domains.includes(domain))
            current.domains.push(domain);
        if (note && current.notes.length < 6 && !current.notes.includes(note)) {
            current.notes.push(note);
        }
        acts.set(eli, current);
    };
    for (const { domain, file } of mapFiles(corpusRoot)) {
        for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
            const label = labelFor(line);
            const note = cleanNote(line);
            // The row's name belongs to its first act; the others in the row (amendments,
            // "nie mylić z ...") are named by their ELI title, not by this row.
            let first = true;
            for (const match of line.matchAll(REF_PATTERN)) {
                const year = match[1];
                const tail = match[3] ?? "";
                const consolidated = Boolean(match[4]) && tail.trim() === "";
                add(`DU/${year}/${Number(match[2])}`, consolidated, domain, first ? label : null, note);
                first = false;
                let currentYear = year;
                for (const item of tail.split(/,|\si\s/).map((part) => part.trim()).filter(Boolean)) {
                    const withYear = /^(\d{4})\s?poz\.\s?(\d+)$/.exec(item);
                    if (withYear) {
                        currentYear = withYear[1];
                        add(`DU/${currentYear}/${Number(withYear[2])}`, false, domain, null, note);
                    }
                    else if (/^\d+$/.test(item)) {
                        add(`DU/${currentYear}/${Number(item)}`, false, domain, null, note);
                    }
                }
            }
        }
    }
    for (const { domain, file } of sourceRegistries(corpusRoot)) {
        let sources;
        try {
            sources = JSON.parse(fs.readFileSync(file, "utf8")).sources;
        }
        catch {
            continue;
        }
        if (!Array.isArray(sources))
            continue;
        const scope = path.basename(path.dirname(file));
        for (const source of sources) {
            if (typeof source.eli !== "string" || typeof source.role !== "string")
                continue;
            const eli = /^DU\/(\d{4})\/(\d+)$/.exec(source.eli);
            if (!eli || !REGISTRY_ROLES.has(source.role))
                continue;
            const id = typeof source.id === "string" ? ` (${source.id})` : "";
            add(`DU/${eli[1]}/${Number(eli[2])}`, false, domain, null, cleanNote(`references/${scope}/sources.json: ${source.role}${id}`));
        }
    }
    return [...acts.values()].sort((a, b) => Number(b.consolidated) - Number(a.consolidated) ||
        a.eli.localeCompare(b.eli, "en", { numeric: true }));
}
const ENTITIES = {
    nbsp: " ",
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    ndash: "–",
    mdash: "—",
    sect: "§",
    bdquo: "„",
    rdquo: "”",
    hellip: "…"
};
export function htmlToText(html) {
    return html
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|h[1-6]|li|tr|table|section|article)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&([a-z]+);/gi, (entity, name) => ENTITIES[name.toLowerCase()] ?? entity)
        .replace(/[ \t ]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
// Nagłówek/stopka strony Dz.U. z ISAP ("©Kancelaria Sejmu s. 12/180", data t.j.) przerywa
// artykuł na granicy stron i psułby porównanie cytatu.
export function stripPdfPageHeaders(text) {
    return text
        .split("\n")
        .filter((line) => !/^\s*©?\s*Kancelaria Sejmu\s+s\.\s*\d+\s*\/\s*\d+\s*$/iu.test(line))
        .filter((line) => !/^\s*\d{4}-\d{2}-\d{2}\s*$/u.test(line))
        .filter((line) => !/^\s*Dziennik Ustaw(?:\s+Nr\s*\d+)?\s*[–—-]\s*\d+\s*[–—-]\s*Poz\.\s*\d+(?:\s+www\.rcl\.gov\.pl)?\s*$/iu.test(line))
        .filter((line) => !/^\s*www\.rcl\.gov\.pl\s*$/iu.test(line))
        // OCR dzieli nagłówek na dwa wiersze: "Dziennik Ustaw Nr 103 — 7712 —" i "Poz. 858".
        .filter((line) => !/^\s*Dziennik Ustaw(?:\s+Nr\s*\d+)?\s*[–—-]\s*\d+\s*[–—-]?\s*$/iu.test(line))
        .filter((line) => !/^\s*Poz\.\s*\d+\s*$/iu.test(line))
        .join("\n")
        // Przeniesienie wyrazu na granicy wiersza ("zna-\nleziony").
        .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2");
}
// PDF Dz.U. z lat ok. 2003-2011 mają czcionki z własnym kodowaniem: pdf.js zwraca
// "mi´dzy Rzàdem ma∏ego" zamiast "między Rządem małego". Mapowanie małych liter
// potwierdzone na DU/2009/858; wielkie jak w pomyłce CP1250/CP1252.
const DZU_FONT_MAP = {
    "à": "ą", "ç": "ć", "´": "ę", "∏": "ł", "ƒ": "ń", "Ê": "ś", "ê": "ź", "˝": "ż",
    "¥": "Ą", "Æ": "Ć", "£": "Ł", "Œ": "Ś", "¯": "Ż"
};
/** Naprawia tekst PDF Dz.U. z błędnym kodowaniem czcionki; inny tekst bez zmian. */
export function repairDzuPdfEncoding(text) {
    // "∏" i "´"/"˝" wewnątrz wyrazu nie występują w poprawnym polskim tekście.
    if (!/\p{L}[´∏˝ƒ]|[∏˝]\p{L}/u.test(text))
        return text;
    return text.replace(/[àç´∏ƒÊê˝¥Æ£Œ¯]/gu, (char) => DZU_FONT_MAP[char] ?? char);
}
function articleBase(id) {
    return Number.parseInt(id, 10);
}
/**
 * Luki i zaburzenia numeracji artykułów po wyciągnięciu tekstu. W tekście jednolitym
 * uchylone artykuły zostają jako "Art. N. (uchylony)", więc luka zwykle znaczy zgubiony
 * nagłówek: tekst brakującego artykułu dopisał się do poprzedniego.
 */
export function checkArticleExtraction(text, order) {
    const marks = [...text.matchAll(/(?:^|\n)\s*(?:Art\.\s*(\d+[a-z]{0,4})\.|Artykuł\s+(\d+[a-z]{0,4})\.?)(?=\s)/gu)]
        .map((match) => (match[1] ?? match[2]));
    const gaps = [];
    const suspect = new Set();
    let outOfOrder = 0;
    for (let index = 1; index < order.length; index += 1) {
        const previous = articleBase(order[index - 1]);
        const current = articleBase(order[index]);
        if (current > previous + 1) {
            gaps.push(current === previous + 2 ? String(previous + 1) : `${previous + 1}–${current - 1}`);
            suspect.add(order[index - 1]);
        }
        else if (current < previous) {
            outOfOrder += 1;
            suspect.add(order[index - 1]);
        }
    }
    const seen = new Set();
    let duplicates = 0;
    marks.forEach((id, index) => {
        if (seen.has(id)) {
            duplicates += 1;
            if (index > 0)
                suspect.add(marks[index - 1]);
        }
        seen.add(id);
    });
    return { gaps, outOfOrder, duplicates, suspectArticles: [...suspect].filter((id) => order.includes(id)) };
}
/** Article number -> article text. The first occurrence of a number wins. */
export function splitArticles(text) {
    // "Art. 5." w ustawach; "Artykuł 5" w umowach międzynarodowych.
    const pattern = /(?:^|\n)\s*(?:Art\.\s*(\d+[a-z]{0,4})\.|Artykuł\s+(\d+[a-z]{0,4})\.?)(?=\s)/gu;
    const marks = [...text.matchAll(pattern)].map((match) => ({
        id: (match[1] ?? match[2]),
        start: match.index + (match[0].startsWith("\n") ? 1 : 0)
    }));
    const order = [];
    const articles = {};
    marks.forEach((mark, index) => {
        if (articles[mark.id] !== undefined)
            return;
        const end = marks[index + 1]?.start ?? text.length;
        articles[mark.id] = text.slice(mark.start, end).trim();
        order.push(mark.id);
    });
    return { order, articles };
}
export function normalizeForSearch(value) {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/ł/g, "l")
        .replace(/Ł/g, "L")
        .toLocaleLowerCase("pl");
}
function adoptedRef(entry) {
    return {
        eli: entry.eli,
        consolidated: true,
        labels: entry.label ? [entry.label, entry.title] : [entry.title],
        domains: [],
        notes: [
            entry.origin === "USER"
                ? "Dodany przez użytkownika, sprawdzony w źródle (Sejm ELI)."
                : "Dołączony po weryfikacji w źródle (Sejm ELI), spoza map DR."
        ]
    };
}
export function eliLinks(refs, relation) {
    if (!refs || typeof refs !== "object")
        return [];
    const links = [];
    for (const [key, value] of Object.entries(refs)) {
        if (!relation(key) || !Array.isArray(value))
            continue;
        for (const item of value) {
            const wrapper = (item && typeof item === "object" ? item : {});
            const act = (wrapper.act && typeof wrapper.act === "object" ? wrapper.act : wrapper);
            const match = /^(DU|MP)\/(\d{4})\/(\d+)$/i.exec(String(act.ELI ?? "").trim());
            if (!match)
                continue;
            links.push({
                eli: `${match[1].toUpperCase()}/${match[2]}/${Number(match[3])}`,
                year: Number(match[2]),
                pos: Number(match[3]),
                title: typeof act.title === "string" ? act.title : null,
                promulgation: typeof act.promulgation === "string" ? act.promulgation : null,
                status: typeof act.status === "string" ? act.status : ""
            });
        }
    }
    return links;
}
function eliOrder(eli) {
    const match = /^(?:DU|MP)\/(\d{4})\/(\d+)$/.exec(eli);
    return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}
export function defaultCoreLawDir(env = process.env) {
    const override = env.LEX_CORE_LAW_DIR?.trim();
    if (override)
        return path.resolve(override);
    const base = env.LOCALAPPDATA?.trim();
    return base
        ? path.resolve(base, "LexMachina", "core-law")
        : path.resolve(os.homedir(), ".lex-machina", "core-law");
}
/** Błąd, którego ponowienie za godzinę nic nie zmieni (np. ELI nie ma tekstu aktu). */
class CoreLawPermanentError extends Error {
    noText;
    // noText: ELI nie ma tekstu aktu (stan UNAVAILABLE, nie "błąd pobierania").
    constructor(message, noText = false) {
        super(message);
        this.noText = noText;
    }
}
// Trwały błąd pobrania jest ponawiany raz na dobę, nie przy każdym cyklu.
const PERMANENT_RETRY_MS = 24 * 60 * 60 * 1000;
function fileNameFor(eli) {
    return eli.replace(/\//g, "_") + ".json";
}
export class CoreLawIndex {
    directory;
    fetcher;
    pdf;
    now;
    gapMs;
    ocr;
    refs = [];
    state = { acts: {}, blockedUntil: null };
    cache = new Map();
    searchIndex = null;
    refreshing = null;
    progress = null;
    useChecks = new Map();
    constructor(directory = defaultCoreLawDir(), fetcher = globalThis.fetch.bind(globalThis), 
    // Wiersze z PDF: splitArticles szuka "Art. N." na początku wiersza; bez nich tekst
    // jednolity dostępny tylko w PDF (np. kodeksy) dawał zero artykułów.
    pdf = new LocalPdfTextExtractor(CORE_LAW_PDF_LIMITS, {
        lines: true,
        allowEmpty: true
    }), now = () => Date.now(), gapMs = REQUEST_GAP_MS, 
    // Lokalny OCR dla PDF ELI będących skanem (stare Dz.U.); null = bez OCR.
    ocr = null) {
        this.directory = directory;
        this.fetcher = fetcher;
        this.pdf = pdf;
        this.now = now;
        this.gapMs = gapMs;
        this.ocr = ocr;
    }
    corpusRoot = null;
    mapsSignature = "";
    // Size and mtime of every act map and source registry: a skill update changes it.
    static mapsSignatureOf(corpusRoot) {
        return [...mapFiles(corpusRoot), ...sourceRegistries(corpusRoot)]
            .map(({ file }) => {
            try {
                const stat = fs.statSync(file);
                return `${file}:${stat.size}:${stat.mtimeMs}`;
            }
            catch {
                return `${file}:-`;
            }
        })
            .join("|");
    }
    /**
     * After a skill update the act maps change: the act list is read again, so new
     * acts are downloaded on the next refresh (not only after a restart).
     * Returns the ELIs added.
     */
    reloadMapsIfChanged() {
        if (!this.corpusRoot)
            return [];
        const signature = CoreLawIndex.mapsSignatureOf(this.corpusRoot);
        if (signature === this.mapsSignature)
            return [];
        const before = new Set(this.refs.map((ref) => ref.eli));
        const adopted = this.refs.filter((ref) => (this.state.adopted ?? []).some((item) => item.eli === ref.eli));
        this.refs = extractCoreActs(this.corpusRoot);
        for (const ref of adopted)
            if (!this.ref(ref.eli))
                this.refs.push(ref);
        this.mapsSignature = signature;
        return this.refs.map((ref) => ref.eli).filter((eli) => !before.has(eli));
    }
    load(corpusRoot) {
        this.corpusRoot = corpusRoot;
        this.mapsSignature = CoreLawIndex.mapsSignatureOf(corpusRoot);
        this.refs = extractCoreActs(corpusRoot);
        fs.mkdirSync(this.directory, { recursive: true });
        try {
            this.state = JSON.parse(fs.readFileSync(path.join(this.directory, "index.json"), "utf8"));
        }
        catch {
            this.state = { acts: {}, blockedUntil: null };
        }
        for (const adopted of this.state.adopted ?? []) {
            if (!this.ref(adopted.eli))
                this.refs.push(adoptedRef(adopted));
        }
    }
    /**
     * Akt zweryfikowany w źródle (ELI): spoza map -> dołączony do kopii i RAG; z map, ale z
     * nowszym t.j. w źródle niż w kopii -> wymuszone sprawdzenie relacji przy odświeżaniu.
     * Pobieranie odbywa się w tle, jak dla aktów z map.
     */
    adopt(act, currentEli = act.eli) {
        const known = this.refs.find((ref) => ref.eli === act.eli ||
            ref.eli === currentEli ||
            this.state.acts[ref.eli]?.currentEli === currentEli);
        if (known) {
            const state = this.state.acts[known.eli];
            if (!state || (state.currentEli ?? known.eli) === currentEli)
                return;
            state.checkedAt = null;
        }
        else {
            const entry = { eli: currentEli, title: act.title };
            this.state.adopted = [...(this.state.adopted ?? []), entry];
            this.refs.push(adoptedRef(entry));
        }
        this.saveState();
        void this.refresh().catch(() => undefined);
    }
    summaries() {
        const adopted = new Map((this.state.adopted ?? []).map((entry) => [entry.eli, entry]));
        return this.refs.map((ref) => {
            const state = this.state.acts[ref.eli];
            const entry = adopted.get(ref.eli);
            return {
                eli: ref.eli,
                title: state?.title ?? null,
                status: state?.status ?? null,
                consolidated: ref.consolidated,
                labels: ref.labels,
                domains: ref.domains,
                textSource: state?.textSource ?? null,
                articleCount: state?.articleCount ?? 0,
                fetchedAt: state?.fetchedAt ?? null,
                lastError: state?.lastError ?? null,
                unavailable: state?.unavailable ?? null,
                relationsCheckedAt: state?.relationsCheckedAt ?? null,
                currentEli: state?.currentEli ?? ref.eli,
                amendmentsAfter: state?.amendmentsAfter ?? [],
                pendingConsolidated: state?.pendingConsolidated ?? null,
                pendingAmendments: state?.pendingAmendments ?? [],
                origin: entry ? (entry.origin === "USER" ? "USER" : "VERIFIED") : "MAP",
                addedAt: entry?.addedAt ?? null,
                addedBy: entry?.addedBy ?? null
            };
        });
    }
    /** Akt już w kopii (z map albo dołączony) dla któregokolwiek z podanych ELI. */
    present(elis) {
        const wanted = new Set(elis);
        const ref = this.refs.find((item) => wanted.has(item.eli) ||
            wanted.has(this.state.acts[item.eli]?.currentEli ?? item.eli) ||
            (this.state.adopted ?? []).some((entry) => entry.eli === item.eli && entry.baseEli && wanted.has(entry.baseEli)));
        return ref?.eli ?? null;
    }
    /**
     * Akt dodany przez użytkownika po sprawdzeniu w ELI (lookupCoreLawAct): tekst
     * (najnowszy t.j. albo akt) jest pobierany w tle i trafia do kopii i RAG.
     */
    addUserAct(act, addedBy) {
        const existing = this.present([act.currentEli, act.baseEli]);
        if (existing)
            return { added: false, eli: existing };
        const entry = this.addAdopted(act, { origin: "USER", addedBy });
        void this.refresh({ force: true, only: [entry.eli] }).catch(() => undefined);
        return { added: true, eli: entry.eli };
    }
    /**
     * Akt, którego brak w kopii, sprawdzony w ELI (lookupCoreLawAct): dołączany do kopii
     * jako pamięć podręczna oficjalnego tekstu (najnowszy t.j., data pobrania). Czeka na
     * pobranie najwyżej waitMs; ready=false oznacza, że tekst jeszcze się pobiera.
     */
    async addMissingAct(act, waitMs = 20_000) {
        const existing = this.present([act.currentEli, act.baseEli, act.inputEli]);
        const eli = existing ?? this.addAdopted(act).eli;
        if (this.currentRecord(eli))
            return { eli, added: false, ready: true };
        const run = this.refresh({ force: true, only: [eli] }).then(() => true, () => false);
        let timer;
        const ready = await Promise.race([
            run,
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(false), waitMs);
                timer.unref?.();
            })
        ]);
        clearTimeout(timer);
        return { eli, added: !existing, ready: ready && this.currentRecord(eli) !== null };
    }
    addAdopted(act, user) {
        const entry = {
            eli: act.currentEli,
            title: act.title,
            ...(act.shortTitle ? { label: act.shortTitle } : {}),
            ...(user ? { origin: user.origin } : {}),
            baseEli: act.baseEli,
            addedAt: new Date(this.now()).toISOString(),
            ...(user ? { addedBy: user.addedBy } : {})
        };
        this.state.adopted = [...(this.state.adopted ?? []), entry];
        this.refs.push(adoptedRef(entry));
        this.logChange({ kind: "ADDED", actEli: entry.eli, eli: entry.eli, title: act.title });
        this.saveState();
        return entry;
    }
    /**
     * Przy użyciu kopii: czy ELI nie ma nowszego t.j. albo nowych nowelizacji (same relacje,
     * bez tekstu). Znaleziona zmiana trafia do pendingConsolidated/pendingAmendments, więc
     * weryfikacja z kopii jest odmawiana do czasu odświeżenia; przy automatycznych
     * aktualizacjach odświeżenie rusza od razu w tle. Kopia sprzed kotwic jest pobierana ponownie.
     */
    confirmCurrent(eli) {
        const running = this.useChecks.get(eli);
        if (running)
            return running;
        const run = this.runUseCheck(eli).finally(() => this.useChecks.delete(eli));
        this.useChecks.set(eli, run);
        return run;
    }
    async runUseCheck(eli) {
        const ref = this.ref(eli);
        const state = this.state.acts[eli];
        const record = this.currentRecord(eli);
        if (!ref || !state || !record)
            return { state: "NO_COPY", checkedAt: null };
        const pending = () => Boolean(state.pendingConsolidated || state.pendingAmendments?.length);
        const result = () => ({
            state: pending() ? "UPDATE_FOUND" : "CURRENT",
            checkedAt: state.relationsCheckedAt ?? null
        });
        if (needsAnchorUpgrade(record)) {
            void this.refresh({ force: true, only: [eli] }).catch(() => undefined);
        }
        const last = state.relationsCheckedAt ? Date.parse(state.relationsCheckedAt) : 0;
        if (!pending() && this.now() - last < USE_CHECK_AFTER_MS)
            return result();
        if (this.state.blockedUntil && Date.parse(this.state.blockedUntil) > this.now()) {
            return { state: "UNREACHABLE", checkedAt: state.relationsCheckedAt ?? null, error: "ELI_BLOCKED" };
        }
        if (!pending()) {
            try {
                await this.checkConsolidated(ref, state, false, USE_CHECK_TIMEOUT_MS);
            }
            catch (error) {
                return {
                    state: "UNREACHABLE",
                    checkedAt: state.relationsCheckedAt ?? null,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
            this.saveState();
        }
        if (pending() && this.autoApply) {
            void this.refresh({ force: true, apply: [eli], only: [eli] }).catch(() => undefined);
        }
        return result();
    }
    /** Usuwa z kopii akt dodany przez użytkownika (akty z map zostają). */
    removeUserAct(eli) {
        const entry = (this.state.adopted ?? []).find((item) => item.eli === eli && item.origin === "USER");
        if (!entry)
            return false;
        const state = this.state.acts[eli];
        const files = new Set([eli, state?.currentEli ?? eli, ...(state?.amendmentsAfter ?? []).map((item) => item.eli)]);
        this.state.adopted = (this.state.adopted ?? []).filter((item) => item !== entry);
        this.refs = this.refs.filter((ref) => ref.eli !== eli);
        delete this.state.acts[eli];
        // Pliki współdzielone z innym aktem kopii zostają.
        const used = new Set();
        for (const ref of this.refs) {
            const other = this.state.acts[ref.eli];
            used.add(ref.eli);
            if (other?.currentEli)
                used.add(other.currentEli);
            for (const item of other?.amendmentsAfter ?? [])
                used.add(item.eli);
        }
        for (const file of files) {
            if (used.has(file))
                continue;
            fs.rmSync(path.join(this.directory, fileNameFor(file)), { force: true });
            this.cache.delete(file);
        }
        this.searchIndex = null;
        this.logChange({ kind: "REMOVED", actEli: eli, eli, title: entry.title });
        this.saveState();
        return true;
    }
    summary(eli) {
        return this.summaries().find((act) => act.eli === eli) ?? null;
    }
    /** The text to serve for a map act: its newest downloaded t.j. */
    currentRecord(eli) {
        const current = this.state.acts[eli]?.currentEli ?? eli;
        return this.record(current) ?? this.record(eli);
    }
    ref(eli) {
        return this.refs.find((item) => item.eli === eli);
    }
    // Amendments downloaded after a consolidated text are readable by ELI too.
    refOrAmendment(eli) {
        const ref = this.ref(eli);
        if (ref)
            return ref;
        for (const [mapEli, state] of Object.entries(this.state.acts)) {
            if (state.amendmentsAfter?.some((item) => item.eli === eli)) {
                return {
                    eli,
                    consolidated: false,
                    labels: [],
                    domains: this.ref(mapEli)?.domains ?? [],
                    notes: [`Nowelizacja po tekście jednolitym ${state.currentEli ?? mapEli}`]
                };
            }
        }
        return null;
    }
    /** ELI, "Dz.U. 2025 poz. 383", a map label (KK, Kodeks spółek handlowych) or a title fragment. */
    resolve(act) {
        const trimmed = act.trim();
        const eli = /^DU\/(\d{4})\/(\d+)$/i.exec(trimmed);
        if (eli)
            return this.refOrAmendment(`DU/${eli[1]}/${Number(eli[2])}`);
        const dzu = /(\d{4})\s*(?:r\.\s*)?poz\.\s*(\d+)/i.exec(trimmed);
        if (dzu)
            return this.refOrAmendment(`DU/${dzu[1]}/${Number(dzu[2])}`);
        const wanted = normalizeForSearch(trimmed).replace(/[.\s]+/g, "");
        if (!wanted)
            return null;
        const scored = this.refs
            .map((ref) => {
            const names = [
                ...ref.labels,
                this.state.acts[ref.eli]?.title ?? ""
            ].map((name) => normalizeForSearch(name).replace(/[.\s]+/g, ""));
            const exact = names.some((name) => name === wanted);
            const partial = names.some((name) => name.length > 0 && name.includes(wanted));
            return { ref, score: exact ? 2 : partial ? 1 : 0 };
        })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score ||
            Number(b.ref.consolidated) - Number(a.ref.consolidated));
        return scored[0]?.ref ?? null;
    }
    /**
     * Ranked search over the current text of every downloaded act (BM25),
     * built on first use and rebuilt after a new text is downloaded.
     */
    search(query, options = {}) {
        if (!this.searchIndex) {
            const articles = [];
            for (const act of this.summaries()) {
                if (act.articleCount === 0)
                    continue;
                const record = this.currentRecord(act.eli);
                if (!record)
                    continue;
                for (const id of record.articleOrder) {
                    articles.push({ eli: record.eli, title: record.title, article: id, text: record.articles[id] });
                }
                // An amendment after the t.j. is its own document in RAG.
                for (const amendment of act.amendmentsAfter) {
                    const text = this.record(amendment.eli);
                    if (!text)
                        continue;
                    for (const id of text.articleOrder) {
                        articles.push({ eli: text.eli, title: text.title, article: id, text: text.articles[id] });
                    }
                }
            }
            this.searchIndex = new CoreLawSearchIndex(articles);
        }
        const eli = options.eli ? (this.state.acts[options.eli]?.currentEli ?? options.eli) : undefined;
        return this.searchIndex.search(query, { ...(eli ? { eli } : {}), limit: options.limit ?? 10 });
    }
    record(eli) {
        const cached = this.cache.get(eli);
        if (cached)
            return cached;
        try {
            const record = JSON.parse(fs.readFileSync(path.join(this.directory, fileNameFor(eli)), "utf8"));
            // Kopia bez artykułów sprzed wersji 2 (pusty HTML t.j. albo PDF bez wierszy) jest
            // traktowana jak niepobrana, więc odświeżanie pobiera ją ponownie.
            if (!record.extraction && record.articleOrder.length === 0)
                return null;
            // Kopie z PDF pobrane przed kontrolą jakości: wynik liczony przy odczycie.
            if (record.textSource === "pdf" && !record.extractionCheck && record.text) {
                const check = checkArticleExtraction(record.text, record.articleOrder);
                if (check.suspectArticles.length || check.gaps.length)
                    record.extractionCheck = check;
            }
            if (this.cache.size > 24) {
                this.cache.delete(this.cache.keys().next().value);
            }
            this.cache.set(eli, record);
            return record;
        }
        catch {
            return null;
        }
    }
    /** Background refresh; returns immediately when one is already running. */
    refresh(options = {}) {
        // A requested check/apply runs after the one in progress, not instead of it.
        const run = (this.refreshing && options.force
            ? this.refreshing.then(() => this.refreshAll(options))
            : this.refreshing ?? this.refreshAll(options)).finally(() => {
            if (this.refreshing === run)
                this.refreshing = null;
        });
        this.refreshing = run;
        return run;
    }
    get autoApply() {
        return this.state.autoApply !== false;
    }
    setAutoApply(value) {
        this.state.autoApply = value;
        this.saveState();
    }
    /**
     * Checks the copy while the application runs: every tick runs a regular
     * (not forced) refresh, so each consolidated text is checked in ELI at most
     * once a day and texts not downloaded yet are retried. Returns a stop function.
     */
    startSchedule(intervalMs = SCHEDULE_TICK_MS) {
        const timer = setInterval(() => {
            void this.refresh().catch(() => undefined);
        }, intervalMs);
        timer.unref?.();
        return () => clearInterval(timer);
    }
    /** Checks every consolidated text now (relations only unless auto-apply). */
    checkNow() {
        return this.refresh({ force: true });
    }
    /** Applies found updates: all acts, or the given map ELIs. */
    applyUpdates(elis) {
        return this.refresh(elis?.length ? { force: true, apply: elis, only: elis } : { force: true, apply: "all" });
    }
    status() {
        const acts = this.summaries().map((act) => {
            const due = act.consolidated &&
                (!act.relationsCheckedAt || this.now() - Date.parse(act.relationsCheckedAt) >= CHECK_AFTER_MS);
            const state = act.articleCount === 0 && !act.fetchedAt && act.unavailable
                ? "UNAVAILABLE"
                : act.articleCount === 0 && !act.fetchedAt
                    ? act.lastError
                        ? "ERROR"
                        : "MISSING"
                    : act.pendingConsolidated || act.pendingAmendments.length
                        ? "UPDATE_AVAILABLE"
                        : act.lastError
                            ? "ERROR"
                            : due
                                ? "CHECK_DUE"
                                : "CURRENT";
            return { ...act, state };
        });
        return {
            autoApply: this.autoApply,
            refreshing: this.refreshing !== null,
            progress: this.progress,
            blockedUntil: this.state.blockedUntil,
            lastCheckAt: this.state.lastCheckAt ?? null,
            counts: {
                consolidated: acts.filter((act) => act.consolidated && act.fetchedAt).length,
                amendments: acts.reduce((sum, act) => sum + act.amendmentsAfter.length, 0),
                other: acts.filter((act) => !act.consolidated && act.fetchedAt).length,
                articles: acts.reduce((sum, act) => sum + act.articleCount, 0)
            },
            pending: {
                consolidated: acts.filter((act) => act.pendingConsolidated).length,
                amendments: acts.reduce((sum, act) => sum + act.pendingAmendments.length, 0)
            },
            recent: [...(this.state.changes ?? [])].reverse().slice(0, 50),
            acts
        };
    }
    logChange(change) {
        this.state.changes = [
            ...(this.state.changes ?? []),
            { at: new Date(this.now()).toISOString(), ...change }
        ].slice(-200);
    }
    saveState() {
        const target = path.join(this.directory, "index.json");
        fs.writeFileSync(`${target}.tmp`, JSON.stringify(this.state, null, 1));
        fs.renameSync(`${target}.tmp`, target);
    }
    async store(eli) {
        let record;
        try {
            record = await this.fetchAct(eli);
        }
        finally {
            this.progress = null;
        }
        fs.writeFileSync(path.join(this.directory, fileNameFor(eli)), JSON.stringify(record));
        this.cache.delete(eli);
        this.searchIndex = null;
        return record;
    }
    async pause() {
        if (this.gapMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.gapMs));
        }
    }
    /**
     * A consolidated text is re-read only when ELI shows a newer t.j. of the
     * same act; a new amendment after the t.j. is downloaded on its own. With
     * apply=false the findings are only recorded as pending.
     */
    async checkConsolidated(ref, state, apply, timeoutMs = REQUEST_TIMEOUT_MS) {
        const current = state.currentEli ?? ref.eli;
        const references = await (await this.get(`${ELI_API}/acts/${current}/references`, "application/json", timeoutMs)).json();
        const known = new Set((state.amendmentsAfter ?? []).map((item) => item.eli));
        const newAmendments = eliLinks(references, (key) => /^Nowelizacje po tekście jednolitym$/i.test(key))
            .filter((amendment) => !known.has(amendment.eli))
            .map((amendment) => ({ eli: amendment.eli, title: amendment.title, promulgation: amendment.promulgation }));
        let newer = null;
        const base = eliLinks(references, (key) => /jednolit\S* dla/i.test(key))[0];
        if (!base) {
            // Tekst aktu, nie t.j.: każdy t.j. jest nowszy, a do czasu jego ogłoszenia
            // nowelizacjami są akty zmieniające (inaczej kopia uchodziłaby za aktualną).
            const consolidatedText = eliLinks(references, (key) => /^Inf\. o tekście jednolitym$/i.test(key))
                .filter((link) => !/uchyl|nieobowi/i.test(link.status))
                .sort((a, b) => a.year - b.year || a.pos - b.pos)
                .at(-1);
            if (consolidatedText) {
                newer = {
                    eli: consolidatedText.eli,
                    title: consolidatedText.title,
                    promulgation: consolidatedText.promulgation
                };
                newAmendments.length = 0;
            }
            else {
                newAmendments.push(...eliLinks(references, (key) => /^Akty zmieniające$/i.test(key))
                    .filter((amendment) => !known.has(amendment.eli))
                    .map((amendment) => ({ eli: amendment.eli, title: amendment.title, promulgation: amendment.promulgation })));
            }
        }
        else {
            await this.pause();
            const baseReferences = await (await this.get(`${ELI_API}/acts/${base.eli}/references`, "application/json", timeoutMs)).json();
            const [currentYear, currentPos] = eliOrder(current);
            const newest = eliLinks(baseReferences, (key) => /^Inf\. o tekście jednolitym$/i.test(key))
                .filter((link) => !/uchyl|nieobowi/i.test(link.status))
                .sort((a, b) => a.year - b.year || a.pos - b.pos)
                .at(-1);
            if (newest &&
                (newest.year > currentYear ||
                    (newest.year === currentYear && newest.pos > currentPos))) {
                newer = { eli: newest.eli, title: newest.title, promulgation: newest.promulgation };
            }
        }
        if (!apply) {
            state.pendingConsolidated = newer;
            state.pendingAmendments = newAmendments;
        }
        else if (newer) {
            // A newer t.j. replaces the text; amendments before it are part of it.
            await this.pause();
            const record = await this.store(newer.eli);
            state.currentEli = newer.eli;
            state.amendmentsAfter = [];
            state.title = record.title;
            state.status = record.status;
            state.textSource = record.textSource;
            state.articleCount = record.articleOrder.length;
            state.fetchedAt = record.fetchedAt;
            state.pendingConsolidated = null;
            state.pendingAmendments = [];
            this.logChange({ kind: "CONSOLIDATED", actEli: ref.eli, eli: newer.eli, title: record.title });
            // Amendments published after the new t.j. are found by the next check.
            state.checkedAt = null;
            state.relationsCheckedAt = new Date(this.now()).toISOString();
            return;
        }
        else {
            // A new amendment is added to RAG as its own document.
            for (const amendment of newAmendments) {
                await this.pause();
                if (!this.record(amendment.eli)) {
                    await this.store(amendment.eli);
                }
                state.amendmentsAfter = [...(state.amendmentsAfter ?? []), amendment];
                this.logChange({ kind: "AMENDMENT", actEli: ref.eli, eli: amendment.eli, title: amendment.title });
            }
            state.pendingConsolidated = null;
            state.pendingAmendments = [];
        }
        state.checkedAt = new Date(this.now()).toISOString();
        state.relationsCheckedAt = state.checkedAt;
    }
    async refreshAll(options = {}) {
        this.reloadMapsIfChanged();
        if (!options.force &&
            this.state.blockedUntil &&
            Date.parse(this.state.blockedUntil) > this.now()) {
            return;
        }
        let consecutiveFailures = 0;
        let anchorUpgrades = 0;
        for (const ref of this.refs) {
            if (options.only?.length && !options.only.includes(ref.eli))
                continue;
            const state = this.state.acts[ref.eli] ??
                { title: null, status: null, textSource: null, articleCount: 0, fetchedAt: null, lastError: null };
            const held = this.record(state.currentEli ?? ref.eli);
            const downloaded = held !== null;
            const upgrade = held !== null &&
                needsAnchorUpgrade(held) &&
                (options.force || !state.retryAt || Date.parse(state.retryAt) <= this.now()) &&
                (Boolean(options.only?.includes(ref.eli)) || anchorUpgrades < ANCHOR_UPGRADES_PER_RUN);
            if (upgrade)
                anchorUpgrades += 1;
            const checkDue = downloaded &&
                ref.consolidated &&
                (options.force ||
                    !state.checkedAt ||
                    this.now() - Date.parse(state.checkedAt) >= CHECK_AFTER_MS);
            if (downloaded && !checkDue && !upgrade)
                continue;
            if (!downloaded && !options.force && state.retryAt && Date.parse(state.retryAt) > this.now())
                continue;
            const apply = options.apply === "all" ||
                (Array.isArray(options.apply) && options.apply.includes(ref.eli)) ||
                (options.apply === undefined && this.autoApply);
            try {
                if (!downloaded) {
                    const record = await this.store(ref.eli);
                    Object.assign(state, {
                        title: record.title,
                        status: record.status,
                        textSource: record.textSource,
                        articleCount: record.articleOrder.length,
                        fetchedAt: record.fetchedAt,
                        currentEli: ref.eli,
                        checkedAt: new Date(this.now()).toISOString()
                    });
                    // Requested runs (a user-added act, "Sprawdź teraz") check ELI
                    // relations right away, so amendments after the text are known.
                    if (options.force && ref.consolidated) {
                        await this.pause();
                        await this.checkConsolidated(ref, state, apply);
                    }
                }
                else {
                    if (upgrade) {
                        // Ten sam tekst ponownie z ELI, teraz z kotwicami jednostek.
                        const record = await this.store(state.currentEli ?? ref.eli);
                        Object.assign(state, {
                            title: record.title,
                            status: record.status,
                            textSource: record.textSource,
                            articleCount: record.articleOrder.length,
                            fetchedAt: record.fetchedAt
                        });
                    }
                    if (checkDue) {
                        if (upgrade)
                            await this.pause();
                        await this.checkConsolidated(ref, state, apply);
                    }
                }
                state.lastError = null;
                state.retryAt = null;
                state.unavailable = null;
                consecutiveFailures = 0;
            }
            catch (error) {
                // Keep the text already held; only record why this attempt failed.
                state.lastError = error instanceof Error ? error.message : String(error);
                if (error instanceof CoreLawPermanentError) {
                    // Brak tekstu w ELI to nie awaria źródła: nie blokuje pozostałych aktów.
                    state.retryAt = new Date(this.now() + PERMANENT_RETRY_MS).toISOString();
                    state.unavailable = error.noText ? error.message : null;
                    if (error.noText)
                        state.lastError = null;
                }
                else {
                    consecutiveFailures += 1;
                }
            }
            this.state.acts[ref.eli] = state;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                this.state.blockedUntil = new Date(this.now() + RETRY_AFTER_BLOCK_MS).toISOString();
                this.saveState();
                return;
            }
            this.saveState();
            await this.pause();
        }
        this.state.blockedUntil = null;
        if (!options.only?.length) {
            this.state.lastCheckAt = new Date(this.now()).toISOString();
        }
        this.saveState();
    }
    async get(url, accept, timeoutMs = REQUEST_TIMEOUT_MS) {
        const response = await this.fetcher(url, {
            headers: {
                Accept: accept,
                "User-Agent": "LexMachina-core-law-index/1.0"
            },
            signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) {
            throw new Error(`ELI_HTTP_${response.status}`);
        }
        return response;
    }
    /**
     * Tekst PDF strona po stronie. Gdy PDF jest skanem (połowa stron albo więcej
     * bez warstwy tekstowej, albo brak jakichkolwiek artykułów), strony-obrazy
     * czyta lokalny OCR partiami po OCR_BATCH_PAGES stron, a tekst składa się
     * z powrotem w kolejności stron.
     */
    async pdfText(eli, bytes) {
        this.progress = { eli, phase: "extract", done: 0, total: 0 };
        const extracted = await this.pdf.extract(bytes);
        const pageTexts = (extracted.pageTexts ?? [extracted.text]).map((page) => stripPdfPageHeaders(repairDzuPdfEncoding(page)).trim());
        const joined = () => pageTexts.filter(Boolean).join("\n");
        const scanned = pageTexts.flatMap((page, index) => page.replace(/\s+/g, "").length < OCR_MIN_PAGE_CHARS ? [index + 1] : []);
        const isScan = scanned.length > 0 &&
            (scanned.length * 2 >= pageTexts.length || splitArticles(joined()).order.length === 0);
        if (!isScan) {
            if (!joined())
                throw new Error("PDF w ELI nie zawiera tekstu.");
            return { text: joined(), pages: extracted.pages, ocrPages: [], pageTexts };
        }
        if (!this.ocr) {
            throw new CoreLawPermanentError("PDF w ELI jest skanem bez warstwy tekstowej, a lokalny OCR jest niedostępny.");
        }
        if (scanned.length > OCR_MAX_PAGES) {
            throw new CoreLawPermanentError(`PDF w ELI jest skanem ${scanned.length} stron; limit OCR kopii to ${OCR_MAX_PAGES} stron.`);
        }
        // Odczytane partie są zapisywane: przerwane OCR (zamknięcie aplikacji) wznawia się
        // od pierwszej nieodczytanej strony tego samego pliku.
        const cacheFile = path.join(this.directory, "ocr-cache", createHash("sha256").update(bytes).digest("hex") + ".json");
        let cached = {};
        try {
            cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        }
        catch {
            cached = {};
        }
        const todo = scanned.filter((page) => typeof cached[page] !== "string");
        this.progress = { eli, phase: "ocr", done: scanned.length - todo.length, total: scanned.length };
        for (let start = 0; start < todo.length; start += OCR_BATCH_PAGES) {
            const batch = todo.slice(start, start + OCR_BATCH_PAGES);
            const before = this.progress.done;
            let results;
            try {
                results = await this.ocr.recognizePages(bytes, batch, (done) => {
                    if (this.progress?.eli === eli)
                        this.progress.done = before + done;
                });
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                throw new Error(`OCR skanu ELI nie powiódł się (strony ${batch[0]}-${batch.at(-1)}): ${detail}`);
            }
            for (const result of results)
                cached[result.page] = result.text;
            this.progress.done = before + batch.length;
            fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
            fs.writeFileSync(cacheFile, JSON.stringify(cached));
        }
        for (const page of scanned) {
            if (typeof cached[page] === "string" && page <= pageTexts.length) {
                pageTexts[page - 1] = stripPdfPageHeaders(cached[page]).trim();
            }
        }
        fs.rmSync(cacheFile, { force: true });
        return { text: joined(), pages: extracted.pages, ocrPages: scanned, pageTexts };
    }
    async fetchAct(eli) {
        const base = `${ELI_API}/acts/${eli}`;
        const meta = (await (await this.get(base, "application/json")).json());
        const text = (value) => (typeof value === "string" ? value : null);
        let body = "";
        let textSource = "none";
        let sourceUrl = base;
        let html = "";
        let pageTexts = [];
        if (meta.textHTML === true) {
            sourceUrl = `${base}/text.html`;
            html = await (await this.get(sourceUrl, "text/html")).text();
            body = htmlToText(html);
            textSource = "html";
        }
        // text.html obwieszczenia t.j. bywa pusty (0 B): obowiązujące brzmienie jest tylko w PDF.
        let ocrPages = [];
        let pages;
        if (splitArticles(body).order.length === 0 && meta.textPDF === true) {
            sourceUrl = `${base}/text.pdf`;
            this.progress = { eli, phase: "download", done: 0, total: 0 };
            const bytes = new Uint8Array(await (await this.get(sourceUrl, "application/pdf", PDF_TIMEOUT_MS)).arrayBuffer());
            const pdf = await this.pdfText(eli, bytes);
            body = pdf.text;
            pageTexts = pdf.pageTexts;
            ocrPages = pdf.ocrPages;
            pages = pdf.pages;
            textSource = ocrPages.length ? "ocr" : "pdf";
        }
        const { order, articles } = splitArticles(body);
        const extractionCheck = textSource === "pdf" ? checkArticleExtraction(body, order) : null;
        const articleAnchors = textSource === "html"
            ? htmlArticleAnchors(html, order)
            : textSource === "pdf"
                ? pdfArticleAnchors(pageTexts)
                : {};
        if (textSource === "ocr" && order.length === 0) {
            // Np. DU/1965/232: w ELI jest tylko strona numeru z adnotacją, że tekst
            // umowy zamieszczono w załączniku do numeru (załącznika ELI nie publikuje).
            // OCR myli litery ("ńumeru"), więc dopasowanie po tekście bez znaków diakrytycznych.
            const annex = /zalacznik\p{L}*\s+do\s+niniejsz/u.test(normalizeForSearch(body));
            throw new CoreLawPermanentError(annex
                ? `ELI udostępnia tylko skan ${pages} str. numeru Dz.U. z adnotacją, że tekst aktu zamieszczono w załączniku do numeru; załącznika nie ma w ELI.`
                : `ELI udostępnia dla tego aktu tylko skan (${pages} str.) bez tekstu artykułów.`, true);
        }
        return {
            eli,
            title: text(meta.title) ?? eli,
            type: text(meta.type),
            status: text(meta.status),
            promulgation: text(meta.promulgation),
            textSource,
            extraction: 3,
            ...(ocrPages.length ? { ocrPages } : {}),
            ...(pages ? { pages } : {}),
            fetchedAt: new Date(this.now()).toISOString(),
            sourceUrl,
            articleOrder: order,
            articles,
            ...(Object.keys(articleAnchors).length ? { articleAnchors } : {}),
            ...(extractionCheck && (extractionCheck.suspectArticles.length || extractionCheck.gaps.length)
                ? { extractionCheck }
                : {}),
            text: body
        };
    }
}
