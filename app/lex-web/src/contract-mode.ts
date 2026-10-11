import type { ContractAnalysisMode } from "./api.js";

export const CONTRACT_MODES: Array<{ mode: ContractAnalysisMode; label: string; hint: string }> = [
  { mode: "ANALYSIS", label: "Analiza umowy", hint: "ocena zapisów, ryzyk i stron" },
  { mode: "REDACTION", label: "Redakcja", hint: "poprawki istniejącej umowy" },
  { mode: "DRAFT", label: "Nowy projekt", hint: "projekt umowy od podstaw" },
  { mode: "SUPPLEMENT", label: "Uzupełnienie / aneks", hint: "dopisanie postanowień" }
];

// The mode a request most likely means; the user still confirms it with one click.
// analizator-umow-v1 modes: TRYB 1 ANALIZA (also "is it correct / lawful"), TRYB 2 REDAKCJA
// (corrections of an existing document), TRYB 3 DRAFT (a new document), TRYB 4 UZUPEŁNIENIE.
// "poprawność", "poprawny" ask whether the document is correct: analysis, not redaction.
const ANALYSIS_VERB = /(?<![\p{L}])(?:przeanalizuj|analiz\p{L}*|oceń|ocen\p{L}*|sprawdź|sprawdz|zweryfikuj|weryfik\p{L}*|poprawnoś\p{L}*|poprawnos\p{L}*|poprawn[yaeio]\p{L}*|zgodn\p{L}*\s+z\s+prawem|spójnoś\p{L}*|wskaż|ryzyk\p{L}*|wadliw\p{L}*|abuzywn\p{L}*|czy\s+(?:mogę|moge|warto)\s+podpisać|korzystn\p{L}*)/iu;
const DRAFT_VERB = /(?<![\p{L}])(?:napisz|przygotuj|sporządź|stwórz|opracuj|wygeneruj|utwórz|sformułuj|dodaj|dopisz)/iu;

export function suggestedContractMode(text: string): ContractAnalysisMode {
  // An annex or a clause to add: only when it is asked for, not when an existing annex is assessed.
  if (/(?<![\p{L}])(?:uzupełni\p{L}*|dopisz\p{L}*|dodaj\s+(?:\p{L}+\s+)?(?:klauzul|postanowie|zapis)\p{L}*)/iu.test(text) ||
      (/(?<![\p{L}])aneks\p{L}*/iu.test(text) && DRAFT_VERB.test(text))) return "SUPPLEMENT";
  if (/(?<![\p{L}])(?:zredaguj|przeredaguj|popraw(?!n)\p{L}*|redakcj\p{L}*|przeformułuj|skoryguj|korekt\p{L}*|napraw\p{L}*|dostosuj)/iu.test(text)) return "REDACTION";
  // "Wygeneruj profesjonalne pismo dotyczące powierzenia rekrutacji", "Przygotuj umowę najmu", "Napisz politykę prywatności": a new document.
  if (/(?<![\p{L}])(?:napisz|przygotuj|sporządź|stwórz|opracuj|wygeneruj|utwórz|sformułuj|projekt\p{L}*)\s+(?:\p{L}+\s+){0,3}(?:umow|umów|porozumieni|kontrakt|regulamin|pism|dokument|polityk|uchwał|statut|protokoł|protokół|klauzul\p{L}*\s+informacyjn)\p{L}*/iu.test(text) && !/(?<![\p{L}])(?:przeanalizuj|analiz\p{L}*|oceń|sprawdź)/iu.test(text)) return "DRAFT";
  return "ANALYSIS";
}

// An unambiguous request to analyse or check a document (no drafting, editing or supplementing):
// the mode is set without asking. Anything else waits for the user's choice.
export function automaticContractMode(text: string): ContractAnalysisMode | null {
  if (suggestedContractMode(text) !== "ANALYSIS") return null;
  return ANALYSIS_VERB.test(text) &&
    !/(?<![\p{L}])(?:napisz|sporządź|stwórz|zredaguj|przeredaguj|popraw(?!n)|dopisz|aneks\p{L}*\s+(?:do|dla))/iu.test(text)
    ? "ANALYSIS"
    : null;
}
