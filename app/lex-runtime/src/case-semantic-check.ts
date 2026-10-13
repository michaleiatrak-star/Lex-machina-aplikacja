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

// Who says what in the document: only the competent authority's decision (operative part,
// thesis, its own reasoning) can support "the court/organ held". A party's argument, an
// appeal ground, an applicant's view the organ rejected or a dissent cannot.
export type PassageRole = "ROZSTRZYGNIĘCIE" | "TEZA" | "OCENA ORGANU ORZEKAJĄCEGO" | "STANOWISKO STRONY" | "ZDANIE ODRĘBNE" | "INNE";

const ROLE_MARKERS: Array<[RegExp, PassageRole]> = [
  [/^\s*zdanie\s+odrębne/iu, "ZDANIE ODRĘBNE"],
  [/stanowisk\p{L}*[^.]{0,160}?\bjest\s+(?:nie)?prawidłow\p{L}*/iu, "ROZSTRZYGNIĘCIE"],
  [/^\s*(?:sentencja|teza)\b/iu, "TEZA"],
  [/^\s*(?:\p{Lu}[\p{L} ]{0,80}\s)?(?:orzeka|postanawia|oddala|uchyla|zasądza|umarza|uwzględnia|odrzuca|nakłada|nakazuje|zobowiązuje|stwierdza nieważność)\b/iu, "ROZSTRZYGNIĘCIE"],
  [/(?:\bzważył\p{L}*|\bIzba\s+zważyła|W\s+ocenie\s+(?:Sądu|Izby|Trybunału|Prezesa|organu)|Trybunał\s+(?:Konstytucyjny\s+)?(?:stwierdza|uznał|uznaje)|Prezes\s+(?:Urzędu|UODO)\s+(?:ustalił|uznał|stwierdził)|Ocena\s+stanowiska|Uzasadnienie\s+interpretacji|Zarzut\p{L}*\s+(?:ten|te|nie|są|jest)|Sąd\s+(?:Najwyższy\s+|Apelacyjny\s+|Okręgowy\s+|Rejonowy\s+)?(?:w\s+tym\s+składzie\s+)?(?:uznał|uznaje|stwierdza|stwierdził|podziela|nie\s+podziela|przyjął))/u, "OCENA ORGANU ORZEKAJĄCEGO"],
  [/(?:\bW\s+(?:skardze|apelacji|kasacji|odwołaniu|zażaleniu|sprzeciwie|odpowiedzi\s+na)|\b(?:Skarżąc\p{L}*|Powód\p{L}*|Powódk\p{L}*|Pozwan\p{L}*|Odwołując\p{L}*|Obrońca|Oskarżon\p{L}*|Wnioskodawc\p{L}*|Uczestni\p{L}*)\s+(?:podn\p{L}*|twierdzi\p{L}*|wnosi\p{L}*|zarzuci\p{L}*|uważa\p{L}*|argumentowa\p{L}*|wskazywa\p{L}*)|Stanowisko\s+Wnioskodawcy|Rząd\s+twierdził|Administrator\s+wyjaśnił|[Bb]ank\s+wnosił|Prokurator\s+(?:Generalny\s+)?wnosił|[Oo]rgan\s+(?:w\s+odpowiedzi|podatkowy\s+twierdził|twierdził)|\bW\s+piśmie\s+procesowym|\bW\s+postępowaniu\s+głównym)/iu, "STANOWISKO STRONY"]
];

/** The text in sentences, each with the role of the passage it stands in. */
export function passageRoles(text: string): Array<{ role: PassageRole; text: string }> {
  const sentences = text.replace(/\\[nrt]/g, "\n").split(/(?<=[.;!?])(?<!\b(?:r|art|ust|pkt|poz|sygn|nr|tj|np|tzw|ok|zm|Dz|U|par|lit|godz|zł|ww|t)\.)\s+|\n+/u).map((sentence) => sentence.trim()).filter(Boolean);
  let current: PassageRole = "INNE";
  let dissent = false;
  return sentences.map((sentence) => {
    const marked = ROLE_MARKERS.find(([pattern]) => pattern.test(sentence))?.[1];
    if (marked === "ZDANIE ODRĘBNE") dissent = true;
    if (marked && !dissent) current = marked;
    return { role: dissent ? "ZDANIE ODRĘBNE" : current, text: sentence };
  });
}

