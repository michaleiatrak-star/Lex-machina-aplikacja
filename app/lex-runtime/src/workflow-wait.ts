// Checkpoint workflows go on to the next step by themselves (the chat sends it). A step
// that needs the user's answer (missing data, a choice) says so with this line, and the
// chain stops there until the user replies.
export const WAIT_FOR_USER_MARKER = "[CZEKAM NA ODPOWIEDŹ]";

export const WAIT_FOR_USER_INSTRUCTION =
  `Po tym punkcie aplikacja sama uruchomi następny. Jeśli do wykonania tego punktu potrzebna jest odpowiedź użytkownika (brakujące dane, wybór wariantu), zadaj pytania i zakończ odpowiedź osobną linią ${WAIT_FOR_USER_MARKER}; bez tej linii nie pytaj użytkownika o zgodę na dalsze kroki.`;

export function waitsForUser(answer: string | undefined | null): boolean {
  return typeof answer === "string" && answer.includes(WAIT_FOR_USER_MARKER);
}

// Process pleading in CHECKPOINT mode: the user confirms every step, but a step that cannot
// be done without missing data is not closed (the runtime keeps the checkpoint open).
export const WAIT_FOR_USER_CHECKPOINT_INSTRUCTION =
  `Jeśli do wykonania tego punktu potrzebna jest odpowiedź użytkownika (brakujące dane, wybór wariantu), zadaj pytania i zakończ odpowiedź osobną linią ${WAIT_FOR_USER_MARKER}; punkt pozostanie otwarty do odpowiedzi.`;
