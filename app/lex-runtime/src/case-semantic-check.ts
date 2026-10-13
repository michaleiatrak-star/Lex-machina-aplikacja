import type { CitedDocument } from "./case-content-grounding.js";

// The judgment's or interpretation's text read against the user's question and what the
// answer says about it, the way a lawyer reads it in a conversation: does it concern the
// question, does it say what the answer claims. A separate model call judges; each verdict
// must quote the document word for word, and the application checks that quote, so a
// judge's own invention cannot pass as the document's content.

export type SemanticVerdict = {
  signature: string;
  topic: "MATCH" | "PARTIAL" | "NO_MATCH";
  claim: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED";
  reason: string;
  quote: string;
};

export type SemanticCheck = {
  verdicts: SemanticVerdict[];
  // Verdicts whose quote is not in the document: not used.
  rejected: string[];
};

const MAX_DOCUMENTS = 4;
const HEAD_CHARS = 1_500;
const CHUNK_CHARS = 1_200;
const MAX_CHUNKS = 4;

const fold = (value: string): string =>
  value.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLocaleLowerCase("pl");
const squeeze = (value: string): string => fold(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const words = (value: string): Set<string> =>
  new Set(squeeze(value).split(" ").filter((word) => word.length >= 5).map((word) => word.slice(0, 6)));

/** The document's head (court, date, subject) and its passages closest to the question and claim. */
export function relevantExcerpt(text: string, question: string, claim: string): string {
  const plain = text.replace(/\\[nrt]/g, " ").replace(/\s+/g, " ").trim();
  if (plain.length <= HEAD_CHARS + CHUNK_CHARS * MAX_CHUNKS) return plain;
  const wanted = new Set([...words(question), ...words(claim)]);
  const chunks: Array<{ at: number; text: string; score: number }> = [];
  for (let at = HEAD_CHARS; at < plain.length; at += CHUNK_CHARS) {
    const chunk = plain.slice(at, at + CHUNK_CHARS);
    const score = [...words(chunk)].filter((word) => wanted.has(word)).length;
    chunks.push({ at, text: chunk, score });
  }
  const best = chunks
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHUNKS)
    .sort((a, b) => a.at - b.at);
  return [plain.slice(0, HEAD_CHARS), ...best.map((chunk) => chunk.text)].join("\n[…]\n");
}

export const SEMANTIC_JUDGE_SYSTEM =
  "OCENA ZGODNOŚCI ORZECZEŃ, INTERPRETACJI I PRZEPISÓW Z PYTANIEM. Jesteś kontrolerem, nie autorem odpowiedzi. " +
  "Dla każdego dokumentu oceń wyłącznie na podstawie jego podanego tekstu: (1) topic — czy dokument dotyczy problemu z pytania użytkownika " +
  "(MATCH: tak; PARTIAL: dotyczy tylko części kryteriów pytania, np. innego podmiotu lub innego sądu niż pytany; NO_MATCH: innego problemu); " +
  "(2) claim — czy to, co odpowiedź mówi o dokumencie, wynika z jego tekstu (SUPPORTED / PARTIAL / UNSUPPORTED). " +
  "Pole quote: dosłowny fragment tekstu dokumentu (10–300 znaków), który najlepiej uzasadnia ocenę; kopiuj znak w znak, bez skracania w środku. " +
  "Nie korzystaj z wiedzy spoza podanego tekstu. Zwróć wyłącznie JSON: " +
  '{"verdicts":[{"signature":"…","topic":"MATCH|PARTIAL|NO_MATCH","claim":"SUPPORTED|PARTIAL|UNSUPPORTED","reason":"jedno zdanie po polsku","quote":"…"}]}';

const KIND_LABEL: Record<CitedDocument["kind"], string> = { case: "orzeczenie", interpretation: "interpretacja", other: "orzeczenie lub decyzja", statute: "przepis (brzmienie z ELI)" };

