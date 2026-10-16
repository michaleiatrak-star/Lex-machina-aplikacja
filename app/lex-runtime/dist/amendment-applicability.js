function text(value) {
    return typeof value === "string"
        ? value.trim()
        : "";
}
function dateOnly(value) {
    const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/u);
    return match?.[1] ?? "";
}
function normalizeEli(value) {
    const match = value.match(/(DU|MP)\/(\d{4})\/(\d+)/u);
    return match?.[0] ?? "";
}
function apiUrl(eli) {
    const normalized = normalizeEli(eli);
    const match = normalized.match(/^(DU|MP)\/(\d{4})\/(\d+)$/u);
    if (!match)
        return null;
    return ("https://api.sejm.gov.pl/eli/acts/" +
        match[1] +
        "/" +
        match[2] +
        "/" +
        match[3]);
}
function unwrapAct(value) {
    if (!value ||
        typeof value !== "object") {
        return null;
    }
    const wrapper = value;
    if (wrapper.act &&
        typeof wrapper.act === "object") {
        return wrapper.act;
    }
    return wrapper;
}
function earliest(values) {
    return values
        .filter(Boolean)
        .sort()[0];
}
const MONTHS = {
    stycznia: "01", lutego: "02", marca: "03", kwietnia: "04", maja: "05", czerwca: "06",
    lipca: "07", sierpnia: "08", września: "09", października: "10", listopada: "11", grudnia: "12"
};
/**
 * The staged entry into force ELI writes in an act's comments: one item per date, the units
 * it names ("1) art. 1 pkt 2 lit. a, pkt 46 i 53 … wchodzą w życie z dniem 21 kwietnia 2026 r.;").
 */
export function entryStages(comments) {
    const value = text(comments);
    if (!value)
        return [];
    const stages = [];
    const item = /(?:^|\n|;)\s*(?:\d{1,2}\)\s*)?([^;\n]*?)\s+wchodz\p{L}*\s+w\s+życie\s+z\s+dniem\s+(\d{1,2})\s+(\p{L}+)\s+(\d{4})/gu;
    for (const match of value.matchAll(item)) {
        const month = MONTHS[match[3].toLocaleLowerCase("pl")];
        if (!month || !/\bart\./u.test(match[1]))
            continue;
        stages.push({ date: `${match[4]}-${month}-${match[2].padStart(2, "0")}`, units: match[1].trim() });
    }
    return stages;
}
/**
 * The dates the part of an amending act in its article `article` enters into force: the dates
 * of the stages naming that article (whole or in part) and, unless a stage names it whole, the
 * act's general date. `null` when the act has no stages or the general date is unknown.
 */
export function partEntryDates(stages, entryIntoForce, article) {
    if (!stages.length || !entryIntoForce)
        return null;
    const wanted = Number.parseInt(article, 10);
    const suffix = article.replace(/^\d+/u, "");
    const dates = new Set();
    let whole = false;
    for (const stage of stages) {
        // "art. 8", "art. 4-6", "art. 1 pkt 2 lit. a": the article numbers after each "art.".
        for (const match of stage.units.matchAll(/(?<!w zakresie\s)\bart\.\s*(\d+)([a-z]*)(?:\s*[-–]\s*(\d+)([a-z]*))?(\s+(?:pkt|ust\.|lit\.|§|w zakresie))?/gu)) {
            const from = Number(match[1]);
            const to = match[3] ? Number(match[3]) : from;
            const hit = match[3] ? wanted >= from && wanted <= to && !suffix : from === wanted && match[2] === suffix;
            if (!hit)
                continue;
            dates.add(stage.date);
            if (!match[5])
                whole = true;
        }
    }
    if (!whole)
        dates.add(entryIntoForce);
    return [...dates].sort();
}
export class AmendmentApplicabilityResolver {
    fetcher;
    constructor(fetcher = globalThis.fetch.bind(globalThis)) {
        this.fetcher = fetcher;
    }
    async classify(amendments, targetDate) {
        return Promise.all(amendments.map((amendment) => this.classifyOne(amendment, targetDate)));
    }
    async classifyOne(amendment, targetDate) {
        const relationDate = dateOnly(amendment.relationDate);
        const url = apiUrl(amendment.eli);
        if (!url) {
            return {
                eli: amendment.eli,
                targetDate,
                status: "UNKNOWN",
                ...(relationDate
                    ? { relationDate }
                    : {}),
                reason: "INVALID_AMENDMENT_ELI"
            };
        }
        let metadata;
        try {
            const response = await this.fetcher(url, {
                method: "GET",
                redirect: "error",
                // Zawieszone ELI nie blokuje tury na czas domyślnego limitu undici.
                signal: AbortSignal.timeout(15_000),
                headers: {
                    Accept: "application/json"
                }
            });
            if (!response.ok) {
                return {
                    eli: amendment.eli,
                    targetDate,
                    status: "UNKNOWN",
                    ...(relationDate
                        ? { relationDate }
                        : {}),
                    reason: "AMENDMENT_METADATA_HTTP_" +
                        response.status
                };
            }
            metadata =
                await response.json();
        }
        catch {
            return {
                eli: amendment.eli,
                targetDate,
                status: "UNKNOWN",
                ...(relationDate
                    ? { relationDate }
                    : {}),
                reason: "AMENDMENT_METADATA_FETCH_FAILED"
            };
        }
        const act = unwrapAct(metadata);
        if (!act) {
            return {
                eli: amendment.eli,
                targetDate,
                status: "UNKNOWN",
                ...(relationDate
                    ? { relationDate }
                    : {}),
                reason: "AMENDMENT_METADATA_INVALID"
            };
        }
        const validFrom = dateOnly(act.validFrom);
        const entryIntoForce = dateOnly(act.entryIntoForce);
        const promulgation = dateOnly(act.promulgation) ||
            dateOnly(act.announcementDate);
        // Use the earliest official effectiveness
        // signal. Relation dates are intentionally
        // included as a conservative lower bound:
        // if ELI says the relation started earlier
        // than the general metadata date, the
        // runtime must not silently classify it as
        // future.
        const effectiveFrom = earliest([
            validFrom,
            entryIntoForce,
            relationDate
        ]);
        if (!effectiveFrom) {
            return {
                eli: amendment.eli,
                targetDate,
                status: "UNKNOWN",
                ...(relationDate
                    ? { relationDate }
                    : {}),
                ...(promulgation
                    ? { promulgation }
                    : {}),
                reason: "AMENDMENT_EFFECT_DATE_UNKNOWN"
            };
        }
        const stages = entryStages(act.comments);
        const common = {
            eli: amendment.eli,
            targetDate,
            ...(stages.length ? { stages } : {}),
            ...(relationDate
                ? { relationDate }
                : {}),
            ...(promulgation
                ? { promulgation }
                : {}),
            ...(entryIntoForce
                ? { entryIntoForce }
                : {}),
            ...(validFrom
                ? { validFrom }
                : {}),
            effectiveFrom
        };
        return effectiveFrom >
            targetDate
            ? {
                ...common,
                status: "FUTURE"
            }
            : {
                ...common,
                status: "EFFECTIVE"
            };
    }
}
