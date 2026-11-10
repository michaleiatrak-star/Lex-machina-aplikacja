import { AsyncLocalStorage } from "node:async_hooks";

// The interface language chosen by the user (X-Lex-Language): the model answers in it. Polish is
// the source language of the prompts, so it adds nothing.
const NAMES: Record<string, string> = {
  en: "English", de: "German", fr: "French", it: "Italian", es: "Spanish", pt: "Portuguese", nl: "Dutch",
  ca: "Catalan", lb: "Luxembourgish", sv: "Swedish", da: "Danish", nb: "Norwegian Bokmål", fi: "Finnish", is: "Icelandic",
  fo: "Faroese", et: "Estonian", lv: "Latvian", lt: "Lithuanian", cs: "Czech", sk: "Slovak", hu: "Hungarian",
  sl: "Slovenian", hr: "Croatian", bs: "Bosnian", sr: "Serbian", cnr: "Montenegrin", mk: "Macedonian", sq: "Albanian",
  ro: "Romanian", bg: "Bulgarian", el: "Greek", mt: "Maltese", tr: "Turkish", uk: "Ukrainian", ka: "Georgian",
  hy: "Armenian", az: "Azerbaijani", rw: "Kinyarwanda"
};

const scope = new AsyncLocalStorage<string>();

/** The language code from the request header, or null for Polish / unknown. */
export function parseAnswerLanguage(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  return code in NAMES ? code : null;
}

/** The rest of this request's work answers in the given language (null: Polish). */
export function enterAnswerLanguage(code: string | null): void {
  if (code) scope.enterWith(code);
}

export function currentAnswerLanguage(): string | null {
  return scope.getStore() ?? null;
}

/** The instruction appended to every system prompt of the request, or "" for Polish. */
export function answerLanguageInstruction(code: string | null = currentAnswerLanguage()): string {
  if (!code || !(code in NAMES)) return "";
  return [
    "# JĘZYK ODPOWIEDZI",
    `Użytkownik wybrał w interfejsie język: ${NAMES[code]} (${code}). Odpowiadaj w tym języku; to polecenie ma pierwszeństwo przed wcześniejszym poleceniem odpowiadania po polsku. Gdy użytkownik sam pisze w innym języku, odpowiadaj w jego języku.`,
    "Nazwy instytucji, organów i sądów, tytuły aktów prawnych oraz cytowane brzmienie przepisów i orzeczeń podawaj w oryginale; w razie potrzeby dodaj tłumaczenie w nawiasie. Sygnatury, oznaczenia przepisów (art., § , ust.) i identyfikatory ELI zostają bez zmian.",
    "Teksty techniczne aplikacji (kody bramek, znaczniki) zostawiaj bez tłumaczenia."
  ].join("\n");
}
