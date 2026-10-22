import { createContext, useContext } from "react";

/**
 * Developer mode: whether the app shows what matters only to a programmer (the
 * execution journal, skills and modules of a turn, gates, checkpoint ids, token
 * counters, error codes and traces). Off (the default) the lawyer sees the answer,
 * its sources, documents and the decisions asked of them, and errors in one plain
 * sentence. Kept per user in the app's local storage, like the last used model.
 */

function storageKey(userId: string): string {
  return `lex.developerMode.${userId}`;
}

export function loadDeveloperMode(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function saveDeveloperMode(userId: string, enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(storageKey(userId), "1");
    else window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Storage unavailable (private window): the switch holds for this session only.
  }
}

export const DeveloperModeContext = createContext(false);

export function useDeveloperMode(): boolean {
  return useContext(DeveloperModeContext);
}

export const PLAIN_ERROR = "Nie udało się przygotować odpowiedzi. Spróbuj ponownie.";

const PLAIN_BLOCKED =
  "Nie udało się przygotować odpowiedzi, która przeszłaby kontrolę jakości. Spróbuj ponownie albo doprecyzuj pytanie.";

// Process pleading checkpoints in words (CP-REJESTR of pisma-procesowe-v3).
export const CHECKPOINT_LABELS: Readonly<Record<string, string>> = {
  "CP-1a": "Weryfikacja roszczenia",
  "CP-1b": "Wybór strategii",
  "CP-1c-skan": "Przegląd kompletności dowodów",
  "CP-PD": "Uporządkowanie dowodów",
  "CP-FSL-D": "Powiązanie faktów z dokumentami",
  "CP-1c-macierz": "Zestawienie dowodów i twierdzeń",
  "CP-1c-lancuch": "Łańcuch dowodowy",
  "CP-1d-anomalie": "Nieprawidłowości w dokumentach",
  "CP-1d": "Poszlaki i kontekst",
  "CP-W1": "Rama pisma i strategia",
  "CP-PRE-W2": "Weryfikacja przed projektem",
  "CP-ATAK": "Krytyczny przegląd projektu",
  "CP-PODMIOT": "Kontrola stron i podmiotów",
  "CP-QUALITY": "Kontrola jakości prawnej",
  "CP-AUDYT": "Kontrola końcowa",
  "CP-PEER": "Recenzja końcowa"
};

/** A checkpoint in words; an unknown id is named only as a step. */
export function checkpointLabel(checkpoint: string): string {
  return CHECKPOINT_LABELS[checkpoint] ?? "Kolejny krok";
}

// Stages of a turn as the runtime names them (execution-steps.ts), in a lawyer's words.
const PHASE_LABELS: Readonly<Record<string, string>> = {
  PREPARE: "Ochrona danych w wiadomości i plikach",
  ROUTING: "Rozpoznanie zagadnienia prawnego",
  SKILLS: "Przygotowanie sposobu pracy",
  MODEL: "Analiza prawna",
  VERIFY: "Weryfikacja przepisów i źródeł",
  RESTORE: "Przywrócenie danych w odpowiedzi"
};

export function phaseLabel(key: string, label: string, developer: boolean): string {
  return developer ? label : (PHASE_LABELS[key] ?? label);
}

// Executive skills by what they do for the lawyer.
const SKILL_LABELS: Readonly<Record<string, string>> = {
  "analiza-sadowa-v6": "analiza sądowa",
  "analizator-dowodow-v3": "analiza dowodów",
  "analizator-przepisow-v2": "analiza przepisów",
  "analizator-umow-v1": "analiza umowy",
  "chronologia-sprawy-v1": "chronologia sprawy",
  "orzeczenia-sadowe-v2": "orzecznictwo",
  "pisma-procesowe-v3": "pismo procesowe",
  "pisma-proste-v2": "pismo proste",
  "przesluchanie-swiadkow-v2-min90": "przesłuchanie świadków",
  "przewodnik-prawny-v2": "przewodnik prawny",
  "raport-klienta-v1": "raport dla klienta",
  "raport-sytuacyjny-v2": "raport sytuacyjny"
};

