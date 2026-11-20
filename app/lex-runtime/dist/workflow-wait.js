// Checkpoint workflows go on to the next step by themselves (the chat sends it). A step
// that needs the user's answer (missing data, a choice) says so with this line, and the
// chain stops there until the user replies.
export const WAIT_FOR_USER_MARKER = "[CZEKAM NA ODPOWIEDŹ]";
export const WAIT_FOR_USER_INSTRUCTION = `Po tym punkcie aplikacja sama uruchomi następny. Jeśli do wykonania tego punktu potrzebna jest odpowiedź użytkownika (brakujące dane, wybór wariantu), zadaj pytania i zakończ odpowiedź osobną linią ${WAIT_FOR_USER_MARKER}; bez tej linii nie pytaj użytkownika o zgodę na dalsze kroki.`;
export function waitsForUser(answer) {
    return typeof answer === "string" && answer.includes(WAIT_FOR_USER_MARKER);
}
// Process pleading in CHECKPOINT mode: the user confirms every step, but a step that cannot
// be done without missing data is not closed (the runtime keeps the checkpoint open).
export const WAIT_FOR_USER_CHECKPOINT_INSTRUCTION = `Jeśli do wykonania tego punktu potrzebna jest odpowiedź użytkownika (brakujące dane, wybór wariantu), zadaj pytania i zakończ odpowiedź osobną linią ${WAIT_FOR_USER_MARKER}; punkt pozostanie otwarty do odpowiedzi.`;
// A question to the user, not one the analysis asks itself ("Czy świadek jest wiarygodny?"):
// it names the user or a choice left to them.
const USER_QUESTION = /(?<![\p{L}])(?:chcesz|chcecie|chce\s+Pan|chce\s+Pani|masz|macie|możesz|możecie|wolisz|wolicie|potwierdzasz|potwierdź|ma\s+być|mają\s+być|mam\s+(?:przyjąć|wnosić|pisać|ująć|skierować)|Twoj\p{L}*|Ciebie|Pan(?:a|u)?|Pani|Państw\p{L}*|wskaż\p{L}*|podaj\p{L}*|prześlij\p{L}*|dysponuje\p{L}*)(?![\p{L}])/u;
const TRAILING_MARKS = /(?:\s*(?:⚠️|\[[^\]\n]{0,120}\]|\*+|_+|"|”))+\s*$/u;
const QUESTION_INTRO = /(?<![\p{L}])(?:potrzebuję\s+od\s+(?:Ciebie|Pana|Pani|Państwa)|zanim\s+przygotuj\p{L}*|przed\s+przygotowaniem|do\s+ustalenia\s+z\s+(?:Tobą|Panem|Panią|Państwem))(?![\p{L}])/iu;
/** The questions the answer leaves to the user (lines ending with "?" that address them). */
export function questionsToUser(answer) {
    return answer
        .replace(/\r\n?/gu, "\n")
        .split("\n")
        .map((line) => line.replace(TRAILING_MARKS, "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim())
        .filter((line) => line.endsWith("?") && line.length <= 400 && USER_QUESTION.test(line));
}
/**
 * The answer stops for the user: the marker, or (without a letter) questions put to the user
 * before the work goes on. A model that asks which court, which claim or which variant
 * (a live case, 2026-11-20: three such questions without the marker) must not be overruled
 * by the correction rounds into a letter written on guesses.
 */
export function pausesForUser(answer, hasLetter) {
    if (waitsForUser(answer))
        return true;
    if (typeof answer !== "string" || hasLetter)
        return false;
    const questions = questionsToUser(answer);
    return questions.length >= 2 || (questions.length === 1 && QUESTION_INTRO.test(answer)) || (questions.length === 1 && /(?<![\p{L}])(?:chcesz|wolisz|potwierdź|ma\s+być|mają\s+być)(?![\p{L}])/u.test(questions[0]));
}
