import { peselFacts } from "./identifiers.js";
import type { PseudonymizationVault } from "./pseudonymizer.js";

// PESEL numbers of the material checked by the application before the analysis: the check
// digit and the date, and the sex the number encodes (10th digit) against the person named
// right before it (the key's gender, or "Pan"/"Pani"). Written with the documents' tokens:
// the model learns the result, never the number or the name (user question 2026-11-08: "does
// the app check PESEL and its agreement with the sex?").

const TOKEN = /\[(?:LMPII:D\d{2}:|PII:)PESEL:(\d{4})\]/gu;
const PERSON_BEFORE = /\[(?:PII|LMPII:D\d{2}):PERSON:\d{4}(?:\|[A-Z]{2,4})?\][^[\n]{0,80}$/u;
const HONORIFIC = /\b(Pan|Pani|Pana|Panią|Panem|Panu)\b[^.\n]{0,80}$/u;

type Vault = Pick<PseudonymizationVault, "snapshot" | "entity">;

export function peselCheckText(texts: string[], vault: Vault): string {
  const values = new Map(vault.snapshot().tokens.filter((item) => item.kind === "PESEL").map((item) => [item.token, item.value]));
  const lines = new Map<string, string>();
  for (const text of texts) {
    for (const match of text.matchAll(TOKEN)) {
      const token = `[PII:PESEL:${match[1]}]`;
      const value = values.get(token);
      if (!value || lines.has(token)) continue;
      const facts = peselFacts(value);
      if (!facts) {
        lines.set(token, `- ${token}: NIEPRAWIDŁOWY (błędna cyfra kontrolna albo data) — numer nie może należeć do nikogo; wskaż korektę.`);
        continue;
      }
      const sex = facts.sex === "f" ? "kobieta" : "mężczyzna";
      const before = text.slice(Math.max(0, match.index! - 120), match.index!);
      const person = PERSON_BEFORE.exec(before)?.[0].match(/\[(?:PII|LMPII:D\d{2}):PERSON:\d{4}/u)?.[0];
      const entity = person ? vault.entity(`${person.replace(/^\[LMPII:D\d{2}:/u, "[PII:")}]`) : undefined;
      const keyed = entity?.type !== "organization" && (entity?.gender === "f" || entity?.gender === "m1") && !entity.warnings.includes("GENDER_HEURISTIC") ? (entity.gender === "f" ? "f" : "m") : undefined;
      const honorific = HONORIFIC.exec(before)?.[1];
      const named = keyed ?? (honorific ? (/^Pani/u.test(honorific) && honorific !== "Panu" ? "f" : "m") : undefined);
      const who = person ? `${person}]` : honorific ? `„${honorific}”` : "";
      if (!named) {
        lines.set(token, `- ${token}: poprawny; płeć z numeru: ${sex}${who ? `; płci osoby ${who} nie ustalono` : ""}.`);
      } else if (named !== facts.sex) {
        lines.set(token, `- ${token}: poprawny, ale NIEZGODNY z płcią: numer oznacza: ${sex}, a osoba ${who} to ${named === "f" ? "kobieta" : "mężczyzna"} — numer należy do innej osoby albo jest błędnie przepisany.`);
      } else {
        lines.set(token, `- ${token}: poprawny i zgodny z płcią osoby ${who} (${sex}).`);
      }
    }
  }
  if (!lines.size) return "";
  return [
    "# KONTROLA PESEL (aplikacja — suma kontrolna, data, płeć)",
    "Wynik jest ustaleniem: NIEPRAWIDŁOWY i NIEZGODNY wskaż w analizie jako błąd danych osoby z propozycją korekty.",
    ...lines.values()
  ].join("\n");
}
