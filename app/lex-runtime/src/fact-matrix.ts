// The fact matrix as a lawyer (and the chat) builds it (user 2026-11-16: "the model builds the
// matrix from the descriptions of the facts"): every statement is first described as facts —
// topic, attribute, value, the verbatim words — by the model, which understands that "Trwało to
// może 3 miesiące" and "Dostawałem je raz na miesiąc" both speak of how long the messages went on;
// then the application checks every quote against the record, drops what it cannot find, and
// lays the facts out: topic × attribute × record, a difference marked where the values differ.
// Word matching (witness-statements.ts testimonyMatrix) stays the fallback.
import { transliteratedName } from "./witness-statements.js";
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
    "Ten sam temat i ta sama cecha w różnych protokołach muszą mieć identyczne nazwy, żeby dało się je porównać. Wypowiedź z zaimkiem („Trwało to…”, „Dostawałem je…”) przypisz do tematu poprzedniej wypowiedzi. Ocenę świadka („straszył”) i jego opis faktu („wysyłał, że mamy mówić prawdę”) zapisz jako osobne cechy tego samego tematu. Gdy świadek powołuje się na dokument (zarządzenie, umowa, notatka, wiadomość, pismo), zapisz go jako cechę „dokument powołany” z nazwą dokumentu jako wartością. Gdy świadek mówi, skąd wie (od innych, „z tego co wiem”), zapisz cechę „źródło wiedzy”. Gdy świadek mówi, że czegoś nie pamięta, nie wie albo nie miał z tym styczności, a także gdy ocenia lub opisuje szczegół tematu, zapisz cechę „wiedza świadka” (np. „nie pamięta”, „ocenia: współpraca dobra”), żeby niepamięć w jednym protokole stanęła obok wiedzy w drugim. Nazwy tej samej roli lub kanału (informatyk i programista, SMS i WhatsApp) to jeden temat. Nie dodawaj faktów spoza wypowiedzi."
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
  // Values worded differently but saying the same ("kontakt zakazany przez kierownika" / "kierownik
  // zakazał kontaktu") are not a
  // difference: cells differ when their words (5-letter stems, digits) overlap less than half.
  // Names written in another transliteration ("Jurij" / "Yurii") are the same word, not a difference.
  const words = (cell: FactRow["cells"][number]) =>
    new Set(cell.facts.flatMap((fact) => transliteratedName(fold(fact.value)).split(" ")).filter((word) => word.length >= 3 || /\d/u.test(word)).map((word) => word.slice(0, 5)));
  const overlap = (a: Set<string>, b: Set<string>) => {
    const union = new Set([...a, ...b]);
    return union.size ? [...a].filter((word) => b.has(word)).length / union.size : 1;
  };
  for (const row of rows.values()) {
    const sets = row.cells.map(words);
    row.differs = sets.some((set, index) => sets.slice(index + 1).some((other) => overlap(set, other) < 0.5));
  }
  const weight = (row: FactRow) => (row.cells.length >= 2 ? 10 : 0) + (row.differs ? 10 : 0);
  return [...rows.values()].sort((a, b) => weight(b) - weight(a) || a.topic.localeCompare(b.topic, "pl"));
}

