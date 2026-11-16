// The same witness heard in different hearings (user 2026-11-16: "wykazanie sprzeczności świadka"):
// a lawyer lays the two records side by side and compares what the witness said on each topic.
// The application finds the witness in each record (the identity legend joins the symbols), takes
// the statements the record attributes to the witness, pairs those on the same topic, and marks
// what differs: numbers and dates, a "nie" in one and not the other, words used in one only. The
// model judges whether a difference is a contradiction; no list of topics or words per case.
const fold = (text) => text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ł/gu, "l");
const STOP = new Set("ktore ktory ktora jest bylo byly bedzie oraz przez przy jako tego tych takze zgodnie wobec ramach sprawie sprawy dnia roku powod powoda powodem powodowi pozwany pozwanej pozwana pozwanego swiadek swiadka mnie mi sie nie tak juz tylko bardzo".split(" "));
// Five letters: the inflected forms of one word meet ("kontaktowali", "kontaktu" -> "konta").
const stem = (word) => (word.length >= 6 ? word.slice(0, 5) : word);
const stemsOf = (text) => [...new Set((fold(text).match(/\p{L}{4,}/gu) ?? []).filter((word) => !STOP.has(word)).map(stem))];
// Numbers, years, months and lengths of time: what a witness most often says differently.
const QUANTITY = /\b\d{1,4}(?:[.,]\d+)?\b|\b(?:styczni|lut|marc|kwietni|maj|czerwc|lipc|sierpni|wrzesni|pazdziernik|listopad|grudni)\p{L}*|\b(?:raz|dwa|trzy|kilka|kilkanascie|ponad|okolo|moze)\s+(?:na\s+)?(?:dzien|tydzien|miesiac|miesiace|miesiecy|rok|lata|lat)\b|\b(?:wczoraj|zeszl\p{L}*\s+rok\p{L}*|w\s+tym\s+roku|na\s+poczatku|pozniej|potem|wczesniej)\b/gu;
/** The heading of a record: its signature and date ("Sygn. akt XI P 27/26", "Dnia 13 listopada 2026 r."). */
export function recordHeading(text) {
    const signature = /Sygn\.?\s*akt:?\s*([^\n]{3,30}?)(?:\s{2,}|\n|$)/u.exec(text)?.[1]?.trim();
    const date = /Dnia[,\s]*(\d{1,2}\s+\p{L}+\s+\d{4})/u.exec(text)?.[1];
    return [signature, date].filter(Boolean).join(", ");
}
/**
 * The statements of each witness in a record: the text after the witness is called ("świadek X …
 * zeznaje:") up to the witness's release or the court's next decision, split into statements.
 * The witness is the placeholder (or name) named after "świadek".
 */
export function witnessStatements(documentId, chunkIndex, text) {
    const result = new Map();
    const heading = recordHeading(text);
    const call = /(?:Staje\s+)?[ŚSśs]wiadek\s*[–-]?\s*(\[(?:LMPII:D\d{2}|PII):PERSON:\d{4}\]|\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+){1,2})/gu;
    const calls = [...text.matchAll(call)];
    calls.forEach((match, index) => {
        const witness = match[1];
        const start = match.index + match[0].length;
        const nextCall = calls.slice(index + 1).find((other) => other[1] !== witness)?.index ?? text.length;
        const rest = text.slice(start, nextCall);
        const testimony = /zeznaje\s*:?/iu.exec(rest);
        if (!testimony)
            return;
        const body = rest.slice(testimony.index + testimony[0].length);
        const end = body.search(/(?:[ŚS]wiadka\s+zwolniono|S[ąa]d\s+postanowi[łl]|Zatrzymano\s+rejestracj)/u);
        const statements = (end >= 0 ? body.slice(0, end) : body)
            .replace(/\b\d{2}:\d{2}:\d{2}\b/gu, "\n")
            .split(/\n\s*[-–•]\s*|(?<=[.!?])\s+(?=\p{Lu})/u)
            .map((item) => item.replace(/\s+/gu, " ").trim())
            // The record's own acts (the court, the parties, the clerk) are not the witness's words.
            .filter((item) => item.length >= 15 && !/^Na\s+pytani/iu.test(item) && !/^(?:Przewodnicząc\p{L}*|S[ąa]d\s|Pow[óo]d\s+(?:podnosi|ponosi|wnosi|oświadcza|precyzuje)|Pe[łl]nomocnik|Protok|W\s+tym\s+miejscu|[ŚS]wiadk\p{L}*\s+zwolniono)/u.test(item));
        const list = result.get(witness) ?? [];
        for (const statement of statements) {
            const clean = statement.replace(/^Na\s+pytani\p{L}*\s+\p{L}+\s*:?\s*/iu, "");
            // A witness called twice in one record ("stawił się świadek X", "Staje świadek X"): once.
            if (!list.some((item) => item.documentId === documentId && item.text === clean))
                list.push({ documentId, chunkIndex, heading, text: clean });
        }
        result.set(witness, list);
    });
    return result;
}
function quantities(text) {
    return [...new Set((fold(text).match(QUANTITY) ?? []).map((item) => item.trim()))];
}
/**
 * Pairs of statements of the same witness from different records (or the same record) on the same
 * topic, strongest first: shared words make the topic, differing quantities, a negation present
 * in one only and words of one only make the difference.
 */
