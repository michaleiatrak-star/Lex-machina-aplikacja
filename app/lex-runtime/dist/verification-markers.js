/**
 * Verification markers are part of the chat answer, never of a document filed
 * with a court (shared/WERYFIKACJA-SLAD.md, STRIP-VER-GATE): ✅ [VER: …] with
 * its gradient (VER-FRAGMENT, VER-TREŚĆ), 🟠 [KALIBRACJA], 🔴 [BLOKADA],
 * 🔗 [KOTWICA-TEKSTOWA], 🟨 [KOTWICA-URZĘDOWA], 📚 [TREŚĆ], ⚠️ [NIEWERYFIKOWANE]
 * and the case-law markers. The provision stays, the marker goes; the trail
 * stays in the session's verification ledger.
 *
 * ⬛ [DO UZUPEŁNIENIA] is not a marker but a gap: HYBRID validation blocks it.
 */
const MARKER_BODY = "(?:VER(?:-FRAGMENT|-TREŚĆ)?|KALIBRACJA|BLOKADA|KOTWICA-TEKSTOWA|KOTWICA-URZĘDOWA|TREŚĆ|NIEWERYFIKOWANE|CASE-QUOTE|CASE-SUPPORT)";
const MARKER_SOURCE = `(?:✅|🟢|🟡|🟠|🔴|🔗|🟨|📚|⚠️|⚠)?\\uFE0F?\\s*\\[${MARKER_BODY}(?::[^\\]\\r\\n]*)?\\]`;
export const VERIFICATION_MARKER = new RegExp(MARKER_SOURCE, "u");
/** Text without verification markers and without the spaces they leave. */
export function stripVerificationMarkers(text) {
    return text
        .replace(new RegExp(`[ \\t]*${MARKER_SOURCE}`, "gu"), "")
        .replace(/[ \t]+([.,;:)\]])/gu, "$1")
        .replace(/[ \t]{2,}/gu, " ")
        .replace(/[ \t]+$/gmu, "");
}
export function containsVerificationMarker(text) {
    return VERIFICATION_MARKER.test(text);
}
function stripInline(nodes) {
    const out = [];
    for (const node of nodes) {
        if (node.type !== "text") {
            out.push(node);
            continue;
        }
        const text = stripVerificationMarkers(node.text);
        if (text)
            out.push({ ...node, text });
    }
    // A marker between two nodes leaves "art. 5 KC ." across the boundary.
    for (let index = 1; index < out.length; index += 1) {
        const node = out[index];
        const previous = out[index - 1];
        if (node.type === "text" && previous.type === "text" && /^[.,;:]/u.test(node.text)) {
            out[index - 1] = { ...previous, text: previous.text.replace(/[ \t]+$/u, "") };
        }
    }
    return out;
}
function stripBlock(block) {
    switch (block.type) {
        case "heading":
        case "paragraph":
        case "quote":
        case "signature":
            return { ...block, content: stripInline(block.content) };
        case "list":
            return { ...block, items: block.items.map(stripInline) };
        case "table":
            return {
                ...block,
                rows: block.rows.map((row) => row.map((cell) => ({ ...cell, blocks: cell.blocks.map(stripBlock) })))
            };
        default:
            return block;
    }
}
/** The document a court receives: every verification marker removed from its text nodes. */
export function stripAstVerificationMarkers(ast) {
    let removed = 0;
    const count = (nodes) => {
        for (const node of nodes) {
            if (node.type === "text")
                removed += node.text.match(new RegExp(MARKER_SOURCE, "gu"))?.length ?? 0;
        }
    };
    const visit = (block) => {
        if (block.type === "list")
            block.items.forEach(count);
        else if (block.type === "table")
            block.rows.forEach((row) => row.forEach((cell) => cell.blocks.forEach(visit)));
        else if ("content" in block)
            count(block.content);
    };
    if (ast.title)
        count(ast.title);
    ast.blocks.forEach(visit);
    if (removed === 0)
        return { ast, removed };
    return {
        ast: {
            ...ast,
            ...(ast.title ? { title: stripInline(ast.title) } : {}),
            blocks: ast.blocks.map(stripBlock)
        },
        removed
    };
}