export function semanticJudgePrompt(question: string, documents: CitedDocument[]): string {
  return [
    `PYTANIE UŻYTKOWNIKA (wątek):\n${question.trim()}`,
    ...documents.slice(0, MAX_DOCUMENTS).map((document, index) =>
      [
        `DOKUMENT D${index + 1}: ${KIND_LABEL[document.kind]} ${document.signature}`,
        `CO ODPOWIEDŹ MÓWI O NIM:\n${document.claim.trim()}`,
        `TEKST DOKUMENTU (fragmenty pobrane ze źródła):\n${relevantExcerpt(document.text, question, document.claim)}`
      ].join("\n\n")
    )
  ].join("\n\n---\n\n");
}

const TOPICS = new Set(["MATCH", "PARTIAL", "NO_MATCH"]);
const CLAIMS = new Set(["SUPPORTED", "PARTIAL", "UNSUPPORTED"]);

/** The judge's JSON, each verdict kept only when its quote is in that document's text. */
export function parseSemanticVerdicts(output: string, documents: CitedDocument[]): SemanticCheck {
  const json = /\{[\s\S]*\}/u.exec(output)?.[0];
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    raw = null;
  }
  const items = Array.isArray((raw as { verdicts?: unknown } | null)?.verdicts) ? ((raw as { verdicts: unknown[] }).verdicts) : [];
  const verdicts: SemanticVerdict[] = [];
  const rejected: string[] = [];
  for (const item of items) {
    const value = item as Partial<SemanticVerdict>;
    const document = documents.find((candidate) => squeeze(candidate.signature) === squeeze(String(value.signature ?? "")));
    if (!document || !TOPICS.has(String(value.topic)) || !CLAIMS.has(String(value.claim))) continue;
    const quote = String(value.quote ?? "").trim();
    if (quote.length < 10 || !squeeze(document.text).includes(squeeze(quote))) {
      rejected.push(document.signature);
      continue;
    }
    verdicts.push({
      signature: document.signature,
      topic: value.topic as SemanticVerdict["topic"],
      claim: value.claim as SemanticVerdict["claim"],
      reason: String(value.reason ?? "").trim().slice(0, 400),
      quote: quote.slice(0, 300)
    });
  }
  return { verdicts, rejected };
}

export const semanticProblems = (check: SemanticCheck): SemanticVerdict[] =>
  check.verdicts.filter((verdict) => verdict.topic !== "MATCH" || verdict.claim !== "SUPPORTED");

export function semanticCorrectionPrompt(problems: SemanticVerdict[]): string {
  return [
    "KONTROLA ZGODNOŚCI Z PYTANIEM (aplikacja, na podstawie pobranego tekstu dokumentów):",
    ...problems.map(
      (problem) =>
        `- ${problem.signature}: temat ${problem.topic}, twierdzenie ${problem.claim}. ${problem.reason} Tekst dokumentu: „${problem.quote}”`
    ),
    "Popraw odpowiedź: dokument, który nie dotyczy pytania (NO_MATCH), nie jest trafieniem — nie przedstawiaj go jako odpowiedzi na pytanie. Dokument częściowo zgodny (PARTIAL) opisz z nazwaniem brakującego kryterium. Twierdzenie niepoparte (UNSUPPORTED) usuń albo zastąp tym, co rzeczywiście jest w tekście.",
    "Gdy po poprawce żaden dokument nie odpowiada na pytanie, napisz wprost, że nie znaleziono orzeczenia ani interpretacji spełniającej kryteria, i co sprawdzono. Podaj pełną poprawioną odpowiedź."
  ].join("\n");
}

export function semanticWarning(problems: SemanticVerdict[]): string {
  const label = { MATCH: "dotyczy pytania", PARTIAL: "dotyczy pytania tylko częściowo", NO_MATCH: "nie dotyczy pytania" } as const;
  return problems
    .map(
      (problem) =>
        `⚠️ Kontrola aplikacji: ${problem.signature} ${label[problem.topic]}${problem.claim === "SUPPORTED" ? "" : "; opis w odpowiedzi nie w pełni wynika z jego tekstu"}. ${problem.reason} Tekst dokumentu: „${problem.quote}”`
    )
    .join("\n");
}
