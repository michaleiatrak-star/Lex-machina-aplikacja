import { stripVerificationMarkers } from "./verification-markers.js";
const NUMBER = String.raw `\d{1,3}(?:[   .]\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?`;
const CURRENCY = String.raw `(?:zł|złotych|złote|złoty|PLN|EUR|euro|€|USD)`;
const AMOUNT = new RegExp(String.raw `(?<![\d,.])(${NUMBER})(?:,-)?\s?${CURRENCY}(?![\p{L}\d])`, "giu");
const SUM = new RegExp(String.raw `(?<![\d,.])(${NUMBER})(?:\s?${CURRENCY})?((?:\s?[+\-−]\s?(?:${NUMBER})(?:\s?${CURRENCY})?)+)\s?=\s?(${NUMBER})`, "giu");
const TERM = new RegExp(String.raw `([+\-−])\s?(${NUMBER})`, "gu");
const MONTHS = {
    stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6, lipca: 7,
    sierpnia: 8, września: 9, października: 10, listopada: 11, grudnia: 12
};
const DATE_DIGITS = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/gu;
const DATE_WORDS = new RegExp(String.raw `(?<!\d)(\d{1,2})\s+(${Object.keys(MONTHS).join("|")})\s+(\d{4})(?!\d)`, "giu");
const DATE_ISO = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/gu;
const ATTACHMENTS_HEADING = /^\s*(?:\*\*)?\s*za[łl]ącznik(?:i|ów)?\s*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/iu;
const ITEM = /^\s*(?:(\d+)\s*[.)]|[-–•*])\s+(.+?)\s*$/u;
const REFERENCE = /\bzał(?:ącznik(?:i|u|iem|a)?|\.)\s*(?:nr\.?\s*)?(\d+)/giu;
const WORKING_PART = /^\s*(?:#+\s*)?CZĘŚĆ ROBOCZA\b/mu;
/** Amount in grosze; "1 000 zł" and "1000,00 zł" are the same. */
function grosze(value) {
    const [whole, fraction = ""] = value.replace(/[   .]/gu, "").split(",");
    return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}
/** 1240000n -> "12 400,00". */
export function formatGrosze(value) {
    const sign = value < 0n ? "-" : "";
    const abs = value < 0n ? -value : value;
    const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
    return `${sign}${whole},${(abs % 100n).toString().padStart(2, "0")}`;
}
function count(values) {
    const out = new Map();
    for (const value of values)
        out.set(value, (out.get(value) ?? 0) + 1);
    return out;
}
function amounts(text) {
    return count([...text.matchAll(AMOUNT)].map((match) => grosze(match[1])));
}
function dates(text) {
    const out = [];
    const iso = (year, month, day) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    for (const m of text.matchAll(DATE_DIGITS)) {
        const day = Number(m[1]), month = Number(m[2]);
        if (day >= 1 && day <= 31 && month >= 1 && month <= 12)
            out.push(iso(Number(m[3]), month, day));
    }
    for (const m of text.matchAll(DATE_WORDS))
        out.push(iso(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])));
    for (const m of text.matchAll(DATE_ISO))
        out.push(`${m[1]}-${m[2]}-${m[3]}`);
    return count(out);
}
/** Sums written "A + B − C = D" that do not add up: [written, computed, given]. */
export function wrongSums(text) {
    const out = [];
    for (const m of text.matchAll(SUM)) {
        let total = grosze(m[1]);
        for (const term of m[2].matchAll(TERM))
            total += term[1] === "+" ? grosze(term[2]) : -grosze(term[2]);
        const given = grosze(m[3]);
        if (total !== given)
            out.push([m[0].trim(), total, given]);
    }
    return out;
}
function attachmentList(lines) {
    const index = lines.findIndex((line) => ATTACHMENTS_HEADING.test(line.text));
    if (index < 0)
        return { items: [], rest: lines.map((line) => line.text).join("\n") };
    const items = [];
    let end = index + 1;
    for (; end < lines.length; end++) {
        const line = lines[end];
        if (!line.text.trim()) {
            if (items.length)
                break;
            continue;
        }
        const match = ITEM.exec(line.text);
        if (match)
            items.push({ number: match[1] ? Number(match[1]) : null, text: match[2] });
        else if (line.listItem)
            items.push({ number: line.number ?? null, text: line.text.trim() });
        else
            break;
    }
    return { items, rest: [...lines.slice(0, index), ...lines.slice(end)].map((line) => line.text).join("\n") };
}
const describe = (text) => text.replace(/[*_`]/gu, "").replace(/\s+/gu, " ").trim().replace(/[;.,]+$/u, "").toLowerCase();
/** The draft's text for the addressee: markers removed, the working part (metrics) cut off. */
export function draftLines(text) {
    const working = WORKING_PART.exec(text);
    return stripVerificationMarkers(working ? text.slice(0, working.index) : text)
        .split("\n")
        .map((line) => ({ text: line, listItem: false }));
}
/** Lines of a generated document AST: one per block, one per list item and table cell. */
export function astLines(ast) {
    const inline = (nodes) => (nodes ?? []).map((node) => (node.type === "text" ? node.text ?? "" : node.type === "pii_ref" ? node.alias ?? "" : node.label ?? "")).join("");
    const root = (ast ?? {});
    const lines = [];
    if (root.title)
        lines.push({ text: inline(root.title), listItem: false });
    const visit = (blocks) => {
        for (const block of blocks ?? []) {
            if (block.type === "list") {
                (block.items ?? []).forEach((item, index) => lines.push({ text: inline(item), listItem: true, ...(block.ordered ? { number: (block.start ?? 1) + index } : {}) }));
                lines.push({ text: "", listItem: false });
            }
            else if (block.type === "table") {
                for (const row of block.rows ?? [])
                    for (const cell of row)
                        visit(cell?.blocks);
            }
            else if (block.content) {
                lines.push({ text: inline(block.content), listItem: false });
            }
        }
    };
    visit(root.blocks);
    return lines;
}
/** Findings of the file against the draft; empty = FILE CHECK PASS. */
export function compareFileWithDraft(draft, file) {
    const out = [];
    const draftText = draft.map((line) => line.text).join("\n");
    const fileText = file.map((line) => line.text).join("\n");
    const draftAmounts = amounts(draftText), fileAmounts = amounts(fileText);
    for (const [amount, times] of draftAmounts) {
        if ((fileAmounts.get(amount) ?? 0) < times)
            out.push({ code: "P1", value: formatGrosze(amount) });
    }
    for (const [amount, times] of fileAmounts) {
        if ((draftAmounts.get(amount) ?? 0) < times)
            out.push({ code: "P2", value: formatGrosze(amount) });
    }
    const draftDates = dates(draftText), fileDates = dates(fileText);
    for (const date of new Set([...draftDates.keys(), ...fileDates.keys()])) {
        if ((draftDates.get(date) ?? 0) !== (fileDates.get(date) ?? 0))
            out.push({ code: "P3", value: date });
    }
    for (const [, computed, given] of wrongSums(fileText)) {
        out.push({ code: "P4", value: `${formatGrosze(given)}/${formatGrosze(computed)}` });
    }
    const draftList = attachmentList(draft).items;
    const fileList = attachmentList(file);
    if (draftList.length !== fileList.items.length) {
        out.push({ code: "P5", value: `${draftList.length}/${fileList.items.length}` });
    }
    const numbers = fileList.items.flatMap((item) => (item.number === null ? [] : [item.number]));
    if (numbers.some((value, index) => value !== index + 1))
        out.push({ code: "P6", value: numbers.join(",") });
    const referenced = new Set([...fileList.rest.matchAll(REFERENCE)].map((match) => Number(match[1])));
    // The list's own numbers when every item has one, else 1..n.
    const listed = new Set(numbers.length === fileList.items.length ? numbers : fileList.items.map((_item, index) => index + 1));
    for (const number of [...referenced].sort((a, b) => a - b)) {
        if (!listed.has(number))
            out.push({ code: "P7", value: String(number) });
    }
    const fileDescriptions = new Set(fileList.items.map((item) => describe(item.text)));
    for (const item of draftList) {
        if (!fileDescriptions.has(describe(item.text)))
            out.push({ code: "P8", value: item.text.slice(0, 80) });
    }
    return out;
}
/** "P1=2 000,00;P5=2/1": the reason the web turns into words. */
export function fileCheckReason(findings) {
    return findings
        .slice(0, 12)
        .map((finding) => `${finding.code}=${finding.value.replace(/[;=]/gu, " ")}`)
        .join(";");
}