export function statementPairs(byWitness, limit = 12) {
    const pairs = [];
    for (const [witness, statements] of byWitness) {
        for (let i = 0; i < statements.length; i++) {
            for (let j = i + 1; j < statements.length; j++) {
                const first = statements[i];
                const second = statements[j];
                if (first.documentId === second.documentId && first.text === second.text)
                    continue;
                const a = stemsOf(first.text);
                const b = new Set(stemsOf(second.text));
                const shared = a.filter((item) => b.has(item));
                const sameRecord = first.documentId === second.documentId;
                // Within one record only a sharp difference (a quantity or a negation on three shared words).
                if (shared.length < (sameRecord ? 3 : 2))
                    continue;
                const differences = [];
                const qa = quantities(first.text);
                const qb = quantities(second.text);
                if (qa.length && qb.length && qa.join("|") !== qb.join("|"))
                    differences.push(`liczby i czas: „${qa.join(", ")}” wobec „${qb.join(", ")}”`);
                const negA = /\bnie\b/u.test(fold(first.text));
                const negB = /\bnie\b/u.test(fold(second.text));
                if (negA !== negB)
                    differences.push("zaprzeczenie tylko w jednej wypowiedzi");
                const onlyA = a.filter((item) => !b.has(item)).slice(0, 4);
                const onlyB = [...b].filter((item) => !a.includes(item)).slice(0, 4);
                if (!differences.length && !(onlyA.length && onlyB.length))
                    continue;
                if (sameRecord && !differences.length)
                    continue;
                const crossRecord = sameRecord ? 1 : 3;
                pairs.push({ witness, first, second, shared, differences, score: (shared.length + differences.length * 2) * crossRecord });
            }
        }
    }
    // Many topics, not one statement against all others: each statement in at most two pairs.
    const uses = new Map();
    const chosen = [];
    for (const pair of pairs.sort((x, y) => y.score - x.score)) {
        const keys = [`${pair.first.documentId}|${pair.first.text}`, `${pair.second.documentId}|${pair.second.text}`];
        if (keys.some((key) => (uses.get(key) ?? 0) >= 2))
            continue;
        for (const key of keys)
            uses.set(key, (uses.get(key) ?? 0) + 1);
        chosen.push(pair);
        if (chosen.length >= limit)
            break;
    }
    return chosen;
}
export function statementPairsPrompt(pairs) {
    if (!pairs.length)
        return "";
    return [
        "# ZEZNANIA TEGO SAMEGO ŚWIADKA — PARY WYPOWIEDZI NA TEN SAM TEMAT (zestawione przez aplikację)",
        "Wypowiedzi przypisane świadkowi w protokołach, zestawione tematycznie; zaznaczono różnice (liczby i czas, zaprzeczenie, słowa tylko w jednej). Oceń każdą parę: sprzeczność, uzupełnienie czy zgodność. Sprzeczność wykazuj dosłownym cytatem obu wypowiedzi ze wskazaniem protokołu (sygnatura, data) i znacznikiem dokumentu. Nie twórz sprzeczności, których cytaty nie pokazują.",
        ...pairs.map((pair, index) => `P${index + 1}. świadek ${pair.witness}\n  A [[LEXDOC:${pair.first.documentId}:${pair.first.chunkIndex}]] (${pair.first.heading || "protokół"}): „${pair.first.text}”\n  B [[LEXDOC:${pair.second.documentId}:${pair.second.chunkIndex}]] (${pair.second.heading || "protokół"}): „${pair.second.text}”${pair.differences.length ? `\n  różnice: ${pair.differences.join("; ")}` : ""}`)
    ].join("\n");
}
/** Goals of a credibility challenge: one per topic on which the witness's statements differ. */
export function credibilityGoals(pairs, limit = 6) {
    return pairs.slice(0, limit).map((pair) => `Wykazać sprzeczność lub niespójność zeznań świadka ${pair.witness} w temacie: ${pair.shared.slice(0, 4).join(", ")}`);
}
// A statement that refers back: its subject is in the previous statement.
const CONTINUES = /^(?:to|je|ją|go|on|ona|oni|one|tego|tam|wtedy|potem|było\s+to|trwało\s+to|\p{L}+(?:łem|łam|liśmy)\s+(?:je|ją|go|to))(?![\p{L}])/iu;
export function testimonyMatrix(statements, maxTopics = 10) {
    // Units: a statement with the ones that continue it (same record, in order).
    const units = [];
    for (const statement of statements) {
        const last = units[units.length - 1];
        if (last && CONTINUES.test(statement.text.trim()) && last.statements[0].documentId === statement.documentId)
            last.statements.push(statement);
        else
            units.push({ statements: [statement], stems: new Set() });
    }
    for (const unit of units)
        unit.stems = new Set(stemsOf(unit.statements.map((item) => item.text).join(" ")));
    const frequency = new Map();
    for (const unit of units)
        for (const item of unit.stems)
            frequency.set(item, (frequency.get(item) ?? 0) + 1);
    // A word in few units of the testimony is a topic's word; a common one ("praca") is not.
    const rare = (item) => (frequency.get(item) ?? 0) <= Math.max(2, Math.ceil(units.length / 8));
    const similarity = (a, b) => {
        const shared = [...a].filter((item) => b.has(item) && rare(item));
        return { count: shared.length, weight: shared.reduce((sum, item) => sum + 1 / (frequency.get(item) ?? 1), 0) };
    };
    // Topics around a seed (no chaining: a unit joins a topic only if it is like the topic's seed),
    // seeds taken in the order of the testimony; a unit joins the most similar topic.
    const topicsList = [];
    for (const unit of units) {
        let best = null;
        let bestWeight = 0;
        for (const topic of topicsList) {
            const sim = similarity(unit.stems, topic.seed);
            if ((sim.count >= 2 || sim.weight >= 0.5) && sim.weight > bestWeight) {
                best = topic;
                bestWeight = sim.weight;
            }
        }
        if (best)
            best.units.push(unit);
        else
            topicsList.push({ seed: unit.stems, units: [unit] });
    }
    // Mutual nearest statements of two records (each the other's most similar in the other record)
    // tell one thing twice: the second joins the first one's topic, whatever the order of seeding.
    const recordOfUnit = (unit) => unit.statements[0].documentId;
    const nearest = units.map((unit) => {
        let best = -1;
        let bestWeight = 0.3;
        units.forEach((other, index) => {
            if (recordOfUnit(other) === recordOfUnit(unit))
                return;
            const sim = similarity(unit.stems, other.stems);
            if (sim.weight > bestWeight) {
                best = index;
                bestWeight = sim.weight;
            }
        });
        return best;
    });
    const topicOf = (unit) => topicsList.find((topic) => topic.units.includes(unit));
    units.forEach((unit, index) => {
        const other = nearest[index];
        if (other < 0 || nearest[other] !== index || index > other)
            return;
        const home = topicOf(unit);
        const away = topicOf(units[other]);
        if (home === away)
            return;
        away.units = away.units.filter((item) => item !== units[other]);
        home.units.push(units[other]);
    });
    // A topic heard in one record only and one heard in another record only, on the same subject
    // (one rarer word in common is enough here), are one topic told twice: joined.
    const recordsOf = (topic) => new Set(topic.units.flatMap((unit) => unit.statements.map((item) => item.documentId)));
    const stemsOfTopic = (topic) => new Set(topic.units.flatMap((unit) => [...unit.stems]));
    for (let i = 0; i < topicsList.length; i++) {
        const a = topicsList[i];
        const recordsA = recordsOf(a);
        if (recordsA.size !== 1 || !a.units.length)
            continue;
        let best = -1;
        let bestWeight = 0.4;
        for (let j = 0; j < topicsList.length; j++) {
            const b = topicsList[j];
            if (i === j || !b.units.length)
                continue;
            const recordsB = recordsOf(b);
            if (recordsB.size !== 1 || [...recordsB][0] === [...recordsA][0])
                continue;
            const sim = similarity(stemsOfTopic(a), stemsOfTopic(b));
            if (sim.weight > bestWeight) {
                best = j;
                bestWeight = sim.weight;
            }
        }
        if (best >= 0) {
            topicsList[best].units.push(...a.units);
            a.units = [];
        }
    }
    const topics = new Map(topicsList.filter((topic) => topic.units.length).map((topic, index) => [index, topic.units]));
    const rows = [];
    for (const group of topics.values()) {
        const all = group.flatMap((unit) => unit.statements);
        const records = [...new Set(all.map((item) => item.documentId))];
        const counts = new Map();
        for (const unit of group)
            for (const item of unit.stems)
                if (rare(item))
                    counts.set(item, (counts.get(item) ?? 0) + 1);
        const label = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([item]) => item).join(", ");
        const byRecord = records.map((documentId) => {
            const statementsOf = all.filter((item) => item.documentId === documentId);
            return { documentId, heading: statementsOf[0].heading, statements: statementsOf };
        });
        const differences = [];
        if (byRecord.length >= 2) {
            const quantitiesOf = byRecord.map((column) => quantities(column.statements.map((item) => item.text).join(" ")));
            if (quantitiesOf.every((list) => list.length) && new Set(quantitiesOf.map((list) => list.join("|"))).size > 1) {
                differences.push(`liczby i czas: ${byRecord.map((column, index) => `${column.heading || column.documentId}: „${quantitiesOf[index].join(", ")}”`).join(" wobec ")}`);
            }
        }
        // Rows on which the records differ first, then rows heard in both, then the rest.
        const weight = (byRecord.length >= 2 ? 10 : 0) + differences.length * 5 + all.length;
        rows.push({ label, byRecord, differences, weight });
    }
    return rows.sort((a, b) => b.weight - a.weight).slice(0, maxTopics).map(({ weight: _weight, ...row }) => row);
}
export function testimonyMatrixPrompt(witness, rows) {
    if (!rows.length)
        return "";
    return [
        `# MACIERZ ZEZNAŃ ŚWIADKA ${witness} — TEMATY × PROTOKOŁY (zestawione przez aplikację)`,
        "Wiersz = temat, kolumny = protokoły; w komórce wszystkie wypowiedzi świadka na ten temat w tym protokole (dosłownie). Pracuj na macierzy: dla każdego tematu z dwoma protokołami porównaj komórki (sprzeczność, zmiana wersji, nowy element, zgodność) i oceń, czy ocena świadka zgadza się z jego własnym opisem faktów. Fakty do pisma bierz z macierzy, cytując obie komórki ze wskazaniem protokołu.",
        ...rows.map((row, index) => `T${index + 1}. temat: ${row.label || "—"}${row.differences.length ? ` · różnice: ${row.differences.join("; ")}` : ""}\n` +
            row.byRecord.map((column) => `  [${column.heading || column.documentId}] ${column.statements.map((item) => `„${item.text}” [[LEXDOC:${item.documentId}:${item.chunkIndex}]]`).join(" ")}`).join("\n"))
    ].join("\n");
}
/** One goal per topic heard in two records (no duplicates for one topic). */
export function matrixGoals(witness, rows, limit = 6) {
    return rows.filter((row) => row.byRecord.length >= 2).slice(0, limit).map((row) => `Wykazać sprzeczność lub zmianę wersji zeznań świadka ${witness} w temacie: ${row.label}`);
}
