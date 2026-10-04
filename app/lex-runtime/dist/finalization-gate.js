import { DOTTED_ACT_ALTERNATIVES, compactActAbbreviations } from "./legal-act-abbreviations.js";
import { amountMarkerSpans, amountMatches, evidenceHasAmount, markerSpansAfter } from "./amount-references.js";
import { interpretationSignaturesInLine } from "./interpretation-verifier.js";
import { verificationMarker } from "./source-anchor.js";
import { statuteClaimsInLine } from "./status-consistency-gate.js";
const VERIFIED_MARKER = /✅\s*\[VER:/iu;
const VERIFIED_MARKER_TOKEN = /✅\s*\[VER:[^\]\r\n]+\]/giu;
// 🟨 KOTWICA URZĘDOWA (kanon PRAWO-HARDGATE-BLOKADA) nie jest ✅: liczy się jak oznaczony ⚠️.
const UNVERIFIED_MARKER = /⚠️?\s*\[NIEWERYFIKOWANE\]|🟨\s*\[KOTWICA-URZĘDOWA[:\]]/iu;
const CASE_QUOTE_MARKER = /✅\s*\[CASE-QUOTE:([a-f0-9]{20})\]/giu;
const CASE_SUPPORT_MARKER = /🔗\s*\[CASE-SUPPORT:([a-f0-9]{20})\]/giu;
export function expectedVerificationMarker(record) {
    return verificationMarker(record);
}
const ARTICLE_PATTERN = new RegExp(`\\bart\\.?\\s+\\d+[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*(?:\\s*§\\s*\\d+[a-zA-Z]*)?(?:\\s+(?:${DOTTED_ACT_ALTERNATIVES}|KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)(?![\\p{L}]))?`, "giu");
const DZU_PATTERN = /\bDz\.?\s*U\.?\s*(?:(?:z\s+)?\d{4}\s*r?\.?\s*)?poz\.?\s*\d+/giu;
const CASE_PATTERN = /\bsygn\.?\s*(?:akt\s*)?[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,8}(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,12}){0,3}\s+\d+\/\d{2,4}\b/gu;
function normalizeEvidenceText(value) {
    return value
        .normalize("NFKC")
        .toLocaleUpperCase("pl")
        .replace(/\./g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function collectMatches(lineText, line, kind, pattern) {
    const references = [];
    pattern.lastIndex = 0;
    for (const match of lineText.matchAll(pattern)) {
        // "art. 233 k.k." and "art. 233 KK" are one provision.
        const written = match[0]?.trim() ?? "";
        const claim = kind === "statute" ? compactActAbbreviations(written) : written;
        if (!claim)
            continue;
        references.push({ claim, kind, line, lineText, ...(claim !== written ? { span: written } : {}) });
    }
    return references;
}
const ACT_SUFFIX = /\s(KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)$/u;
const ACT_IN_TEXT = /(?<![\p{L}])(KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)(?![\p{L}])/gu;
// Another act named in words: an act-less article on such a line is not resolved.
const OTHER_ACT = /(?<![\p{L}])(?:ustaw\p{L}*|konstytucj\p{L}*|rozporządz\p{L}*|dyrektyw\p{L}*|kodeks\p{L}*|p\.?\s?p\.?\s?s\.?\s?a\.?|Dz\.?\s?U\.?|traktat\p{L}*|konwencj\p{L}*|regulamin\p{L}*|statut\p{L}*|umow\p{L}*|TFUE|TUE|RODO|EKPC)(?![\p{L}])/iu;
const actsIn = (value) => new Set([...compactActAbbreviations(value).matchAll(ACT_IN_TEXT)].map((match) => match[1]));
/**
 * The act of an act-less statute: the only act on its line, else the act this
 * article carries elsewhere in the answer, else the only act of the answer.
 * Never across another act named in words ("art. 4 ustawy o …").
 */
function resolveActs(references, text) {
    const actsByUnit = new Map();
    for (const reference of references) {
        const act = reference.kind === "statute" ? ACT_SUFFIX.exec(reference.claim)?.[1] : undefined;
        if (!act)
            continue;
        const unit = reference.claim.replace(ACT_SUFFIX, "").replace(/\s+/g, " ").toLocaleLowerCase("pl");
        actsByUnit.set(unit, (actsByUnit.get(unit) ?? new Set()).add(act));
    }
    const answerActs = actsIn(text);
    return references.map((reference) => {
        if (reference.kind !== "statute" || ACT_SUFFIX.test(reference.claim))
            return reference;
        if (OTHER_ACT.test(reference.lineText))
            return reference;
        const unit = reference.claim.replace(/\s+/g, " ").toLocaleLowerCase("pl");
        const lineActs = actsIn(reference.lineText);
        const unitActs = actsByUnit.get(unit);
        const act = lineActs.size === 1
            ? [...lineActs][0]
            : lineActs.size === 0 && unitActs?.size === 1
                ? [...unitActs][0]
                : lineActs.size === 0 && answerActs.size === 1
                    ? [...answerActs][0]
                    : undefined;
        return act ? { ...reference, claim: `${reference.claim} ${act}`, span: reference.span ?? reference.claim } : reference;
    });
}
export function detectLegalReferences(text) {
    const references = [];
    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, index) => {
        const line = index + 1;
        references.push(...collectMatches(lineText, line, "statute", ARTICLE_PATTERN), ...collectMatches(lineText, line, "journal", DZU_PATTERN), ...collectMatches(lineText, line, "case", CASE_PATTERN), ...interpretationSignaturesInLine(lineText).map((claim) => ({ claim, kind: "interpretation", line, lineText })));
    });
    return resolveActs(references, text);
}
function comparableClaim(value) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase("pl")
        .replace(/[.,;:()[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
// Wykrywanie rozpoznaje "art. 46", a zweryfikowano "art. 46 ust. 2 ustawy o ...": zapis
// bardziej szczegółowej jednostki tego artykułu obejmuje wzmiankę, gdy jego znacznik VER
// stoi w tym samym wierszu. Tylko jeden taki zapis; inaczej brak dopasowania.
function coveringVerifiedRecord(ledger, reference, lineMarkers) {
    if (reference.kind !== "statute")
        return undefined;
    const prefix = comparableClaim(reference.claim) + " ";
    const covering = ledger
        .all()
        .filter((record) => record.status === "VERIFIED" &&
        comparableClaim(record.claim).startsWith(prefix))
        .filter((record) => {
        const marker = expectedVerificationMarker(record);
        return Boolean(marker) && lineMarkers.includes(marker);
    });
    const claims = new Set(covering.map((record) => comparableClaim(record.claim)));
    // "art. 233 KK" and "art. 233 § 1 KK" with one marker on the line: one source.
    const markers = new Set(covering.map((record) => expectedVerificationMarker(record)));
    return claims.size === 1 || markers.size === 1 ? covering.at(-1) : undefined;
}
// ⚠️ przypięty do wartości liczbowej albo do innej sygnatury interpretacji nie oznacza
// powołania, które sprawdzamy (każde ma mieć własny znacznik).
function withoutAttachedMarkers(reference) {
    const line = reference.lineText;
    const signatures = interpretationSignaturesInLine(line).filter((signature) => signature !== reference.claim && line.includes(signature));
    const spans = [
        ...amountMarkerSpans(line),
        ...markerSpansAfter(line, signatures.map((signature) => line.indexOf(signature) + signature.length))
    ];
    if (reference.kind === "interpretation" && line.includes(reference.claim)) {
        // Sygnatura sprawdzana: liczy się wyłącznie ⚠️ tuż za nią.
        return markerSpansAfter(line, [line.indexOf(reference.claim) + reference.claim.length]).length ? "⚠️ [NIEWERYFIKOWANE]" : "";
    }
    return spans
        .sort((a, b) => b.start - a.start)
        .reduce((text, span) => text.slice(0, span.start) + text.slice(span.end), line);
}
export class FinalizationGate {
    evaluate(text, ledger) {
        const references = detectLegalReferences(text);
        const findings = [];
        const caseQuoteFindings = [];
        const caseSupportFindings = [];
        for (const reference of references) {
            const lineMarkers = reference.lineText.match(VERIFIED_MARKER_TOKEN) ?? [];
            const allowedLineMarkers = new Set(references
                .filter((candidate) => candidate.line ===
                reference.line)
                .map((candidate) => ledger.latest(candidate.claim) ??
                coveringVerifiedRecord(ledger, candidate, lineMarkers))
                .filter((candidate) => candidate?.status ===
                "VERIFIED")
                .map(expectedVerificationMarker)
                .filter((marker) => Boolean(marker)));
            // Wyliczenie "art. 233 i 234 KK": znacznik drugiego przepisu też należy do wiersza.
            for (const claim of statuteClaimsInLine(reference.lineText)) {
                const enumerated = ledger.latest(claim);
                const marker = enumerated?.status === "VERIFIED"
                    ? expectedVerificationMarker(enumerated)
                    : null;
                if (marker)
                    allowedLineMarkers.add(marker);
            }
            const unexpectedLineMarker = lineMarkers.some((marker) => !allowedLineMarkers.has(marker));
            const record = ledger.latest(reference.claim) ??
                coveringVerifiedRecord(ledger, reference, lineMarkers);
            // HARD GATE: no access to a source -> [NIEWERYFIKOWANE], never an
            // unmarked claim. A marked claim without any record is shown marked.
            const ownUnverified = UNVERIFIED_MARKER.test(withoutAttachedMarkers(reference));
            if (!record && ownUnverified) {
                findings.push({
                    reference,
                    status: "UNVERIFIED_MARKED"
                });
                continue;
            }
            if (!record) {
                findings.push({
                    reference,
                    status: "MISSING_LEDGER_RECORD"
                });
                continue;
            }
            if (record.status === "VERIFIED") {
                const expectedMarker = expectedVerificationMarker(record);
                if (!VERIFIED_MARKER.test(reference.lineText)) {
                    findings.push({
                        reference,
                        status: "MISSING_VERIFICATION_MARKER",
                        record
                    });
                }
                else if (!expectedMarker ||
                    !lineMarkers.includes(expectedMarker) ||
                    unexpectedLineMarker) {
                    findings.push({
                        reference,
                        status: "VERIFICATION_MARKER_MISMATCH",
                        record
                    });
                }
                else {
                    findings.push({
                        reference,
                        status: "VERIFIED",
                        record
                    });
                }
                continue;
            }
            if (ownUnverified) {
                findings.push({
                    reference,
                    status: "UNVERIFIED_MARKED",
                    record
                });
            }
            else {
                findings.push({
                    reference,
                    status: "UNVERIFIED_NOT_MARKED",
                    record
                });
            }
        }
        const lines = text.split(/\r?\n/u);
        // Stawka, termin, kara: potwierdzona brzmieniem przepisu VERIFIED z tego wiersza.
        lines.forEach((lineText, index) => {
            const amounts = amountMatches(lineText);
            if (amounts.length === 0)
                return;
            const lineRecords = [
                ...references.filter((reference) => reference.line === index + 1 && reference.kind === "statute").map((reference) => reference.claim),
                ...statuteClaimsInLine(lineText)
            ]
                .map((claim) => ledger.latest(claim))
                .filter((record) => record?.status === "VERIFIED" && Boolean(record.evidence));
            const marked = amountMarkerSpans(lineText);
            for (const amount of amounts) {
                const reference = { claim: amount.text, kind: "amount", line: index + 1, lineText };
                const record = lineRecords.find((candidate) => evidenceHasAmount(candidate.evidence, amount.key));
                if (record) {
                    findings.push({ reference, status: "VERIFIED", record });
                }
                else if (marked.some((span) => span.start >= amount.end && span.start <= amount.end + 3) ||
                    (lineRecords.length === 0 && !VERIFIED_MARKER.test(lineText) && UNVERIFIED_MARKER.test(lineText))) {
                    findings.push({ reference, status: "UNVERIFIED_MARKED" });
                }
                else {
                    findings.push({ reference, status: "UNVERIFIED_NOT_MARKED" });
                }
            }
        });
        lines.forEach((lineText, index) => {
            CASE_QUOTE_MARKER.lastIndex = 0;
            for (const match of lineText.matchAll(CASE_QUOTE_MARKER)) {
                const evidenceHash = match[1] ?? "";
                if (!evidenceHash) {
                    continue;
                }
                const record = ledger.all().find((candidate) => candidate.status ===
                    "VERIFIED" &&
                    candidate.kind === "case" &&
                    candidate.caseScope ===
                        "EXACT_QUOTE" &&
                    candidate.evidenceHash ===
                        evidenceHash);
                if (!record) {
                    caseQuoteFindings.push({
                        evidenceHash,
                        line: index + 1,
                        lineText,
                        status: "MISSING_CASE_QUOTE_LEDGER"
                    });
                    continue;
                }
                if (!record.claim ||
                    !lineText.includes(record.claim)) {
                    caseQuoteFindings.push({
                        evidenceHash,
                        line: index + 1,
                        lineText,
                        status: "QUOTE_TEXT_MISMATCH",
                        record
                    });
                    continue;
                }
                const normalizedLine = normalizeEvidenceText(lineText);
                const normalizedSignature = normalizeEvidenceText(record.caseSignature ?? "");
                if (!normalizedSignature ||
                    !normalizedLine.includes(normalizedSignature)) {
                    caseQuoteFindings.push({
                        evidenceHash,
                        line: index + 1,
                        lineText,
                        status: "CASE_SIGNATURE_MISSING",
                        record
                    });
                    continue;
                }
                caseQuoteFindings.push({
                    evidenceHash,
                    line: index + 1,
                    lineText,
                    status: "VERIFIED",
                    record
                });
            }
            CASE_SUPPORT_MARKER.lastIndex = 0;
            for (const match of lineText.matchAll(CASE_SUPPORT_MARKER)) {
                const evidenceHash = match[1] ?? "";
                if (!evidenceHash) {
                    continue;
                }
                const record = ledger.all().find((candidate) => candidate.status ===
                    "SUPPORTED" &&
                    candidate.kind === "case" &&
                    candidate.caseScope ===
                        "PROPOSITION_SUPPORT" &&
                    candidate.evidenceHash ===
                        evidenceHash);
                if (!record) {
                    caseSupportFindings.push({
                        evidenceHash,
                        line: index + 1,
                        lineText,
                        status: "MISSING_CASE_SUPPORT_LEDGER"
                    });
                    continue;
                }
                if (!record.claim ||
                    !lineText.includes(record.claim)) {
                    caseSupportFindings.push({
                        evidenceHash,
                        line: index + 1,
                        lineText,
                        status: "PROPOSITION_TEXT_MISMATCH",
                        record
                    });
                    continue;
                }
                if (!record.supportQuote ||
                    !lineText.includes(record.supportQuote)) {
                    caseSupportFindings.push({
                        evidenceHash,
                        line: index + 1,
                        lineText,
                        status: "SUPPORT_QUOTE_MISSING",
                        record
                    });
                    continue;
                }
                const normalizedLine = normalizeEvidenceText(lineText);
                const normalizedSignature = normalizeEvidenceText(record.caseSignature ?? "");
                if (!normalizedSignature ||
                    !normalizedLine.includes(normalizedSignature)) {
                    caseSupportFindings.push({
                        evidenceHash,
                        line: index + 1,
                        lineText,
                        status: "CASE_SIGNATURE_MISSING",
                        record
                    });
                    continue;
                }
                caseSupportFindings.push({
                    evidenceHash,
                    line: index + 1,
                    lineText,
                    status: "SUPPORTED",
                    record
                });
            }
        });
        const blocked = findings.some((finding) => [
            "MISSING_LEDGER_RECORD",
            "MISSING_VERIFICATION_MARKER",
            "VERIFICATION_MARKER_MISMATCH",
            "UNVERIFIED_NOT_MARKED"
        ].includes(finding.status)) ||
            caseQuoteFindings.some((finding) => finding.status !== "VERIFIED") ||
            caseSupportFindings.some((finding) => finding.status !== "SUPPORTED");
        const degraded = !blocked &&
            findings.some((finding) => finding.status === "UNVERIFIED_MARKED");
        return {
            gate: "G8_HARD_GATE_FINALIZATION",
            result: blocked ? "BLOCKED" : degraded ? "DEGRADED" : "PASS",
            references,
            findings,
            caseQuoteFindings,
            caseSupportFindings
        };
    }
}
export const UNVERIFIED_MARKER_TEXT = "⚠️ [NIEWERYFIKOWANE]";
/**
 * Inserts the HARD GATE marker after every statute or Dz.U. reference that
 * has no VERIFIED record and no marker yet, so an unverified claim is never
 * shown unmarked. Case-law findings are not marked here: they block.
 */
export function markUnverifiedReferences(text, report) {
    const markable = new Set([
        "MISSING_LEDGER_RECORD",
        "UNVERIFIED_NOT_MARKED"
    ]);
    const byLine = new Map();
    for (const finding of report.findings) {
        if (!markable.has(finding.status))
            continue;
        if (finding.reference.kind === "case")
            continue;
        byLine.set(finding.reference.line, [
            ...(byLine.get(finding.reference.line) ?? []),
            finding.reference.span ?? finding.reference.claim
        ]);
    }
    if (byLine.size === 0)
        return text;
    const lines = text.split(/\r?\n/u);
    for (const [line, claims] of byLine) {
        let lineText = lines[line - 1] ?? "";
        for (const claim of [...new Set(claims)]) {
            const at = lineText.indexOf(claim);
            if (at < 0)
                continue;
            const end = at + claim.length;
            lineText = `${lineText.slice(0, end)} ${UNVERIFIED_MARKER_TEXT}${lineText.slice(end)}`;
        }
        lines[line - 1] = lineText;
    }
    return lines.join("\n");
}
/**
 * A provision verified in this turn but cited again without its marker (another
 * paragraph, a comparison table) gets the marker of its VERIFIED record from the
 * ledger. Only true ledger markers are added; a fabricated marker is not touched.
 * In a table row the markers go into the last cell, keeping the row valid.
 */
export function addMissingVerificationMarkers(text, report) {
    const byLine = new Map();
    for (const finding of report.findings) {
        if (finding.status !== "MISSING_VERIFICATION_MARKER" && finding.status !== "VERIFICATION_MARKER_MISMATCH")
            continue;
        const marker = finding.record ? expectedVerificationMarker(finding.record) : null;
        if (!marker)
            continue;
        byLine.set(finding.reference.line, (byLine.get(finding.reference.line) ?? new Set()).add(marker));
    }
    if (byLine.size === 0)
        return text;
    const lines = text.split(/\r?\n/u);
    for (const [line, markers] of byLine) {
        const current = lines[line - 1] ?? "";
        const missing = [...markers].filter((marker) => !current.includes(marker));
        if (missing.length === 0)
            continue;
        const insert = missing.join(" ");
        lines[line - 1] = /\|\s*$/u.test(current)
            ? current.replace(/\s*\|\s*$/u, ` ${insert} |`)
            : `${current.trimEnd()} ${insert}`;
    }
    return lines.join("\n");
}
