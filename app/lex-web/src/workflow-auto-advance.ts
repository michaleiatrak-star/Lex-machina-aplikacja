import type { SessionExecutionResponse } from "./api.js";

// Checkpoint workflows (contract analysis, court analysis, chronology, evidence,
// witness questioning, process pleading in AUTO mode) go on to the next step by
// themselves: after a closed step the chat sends the next one, named in the thread.
// The chain stops on a blocked or empty answer, a step without progress, a step that
// asks the user (WAIT_FOR_USER_MARKER), the end of the workflow or the user's "Zatrzymaj".

export const WAIT_FOR_USER_MARKER = "[CZEKAM NA ODPOWIEDŹ]";
export const AUTO_ADVANCE_MAX_STEPS = 24;
// What the chat sends: the same as a user's "Kontynuuj" (the server takes the step from
// the case's saved state); the step's name goes to the message's description.
export const AUTO_ADVANCE_MESSAGE = "Kontynuuj.";

const STEP_LABELS: Record<string, string> = {
  "AU-F0": "Intake: tryb, dokument i cel",
  "AU-GAP": "Braki danych (INTAKE-GAP)",
  "AU-POV": "Weryfikacja podmiotów umowy",
  "AU-ROUTE": "Wybór modułu dla typu umowy",
  "AU-A": "Moduł A: identyfikacja dokumentu",
  "AU-B": "Moduł B: analiza klauzul",
  "AU-C": "Moduł C: zgodność z prawem",
  "AU-D": "Moduł D: balans umowy",
  "AU-F": "Moduł F: raport końcowy",
  "AU-GENCORE": "Generowanie: rdzeń i tryb redakcji",
  "AU-GENBUILD": "Generowanie: treść dokumentu",
  "AU-GENSHARED": "Generowanie: moduły dodatkowe",
  "AU-HYBRID": "Walidacja hybrydowa",
  "AU-STRIP": "Usunięcie znaczników weryfikacji",
  "AU-POST": "Kontrola końcowa",
  "AU-DISC": "Zastrzeżenie i rejestr kroków",
  SD_VER_COMPLETE: "Skan kompletności akt",
  PASS_I_ISOLATION_CLEAN: "Przejście I: mapa faktów",
  PASS_II_SOURCES_VERIFIED: "Przejście II: kwalifikacja prawna",
  FIRST_VERIFICATION_COMPLETE: "Przejście III: analiza adversarialna",
  FINAL_VERIFICATION_COMPLETE: "Przejście IV: autokorekta i weryfikacja",
  FINAL_GATE_APPROVED: "Bramka przed raportem",
  FINAL_REPORT_PRESENTED: "Raport końcowy",
  SITUATIONAL_REPORT_PRESENTED: "Raport sytuacyjny",
  PROCESS_PLEADING_OFFER_PRESENTED: "Propozycja pisma procesowego",
  DOCUMENT_INVENTORY_COMPLETE: "Inwentaryzacja dokumentów",
  THREAD_IDENTIFICATION_COMPLETE: "Wątki prawne",
  EVENT_EXTRACTION_COMPLETE: "Ekstrakcja zdarzeń",
  TEMPORAL_GATE_COMPLETE: "Bramka czasowa (OŚ-GATE)",
  CONTRADICTION_INDEX_COMPLETE: "Indeks sprzeczności",
  CHRONOLOGY_REPORT_COMPLETE: "Raport chronologiczny"
};

export function stepLabel(checkpoint: string): string {
  const label = STEP_LABELS[checkpoint];
  return label ? `${checkpoint} — ${label}` : checkpoint;
}

export type WorkflowProgress = {
  workflow: string;
  closed: number;
  next: string | null;
  // The server already runs several steps per request (process pleading AUTO).
  serverBatch?: boolean;
};

/** Where the turn's checkpoint workflow stands, or null for a turn without one. */
export function workflowProgress(result: SessionExecutionResponse): WorkflowProgress | null {
  // A long letter in parts: each part that passed its check is a closed step.
  if (result.longDocument?.id) {
    const long = result.longDocument;
    return { workflow: `Długie pismo „${long.title}”`, closed: long.ok ? long.part : long.part - 1, next: long.next ? `część ${long.next} z ${long.parts}` : null };
  }
  if (result.contractWorkflow) {
    return { workflow: "Analiza umowy", closed: result.contractWorkflow.closedCheckpoints.length, next: result.contractWorkflow.nextCheckpoint };
  }
  if (result.courtWorkflow) {
    return { workflow: "Analiza sądowa", closed: result.courtWorkflow.closedCheckpoints.length, next: result.courtWorkflow.nextCheckpoint };
  }
  if (result.chronologyWorkflow) {
    return { workflow: "Chronologia", closed: result.chronologyWorkflow.closedCheckpoints.length, next: result.chronologyWorkflow.nextCheckpoint };
  }
  if (result.orderedCaseWorkflow) {
    return {
      workflow: result.orderedCaseWorkflow.workflowId === "WITNESS_QUESTIONING_V1" ? "Przesłuchanie świadka" : "Analiza dowodów",
      closed: result.orderedCaseWorkflow.closedCheckpoints.length,
      next: result.orderedCaseWorkflow.nextCheckpoint
    };
  }
  if (result.processWorkflow && result.processWorkflow.mode === "AUTO") {
    const closed = Object.values(result.processWorkflow.checkpoints).filter((status) => status === "CLOSED" || status === "NA").length;
    const next =
      result.processWorkflow.stage === "FINAL" || result.processWorkflow.pendingCheckpoint
        ? null
        : (Object.entries(result.processWorkflow.checkpoints).find(([, status]) => status === "OPEN")?.[0] ?? null);
    return { workflow: "Pismo procesowe", closed, next, serverBatch: true };
  }
  return null;
}