export function factMatrixPrompt(witness: string, rows: readonly FactRow[], dropped: number, scope: "witness" | "documents" = "witness"): string {
  if (!rows.length) return "";
  if (scope === "documents") return documentMatrixPrompt(rows, dropped);
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
export function factMatrixGoals(witness: string, rows: readonly FactRow[], limit = 6, scope: "witness" | "documents" = "witness"): string[] {
  const topics = [...new Set(rows.filter((row) => row.differs).map((row) => row.topic))];
  const attributes = (topic: string) => rows.filter((row) => row.topic === topic && row.differs).map((row) => row.attribute).join(", ");
  return topics
    .slice(0, limit)
    .map((topic) =>
      scope === "documents"
        ? `Rozstrzygnąć rozbieżność dokumentów na korzyść strony albo ją wyjaśnić: ${topic} (${attributes(topic)})`
        : `Wykazać sprzeczność lub zmianę wersji zeznań świadka ${witness}: ${topic} (${attributes(topic)})`
    );
}

/** The goals of the differing rows with the rows' own checked quotes as their evidence. */
export function factMatrixGoalEvidence(witness: string, rows: readonly FactRow[], limit = 6, scope: "witness" | "documents" = "witness"): Array<{ goal: string; evidence: Array<{ documentId: string; chunkIndex: number; page: number; text: string }> }> {
  const goals = factMatrixGoals(witness, rows, limit, scope);
  const topics = [...new Set(rows.filter((row) => row.differs).map((row) => row.topic))].slice(0, limit);
  return goals.map((goal, index) => ({
    goal,
    evidence: rows
      .filter((row) => row.topic === topics[index] && row.differs)
      .flatMap((row) => row.cells.map((cell) => cell.facts[0]!))
      .map((fact) => ({ documentId: fact.documentId, chunkIndex: fact.chunkIndex, page: 1, text: fact.quote }))
      .slice(0, 4)
  }));
}

/**
 * The witness's testimony against the documents on one topic: the rows of the witness matrix whose
 * topic the documents also speak of (same name, the document matrix was seeded with it).
 */
export function witnessVersusDocuments(witness: string, witnessRows: readonly FactRow[], documentRows: readonly FactRow[], labels: ReadonlyMap<string, string> = new Map()): string {
  const byTopic = new Map<string, { said: DescribedFact[]; documents: DescribedFact[] }>();
  for (const row of witnessRows) for (const cell of row.cells) for (const fact of cell.facts) {
    const entry = byTopic.get(fold(row.topic)) ?? { said: [], documents: [] };
    entry.said.push(fact);
    byTopic.set(fold(row.topic), entry);
  }
  for (const row of documentRows) for (const cell of row.cells) for (const fact of cell.facts) byTopic.get(fold(row.topic))?.documents.push(fact);
  const shared = [...byTopic.entries()].filter(([, entry]) => entry.said.length && entry.documents.length);
  if (!shared.length) return "";
  const line = (fact: DescribedFact) => `${fact.attribute}: ${fact.value} („${fact.quote}” [[LEXDOC:${fact.documentId}:${fact.chunkIndex}]])`;
  return [
    `# ZEZNANIA ŚWIADKA ${witness} WOBEC DOKUMENTÓW — TEN SAM TEMAT (zestawione przez aplikację z obu macierzy)`,
    "Co świadek zeznał i co o tym samym zdarzeniu mówią dokumenty. Sprawdź każdą cechę (czas, adresaci, nadawca, treść): niezgodność ze świadkiem wykaż cytatem obu stron; dokument z datą jest silniejszy niż ogólnikowe określenie czasu w zeznaniu.",
    ...shared.map(([, entry]) =>
      [
        `## ${entry.said[0]!.topic}`,
        ...entry.said.map((fact) => `- świadek [${fact.record}] ${line(fact)}`),
        ...entry.documents.map((fact) => `- dokument [${labels.get(fact.documentId) ?? fact.record}] ${line(fact)}`)
      ].join("\n")
    )
  ].join("\n");
}

/** The first fact of each record in each differing row: the pleading must use them or set them aside. */
export function factMatrixRequired(rows: readonly FactRow[], limitRows = 6): Array<{ documentId: string; chunkIndex: number; page: number; text: string }> {
  return rows
    .filter((row) => row.differs)
    .slice(0, limitRows)
    .flatMap((row) => row.cells.map((cell) => ({ documentId: cell.facts[0]!.documentId, chunkIndex: cell.facts[0]!.chunkIndex, page: 1, text: cell.facts[0]!.quote })));
}

// The same matrix for any pleading built from several documents (user 2026-11-16: "the same
// mechanism for any pleading from many documents"): the documents are cut into paragraphs (the
// passages on the issue when the documents are too long), the model describes the facts each
// document states, the application checks every quote in that document, and the matrix shows
// where documents state the same thing differently (a decision's finding against a ruling, a
// party's claim against a record) and where they agree.

type DocumentText = { documentId: string; label: string; chunks: ReadonlyArray<{ index: number; text: string }> };

/** Paragraph units of each document, labelled "<documentId> — <kind>"; null when too long. */
export function documentUnits(documents: readonly DocumentText[], maxChars = 60_000): WitnessStatement[] | null {
  const total = documents.reduce((sum, document) => sum + document.chunks.reduce((inner, chunk) => inner + chunk.text.length, 0), 0);
  if (total > maxChars) return null;
  return documents.flatMap((document) => {
    const heading = `${document.documentId} — ${document.label}`;
    return document.chunks.flatMap((chunk) => {
      const units: string[] = [];
      for (const paragraph of chunk.text.split(/\n\s*\n/u).map((item) => item.replace(/\s+/gu, " ").trim()).filter((item) => item.length >= 3)) {
        // Short lines (headings, signatures, list items) joined to the next up to a paragraph's length.
        if (units.length && units[units.length - 1]!.length < 200) units[units.length - 1] += ` ${paragraph}`;
        else units.push(paragraph);
      }
      return units.map((text) => ({ documentId: document.documentId, chunkIndex: chunk.index, heading, text }));
    });
  });
}

/** Units from the weighted passages on the issue, when the documents are too long to send whole. */
export function passageUnits(passages: ReadonlyArray<{ documentId: string; chunkIndex: number; text: string }>, labels: ReadonlyMap<string, string>): WitnessStatement[] {
  return passages.map((passage) => ({ documentId: passage.documentId, chunkIndex: passage.chunkIndex, heading: `${passage.documentId} — ${labels.get(passage.documentId) ?? "dokument"}`, text: passage.text }));
}

function documentMatrixPrompt(rows: readonly FactRow[], dropped: number): string {
  const byTopic = new Map<string, FactRow[]>();
  // Every row up to 200 (shared and differing first, factRows order): a single strong fact of an official
  // document (the opponent's statement in a protocol) is a fact of the pleading too.
  const shown = rows.slice(0, 200);
  for (const row of shown) byTopic.set(row.topic, [...(byTopic.get(row.topic) ?? []), row]);
  const cited = rows.filter((row) => /dokument\s+powołany|dowód\s+wskazany/iu.test(row.attribute));
  return [
    `# MACIERZ FAKTÓW Z DOKUMENTÓW SPRAWY — TEMAT × CECHA × DOKUMENT (fakty opisane przez model, każdy cytat sprawdzony przez aplikację w dokumencie${dropped ? `; odrzucono ${dropped} bez pokrycia w dokumencie` : ""})`,
    "RÓŻNE = dokumenty stwierdzają tę samą cechę tematu inaczej (np. ustalenie organu wobec wyroku, twierdzenie strony wobec protokołu): kandydat na zarzut błędnych ustaleń, sprzeczność albo pominięty dowód. Zgodne = fakt potwierdzony przez kilka dokumentów (mocniejszy dowód). Fakty do pisma bierz z macierzy; każdą RÓŻNICĘ wykorzystaj z cytatami obu dokumentów albo wyjaśnij, dlaczego nie ma znaczenia.",
    "Dowody wynikające z macierzy (reguły ogólne): dokument urzędowy (wyrok, protokół, postanowienie) powołuj jako dowód tego, co w nim urzędowo zaświadczono; dokument albo dowód powołany w aktach, którego nie ma w materiałach, a który ma strona przeciwna lub organ — wniosek o jego przedstawienie albo dołączenie akt; ustalenie bez wskazanego dowodu — zarzut dowolności oceny; wartość zależną od faktu jeszcze nieustalonego przedstaw w wariantach.",
    ...[...byTopic].map(([topic, list]) =>
      [
        `## ${topic}`,
        ...list.map(
          (row) =>
            `- ${row.attribute}${row.differs ? " · RÓŻNE" : row.cells.length >= 2 ? " · zgodne" : " · tylko w jednym dokumencie"}: ` +
            row.cells.map((cell) => `[${cell.record}] ${cell.facts.map((fact) => `${fact.value} („${fact.quote}” [[LEXDOC:${fact.documentId}:${fact.chunkIndex}]])`).join("; ")}`).join(" ‖ ")
        )
      ].join("\n")
    ),
    ...(cited.length ? [`Dokumenty i dowody powołane w aktach (sprawdź, czy są w materiałach; jeśli nie — wniosek o przedstawienie): ${[...new Set(cited.flatMap((row) => row.cells.flatMap((cell) => cell.facts.map((fact) => `${fact.value} [${cell.record}]`))))].slice(0, 20).join("; ")}`] : [])
  ].join("\n");
}

// The matrix built in stages (user 2026-11-16: "the matrix built by the model in stages, the
// answers taken in a stream"): one long call describing every document timed out and left
// nothing (0 facts after 180 s). Stage 1: one short call names the topics (events,
// facts, information) with their attributes and the documents that speak of them, so every
// document is described against the same names. Stage 2: one call per document, in parallel,
// facts as JSON lines; every line is taken as it streams in, so a call cut by the time limit
// still gives what it described.

export type MatrixScope = "witness" | "documents";
export type MatrixTopic = { topic: string; attributes: string[]; records: string[] };
/** A model call: the text received so far when it ends or the time is up, and why it stopped early. */
export type ModelCall = (system: string, user: string, timeoutMs: number) => Promise<{ text: string; failure: string }>;

/** Every JSON object of the text: one per line, or the items of an array. */
export function jsonObjects(text: string): Array<Record<string, unknown>> {
  const objects: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\n/u)) {
    const candidate = line.trim().replace(/^[-*]\s*/u, "").replace(/,$/u, "");
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
    try {
      const value = JSON.parse(candidate) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) objects.push(value as Record<string, unknown>);
    } catch {
      // a line cut by the time limit or not JSON
    }
  }
  if (objects.length) return objects;
  const array = /\[[\s\S]*\]/u.exec(text)?.[0];
  if (!array) return [];
  try {
    const value = JSON.parse(array) as unknown;
    return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  } catch {
    return [];
  }
}

