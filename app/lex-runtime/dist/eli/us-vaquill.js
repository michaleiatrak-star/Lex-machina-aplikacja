import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
/**
 * Open US Law (Vaquill, github.com/Vaquill-AI/open-us-law): state codes taken from the states' own
 * sites (each section keeps its source_url) and published as dated Parquet snapshots. Used where the
 * state's site serves its code only inside its web application (Alabama, Indiana, South Dakota). The
 * state file (11–23 MB) is read once per session and kept in memory. A snapshot is not the law as of
 * today: the answer names its date and the official page to check against.
 */
export const VAQUILL_HOST = /^oss-data-us\.vaquill\.ai$/u;
const files = new Map();
const key = (value) => value.replace(/^(?:[A-Za-z.]+\s+)*(?:Code\s+)?(?:Ann\.\s*)?§*\s*/u, "").replace(/^IC\s+/iu, "").trim().toLowerCase();
async function sections(fetchImpl, url) {
    const known = files.get(url);
    if (known)
        return known;
    const reply = await fetchImpl(url, { headers: { "user-agent": "LexMachina/0.1 (legal research)" }, signal: AbortSignal.timeout(180_000) });
    if (!reply.ok)
        throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
    const file = await reply.arrayBuffer();
    const rows = (await parquetReadObjects({ file, columns: ["section_number", "section_title", "text", "source_url", "act_status"], compressors }));
    const map = new Map();
    for (const row of rows) {
        if (!row.section_number)
            continue;
        map.set(key(row.section_number), { title: row.section_title ?? "", text: row.text ?? "", source: row.source_url ?? "", status: row.act_status ?? "" });
    }
    files.set(url, map);
    return map;
}
export async function readVaquillSection(fetchImpl, url, unit) {
    const map = await sections(fetchImpl, url);
    const wanted = key(unit);
    const found = map.get(wanted);
    if (!found)
        return { articles: [] };
    const heading = found.title.toLowerCase().includes(wanted) ? found.title : `§ ${wanted}${found.title ? ` ${found.title}` : ""}`;
    return {
        source: found.source,
        status: found.status,
        articles: [{ unit: wanted, heading, text: `${heading}\n${found.text}`.slice(0, 20_000), amendments: [] }]
    };
}
