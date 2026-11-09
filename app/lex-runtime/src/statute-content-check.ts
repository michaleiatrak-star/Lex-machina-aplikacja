import { citedDocuments, type CitedDocument } from "./case-content-grounding.js";
import type { SemanticCheck, SemanticVerdict } from "./case-semantic-check.js";
import type { VerificationRecord } from "./verification-ledger.js";

// Kontrola treści przepisów (2026-11-09, odpowiedź Bielika o porozumieniu rozwiązującym):
// aplikacja zweryfikowała art. 100 § 2 KP i postawiła ✅, a odpowiedź przypisała mu „zasadę
// proporcjonalności” — przepis istniał, teza nie. Weryfikacja ELI/RAG potwierdza istnienie
// i brzmienie; ta kontrola sprawdza, czy brzmienie mówi to, co odpowiedź o nim twierdzi.

export const STATUTE_JUDGE_BATCH = 4;

const comparable = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase("pl").replace(/[.,;:()[\]{}]/g, " ").replace(/\s+/g, " ").trim();

export type StatuteItem = { document: CitedDocument; record: VerificationRecord };

/** Claims whose wording a source tool returned in the turn (already judged by the grounding check). */
export function claimsWithWording(sources: string[]): Set<string> {
  const claims = new Set<string>();
  for (const source of sources) {
    try {
      const record = JSON.parse(source) as { claim?: unknown; evidence?: unknown };
      if (typeof record.claim === "string" && typeof record.evidence === "string" && record.evidence.trim()) claims.add(comparable(record.claim));
    } catch {
      // not a verification record
    }
  }
  return claims;
}

/** Provisions the answer cites that the application verified with their wording, paired with the ledger record. */
export function statuteItems(answer: string, records: VerificationRecord[], skip: ReadonlySet<string> = new Set()): StatuteItem[] {
  const usable = records.filter(
    (record) => record.status === "VERIFIED" && typeof record.evidence === "string" && record.evidence.trim() && !skip.has(comparable(record.claim))
  );
  if (!usable.length) return [];
  const documents = citedDocuments(answer, usable.map((record) => JSON.stringify({ claim: record.claim, evidence: record.evidence })));
  const items: StatuteItem[] = [];
  for (const document of documents) {
    if (document.kind !== "statute") continue;
    const cited = comparable(document.signature);
    const record = usable.find((item) => comparable(item.claim) === cited) ?? usable.find((item) => comparable(item.claim).startsWith(`${cited} `));
    if (record) items.push({ document, record });
  }
  return items;
}

/** Only the claim matters for a provision: a provision cited as background may be off the question. */
export const statuteProblems = (check: SemanticCheck): SemanticVerdict[] => check.verdicts.filter((verdict) => verdict.claim !== "SUPPORTED");

export function statuteCorrectionPrompt(problems: SemanticVerdict[]): string {
  return [
    "KONTROLA TREŚCI PRZEPISÓW (aplikacja, na podstawie brzmienia pobranego z ELI):",
    ...problems.map(
      (problem) =>
        `- ${problem.signature}: twierdzenie ${problem.claim === "UNSUPPORTED" ? "NIE WYNIKA z brzmienia przepisu" : "wynika z brzmienia tylko częściowo"}.${problem.thesis ? ` Teza odpowiedzi: „${problem.thesis}”.` : ""} ${problem.reason} Brzmienie przepisu: „${problem.quote}”`
    ),
    "Popraw odpowiedź: tezę, której przepis nie zawiera, usuń albo zastąp tym, co przepis rzeczywiście stanowi. Jeżeli tezę wspiera inny przepis, powołaj go z nazwą aktu — aplikacja zweryfikuje go w ELI. Nie przypisuj przepisowi treści z pamięci. Pozostałe części odpowiedzi zostaw bez zmian i podaj pełną poprawioną odpowiedź."
  ].join("\n");
}

/** The mark shown instead of ✅ when the correction round did not fix the claim. */
export function statuteContentWarning(problem: SemanticVerdict): string {
  const quote = problem.quote.replace(/\s+/g, " ").replace(/[[\]]/g, "").trim();
  return `⚠️ [PRZEPIS ODCZYTANY, TEZA ${problem.claim === "UNSUPPORTED" ? "NIEPOTWIERDZONA" : "POTWIERDZONA CZĘŚCIOWO"}: ${problem.reason.replace(/[[\]]/g, "")} Brzmienie: „${quote}”]`;
}

/**
 * After every gate: on a line with the warning, the provision's own ✅ marker becomes a plain
 * source mark — the provision and its wording were read (the link stays), the thesis was not
 * confirmed, so no ✅ stands next to it. Markers of other provisions on the line stay.
 */
export function demoteContradictedMarkers(text: string, contradicted: ReadonlyArray<{ warning: string; marker: string }>): string {
  if (!contradicted.length) return text;
  return text
    .split("\n")
    .map((line) => {
      let out = line;
      for (const item of contradicted) {
        if (!out.includes(item.warning) || !out.includes(item.marker)) continue;
        const inner = item.marker.replace(/^✅\s*\[VER:\s*/u, "").replace(/\]$/u, "");
        out = out.split(item.marker).join(`[ŹRÓDŁO BRZMIENIA: ${inner}]`);
      }
      return out;
    })
    .join("\n");
}
