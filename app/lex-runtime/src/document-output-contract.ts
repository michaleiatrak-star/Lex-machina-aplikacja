// The output contract a document request appends to the user's words (the AST
// format of the file). The model needs it; decisions read from the text (skills,
// modules, complexity, criminal matter) must not: its "WEZWANIE DO ZAPŁATY ...
// amount, due date" triggered the payment-demand and consumer-credit schemas for
// every document.
export const DOCUMENT_OUTPUT_CONTRACT_HEADING = "# OUTPUT CONTRACT — LEGAL DOCUMENT AST";

/** The text without an appended document output contract. */
export function withoutOutputContract(text: string): string {
  const at = text.indexOf(DOCUMENT_OUTPUT_CONTRACT_HEADING);
  return at < 0 ? text : text.slice(0, at).trimEnd();
}
