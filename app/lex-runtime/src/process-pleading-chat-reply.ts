import {
  acceptProcessPleadingStart,
  confirmProcessCheckpoint,
  reopenProcessPleadingDraft,
  requestProcessCheckpointRevision,
  validateProcessPleadingState,
  type ProcessPleadingCheckpoint,
  type ProcessPleadingState
} from "./process-pleading-state.js";

// Replies typed in the chat that move the pleading pipeline as pisma-procesowe-v3 asks for them
// (AUTOMAT-STANOW, PROTOKÓŁ CHECKPOINT: 'Odpowiedz: "tak" / "ok" / lub uwagi'): "a" / "tak" to
// "INFORMACJA PRZED STARTEM", "tak" / "ok" to a checkpoint, remarks ("modyfikuj / porzuć ścieżkę
// X") — the step runs again with them. "Daj mi dokument" confirms the step like "ok" but does not
// skip the rest: ZAKAZ-CP (a message after every checkpoint, even after "rób wszystko
// automatycznie") and ZAKAZ-12 (.docx only after all checkpoints) stay; the answer says so.
// "Kontynuuj" / "dalej" are not a confirmation (REGUŁA-KONTYNUACJA).
export type PleadingChatReply = "ACCEPT" | "FINISH" | "REVISE";

const FINISH =
  /(?<![\p{L}])(?:daj(?:cie)?\s+(?:mi\s+)?(?:gotow\p{L}*\s+)?(?:dokument|plik|pismo|docx)|(?:przygotuj|wygeneruj|zrób|zrob|napisz)\s+(?:od\s+razu|teraz|już|gotow\p{L}*)\s+(?:dokument|plik|pismo|docx|\.docx)|dokończ\p{L}*|do\s+końca|bez\s+(?:zatrzymywania|zatrzymań|przystanków|potwierdz\p{L}*|pytania|pytań)|resztę\s+(?:etapów\s+|kroków\s+)?(?:automatycznie|w\s+jednym|naraz|od\s+razu))(?![\p{L}])/iu;
const ACCEPT =
  /^(?:a\)?|ad\s*a|tak|ok|okej|okay|dobrze|zgoda|jasne|akceptuj\p{L}*|zatwierdzam|potwierdzam|zatwierdź|trzymaj\s+to|ok\s+trzymaj\s+to)(?:[\s,.!:;—–-]+(?:tak|ok|akceptuj\p{L}*|zatwierdzam|potwierdzam|wczytaj\s+checklist\p{L}*(?:\s+i\s+rozpocznij)?|rozpocznij|zaczynaj|proszę|trzymaj\s+to))*[\s.!]*$/iu;
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
export function bareRefusal(message: string): boolean {
  return /^nie(?![\p{L}])[\s.!]*$/iu.test(message.trim());
}

export function pleadingChatReply(message: string): PleadingChatReply | null {
  const text = message.trim();
  if (!text || text.length > 300) return null;
  if (CHOICE.test(text) || REFUSAL_WITH_REASON.test(text)) return "REVISE";
  const finish = FINISH.test(text);
  const withoutFinish = text.replace(FINISH, " ");
  if (REVISE.test(withoutFinish) && !/\?\s*$/u.test(text)) return "REVISE";
  if (CHANGE.test(withoutFinish)) return null;
  if (finish) return "FINISH";
  // The chat's button for option a) sends its whole text ("a) Akceptuję pismo jako DRAFT …").
  if (/^a\)\s/iu.test(text) && /(?<![\p{L}])(?:tak|akceptuj\p{L}*|zatwierdzam|potwierdzam)(?![\p{L}])/iu.test(text)) return "ACCEPT";
  return ACCEPT.test(text) ? "ACCEPT" : null;
}

export type PleadingChatReplyResult = {
  state: ProcessPleadingState;
  note: string | null;
  // The step sent back with the reply as its remarks (stored with the draft for its next run).
  revision?: { checkpoint: ProcessPleadingCheckpoint; remarks: string };
};

// pisma-procesowe-v3 §7.2: a change of facts after the draft runs the attack on the draft and W3
// again. The user asks for it ("ponów atak"), or confirms the step whose frame proposes it
// ("➡️ Kontynuować (ponowienie CP-ATAK → W3.1)?" + "tak"); before, the app went on to W3.
const REOPEN_REQUEST =
  /(?<![\p{L}])(?:ponów|powtórz|wróć\s+do|otwórz\s+ponownie)\p{L}*\s+(?:etap\s+)?(?:CP-ATAK|atak\p{L}*|ATAK-NA-DRAFT)/iu;
