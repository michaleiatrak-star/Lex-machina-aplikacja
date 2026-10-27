import {
  acceptProcessPleadingStart,
  confirmProcessCheckpoint,
  requestProcessCheckpointRevision,
  switchProcessPleadingToAuto,
  validateProcessPleadingState,
  type ProcessPleadingCheckpoint,
  type ProcessPleadingState
} from "./process-pleading-state.js";

// Replies typed in the chat that move the pleading pipeline as in the chat with the skill
// (pisma-procesowe-v3): "a" / "tak" to "INFORMACJA PRZED STARTEM", "tak" / "ok" to a
// checkpoint, "daj mi dokument" — confirm and run the rest without stops, and a change of the
// step's result ("modyfikuj / porzuć ścieżkę X") — the step runs again with the reply as remarks.
export type PleadingChatReply = "ACCEPT" | "FINISH" | "REVISE";

const FINISH =
  /(?<![\p{L}])(?:daj(?:cie)?\s+(?:mi\s+)?(?:gotow\p{L}*\s+)?(?:dokument|plik|pismo|docx)|(?:przygotuj|wygeneruj|zrób|zrob|napisz)\s+(?:od\s+razu|teraz|już|gotow\p{L}*)\s+(?:dokument|plik|pismo|docx|\.docx)|dokończ\p{L}*|do\s+końca|bez\s+(?:zatrzymywania|zatrzymań|przystanków|potwierdz\p{L}*|pytania|pytań)|resztę\s+(?:etapów\s+|kroków\s+)?(?:automatycznie|w\s+jednym|naraz|od\s+razu))(?![\p{L}])/iu;
const ACCEPT =
  /^(?:a\)?|ad\s*a|tak|ok|okej|okay|dobrze|zgoda|jasne|akceptuj\p{L}*|zatwierdzam|potwierdzam|kontynuuj\p{L}*|dalej|zatwierdź|trzymaj\s+to|ok\s+trzymaj\s+to)(?:[\s,.!:;—–-]+(?:tak|ok|akceptuj\p{L}*|zatwierdzam|potwierdzam|kontynuuj\p{L}*|dalej|wczytaj\s+checklist\p{L}*(?:\s+i\s+rozpocznij)?|rozpocznij|zaczynaj|proszę|trzymaj\s+to))*[\s.!]*$/iu;
// A reply that changes the result is not a confirmation ("nie", "popraw", "porzuć ścieżkę D");
// with what to change (REVISE) it sends the step back with remarks.
const REVISE = /(?<![\p{L}])(?:popraw\p{L}*|zmie[nń]\p{L}*|modyfik\p{L}*|porzu\p{L}*|usuń|dodaj|uzupełnij\p{L}*)(?![\p{L}])/iu;
const CHANGE = /(?<![\p{L}])(?:nie|popraw\p{L}*|zmie[nń]\p{L}*|modyfik\p{L}*|porzu\p{L}*|usuń|dodaj|uzupełnij\p{L}*|wstrzymaj|zatrzymaj|stop)(?![\p{L}])/iu;

export function pleadingChatReply(message: string): PleadingChatReply | null {
  const text = message.trim();
  if (!text || text.length > 300) return null;
  const finish = FINISH.test(text);
  const withoutFinish = text.replace(FINISH, " ");
  if (REVISE.test(withoutFinish) && !/\?\s*$/u.test(text)) return "REVISE";
  if (CHANGE.test(withoutFinish)) return null;
  if (finish) return "FINISH";
  return ACCEPT.test(text) ? "ACCEPT" : null;
}

export type PleadingChatReplyResult = {
  state: ProcessPleadingState;
  note: string | null;
  // The step sent back with the reply as its remarks (stored with the draft for its next run).
  revision?: { checkpoint: ProcessPleadingCheckpoint; remarks: string };
};

/** The state after the reply, and a line for the answer saying what the reply did. */
export function applyPleadingChatReply(
  input: ProcessPleadingState,
  message: string,
  at = new Date().toISOString()
): PleadingChatReplyResult {
  let state = validateProcessPleadingState(input);
  const reply = pleadingChatReply(message);
  if (!reply || state.stage === "FINAL") return { state, note: null };
  const done: string[] = [];
  // Only an answer to the question the pipeline asked moves it: "INFORMACJA PRZED STARTEM" (a/b)
  // or a step waiting for confirmation. "Przygotuj pismo" at the start is the request itself.
  if (reply === "REVISE") {
    if (!state.pendingCheckpoint || state.mode !== "CHECKPOINT") return { state, note: null };
    const checkpoint = state.pendingCheckpoint;
    return {
      state: requestProcessCheckpointRevision(state, checkpoint, at),
      note: `Twoja odpowiedź: etap ${checkpoint} wykonuję ponownie z Twoimi uwagami.`,
      revision: { checkpoint, remarks: message.trim() }
    };
  }
  if (state.stage === "CG_ACCEPTANCE") {
    if (reply !== "ACCEPT") return { state, note: null };
    state = acceptProcessPleadingStart(state, at);
    done.push("start pisma zaakceptowany");
  }
  else if (state.pendingCheckpoint && state.mode === "CHECKPOINT") {
    const checkpoint = state.pendingCheckpoint;
    state = confirmProcessCheckpoint(state, checkpoint, at);
    done.push(`etap ${checkpoint} potwierdzony`);
  } else return { state, note: null };
  if (reply === "FINISH" && state.mode === "CHECKPOINT" && state.stage !== "FINAL") {
    state = switchProcessPleadingToAuto(state, "Odpowiedź w czacie: dokończ pismo bez zatrzymywania po etapach.", at);
    done.push("pozostałe etapy przebiegną automatycznie, bez zatrzymywania; plik .docx powstanie po kontroli końcowej");
  }
  if (!done.length) return { state, note: null };
  return { state, note: `Twoja odpowiedź: ${done.join("; ")}.` };
}
