import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const MAX_TEXT = 2_000_000;
export function courtOfCard(cardUrl) {
    let host = "";
    try {
        host = new URL(cardUrl).hostname.toLowerCase();
    }
    catch {
        return "?";
    }
    if (/(^|\.)sn\.pl$/.test(host))
        return "SN";
    if (host === "orzeczenia.nsa.gov.pl")
        return "NSA/WSA";
    if (/(^|\.)saos\.org\.pl$/.test(host))
        return "SAOS";
    if (host === "orzeczenia.uzp.gov.pl")
        return "KIO";
    if (host === "eureka.mf.gov.pl")
        return "EUREKA";
    if (/(^|\.)uodo\.gov\.pl$/.test(host))
        return "UODO";
    if (/(^|\.)curia\.europa\.eu$/.test(host))
        return "TSUE";
    return host;
}
// One key per decision: sn.pl and www.sn.pl cards of the same ID are one card.
function cardKey(cardUrl) {
    try {
        const url = new URL(cardUrl);
        const id = url.searchParams.get("orzeczenie");
        if (/(^|\.)sn\.pl$/i.test(url.hostname) && id)
            return `sn:${id}`;
    }
    catch {
        // not a URL: the text itself is the key
    }
    return cardUrl;
}
export class CaseLawStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    file(cardUrl) {
        return path.join(this.dir, `${createHash("sha256").update(cardKey(cardUrl)).digest("hex").slice(0, 40)}.json`);
    }
    get(cardUrl) {
        try {
            const entry = JSON.parse(fs.readFileSync(this.file(cardUrl), "utf8"));
            return cardKey(entry.cardUrl) === cardKey(cardUrl) && typeof entry.text === "string" ? entry : null;
        }
        catch {
            return null;
        }
    }
    /** Saves a copy once; a later save keeps the first copy and fills in missing metadata. */
    put(input) {
        const text = input.text.trim();
        if (text.length < 40 || text.length > MAX_TEXT)
            return null;
        const existing = this.get(input.cardUrl);
        const entry = existing
            ? {
                ...existing,
                ...(existing.signature || !input.signature ? {} : { signature: input.signature }),
                ...(existing.date || !input.date ? {} : { date: input.date }),
                ...(existing.form || !input.form ? {} : { form: input.form })
            }
            : {
                cardUrl: input.cardUrl,
                court: input.court ?? courtOfCard(input.cardUrl),
                ...(input.signature ? { signature: input.signature } : {}),
                ...(input.date ? { date: input.date } : {}),
                ...(input.form ? { form: input.form } : {}),
                text,
                sha256: createHash("sha256").update(text).digest("hex"),
                fetchedAt: input.fetchedAt ?? new Date().toISOString()
            };
        if (existing && JSON.stringify(existing) === JSON.stringify(entry))
            return existing;
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            const target = this.file(input.cardUrl);
            const temporary = `${target}.${process.pid}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify(entry), "utf8");
            fs.renameSync(temporary, target);
            return entry;
        }
        catch {
            return null;
        }
    }
}
let configured = null;
/** The application's store (set by the HTTP server); null in tests and tools without a data directory. */
export function configureCaseLawStore(dir) {
    configured = dir ? new CaseLawStore(dir) : null;
}
export function caseLawStore() {
    return configured;
}
