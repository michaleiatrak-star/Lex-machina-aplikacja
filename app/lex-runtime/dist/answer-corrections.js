// What a correcting round of the application changed in an answer: the findings that sent it
// back and the sentences of the first version the corrected one no longer has. Kept with the
// answer, so "which claims did you remove?" is answered from this record, not reconstructed.
const MAX_REMOVED = 15;
const MAX_SENTENCE = 400;
const MAX_FINDINGS = 10;
const normalize = (text) => text
    .replace(/[✅🟨⚠️⛔]|\[VER:[^\]]*\]/gu, "")
    .replace(/[*_#>`|]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("pl");
// Legal abbreviations end with a dot inside a sentence ("art. 6", "Dz.U. poz. 5").
const ABBREVIATION = /(?:^|[\s(\[])(?:art|ust|pkt|poz|nr|lit|sygn|r|tj|t\.j|Dz\.U|zm|godz|str|s|ok|tzw|np|m\.in|ww|zob|por|par|k\.c|k\.p\.c|k\.k|k\.p\.a)\.$/iu;
function splitLine(line) {
    const parts = line.split(/(?<=[.!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ0-9„"(\[])/u);
    const out = [];
    for (const part of parts) {
        const last = out[out.length - 1];
        if (last !== undefined && (ABBREVIATION.test(last) || /\[[^\]]*$/u.test(last)))
            out[out.length - 1] = `${last} ${part}`;
        else
            out.push(part);
    }
    return out;
}
// Sentences and list items; a sentence ends at . ! ? before whitespace and a capital or digit.
function sentences(text) {
    return text
        .split(/\n+/u)
        .flatMap(splitLine)
        .map((part) => part.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/u, "").trim())
        .filter((part) => normalize(part).length >= 20);
}
/** Sentences of the first version the corrected one does not contain (in their order). */
export function removedSentences(before, after) {
    const kept = normalize(after);
    const seen = new Set();
    const removed = [];
    for (const sentence of sentences(before)) {
        const key = normalize(sentence);
        if (seen.has(key) || kept.includes(key))
            continue;
        seen.add(key);
        removed.push(sentence.length > MAX_SENTENCE ? `${sentence.slice(0, MAX_SENTENCE)}…` : sentence);
        if (removed.length >= MAX_REMOVED)
            break;
    }
    return removed;
}
export function answerCorrection(round, findings, before, after) {
    return { round, findings: findings.slice(0, MAX_FINDINGS), removed: removedSentences(before, after) };
}
export function validAnswerCorrections(value) {
    return (Array.isArray(value) &&
        value.length <= 4 &&
        value.every((item) => item &&
            typeof item === "object" &&
            (item.round === "MANDATORY_PATH" || item.round === "CASE_GROUNDING") &&
            Array.isArray(item.findings) &&
            item.findings.length <= MAX_FINDINGS &&
            item.findings.every((finding) => typeof finding === "string" && finding.length <= 500) &&
            Array.isArray(item.removed) &&
            item.removed.length <= MAX_REMOVED &&
            item.removed.every((sentence) => typeof sentence === "string" && sentence.length <= MAX_SENTENCE + 1)));
}