const unitList = (units: readonly WitnessStatement[], record: string) =>
  units
    .filter((item) => (item.heading || item.documentId) === record)
    .map((item) => `- ${item.text}`)
    .join("\n");

export function topicRequest(units: readonly WitnessStatement[], focus: string, scope: MatrixScope, limit = 20): { system: string; user: string } {
  const records = [...new Set(units.map((item) => item.heading || item.documentId))];
  const source = scope === "witness" ? "zeznaniach świadka w kilku protokołach" : "dokumentach sprawy";
  const system = [
    `Jesteś asystentem prawnika. Etap 1 budowy macierzy faktów: wskaż tematy, o których mowa w ${source}, zanim fakty zostaną opisane.`,
    `Temat to ZDARZENIE, FAKT albo INFORMACJA (np. „wiadomości do pokrzywdzonej”, „pismo z 4 maja”, „zakaz kontaktu”, „dane osobowe w piśmie”), NIGDY nazwa, rodzaj ani sygnatura dokumentu. Najpierw tematy, o których mówią co najmniej dwa ${scope === "witness" ? "protokoły" : "dokumenty"}, potem te ważne dla zagadnienia. Najwyżej ${limit} tematów.`,
    "Dla każdego tematu podaj cechy do porównania (np. „data”, „okres”, „kanał”, „treść”, „przebieg”, „ustalenie organu”, „ocena”, „twierdzenie strony”, „rozstrzygnięcie”, „źródło wiedzy”, „dokument powołany”) i nazwy dokumentów dokładnie jak w nagłówkach.",
    'Zwróć WYŁĄCZNIE wiersze JSON, jeden obiekt w wierszu: {"temat": "...", "cechy": ["..."], "dokumenty": ["..."]}',
    focus.trim() ? `Zagadnienie sprawy: ${focus.trim().slice(0, 600)}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user: records.map((record) => `## ${record}\n${unitList(units, record)}`).join("\n\n") };
}

export function parseTopics(text: string, records: readonly string[]): MatrixTopic[] {
  const known = new Map(records.map((record) => [fold(record), record]));
  const resolve = (name: string) => known.get(fold(name)) ?? records.find((record) => fold(record).startsWith(fold(name)) || fold(name).startsWith(fold(record).split(" ")[0]!));
  return jsonObjects(text)
    .map((item) => ({
      topic: String(item.temat ?? "").trim(),
      attributes: (Array.isArray(item.cechy) ? item.cechy : []).map((value) => String(value).trim()).filter(Boolean),
      records: [...new Set((Array.isArray(item.dokumenty) ? item.dokumenty : []).map((value) => resolve(String(value))).filter((value): value is string => Boolean(value)))]
    }))
    .filter((item) => item.topic && !records.some((record) => fold(record) === fold(item.topic)));
}

export function recordFactRequest(record: string, units: readonly WitnessStatement[], topics: readonly MatrixTopic[], scope: MatrixScope): { system: string; user: string } {
  const system = [
    `Jesteś asystentem prawnika. Etap 2 budowy macierzy faktów: opisz, co ${scope === "witness" ? "świadek zeznał w tym protokole" : "stwierdza ten dokument"} o każdym temacie z listy.`,
    "Używaj DOKŁADNIE nazw tematów i cech z listy, żeby fakty z różnych dokumentów dało się porównać; nowy temat tylko wtedy, gdy ważnego faktu nie da się przypisać do żadnego z listy. Temat, o którym dokument nie mówi, pomiń.",
    "Ustalenie, ocenę i twierdzenie zapisz jako osobne cechy. Wypowiedź z zaimkiem przypisz do tematu poprzedniej. Gdy dokument powołuje się na inny dokument albo dowód, cecha „dokument powołany”; gdy mówi, skąd wie, cecha „źródło wiedzy”. Pomiń pouczenia, nagłówki i dane adresowe. Nie dodawaj faktów spoza dokumentu.",
    'Zwróć WYŁĄCZNIE wiersze JSON, jeden obiekt w wierszu: {"temat": "...", "cecha": "...", "wartosc": "najwyżej 12 słów", "cytat": "DOSŁOWNY fragment dokumentu, min. 3 słowa"}'
  ].join("\n");
  const user = [
    "Tematy i cechy:",
    ...topics.map((topic) => `- ${topic.topic}: ${topic.attributes.join(", ") || "(cechy według treści)"}`),
    "",
    `## ${record}`,
    unitList(units, record)
  ].join("\n");
  return { system, user };
}

/** The facts of one document's lines, each quote checked in that document. */
export function recordFacts(text: string, record: string, units: readonly WitnessStatement[]): { facts: DescribedFact[]; dropped: number } {
  const lines = jsonObjects(text).map((item) => ({ ...item, protokol: record }));
  return verifiedFacts(JSON.stringify(lines), units);
}

export async function stagedFactMatrix(
  units: readonly WitnessStatement[],
  focus: string,
  scope: MatrixScope,
  call: ModelCall,
  options: { concurrency?: number; topicTimeoutMs?: number; factTimeoutMs?: number; maxRecords?: number } = {}
): Promise<{ facts: DescribedFact[]; dropped: number; topics: MatrixTopic[]; failures: string[] }> {
  const records = [...new Set(units.map((item) => item.heading || item.documentId))];
  const failures: string[] = [];
  const first = topicRequest(units, focus, scope);
  const topicReply = await call(first.system, first.user, options.topicTimeoutMs ?? 120_000);
  if (topicReply.failure) failures.push(`tematy: ${topicReply.failure}`);
  const topics = parseTopics(topicReply.text, records);
  if (!topics.length) return { facts: [], dropped: 0, topics, failures: [...failures, "tematy: brak tematów w odpowiedzi"] };
  // The documents that speak of a topic (all, when the model named none), those of shared topics first.
  const mentions = new Map(records.map((record) => [record, topics.filter((topic) => topic.records.includes(record)).length]));
  const chosen = (topics.some((topic) => topic.records.length) ? records.filter((record) => mentions.get(record)) : records)
    .sort((a, b) => mentions.get(b)! - mentions.get(a)!)
    .slice(0, options.maxRecords ?? 10);
  const results: Array<{ facts: DescribedFact[]; dropped: number }> = [];
  let next = 0;
  const worker = async () => {
    while (next < chosen.length) {
      const record = chosen[next++]!;
      const own = topics.filter((topic) => !topic.records.length || topic.records.includes(record));
      const ask = recordFactRequest(record, units, own.length ? own : topics, scope);
      const reply = await call(ask.system, ask.user, options.factTimeoutMs ?? 150_000);
      if (reply.failure) failures.push(`${record}: ${reply.failure}`);
      results.push(recordFacts(reply.text, record, units));
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, chosen.length) }, worker));
  return { facts: results.flatMap((result) => result.facts), dropped: results.reduce((sum, result) => sum + result.dropped, 0), topics, failures };
}

