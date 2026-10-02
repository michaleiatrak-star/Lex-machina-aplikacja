import { verificationMarker } from "./source-anchor.js";
const ACTS = "KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP|KKS|KKW|PPSA|KSCU";
const UNIT = "\\d+[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{0,3}(?:\\s*§\\s*\\d+[a-z]?)?(?:\\s+ust\\.?\\s*\\d+[a-z]?)?(?:\\s+pkt\\s*\\d+[a-z]?)?";
// "art. 233", "art. 233 § 1 KK", "art. 233 i 234 KK", "art. 233, 234 oraz 235 KK", "art. 233–234 KK".
const REFERENCE = new RegExp(`(?<!\\p{L})art(?:\\.|ykuł\\p{L}*)?\\s+(${UNIT}(?:\\s*(?:,|i|oraz|lub|albo|a także|–|-)\\s*(?:art\\.?\\s+)?${UNIT})*)(?:\\s+(${ACTS})\\b)?`, "giu");
const ENUMERATION_ITEM = new RegExp(UNIT, "gu");
const RANGE_SEPARATOR = /^\s*[–-]\s*$/u;
const VERIFIED_MARKER = /✅\s*\[VER:[^\]\r\n]*\]/gu;
const UNVERIFIED_MARKER = /⚠️?\s*\[NIEWERYFIKOWANE\]/gu;
const APPLICATION_HEDGE = /\b(?:potencjaln\p{L}*|ewentualn\p{L}*|prawdopodobn\p{L}*|hipotetyczn\p{L}*|mo(?:że|gą|głoby|głyby)\s+(?:mieć\s+zastosowanie|wypełni\p{L}*|stanowić|wchodzić\s+w\s+grę|znaleźć\s+zastosowanie)|w\s+zależności\s+od\s+okoliczności)/iu;
function compact(value) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase("pl")
        .replace(/\s+/gu, " ")
        .replace(/\s*§\s*/gu, " § ")
        .trim();
}
function lineTokens(lineText) {
    const tokens = [];
    REFERENCE.lastIndex = 0;
    for (const match of lineText.matchAll(REFERENCE)) {
        const body = match[1] ?? "";
        const act = match[2]?.toLocaleUpperCase("pl") ?? null;
        const bodyStart = match.index + match[0].indexOf(body);
        const items = [...body.matchAll(ENUMERATION_ITEM)];
        items.forEach((item, index) => {
            const unit = item[0].trim();
            const previous = items[index - 1];
            const separator = previous
                ? body.slice(previous.index + previous[0].length, item.index)
                : "";
            // "art. 233–235" to przedział, nie trzy przepisy: zakres nie jest rozwijany.
            if (previous && RANGE_SEPARATOR.test(separator))
                return;
            const start = bodyStart + item.index;
            // Ostatnia pozycja wyliczenia obejmuje skrót aktu ("234 KK").
            const end = index === items.length - 1
                ? match.index + match[0].length
                : start + item[0].length;
            tokens.push({
                type: "reference",
                start,
                end,
                claim: `art. ${unit}${act ? ` ${act}` : ""}`,
                article: unit.match(/^\d+[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*/u)?.[0] ?? unit,
                act
            });
        });
    }
    for (const [pattern, status] of [
        [VERIFIED_MARKER, "VERIFIED"],
        [UNVERIFIED_MARKER, "UNVERIFIED"]
    ]) {
        pattern.lastIndex = 0;
        for (const match of lineText.matchAll(pattern)) {
            tokens.push({
                type: "marker",
                start: match.index,
                end: match.index + match[0].length,
                status
            });
        }
    }
    return tokens.sort((a, b) => a.start - b.start);
}
/** Powołania artykułów w wierszu, z rozwiniętym wyliczeniem: "art. 233 i 234 KK" -> oba. */
export function statuteClaimsInLine(lineText) {
    return [
        ...new Set(lineTokens(lineText).flatMap((token) => token.type === "reference" ? [token.claim] : []))
    ];
}
// Znaczniki należą do przepisów stojących przed nimi od poprzedniego znacznika;
// znacznik na początku wiersza należy do pierwszej grupy przepisów po nim.
function lineGroups(tokens) {
    const groups = [];
    let current = { references: [], markers: [] };
    let leading = [];
    for (const token of tokens) {
        if (token.type === "reference") {
            if (current.markers.length > 0) {
                groups.push(current);
                current = { references: [], markers: [] };
            }
            current.references.push(token);
            if (leading.length > 0) {
                current.markers.push(...leading);
                leading = [];
            }
            continue;
        }
        if (current.references.length === 0) {
            leading.push(token);
        }
        else {
            current.markers.push(token);
        }
    }
    if (current.references.length > 0)
        groups.push(current);
    return groups;
}
function groupStatus(group) {
    const verified = group.markers.some((marker) => marker.status === "VERIFIED");
    const unverified = group.markers.some((marker) => marker.status === "UNVERIFIED");
    if (verified && unverified)
        return "CONFLICT";
    if (verified)
        return "VERIFIED";
    if (unverified)
        return "UNVERIFIED";
    return "UNMARKED";
}
function parse(text) {
    return text.split(/\r?\n/u).map((lineText, index) => {
        const tokens = lineTokens(lineText);
        const groups = lineGroups(tokens);
        return {
            line: index + 1,
            text: lineText,
            groups,
            orphanUnverified: groups.length === 0 &&
                tokens.some((token) => token.type === "marker" && token.status === "UNVERIFIED")
        };
    });
}
// Przepis bez skrótu aktu ("art. 233") przyjmuje skrót, gdy w odpowiedzi ten numer
// artykułu występuje z dokładnie jednym aktem; inaczej pozostaje osobnym kluczem.
function keyResolver(lines) {
    const actsByUnit = new Map();
    for (const line of lines) {
        for (const group of line.groups) {
            for (const reference of group.references) {
                if (!reference.act)
                    continue;
                const unit = compact(reference.claim.replace(/\s+\S+$/u, ""));
                actsByUnit.set(unit, (actsByUnit.get(unit) ?? new Set()).add(reference.act));
            }
        }
    }
    return (reference) => {
        if (reference.act)
            return compact(reference.claim);
        const unit = compact(reference.claim);
        const acts = actsByUnit.get(unit);
        return acts?.size === 1 ? `${unit} ${[...acts][0].toLocaleLowerCase("pl")}` : unit;
    };
}
function verifiedRecord(ledger, claims) {
    for (const claim of claims) {
        const record = ledger.latest(claim);
        if (record) {
            return record.status === "VERIFIED" && verificationMarker(record) ? record : undefined;
        }
    }
    return undefined;
}
// Najpierw najdokładniejsze powołanie (ze skrótem aktu), potem zapis z odpowiedzi.
function ledgerClaims(reference, key) {
    return [...new Set([key, reference.claim])];
}
function occurrences(text) {
    const lines = parse(text);
    const resolve = keyResolver(lines);
    const items = [];
    for (const line of lines) {
        const applicationHedge = APPLICATION_HEDGE.test(line.text);
        for (const group of line.groups) {
            const status = groupStatus(group);
            for (const reference of group.references) {
                const key = resolve(reference);
                items.push({
                    key,
                    claim: reference.claim,
                    line: line.line,
                    status,
                    applicationHedge,
                    claims: ledgerClaims(reference, key)
                });
            }
        }
    }
    return { lines, items };
}
export function evaluateStatusConsistency(text, ledger) {
    const { lines, items } = occurrences(text);
    const byKey = new Map();
    for (const item of items) {
        byKey.set(item.key, [...(byKey.get(item.key) ?? []), item]);
    }
    const provisions = [];
    const findings = [];
    for (const [key, list] of byKey) {
        const marked = list.filter((item) => item.status !== "UNMARKED");
        const statuses = [...new Set(marked.map((item) => item.status))];
        const lineNumbers = [...new Set(list.map((item) => item.line))];
        const conflict = statuses.includes("CONFLICT") ||
            (statuses.includes("VERIFIED") && statuses.includes("UNVERIFIED"));
        provisions.push({
            key,
            status: conflict ? "CONFLICT" : statuses[0] ?? "UNMARKED",
            lines: lineNumbers
        });
        if (conflict) {
            findings.push({
                key,
                code: "CONFLICTING_STATUS",
                lines: [...new Set(marked.map((item) => item.line))],
                statuses
            });
        }
        const contradicted = marked.filter((item) => item.status !== "VERIFIED" && verifiedRecord(ledger, item.claims));
        if (contradicted.length > 0) {
            findings.push({
                key,
                code: "STATUS_CONTRADICTS_LEDGER",
                lines: [...new Set(contradicted.map((item) => item.line))],
                statuses
            });
            const hedged = contradicted.filter((item) => item.applicationHedge);
            if (hedged.length > 0) {
                findings.push({
                    key,
                    code: "STATUS_MIXED_WITH_APPLICATION",
                    lines: [...new Set(hedged.map((item) => item.line))],
                    statuses
                });
            }
        }
    }
    return {
        gate: "G39I_STATUS_CONSISTENCY",
        result: findings.length > 0 ? "BLOCKED" : "PASS",
        provisions,
        findings,
        orphanUnverifiedLines: lines
            .filter((line) => line.orphanUnverified)
            .map((line) => line.line)
    };
}
/**
 * Naprawa według rejestru weryfikacji: przepis, który narzędzie zweryfikowało
 * (VERIFIED), traci w każdym miejscu odpowiedzi znacznik ⚠️ [NIEWERYFIKOWANE] i
 * dostaje ten sam znacznik ✅ [VER: …]. Przepis bez rekordu VERIFIED nie jest
 * zmieniany: sprzeczność zostaje i blokuje odpowiedź.
 */
export function reconcileStatusMarkers(text, ledger) {
    const lines = parse(text);
    const resolve = keyResolver(lines);
    const ledgerMarkers = new Set(ledger
        .all()
        .map((record) => verificationMarker(record))
        .filter((marker) => Boolean(marker)));
    let repaired = 0;
    const output = lines.map((line) => {
        const edits = [];
        for (const group of line.groups) {
            const status = groupStatus(group);
            if (status !== "UNVERIFIED" && status !== "CONFLICT")
                continue;
            const records = group.references.map((reference) => verifiedRecord(ledger, ledgerClaims(reference, resolve(reference))));
            if (records.every((record) => !record)) {
                // Nic w grupie nie jest zweryfikowane: ✅ bez rekordu VERIFIED w rejestrze jest
                // zmyślony i znika, ⚠️ zostaje. Prawdziwy ✅ innego przepisu zostaje (blokada).
                if (status !== "CONFLICT")
                    continue;
                for (const marker of group.markers) {
                    if (marker.status !== "VERIFIED")
                        continue;
                    if (ledgerMarkers.has(line.text.slice(marker.start, marker.end)))
                        continue;
                    const start = line.text[marker.start - 1] === " " ? marker.start - 1 : marker.start;
                    edits.push({ start, end: marker.end, insert: "" });
                    repaired += 1;
                }
                continue;
            }
            const missing = (record) => {
                const marker = verificationMarker(record);
                return line.text.includes(marker) ? null : marker;
            };
            if (records.every(Boolean)) {
                // Cała grupa zweryfikowana: ⚠️ znika, a w jego miejscu stają brakujące ✅.
                const markers = [
                    ...new Set(records.map((record) => missing(record)).filter(Boolean))
                ];
                const unverified = group.markers.filter((marker) => marker.status === "UNVERIFIED");
                unverified.forEach((marker, index) => {
                    const insert = index === 0 ? markers.join(" ") : "";
                    // Usunięcie bez zamiennika zabiera też spację przed znacznikiem.
                    const start = !insert && line.text[marker.start - 1] === " "
                        ? marker.start - 1
                        : marker.start;
                    edits.push({ start, end: marker.end, insert });
                });
                repaired += unverified.length;
                continue;
            }
            // Grupa mieszana: ✅ bezpośrednio po zweryfikowanym przepisie, ⚠️ zostaje przy reszcie.
            group.references.forEach((reference, index) => {
                const record = records[index];
                const marker = record ? missing(record) : null;
                if (!marker)
                    return;
                edits.push({ start: reference.end, end: reference.end, insert: ` ${marker}` });
                repaired += 1;
            });
        }
        if (edits.length === 0)
            return line.text;
        let next = line.text;
        for (const edit of edits.sort((a, b) => b.start - a.start)) {
            next = next.slice(0, edit.start) + edit.insert + next.slice(edit.end);
        }
        return next;
    });
    return { text: repaired > 0 ? output.join("\n") : text, repaired };
}