const REOPEN_PROPOSED =
  /(?:ponowi\p{L}*|powtórz\p{L}*|ponown\p{L}*)\s+(?:\p{L}+\s+){0,2}(?:\[?CP-ATAK|ATAK-NA-DRAFT)|(?:CP-ATAK|ATAK-NA-DRAFT)\]?\s*\(?\s*do\s+ponowienia/iu;
const ASSISTANT_TURN = "\n\nAsystent: ";

export function reopensDraft(message: string): boolean {
  return REOPEN_REQUEST.test(message);
}

/** The assistant's last answer in the web's history ("Asystent: …"), or "". */
export function lastAssistantTurn(query: string): string {
  const at = query.lastIndexOf(ASSISTANT_TURN);
  if (at < 0) return "";
  const text = query.slice(at + ASSISTANT_TURN.length);
  const end = text.indexOf(USER_TURN);
  return end >= 0 ? text.slice(0, end) : text;
}

/** The state after the reply, and a line for the answer saying what the reply did. */
export function applyPleadingChatReply(
  input: ProcessPleadingState,
  message: string,
  at = new Date().toISOString(),
  previousAnswer = ""
): PleadingChatReplyResult {
  let state = validateProcessPleadingState(input);
  const reply = pleadingChatReply(message);
  const attackDone = state.checkpoints["CP-ATAK"] === "CLOSED" || state.checkpoints["CP-ATAK"] === "NA";
  // The proposal is the frame's own prompt: the last lines of the previous answer.
  const proposed = reply === "ACCEPT" && REOPEN_PROPOSED.test(previousAnswer.slice(-1500));
  if (attackDone && ["W3", "FINAL"].includes(state.stage) && (REOPEN_REQUEST.test(message) || proposed)) {
    const done: string[] = [];
    if (proposed && state.pendingCheckpoint && state.mode === "CHECKPOINT") {
      done.push(`etap ${state.pendingCheckpoint} potwierdzony`);
      state = confirmProcessCheckpoint(state, state.pendingCheckpoint, at);
    }
    state = reopenProcessPleadingDraft(state, `ponowienie ataku na projekt po zmianie faktów (§7.2): ${message.trim().slice(0, 200)}`, at);
    done.push("projekt wraca do W2: CP-ATAK, CP-QUALITY, CP-AUDYT i CP-PEER wykonuję ponownie (pisma-procesowe-v3 §7.2)");
    return { state, note: `Twoja odpowiedź: ${done.join("; ")}.` };
  }
  if (!reply || state.stage === "FINAL") return { state, note: null };
  const done: string[] = [];
  // Only an answer to the question the pipeline asked moves it: "INFORMACJA PRZED STARTEM" (a/b)
  // or a step waiting for confirmation. "Przygotuj pismo" at the start is the request itself.
  if (reply === "REVISE") {
    if (!state.pendingCheckpoint || state.mode !== "CHECKPOINT") return { state, note: null };
    const checkpoint = state.pendingCheckpoint;
    return {
      state: requestProcessCheckpointRevision(state, checkpoint, at),
      note: `Twoja odpowiedź: etap ${checkpoint} wykonuję ponownie ${CHOICE.test(message.trim()) ? `z Twoim wyborem «${message.trim().slice(0, 80)}»` : "z Twoimi uwagami"}.`,
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
  if (reply === "FINISH" && state.stage !== "FINAL") {
    const open = (Object.entries(state.checkpoints) as [ProcessPleadingCheckpoint, string][])
      .filter(([, status]) => status === "OPEN")
      .map(([checkpoint]) => checkpoint);
    done.push(
      `plik .docx powstanie dopiero po zamknięciu wszystkich etapów z Twoim potwierdzeniem (pisma-procesowe-v3: ZAKAZ-CP, ZAKAZ-12)` +
        (open.length ? `; zostało ${open.length}: ${open.join(", ")}` : "") +
        `; projekt pisma po etapie W2 możesz pobrać wcześniej jako DRAFT — NIEZWERYFIKOWANY (INFORMACJA WARUNKOWA)`
    );
  }
  if (!done.length) return { state, note: null };
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
export function pleadingContinuationQuery(query: string, reply: string): string {
  const turn = `${PLEADING_CONTINUATION} Odpowiedź użytkownika na poprzedni etap: «${reply.trim()}»`;
  const at = query.lastIndexOf(USER_TURN);
  if (at >= 0) return query.slice(0, at + USER_TURN.length) + turn;
  const envelope = /^__LEX_SKILLS_V1__ [^\n]*\n/u.exec(query)?.[0] ?? "";
  return envelope + turn;
}
