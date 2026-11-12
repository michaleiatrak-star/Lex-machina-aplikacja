import { citedDocuments, type CitedDocument } from "./case-content-grounding.js";
import { parseSemanticVerdicts, relevantExcerpt, type SemanticCheck, type SemanticVerdict } from "./case-semantic-check.js";
import type { VerificationRecord } from "./verification-ledger.js";

// Kontrola treści przepisów (2026-11-09, odpowiedź Bielika o porozumieniu rozwiązującym):
// aplikacja zweryfikowała art. 100 § 2 KP i postawiła ✅, a odpowiedź przypisała mu „zasadę
// proporcjonalności” — przepis istniał, teza nie. Weryfikacja ELI/RAG potwierdza istnienie
// i brzmienie; ta kontrola sprawdza, czy brzmienie mówi to, co odpowiedź o nim twierdzi.

export const STATUTE_JUDGE_BATCH = 4;
// A local model serves one request at a time (llama.cpp --parallel 1): its provisions go in one
// call, each further call is another prompt evaluation and another wait.
export const STATUTE_JUDGE_BATCH_LOCAL = 8;

/**
 * The judge of a provision's content only asks whether its wording carries the answer's claim:
 * no topic, criteria or thesis for a provision that agrees, which were most of the output
 * (2026-11-10: a verdict ran 150–250 tokens; on a local model a batch of four took minutes).
 * Reason, thesis and quote only where the claim is not carried.
 */
export const STATUTE_JUDGE_SYSTEM =
  "KONTROLA TREŚCI PRZEPISÓW. Jesteś kontrolerem, nie autorem odpowiedzi. Dla każdego przepisu oceń wyłącznie na podstawie jego podanego brzmienia, " +
  "czy to, co odpowiedź mówi o przepisie, z niego wynika: SUPPORTED — sens się zgadza (także parafraza); PARTIAL — część twierdzenia nie wynika albo pominięto istotne zastrzeżenie; " +
  "UNSUPPORTED — brzmienie mówi co innego albo nic o tym nie mówi. Różnica słów przy tym samym sensie to SUPPORTED. Nie korzystaj z wiedzy spoza podanego brzmienia. " +
  "Zwróć wyłącznie JSON z pozycją dla każdego przepisu. Dla SUPPORTED tylko signature i claim. Dla PARTIAL i UNSUPPORTED dodaj thesis (jedno zdanie: co odpowiedź twierdzi o przepisie), " +
  "reason (jedno zdanie po polsku) i quote (dosłowny fragment brzmienia, 10–200 znaków, znak w znak): " +
  '{"verdicts":[{"signature":"…","claim":"SUPPORTED"},{"signature":"…","claim":"UNSUPPORTED","thesis":"…","reason":"…","quote":"…"}]}';

export function statuteJudgePrompt(documents: CitedDocument[]): string {
  return documents
    .map((document, index) =>
      [
        `PRZEPIS P${index + 1}: ${document.signature}`,
        `CO ODPOWIEDŹ MÓWI O NIM:\n${document.claim.trim()}`,
        `BRZMIENIE (z ELI):\n${relevantExcerpt(document.text, "", document.claim)}`
      ].join("\n\n")
    )
    .join("\n\n---\n\n");
}

/** Verdicts of the compact judge: an agreeing provision needs no quote; a problem keeps the quote check. */
export function parseStatuteVerdicts(output: string, documents: CitedDocument[]): SemanticCheck {
  const json = /\{[\s\S]*\}/u.exec(output)?.[0];
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    raw = null;
  }
  const items = Array.isArray((raw as { verdicts?: unknown } | null)?.verdicts) ? (raw as { verdicts: Array<Record<string, unknown>> }).verdicts : [];
  // Problems go through the shared parser (quote must be in the wording); agreements are kept as they are.
  const problems = parseSemanticVerdicts(
    JSON.stringify({ verdicts: items.filter((item) => item.claim !== "SUPPORTED").map((item) => ({ ...item, topic: "MATCH" })) }),
    documents
  );
  const agreed = items
    .filter((item) => item.claim === "SUPPORTED")
    .flatMap((item) => {
      const document = documents.find((candidate) => comparable(candidate.signature) === comparable(String(item.signature ?? "")));
      return document ? [{ signature: document.signature, topic: "MATCH" as const, claim: "SUPPORTED" as const, reason: "", quote: "" }] : [];
    });
  return { verdicts: [...agreed, ...problems.verdicts], rejected: problems.rejected };
}

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
