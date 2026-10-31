/**
 * A document AST as lines for the gates: every text node of the JSON is a line of its own,
 * between invisible boundary lines. The gates read a provision's act and status from its line
 * and put markers at the claim or the line's end; on the one line of JSON they read the act from
 * the whole document and appended the markers after its closing brace (RD 121/26: ✅ outside the
 * file, "art. 190a § 1" ✅ and ⚠️ "on one line" blocked the status consistency gate).
 */
// A line holding only U+2063 INVISIBLE SEPARATOR: no reference, marker or word matches it.
const NODE_BREAK = "\n⁣\n";
// Before what followed the JSON (the application's warnings): kept after it as it was.
const TAIL_BREAK = "\n⁤\n";
// End of the JSON object the text starts with (strings and escapes respected), or -1.
function objectEnd(text, start) {
    let depth = 0;
    let inString = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (char === "\\")
                index += 1;
            else if (char === "\"")
                inString = false;
            continue;
        }
        if (char === "\"")
            inString = true;
        else if (char === "{")
            depth += 1;
        else if (char === "}") {
            depth -= 1;
            if (depth === 0)
                return index + 1;
        }
    }
    return -1;
}
export function astTextLines(output) {
    const start = output.search(/\S/u);
    if (start < 0 || output[start] !== "{")
        return null;
    const end = objectEnd(output, start);
    if (end < 0)
        return null;
    let ast;
    try {
        ast = JSON.parse(output.slice(start, end));
    }
    catch {
        return null;
    }
    const nodes = [];
    const walk = (value) => {
        if (Array.isArray(value))
            value.forEach(walk);
        else if (value && typeof value === "object") {
            const record = value;
            if (typeof record.text === "string")
                nodes.push(record);
            for (const [key, child] of Object.entries(record))
                if (key !== "text")
                    walk(child);
        }
    };
    walk(ast);
    if (nodes.length === 0)
        return null;
    const tail = output.slice(end);
    return {
        text: nodes.map((node) => node.text).join(NODE_BREAK) + (tail.trim() ? TAIL_BREAK + tail.trim() : ""),
        restore(text) {
            const tailAt = text.lastIndexOf(TAIL_BREAK);
            const body = tailAt >= 0 ? text.slice(0, tailAt) : text;
            const after = tailAt >= 0 ? text.slice(tailAt + TAIL_BREAK.length) : "";
            const parts = body.split(NODE_BREAK);
            // A gate that added lines of its own without a boundary: they stay with the last node.
            const extra = parts.length > nodes.length ? parts.splice(nodes.length - 1).join("\n") : null;
            if (extra !== null)
                parts.push(extra);
            parts.forEach((part, index) => {
                if (index < nodes.length)
                    nodes[index].text = part;
            });
            return JSON.stringify(ast) + (after.trim() ? `\n${after.trim()}` : "");
        }
    };
}