const DECISIVE: PassageRole[] = ["ROZSTRZYGNIĘCIE", "TEZA"];

// What the case is about, as the document or its register entry names it ("w przedmiocie
// udostępnienia informacji publicznej", CBOSA "Hasła tematyczne", EUREKA "Temat
// interpretacji"). Pinned at the top of the excerpt: the judge reads it first and it is never
// cut out of a long document (calibration 2026-10-13: a separate subject-only call is safe but
// costs more than it saves when checking an answer).
const SUBJECT_PATTERNS = [
  /(?:Sprawa\s+ze\s+skargi|skargi|odwołania|wniosku)[^.\n]{0,200}?\bw\s+przedmiocie\s+[^.\n]{5,200}/iu,
  /\bw\s+przedmiocie\s+[^.\n]{5,200}/iu,
  /\bHasła\s+tematyczne\s*[:\-]?\s*[^\n]{3,200}/iu,
  /\bTemat\s+interpretacji\s*[:\-]?\s*[^\n]{3,200}/iu,
  /\bprzedmiot(?:\s+sprawy)?\s*[:\-]\s*[^\n]{3,200}/iu,
  /\bw\s+sprawie\s+(?:z\s+powództwa|ze\s+skargi|z\s+wniosku)[^.\n]{5,240}/iu
];

export function caseSubject(text: string): string | null {
  const plain = text.replace(/\\[nrt]/g, "\n");
  for (const pattern of SUBJECT_PATTERNS) {
    const found = pattern.exec(plain)?.[0]?.trim();
    if (found) return found.replace(/\s+/g, " ");
  }
  return null;
}