// Nothing left out (2026-11-17): the 16.10.2025 protocol and the GDPR thread were not in
// the matrix because unrecognised documents were dropped above six, at most ten records were described
// and documents over 60k characters fell back to passages. Now every document is read: a document over
// ~20k characters in parts, each part one call, all in parallel and streamed; a part with no fact goes
// back to the model once and only an explicit "brak faktów do tematów" is accepted. What stays unread
// is a gap of the register (document-register.ts), and the pleading is then a draft.

export type MatrixDocument = { record: string; documentId: string; chunks: ReadonlyArray<{ index: number; text: string }> };
export type DocumentCoverage = { record: string; documentId: string; parts: number; facts: number; state: "READ" | "NO_FACTS" | "GAP"; reasons: string[] };
export const NO_FACTS_ANSWER = "brak faktów do tematów";

function paragraphUnits(document: MatrixDocument, maxUnit: number): WitnessStatement[] {
  return document.chunks.flatMap((chunk) => {
    const units: string[] = [];
    for (const paragraph of chunk.text.split(/\n\s*\n/u).map((item) => item.replace(/\s+/gu, " ").trim()).filter((item) => item.length >= 3)) {
      if (units.length && units[units.length - 1]!.length < 200) units[units.length - 1] += ` ${paragraph}`;
      else units.push(paragraph);
    }
    // A paragraph longer than a part (a scan without blank lines) is cut at sentence ends.
    return units
      .flatMap((text) => {
        if (text.length <= maxUnit) return [text];
        const pieces: string[] = [];
        let rest = text;
        while (rest.length > maxUnit) {
          const cut = rest.lastIndexOf(". ", maxUnit);
          const at = cut > maxUnit / 2 ? cut + 1 : maxUnit;
          pieces.push(rest.slice(0, at).trim());
          rest = rest.slice(at).trim();
        }
        return rest ? [...pieces, rest] : pieces;
      })
      .map((text) => ({ documentId: document.documentId, chunkIndex: chunk.index, heading: document.record, text }));
  });
}