export function skillLabel(name: string, developer: boolean): string {
  return developer ? name : (SKILL_LABELS[name] ?? "dalsza analiza");
}

/**
 * The line under a message. Off: only what tells the lawyer something (a file's
 * name, an automatic step in words); routing, skills, tokens, model and gate
 * counters are dropped.
 */
export function plainMeta(meta: string): string {
  if (meta.startsWith("dokument:")) return meta;
  if (meta.startsWith("automatycznie")) {
    return meta
      .split(" · ")
      .map((item) => stripStepIds(item))
      .join(" · ");
  }
  return "";
}

// "krok AU-F0 — Intake: tryb (INTAKE-GAP)" -> "krok Intake: tryb"; a bare CP id -> its label.
function stripStepIds(text: string): string {
  return text
    .replace(/\b(CP-[A-Za-z0-9-]+)\b(?! —)/g, (id) => CHECKPOINT_LABELS[id] ?? id)
    .replace(/\b[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+ — /g, "")
    .replace(/\s*\([A-ZĄĆĘŁŃÓŚŹŻ0-9]+(?:[-_][A-ZĄĆĘŁŃÓŚŹŻ0-9]+)+\)/g, "");
}

/** A step of a checkpoint workflow ("AU-F0 — Intake: ..."): the words only when off. */
export function plainStepLabel(label: string, developer: boolean): string {
  return developer ? label : stripStepIds(label);
}

/**
 * Text of a system message (an error, a blocked turn, a workflow note) for a lawyer:
 * no codes, no "Przyczyna" block of gates, no stack of identifiers.
 */
export function plainSystemText(content: string): string {
  if (/^Nie udało się zaprezentować odpowiedzi z powodu blokady/.test(content)) return PLAIN_BLOCKED;
  if (/^Nie udało się wykonać sesji:/.test(content)) return PLAIN_ERROR;
  if (/zablokował wykonanie: [A-Z_]+/.test(content)) {
    return "Nie udało się wykonać tego etapu pracy. Spróbuj ponownie; jeśli się powtórzy, rozpocznij nowy etap.";
  }
  let text = content.replace(/\n\nPrzyczyna:\n[\s\S]*$/, "");
  text = text.replace(/^(Nie udało się utworzyć pliku pisma): [^\n]*?\. (Możesz poprosić)/, "$1. $2");
  text = text
    .replace(/\s*Szczegóły: [\s\S]*$/, "")
    .replace(/\s*\((?:kod|Kod): [^)]*\)/g, "")
    .replace(/\s*Kod: [A-Z0-9_:,.-]+\.?/g, "")
    .replace(/jeśli się powtórzy, zgłoś kod: [^\s.]+/g, "jeśli się powtórzy, skontaktuj się z administratorem")
    .replace(/walidacja HYBRID-VAL/g, "końcowa kontrola pisma")
    .replace(/\s*\(HYBRID-VAL[^)]*\)/g, "")
    .replace(/ po walidacji HYBRID-VAL/g, " po końcowej kontroli");
  return stripStepIds(text).trim() || PLAIN_ERROR;
}

/**
 * An answer for a lawyer: checkpoint ids in headings and notices by their names
 * (the server joins automatic steps under "## CP-..."). The legal text is not touched.
 */
