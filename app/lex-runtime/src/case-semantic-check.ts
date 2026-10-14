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
  // What the judge read as the thesis attributed to the document and as the question's
  // criteria: the verdict is about exactly these, and the correction names them.
  thesis?: string;
  criteria?: string;
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

/** Passages labelled by role, chosen as relevantExcerpt chooses them: the heading, the
 * decision, the start of the authority's own assessment, then the passages whose rare words
 * the question and the claim share, within the same budget, without the portal's chrome. */
export function roleExcerpt(text: string, question: string, claim: string): string {
  const passages: Array<{ role: PassageRole; text: string; index: number }> = [];
  for (const sentence of passageRoles(cleanText(text).replace(/(?<=[.;!?])\s+/gu, "\n"))) {
    const last = passages.at(-1);
    if (last && last.role === sentence.role && last.text.length + sentence.text.length < PASSAGE_CHARS) last.text += ` ${sentence.text}`;
    else passages.push({ ...sentence, index: passages.length });
  }
  const label = (passage: { role: PassageRole; text: string }) => `[${passage.role}] ${passage.text}`;
  const subject = caseSubject(text);
  const pinned = subject ? `[OKREŚLENIE SPRAWY] ${subject}\n` : "";
  if (passages.reduce((sum, passage) => sum + passage.text.length, 0) <= BUDGET_CHARS) return pinned + passages.map(label).join("\n");
  const chosen = new Set<number>();
  let used = 0;
  const take = (index: number): void => {
    const passage = passages[index];
    if (!passage || chosen.has(index) || used + passage.text.length > BUDGET_CHARS) return;
    chosen.add(index);
    used += passage.text.length;
  };
  for (const passage of passages) {
    if (used >= HEAD_CHARS) break;
    take(passage.index);
  }
  for (const passage of passages.filter((item) => DECISIVE.includes(item.role)).slice(0, 3)) take(passage.index);
  const assessment = passages.find((item) => !chosen.has(item.index) && (item.role === "OCENA ORGANU ORZEKAJĄCEGO" || ASSESSMENT.test(item.text)));
  if (assessment) {
    take(assessment.index);
    take(assessment.index + 1);
  }
  const passageStems = passages.map((passage) => new Set(stems(passage.text)));
  const df = new Map<string, number>();
  for (const set of passageStems) for (const stem of set) df.set(stem, (df.get(stem) ?? 0) + 1);
  const wanted = new Set([...stems(question), ...stems(claim)]);
  const scored = passages
    .map((passage) => {
      let score = 0;
      for (const stem of passageStems[passage.index]!) if (wanted.has(stem)) score += Math.log(1 + passages.length / (df.get(stem) ?? 1));
      return { index: passage.index, score: score + (passage.role === "OCENA ORGANU ORZEKAJĄCEGO" ? 0.5 : 0) };
    })
    .filter((item) => item.score > 0.5)
    .sort((a, b) => b.score - a.score);
  for (const item of scored) take(item.index);
  const parts: string[] = [];
  let previous = -2;
  for (const index of [...chosen].sort((a, b) => a - b)) {
    parts.push(index === previous + 1 ? label(passages[index]!) : `[…]\n${label(passages[index]!)}`);
    previous = index;
  }
  return pinned + parts.join("\n").replace(/^\[…\]\n/u, "");
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
  "Zanim ocenisz, zdefiniuj przedmiot oceny: criteria — kryteria, które pytanie rzeczywiście stawia (problem prawny; jeżeli pytanie je wskazuje: sąd lub organ, " +
  "rodzaj dokumentu, okres, podmiot), bez dopisywania własnych; thesis — jedno zdanie: co dokładnie odpowiedź twierdzi o tym dokumencie (jego rozstrzygnięcie lub " +
  "stanowisko, które mu przypisuje), wiernie, bez dodawania i pomijania zastrzeżeń; gdy odpowiedź przypisuje dokumentowi kilka twierdzeń, ujmij wszystkie. " +
  "topic oceniaj względem criteria, claim względem thesis. " +
  "Pole quote: dosłowny fragment tekstu dokumentu (10–300 znaków), który najlepiej uzasadnia ocenę; kopiuj znak w znak, bez skracania w środku. " +
  "Nie korzystaj z wiedzy spoza podanego tekstu. Zwróć wyłącznie JSON: " +
  '{"verdicts":[{"signature":"…","criteria":"…","thesis":"…","topic":"MATCH|PARTIAL|NO_MATCH","claim":"SUPPORTED|PARTIAL|UNSUPPORTED","reason":"jedno zdanie po polsku","quote":"…"}]}';

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
      quote: quote.slice(0, 300),
      ...(typeof value.thesis === "string" && value.thesis.trim() ? { thesis: value.thesis.trim().slice(0, 500) } : {}),
      ...(typeof value.criteria === "string" && value.criteria.trim() ? { criteria: value.criteria.trim().slice(0, 300) } : {})
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
        `- ${problem.signature}: temat ${problem.topic}, twierdzenie ${problem.claim}.${problem.criteria ? ` Kryteria pytania: ${problem.criteria}.` : ""}${problem.thesis ? ` Oceniona teza odpowiedzi: „${problem.thesis}”.` : ""} ${problem.reason} Tekst dokumentu: „${problem.quote}”`
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
        `⚠️ Kontrola aplikacji: ${problem.signature} ${label[problem.topic]}${problem.claim === "SUPPORTED" ? "" : "; opis w odpowiedzi nie w pełni wynika z jego tekstu"}.${problem.claim !== "SUPPORTED" && problem.thesis ? ` Sprawdzana teza: „${problem.thesis}”.` : ""} ${problem.reason} Tekst dokumentu: „${problem.quote}”`
    )
    .join("\n");
}
