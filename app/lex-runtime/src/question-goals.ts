// What the user asks the pleading to prove is a goal of its own (V P 3/26 run, 2026-11-17: "wykaż …
// oraz to, że byłem na L4 od 09.09.2024 do 07.10.2024, a wiadomość … 29.09.2024 przyszła pod koniec
// tego okresu" never reached the goals; only the matrix differences did). The question's demands
// become the first goals, and its dates are checked against the documents: a date or period the
// documents confirm, and which date falls inside which period, is stated for the model, not guessed.

const PROOF = /(?<!\p{L})(?:wykaż|wykazać|wykazac|udowodnij|udowodnić|wskaż|wskazać|odnieś|odnieść|podnieś|podnieść|zakwestionuj|zakwestionować|uwzględnij|uwzględnić|podkreśl|podkreślić)(?!\p{L})/iu;

/** The demands of the question ("Wykaż X oraz to, że Y; odnieś to do Z"), each a goal. */
export function questionGoals(question: string, limit = 4): string[] {
  const start = question.search(PROOF);
  if (start < 0) return [];
  const goals: string[] = [];
  let verb = "Wykazać";
  for (const raw of question.slice(start).split(/;|\.\s+(?=\p{Lu})|\s+oraz\s+(?=to,?\s+że(?!\p{L}))|\s+oraz\s+(?=(?:wykaż|odnieś|wskaż|podnieś|uwzględnij)(?!\p{L}))/iu)) {
    let part = raw.replace(/\s+/gu, " ").trim().replace(/[.;,]+$/u, "");
    if (!part) continue;
    const own = PROOF.exec(part);
    if (own && own.index === 0) verb = /^odnie/iu.test(own[0]) ? "Odnieść" : /^wska/iu.test(own[0]) ? "Wskazać" : "Wykazać";
    else if (/^to,?\s+że(?!\p{L})/iu.test(part)) part = `${verb}, że ${part.replace(/^to,?\s+że\s+/iu, "")}`;
    else continue;
    // "odnieś to do …" refers back: it belongs to the previous demand.
    if (/^odnie\p{L}*\s+(?:to|do\s+tego)(?!\p{L})/iu.test(part) && goals.length) goals[goals.length - 1] += `; ${part.charAt(0).toLowerCase()}${part.slice(1)}`;
    else if (part.split(" ").length >= 4) goals.push(part.charAt(0).toUpperCase() + part.slice(1));
    if (goals.length >= limit) break;
  }
  return goals;
}

const MONTHS = ["stycz", "lut", "marc", "kwie", "maj", "czerw", "lip", "sierp", "wrze", "paźdz", "listop", "grud"];
const iso = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** Every date in the text as YYYY-MM-DD: 09.09.2024, 9.9.2024 r., 2024-09-09, 29 września 2024. */
export function datesIn(text: string): Array<{ date: string; at: number }> {
  const found: Array<{ date: string; at: number }> = [];
  for (const match of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/gu)) found.push({ date: iso(+match[3]!, +match[2]!, +match[1]!), at: match.index! });
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/gu)) found.push({ date: iso(+match[1]!, +match[2]!, +match[3]!), at: match.index! });
  for (const match of text.matchAll(/\b(\d{1,2})\s+(\p{L}+)\s+(\d{4})\b/gu)) {
    const month = MONTHS.findIndex((stem) => match[2]!.toLocaleLowerCase("pl").startsWith(stem));
    if (month >= 0) found.push({ date: iso(+match[3]!, month + 1, +match[1]!), at: match.index! });
  }
  return found.filter((item) => !Number.isNaN(Date.parse(item.date))).sort((a, b) => a.at - b.at);
}

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const polish = (date: string) => date.split("-").reverse().join(".");

export type QuestionTimeline = { periods: Array<{ from: string; to: string; documents: string[] }>; dates: Array<{ date: string; documents: string[]; within: string[] }> };

/**
 * The question's periods ("od X do Y") and dates, each looked up in the documents (by any written
 * form), and every date placed against every period: inside (how many days before its end) or not.
 */