export function plainAnswerText(content: string): string {
  return content
    .replace("Weryfikacja źródeł lub śladu Gate I nie jest kompletna.", "Weryfikacja źródeł nie jest kompletna.")
    .replace(
      /^Etap nie został zamknięty: w tej turze odmówiono kroku \(.*?\)\. Odpowiedź poniżej jest robocza; powtórz etap, aby zamknąć go z pełnym śladem audytu\./mu,
      "Etap nie został zamknięty. Odpowiedź poniżej jest robocza; powtórz etap."
    )
    .replace(/^(#{1,6}) (CP-[A-Za-z0-9-]+)\s*$/gm, (_line, hashes: string, id: string) => `${hashes} ${checkpointLabel(id)}`)
    .replace(/\*\*Projekt pisma nie został zaktualizowany \((CP-[A-Za-z0-9-]+)\):\*\*/g, "**Projekt pisma nie został zaktualizowany:**");
}

/**
 * A message the app sent for the user (a chosen next stage names its skill for the
 * server): the choice in words. What the user typed stays as typed.
 */
export function plainUserText(content: string): string {
  const handoff = /^Następny etap pipeline'u: (\S+?)\. (Wynik powyżej jest zadowalający)?/u.exec(content);
  if (!handoff) return content;
  const label = skillLabel(handoff[1]!, false);
  return handoff[2] ? `Przygotuj dokument: ${label}.` : `Dalsza analiza: ${label}.`;
}

/** What a message shows: everything in developer mode, the lawyer's view otherwise. */
export function visibleContent(
  message: { role: string; content: string; plainContent?: string },
  developer: boolean
): string {
  if (developer) return message.content;
  if (message.plainContent) return message.plainContent;
  if (message.role === "system") return plainSystemText(message.content);
  if (message.role === "assistant") return plainAnswerText(message.content);
  return plainUserText(message.content);
}

// Errors with a step the lawyer can take, in their words (the rest: one plain sentence).
const PLAIN_ERRORS: Readonly<Record<string, string>> = {
  ACCOUNT_SESSION_CLI_NOT_INSTALLED:
    "Wybrane konto modelu nie jest gotowe. Otwórz Ustawienia → Modele i AI i połącz konto albo wybierz klucz API.",
  ACCOUNT_SESSION_LOGIN_NOT_CONFIRMED: "Nie udało się potwierdzić logowania do konta modelu. Zaloguj się ponownie i spróbuj jeszcze raz.",
  ACCOUNT_SESSION_LOGIN_ADMIN_REQUIRED: "Konto modelu nie jest połączone. Poproś administratora aplikacji o jego połączenie.",
  PRIMARY_MODEL_NOT_READY: "Wybrany model nie jest jeszcze gotowy. Spróbuj ponownie za chwilę.",
  PROVIDER_NOT_CONFIGURED: "Brak klucza API dla wybranego modelu. Dodaj go w Ustawieniach → Modele i AI.",
  CHAT_PRIVACY_GATE_FAILED:
    "Nie udało się zabezpieczyć danych osobowych przed wysłaniem, więc wiadomość nie została wysłana. Spróbuj ponownie; jeśli się powtórzy, skontaktuj się z administratorem.",
  DOCUMENT_NOT_REVIEWED:
    "Dokument nie jest jeszcze zatwierdzony. Otwórz go w aktach sprawy („Podgląd i zatwierdzenie”), sprawdź i zatwierdź.",
  DOCUMENT_ATTACHMENT_RESOLUTION_FAILED: "Nie udało się dołączyć wybranych fragmentów dokumentu. Wybierz je ponownie.",
  CONTRACT_STATE_REQUIRED: "Analiza umowy wymaga wyboru trybu dla tej sprawy. Wybierz go poniżej — wiadomość zostanie wysłana ponownie.",
  CONTRACT_CASE_REQUIRED: "Analiza umowy musi dotyczyć jednej sprawy. Dołącz plik umowy ze sprawy.",
  CONTRACT_ALREADY_COMPLETE: "Analiza umowy w tej sprawie jest już zakończona. Możesz rozpocząć nową poniżej.",
  PROCESS_PLEADING_STATE_REQUIRED: "Pismo procesowe powstaje etapami. Rozpocznij je poniżej — wiadomość zostanie wysłana ponownie.",
  PROCESS_PLEADING_START_ACCEPTANCE_REQUIRED: "Pismo procesowe czeka na Twoją zgodę na rozpoczęcie. Zaakceptuj start poniżej.",
  PROCESS_PLEADING_CONFIRMATION_REQUIRED: "Pismo procesowe czeka na potwierdzenie bieżącego etapu.",
  PROCESS_PLEADING_CASE_REQUIRED: "Pismo procesowe musi dotyczyć wybranej sprawy.",
  PROCESS_PLEADING_ALREADY_FINAL: "Pismo procesowe w tej sprawie jest już gotowe. Możesz rozpocząć nowe poniżej.",
  COURT_ANALYSIS_CASE_REQUIRED: "Analiza sądowa musi dotyczyć wybranej sprawy.",
  COURT_ANALYSIS_ALREADY_COMPLETE: "Analiza sądowa tej sprawy jest już zakończona. Możesz rozpocząć nową poniżej.",
  ORDERED_WORKFLOW_ALREADY_COMPLETE: "Ten etap pracy ze sprawą jest już zakończony. Możesz rozpocząć nowy poniżej.",
  ORDERED_WORKFLOW_CASE_REQUIRED: "Ta praca musi dotyczyć jednej sprawy. Dołącz pliki ze sprawy."
};

// Model failures by their reason (local model, provider account), in words.
const PLAIN_MODEL_REASONS: Readonly<Record<string, string>> = {
  LOCAL_MODEL_CONTEXT_OVERFLOW: "Rozmowa lub załączniki są za długie dla lokalnego modelu. Zawęź pytanie albo odznacz część plików.",
  LOCAL_MODEL_RESOURCE_EXHAUSTED: "Zabrakło pamięci komputera dla lokalnego modelu. Odznacz część plików albo wybierz mniejszy model.",
  ACCOUNT_SESSION_AUTH_EXPIRED: "Sesja konta modelu wygasła. Otwórz Ustawienia → Modele i AI i połącz konto ponownie.",
  ACCOUNT_SESSION_NOT_SUBSCRIPTION_AUTH: "Sesja konta modelu wygasła. Otwórz Ustawienia → Modele i AI i połącz konto ponownie.",
  ACCOUNT_SESSION_CAPACITY: "Konto modelu chwilowo odrzuca zapytania (limit). Odczekaj kilka minut albo wybierz inny model.",
  ACCOUNT_SESSION_PLAN_UNSUPPORTED: "Plan konta modelu nie obsługuje tego połączenia. Wybierz klucz API w Ustawieniach → Modele i AI.",
  ACCOUNT_SESSION_EMPTY_RESPONSE: "Model nie zwrócił odpowiedzi. Ponów wiadomość albo zawęź pytanie.",
  ACCOUNT_SESSION_CLI_SPAWN_FAILED: "Nie udało się połączyć z kontem modelu. Połącz konto ponownie w Ustawieniach → Modele i AI.",
  ACCOUNT_SESSION_CLI_INCOMPATIBLE: "Nie udało się połączyć z kontem modelu. Połącz konto ponownie w Ustawieniach → Modele i AI."
};

/**
 * The error the lawyer sees for a failed turn: the technical message stays for
 * developer mode; otherwise a plain sentence (and what to do, where there is something).
 */
export function plainErrorMessage(code: string, technical: string, reason?: string): string {
  const mapped = PLAIN_ERRORS[code];
  if (mapped) return mapped;
  if (/^(?:PROCESS_PLEADING_|COURT_ANALYSIS_|ORDERED_WORKFLOW_|LEGAL_WORKFLOW_)/.test(code)) {
    return "Nie udało się wykonać tego etapu pracy. Spróbuj ponownie; jeśli się powtórzy, rozpocznij nowy etap.";
  }
  if (code === "PROVIDER_EXECUTION_FAILED" || code === "LOCAL_MODEL_EXECUTION_FAILED") {
    if (reason && PLAIN_MODEL_REASONS[reason]) return PLAIN_MODEL_REASONS[reason];
    return reason?.startsWith("LOCAL_MODEL_")
      ? "Lokalny model nie przygotował odpowiedzi. Spróbuj ponownie; aplikacja uruchomi go od nowa."
      : "Model nie przygotował odpowiedzi. Spróbuj ponownie albo wybierz inny model.";
  }
  // Messages about files already say what to do; only codes and gate names go.
  if (/DOCUMENT|EXPORT|LETTER_MARKUP/.test(code)) return plainSystemText(technical);
  if (/^Nie udało się uruchomić lokalnego modelu|^Lokalny model wymaga naprawy profilu/.test(code)) return technical;
  return PLAIN_ERROR;
}
