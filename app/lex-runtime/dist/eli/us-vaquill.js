import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
/**
 * Open US Law (Vaquill, github.com/Vaquill-AI/open-us-law): state codes taken from the states' own
 * sites (each section keeps its source_url) and published as dated Parquet snapshots. An equivalent
 * tool next to each state's own reader, and the only one where the state's site serves its code only
 * inside its web application (Alabama, Indiana, South Dakota). The state file (up to some tens of MB)
 * is read once per session and kept in memory. A snapshot is not the law as of today: the answer names
 * its date and the official page to check against.
 */
export const VAQUILL_HOST = /^oss-data-us\.vaquill\.ai$/u;
export const VAQUILL_SNAPSHOT = "v2026.09.1";
export const VAQUILL_SNAPSHOT_DATE = "30.09.2026";
// us_{state}_statutes.parquet in the snapshot's manifest (oss-data-us.vaquill.ai/index.json, 2026-11-09).
export const VAQUILL_STATUTES = ["ak", "al", "az", "ca", "ct", "dc", "de", "fl", "hi", "ia", "id", "il", "in", "ks", "ky", "la", "ma", "md", "me", "mi", "mn", "mo", "mt", "nc", "nd", "ne", "nh", "nj", "nm", "nv", "ny", "oh", "ok", "or", "pa", "pr", "ri", "sc", "sd", "tx", "ut", "va", "vt", "wa", "wi", "wv", "wy"];
export const vaquillUrl = (state) => `https://oss-data-us.vaquill.ai/${VAQUILL_SNAPSHOT}/us_${state.toLowerCase()}_statutes.parquet`;
const files = new Map();
// "N.Y. Penal Law § 125.27" / "n.y. penal law §125.27" → one form.
const norm = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}§.:-]+/gu, " ").replace(/\s*§\s*/gu, " § ").replace(/\s+/gu, " ").trim();
// The number after "§" or "art." ("21-L:18", "125.27", "2474").
const tail = (value) => (/(?:§|\bart\.?)\s*([\p{L}\p{N}.:-]+)\s*$/iu.exec(value.trim())?.[1] ?? value.trim()).toLowerCase().replace(/\.$/u, "");
function push(map, key, section) {
    if (!key)
        return;
    const list = map.get(key);
    if (list)
        list.push(section);
    else
        map.set(key, [section]);
}
async function index(fetchImpl, url) {
    const known = files.get(url);
    if (known)
        return known;
    const reply = await fetchImpl(url, { headers: { "user-agent": "LexMachina/0.1 (legal research)" }, signal: AbortSignal.timeout(300_000) });
    if (!reply.ok)
        throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
    const file = await reply.arrayBuffer();
    const rows = (await parquetReadObjects({ file, columns: ["citation", "section_number", "section_title", "text", "source_url", "act_status"], compressors }));
    const built = { byCitation: new Map(), byNumber: new Map() };
    for (const row of rows) {
        const section = { citation: row.citation ?? "", title: row.section_title ?? "", text: row.text ?? "", source: row.source_url ?? "", status: row.act_status ?? "" };
        push(built.byCitation, norm(section.citation), section);
        push(built.byNumber, section.citation ? tail(section.citation) : (row.section_number ?? "").toLowerCase(), section);
    }
    files.set(url, built);
    return built;
}
// Several rows for one citation (versions, repealed copies): the one in force.
const inForce = (list) => list.find((item) => item.status === "in_force") ?? list[0];
export async function readVaquillSection(fetchImpl, url, unit) {
    const built = await index(fetchImpl, url);
    let list = built.byCitation.get(norm(unit));
    if (!list) {
        const byNumber = built.byNumber.get(tail(unit)) ?? [];
        const citations = [...new Set(byNumber.map((item) => item.citation))];
        if (citations.length > 1)
            return { articles: [], candidates: citations.slice(0, 12) };
        list = byNumber.length ? byNumber : undefined;
    }
    if (!list)
        return { articles: [] };
    const found = inForce(list);
    const heading = [found.citation, found.title && !found.title.includes(tail(found.citation)) ? found.title : found.title.replace(/^Section\s+\S+\s*/u, "")].filter(Boolean).join(" — ");
    return {
        source: found.source,
        status: found.status,
        articles: [{ unit: found.citation || unit, heading, text: `${heading}\n${found.text}`.slice(0, 20_000), amendments: [] }]
    };
}
