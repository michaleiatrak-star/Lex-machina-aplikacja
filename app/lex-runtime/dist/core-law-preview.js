/**
 * In-app preview of a provision from the local copy of the official ELI text:
 * the whole article with the cited unit (§ / ust.) marked and anchored, so
 * the preview opens on the passage the answer relies on.
 */
export const PROVISION_ANCHOR = "lex-provision";
const ELI_IN_URL = /\/eli\/acts\/(DU|MP)\/(\d{4})\/(\d{1,6})(?:\/|$)/;
const ARTICLE = /\bart\.?\s*(\d+[a-z]{0,4})\b/i;
const PARAGRAPH = /§\s*(\d+[a-z]{0,3})/;
const SECTION = /\bust\.?\s*(\d+[a-z]{0,3})\b/i;
// Act named after the article: "art. 233 KK", "art. 415 k.c.", "art. 6 ustawy o VAT".
const ACT_AFTER = /\bart\.?\s*\d+[a-z]{0,4}(?:\s*(?:§|ust\.?|pkt|lit\.?)\s*\d+[a-z]{0,3})*\s+(.+)$/i;
export function provisionReference(claim, sourceUrl) {
    const article = ARTICLE.exec(claim)?.[1];
    if (!article)
        return null;
    const eli = sourceUrl ? ELI_IN_URL.exec(sourceUrl) : null;
    const paragraph = PARAGRAPH.exec(claim)?.[1];
    const section = paragraph ? undefined : SECTION.exec(claim)?.[1];
    return {
        act: ACT_AFTER.exec(claim)?.[1]?.trim() || null,
        eli: eli ? `${eli[1]}/${eli[2]}/${Number(eli[3])}` : null,
        article: article.toLowerCase(),
        unit: paragraph ? `§ ${paragraph}` : section ? `ust. ${section}` : null
    };
}
// Offsets of the cited unit in the article text (same layout as articleUnits).
export function unitRange(text, unit) {
    if (!unit)
        return null;
    const marks = [...text.matchAll(/(?:^|\n|\.\s)[ \t]*(§\s*\d+[a-z]{0,3}|\d+[a-z]{0,3})\.\s/gu)].map((match) => ({
        label: match[1].startsWith("§") ? match[1].replace(/\s+/g, " ") : `ust. ${match[1]}`,
        start: match.index + match[0].indexOf(match[1])
    }));
    const at = marks.findIndex((mark) => mark.label === unit);
    if (at < 0)
        return null;
    return { start: marks[at].start, end: marks[at + 1]?.start ?? text.length };
}
const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export function provisionPreview(index, claim, sourceUrl) {
    const reference = provisionReference(claim, sourceUrl);
    if (!reference)
        return null;
    let record = reference.eli ? index.currentRecord(reference.eli) : null;
    if (!record && reference.act) {
        const ref = index.resolve(reference.act);
        record = ref ? index.currentRecord(ref.eli) : null;
    }
    const text = record?.articles[reference.article];
    if (!record || !text)
        return null;
    const range = unitRange(text, reference.unit);
    const marked = range
        ? `${escapeHtml(text.slice(0, range.start))}<mark id="${PROVISION_ANCHOR}">${escapeHtml(text.slice(range.start, range.end))}</mark>${escapeHtml(text.slice(range.end))}`
        : `<mark id="${PROVISION_ANCHOR}">${escapeHtml(text)}</mark>`;
    const anchor = record.articleAnchors?.[reference.article];
    const official = anchor ? `${record.sourceUrl}#${anchor}` : record.sourceUrl;
    const label = `art. ${reference.article}${reference.unit ? ` ${reference.unit}` : ""}`;
    const html = [
        "<!doctype html><html><head><meta charset=\"utf-8\">",
        `<title>${escapeHtml(label)} — ${escapeHtml(record.title)}</title>`,
        "<style>body{font-family:Calibri,Arial,sans-serif;margin:16px;line-height:1.5;font-size:14px}",
        "h1{font-size:1.1em;margin:0 0 4px}.sub{color:#555;font-size:12px;margin:0 0 12px}",
        "pre{white-space:pre-wrap;font-family:inherit;margin:0}",
        "mark{background:#fff1a8;padding:2px 0;scroll-margin-top:40px}</style></head><body>",
        `<h1>${escapeHtml(record.title)}</h1>`,
        `<p class="sub">Lokalna kopia tekstu z Sejm ELI ${escapeHtml(record.eli)}, pobrana ${escapeHtml(record.fetchedAt.slice(0, 10))}. ` +
            `Zaznaczono: ${escapeHtml(label)}${reference.unit && !range ? " (jednostki nie wyodrębniono, zaznaczono cały artykuł)" : ""}. ` +
            `Oficjalny tekst: ${escapeHtml(official)}</p>`,
        `<pre>${marked}</pre>`,
        "</body></html>"
    ].join("");
    return {
        kind: "html",
        html,
        anchor: PROVISION_ANCHOR,
        eli: record.eli,
        article: reference.article,
        unit: reference.unit,
        unitFound: !reference.unit || Boolean(range),
        copyFetchedAt: record.fetchedAt,
        sourceUrl: official
    };
}
