import type { ProcessPleadingCheckpoint, ProcessPleadingStage } from "./process-pleading-state.js";

// The pleading text of a case's process pipeline, kept in the encrypted workspace
// between stages: written by the pipeline (W2 draft, W3 final text) or by the user
// (own correction). The next stage, the .docx file and the lawyer work on the
// newest version instead of whatever part of the chat still fits the context.

export type ProcessPleadingDraftVersion = {
  version: number;
  text: string;
  source: "PIPELINE" | "USER";
  stage: ProcessPleadingStage;
  checkpoint?: ProcessPleadingCheckpoint;
  // USER: a minor correction keeps the closed checks, a substantive one reopens them.
  change?: "MINOR" | "SUBSTANTIVE";
  createdAt: string;
};

export type ProcessPleadingDraft = {
  schemaVersion: 1;
  caseId: string;
  revision: number;
  versions: ProcessPleadingDraftVersion[];
  // The user's remarks to a checkpoint sent back for correction (used by its next run).
  remarks?: { checkpoint: ProcessPleadingCheckpoint; text: string; at: string };
};

export const DRAFT_VERSIONS_MAX = 20;
export const DRAFT_TEXT_MAX = 400_000;
export const REMARKS_MAX = 4_000;

// The pipeline writes the full current pleading between these lines (W2, W3).
export const PLEADING_START = "=== PISMO ===";
export const PLEADING_END = "=== KONIEC PISMA ===";

const CASE_ID = /^case_[a-f0-9]{32}$/;

function cleanText(text: string, max: number): string {
  const clean = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  if (!clean || clean.length > max) throw new Error("PROCESS_PLEADING_DRAFT_TEXT_INVALID");
  return clean;
}

export function emptyProcessPleadingDraft(caseId: string): ProcessPleadingDraft {
  if (!CASE_ID.test(caseId)) throw new Error("PROCESS_PLEADING_DRAFT_INVALID");
  return { schemaVersion: 1, caseId, revision: 0, versions: [] };
}

export function validateProcessPleadingDraft(input: ProcessPleadingDraft): ProcessPleadingDraft {
  if (
    !input ||
    input.schemaVersion !== 1 ||
    !CASE_ID.test(input.caseId) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0 ||
    !Array.isArray(input.versions) ||
    input.versions.length > DRAFT_VERSIONS_MAX
  ) {
    throw new Error("PROCESS_PLEADING_DRAFT_INVALID");
  }
  let previous = 0;
  for (const item of input.versions) {
    if (
      !Number.isSafeInteger(item.version) ||
      item.version <= previous ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      item.text.length > DRAFT_TEXT_MAX ||
      !["PIPELINE", "USER"].includes(item.source) ||
      (item.change !== undefined && !["MINOR", "SUBSTANTIVE"].includes(item.change)) ||
      typeof item.createdAt !== "string"
    ) {
      throw new Error("PROCESS_PLEADING_DRAFT_INVALID");
    }
    previous = item.version;
  }
  if (input.remarks && (typeof input.remarks.text !== "string" || input.remarks.text.length > REMARKS_MAX)) {
    throw new Error("PROCESS_PLEADING_DRAFT_INVALID");
  }
  return structuredClone(input);
}

export function latestDraftVersion(draft: ProcessPleadingDraft | null | undefined): ProcessPleadingDraftVersion | null {
  return draft?.versions.at(-1) ?? null;
}

export function appendDraftVersion(
  input: ProcessPleadingDraft,
  version: Omit<ProcessPleadingDraftVersion, "version" | "createdAt" | "text"> & { text: string },
  at = new Date().toISOString()
): ProcessPleadingDraft {
  const draft = validateProcessPleadingDraft(input);
  const text = cleanText(version.text, DRAFT_TEXT_MAX);
  const latest = draft.versions.at(-1);
  // The same text again (a repeated W3 step) is not a new version.
  if (latest && latest.text === text) return draft;
  draft.versions.push({
    ...version,
    text,
    version: (latest?.version ?? 0) + 1,
    createdAt: at
  });
  draft.versions = draft.versions.slice(-DRAFT_VERSIONS_MAX);
  draft.revision += 1;
  return draft;
}

export function withDraftRemarks(
  input: ProcessPleadingDraft,
  checkpoint: ProcessPleadingCheckpoint,
  text: string,
  at = new Date().toISOString()
): ProcessPleadingDraft {
  const draft = validateProcessPleadingDraft(input);
  draft.remarks = { checkpoint, text: cleanText(text, REMARKS_MAX), at };
  draft.revision += 1;
  return draft;
}

export function withoutDraftRemarks(input: ProcessPleadingDraft): ProcessPleadingDraft {
  const draft = validateProcessPleadingDraft(input);
  if (!draft.remarks) return draft;
  delete draft.remarks;
  draft.revision += 1;
  return draft;
}

/** The pleading between the markers of an answer; the last block when there are several. */
export function extractPleadingText(answer: string): string | null {
  const start = answer.lastIndexOf(PLEADING_START);
  if (start < 0) return null;
  const end = answer.indexOf(PLEADING_END, start + PLEADING_START.length);
  if (end < 0) return null;
  const text = answer.slice(start + PLEADING_START.length, end).trim();
  return text.length >= 40 ? text : null;
}

/** Checkpoints whose run writes or revises the pleading text itself. */
export function writesPleading(checkpoint: ProcessPleadingCheckpoint): boolean {
  return ["CP-ATAK", "CP-PODMIOT", "CP-QUALITY", "CP-AUDYT", "CP-PEER"].includes(checkpoint);
}

// Instructions for the model on a checkpoint: where the pleading goes, which version
// it works on, and the user's remarks when the step was sent back.
export function draftPrompt(args: {
  checkpoint: ProcessPleadingCheckpoint;
  draft: ProcessPleadingDraftVersion | null;
  remarks?: string | null;
}): string {
  const parts: string[] = [];
  if (writesPleading(args.checkpoint)) {
    parts.push(
      "# TEKST PISMA — FORMAT (aplikacja)",
      `Pełny, aktualny tekst pisma (po zmianach tego kroku) umieść w odpowiedzi między liniami \`${PLEADING_START}\` i \`${PLEADING_END}\`, każda w osobnej linii. Raporty, rejestry i uwagi dla prawnika — poza tym blokiem. Aplikacja zapisuje ten blok jako kolejną wersję projektu w sprawie; z niego powstaje plik .docx.`
    );
  }
  if (args.draft) {
    parts.push(
      `# AKTUALNY PROJEKT PISMA — wersja ${args.draft.version} (${args.draft.source === "USER" ? "poprawiony przez użytkownika — jego zmiany są wiążące, nie cofaj ich" : `z pipeline'u, etap ${args.draft.stage}`})`,
      "Pracuj na tym tekście; nie odtwarzaj pisma z wcześniejszej części rozmowy.",
      args.draft.text
    );
  }
  if (args.remarks) {
    parts.push(
      `# UWAGI UŻYTKOWNIKA DO KROKU ${args.checkpoint} (krok odesłany do poprawy)`,
      "Wykonaj ten krok ponownie z uwzględnieniem uwag; wskaż, co zmieniono.",
      args.remarks
    );
  }
  return parts.join("\n\n");
}
