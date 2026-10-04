import fs from "node:fs";
import type { LexSkillRegistry } from "./registry.js";
import type { ProcessPleadingCheckpoint } from "./process-pleading-state.js";

/**
 * pisma-procesowe-v3, one checkpoint per turn: the files that checkpoint runs on
 * (CP-REJESTR of shared/CP-GATE.md and MODULY-MAPA.md) and what its report must
 * show (AUTOMAT-STANOW: ZAKAZ-1B, ZAKAZ-2, ZAKAZ-9; SD-GATE ST-FINAL).
 */
export const CHECKPOINT_RESOURCES: Readonly<Record<ProcessPleadingCheckpoint, readonly string[]>> = {
  "CP-1a": ["shared/CLAIM-VALIDATION.md"],
  "CP-1b": ["shared/MOD-STRATEGIA-WYBOR.md"],
  "CP-1c-skan": ["shared/MOD-SKAN-DOWODOW-KOMPLETNY.md"],
  "CP-PD": ["shared/MOD-PORCJOWANIE-DOWODOW.md"],
  "CP-FSL-D": ["shared/MOD-FSL-DOKUMENTY.md", "shared/FACT-SOURCE-LOCK.md"],
  "CP-1c-macierz": ["shared/MOD-MACIERZ-DOWOD-TEZA.md"],
  "CP-1c-lancuch": ["shared/MOD-LANCUCH-DOWODOWY.md"],
  "CP-1d-anomalie": ["shared/MOD-DOKUMENT-ANOMALIE_v1.1.0.md"],
  "CP-1d": ["shared/MOD-POSZLAKI-KONTEKST.md"],
  "CP-W1": ["pisma-procesowe-v3/references/W1-SZCZEGOLY.md"],
  "CP-PRE-W2": ["shared/PRE-W2-VERIFICATION-GATE.md"],
  "CP-ATAK": ["shared/MOD-ATAK-NA-DRAFT.md", "pisma-procesowe-v3/references/W2-SZCZEGOLY.md"],
  "CP-PODMIOT": ["pisma-procesowe-v3/references/W3-PODMIOT-GATE.md"],
  "CP-QUALITY": ["shared/LEGAL-QUALITY-GATE.md", "shared/MOD-WALIDACJA_v2.md", "pisma-procesowe-v3/references/W3-WERYFIKACJA.md"],
  "CP-AUDYT": ["shared/AUDYT-KONCOWY.md"],
  "CP-PEER": ["shared/MOD-PEER-REVIEW.md", "shared/POST-VALIDATION.md"]
};

// Conditional checkpoints (CP-REJESTR "warunkowy", "gdy ..."): N/A is allowed with a reason.
export const CONDITIONAL_CHECKPOINTS: ReadonlySet<ProcessPleadingCheckpoint> = new Set([
  "CP-1b",
  "CP-1c-skan",
  "CP-PD",
  "CP-FSL-D",
  "CP-1c-macierz",
  "CP-1c-lancuch",
  "CP-1d-anomalie",
  "CP-1d"
]);

// Names of the checkpoints in CP-REJESTR: the report header "✅ CHECKPOINT [nazwa]" may use them.
const CHECKPOINT_NAMES: Readonly<Record<ProcessPleadingCheckpoint, RegExp>> = {
  "CP-1a": /CLAIM-VALIDATION/iu,
  "CP-1b": /STRATEGIA-WYBOR/iu,
  "CP-1c-skan": /SD-VER|SKAN\s+(?:DOWODÓW|PLIKÓW)/iu,
  "CP-PD": /PORCJOWANIE/iu,
  "CP-FSL-D": /FSL-D|FACT-SOURCE-LOCK/iu,
  "CP-1c-macierz": /MACIERZ\s+D\s*[×x]\s*T|MACIERZ-DOWOD-TEZA/iu,
  "CP-1c-lancuch": /ŁAŃCUCH\s+DOWODOWY|LANCUCH-DOWODOWY/iu,
  "CP-1d-anomalie": /DOKUMENT-ANOMALIE/iu,
  "CP-1d": /POSZLAKI-KONTEKST/iu,
  "CP-W1": /RAPORT\s+W1/iu,
  "CP-PRE-W2": /PRE-W2-VERIFICATION-GATE|PRE-W2/iu,
  "CP-ATAK": /ATAK-NA-DRAFT/iu,
  "CP-PODMIOT": /PODMIOT-GATE/iu,
  "CP-QUALITY": /LEGAL-QUALITY-GATE/iu,
  "CP-AUDYT": /AUDYT-KOŃCOWY|AUDYT-KONCOWY|AUDYT\s+KOŃCOWY/iu,
  "CP-PEER": /PEER-REVIEW|PEER-OK/iu
};

