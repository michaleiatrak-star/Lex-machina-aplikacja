import type { LegalDocumentAst } from "./legal-document-ast.js";

const FIELD = /\[(?!(?:LM)?PII:)[^\[\]\r\n]{1,48}\]/gu;
// Longer fields the drafting rules use: "[UZUPEŁNIJ: …]", the court the application could not decide.
const LONG_FIELD = /\[(?:UZUPEŁNIJ|Sąd do ustalenia|SĄD DO SPRAWDZENIA)\b[^\[\]\r\n]{0,240}\]/giu;
const COURT_FIELD = /\[(?:Sąd do ustalenia|SĄD DO SPRAWDZENIA)\b/iu;
// Documents filed or sent under someone's name end with a signature.
const SIGNED_TYPES = new Set(["pleading", "letter", "contract"]);

/**
 * What the user should check before using the file - never a reason to
 * refuse it: fields left in square brackets ([Kwota], [Miejscowość, data]),
 * a missing title, a missing signature block.
 */
export function documentCompletenessWarnings(ast: LegalDocumentAst, text: string): string[] {
  const warnings: string[] = [];
  if (COURT_FIELD.test(text)) {
    warnings.push("sąd nie jest ustalony: podaj pełny adres strony, według którego ustala się właściwość (z numerem budynku), albo wpisz sąd");
  }
  const fields = [...new Set([...(text.match(LONG_FIELD) ?? []), ...(text.match(FIELD) ?? [])])].filter((field) => !COURT_FIELD.test(field));
  const blanks = (text.match(/⬛+/gu) ?? []).length;
  if (blanks) warnings.push(`puste pola ⬛ do wypełnienia: ${blanks}`);
  if (fields.length) {
    warnings.push(`pola do uzupełnienia: ${fields.slice(0, 10).join(", ")}${fields.length > 10 ? ` i ${fields.length - 10} innych` : ""}`);
  }
  const titled = Boolean(ast.title?.length) || ast.blocks.some((block) => block.type === "heading" && block.level === 1);
  if (!titled) warnings.push("brak tytułu pisma");
  if (SIGNED_TYPES.has(ast.documentType) && !ast.blocks.some((block) => block.type === "signature")) {
    warnings.push("brak bloku podpisu");
  }
  return warnings;
}
