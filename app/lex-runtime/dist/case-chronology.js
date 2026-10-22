// The case's timeline (oś czasu) kept in the case memory: the result of a chronology
// (CHRONOLOGY_V1 report or chronologia-sprawy-v1 in AUTO). A chronology is often one part of a
// larger work (analysis, pleading), so later turns of the case get it, in a new thread too.
export const MAX_CHRONOLOGY_CHARS = 30_000;
// What a later turn gets of it (the window serves the documents first).
export const CHRONOLOGY_PROMPT_CHARS = 12_000;
export function validCaseChronology(value) {
    const item = value;
    if (!item ||
        typeof item !== "object" ||
        typeof item.text !== "string" ||
        !item.text.trim() ||
        item.text.length > MAX_CHRONOLOGY_CHARS ||
        typeof item.updatedAt !== "string" ||
        Number.isNaN(Date.parse(item.updatedAt)) ||
        (item.source !== "CHRONOLOGY_V1" && item.source !== "AUTO") ||
        (item.sessionId !== undefined && (typeof item.sessionId !== "string" || item.sessionId.length > 200))) {
        return null;
    }
    return { text: item.text, updatedAt: item.updatedAt, source: item.source, ...(item.sessionId ? { sessionId: item.sessionId } : {}) };
}
/** The timeline to keep from an answer, or null when the answer is no chronology result. */
export function chronologyFromAnswer(args) {
    const text = args.answer?.trim();
    if (!text || args.status !== "DRAFT_PRESENTABLE")
        return null;
    const source = args.reportClosed ? "CHRONOLOGY_V1" : args.taskSkill === "chronologia-sprawy-v1" ? "AUTO" : null;
    if (!source)
        return null;
    return {
        text: text.length > MAX_CHRONOLOGY_CHARS ? `${text.slice(0, MAX_CHRONOLOGY_CHARS - 40)}\n[…oś czasu skrócona przy zapisie]` : text,
        updatedAt: args.now ?? new Date().toISOString(),
        source,
        ...(args.sessionId ? { sessionId: args.sessionId } : {})
    };
}
/**
 * The block put before the conversation of a later turn (it is pseudonymized with the rest of
 * the query); nothing when the conversation already carries the same timeline.
 */
export function chronologyBlock(chronology, conversation) {
    if (conversation.includes(chronology.text.slice(0, 200)))
        return null;
    const date = chronology.updatedAt.slice(0, 10);
    const text = chronology.text.length > CHRONOLOGY_PROMPT_CHARS
        ? `${chronology.text.slice(0, CHRONOLOGY_PROMPT_CHARS)}\n[…dalsza część osi czasu w pamięci sprawy]`
        : chronology.text;
    return `[Oś czasu sprawy zapisana w sprawie ${date} (wynik chronologii); użyj jej jako materiału sprawy, daty sprawdź z dokumentami:]\n${text}\n[Koniec osi czasu]`;
}
const ENVELOPE_PREFIX = "__LEX_SKILLS_V1__";
/**
 * The query with the case memory (register, overview, timeline) right before the latest user
 * turn, as an earlier result of the assistant (not the user's words: routing reads the user's
 * turns). The earlier conversation stays first and unchanged from turn to turn, so the
 * provider's prompt cache reads it although the memory block changes. A first message
 * without the "Użytkownik:" label gets it, so the latest user turn stays the request alone.
 */
export function queryWithChronology(query, block) {
    const headerEnd = query.startsWith(ENVELOPE_PREFIX) ? query.indexOf("\n") + 1 : 0;
    const header = query.slice(0, headerEnd);
    const conversation = query.slice(headerEnd);
    const labelled = /(?:^|\n\n)Użytkownik: /u.test(conversation) ? conversation : `Użytkownik: ${conversation}`;
    const last = labelled.startsWith("Użytkownik: ") && !labelled.includes("\n\nUżytkownik: ") ? 0 : labelled.lastIndexOf("\n\nUżytkownik: ") + 2;
    // A blank line after the envelope header: the memory is a turn of its own.
    return `${header}${header ? "\n" : ""}${labelled.slice(0, last)}Asystent: ${block}\n\n${labelled.slice(last)}`;
}
