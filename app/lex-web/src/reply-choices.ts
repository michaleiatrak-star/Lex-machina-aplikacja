// Choices the assistant's answer asks the user to make (pisma-procesowe-v3 and other skills):
// lettered options ("a) Tak, akceptuję… / b) Nie…" in INFORMACJA PRZED STARTEM, INFORMACJA
// WARUNKOWA, FSL-D) and the checkpoint frame ('Odpowiedz: "tak" / "ok" / lub uwagi',
// '"tak" / modyfikuj / porzuć ścieżkę X'). The chat shows them as buttons under the answer.

export type ReplyChoice =
  // Sent as the user's message ("a) Tak, akceptuję…", "tak").
  | { kind: "SEND"; label: string; message: string }
  // Puts the start of a reply into the message box; nothing is sent.
  | { kind: "DRAFT"; label: string; draft: string };

const FRAME = /[│┃|┌┐└┘├┤─━═╔╗╚╝║]+/gu;
const LETTERED = /^([a-fA-F])\)\s+(.{2,160})$/u;
const CHECKPOINT_PROMPT =
  /(?:Odpowiedz:\s*|➡️[^\n]*\n?\s*)["„“]tak["”"](?:\s*\/\s*(?:["„“]ok["”"]|modyfikuj|uwagi|lub uwagi|porzuć[^\n/]*))*/iu;

function cleanLine(line: string): string {
  return line.replace(FRAME, " ").replace(/\s+/g, " ").trim();
}

/** The choices at the end of an answer; empty when it asks for none. */
export function replyChoices(answer: string): ReplyChoice[] {
  const lines = answer.split("\n").slice(-40).map(cleanLine);
  // The last run of options a), b), c)… in order (blank lines between them allowed).
  let run: Array<{ letter: string; label: string }> = [];
  let best: typeof run = [];
  for (const line of lines) {
    if (!line) continue;
    const match = LETTERED.exec(line);
    if (match) {
      const letter = match[1]!.toLowerCase();
      const expected = String.fromCharCode("a".charCodeAt(0) + run.length);
      if (letter === expected) run.push({ letter, label: match[2]!.trim() });
      else if (letter === "a") run = [{ letter, label: match[2]!.trim() }];
      else run = [];
    } else if (run.length) {
      if (run.length >= 2) best = run;
      run = [];
    }
  }
  if (run.length >= 2) best = run;
  if (best.length >= 2) {
    return best.map(({ letter, label }) => ({ kind: "SEND", label: `${letter}) ${label}`, message: `${letter}) ${label}` }));
  }
  const tail = lines.slice(-15).join("\n");
  // A checkpoint frame ending in a question without the literal "tak" ("➡️ Zatwierdzasz układ…?").
  const framed = /CHECKPOINT/u.test(tail) && /➡️[^\n]*\?/u.test(tail) ? "➡️ ?" : undefined;
  const prompt = CHECKPOINT_PROMPT.exec(tail)?.[0] ?? framed;
  if (prompt) {
    const choices: ReplyChoice[] = [{ kind: "SEND", label: "Tak", message: "tak" }];
    const change = /porzuć/iu.test(prompt) ? "Modyfikuj / porzuć ścieżkę…" : "Uwagi…";
    choices.push({ kind: "DRAFT", label: change, draft: /porzuć/iu.test(prompt) ? "Modyfikuj: " : "Uwagi: " });
    return choices;
  }
  return [];
}
