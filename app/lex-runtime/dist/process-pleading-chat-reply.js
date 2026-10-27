import { acceptProcessPleadingStart, confirmProcessCheckpoint, requestProcessCheckpointRevision, validateProcessPleadingState } from "./process-pleading-state.js";
const FINISH = /(?<![\p{L}])(?:daj(?:cie)?\s+(?:mi\s+)?(?:gotow\p{L}*\s+)?(?:dokument|plik|pismo|docx)|(?:przygotuj|wygeneruj|zrób|zrob|napisz)\s+(?:od\s+razu|teraz|już|gotow\p{L}*)\s+(?:dokument|plik|pismo|docx|\.docx)|dokończ\p{L}*|do\s+końca|bez\s+(?:zatrzymywania|zatrzymań|przystanków|potwierdz\p{L}*|pytania|pytań)|resztę\s+(?:etapów\s+|kroków\s+)?(?:automatycznie|w\s+jednym|naraz|od\s+razu))(?![\p{L}])/iu;
const ACCEPT = /^(?:a\)?|ad\s*a|tak|ok|okej|okay|dobrze|zgoda|jasne|akceptuj\p{L}*|zatwierdzam|potwierdzam|zatwierdź|trzymaj\s+to|ok\s+trzymaj\s+to)(?:[\s,.!:;—–-]+(?:tak|ok|akceptuj\p{L}*|zatwierdzam|potwierdzam|wczytaj\s+checklist\p{L}*(?:\s+i\s+rozpocznij)?|rozpocznij|zaczynaj|proszę|trzymaj\s+to))*[\s.!]*$/iu;
// A reply that changes the result is not a confirmation ("nie", "popraw", "porzuć ścieżkę D");
// with what to change (REVISE) it sends the step back with remarks.
const REVISE = /(?<![\p{L}])(?:uwagi|popraw\p{L}*|zmie[nń]\p{L}*|modyfik\p{L}*|porzu\p{L}*|usuń|dodaj|uzupełnij\p{L}*)(?![\p{L}])/iu;
const CHANGE = /(?<![\p{L}])(?:nie|popraw\p{L}*|zmie[nń]\p{L}*|modyfik\p{L}*|porzu\p{L}*|usuń|dodaj|uzupełnij\p{L}*|wstrzymaj|zatrzymaj|stop)(?![\p{L}])/iu;
// An option other than a) of the report's choice ("b", "C", "B) Nie — zakończ…"), or a refusal
// with its reason ("Nie, wolę ścieżkę D"): the step runs again on it, as the skill's model
// answers it. A bare "nie" says nothing to run on: the app asks what to change.
const CHOICE = /^[b-f](?:\)|[.:,—–-]|\s|$)/iu;
const REFUSAL_WITH_REASON = /^nie(?![\p{L}])[\s,.:;—–-]+\p{L}[^]*\p{L}{3}/iu;
/** A bare "nie" to the pipeline's question: not small talk; the step's gate asks what to change. */
export function bareRefusal(message) {
    return /^nie(?![\p{L}])[\s.!]*$/iu.test(message.trim());
}
export function pleadingChatReply(message) {
    const text = message.trim();
    if (!text || text.length > 300)
        return null;
    if (CHOICE.test(text) || REFUSAL_WITH_REASON.test(text))
        return "REVISE";
    const finish = FINISH.test(text);
    const withoutFinish = text.replace(FINISH, " ");
    if (REVISE.test(withoutFinish) && !/\?\s*$/u.test(text))
        return "REVISE";
    if (CHANGE.test(withoutFinish))
        return null;
    if (finish)
        return "FINISH";
    // The chat's button for option a) sends its whole text ("a) Akceptuję pismo jako DRAFT …").
    if (/^a\)\s/iu.test(text) && /(?<![\p{L}])(?:tak|akceptuj\p{L}*|zatwierdzam|potwierdzam)(?![\p{L}])/iu.test(text))
        return "ACCEPT";
    return ACCEPT.test(text) ? "ACCEPT" : null;
}
/** The state after the reply, and a line for the answer saying what the reply did. */
export function applyPleadingChatReply(input, message, at = new Date().toISOString()) {
    let state = validateProcessPleadingState(input);
    const reply = pleadingChatReply(message);
    if (!reply || state.stage === "FINAL")
        return { state, note: null };
    const done = [];
    // Only an answer to the question the pipeline asked moves it: "INFORMACJA PRZED STARTEM" (a/b)
    // or a step waiting for confirmation. "Przygotuj pismo" at the start is the request itself.
    if (reply === "REVISE") {
        if (!state.pendingCheckpoint || state.mode !== "CHECKPOINT")
            return { state, note: null };
        const checkpoint = state.pendingCheckpoint;
        return {
            state: requestProcessCheckpointRevision(state, checkpoint, at),
            note: `Twoja odpowiedź: etap ${checkpoint} wykonuję ponownie ${CHOICE.test(message.trim()) ? `z Twoim wyborem «${message.trim().slice(0, 80)}»` : "z Twoimi uwagami"}.`,
            revision: { checkpoint, remarks: message.trim() }
        };
    }
    if (state.stage === "CG_ACCEPTANCE") {
        if (reply !== "ACCEPT")
            return { state, note: null };
        state = acceptProcessPleadingStart(state, at);
        done.push("start pisma zaakceptowany");
    }
    else if (state.pendingCheckpoint && state.mode === "CHECKPOINT") {
        const checkpoint = state.pendingCheckpoint;
        state = confirmProcessCheckpoint(state, checkpoint, at);
        done.push(`etap ${checkpoint} potwierdzony`);
    }
    else
        return { state, note: null };
    if (reply === "FINISH" && state.stage !== "FINAL") {
        const open = Object.entries(state.checkpoints)
            .filter(([, status]) => status === "OPEN")
            .map(([checkpoint]) => checkpoint);
        done.push(`plik .docx powstanie dopiero po zamknięciu wszystkich etapów z Twoim potwierdzeniem (pisma-procesowe-v3: ZAKAZ-CP, ZAKAZ-12)` +
            (open.length ? `; zostało ${open.length}: ${open.join(", ")}` : "") +
            `; projekt pisma po etapie W2 możesz pobrać wcześniej jako DRAFT — NIEZWERYFIKOWANY (INFORMACJA WARUNKOWA)`);
    }
    if (!done.length)
        return { state, note: null };
    return { state, note: `Twoja odpowiedź: ${done.join("; ")}.` };
}
// The panel's "Kontynuuj" message: the turn that runs the pipeline's next or open step.
export const PLEADING_CONTINUATION = "Kontynuuj pipeline pisma procesowego zgodnie z aktywnym checkpointem.";
const USER_TURN = "\n\nUżytkownik: ";
/**
 * A short reply in a pleading thread ("tak", "c", "B) …") runs the step as the panel's
 * "Kontynuuj" does, with the reply quoted: alone, the model took "tak" for the whole task and
 * ran no step (G39H: AUTOMAT-STANOW / SELF-CHECK-PISMA not read, workflow BLOCKED).
 */
export function pleadingContinuationQuery(query, reply) {
    const turn = `${PLEADING_CONTINUATION} Odpowiedź użytkownika na poprzedni etap: «${reply.trim()}»`;
    const at = query.lastIndexOf(USER_TURN);
    if (at >= 0)
        return query.slice(0, at + USER_TURN.length) + turn;
    const envelope = /^__LEX_SKILLS_V1__ [^\n]*\n/u.exec(query)?.[0] ?? "";
    return envelope + turn;
}
