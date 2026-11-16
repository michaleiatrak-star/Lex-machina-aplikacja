// The fact matrix as a lawyer (and the chat) builds it (user 2026-11-16: "the model builds the
// matrix from the descriptions of the facts"): every statement is first described as facts —
// topic, attribute, value, the verbatim words — by the model, which understands that "Trwało to
// może 3 miesiące" and "Dostawałem je raz na miesiąc" both speak of how long the messages went on;
// then the application checks every quote against the record, drops what it cannot find, and
// lays the facts out: topic × attribute × record, a difference marked where the values differ.
// Word matching (witness-statements.ts testimonyMatrix) stays the fallback.
import type { WitnessStatement } from "./witness-statements.js";

export type DescribedFact = { topic: string; attribute: string; value: string; record: string; quote: string; documentId: string; chunkIndex: number };
export type FactRow = { topic: string; attribute: string; cells: Array<{ record: string; facts: DescribedFact[] }>; differs: boolean };

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ł/gu, "l")
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim();

/** The request to the model: the statements by record, the facts to describe, JSON only. */
export function factDescriptionRequest(witness: string, statements: readonly WitnessStatement[]): { system: string; user: string } {
  const records = [...new Set(statements.map((item) => item.heading || item.documentId))];
  const system = [
    "Jesteś asystentem prawnika. Rozkładasz zeznania świadka na fakty, zanim prawnik je porówna.",
    "Zwróć WYŁĄCZNIE tablicę JSON obiektów: {\"temat\": krótki rzeczownikowy temat (np. „wiadomości od powoda”, „zakaz kontaktu”, „stanowiska powoda”), \"cecha\": jedna cecha tematu (np. „okres”, „częstotliwość”, „kanał”, „treść”, „data ostatniej”, „adresat”, „kolejność”, „źródło wiedzy”, „ocena świadka”), \"wartosc\": wartość tej cechy własnymi słowami, krótko, \"protokol\": nazwa protokołu dokładnie jak w nagłówku, \"cytat\": DOSŁOWNY fragment wypowiedzi (min. 3 słowa), z którego to wynika}.",
    "Ten sam temat i ta sama cecha w różnych protokołach muszą mieć identyczne nazwy, żeby dało się je porównać. Wypowiedź z zaimkiem („Trwało to…”, „Dostawałem je…”) przypisz do tematu poprzedniej wypowiedzi. Ocenę świadka („straszył”) i jego opis faktu („wysyłał, że mamy mówić prawdę”) zapisz jako osobne cechy tego samego tematu. Gdy świadek powołuje się na dokument (zarządzenie, umowa, notatka, wiadomość, pismo), zapisz go jako cechę „dokument powołany” z nazwą dokumentu jako wartością. Gdy świadek mówi, skąd wie (od innych, „z tego co wiem”), zapisz cechę „źródło wiedzy”. Nie dodawaj faktów spoza wypowiedzi."
  ].join("\n");
  const user = [
    `Świadek: ${witness}. Protokoły: ${records.join("; ")}.`,
    ...records.map((record) => `## ${record}\n${statements.filter((item) => (item.heading || item.documentId) === record).map((item) => `- ${item.text}`).join("\n")}`)
  ].join("\n\n");
  return { system, user };
}

/** The model's facts whose quote is found in that record's statements (the rest dropped). */
export function verifiedFacts(reply: string, statements: readonly WitnessStatement[]): { facts: DescribedFact[]; dropped: number } {
  const json = /\[[\s\S]*\]/u.exec(reply)?.[0];
  if (!json) return { facts: [], dropped: 0 };
  let items: Array<Record<string, unknown>>;
  try {
    items = JSON.parse(json) as Array<Record<string, unknown>>;
  } catch {
    return { facts: [], dropped: 0 };
  }
  const facts: DescribedFact[] = [];
  let dropped = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const topic = String(item.temat ?? "").trim();
    const attribute = String(item.cecha ?? "").trim();
    const value = String(item.wartosc ?? "").trim();
    const record = String(item.protokol ?? "").trim();
    const quote = String(item.cytat ?? "").trim();
    const words = fold(quote);
    const source = statements.find((statement) => (statement.heading || statement.documentId) === record && words.split(" ").length >= 3 && fold(statement.text).includes(words));
    if (!topic || !attribute || !source) {
      dropped += 1;
      continue;
    }
    facts.push({ topic, attribute, value, record, quote, documentId: source.documentId, chunkIndex: source.chunkIndex });
  }
  return { facts, dropped };
}

