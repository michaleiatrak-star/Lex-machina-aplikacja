// Who is a party is read from the court records' headings, never guessed from who speaks most
// (user report 2026-11-17: an automatic pleading named the witness "Powód: Jurij" and was addressed
// to the older case VII P 94/25 instead of XI P 27/26, whose hearing the question was about).
export type RecordParties = {
  documentId: string;
  signature?: string;
  date?: string;
  claimant?: string;
  respondent?: string;
  // The claims the heading names ("o wynagrodzenie za pracę, … sprostowanie świadectwa pracy").
  subject?: string;
  witnesses: string[];
};

const clean = (value: string) =>
  value
    .replace(/\s+/gu, " ")
    .replace(/^[\s:,-]+|[\s:,;-]+$/gu, "")
    .trim()
    .slice(0, 140);

const SIGNATURE = /(?:Sygn\.?\s*(?:akt)?\s*:?\s*)?\b([IVXLC]{1,6}\s+[A-Z][A-Za-z]{0,5}(?:-[A-Za-z]+)?\s+\d{1,6}\/\d{2,4})\b/u;
const DATE = /(?:Dnia|dnia|Data)[\s,:]*(\d{1,2}(?:[.\s]+(?:\d{1,2}|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia))[.\s]+\d{4})/u;
const PAIRS: ReadonlyArray<[RegExp, RegExp]> = [
  [/z\s+powództwa\s*:?\s*/iu, /\s+przeciwko\s*:?\s*/iu],
  [/z\s+wniosku\s*:?\s*/iu, /\s+z\s+udziałem\s*:?\s*/iu],
  [/z\s+odwołania\s*:?\s*/iu, /\s+od\s+(?:decyzji|orzeczenia)\s*/iu]
];
const WITNESS = /(?<![\p{L}])[Śś]wiad(?:ek|ka|kiem|kowi)\s+((?:\p{Lu}[\p{L}'-]+|\[PII[^\]]*\])(?:\s+(?:\p{Lu}[\p{L}'-]+|\[PII[^\]]*\]))?)/gu;

/** The parties, signature and date a court record's heading states; the witnesses it hears. */
export function recordParties(documentId: string, text: string): RecordParties | null {
  const head = text.slice(0, 1_800);
  const flat = head.replace(/\n\s*\d{0,3}\s*/gu, " ");
  let claimant: string | undefined;
  let respondent: string | undefined;
  let subject: string | undefined;
  for (const [opening, against] of PAIRS) {
    const start = opening.exec(flat);
    if (!start) continue;
    const rest = flat.slice(start.index + start[0].length);
    const split = against.exec(rest);
    if (!split || split.index > 160) continue;
    claimant = clean(rest.slice(0, split.index));
    const after = rest.slice(split.index + split[0].length);
    respondent = clean(after.split(/\s+o\s+(?=\p{Ll})|\s+(?:Sąd|Protokolant|Obecni|Na\s+rozpraw)/u)[0]!);
    const about = /\s+o\s+(?=\p{Ll})/u.exec(after);
    if (about && about.index < 200) {
      const claims = after.slice(about.index + about[0].length).split(/\s+(?:Rozprawę|Rozprawa|Posiedzenie|Sąd|Protokolant|Obecni|Adnotacje|Na\s+rozprawie|Po\s+wywołaniu)(?!\p{L})|\s\d{2}:\d{2}/u)[0]!;
      subject = claims.replace(/\s+/gu, " ").replace(/[\s,;.]+$/u, "").trim().slice(0, 400);
    }
    break;
  }
  const witnesses = [...new Set([...text.matchAll(WITNESS)].map((match) => clean(match[1]!)))].filter(
    (name) => !/^(?:Sąd|Przewodnicząc|Pełnomocnik|Pozwan|Powód|Powódk)/u.test(name)
  );
  if (!claimant && !respondent) return null;
  return {
    documentId,
    ...(SIGNATURE.exec(head)?.[1] ? { signature: SIGNATURE.exec(head)![1]!.replace(/\s+/gu, " ") } : {}),
    ...(DATE.exec(head)?.[1] ? { date: clean(DATE.exec(head)![1]!) } : {}),
    ...(claimant ? { claimant } : {}),
    ...(respondent ? { respondent } : {}),
    ...(subject ? { subject } : {}),
    witnesses: witnesses.slice(0, 8)
  };
}

export function recordPartiesPrompt(records: ReadonlyArray<RecordParties & { label: string }>): string {
  if (!records.length) return "";
  return [
    "# STRONY I SPRAWY Z NAGŁÓWKÓW PROTOKOŁÓW (ustalone przez aplikację)",
    ...records.map((record) =>
      [
        `- ${record.label}${record.signature ? `, sygn. ${record.signature}` : ""}${record.date ? `, ${record.date}` : ""}:`,
        record.claimant ? ` powód/wnioskodawca: ${record.claimant};` : "",
        record.respondent ? ` pozwany/uczestnik: ${record.respondent};` : "",
        record.subject ? ` przedmiot sprawy: o ${record.subject};` : "",
        record.witnesses.length ? ` świadkowie: ${record.witnesses.join(", ")}` : ""
      ].join("")
    ),
    "Zasady: (1) strony pisma bierz z nagłówka protokołu, nie z tego, kto najwięcej mówi; świadek nigdy nie jest stroną. (2) Pismo kieruj do sprawy, którą wskazuje pytanie albo wybrana sprawa; gdy pytanie jej nie wskazuje, do sprawy z najnowszego protokołu. Protokół innej sprawy to dowód (art. 244 k.p.c.), nie adresat pisma."
  ].join("\n");
}

const DATE_ORDER = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
function dateValue(date: string | undefined): number {
  if (!date) return 0;
  const words = /(\d{1,2})\s+(\p{L}+)\s+(\d{4})/u.exec(date);
  if (words) return Number(words[3]) * 10_000 + (DATE_ORDER.indexOf(words[2]!) + 1) * 100 + Number(words[1]);
  const digits = /(\d{1,2})[.\s]+(\d{1,2})[.\s]+(\d{4})/u.exec(date);
  return digits ? Number(digits[3]) * 10_000 + Number(digits[2]) * 100 + Number(digits[1]) : 0;
}

/** The case the pleading is for: the signature the question names, else the newest record. */
export function targetRecord<T extends RecordParties>(records: readonly T[], question: string): T | null {
  const folded = question.replace(/\s+/gu, " ");
  const named = records.find((record) => record.signature && folded.includes(record.signature));
  if (named) return named;
  return [...records].sort((a, b) => dateValue(b.date) - dateValue(a.date))[0] ?? null;
}

/**
 * The goal that ties the pleading to the claims of its case (XI P 27/26: a pleading on a witness's
 * credibility said nothing about which claim it serves; a chat version added a claim the case does
 * not have). Only the claims the heading names.
 */
export function subjectGoal(record: RecordParties | null): string | null {
  if (!record?.subject) return null;
  return `Wskazać, dla których żądań sprawy${record.signature ? ` ${record.signature}` : ""} wykazane fakty mają znaczenie (przedmiot sprawy z nagłówka protokołu: o ${record.subject}); nie dopisywać żądań spoza przedmiotu sprawy`;
}
