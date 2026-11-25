const SEJM = "https://api.sejm.gov.pl/sejm";
const LIST_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_NAME = 8;
function normalized(value) {
    return value
        .toLocaleLowerCase("pl")
        .replace(/[„”"«»]/gu, "")
        .replace(/\s*[-–—]\s*/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
}
/** The act's own name: "Ustawa z dnia 26 czerwca 1974 r. – Kodeks pracy" -> "kodeks pracy". */
export function actName(title) {
    const text = normalized(title)
        .replace(/^obwieszczenie .*? w sprawie ogłoszenia jednolitego tekstu\s+/u, "")
        .replace(/^ustaw[ay]\s+z\s+dnia\s+\d{1,2}\s+\p{L}+\s+\d{4}\s*r\.\s*/u, "")
        .replace(/^ustaw[ay]\s+/u, "");
    return text;
}
/** The act's name as written in its title, for the note ("Kodeks pracy"). */
export function actDisplayName(title) {
    return title
        .replace(/[„”"]/gu, "")
        .replace(/^Obwieszczenie .*? w sprawie ogłoszenia jednolitego tekstu\s+/iu, "")
        .replace(/^ustaw[ay]\s+z\s+dnia\s+\d{1,2}\s+\p{L}+\s+\d{4}\s*r\.\s*(?:[-–—]\s*)?/iu, "")
        .replace(/^ustaw[ay]\s+(?:[-–—]\s*)?/iu, "")
        .trim();
}
/** A bill still before Parliament (not passed, not closed) that amends acts. */
export function pendingBill(process) {
    if (process.passed === true || process.closureDate)
        return false;
    const kind = `${process.documentTypeEnum ?? ""} ${process.documentType ?? ""}`;
    if (!/BILL|projekt ustawy/iu.test(kind))
        return false;
    return /o zmianie ustaw/iu.test(process.title ?? "");
}
/**
 * The pending bills naming the act after "ustawy". A longer known name at the same place wins
 * ("Kodeks karny wykonawczy" is not "Kodeks karny").
 */
export function billsAmending(name, processes, knownNames = []) {
    const own = normalized(name);
    if (own.length < MIN_NAME)
        return [];
    const longer = knownNames.map(normalized).filter((other) => other !== own && other.startsWith(own));
    return processes.filter((process) => {
        if (!pendingBill(process))
            return false;
        const title = normalized(process.title ?? "");
        for (let at = title.indexOf(`ustawy ${own}`); at >= 0; at = title.indexOf(`ustawy ${own}`, at + 1)) {
            const rest = title.slice(at + 7);
            const end = rest.charAt(own.length);
            if (end && /\p{L}/u.test(end))
                continue;
            if (longer.some((other) => rest.startsWith(other)))
                continue;
            return true;
        }
        return false;
    });
}
/**
 * The latest main stage ("I czytanie na posiedzeniu Sejmu"), dated by its latest step: a step such
 * as "Głosowanie" or "Skierowanie" alone does not say where the bill is (druk 384, 2024-06-28).
 */
export function latestStage(stages) {
    const dated = stages
        .filter((stage) => stage.stageName)
        .map((stage) => ({ name: stage.stageName, date: [stage.date ?? "", ...(stage.children ?? []).map((child) => child.date ?? "")].sort().at(-1) || null }));
    const last = dated.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")).at(-1);
    return last ?? null;
}
const STALLED_MS = 365 * 24 * 60 * 60 * 1000;
/** No step of the bill for over a year. */
export function stalledAmendment(item, now = Date.now()) {
    // Live run 2026-11-24 (real10): the stage of druk 728 not read, the bill shown although stalled.
    const date = item.stageDate ?? item.changeDate?.slice(0, 10) ?? null;
    return Boolean(date) && now - Date.parse(date) > STALLED_MS;
}
/** The same legislative note once in an answer joined from several steps (AUTO): the first stays. */
export function withoutRepeatedLegislativeNotes(text) {
    const seen = new Set();
    return text
        .replace(/\n\n> Prace legislacyjne: [^\n]*/gu, (note) => {
        if (seen.has(note))
            return "";
        seen.add(note);
        return note;
    });
}
export function pendingAmendmentLine(item, now = Date.now()) {
    const stalled = item.stageDate && now - Date.parse(item.stageDate) > STALLED_MS ? `, bez dalszych prac od ${item.stageDate}` : "";
    const stage = item.stage ? `, etap: ${item.stage}${item.stageDate && !stalled ? ` (${item.stageDate})` : ""}${stalled}` : "";
    return `Prace legislacyjne: w Sejmie jest projekt zmiany aktu ${item.name} — druk nr ${item.number} (${item.term}. kadencja)${stage}. Do uchwalenia i wejścia zmian w życie obowiązuje brzmienie powołane wyżej.`;
}
/** Current term's processes, kept for 12 hours; a failure keeps the previous list (or none). */
export class SejmPendingActs {
    fetcher;
    now;
    list = null;
    loading = null;
    stages = new Map();
    constructor(fetcher = globalThis.fetch.bind(globalThis), now = Date.now) {
        this.fetcher = fetcher;
        this.now = now;
    }
    async load() {
        const terms = (await (await this.fetcher(`${SEJM}/term`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) })).json());
        const term = terms.find((item) => item.current)?.num ?? terms.at(-1)?.num;
        if (!term)
            return;
        const reply = await this.fetcher(`${SEJM}/term${term}/processes?limit=5000`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
        if (!reply.ok)
            return;
        this.list = { at: this.now(), term, processes: (await reply.json()).filter(pendingBill) };
    }
    /** Starts loading when stale; waits at most waitMs for it. */
    async ready(waitMs = 4_000) {
        if (!this.list || this.now() - this.list.at > LIST_TTL_MS) {
            this.loading ??= this.load()
                .catch(() => undefined)
                .finally(() => {
                this.loading = null;
            });
            let timer;
            await Promise.race([this.loading, new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))]);
            clearTimeout(timer);
        }
        return this.list !== null;
    }
    async stageOf(term, number) {
        const key = `${term}/${number}`;
        if (this.stages.has(key))
            return this.stages.get(key);
        let stage = null;
        try {
            const reply = await this.fetcher(`${SEJM}/term${term}/processes/${encodeURIComponent(number)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000) });
            if (reply.ok)
                stage = latestStage((await reply.json()).stages ?? []);
        }
        catch {
            stage = null;
        }
        this.stages.set(key, stage);
        return stage;
    }
    /** Pending bills for the cited acts (names as the answer's acts are titled), at most two per act. */
    async forActs(names) {
        if (!(await this.ready()))
            return [];
        const { term, processes } = this.list;
        const known = names.map(actName);
        const display = new Map(names.map((title) => [actName(title), actDisplayName(title)]));
        const found = [];
        for (const name of [...new Set(known)]) {
            for (const bill of billsAmending(name, processes, known).slice(0, 2)) {
                const stage = await this.stageOf(bill.term ?? term, bill.number);
                found.push({ act: name, name: display.get(name) || name, number: bill.number, term: bill.term ?? term, stage: stage?.name ?? null, stageDate: stage?.date ?? null, changeDate: bill.changeDate ?? null });
            }
        }
        return found;
    }
}
let shared = null;
export function configureSejmPendingActs(instance) {
    shared = instance;
}
export function sejmPendingActs() {
    return shared;
}
/**
 * Each note goes under the first paragraph citing its act (not inside a table or a heading);
 * a note without such a paragraph goes at the end.
 */
export function placeLegislativeNotes(text, notes) {
    const lines = text.split("\n");
    const tail = [];
    const after = new Map();
    for (const note of notes) {
        const index = lines.findIndex((line) => !/^\s*(?:\||#)/u.test(line) && note.anchors.some((anchor) => anchor && line.includes(anchor)));
        if (index < 0) {
            tail.push(note.line);
            continue;
        }
        // The paragraph's last line (a list item ends at its own line).
        let end = index;
        while (end + 1 < lines.length && lines[end + 1].trim() && !/^\s*(?:[-*]|\d+\.|\||#)/u.test(lines[end + 1]))
            end += 1;
        after.set(end, [...(after.get(end) ?? []), note.line]);
    }
    const out = [];
    lines.forEach((line, index) => {
        out.push(line);
        for (const note of after.get(index) ?? [])
            out.push("", `> ${note}`);
    });
    return [out.join("\n"), ...tail.map((line) => `> ${line}`)].join("\n\n");
}
