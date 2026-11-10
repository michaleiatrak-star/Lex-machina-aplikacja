// Language of the interface. The Polish text in the code is the key (as gettext): the code stays
// readable and a missing translation shows a sentence, never a key. Each language has its own
// catalog (locales/<code>.json: Polish text -> translation); a text not translated yet falls back
// to English, then to Polish. The language also goes to the runtime: the model answers in it.

export type LocaleCode = string;

export type LocaleInfo = {
  code: LocaleCode;
  // The language's own name, as its speakers write it.
  native: string;
  // Name in Polish (the source language of the interface).
  polish: string;
  // Jurisdictions (ISO country codes) using it as an official language of their law.
  countries: string[];
  dir?: "rtl";
};

// Languages of the jurisdictions Lex Machina reads law for (eli-countries.ts), with Polish first.
export const LOCALES: readonly LocaleInfo[] = [
  { code: "pl", native: "Polski", polish: "polski", countries: ["PL"] },
  { code: "en", native: "English", polish: "angielski", countries: ["GB", "IE", "US", "MT", "CY", "RW"] },
  { code: "de", native: "Deutsch", polish: "niemiecki", countries: ["DE", "AT", "CH", "LI", "LU", "BE"] },
  { code: "fr", native: "Français", polish: "francuski", countries: ["FR", "BE", "LU", "CH", "MC", "RW"] },
  { code: "it", native: "Italiano", polish: "włoski", countries: ["IT", "CH", "SM", "VA"] },
  { code: "es", native: "Español", polish: "hiszpański", countries: ["ES"] },
  { code: "pt", native: "Português", polish: "portugalski", countries: ["PT"] },
  { code: "nl", native: "Nederlands", polish: "niderlandzki", countries: ["NL", "BE"] },
  { code: "ca", native: "Català", polish: "kataloński", countries: ["AD"] },
  { code: "lb", native: "Lëtzebuergesch", polish: "luksemburski", countries: ["LU"] },
  { code: "sv", native: "Svenska", polish: "szwedzki", countries: ["SE", "FI"] },
  { code: "da", native: "Dansk", polish: "duński", countries: ["DK"] },
  { code: "nb", native: "Norsk bokmål", polish: "norweski", countries: ["NO"] },
  { code: "fi", native: "Suomi", polish: "fiński", countries: ["FI"] },
  { code: "is", native: "Íslenska", polish: "islandzki", countries: ["IS"] },
  { code: "fo", native: "Føroyskt", polish: "farerski", countries: ["FO"] },
  { code: "et", native: "Eesti", polish: "estoński", countries: ["EE"] },
  { code: "lv", native: "Latviešu", polish: "łotewski", countries: ["LV"] },
  { code: "lt", native: "Lietuvių", polish: "litewski", countries: ["LT"] },
  { code: "cs", native: "Čeština", polish: "czeski", countries: ["CZ"] },
  { code: "sk", native: "Slovenčina", polish: "słowacki", countries: ["SK"] },
  { code: "hu", native: "Magyar", polish: "węgierski", countries: ["HU"] },
  { code: "sl", native: "Slovenščina", polish: "słoweński", countries: ["SI"] },
  { code: "hr", native: "Hrvatski", polish: "chorwacki", countries: ["HR", "BA"] },
  { code: "bs", native: "Bosanski", polish: "bośniacki", countries: ["BA"] },
  { code: "sr", native: "Српски", polish: "serbski", countries: ["RS", "BA", "XK"] },
  { code: "cnr", native: "Crnogorski", polish: "czarnogórski", countries: ["ME"] },
  { code: "mk", native: "Македонски", polish: "macedoński", countries: ["MK"] },
  { code: "sq", native: "Shqip", polish: "albański", countries: ["AL", "XK", "MK"] },
  { code: "ro", native: "Română", polish: "rumuński", countries: ["RO", "MD"] },
  { code: "bg", native: "Български", polish: "bułgarski", countries: ["BG"] },
  { code: "el", native: "Ελληνικά", polish: "grecki", countries: ["GR", "CY"] },
  { code: "mt", native: "Malti", polish: "maltański", countries: ["MT"] },
  { code: "tr", native: "Türkçe", polish: "turecki", countries: ["TR", "CY"] },
  { code: "uk", native: "Українська", polish: "ukraiński", countries: ["UA"] },
  { code: "ka", native: "ქართული", polish: "gruziński", countries: ["GE"] },
  { code: "hy", native: "Հայերեն", polish: "ormiański", countries: ["AM"] },
  { code: "az", native: "Azərbaycanca", polish: "azerbejdżański", countries: ["AZ"] },
  { code: "rw", native: "Ikinyarwanda", polish: "kinyarwanda", countries: ["RW"] }
];

