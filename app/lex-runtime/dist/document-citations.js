export const QUOTE_MISMATCH_MARKER = "⚠️ [CYTAT NIEZGODNY Z DOKUMENTEM]";
export const QUOTE_UNSOURCED_MARKER = "⚠️ [CYTAT NIEODNALEZIONY W AKTACH]";
const MARKER = /\[\[LEXDOC:([^:\]\r\n]{1,180}):(\d{1,7})\]\]/g;
const MAX_QUOTE_SCAN = 4_500;
function quoteBefore(text, markerStart) {
    // "*„…”* [[LEXDOC…]]": emphasis around the quote and a space before the marker.
    const window = text.slice(Math.max(0, markerStart - MAX_QUOTE_SCAN), markerStart).trimEnd().replace(/[*_]+$/u, "");
    const candidates = [
        /„([^„”]{2,4000})”\s*$/s,
        /“([^“”]{2,4000})”\s*$/s,
        /"([^"\r\n]{2,4000})"\s*$/s,
        /'([^'\r\n]{2,4000})'\s*$/s
    ];
    for (const pattern of candidates) {
        const match = window.match(pattern);
        const quote = match?.[1]?.trim();
        if (quote)
            return quote;
    }
    return undefined;
}
// Folds only what does not change the wording: whitespace, line-break hyphenation, dashes,
// quotation-mark style and letter case. Never fuzzy matching: a changed word is a mismatch.
function fold(text) {
    let out = "";
    const map = [];
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === "\u00AD")
            continue;
        if (/[-‐‑‒–—−]/u.test(ch)) {
            // "praco-\nwnik" is "pracownik"; other dashes are dropped on both sides.
            if (/^.[ \t]*\r?\n/u.test(text.slice(i, i + 6))) {
                while (i + 1 < text.length && /\s/u.test(text[i + 1]))
                    i += 1;
            }
            continue;
        }
        let folded;
        if (/\s/u.test(ch)) {
            if (out === "" || out.endsWith(" "))
                continue;
            folded = " ";
        }
        else if (/[„“”"«»]/u.test(ch))
            folded = "\"";
        else if (/[‚‘’'`]/u.test(ch))
            folded = "'";
        else if (ch === "…")
            folded = "...";
        else {
            const lower = ch.toLowerCase();
            folded = lower.length === 1 ? lower : ch;
        }
        for (const part of folded) {
            out += part;
            map.push(i);
        }
    }
    return { text: out, map };
}
const ELISION = /\s*(?:\[\s*(?:\.{3}|…)\s*\]|\(\s*(?:\.{3}|…)\s*\)|\.{3}|…)\s*/u;
function quoteSegments(quote) {
    return quote
        .split(ELISION)
        .map((segment) => fold(segment).text.trim().replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/gu, ""))
        .filter((segment) => segment.length >= 3);
}
// Every segment of the quote ("a [...] b" is two) in the document, in order.
function locateQuote(contextText, quote) {
    if (!quote)
        return undefined;
    const segments = quoteSegments(quote);
    if (segments.length === 0)
        return undefined;
    const source = fold(contextText);
    let from = 0;
    let start = -1;
    let end = -1;
    for (const segment of segments) {
        const at = source.text.indexOf(segment, from);
        if (at < 0)
            return undefined;
        if (start < 0)
            start = at;
        end = at + segment.length;
        from = end;
    }
    return { start: source.map[start], end: source.map[end - 1] + 1 };
}
function textContainsQuote(text, quote) {
    return locateQuote(text, quote) !== undefined;
}
function findQuoteChunk(entries, quote, preferDocumentId) {
    const ordered = preferDocumentId
        ? [
            ...entries.filter((entry) => entry.attachment.documentId === preferDocumentId),
            ...entries.filter((entry) => entry.attachment.documentId !== preferDocumentId)
        ]
        : entries;
    for (const entry of ordered) {
        const location = locateQuote(entry.chunk.text, quote);
        if (location)
            return { entry, location };
    }
    return undefined;
}
// A quote the answer attributes to a pleading, a letter or another case document.
const DOCUMENT_ATTRIBUTION = /(?:pozw\p{L}*|pism\p{L}*|apelacj\p{L}*|zażaleni\p{L}*|sprzeciw\p{L}*|skarg\p{L}*|wnios\p{L}*|umow\p{L}*|aneks\p{L}*|zaskarżon\p{L}*|protok\p{L}*|wezwani\p{L}*|notatk\p{L}*|e-?mail\p{L}*|korespondencj\p{L}*|regulamin\p{L}*|dokument\p{L}*|załącznik\p{L}*|przeciwn\p{L}*|powod\p{L}*|powód|pełnomocnik\p{L}*|oskarżon\p{L}*|uczestnik\p{L}*|wierzyciel\p{L}*|dłużni\p{L}*|kontrahent\p{L}*|klient\p{L}*)/giu;
// The wording of a statute or a judgment's thesis: checked by the provision and case-law gates.
const NON_DOCUMENT_SOURCE = /(?:\bart\.|§|\bstanowi\p{L}*|\bbrzmi\p{L}*|\bprzepis\p{L}*|\bustaw\p{L}*|\bkodeks\p{L}*|\bDz\.\s?U|\bteza\p{L}*|\bSN\b|\bNSA\b|\bTK\b|\bTSUE\b|\bSąd Najwyższy)/giu;
// Typographic quotes only: straight "…" are JSON strings and code as often as quotations.
const UNMARKED_QUOTE = /„([^„”\r\n]{20,1500})”|“([^“”\r\n]{20,1500})”/gu;
function lastMatchEnd(pattern, text) {
    let last = -1;
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null)
        last = match.index + match[0].length;
    return last;
}
function attributedToDocument(text, quoteStart) {
    const paragraphStart = Math.max(text.lastIndexOf("\n\n", quoteStart), quoteStart - 300, 0);
    const before = text.slice(paragraphStart, quoteStart);
    const attribution = lastMatchEnd(DOCUMENT_ATTRIBUTION, before);
    if (attribution < 0)
        return false;
    // "pozwany powołuje art. 6 k.c., który stanowi: „…”": the nearer cue decides.
    return lastMatchEnd(NON_DOCUMENT_SOURCE, before) < attribution;
}
// Quotes without a marker: linked when found in a case document; flagged when attributed to
// a document yet found neither there nor in the thread or the case law read in this turn.
function linkUnmarkedQuotes(text, entries, otherTexts) {
    // A structured result (the document AST) is not prose: quotes in it are not touched.
    if (/^\s*[{[]/u.test(text))
        return { text, autoLinked: 0, unsourced: 0 };
    let output = "";
    let cursor = 0;
    let autoLinked = 0;
    let unsourced = 0;
    UNMARKED_QUOTE.lastIndex = 0;
    let match;
    const fences = [...text.matchAll(/^```[^\n]*\n[\s\S]*?^```/gmu)]
        .map((fence) => ({ start: fence.index, end: fence.index + fence[0].length }));
    while ((match = UNMARKED_QUOTE.exec(text)) !== null) {
        const quote = (match[1] ?? match[2] ?? "").trim();
        const end = match.index + match[0].length;
        if (fences.some((fence) => match.index >= fence.start && match.index < fence.end))
            continue;
        if (/^[*_]*\s*\[\[LEXDOC:/u.test(text.slice(end, end + 16)))
            continue;
        if (quote.split(/\s+/u).length < 4)
            continue;
        const found = entries.length ? findQuoteChunk(entries, quote) : undefined;
        if (found) {
            output += text.slice(cursor, end) + `[[LEXDOC:${found.entry.attachment.documentId}:${found.entry.chunk.index}]]`;
            cursor = end;
            autoLinked += 1;
            continue;
        }
        if (!attributedToDocument(text, match.index))
            continue;
        if (otherTexts.some((other) => textContainsQuote(other, quote)))
            continue;
        // A digest shows the passage shortened: the quote may be in the full text.
        if (entries.some((entry) => entry.chunk.representation === "EXTRACTIVE_DIGEST"))
            continue;
        output += text.slice(cursor, end) + ` ${QUOTE_UNSOURCED_MARKER}`;
        cursor = end;
        unsourced += 1;
    }
    return { text: output + text.slice(cursor), autoLinked, unsourced };
}
export function documentCitationSystemPrompt(attachments) {
    if (attachments.length === 0)
        return "";
    return [
        "# LOCAL DOCUMENT CITATION PROTOCOL",
        "When you quote or closely rely on an attached local document, cite the exact chunk immediately after the relevant sentence or quotation using this internal marker:",
        "[[LEXDOC:<documentId>:<chunkIndex>]]",
        "Use only documentId and chunkIndex values present in LOCAL_DOCUMENT_CONTEXT.",
        "Never invent a document id, page, chunk, quote, or marker.",
        "For a verbatim quotation, place the marker immediately after the closing quotation mark so the application can validate and highlight the exact passage.",
        "Quote a pleading, a letter or any case document word for word; mark omissions with [...]. A quotation not found in the document is shown to the user as not matching it.",
        "Markers are machine-readable metadata and will be replaced by clickable in-chat citations before presentation."
    ].join("\n");
}
export function processDocumentCitationMarkers(modelText, attachments, options = {}) {
    const chunks = new Map();
    for (const attachment of attachments) {
        for (const chunk of attachment.chunks) {
            chunks.set(`${attachment.documentId}:${chunk.index}`, {
                attachment,
                chunk
            });
        }
    }
    const entries = [...chunks.values()];
    const linked = linkUnmarkedQuotes(modelText, entries, options.otherTexts ?? []);
    const text = linked.text;
    let mismatched = 0;
    const citations = [];
    let rejectedMarkers = 0;
    let output = "";
    let cursor = 0;
    let match;
    MARKER.lastIndex = 0;
    while ((match = MARKER.exec(text)) !== null) {
        output += text.slice(cursor, match.index);
        const documentId = match[1] ?? "";
        const chunkIndex = Number(match[2]);
        const cited = chunks.get(`${documentId}:${chunkIndex}`);
        if (!cited || !Number.isInteger(chunkIndex)) {
            rejectedMarkers += 1;
            cursor = match.index + match[0].length;
            continue;
        }
        const citationId = `docref_${citations.length + 1}`;
        const marker = `[[LEXDOCREF:${citationId}]]`;
        const quote = quoteBefore(text, match.index);
        let resolved = cited;
        let location = locateQuote(cited.chunk.text, quote);
        if (quote && !location) {
            // Cited the wrong chunk: the link goes where the words actually are.
            const elsewhere = findQuoteChunk(entries, quote, documentId);
            if (elsewhere) {
                resolved = elsewhere.entry;
                location = elsewhere.location;
            }
        }
        const quoteFidelity = !quote
            ? undefined
            : location
                ? "EXACT"
                : cited.chunk.representation === "EXTRACTIVE_DIGEST"
                    ? "DIGEST_UNCHECKED"
                    : "NOT_FOUND";
        if (quoteFidelity === "NOT_FOUND")
            mismatched += 1;
        const pageLabel = resolved.chunk.pageStart === resolved.chunk.pageEnd
            ? `s. ${resolved.chunk.pageStart}`
            : `s. ${resolved.chunk.pageStart}–${resolved.chunk.pageEnd}`;
        const citation = {
            citationId,
            marker,
            label: `Dokument ${citations.length + 1}, ${pageLabel}`,
            ...(resolved.attachment.caseId
                ? { caseId: resolved.attachment.caseId }
                : {}),
            documentId: resolved.attachment.documentId,
            chunkIndex: resolved.chunk.index,
            pageStart: resolved.chunk.pageStart,
            pageEnd: resolved.chunk.pageEnd,
            contextText: resolved.chunk.text,
            ...(quote ? { quote } : {}),
            ...(quoteFidelity ? { quoteFidelity } : {}),
            ...(location
                ? {
                    highlightStart: location.start,
                    highlightEnd: location.end
                }
                : {})
        };
        citations.push(citation);
        output += quoteFidelity === "NOT_FOUND" ? `${marker} ${QUOTE_MISMATCH_MARKER}` : marker;
        cursor = match.index + match[0].length;
    }
    output += text.slice(cursor);
    return {
        text: output,
        citations,
        rejectedMarkers,
        quoteFindings: {
            autoLinked: linked.autoLinked,
            mismatched,
            unsourced: linked.unsourced
        }
    };
}
