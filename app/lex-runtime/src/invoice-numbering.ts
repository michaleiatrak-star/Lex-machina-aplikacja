// Autonumeracja faktur według wzoru użytkownika, np. „FV {NR}/{MM}/{RRRR}”.
// Tokeny: {NR} (licznik, obowiązkowy, raz), {DD}, {MM}, {RRRR}, {RR}.
// Licznik liczony z istniejących faktur w okresie, więc nie rozjeżdża się
// po usunięciu szkicu ani po imporcie.

export type NumberingReset = "monthly" | "yearly" | "never";

export type NumberingSettings = {
  pattern: string;
  reset: NumberingReset;
  // Minimalna liczba cyfr licznika ({NR} → 001 przy 3).
  padding: number;
};

export const NUMBERING_RESETS: NumberingReset[] = ["monthly", "yearly", "never"];

const TOKEN = /\{(NR|DD|MM|RRRR|RR)\}/g;

export class NumberingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "NumberingError";
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dateParts(issueDate: string): Record<"DD" | "MM" | "RRRR" | "RR", string> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(issueDate);
  if (!match) throw new NumberingError("NUMBERING_DATE_INVALID");
  return { RRRR: match[1]!, RR: match[1]!.slice(2), MM: match[2]!, DD: match[3]! };
}

export function validateNumbering(value: unknown): NumberingSettings {
  if (!value || typeof value !== "object") throw new NumberingError("NUMBERING_INVALID");
  const raw = value as Record<string, unknown>;
  const pattern = typeof raw.pattern === "string" ? raw.pattern.trim() : "";
  if (!pattern || pattern.length > 80) throw new NumberingError("NUMBERING_PATTERN_INVALID");
  const tokens = [...pattern.matchAll(TOKEN)].map((match) => match[1]);
  if (tokens.filter((token) => token === "NR").length !== 1) {
    throw new NumberingError("NUMBERING_PATTERN_NR_REQUIRED");
  }
  if (/[{}]/.test(pattern.replace(TOKEN, ""))) {
    throw new NumberingError("NUMBERING_PATTERN_UNKNOWN_TOKEN");
  }
  const reset = raw.reset;
  if (reset !== "monthly" && reset !== "yearly" && reset !== "never") {
    throw new NumberingError("NUMBERING_RESET_INVALID");
  }
  const hasYear = tokens.includes("RRRR") || tokens.includes("RR");
  // Bez roku (i miesiąca) w numerze reset licznika dałby powtarzające się numery.
  if (reset === "yearly" && !hasYear) throw new NumberingError("NUMBERING_PATTERN_YEAR_REQUIRED");
  if (reset === "monthly" && (!hasYear || !tokens.includes("MM"))) {
    throw new NumberingError("NUMBERING_PATTERN_MONTH_REQUIRED");
  }
  const padding = raw.padding === undefined ? 1 : Number(raw.padding);
  if (!Number.isInteger(padding) || padding < 1 || padding > 8) {
    throw new NumberingError("NUMBERING_PADDING_INVALID");
  }
  return { pattern, reset, padding };
}

// Wyrażenie dopasowujące numery z tego samego okresu licznika co issueDate.
function periodRegex(settings: NumberingSettings, issueDate: string): RegExp {
  const parts = dateParts(issueDate);
  const fixed = new Set<string>(
    settings.reset === "monthly"
      ? ["MM", "RRRR", "RR"]
      : settings.reset === "yearly"
        ? ["RRRR", "RR"]
        : []
  );
  let source = "";
  let last = 0;
  for (const match of settings.pattern.matchAll(TOKEN)) {
    source += escapeRegex(settings.pattern.slice(last, match.index));
    const token = match[1] as "NR" | "DD" | "MM" | "RRRR" | "RR";
    if (token === "NR") source += "(\\d+)";
    else if (fixed.has(token)) source += escapeRegex(parts[token]);
    else source += token === "RRRR" ? "\\d{4}" : "\\d{2}";
    last = match.index! + match[0].length;
  }
  source += escapeRegex(settings.pattern.slice(last));
  return new RegExp(`^${source}$`, "i");
}

export function formatNumber(settings: NumberingSettings, issueDate: string, counter: number): string {
  const parts = dateParts(issueDate);
  return settings.pattern.replace(TOKEN, (_, token: string) =>
    token === "NR"
      ? String(counter).padStart(settings.padding, "0")
      : parts[token as keyof typeof parts]
  );
}

export function nextAutoNumber(
  existingNumbers: string[],
  settings: NumberingSettings,
  issueDate: string
): string {
  const regex = periodRegex(settings, issueDate);
  let highest = 0;
  for (const number of existingNumbers) {
    const match = regex.exec(number.trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return formatNumber(settings, issueDate, highest + 1);
}