/** The document in parts of about `partChars` characters, each part with its own heading. */
export function documentParts(document: MatrixDocument, partChars = 20_000): Array<{ part: string; units: WitnessStatement[] }> {
  const units = paragraphUnits(document, Math.max(1_000, Math.floor(partChars / 2)));
  const groups: WitnessStatement[][] = [];
  let size = 0;
  for (const unit of units) {
    if (!groups.length || size + unit.text.length > partChars) {
      groups.push([]);
      size = 0;
    }
    groups[groups.length - 1]!.push(unit);
    size += unit.text.length;
  }
  return groups.map((group, index) => {
    const part = groups.length > 1 ? `${document.record} (cz. ${index + 1}/${groups.length})` : document.record;
    return { part, units: group.map((unit) => ({ ...unit, heading: part })) };
  });
}

/** The beginning of every document within a common budget: the topics are named from all of them. */
export function topicExcerpts(documents: ReadonlyArray<{ record: string; units: readonly WitnessStatement[] }>, budget = 40_000): WitnessStatement[] {
  const share = Math.max(1_500, Math.floor(budget / Math.max(1, documents.length)));
  return documents.flatMap((document) => {
    const chosen: WitnessStatement[] = [];
    let size = 0;
    for (const unit of document.units) {
      if (size >= share) break;
      const text = unit.text.slice(0, share - size);
      chosen.push({ ...unit, heading: document.record, text });
      size += text.length;
    }
    return chosen;
  });
}