export type AutoAdvanceDecision =
  | { advance: true; next: string; label: string; message: string; meta: string }
  | { advance: false; reason: "NO_WORKFLOW" | "COMPLETE" | "BLOCKED" | "NO_PROGRESS" | "WAITING_FOR_USER" | "LIMIT" };

/**
 * Whether the chat sends the next step by itself. `closedBefore` is the number of
 * closed steps before this turn (null for the first turn of a chain).
 */
export function autoAdvanceDecision(
  result: SessionExecutionResponse,
  closedBefore: number | null,
  stepsSoFar: number,
  // The meta of the message that asked for this turn (an automatic repair of a part).
  askedMeta?: string
): AutoAdvanceDecision {
  const progress = workflowProgress(result);
  if (!progress) return { advance: false, reason: "NO_WORKFLOW" };
  if (result.status !== "DRAFT_PRESENTABLE" || !result.answer?.trim()) return { advance: false, reason: "BLOCKED" };
  // A long letter: the next part after one that passed; a rejected part is written again once
  // with its problems, a second rejection waits for the user.
  const long = result.longDocument;
  if (long?.id) {
    if (!long.next) return { advance: false, reason: "COMPLETE" };
    if (stepsSoFar >= AUTO_ADVANCE_MAX_STEPS) return { advance: false, reason: "LIMIT" };
    const label = `część ${long.next} z ${long.parts}`;
    if (long.ok) return { advance: true, next: label, label, message: `Kontynuuj: napisz część ${long.next} z ${long.parts}.`, meta: `automatycznie · ${progress.workflow} · ${label}` };
    if (askedMeta?.endsWith(`poprawa: ${label}`)) return { advance: false, reason: "NO_PROGRESS" };
    return { advance: true, next: label, label, message: `Popraw część ${long.next} z ${long.parts}.`, meta: `automatycznie · ${progress.workflow} · poprawa: ${label}` };
  }
  if (result.answer.includes(WAIT_FOR_USER_MARKER) || result.processAuto?.stopped === "WAITING_FOR_USER") {
    return { advance: false, reason: "WAITING_FOR_USER" };
  }
  if (!progress.next) return { advance: false, reason: "COMPLETE" };
  if (progress.serverBatch && result.processAuto?.stopped !== "LIMIT_REACHED") return { advance: false, reason: "BLOCKED" };
  if (closedBefore !== null ? progress.closed <= closedBefore : progress.closed === 0) return { advance: false, reason: "NO_PROGRESS" };
  if (stepsSoFar >= AUTO_ADVANCE_MAX_STEPS) return { advance: false, reason: "LIMIT" };
  const label = stepLabel(progress.next);
  return { advance: true, next: progress.next, label, message: AUTO_ADVANCE_MESSAGE, meta: `automatycznie · ${progress.workflow} · krok ${label}` };
}

/** One line for the thread: what was done, and what comes next or why the chain stopped. */
export function autoAdvanceNote(result: SessionExecutionResponse, decision: AutoAdvanceDecision): string | null {
  const progress = workflowProgress(result);
  if (!progress) return null;
  const long = result.longDocument?.id ? result.longDocument : null;
  if (long) {
    const problems = long.ok ? "" : ` Część ${long.part} odrzucona przez walidację: ${long.problems.join("; ")}.`;
    if (decision.advance) return `${progress.workflow}: część ${long.part} z ${long.parts} ${long.ok ? "sprawdzona i zapisana" : "do poprawy"}.${problems} Następnie: ${decision.label} — uruchamiam automatycznie.`;
    if (decision.reason === "COMPLETE") return `${progress.workflow}: wszystkie ${long.parts} części sprawdzone i zapisane. Plik powstaje z całości.`;
    if (decision.reason === "NO_PROGRESS") return `${progress.workflow}:${problems} Poprawa nie pomogła: popraw część ręcznie albo napisz „Popraw część ${long.part} z ${long.parts}”.`;
  }
  if (decision.advance) return `${progress.workflow}: zamknięte kroki ${progress.closed}. Następny krok: ${decision.label} — uruchamiam automatycznie.`;
  switch (decision.reason) {
    case "WAITING_FOR_USER":
      return `${progress.workflow}: krok czeka na Twoją odpowiedź.${progress.next ? ` Następny krok po odpowiedzi: ${stepLabel(progress.next)}.` : ""}`;
    case "COMPLETE":
      return `${progress.workflow}: wszystkie kroki zakończone (${progress.closed}).`;
    case "NO_PROGRESS":
      return `${progress.workflow}: krok nie został zamknięty, automatyczne przejście zatrzymane.${progress.next ? ` Aktualny krok: ${stepLabel(progress.next)}.` : ""}`;
    case "LIMIT":
      return `${progress.workflow}: wykonano ${AUTO_ADVANCE_MAX_STEPS} kroków z rzędu. Napisz „Kontynuuj”, aby iść dalej.`;
    case "BLOCKED":
      return progress.next ? `${progress.workflow}: automatyczne przejście zatrzymane. Aktualny krok: ${stepLabel(progress.next)}.` : null;
    default:
      return null;
  }
}
