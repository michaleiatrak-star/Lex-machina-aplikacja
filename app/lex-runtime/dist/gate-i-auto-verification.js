import { courtOfSignature } from "./court-of-signature.js";
import { compactActAbbreviations } from "./legal-act-abbreviations.js";
import { euAct } from "./eu-law-verifier.js";
import { POLISH_DATE_SOURCE, polishDateToIso } from "./event-date-check.js";
import { caseSignatureRecord, detectLegalReferences } from "./finalization-gate.js";
import { verificationMarker } from "./source-anchor.js";
const ACT_ALIAS = /\b(KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)\b/giu;
const SUPREME_COURT = /\b(?:SN|SĄD\s+NAJWYŻSZY|SĄDU\s+NAJWYŻSZEGO)\b/iu;
const CASE_SIGNATURE = /\bsygn\.?\s*(?:akt\s*)?([A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,8}(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,12}){0,3}\s+\d+\/\d{2,4})\b/iu;
// "stan prawny na 1 maja 2023", "na dzień 01.05.2023", "według stanu na 2023-05-01".
const HISTORICAL_SCOPE = new RegExp(`\\b(?:według\\s+stanu\\s+na|stan(?:u)?\\s+(?:prawn\\p{L}*\\s+|prawa\\s+)?na|na\\s+dzień)\\s+(?:dzień\\s+)?(${POLISH_DATE_SOURCE})\\b`, "giu");
const EXPLICIT_UNVERIFIED_MARKER = "⚠️ [NIEWERYFIKOWANE]";
export function detectHistoricalAsOf(value) {
    const matches = [
        ...value.matchAll(HISTORICAL_SCOPE)
    ]
        .map((match) => match[1]
        ? polishDateToIso(match[1])
        : null)
        .filter((date) => Boolean(date));
    const unique = [
        ...new Set(matches)
    ];
    return unique.length === 1
        ? unique[0]
        : undefined;
}
function ledgerRecordForScope(ledger, claim, asOf) {
    const records = ledger.find(claim);
    return [...records]
        .reverse()
        .find((record) => 
    // Interpretacja nie ma stanu prawnego na dzień: liczy się jej sygnatura.
    record.kind === "interpretation" ||
        (asOf
            ? record.asOf === asOf &&
                record.temporalMode ===
                    "HISTORICAL"
            : !record.asOf &&
                record.temporalMode !==
                    "HISTORICAL"));
}
function normalizedClaim(value) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase("pl")
        .replace(/\s+/gu, " ")
        .trim();
}
function aliases(value) {
    return [
        ...new Set([...value.matchAll(ACT_ALIAS)]
            .map((match) => match[1]
            ?.toLocaleUpperCase("pl"))
            .filter((item) => Boolean(item)))
    ];
}
function uniqueActAlias(reference) {
    const claimAliases = aliases(compactActAbbreviations(reference.claim));
    if (claimAliases.length === 1) {
        return claimAliases[0];
    }
    if (claimAliases.length > 1) {
        return null;
    }
    // The act named right after the article ("art. 6 ust. 1 lit. f RODO", "art. 10 dyrektywy
    // 2008/48/WE"), up to the next article: an EU act goes to the EU verification; another act
    // named in words never takes the only abbreviation elsewhere on the line (before, "art. 6 …
    // RODO" on a line with "art. 415 KC" was verified as art. 6 KC and got KC's marker).
    const written = reference.span ?? reference.claim;
    // The whole number only: "art. 4" is not the start of "art. 415".
    const found = new RegExp(`${written.replace(/[.*+?^$()|[\]\\{}]/gu, "\\$&")}(?![\\d\\p{L}^])`, "u").exec(reference.lineText);
    const after = found ? reference.lineText.slice(found.index + found[0].length) : "";
    const own = after.split(/(?<![\p{L}])art(?:ykuł\p{L}*|\.)\s*\d/iu)[0].slice(0, 160);
    const eu = euAct(own);
    if (eu)
        return eu.celex;
    if (OTHER_ACT_WORDS.test(own))
        return null;
    const lineAliases = aliases(compactActAbbreviations(reference.lineText));
    return lineAliases.length === 1
        ? lineAliases[0]
        : null;
}
const OTHER_ACT_WORDS = /(?<![\p{L}])(?:ustaw\p{L}*|konstytucj\p{L}*|rozporządz\p{L}*|dyrektyw\p{L}*|kodeks\p{L}*|Dz\.?\s?U\.?|traktat\p{L}*|konwencj\p{L}*|regulamin\p{L}*|statut\p{L}*|TFUE|TUE|EKPC|Karty)(?![\p{L}])/iu;
function caseSignature(reference) {
    const bare = reference.claim.replace(/^sygn\.?\s*(?:akt\s*)?/iu, "").trim();
    if (reference.kind !== "case" ||
        (!SUPREME_COURT.test(reference.lineText) && courtOfSignature(bare) !== "SN")) {
        return null;
    }
    // "sygn. III CZP 25/11" or the bare "III CZP 25/11" (the repertory names the court).
    return reference.claim
        .match(CASE_SIGNATURE)?.[1]
        ?.trim() ?? (courtOfSignature(bare) ? bare : null);
}
/**
 * A ⚠️ [NIEWERYFIKOWANE] the model wrote at a statute is its own guess, not a
 * status: the registry decides. The marker is released so the provision is
 * verified automatically (fresh, from the thread's evidence memory or the ELI
 * copy); the final gate puts the marker back where verification fails.
 * Lines with a case citation keep theirs (court records have their own rules).
 */
