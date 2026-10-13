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