export const CHECKPOINT_BUDGET_CHARS = 45_000;

/** The checkpoint's files that exist, loaded within the budget; the rest for the model to read. */
export function loadCheckpointResources(
  registry: LexSkillRegistry,
  checkpoint: ProcessPleadingCheckpoint,
  inContext: ReadonlySet<string>,
  budget = CHECKPOINT_BUDGET_CHARS
): { loaded: Array<{ resource: string; content: string }>; toRead: string[] } {
  const loaded: Array<{ resource: string; content: string }> = [];
  const toRead: string[] = [];
  let left = budget;
  for (const resource of CHECKPOINT_RESOURCES[checkpoint]) {
    if (inContext.has(resource)) continue;
    const file = registry.resolveResource("pisma-procesowe-v3", resource);
    let content = "";
    try {
      content = file ? fs.readFileSync(file, "utf8") : "";
    } catch {
      content = "";
    }
    if (!content.trim()) continue;
    if (content.length > left) {
      toRead.push(resource);
      continue;
    }
    left -= content.length;
    loaded.push({ resource, content });
  }
  return { loaded, toRead };
}

export type CheckpointRegisterEntry = { checkpoint: string; status: "CLOSED" | "NA" | "OPEN" | "PENDING_CONFIRMATION"; reason?: string };

const REQUIREMENTS: Partial<Record<ProcessPleadingCheckpoint, string[]>> = {
  "CP-PRE-W2": ["status bramki: GATE-OK, GATE-WARN albo GATE-STOP (GATE-STOP blokuje W2 do decyzji użytkownika — ZAKAZ-1B)"],
  "CP-ATAK": [
    "RAPORT D z W2.4 MOD-ATAK-NA-DRAFT (ZAKAZ-9)",
    "izolacja W2: żadnego pełnego oznaczenia Dz.U. i żadnej sygnatury orzeczenia — przepis jako ⚠️[art. X ustawa — WERYFIKACJA W3], orzeczenie jako [ORZECZENIE: opis → WERYFIKACJA W3] (ZAKAZ-2)"
  ],
  "CP-PEER": [
    "RAPORT W3 → STATUS PISMA → UWAGI REDAKCYJNE PRZED ZŁOŻENIEM → REJESTR KROKÓW (ST-FINAL)",
    "gdy w rejestrze jest krok ⚠️ POMINIĘTY albo ○ OCZEKUJE: STATUS PISMA = ⚠️ DRAFT — NIEZWERYFIKOWANY i blok INFORMACJA WARUNKOWA (ZAKAZ-14)"
  ]
};

export function checkpointPrompt(
  checkpoint: ProcessPleadingCheckpoint,
  resources: ReturnType<typeof loadCheckpointResources>,
  register?: CheckpointRegisterEntry[]
): string {
  return [
    `# CHECKPOINT ${checkpoint} — KONTRAKT (CP-REJESTR, shared/CP-GATE.md; AUTOMAT-STANOW)`,
    `- Zakończ odpowiedź raportem [${checkpoint}] w formacie skilla; aplikacja zamknie ${checkpoint} tylko z tym raportem.`,
    ...(CONDITIONAL_CHECKPOINTS.has(checkpoint)
      ? [`- ${checkpoint} jest warunkowy: gdy warunek techniczny nie zachodzi, napisz wprost „[${checkpoint}] N/A — <powód>” (N/A wyłącznie per warunek techniczny, ZAKAZ-14).`]
      : [`- ${checkpoint} jest obowiązkowy: N/A niedozwolone.`]),
    ...(REQUIREMENTS[checkpoint] ?? []).map((item) => `- ${item}`),
    ...resources.loaded.map((item) => `- ${item.resource} — wczytany poniżej`),
    ...resources.toRead.map((item) => `- ${item} — wczytaj sam narzędziem korpusu przed raportem`),
    ...(register?.length
      ? [
          "",
          "# REJESTR CHECKPOINTÓW WEDŁUG APLIKACJI (stan sprawy; REJESTR KROKÓW w odpowiedzi musi się z nim zgadzać)",
          ...register.map(
            (entry) =>
              `- [${entry.checkpoint}] ${entry.status === "CLOSED" ? "✅ WYKONANY" : entry.status === "NA" ? `— N/A (${entry.reason ?? "bez powodu"})` : entry.checkpoint === checkpoint ? "▶ BIEŻĄCY" : "○ OCZEKUJE"}`
          )
        ]
      : []),
    ...resources.loaded.map((item) => `## ${item.resource}\n\n${item.content}`)
  ].join("\n");
}