/** Topic × attribute rows; a row heard in two records with different values first. */
export function factRows(facts: readonly DescribedFact[]): FactRow[] {
  const key = (fact: DescribedFact) => `${fold(fact.topic)}|${fold(fact.attribute)}`;
  const rows = new Map<string, FactRow>();
  for (const fact of facts) {
    const row = rows.get(key(fact)) ?? { topic: fact.topic, attribute: fact.attribute, cells: [], differs: false };
    const cell = row.cells.find((item) => item.record === fact.record);
    if (cell) cell.facts.push(fact);
    else row.cells.push({ record: fact.record, facts: [fact] });
    rows.set(key(fact), row);
  }
  for (const row of rows.values()) {
    const values = row.cells.map((cell) => cell.facts.map((fact) => fold(fact.value)).sort().join("|"));
    row.differs = row.cells.length >= 2 && new Set(values).size > 1;
  }
  const weight = (row: FactRow) => (row.cells.length >= 2 ? 10 : 0) + (row.differs ? 10 : 0);
  return [...rows.values()].sort((a, b) => weight(b) - weight(a) || a.topic.localeCompare(b.topic, "pl"));
}

export function factMatrixPrompt(witness: string, rows: readonly FactRow[], dropped: number): string {
  if (!rows.length) return "";
  const cited = rows.filter((row) => /dokument\s+powołany/iu.test(row.attribute));
  const byTopic = new Map<string, FactRow[]>();
  for (const row of rows) byTopic.set(row.topic, [...(byTopic.get(row.topic) ?? []), row]);
  return [
    `# MACIERZ FAKTÓW ZEZNAŃ ŚWIADKA ${witness} — TEMAT × CECHA × PROTOKÓŁ (fakty opisane przez model, każdy cytat sprawdzony przez aplikację w protokole${dropped ? `; odrzucono ${dropped} bez pokrycia w protokole` : ""})`,
    "RÓŻNE = ta sama cecha tematu ma w protokołach inne wartości (kandydat na sprzeczność albo zmianę wersji). Fakty do pisma bierz z macierzy; każdą RÓŻNICĘ albo wykaż z cytatami obu protokołów, albo wyjaśnij, dlaczego nie jest sprzecznością.",
    "Dowody wynikające z macierzy (reguły ogólne): protokół z innej sprawy powołuj jako dokument urzędowy (k.p.c.: dowód tego, co w nim urzędowo zaświadczono); dokument, na który świadek się powołał, a który ma strona przeciwna — wniosek o jego przedstawienie; wiadomości, o których mówi świadek, a które ma strona — dowód z ich wydruku; wartość zależną od faktu jeszcze nieustalonego (np. dokładnej daty) przedstaw w wariantach, nie jako pewną.",
    ...[...byTopic].map(([topic, list]) =>
      [
        `## ${topic}`,
        ...list.map(
          (row) =>
            `- ${row.attribute}${row.differs ? " · RÓŻNE" : row.cells.length >= 2 ? " · zgodne" : " · tylko w jednym protokole"}: ` +
            row.cells.map((cell) => `[${cell.record}] ${cell.facts.map((fact) => `${fact.value} („${fact.quote}” [[LEXDOC:${fact.documentId}:${fact.chunkIndex}]])`).join("; ")}`).join(" ‖ ")
        )
      ].join("\n")
    ),
    ...(cited.length ? [`Dokumenty powołane przez świadka (rozważ wniosek o ich przedstawienie): ${cited.flatMap((row) => row.cells.flatMap((cell) => cell.facts.map((fact) => `${fact.value} [${cell.record}]`))).join("; ")}`] : [])
  ].join("\n");
}

/** One goal per topic with a difference between records. */
export function factMatrixGoals(witness: string, rows: readonly FactRow[], limit = 6): string[] {
  const topics = [...new Set(rows.filter((row) => row.differs).map((row) => row.topic))];
  return topics.slice(0, limit).map((topic) => `Wykazać sprzeczność lub zmianę wersji zeznań świadka ${witness}: ${topic} (${rows.filter((row) => row.topic === topic && row.differs).map((row) => row.attribute).join(", ")})`);
}

/** The first fact of each record in each differing row: the pleading must use them or set them aside. */
export function factMatrixRequired(rows: readonly FactRow[], limitRows = 6): Array<{ documentId: string; chunkIndex: number; page: number; text: string }> {
  return rows
    .filter((row) => row.differs)
    .slice(0, limitRows)
    .flatMap((row) => row.cells.map((cell) => ({ documentId: cell.facts[0]!.documentId, chunkIndex: cell.facts[0]!.chunkIndex, page: 1, text: cell.facts[0]!.quote })));
}