/** Passages labelled by role: the decision always, then the closest reasoning and other passages. */
export function roleExcerpt(text: string, question: string, claim: string): string {
  const passages: Array<{ role: PassageRole; text: string; at: number }> = [];
  passageRoles(text).forEach((sentence, at) => {
    const last = passages.at(-1);
    if (last && last.role === sentence.role && last.text.length + sentence.text.length < CHUNK_CHARS) last.text += ` ${sentence.text}`;
    else passages.push({ ...sentence, at });
  });
  const total = passages.reduce((sum, passage) => sum + passage.text.length, 0);
  const label = (passage: { role: PassageRole; text: string }) => `[${passage.role}] ${passage.text}`;
  const subject = caseSubject(text);
  const pinned = subject ? `[OKREŚLENIE SPRAWY] ${subject}\n` : "";
  if (total <= HEAD_CHARS + CHUNK_CHARS * MAX_CHUNKS) return pinned + passages.map(label).join("\n");
  const wanted = new Set([...words(question), ...words(claim)]);
  const score = (value: string) => [...words(value)].filter((word) => wanted.has(word)).length;
  const head: typeof passages = [];
  let headChars = 0;
  for (const passage of passages) {
    if (headChars >= HEAD_CHARS / 2) break;
    head.push(passage);
    headChars += passage.text.length;
  }
  const rest = passages.filter((passage) => !head.includes(passage));
  const decisive = rest.filter((passage) => DECISIVE.includes(passage.role));
  const others = rest
    .filter((passage) => !DECISIVE.includes(passage.role))
    .map((passage) => ({ passage, score: score(passage.text) + (passage.role === "OCENA ORGANU ORZEKAJĄCEGO" ? 1 : 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHUNKS + 1)
    .map((item) => item.passage);
  const chosen = [...head, ...decisive.slice(0, 3), ...others].sort((a, b) => a.at - b.at);
  return pinned + chosen.map(label).join("\n[…]\n");
}

// The competent authority's decision, not a party's claim.
export const AUTHORITY_RULE =
  "Twierdzenie, że sąd lub organ coś orzekł, uznał lub przyjął, popiera wyłącznie rozstrzygnięcie, teza albo własne rozważania właściwego organu orzekającego. " +
  "Argument strony, zarzut skargi, apelacji lub kasacji, stanowisko organu będącego stroną sporu sądowego, stanowisko wnioskodawcy uznane za nieprawidłowe i zdanie odrębne " +
  "nie są stanowiskiem organu — przypisanie ich sądowi lub organowi to UNSUPPORTED (chyba że organ je przyjął, np. „stanowisko wnioskodawcy jest prawidłowe”). ";

export const ROLE_LEGEND =
  "Fragmenty tekstu mają w nawiasach kwadratowych rolę nadaną mechanicznie przez aplikację (OKREŚLENIE SPRAWY, ROZSTRZYGNIĘCIE, TEZA, OCENA ORGANU ORZEKAJĄCEGO, STANOWISKO STRONY, ZDANIE ODRĘBNE, INNE); " +
  "określenie sprawy mówi, czego dotyczy dokument — gdy wyraźnie wskazuje inny problem niż pytanie, to NO_MATCH; " +
  "traktuj ją jako wskazówkę, a w razie sprzeczności z treścią rozstrzyga treść. Cytat w polu quote kopiuj bez etykiety. ";

export const SEMANTIC_JUDGE_SYSTEM =
  "OCENA ZGODNOŚCI ORZECZEŃ, INTERPRETACJI I PRZEPISÓW Z PYTANIEM. Jesteś kontrolerem, nie autorem odpowiedzi. " +
  "Dla każdego dokumentu oceń wyłącznie na podstawie jego podanego tekstu: (1) topic — czy dokument dotyczy problemu z pytania użytkownika " +
  "(MATCH: tak; PARTIAL: dotyczy tylko części kryteriów pytania, np. innego podmiotu lub innego sądu niż pytany; NO_MATCH: innego problemu); " +
  "(2) claim — czy to, co odpowiedź mówi o dokumencie, wynika z jego tekstu (SUPPORTED: sens się zgadza, także przy parafrazie lub innych słowach; " +
  "PARTIAL: część twierdzenia nie wynika z tekstu albo pominięto istotne zastrzeżenie; UNSUPPORTED: tekst mówi co innego lub odwrotnie). " +
  "Różnica słów przy tym samym sensie to nie PARTIAL. Oceniaj to, co odpowiedź mówi o treści i rozstrzygnięciu; dane identyfikacyjne " +
  "(sąd wynikający z sygnatury, data, rodzaj orzeczenia) sprawdza osobno aplikacja — ich brak w podanym fragmencie nie jest powodem do PARTIAL. " +
  "Pole quote: dosłowny fragment tekstu dokumentu (10–300 znaków), który najlepiej uzasadnia ocenę; kopiuj znak w znak, bez skracania w środku. " +
  "Nie korzystaj z wiedzy spoza podanego tekstu. Zwróć wyłącznie JSON: " +
  '{"verdicts":[{"signature":"…","topic":"MATCH|PARTIAL|NO_MATCH","claim":"SUPPORTED|PARTIAL|UNSUPPORTED","reason":"jedno zdanie po polsku","quote":"…"}]}';

const KIND_LABEL: Record<CitedDocument["kind"], string> = { case: "orzeczenie", interpretation: "interpretacja", other: "orzeczenie lub decyzja", statute: "przepis (brzmienie z ELI)" };

export type JudgeOptions = { roles?: boolean; fullText?: boolean };

export function semanticJudgePrompt(question: string, documents: CitedDocument[], options: JudgeOptions = {}): string {
  return [
    `PYTANIE UŻYTKOWNIKA (wątek):\n${question.trim()}`,
    ...documents.slice(0, MAX_DOCUMENTS).map((document, index) =>
      [
        `DOKUMENT D${index + 1}: ${KIND_LABEL[document.kind]} ${document.signature}`,
        `CO ODPOWIEDŹ MÓWI O NIM:\n${document.claim.trim()}`,
        options.fullText
          ? `TEKST DOKUMENTU (pełny):\n${document.text}`
          : `TEKST DOKUMENTU (fragmenty pobrane ze źródła):\n${options.roles ? roleExcerpt(document.text, question, document.claim) : relevantExcerpt(document.text, question, document.claim)}`
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

// Correction when the document is off the question or the answer misstates it. A document
// that answers only part of the question, described faithfully, needs none (calibration
// 2026-10-13: such answers usually say so themselves).
export const semanticProblems = (check: SemanticCheck): SemanticVerdict[] =>
  check.verdicts.filter((verdict) => verdict.topic === "NO_MATCH" || verdict.claim !== "SUPPORTED");

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
