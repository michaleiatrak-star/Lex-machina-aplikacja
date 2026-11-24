const ELI_API = "https://api.sejm.gov.pl/eli";
const PAGE = 500;
const MAX_PAGES = 20;
// Relations that mean the tracked act's text or its consolidated text is no longer the latest.
const AFFECTING = ["Akty zmienione", "Tekst jednolity dla aktu", "Akty uchylone", "Akty uznane za uchylone", "Sprostowanie", "Orzeczenie TK"];
/** "2026-11-20T09:25:48" form (the API refuses an ISO string with milliseconds or a zone). */
export function eliSince(date) {
    return new Date(date).toISOString().slice(0, 19);
}
export async function fetchEliChanges(since, fetcher, timeoutMs = 30_000) {
    const items = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = `${ELI_API}/changes/acts?since=${encodeURIComponent(since)}&limit=${PAGE}&offset=${page * PAGE}`;
        const reply = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
        if (!reply.ok)
            throw new Error(`ELI_CHANGES_HTTP_${reply.status}`);
        const body = (await reply.json());
        if (!Array.isArray(body.items))
            throw new Error("ELI_CHANGES_FORMAT");
        const batch = body.items;
        items.push(...batch);
        if (batch.length < PAGE || items.length >= (body.totalCount ?? 0))
            break;
    }
    return items;
}
/** Tracked acts (map ELI with its current consolidated ELI) touched by the changed records. */
export function affectedTrackedActs(changed, tracked) {
    const owner = new Map();
    for (const act of tracked) {
        owner.set(act.eli, act.eli);
        if (act.currentEli)
            owner.set(act.currentEli, act.eli);
    }
    const hit = new Set();
    for (const item of changed) {
        const own = owner.get(item.ELI);
        if (own)
            hit.add(own);
        for (const key of AFFECTING) {
            for (const ref of item.references?.[key] ?? []) {
                const target = ref.id ? owner.get(ref.id) : undefined;
                if (target)
                    hit.add(target);
            }
        }
    }
    return [...hit];
}
/** The next "since": the latest change seen, never later than the moment the check started. */
export function nextEliSince(changed, startedAt) {
    const latest = changed.map((item) => item.changeDate ?? "").filter(Boolean).sort().at(-1);
    return latest && latest < startedAt ? latest : startedAt;
}
