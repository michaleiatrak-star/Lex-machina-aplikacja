import type { ContractAnalysisMode } from "./api.js";

export const CONTRACT_MODES: Array<{ mode: ContractAnalysisMode; label: string; hint: string }> = [
  { mode: "ANALYSIS", label: "Analiza umowy", hint: "ocena zapisów, ryzyk i stron" },
  { mode: "REDACTION", label: "Redakcja", hint: "poprawki istniejącej umowy" },
  { mode: "DRAFT", label: "Nowy projekt", hint: "projekt umowy od podstaw" },
  { mode: "SUPPLEMENT", label: "Uzupełnienie / aneks", hint: "dopisanie postanowień" }
];

// The mode a request most likely means; the user still confirms it with one click.
export function suggestedContractMode(text: string): ContractAnalysisMode {
  if (/(?<![\p{L}])(?:aneks\p{L}*|uzupełni\p{L}*|dopisz\p{L}*|dodaj\s+(?:\p{L}+\s+)?(?:klauzul|postanowie|zapis)\p{L}*)/iu.test(text)) return "SUPPLEMENT";
  if (/(?<![\p{L}])(?:zredaguj|przeredaguj|popraw\p{L}*|redakcj\p{L}*|przeformułuj)/iu.test(text)) return "REDACTION";
  if (/(?<![\p{L}])(?:napisz|przygotuj|sporządź|stwórz|opracuj|projekt\p{L}*)\s+(?:\p{L}+\s+){0,2}umow\p{L}*/iu.test(text) && !/(?<![\p{L}])(?:przeanalizuj|analiz\p{L}*|oceń|sprawdź)/iu.test(text)) return "DRAFT";
  return "ANALYSIS";
}
