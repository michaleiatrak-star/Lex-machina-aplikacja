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
const PASSAGE_CHARS = 900;
const BUDGET_CHARS = 8_000;

const fold = (value: string): string =>
  value.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLocaleLowerCase("pl");
const squeeze = (value: string): string => fold(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const stems = (value: string): string[] => squeeze(value).split(" ").filter((word) => word.length >= 5).map((word) => word.slice(0, 6));

// Lines of a court portal around the document (ETPC base of the Ministry of Justice, SAOS, CBOSA).
const PORTAL_LINE =
  /browser is ancient|chrome frame|pliki?\s+cookies|cookies|liczba dokumentów w bazie|ostatnia aktualizacja|^\s*(?:metryka|treść|drukuj|pobierz|bip|x|d)\s*$/iu;
// Where the court's or authority's own assessment begins: what separates its view from a
// party's argument it reports.
const ASSESSMENT =
  /(?:sąd|izba|trybunał|organ|prezes(?:\s+urzędu)?|sąd najwyższy|sąd apelacyjny|sąd okręgowy|sąd rejonowy|sąd odwoławczy|krajowa izba odwoławcza)\s+(?:\p{L}+\s+){0,3}(?:zważył|zważyła|ustalił(?:a)?\s+i\s+zważył(?:a)?|uznał(?:a)?,|stwierdził(?:a)?,|podzielił(?:a)?|nie\s+podzielił(?:a)?)|ocena\s+stanowiska|uzasadnienie\s+interpretacji|stanowisko\s+organu|w\s+ocenie\s+(?:sądu|izby|trybunału|organu|prezesa)|apelacja\s+(?:nie\s+)?(?:jest|była|zasługiwała)|skarga\s+(?:kasacyjna\s+)?(?:nie\s+)?(?:jest|zasługuje|zasługiwała)|odwołanie\s+(?:nie\s+)?zasługuje|zarzut\p{L}*\s+(?:\p{L}+\s+){0,2}(?:okazał|nie\s+zasługuj|jest\s+bezzasadn|są\s+bezzasadn|chybion)/iu;

function cleanText(text: string): string {
  return text
    .replace(/\\[nrt]/g, "\n")
    .split(/\n+/u)
    .filter((line) => !PORTAL_LINE.test(line))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

// Passages of whole sentences, so a sentence the judge must quote is not cut at a boundary.
function passages(plain: string): Array<{ at: number; text: string }> {
  const sentences = plain.match(/[^.!?;]+(?:[.!?;]+|$)\s*/gu) ?? [plain];
  const out: Array<{ at: number; text: string }> = [];
  let at = 0, current = "", start = 0;
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > PASSAGE_CHARS) {
      out.push({ at: start, text: current.trim() });
      start = at;
      current = "";
    }
    current += sentence;
    at += sentence.length;
  }
  if (current.trim()) out.push({ at: start, text: current.trim() });
  return out;
}

/** The document's head (court, date, subject), the start of the court's own assessment and
 * the passages closest to the question and claim, weighted by how rare their words are. */
export function relevantExcerpt(text: string, question: string, claim: string): string {
  const plain = cleanText(text);
  if (plain.length <= BUDGET_CHARS) return plain;
  const head = plain.slice(0, HEAD_CHARS).replace(/\s\S*$/u, "");
  const rest = passages(plain.slice(head.length));
  const df = new Map<string, number>();
  const passageStems = rest.map((passage) => new Set(stems(passage.text)));
  for (const set of passageStems) for (const stem of set) df.set(stem, (df.get(stem) ?? 0) + 1);
  const wanted = new Set([...stems(question), ...stems(claim)]);
  const scored = rest.map((passage, index) => {
    let score = 0;
    for (const stem of passageStems[index]!) if (wanted.has(stem)) score += Math.log(1 + rest.length / (df.get(stem) ?? 1));
    return { ...passage, index, score };
  });
  const chosen = new Set<number>();
  // The court's assessment: the first passage where it begins, and the next one.
  const assessment = scored.find((passage) => ASSESSMENT.test(passage.text));
  if (assessment) {
    chosen.add(assessment.index);
    if (assessment.index + 1 < scored.length) chosen.add(assessment.index + 1);
  }
  let used = head.length + [...chosen].reduce((sum, index) => sum + scored[index]!.text.length, 0);
  for (const passage of [...scored].filter((item) => item.score > 0).sort((a, b) => b.score - a.score)) {
    if (chosen.has(passage.index)) continue;
    if (used + passage.text.length > BUDGET_CHARS) continue;
    chosen.add(passage.index);
    used += passage.text.length;
  }
  const parts: string[] = [head];
  let previous = -2;
  for (const index of [...chosen].sort((a, b) => a - b)) {
    parts.push(index === previous + 1 ? scored[index]!.text : `[…] ${scored[index]!.text}`);
    previous = index;
  }
  return parts.join("\n");
}

export const SEMANTIC_JUDGE_SYSTEM =
  "OCENA ZGODNOŚCI ORZECZEŃ, INTERPRETACJI I PRZEPISÓW Z PYTANIEM. Jesteś kontrolerem, nie autorem odpowiedzi. " +
  "Dla każdego dokumentu oceń wyłącznie na podstawie jego podanego tekstu: (1) topic — czy dokument dotyczy problemu z pytania użytkownika " +
  "(MATCH: tak; PARTIAL: dotyczy tylko części kryteriów pytania, np. innego podmiotu lub innego sądu niż pytany; NO_MATCH: innego problemu); " +
  "(2) claim — czy to, co odpowiedź mówi o dokumencie, wynika z jego tekstu (SUPPORTED: sens się zgadza, także przy parafrazie lub innych słowach; " +
  "PARTIAL: część twierdzenia nie wynika z tekstu albo pominięto istotne zastrzeżenie; UNSUPPORTED: tekst mówi co innego lub odwrotnie). " +
  "Różnica słów przy tym samym sensie to nie PARTIAL. " +
  "Odróżniaj stanowisko sądu lub organu od stanowiska strony, które dokument tylko relacjonuje (żądanie lub zarzuty powoda, apelującego, skarżącego, odwołującego, " +
  "wnioskodawcy interpretacji, organu w odpowiedzi na skargę, prokuratora): gdy odpowiedź przypisuje sądowi lub organowi to, co w tekście jest argumentem strony, " +
  "którego sąd lub organ nie podzielił albo nie rozstrzygał, claim = UNSUPPORTED, a quote wskaż z fragmentu z oceną sądu lub organu, jeśli jest. Oceniaj to, co odpowiedź mówi o treści i rozstrzygnięciu; dane identyfikacyjne " +
  "(sąd wynikający z sygnatury, data, rodzaj orzeczenia) sprawdza osobno aplikacja — ich brak w podanym fragmencie nie jest powodem do PARTIAL. " +
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
