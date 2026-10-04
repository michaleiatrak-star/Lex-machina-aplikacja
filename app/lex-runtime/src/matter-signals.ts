import { provisionsForDetection } from "./legal-act-abbreviations.js";

// Sprawa karna (DR-03) rozpoznana z treści pytania, zanim model cokolwiek przeczyta:
// w trybie automatycznym skill główny nie jest jeszcze znany (PROFIL-LEKKI: sprawa
// karna zawsze PEŁNY; "Karne: +kwalifikator").
const CRIMINAL_ACT = /\bart\.?\s*\d+[a-z]?(?:\s*§\s*\d+[a-z]?)?\s+(?:KK|KPK|KKS|KKW|KW|KPW)\b/u;
const CRIMINAL_WORDS =
  /\b(?:kodeks\p{L}*\s+karn\p{L}*|kodeks\p{L}*\s+postępowania\s+karnego|przestęp\p{L}*|wykrocze\p{L}*|oskarżon\p{L}*|podejrzan\p{L}*|akt\p{L}*\s+oskarżenia|prokurat\p{L}*|postępowani\p{L}*\s+karn\p{L}*|odpowiedzialnoś\p{L}*\s+karn\p{L}*|zarzut\p{L}*\s+popełnienia|kar\p{L}*\s+pozbawienia\s+wolności|grzywn\p{L}*|mandat\p{L}*\s+karn\p{L}*|skarbow\p{L}*\s+(?:przestęp|wykrocz)\p{L}*)/iu;

export function criminalMatter(text: string): boolean {
  return CRIMINAL_ACT.test(provisionsForDetection(text)) || CRIMINAL_WORDS.test(text);
}