export function coverageRequest(part: string, units: readonly WitnessStatement[], topics: readonly MatrixTopic[]): { system: string; user: string } {
  const system = [
    "Jesteś asystentem prawnika. KONTROLA POKRYCIA macierzy faktów: z tego dokumentu (albo jego części) nie opisano dotąd żadnego faktu, a materiału nie wolno pominąć.",
    "Przeczytaj go jeszcze raz w całości. Opisz każdy fakt istotny dla tematów z listy; zdarzenie, oświadczenie albo informację ważną dla sprawy, której nie da się przypisać do tematu, zapisz pod nowym tematem.",
    `Tylko gdy dokument naprawdę nie zawiera żadnego faktu do tematów (np. sama koperta, pouczenie, potwierdzenie odbioru), zwróć jeden wiersz {"brak": "${NO_FACTS_ANSWER}", "powod": "czego dotyczy dokument, najwyżej 15 słów"}.`,
    'Fakty zwróć WYŁĄCZNIE jako wiersze JSON, jeden obiekt w wierszu: {"temat": "...", "cecha": "...", "wartosc": "najwyżej 12 słów", "cytat": "DOSŁOWNY fragment dokumentu, min. 3 słowa"}'
  ].join("\n");
  const user = ["Tematy i cechy:", ...topics.map((topic) => `- ${topic.topic}: ${topic.attributes.join(", ") || "(cechy według treści)"}`), "", `## ${part}`, unitList(units, part)].join("\n");
  return { system, user };
}