export function releaseModelUnverifiedMarkers(text) {
    let released = 0;
    const lines = text.split(/\r?\n/u).map((line) => {
        if (!line.includes("NIEWERYFIKOWANE"))
            return line;
        const plain = line.replace(/⚠️?\s*\[NIEWERYFIKOWANE\]/gu, "");
        const references = detectLegalReferences(plain);
        if (!references.some((reference) => reference.kind === "statute" || reference.kind === "journal"))
            return line;
        if (references.some((reference) => reference.kind === "case"))
            return line;
        released += (line.match(/⚠️?\s*\[NIEWERYFIKOWANE\]/gu) ?? []).length;
        return plain.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:)])/g, "$1").trimEnd();
    });
    return { text: lines.join("\n"), released };
}
export function planAutomaticLegalVerification(text, ledger, requestedAsOf) {
    const references = detectLegalReferences(text);
    const globalAsOf = requestedAsOf ??
        detectHistoricalAsOf(text);
    const calls = [];
    const skipped = [];
    const seen = new Set();
    for (const reference of references) {
        const key = normalizedClaim(reference.claim);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        const referenceAsOf = detectHistoricalAsOf(reference.lineText) ??
            globalAsOf;
        if (reference.lineText.includes(EXPLICIT_UNVERIFIED_MARKER)) {
            skipped.push({
                claim: reference.claim,
                reason: "EXPLICIT_UNVERIFIED_MARKER"
            });
            continue;
        }
        if (ledgerRecordForScope(ledger, reference.claim, referenceAsOf) ||
            caseSignatureRecord(ledger, reference)) {
            skipped.push({
                claim: reference.claim,
                reason: "ALREADY_IN_LEDGER"
            });
            continue;
        }
        if (reference.kind ===
            "statute" ||
            reference.kind ===
                "journal") {
            const alias = uniqueActAlias(reference);
            if (!alias) {
                skipped.push({
                    claim: reference.claim,
                    reason: "ACT_ALIAS_AMBIGUOUS"
                });
                continue;
            }
            calls.push({
                id: `gate-i-auto-${calls.length + 1}`,
                name: "verify_legal_reference",
                input: {
                    claim: reference.claim,
                    kind: reference.kind,
                    act: alias,
                    ...(referenceAsOf
                        ? {
                            asOf: referenceAsOf
                        }
                        : {})
                }
            });
            continue;
        }
        if (reference.kind ===
            "case") {
            if (!SUPREME_COURT.test(reference.lineText) &&
                // "III CZP 12/21" without the court's name: the repertory names SN.
                courtOfSignature(reference.claim.replace(/^sygn\.?\s*(?:akt\s*)?/iu, "")) !== "SN") {
                skipped.push({
                    claim: reference.claim,
                    reason: "COURT_FAMILY_AMBIGUOUS"
                });
                continue;
            }
            const signature = caseSignature(reference);
            if (!signature) {
                skipped.push({
                    claim: reference.claim,
                    reason: "CASE_SIGNATURE_INVALID"
                });
                continue;
            }
            calls.push({
                id: `gate-i-auto-${calls.length + 1}`,
                name: "verify_case_reference",
                input: {
                    claim: reference.claim,
                    signature,
                    courtFamily: "SN"
                }
            });
            continue;
        }
        // Interpretacja podatkowa: sygnatura sprawdzana w EUREKA przez aplikację.
        if (reference.kind === "interpretation") {
            calls.push({
                id: `gate-i-auto-${calls.length + 1}`,
                name: "verify_interpretation",
                input: { signature: reference.claim }
            });
            continue;
        }
        skipped.push({
            claim: reference.claim,
            reason: "UNSUPPORTED_KIND"
        });
    }
    return {
        calls,
        skipped
    };
}
function marker(record) {
    if (record.status ===
        "UNVERIFIED") {
        return "⚠️ [NIEWERYFIKOWANE]";
    }
    if (record.status !==
        "VERIFIED" ||
        record.sourceTier ===
            "R2B" ||
        record.sourceTier ===
            "R3" ||
        !record.sourceUrl ||
        !record.fetchedAt) {
        return null;
    }
    return verificationMarker(record);
}
export function applyAutomaticVerificationMarkers(text, ledger, requestedAsOf) {
    const references = detectLegalReferences(text);
    const globalAsOf = requestedAsOf ??
        detectHistoricalAsOf(text);
    if (references.length === 0) {
        return {
            text,
            inserted: 0
        };
    }
    const byLine = new Map();
    for (const reference of references) {
        if (reference.lineText.includes(EXPLICIT_UNVERIFIED_MARKER)) {
            continue;
        }
        const referenceAsOf = detectHistoricalAsOf(reference.lineText) ??
            globalAsOf;
        const record = ledgerRecordForScope(ledger, reference.claim, referenceAsOf) ?? caseSignatureRecord(ledger, reference);
        if (!record) {
            continue;
        }
        const current = byLine.get(reference.line) ?? [];
        if (!current.some((item) => normalizedClaim(item.claim) ===
            normalizedClaim(record.claim))) {
            current.push(record);
            byLine.set(reference.line, current);
        }
    }
    if (byLine.size === 0) {
        return {
            text,
            inserted: 0
        };
    }
    let inserted = 0;
    const lines = text.split(/\r?\n/u)
        .map((line, index) => {
        const records = byLine.get(index + 1);
        if (!records ||
            records.length === 0) {
            return line;
        }
        // Dwa przepisy z tej samej strony aktu dają ten sam znacznik.
        const missingMarkers = [...new Set(records
                .map(marker))]
            .filter((value) => Boolean(value))
            .filter((value) => !line.includes(value));
        if (missingMarkers.length ===
            0) {
            return line;
        }
        inserted +=
            missingMarkers.length;
        return [
            line.trimEnd(),
            ...missingMarkers
        ].join(" ");
    });
    return {
        text: lines.join("\n"),
        inserted
    };
}
