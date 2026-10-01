import { CoreLawSearchIndex } from "./core-law-search.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalPdfTextExtractor } from "./pdf-text-extractor.js";
const ELI_API = "https://api.sejm.gov.pl/eli";
// Texts are downloaded once. Consolidated texts are re-checked (ELI relations
// only, no text) at most once a day for new amendments or a newer t.j.
const CHECK_AFTER_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_BLOCK_MS = 60 * 60 * 1000;
const REQUEST_GAP_MS = 750;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const NOTE_CHARS = 400;
const REF_PATTERN = /Dz\.\s?U\.\s?(?:z\s)?(\d{4})\s?(?:r\.\s)?(?:nr\s\d+\s)?poz\.\s?(\d+)((?:\s*,\s*(?:\d{4}\s?poz\.\s?)?\d+(?!\d|\.\d))*)(\s*t\.\s?j\.)?/g;
function cleanNote(line) {
    return line
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, NOTE_CHARS);
}
function labelFor(line) {
    const bold = /\*\*(?:Baza\s+)?([^*:]{1,40}):\*\*/.exec(line);
    if (bold?.[1])
        return bold[1].trim();
    if (line.trim().startsWith("|")) {
        const cell = line.split("|")[1]?.replace(/\*\*/g, "").trim();
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
/** All Dz.U. acts named in the domain act maps and the routing map. */
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
            for (const match of line.matchAll(REF_PATTERN)) {
                const year = match[1];
                const tail = match[3] ?? "";
                const consolidated = Boolean(match[4]) && tail.trim() === "";
                add(`DU/${year}/${Number(match[2])}`, consolidated, domain, label, note);
                let currentYear = year;
                for (const item of tail.split(",").map((part) => part.trim()).filter(Boolean)) {
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
        .filter((line) => !/^\s*Dziennik Ustaw\s*[–-]\s*\d+\s*[–-]\s*Poz\.\s*\d+\s*$/iu.test(line))
        .join("\n")
        // Przeniesienie wyrazu na granicy wiersza ("zna-\nleziony").
        .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2");
}
/** Article number -> article text. The first occurrence of a number wins. */
export function splitArticles(text) {
    const pattern = /(?:^|\n)\s*Art\.\s*(\d+[a-z]{0,4})\.(?=\s)/g;
    const marks = [...text.matchAll(pattern)].map((match) => ({
        id: match[1],
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
        labels: [entry.title],
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
function fileNameFor(eli) {
    return eli.replace(/\//g, "_") + ".json";
}
export class CoreLawIndex {
    directory;
    fetcher;
    pdf;
    now;
    gapMs;
    refs = [];
    state = { acts: {}, blockedUntil: null };
    cache = new Map();
    searchIndex = null;
    refreshing = null;
    constructor(directory = defaultCoreLawDir(), fetcher = globalThis.fetch.bind(globalThis), 
    // Wiersze z PDF: splitArticles szuka "Art. N." na początku wiersza; bez nich tekst
    // jednolity dostępny tylko w PDF (np. kodeksy) dawał zero artykułów.
    pdf = new LocalPdfTextExtractor(undefined, { lines: true }), now = () => Date.now(), gapMs = REQUEST_GAP_MS) {
        this.directory = directory;
        this.fetcher = fetcher;
        this.pdf = pdf;
        this.now = now;
        this.gapMs = gapMs;
    }
    load(corpusRoot) {
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
        const entry = {
            eli: act.currentEli,
            title: act.title,
            origin: "USER",
            baseEli: act.baseEli,
            addedAt: new Date(this.now()).toISOString(),
            addedBy
        };
        this.state.adopted = [...(this.state.adopted ?? []), entry];
        this.refs.push(adoptedRef(entry));
        this.logChange({ kind: "ADDED", actEli: entry.eli, eli: entry.eli, title: act.title });
        this.saveState();
        void this.refresh({ force: true, only: [entry.eli] }).catch(() => undefined);
        return { added: true, eli: entry.eli };
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
            const state = act.articleCount === 0 && !act.fetchedAt
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
        const record = await this.fetchAct(eli);
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
    async checkConsolidated(ref, state, apply) {
        const current = state.currentEli ?? ref.eli;
        const references = await (await this.get(`${ELI_API}/acts/${current}/references`, "application/json")).json();
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
            const baseReferences = await (await this.get(`${ELI_API}/acts/${base.eli}/references`, "application/json")).json();
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
        if (!options.force &&
            this.state.blockedUntil &&
            Date.parse(this.state.blockedUntil) > this.now()) {
            return;
        }
        let consecutiveFailures = 0;
        for (const ref of this.refs) {
            if (options.only?.length && !options.only.includes(ref.eli))
                continue;
            const state = this.state.acts[ref.eli] ??
                { title: null, status: null, textSource: null, articleCount: 0, fetchedAt: null, lastError: null };
            const downloaded = this.record(state.currentEli ?? ref.eli) !== null;
            const checkDue = downloaded &&
                ref.consolidated &&
                (options.force ||
                    !state.checkedAt ||
                    this.now() - Date.parse(state.checkedAt) >= CHECK_AFTER_MS);
            if (downloaded && !checkDue)
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
                    await this.checkConsolidated(ref, state, apply);
                }
                state.lastError = null;
                consecutiveFailures = 0;
            }
            catch (error) {
                // Keep the text already held; only record why this attempt failed.
                state.lastError = error instanceof Error ? error.message : String(error);
                consecutiveFailures += 1;
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
    async get(url, accept) {
        const response = await this.fetcher(url, {
            headers: {
                Accept: accept,
                "User-Agent": "LexMachina-core-law-index/1.0"
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) {
            throw new Error(`ELI_HTTP_${response.status}`);
        }
        return response;
    }
    async fetchAct(eli) {
        const base = `${ELI_API}/acts/${eli}`;
        const meta = (await (await this.get(base, "application/json")).json());
        const text = (value) => (typeof value === "string" ? value : null);
        let body = "";
        let textSource = "none";
        let sourceUrl = base;
        if (meta.textHTML === true) {
            sourceUrl = `${base}/text.html`;
            body = htmlToText(await (await this.get(sourceUrl, "text/html")).text());
            textSource = "html";
        }
        // text.html obwieszczenia t.j. bywa pusty (0 B): obowiązujące brzmienie jest tylko w PDF.
        if (splitArticles(body).order.length === 0 && meta.textPDF === true) {
            sourceUrl = `${base}/text.pdf`;
            const bytes = new Uint8Array(await (await this.get(sourceUrl, "application/pdf")).arrayBuffer());
            body = stripPdfPageHeaders((await this.pdf.extract(bytes)).text);
            textSource = "pdf";
        }
        const { order, articles } = splitArticles(body);
        return {
            eli,
            title: text(meta.title) ?? eli,
            type: text(meta.type),
            status: text(meta.status),
            promulgation: text(meta.promulgation),
            textSource,
            extraction: 2,
            fetchedAt: new Date(this.now()).toISOString(),
            sourceUrl,
            articleOrder: order,
            articles,
            text: body
        };
    }
}
