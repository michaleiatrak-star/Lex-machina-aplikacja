import type { ChronologyCheckpoint } from "./chronology-state.js";
import type { CourtAnalysisCheckpoint } from "./court-analysis-state.js";

// The runtime's checkpoint names are its own (PASS_II_SOURCES_VERIFIED); the skill names
// the same step in its text („PRZEJŚCIE II — KWALIFIKACJA PRAWNA”). Without this the model
// is told only the runtime name and has to guess which part of SKILL.md to execute.

export const COURT_CHECKPOINT_SECTIONS: Readonly<Record<CourtAnalysisCheckpoint, string>> = {
  SD_VER_COMPLETE: "KROK 0 — SKAN KOMPLETNOŚCI PLIKÓW (SD-GATE): inwentaryzacja akt i potwierdzenie odczytu wszystkich stron; bez analizy merytorycznej.",
  PASS_I_ISOLATION_CLEAN: "Wiadomość 1 — PRZEJŚCIE I — MAPOWANIE FAKTYCZNE: same fakty ze źródłem, bez oceny prawnej.",
  PASS_II_SOURCES_VERIFIED: "Wiadomość 2 — PRZEJŚCIE II — KWALIFIKACJA PRAWNA: macierz fakt-norma, przepisy ze źródeł (RZĄD 1 — ELI), nie z pamięci.",
  FIRST_VERIFICATION_COMPLETE: "Wiadomość 3 — PRZEJŚCIE III — ANALIZA ADVERSARIALNA + WERYFIKACJA PIERWSZA (W1-W4).",
  FINAL_VERIFICATION_COMPLETE: "Wiadomość 4 — PRZEJŚCIE IV — AUTOKOREKTA P1-P5 + WERYFIKACJA OSTATECZNA (O1-O5).",
  FINAL_GATE_APPROVED: "GATE po Przejściu IV: rozstrzygnięcie „GATE: ZATWIERDZONE TAK” albo NIE z listą braków; bez raportu końcowego.",
  FINAL_REPORT_PRESENTED: "Wiadomość 5 — RAPORT KOŃCOWY §1-§11 (FORMAT RAPORTU KOŃCOWEGO).",
  SITUATIONAL_REPORT_PRESENTED: "Wiadomość 6 — WIDGET RAPORTU SYTUACYJNEGO (SEKWENCJA END-TO-END — PO RAPORCIE KOŃCOWYM).",
  PROCESS_PLEADING_OFFER_PRESENTED: "Wiadomość 7 — OFERTA PISMA PROCESOWEGO (SEKWENCJA END-TO-END)."
};

export const CHRONOLOGY_CHECKPOINT_SECTIONS: Readonly<Record<ChronologyCheckpoint, string>> = {
  DOCUMENT_INVENTORY_COMPLETE: "SD-GATE — SKAN KOMPLETNOŚCI DOKUMENTÓW i INWENTARYZACJA DOKUMENTÓW (lista, strony, rodzaj).",
  THREAD_IDENTIFICATION_COMPLETE: "OSIE CZASU PER WĄTEK PRAWNY (zasada wątków): wątki prawne sprawy [W1], [W2]…, bez ekstrakcji zdarzeń.",
  EVENT_EXTRACTION_COMPLETE:
    "FAZA EKSTRAKCJI ZDARZEŃ (sekwencja dla każdego dokumentu, CZTERY KLASY PEWNOŚCI, 3B. KORELACJA FINANSOWA) oraz OŚ-1 (ekstrakcja dat) z OŚ-GATE.",
  TEMPORAL_GATE_COMPLETE: "OŚ-GATE — OŚ-2…OŚ-4 (shared/MOD-OS-CZASU-PRZESLANEK.md) po zamknięciu ekstrakcji: siatka interwałów i CHWILE OCENY przesłanek.",
  CONTRADICTION_INDEX_COMPLETE: "INDEKS SPRZECZNOŚCI (z references/sprzecznosci-dat.md) i LUKI CZASOWE.",
  CHRONOLOGY_REPORT_COMPLETE: "FORMAT RAPORTU CHRONOLOGICZNEGO (TRYB A): pełny raport, blok OŚ-GATE przed wnioskami."
};

// analizator-dowodow-v3 and przesluchanie-swiadkow-v2-min90 name their checkpoints only in
// the frontmatter list (pipeline.stages); the body uses its own headings. "BLOK G" is there
// twice in the evidence skill (KROK 2 minimal mode, and the register of parties).
export const ORDERED_CHECKPOINT_SECTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  EVIDENCE_ANALYSIS_V1: {
    "AD-KROK0-BLOKADA": "KROK 0 — BLOKADA WSTĘPNA.",
    "AD-KROK0a-MODE": "KROK 0a — WYKRYCIE TRYBU PRACY (MODE).",
    "AD-KROK0b-SDVER": "KROK 0b — SKAN KOMPLETNOŚCI PLIKÓW (HARD GATE).",
    "AD-KROK0c-STINIT": "KROK 0c — ST-INIT: REJESTR KROKÓW (MOD-STEP-TRACKER).",
    "AD-KROK1-INTAKE": "KROK 1 — INTAKE I WIDGET.",
    "AD-KROK2-ROUTER": "KROK 2 — CENTRALNY ROUTER (BLOK A–F i BLOK G — Tryb minimalny).",
    "AD-BLOKG-STRONY": "## BLOK G — Rejestr stron, świadków i osób trzecich (nie „BLOK G — Tryb minimalny” z KROKU 2).",
    "AD-BLOKJ-LAPSUSY": "BLOK J — Lapsusy autorskie [LAPSUS].",
    "AD-BLOKH-DIS": "BLOK H — Kwestie sporne DIS z drill-down.",
    "AD-KROK3-WYKONANIE": "KROK 3 — WYKONANIE oraz KROK 3B — SYNTEZA: ASPEKTY → PRZEPISY → SELEKCJA DOWODÓW.",
    "AD-KROK4-DASHBOARD": "KROK 4 — DASHBOARD (jeśli B1=TAK)."
  },
  WITNESS_QUESTIONING_V1: {
    "PRE-W1a-SD-VER": "KROK PRE-W1a — SD-VER: WERYFIKACJA KOMPLETNOŚCI SKANOWANIA DOWODÓW.",
    "PRE-W1a.4-RZ-SHOW": "KROK PRE-W1a.4 — RZ-SHOW-ZAWSZE.",
    "KROK-PRE-W1-INTELLIGENCE": "KROK PRE-W1 — WITNESS INTELLIGENCE.",
    "KROK-0-KONTEKST": "KROK 0 — WCZYTAJ KONTEKST SPRAWY (przed W1).",
    "W1-INTAKE": "ETAP W1 — INTAKE (WARSTWA A i bramki W1).",
    "W1-SUPPLEMENT": "ETAP W1: WARSTWA B — uzupełnienie zależne od typu świadka (z INTAKE-COMPLETENESS-GATE).",
    "W2-THESES-AND-MODEL": "ETAP W2 — TEZY I MODEL.",
    "CHECKPOINT-W2": "CHECKPOINT-W2 — OBOWIĄZKOWA PAUZA PRZED W3.",
    "W3-QUESTIONS": "ETAP W3 — PYTANIA (po SELF-CHECK-PRZED-W3).",
    "W4-REHEARSAL": "ETAP W4 — PRÓBA GENERALNA.",
    "W5-BINDER": "ETAP W5 — BINDER SĄDOWY.",
    "W6-LIVE-DIRECT": "ETAP W6 — SŁUCHANIE DIRECT I ADAPTACJA."
  }
};
