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
            .filter((item) => item.length >= 15 && !/^Na\s+pytani/iu.test(item));
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
