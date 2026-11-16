const fold = (text) => text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ł/gu, "l")
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim();
/** The request to the model: the statements by record, the facts to describe, JSON only. */
export function factDescriptionRequest(witness, statements) {
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
export function verifiedFacts(reply, statements) {
    const json = /\[[\s\S]*\]/u.exec(reply)?.[0];
    if (!json)
        return { facts: [], dropped: 0 };
    let items;
    try {
        items = JSON.parse(json);
    }
    catch {
        return { facts: [], dropped: 0 };
    }
    const facts = [];
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
export function factRows(facts) {
    const key = (fact) => `${fold(fact.topic)}|${fold(fact.attribute)}`;
    const rows = new Map();
    for (const fact of facts) {
        const row = rows.get(key(fact)) ?? { topic: fact.topic, attribute: fact.attribute, cells: [], differs: false };
        const cell = row.cells.find((item) => item.record === fact.record);
        if (cell)
            cell.facts.push(fact);
        else
            row.cells.push({ record: fact.record, facts: [fact] });
        rows.set(key(fact), row);
    }
    // Values worded differently but saying the same ("kontakt zakazany przez kierownika" / "kierownik
    // zakazał kontaktu") are not a
    // difference: cells differ when their words (5-letter stems, digits) overlap less than half.
    const words = (cell) => new Set(cell.facts.flatMap((fact) => fold(fact.value).split(" ")).filter((word) => word.length >= 3 || /\d/u.test(word)).map((word) => word.slice(0, 5)));
    const overlap = (a, b) => {
        const union = new Set([...a, ...b]);
        return union.size ? [...a].filter((word) => b.has(word)).length / union.size : 1;
    };
    for (const row of rows.values()) {
        const sets = row.cells.map(words);
        row.differs = sets.some((set, index) => sets.slice(index + 1).some((other) => overlap(set, other) < 0.5));
    }
    const weight = (row) => (row.cells.length >= 2 ? 10 : 0) + (row.differs ? 10 : 0);
    return [...rows.values()].sort((a, b) => weight(b) - weight(a) || a.topic.localeCompare(b.topic, "pl"));
}
export function factMatrixPrompt(witness, rows, dropped, scope = "witness") {
    if (!rows.length)
        return "";
    if (scope === "documents")
        return documentMatrixPrompt(rows, dropped);
    const cited = rows.filter((row) => /dokument\s+powołany/iu.test(row.attribute));
    const byTopic = new Map();
    for (const row of rows)
        byTopic.set(row.topic, [...(byTopic.get(row.topic) ?? []), row]);
    return [
        `# MACIERZ FAKTÓW ZEZNAŃ ŚWIADKA ${witness} — TEMAT × CECHA × PROTOKÓŁ (fakty opisane przez model, każdy cytat sprawdzony przez aplikację w protokole${dropped ? `; odrzucono ${dropped} bez pokrycia w protokole` : ""})`,
        "RÓŻNE = ta sama cecha tematu ma w protokołach inne wartości (kandydat na sprzeczność albo zmianę wersji). Fakty do pisma bierz z macierzy; każdą RÓŻNICĘ albo wykaż z cytatami obu protokołów, albo wyjaśnij, dlaczego nie jest sprzecznością.",
        "Dowody wynikające z macierzy (reguły ogólne): protokół z innej sprawy powołuj jako dokument urzędowy (k.p.c.: dowód tego, co w nim urzędowo zaświadczono); dokument, na który świadek się powołał, a który ma strona przeciwna — wniosek o jego przedstawienie; wiadomości, o których mówi świadek, a które ma strona — dowód z ich wydruku; wartość zależną od faktu jeszcze nieustalonego (np. dokładnej daty) przedstaw w wariantach, nie jako pewną.",
        ...[...byTopic].map(([topic, list]) => [
            `## ${topic}`,
            ...list.map((row) => `- ${row.attribute}${row.differs ? " · RÓŻNE" : row.cells.length >= 2 ? " · zgodne" : " · tylko w jednym protokole"}: ` +
                row.cells.map((cell) => `[${cell.record}] ${cell.facts.map((fact) => `${fact.value} („${fact.quote}” [[LEXDOC:${fact.documentId}:${fact.chunkIndex}]])`).join("; ")}`).join(" ‖ "))
        ].join("\n")),
        ...(cited.length ? [`Dokumenty powołane przez świadka (rozważ wniosek o ich przedstawienie): ${cited.flatMap((row) => row.cells.flatMap((cell) => cell.facts.map((fact) => `${fact.value} [${cell.record}]`))).join("; ")}`] : [])
    ].join("\n");
}
/** One goal per topic with a difference between records. */
export function factMatrixGoals(witness, rows, limit = 6, scope = "witness") {
    const topics = [...new Set(rows.filter((row) => row.differs).map((row) => row.topic))];
    const attributes = (topic) => rows.filter((row) => row.topic === topic && row.differs).map((row) => row.attribute).join(", ");
    return topics
        .slice(0, limit)
        .map((topic) => scope === "documents"
        ? `Rozstrzygnąć rozbieżność dokumentów na korzyść strony albo ją wyjaśnić: ${topic} (${attributes(topic)})`
        : `Wykazać sprzeczność lub zmianę wersji zeznań świadka ${witness}: ${topic} (${attributes(topic)})`);
}
/** The first fact of each record in each differing row: the pleading must use them or set them aside. */
export function factMatrixRequired(rows, limitRows = 6) {
    return rows
        .filter((row) => row.differs)
        .slice(0, limitRows)
        .flatMap((row) => row.cells.map((cell) => ({ documentId: cell.facts[0].documentId, chunkIndex: cell.facts[0].chunkIndex, page: 1, text: cell.facts[0].quote })));
}
/** Paragraph units of each document, labelled "<documentId> — <kind>"; null when too long. */
export function documentUnits(documents, maxChars = 60_000) {
    const total = documents.reduce((sum, document) => sum + document.chunks.reduce((inner, chunk) => inner + chunk.text.length, 0), 0);
    if (total > maxChars)
        return null;
    return documents.flatMap((document) => {
        const heading = `${document.documentId} — ${document.label}`;
        return document.chunks.flatMap((chunk) => {
            const units = [];
            for (const paragraph of chunk.text.split(/\n\s*\n/u).map((item) => item.replace(/\s+/gu, " ").trim()).filter((item) => item.length >= 3)) {
                // Short lines (headings, signatures, list items) joined to the next up to a paragraph's length.
                if (units.length && units[units.length - 1].length < 200)
                    units[units.length - 1] += ` ${paragraph}`;
                else
                    units.push(paragraph);
            }
            return units.map((text) => ({ documentId: document.documentId, chunkIndex: chunk.index, heading, text }));
        });
    });
}
/** Units from the weighted passages on the issue, when the documents are too long to send whole. */
export function passageUnits(passages, labels) {
    return passages.map((passage) => ({ documentId: passage.documentId, chunkIndex: passage.chunkIndex, heading: `${passage.documentId} — ${labels.get(passage.documentId) ?? "dokument"}`, text: passage.text }));
}
function documentMatrixPrompt(rows, dropped) {
    const byTopic = new Map();
    // The topics stated by two documents first; a topic stated by one document only when it is short.
    const shown = rows.filter((row) => row.cells.length >= 2 || rows.length <= 40).slice(0, 80);
    for (const row of shown)
        byTopic.set(row.topic, [...(byTopic.get(row.topic) ?? []), row]);
    const cited = rows.filter((row) => /dokument\s+powołany|dowód\s+wskazany/iu.test(row.attribute));
    return [
        `# MACIERZ FAKTÓW Z DOKUMENTÓW SPRAWY — TEMAT × CECHA × DOKUMENT (fakty opisane przez model, każdy cytat sprawdzony przez aplikację w dokumencie${dropped ? `; odrzucono ${dropped} bez pokrycia w dokumencie` : ""})`,
        "RÓŻNE = dokumenty stwierdzają tę samą cechę tematu inaczej (np. ustalenie organu wobec wyroku, twierdzenie strony wobec protokołu): kandydat na zarzut błędnych ustaleń, sprzeczność albo pominięty dowód. Zgodne = fakt potwierdzony przez kilka dokumentów (mocniejszy dowód). Fakty do pisma bierz z macierzy; każdą RÓŻNICĘ wykorzystaj z cytatami obu dokumentów albo wyjaśnij, dlaczego nie ma znaczenia.",
        "Dowody wynikające z macierzy (reguły ogólne): dokument urzędowy (wyrok, protokół, postanowienie) powołuj jako dowód tego, co w nim urzędowo zaświadczono; dokument albo dowód powołany w aktach, którego nie ma w materiałach, a który ma strona przeciwna lub organ — wniosek o jego przedstawienie albo dołączenie akt; ustalenie bez wskazanego dowodu — zarzut dowolności oceny; wartość zależną od faktu jeszcze nieustalonego przedstaw w wariantach.",
        ...[...byTopic].map(([topic, list]) => [
            `## ${topic}`,
            ...list.map((row) => `- ${row.attribute}${row.differs ? " · RÓŻNE" : row.cells.length >= 2 ? " · zgodne" : " · tylko w jednym dokumencie"}: ` +
                row.cells.map((cell) => `[${cell.record}] ${cell.facts.map((fact) => `${fact.value} („${fact.quote}” [[LEXDOC:${fact.documentId}:${fact.chunkIndex}]])`).join("; ")}`).join(" ‖ "))
        ].join("\n")),
        ...(cited.length ? [`Dokumenty i dowody powołane w aktach (sprawdź, czy są w materiałach; jeśli nie — wniosek o przedstawienie): ${[...new Set(cited.flatMap((row) => row.cells.flatMap((cell) => cell.facts.map((fact) => `${fact.value} [${cell.record}]`))))].slice(0, 20).join("; ")}`] : [])
    ].join("\n");
}
/** Every JSON object of the text: one per line, or the items of an array. */
export function jsonObjects(text) {
    const objects = [];
    for (const line of text.split(/\n/u)) {
        const candidate = line.trim().replace(/^[-*]\s*/u, "").replace(/,$/u, "");
        if (!candidate.startsWith("{") || !candidate.endsWith("}"))
            continue;
        try {
            const value = JSON.parse(candidate);
            if (value && typeof value === "object" && !Array.isArray(value))
                objects.push(value);
        }
        catch {
            // a line cut by the time limit or not JSON
        }
    }
    if (objects.length)
        return objects;
    const array = /\[[\s\S]*\]/u.exec(text)?.[0];
    if (!array)
        return [];
    try {
        const value = JSON.parse(array);
        return Array.isArray(value) ? value.filter((item) => Boolean(item) && typeof item === "object") : [];
    }
    catch {
        return [];
    }
}
const unitList = (units, record) => units
    .filter((item) => (item.heading || item.documentId) === record)
    .map((item) => `- ${item.text}`)
    .join("\n");
export function topicRequest(units, focus, scope, limit = 20) {
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
export function parseTopics(text, records) {
    const known = new Map(records.map((record) => [fold(record), record]));
    const resolve = (name) => known.get(fold(name)) ?? records.find((record) => fold(record).startsWith(fold(name)) || fold(name).startsWith(fold(record).split(" ")[0]));
    return jsonObjects(text)
        .map((item) => ({
        topic: String(item.temat ?? "").trim(),
        attributes: (Array.isArray(item.cechy) ? item.cechy : []).map((value) => String(value).trim()).filter(Boolean),
        records: [...new Set((Array.isArray(item.dokumenty) ? item.dokumenty : []).map((value) => resolve(String(value))).filter((value) => Boolean(value)))]
    }))
        .filter((item) => item.topic && !records.some((record) => fold(record) === fold(item.topic)));
}
export function recordFactRequest(record, units, topics, scope) {
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
export function recordFacts(text, record, units) {
    const lines = jsonObjects(text).map((item) => ({ ...item, protokol: record }));
    return verifiedFacts(JSON.stringify(lines), units);
}
export async function stagedFactMatrix(units, focus, scope, call, options = {}) {
    const records = [...new Set(units.map((item) => item.heading || item.documentId))];
    const failures = [];
    const first = topicRequest(units, focus, scope);
    const topicReply = await call(first.system, first.user, options.topicTimeoutMs ?? 120_000);
    if (topicReply.failure)
        failures.push(`tematy: ${topicReply.failure}`);
    const topics = parseTopics(topicReply.text, records);
    if (!topics.length)
        return { facts: [], dropped: 0, topics, failures: [...failures, "tematy: brak tematów w odpowiedzi"] };
    // The documents that speak of a topic (all, when the model named none), those of shared topics first.
    const mentions = new Map(records.map((record) => [record, topics.filter((topic) => topic.records.includes(record)).length]));
    const chosen = (topics.some((topic) => topic.records.length) ? records.filter((record) => mentions.get(record)) : records)
        .sort((a, b) => mentions.get(b) - mentions.get(a))
        .slice(0, options.maxRecords ?? 10);
    const results = [];
    let next = 0;
    const worker = async () => {
        while (next < chosen.length) {
            const record = chosen[next++];
            const own = topics.filter((topic) => !topic.records.length || topic.records.includes(record));
            const ask = recordFactRequest(record, units, own.length ? own : topics, scope);
            const reply = await call(ask.system, ask.user, options.factTimeoutMs ?? 150_000);
            if (reply.failure)
                failures.push(`${record}: ${reply.failure}`);
            results.push(recordFacts(reply.text, record, units));
        }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, chosen.length) }, worker));
    return { facts: results.flatMap((result) => result.facts), dropped: results.reduce((sum, result) => sum + result.dropped, 0), topics, failures };
}