export function questionTimeline(question: string, documents: ReadonlyArray<{ documentId: string; text: string }>): QuestionTimeline | null {
  const all = datesIn(question);
  if (!all.length) return null;
  const periods: QuestionTimeline["periods"] = [];
  const inPeriod = new Set<number>();
  for (const match of question.matchAll(/\bod\s+(\S+(?:\s+\p{L}+\s+\d{4})?)\s+do\s+(\S+(?:\s+\p{L}+\s+\d{4})?)/giu)) {
    const from = datesIn(match[1]!)[0]?.date;
    const to = datesIn(match[2]!)[0]?.date;
    if (!from || !to || from > to) continue;
    periods.push({ from, to, documents: [] });
    for (const item of all) if (item.at >= match.index! && item.at <= match.index! + match[0].length) inPeriod.add(item.at);
  }
  const dated = documents.map((document) => ({ documentId: document.documentId, dates: new Set(datesIn(document.text).map((item) => item.date)) }));
  for (const period of periods) period.documents = dated.filter((document) => document.dates.has(period.from) && document.dates.has(period.to)).map((document) => document.documentId);
  const dates = [...new Map(all.filter((item) => !inPeriod.has(item.at)).map((item) => [item.date, item])).values()].map((item) => ({
    date: item.date,
    documents: dated.filter((document) => document.dates.has(item.date)).map((document) => document.documentId),
    within: periods.filter((period) => period.from <= item.date && item.date <= period.to).map((period) => `${polish(period.from)}–${polish(period.to)}`)
  }));
  if (!periods.length && dates.every((item) => !item.documents.length)) return null;
  return { periods, dates };
}

export function questionTimelinePrompt(timeline: QuestionTimeline): string {
  const lines: string[] = [];
  for (const period of timeline.periods) {
    lines.push(
      `- okres ${polish(period.from)}–${polish(period.to)} (${days(period.from, period.to) + 1} dni): ${period.documents.length ? `oba krańce w ${period.documents.map((id) => `[[LEXDOC:${id}:0]]`).join(", ")}` : "BRAK w dokumentach — podaj go jako twierdzenie strony i wskaż dowód do złożenia"}`
    );
  }
  for (const item of timeline.dates) {
    const placed = item.within.map((label) => {
      const end = label.split("–")[1]!.split(".").reverse().join("-");
      return `w okresie ${label}, ${days(item.date, end)} dni przed jego końcem`;
    });
    lines.push(
      `- data ${polish(item.date)}: ${item.documents.length ? `w ${item.documents.map((id) => `[[LEXDOC:${id}:0]]`).join(", ")}` : "nie występuje w dokumentach w tym zapisie — przyjmij ją jako twierdzenie strony (wskaż, z czego wynika) albo ustal datę z dokumentu"}${placed.length ? `; ${placed.join("; ")}` : timeline.periods.length ? "; poza podanymi okresami" : ""}`
    );
  }
  return [
    "# DATY Z PYTANIA WOBEC DOKUMENTÓW (oś czasu ustalona przez aplikację)",
    "Daty i okresy podane przez użytkownika, sprawdzone w treści dokumentów; położenie dat względem okresów policzone przez aplikację. Zestaw je z tym, co świadek zeznał o czasie tych zdarzeń (np. „po ustaniu stosunku pracy”, „w obecności powoda”), i wykaż niezgodność albo zgodność cytatem.",
    ...lines,
    // The wording on the event date (PRAWO-HARDGATE KROK 4): the earliest event the question dates.
    ...(() => {
      const earliest = [...timeline.periods.map((period) => period.from), ...timeline.dates.map((item) => item.date)].sort()[0];
      return earliest
        ? [`Przepis prawa materialnego, który rozstrzyga o tych zdarzeniach, powołuj w brzmieniu z dnia zdarzenia (najwcześniejsze: ${polish(earliest)}): verify_legal_reference z asOf=${earliest}; brzmienie aktualne podaj tylko obok, gdy się różni.`]
        : [];
    })()
  ].join("\n");
}