const DZU = /\bDz\.\s?U\.\s*(?:z\s*)?\d{4}\b/u;
const JUDGMENT_SIGNATURE =
  /(?<![\p{L}])(?:wyrok\p{L}*|uchwał\p{L}*|postanowieni\p{L}*)\b[^\n]{0,120}?\b(?:SN|NSA|WSA|TK|SA|Sądu\s+Najwyższego|Naczelnego\s+Sądu|Trybunału)\b[^\n]{0,120}?\b[IVX]{1,4}\s+[A-Z][A-Za-z]{0,4}\s+\d{1,5}\/\d{2,4}\b/u;
const NOT_APPLICABLE = /\bN\/A\b|nie\s+dotyczy|nie\s+ma\s+zastosowania|nieaktywn\p{L}*|nie\s+zachodzi/iu;
const DRAFT_STATUS = /STATUS\s+PISMA\s*[:=]?\s*⚠️?\s*DRAFT/iu;
const FINAL_STATUS = /STATUS\s+PISMA\s*[:=]?\s*(?:✅\s*)?(?:FINAL|GOTOWE)/iu;

export type CheckpointOutputReport = {
  result: "PASS" | "BLOCKED";
  missing: string[];
  notApplicable: string | null;
};

/** What the checkpoint turn's answer must show (and an N/A of a conditional checkpoint). */
export function evaluateCheckpointOutput(checkpoint: ProcessPleadingCheckpoint, text: string): CheckpointOutputReport {
  const missing: string[] = [];
  const escaped = checkpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mention = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "iu");
  const lines = text.split("\n").filter((line) => mention.test(line) || (/CHECKPOINT/iu.test(line) && CHECKPOINT_NAMES[checkpoint].test(line)));
  // The report: the checkpoint by its id, or a "CHECKPOINT <name>" header (AUTOMAT-STANOW format).
  if (!lines.length) missing.push(`RAPORT_${checkpoint}`);
  const naLine = lines.find((line) => NOT_APPLICABLE.test(line));
  const notApplicable = naLine && CONDITIONAL_CHECKPOINTS.has(checkpoint) ? naLine.replace(/\s+/g, " ").trim().slice(0, 300) : null;
  if (naLine && !CONDITIONAL_CHECKPOINTS.has(checkpoint)) missing.push(`${checkpoint}_NA_NIEDOZWOLONE`);
  if (checkpoint === "CP-PRE-W2") {
    if (!/GATE-(?:OK|WARN|STOP)/u.test(text)) missing.push("PRE-W2_STATUS_BRAMKI");
    else if (/GATE-STOP/u.test(text) && !/GATE-(?:OK|WARN)/u.test(text)) missing.push("PRE-W2_GATE-STOP_DECYZJA_UZYTKOWNIKA");
  }
  if (checkpoint === "CP-ATAK") {
    if (!/RAPORT\s+D\b/u.test(text)) missing.push("RAPORT_D_W2.4");
    if (DZU.test(text)) missing.push("W2_IZOLACJA_DZ.U.");
    if (JUDGMENT_SIGNATURE.test(text)) missing.push("W2_IZOLACJA_SYGNATURA_ORZECZENIA");
  }
  if (checkpoint === "CP-PEER") {
    const register = text.slice(Math.max(0, text.toLocaleUpperCase("pl").lastIndexOf("REJESTR KROKÓW")));
    const open = /⚠️\s*POMINIĘT|○\s*OCZEKUJE|POMINIĘTY|OCZEKUJE/u.test(register);
    if (open && (FINAL_STATUS.test(text) || !DRAFT_STATUS.test(text))) missing.push("ST-FINAL_STATUS_DRAFT_PRZY_POMINIETYCH");
    if (open && !/INFORMACJA\s+WARUNKOWA/iu.test(text)) missing.push("ST-FINAL_INFORMACJA_WARUNKOWA");
  }
  return { result: missing.length ? "BLOCKED" : "PASS", missing, notApplicable };
}

export function checkpointCorrectionPrompt(checkpoint: ProcessPleadingCheckpoint, missing: string[]): string {
  return [
    `Odpowiedź dla ${checkpoint} nie spełnia kontraktu checkpointu (aplikacja): ${missing.join(", ")}.`,
    "Podaj pełną odpowiedź ponownie, z tą samą treścią merytoryczną, uzupełnioną o brakujące elementy:",
    ...missing.map((item) => `- ${item}`),
    "Nie przechodź do następnego checkpointu."
  ].join("\n");
}
