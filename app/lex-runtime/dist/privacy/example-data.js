/**
 * Example data written by the assistant in earlier answers (a model letter
 * with "Jan Kowalski, ul. Polna 1"): it is no one's data, so it stays as
 * written when the conversation goes back to the model. Kept only when the
 * value appears nowhere else the user supplied (their messages, attached
 * documents) and the history is complete (no omitted or summarized part, which
 * could hide where the value came from). Identifiers (PESEL, IBAN, …) are
 * always protected.
 */
const EXAMPLE_KINDS = new Set(["PERSON", "ADDRESS", "BIRTH_DATE", "EMAIL", "PHONE"]);
const TURN = /(?:^|\n\n)(Użytkownik|Asystent): /g;
const INCOMPLETE_HISTORY = /\[Wcześniejsza część rozmowy pominięta|\[Streszczenie wcześniejszej części rozmowy|^\[…\]|\n\n\[…\] /;
const fold = (value) => value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ł/gi, "l").toLowerCase();
function assistantRanges(text) {
    const turns = [...text.matchAll(TURN)].map((match) => ({
        role: match[1],
        start: match.index + match[0].length,
        head: match.index
    }));
    return turns.flatMap((turn, index) => turn.role === "Asystent" ? [{ start: turn.start, end: turns[index + 1]?.head ?? text.length }] : []);
}
// Word stems of a value ("Kowalskiego" and "Kowalski" share "kowal").
function stems(value) {
    return fold(value)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 3)
        .map((word) => (/^\p{N}+$/u.test(word) ? word : word.slice(0, Math.max(3, word.length - 3))));
}
export function exampleDataKeepDirectives(text, findings, otherUserText = "") {
    if (INCOMPLETE_HISTORY.test(text))
        return [];
    const ranges = assistantRanges(text);
    if (!ranges.length)
        return [];
    let supplied = "";
    let cursor = 0;
    for (const range of ranges) {
        supplied += text.slice(cursor, range.start) + "\n";
        cursor = range.end;
    }
    supplied = fold(supplied + text.slice(cursor) + "\n" + otherUserText);
    const keep = [];
    for (const finding of findings) {
        if (!EXAMPLE_KINDS.has(finding.kind))
            continue;
        if (!ranges.some((range) => finding.start >= range.start && finding.end <= range.end))
            continue;
        const words = stems(text.slice(finding.start, finding.end));
        if (!words.length || words.some((word) => supplied.includes(word)))
            continue;
        if (keep.some((item) => item.start < finding.end && finding.start < item.end))
            continue;
        keep.push({ start: finding.start, end: finding.end, action: "KEEP" });
    }
    return keep;
}