/** The model's explicit answer that the document states nothing on the topics, with its reason. */
export function explicitNoFacts(text: string): string | null {
  const item = jsonObjects(text).find((object) => new RegExp(NO_FACTS_ANSWER, "iu").test(String(object.brak ?? "")));
  return item ? String(item.powod ?? "").trim() || NO_FACTS_ANSWER : null;
}

export async function fullDocumentMatrix(
  documents: readonly MatrixDocument[],
  focus: string,
  call: ModelCall,
  options: {
    concurrency?: number; partChars?: number; topicTimeoutMs?: number; factTimeoutMs?: number; retryTimeoutMs?: number; topicBudget?: number; topicLimit?: number;
    // The witness matrix's topics: a document on the same event uses the same name, so the testimony
    // and the documents meet in one row (the ban message of 29.09 against "po ustaniu stosunku pracy").
    seedTopics?: readonly MatrixTopic[];
    // Each part read (done / all): the live steps show what is read and what is left, as the pleading monitor does.
    onPart?: (progress: { record: string; part: string; done: number; total: number; facts: number; retry: boolean }) => void;
  } = {}
): Promise<{ facts: DescribedFact[]; dropped: number; topics: MatrixTopic[]; failures: string[]; coverage: DocumentCoverage[] }> {
  const failures: string[] = [];
  const parted = documents.map((document) => ({ document, parts: documentParts(document, options.partChars ?? 20_000) }));
  const records = documents.map((document) => document.record);
  const excerpts = topicExcerpts(
    parted.map((item) => ({ record: item.document.record, units: item.parts.flatMap((part) => part.units) })),
    options.topicBudget ?? 40_000
  );
  const first = topicRequest(excerpts, focus, "documents", options.topicLimit ?? 24);
  const seeds = options.seedTopics ?? [];
  if (seeds.length) {
    first.system += `\nTematy z macierzy zeznań świadka w tej sprawie: gdy dokument mówi o tym samym zdarzeniu, użyj DOKŁADNIE tej nazwy tematu i tych cech: ${seeds.map((topic) => `„${topic.topic}” (${topic.attributes.join(", ")})`).join("; ")}.`;
  }
  const topicReply = await call(first.system, first.user, options.topicTimeoutMs ?? 90_000);
  if (topicReply.failure) failures.push(`tematy: ${topicReply.failure}`);
  const parsed = parseTopics(topicReply.text, records);
  // The seeds stay on the list for every document even when the model did not repeat them.
  const topics = [...parsed, ...seeds.filter((seed) => !parsed.some((topic) => fold(topic.topic) === fold(seed.topic))).map((seed) => ({ ...seed, records: [] }))];
  const jobs = parted.flatMap((item) => item.parts.map((part) => ({ document: item.document, ...part })));
  const results = new Map<string, { facts: DescribedFact[]; dropped: number; none: string | null; failure: string }>();
  let done = 0;
  const run = async (job: (typeof jobs)[number], retry: boolean) => {
    const own = topics.filter((topic) => !topic.records.length || topic.records.includes(job.document.record));
    const ask = retry ? coverageRequest(job.part, job.units, topics) : recordFactRequest(job.part, job.units, own.length ? own : topics, "documents");
    const reply = await call(ask.system, ask.user, retry ? options.retryTimeoutMs ?? 90_000 : options.factTimeoutMs ?? 120_000);
    const described = recordFacts(reply.text, job.part, job.units);
    // The facts of every part are the document's: RÓŻNE is counted between documents, not parts.
    const facts = described.facts.map((fact) => ({ ...fact, record: job.document.record }));
    const before = results.get(job.part);
    results.set(job.part, {
      facts: [...(before?.facts ?? []), ...facts],
      dropped: (before?.dropped ?? 0) + described.dropped,
      none: explicitNoFacts(reply.text),
      failure: reply.failure
    });
    if (reply.failure) failures.push(`${job.part}${retry ? " (kontrola pokrycia)" : ""}: ${reply.failure}`);
    if (!retry) done += 1;
    options.onPart?.({ record: job.document.record, part: job.part, done, total: jobs.length, facts: facts.length, retry });
  };
  const pool = async (list: typeof jobs, retry: boolean) => {
    let next = 0;
    const worker = async () => {
      while (next < list.length) await run(list[next++]!, retry);
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 6, list.length) }, worker));
  };
  if (topics.length) await pool(jobs, false);
  else failures.push("tematy: brak tematów w odpowiedzi");
  // Every part with no fact goes back once (also when the topics failed: then it is described freely).
  await pool(jobs.filter((job) => !results.get(job.part)?.facts.length), true);
  const coverage: DocumentCoverage[] = parted.map(({ document, parts }) => {
    const own = parts.map((part) => ({ part: part.part, result: results.get(part.part) }));
    const facts = own.reduce((sum, item) => sum + (item.result?.facts.length ?? 0), 0);
    const open = own.filter((item) => !item.result?.facts.length && !item.result?.none);
    const reasons = open.map((item) => `${item.part}: ${item.result?.failure || "brak faktów i brak potwierdzenia „brak faktów do tematów”"}`);
    const state: DocumentCoverage["state"] = open.length ? "GAP" : facts ? "READ" : "NO_FACTS";
    if (state === "NO_FACTS") reasons.push(...own.map((item) => item.result?.none ?? "").filter(Boolean));
    return { record: document.record, documentId: document.documentId, parts: parts.length, facts, state, reasons };
  });
  const all = [...results.values()];
  return { facts: all.flatMap((item) => item.facts), dropped: all.reduce((sum, item) => sum + item.dropped, 0), topics, failures, coverage };
}
