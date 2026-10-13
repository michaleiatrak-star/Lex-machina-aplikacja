// A workflow checkpoint that needs the user's answer (missing facts, a decision, a choice
// of variant) says so with one fixed line. Without it the application may go on to the
// next checkpoint by itself (AUTO pleading loop, automatic continuation in the chat).

export const WAITING_FOR_USER_MARKER = "=== CZEKAM NA ODPOWIEDŹ ===";

export const WAITING_FOR_USER_RULE =
  `Gdy ten krok wymaga odpowiedzi użytkownika (brak danych, decyzja, wybór wariantu), zadaj pytania i zakończ odpowiedź osobną linią \`${WAITING_FOR_USER_MARKER}\`; krok pozostaje otwarty do odpowiedzi. ` +
  "Bez tej linii aplikacja może sama przejść do następnego kroku, więc nie używaj jej, gdy krok jest wykonany.";

const MARKER_LINE = /^[ \t>*_`]*=== CZEKAM NA ODPOWIEDŹ ===[ \t*_`]*$/mu;

export function waitsForUser(answer: string | null | undefined): boolean {
  return typeof answer === "string" && MARKER_LINE.test(answer);
}

/** The answer without the marker line (the user sees the questions, not the signal). */
export function withoutWaitingMarker(answer: string): string {
  return answer.replace(new RegExp(MARKER_LINE.source, "gmu"), "").replace(/\n{3,}/g, "\n\n").trim();
}