const SOURCE: LocaleCode = "pl";
const FALLBACK: LocaleCode = "en";
const KEY = "lex.language";

type Catalog = Record<string, string>;

const catalogs = new Map<LocaleCode, Catalog>();
let current: LocaleCode = SOURCE;

export function isLocale(code: unknown): code is LocaleCode {
  return typeof code === "string" && LOCALES.some((locale) => locale.code === code);
}

/** The language chosen on this computer, else the system's when supported, else Polish. */
export function preferredLocale(
  stored: string | null = readStored(),
  system: readonly string[] = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : []
): LocaleCode {
  if (isLocale(stored)) return stored;
  for (const tag of system) {
    const base = String(tag).toLowerCase().split("-")[0]!;
    const code = base === "no" || base === "nn" ? "nb" : base;
    if (isLocale(code)) return code;
  }
  return SOURCE;
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function currentLocale(): LocaleCode {
  return current;
}

/** Registers a language's catalog (loaded by the app at start, or by tests). */
export function registerCatalog(code: LocaleCode, catalog: Catalog): void {
  catalogs.set(code, catalog);
}

export function setLocale(code: LocaleCode): void {
  current = isLocale(code) ? code : SOURCE;
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
    const dir = LOCALES.find((locale) => locale.code === current)?.dir;
    if (dir) document.documentElement.dir = dir;
    else document.documentElement.removeAttribute("dir");
  }
}

/** Saves the choice; the interface is drawn again in it (the app reloads). */
export function saveLocale(code: LocaleCode): void {
  try {
    globalThis.localStorage?.setItem(KEY, code);
  } catch {
    // Blocked storage: the choice applies until the window closes.
  }
  setLocale(code);
}

const loaders = import.meta.glob<Catalog>("./locales/*.json", { import: "default" });

/** Loads the chosen language's catalog and English (the fallback) before the first render. */
export async function loadLocale(code: LocaleCode): Promise<void> {
  for (const wanted of new Set([code, FALLBACK])) {
    if (wanted === SOURCE || catalogs.has(wanted)) continue;
    const load = loaders[`./locales/${wanted}.json`];
    if (load) registerCatalog(wanted, await load());
  }
  setLocale(code);
}

/**
 * The text in the interface language. `text` is the Polish source; {name} placeholders are
 * filled from `values` after translation (a translation may move them).
 */
export function t(text: string, values?: Record<string, string | number>): string {
  const translated =
    current === SOURCE
      ? text
      : catalogs.get(current)?.[text] ?? catalogs.get(FALLBACK)?.[text] ?? text;
  return values ? translated.replace(/\{(\w+)\}/gu, (match, name: string) => (name in values ? String(values[name]) : match)) : translated;
}

/**
 * Marks a Polish text for translation where it is defined outside rendering (module constants,
 * lists of options): the text stays as it is and is translated where shown, with t(value).
 */
export function N_(text: string): string {
  return text;
}

/** The language name for the runtime's answer instruction (English name of the language). */
export function localeEnglishName(code: LocaleCode): string {
  const names: Record<string, string> = {
    pl: "Polish", en: "English", de: "German", fr: "French", it: "Italian", es: "Spanish", pt: "Portuguese", nl: "Dutch",
    ca: "Catalan", lb: "Luxembourgish", sv: "Swedish", da: "Danish", nb: "Norwegian Bokmål", fi: "Finnish", is: "Icelandic",
    fo: "Faroese", et: "Estonian", lv: "Latvian", lt: "Lithuanian", cs: "Czech", sk: "Slovak", hu: "Hungarian",
    sl: "Slovenian", hr: "Croatian", bs: "Bosnian", sr: "Serbian", cnr: "Montenegrin", mk: "Macedonian", sq: "Albanian",
    ro: "Romanian", bg: "Bulgarian", el: "Greek", mt: "Maltese", tr: "Turkish", uk: "Ukrainian", ka: "Georgian",
    hy: "Armenian", az: "Azerbaijani", rw: "Kinyarwanda"
  };
  return names[code] ?? code;
}
