import { DOTTED_ACT_ALTERNATIVES, compactActAbbreviations } from "./legal-act-abbreviations.js";
import { verificationMarker } from "./source-anchor.js";
import { statuteClaimsInLine } from "./status-consistency-gate.js";
import {
  VerificationLedger,
  type VerificationRecord
} from "./verification-ledger.js";

export type DetectedLegalReference = {
  // A statute cited without its act ("Art. 233" under a heading about the
  // Criminal Code) carries the act resolved from the line or the answer.
  claim: string;
  kind: "statute" | "journal" | "case";
  line: number;
  lineText: string;
  // The text as written, when it differs from the claim.
  span?: string;
};

export type FinalizationFinding = {
  reference: DetectedLegalReference;
  status:
    | "VERIFIED"
    | "UNVERIFIED_MARKED"
    | "MISSING_LEDGER_RECORD"
    | "MISSING_VERIFICATION_MARKER"
    | "VERIFICATION_MARKER_MISMATCH"
    | "UNVERIFIED_NOT_MARKED";
  record?: VerificationRecord;
};

export type CaseQuoteFinding = {
  evidenceHash: string;
  line: number;
  lineText: string;
  status:
    | "VERIFIED"
    | "MISSING_CASE_QUOTE_LEDGER"
    | "QUOTE_TEXT_MISMATCH"
    | "CASE_SIGNATURE_MISSING";
  record?: VerificationRecord;
};

export type CaseSupportFinding = {
  evidenceHash: string;
  line: number;
  lineText: string;
  status:
    | "SUPPORTED"
    | "MISSING_CASE_SUPPORT_LEDGER"
    | "PROPOSITION_TEXT_MISMATCH"
    | "SUPPORT_QUOTE_MISSING"
    | "CASE_SIGNATURE_MISSING";
  record?: VerificationRecord;
};

export type FinalizationReport = {
  gate: "G8_HARD_GATE_FINALIZATION";
  result: "PASS" | "DEGRADED" | "BLOCKED";
  references: DetectedLegalReference[];
  findings: FinalizationFinding[];
  caseQuoteFindings: CaseQuoteFinding[];
  caseSupportFindings: CaseSupportFinding[];
};

const VERIFIED_MARKER = /✅\s*\[VER:/iu;
const VERIFIED_MARKER_TOKEN =
  /✅\s*\[VER:[^\]\r\n]+\]/giu;
// 🟨 KOTWICA URZĘDOWA (kanon PRAWO-HARDGATE-BLOKADA) nie jest ✅: liczy się jak oznaczony ⚠️.
const UNVERIFIED_MARKER = /⚠️?\s*\[NIEWERYFIKOWANE\]|🟨\s*\[KOTWICA-URZĘDOWA[:\]]/iu;
const CASE_QUOTE_MARKER =
  /✅\s*\[CASE-QUOTE:([a-f0-9]{20})\]/giu;
const CASE_SUPPORT_MARKER =
  /🔗\s*\[CASE-SUPPORT:([a-f0-9]{20})\]/giu;

export function expectedVerificationMarker(
  record: VerificationRecord
): string | null {
  return verificationMarker(record);
}

const ARTICLE_PATTERN = new RegExp(
  `\\bart\\.?\\s+\\d+[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*(?:\\s*§\\s*\\d+[a-zA-Z]*)?(?:\\s+(?:${DOTTED_ACT_ALTERNATIVES}|KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)(?![\\p{L}]))?`,
  "giu"
);

const DZU_PATTERN =
  /\bDz\.?\s*U\.?\s*(?:(?:z\s+)?\d{4}\s*r?\.?\s*)?poz\.?\s*\d+/giu;

const CASE_PATTERN =
  /\bsygn\.?\s*(?:akt\s*)?[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,8}(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ0-9]{1,12}){0,3}\s+\d+\/\d{2,4}\b/gu;

function normalizeEvidenceText(
  value: string
): string {
  return value
    .normalize("NFKC")
    .toLocaleUpperCase("pl")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectMatches(
  lineText: string,
  line: number,
  kind: DetectedLegalReference["kind"],
  pattern: RegExp
): DetectedLegalReference[] {
  const references: DetectedLegalReference[] = [];
  pattern.lastIndex = 0;
  for (const match of lineText.matchAll(pattern)) {
    // "art. 233 k.k." and "art. 233 KK" are one provision.
    const written = match[0]?.trim() ?? "";
    const claim = kind === "statute" ? compactActAbbreviations(written) : written;
    if (!claim) continue;
    references.push({ claim, kind, line, lineText, ...(claim !== written ? { span: written } : {}) });
  }
  return references;
}

const ACT_SUFFIX = /\s(KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)$/u;
const ACT_IN_TEXT = /(?<![\p{L}])(KC|KPC|KK|KPK|KPA|KP|KRO|KSH|KW|KPW|PZP)(?![\p{L}])/gu;
// Another act named in words: an act-less article on such a line is not resolved.
const OTHER_ACT = /(?<![\p{L}])(?:ustaw\p{L}*|konstytucj\p{L}*|rozporządz\p{L}*|dyrektyw\p{L}*|kodeks\p{L}*|p\.?\s?p\.?\s?s\.?\s?a\.?|Dz\.?\s?U\.?|traktat\p{L}*|konwencj\p{L}*|regulamin\p{L}*|statut\p{L}*|umow\p{L}*|TFUE|TUE|RODO|EKPC)(?![\p{L}])/iu;

const actsIn = (value: string): Set<string> =>
  new Set([...compactActAbbreviations(value).matchAll(ACT_IN_TEXT)].map((match) => match[1]!));

/**
 * The act of an act-less statute: the only act on its line, else the act this
 * article carries elsewhere in the answer, else the only act of the answer.
 * Never across another act named in words ("art. 4 ustawy o …").
 */
function resolveActs(references: DetectedLegalReference[], text: string): DetectedLegalReference[] {
  const actsByUnit = new Map<string, Set<string>>();
  for (const reference of references) {
    const act = reference.kind === "statute" ? ACT_SUFFIX.exec(reference.claim)?.[1] : undefined;
    if (!act) continue;
    const unit = reference.claim.replace(ACT_SUFFIX, "").replace(/\s+/g, " ").toLocaleLowerCase("pl");
    actsByUnit.set(unit, (actsByUnit.get(unit) ?? new Set()).add(act));
  }
  const answerActs = actsIn(text);
  return references.map((reference) => {
    if (reference.kind !== "statute" || ACT_SUFFIX.test(reference.claim)) return reference;
    if (OTHER_ACT.test(reference.lineText)) return reference;
    const unit = reference.claim.replace(/\s+/g, " ").toLocaleLowerCase("pl");
    const lineActs = actsIn(reference.lineText);
    const unitActs = actsByUnit.get(unit);
    const act =
      lineActs.size === 1
        ? [...lineActs][0]
        : lineActs.size === 0 && unitActs?.size === 1
          ? [...unitActs][0]
          : lineActs.size === 0 && answerActs.size === 1
            ? [...answerActs][0]
            : undefined;
    return act ? { ...reference, claim: `${reference.claim} ${act}`, span: reference.span ?? reference.claim } : reference;
  });
}

export function detectLegalReferences(text: string): DetectedLegalReference[] {
  const references: DetectedLegalReference[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((lineText, index) => {
    const line = index + 1;
    references.push(
      ...collectMatches(lineText, line, "statute", ARTICLE_PATTERN),
      ...collectMatches(lineText, line, "journal", DZU_PATTERN),
      ...collectMatches(lineText, line, "case", CASE_PATTERN)
    );
  });

  return resolveActs(references, text);
}

function comparableClaim(value: string): string {
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
function coveringVerifiedRecord(
  ledger: VerificationLedger,
  reference: DetectedLegalReference,
  lineMarkers: string[]
): VerificationRecord | undefined {
  if (reference.kind !== "statute") return undefined;
  const prefix = comparableClaim(reference.claim) + " ";
  const covering = ledger
    .all()
    .filter(
      (record) =>
        record.status === "VERIFIED" &&
        comparableClaim(record.claim).startsWith(prefix)
    )
    .filter((record) => {
      const marker = expectedVerificationMarker(record);
      return Boolean(marker) && lineMarkers.includes(marker!);
    });
  const claims = new Set(covering.map((record) => comparableClaim(record.claim)));
  // "art. 233 KK" and "art. 233 § 1 KK" with one marker on the line: one source.
  const markers = new Set(covering.map((record) => expectedVerificationMarker(record)));
  return claims.size === 1 || markers.size === 1 ? covering.at(-1) : undefined;
}

export class FinalizationGate {
  evaluate(text: string, ledger: VerificationLedger): FinalizationReport {
    const references = detectLegalReferences(text);
    const findings: FinalizationFinding[] = [];
    const caseQuoteFindings: CaseQuoteFinding[] = [];
    const caseSupportFindings: CaseSupportFinding[] = [];

    for (const reference of references) {
      const lineMarkers:
        string[] =
          reference.lineText.match(
            VERIFIED_MARKER_TOKEN
          ) ?? [];
      const allowedLineMarkers =
        new Set<string>(
          references
            .filter(
              (candidate) =>
                candidate.line ===
                  reference.line
            )
            .map(
              (candidate) =>
                ledger.latest(
                  candidate.claim
                ) ??
                coveringVerifiedRecord(
                  ledger,
                  candidate,
                  lineMarkers
                )
            )
            .filter(
              (
                candidate
              ): candidate is VerificationRecord =>
                candidate?.status ===
                  "VERIFIED"
            )
            .map(
              expectedVerificationMarker
            )
            .filter(
              (
                marker
              ): marker is string =>
                Boolean(marker)
            )
        );
      // Wyliczenie "art. 233 i 234 KK": znacznik drugiego przepisu też należy do wiersza.
      for (const claim of statuteClaimsInLine(reference.lineText)) {
        const enumerated = ledger.latest(claim);
        const marker =
          enumerated?.status === "VERIFIED"
            ? expectedVerificationMarker(enumerated)
            : null;
        if (marker) allowedLineMarkers.add(marker);
      }
      const unexpectedLineMarker =
        lineMarkers.some(
          (marker) =>
            !allowedLineMarkers.has(
              marker
            )
        );

      const record =
        ledger.latest(reference.claim) ??
        coveringVerifiedRecord(ledger, reference, lineMarkers);
      // HARD GATE: no access to a source -> [NIEWERYFIKOWANE], never an
      // unmarked claim. A marked claim without any record is shown marked.
      if (!record && UNVERIFIED_MARKER.test(reference.lineText)) {
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
        const expectedMarker =
          expectedVerificationMarker(
            record
          );

        if (!VERIFIED_MARKER.test(reference.lineText)) {
          findings.push({
            reference,
            status: "MISSING_VERIFICATION_MARKER",
            record
          });
        } else if (
          !expectedMarker ||
          !lineMarkers.includes(
            expectedMarker
          ) ||
          unexpectedLineMarker
        ) {
          findings.push({
            reference,
            status:
              "VERIFICATION_MARKER_MISMATCH",
            record
          });
        } else {
          findings.push({
            reference,
            status: "VERIFIED",
            record
          });
        }
        continue;
      }

      if (UNVERIFIED_MARKER.test(reference.lineText)) {
        findings.push({
          reference,
          status: "UNVERIFIED_MARKED",
          record
        });
      } else {
        findings.push({
          reference,
          status: "UNVERIFIED_NOT_MARKED",
          record
        });
      }
    }

    const lines = text.split(/\r?\n/u);

    lines.forEach((lineText, index) => {
      CASE_QUOTE_MARKER.lastIndex = 0;

      for (
        const match of lineText.matchAll(
          CASE_QUOTE_MARKER
        )
      ) {
        const evidenceHash =
          match[1] ?? "";
        if (!evidenceHash) {
          continue;
        }

        const record =
          ledger.all().find(
            (candidate) =>
              candidate.status ===
                "VERIFIED" &&
              candidate.kind === "case" &&
              candidate.caseScope ===
                "EXACT_QUOTE" &&
              candidate.evidenceHash ===
                evidenceHash
          );

        if (!record) {
          caseQuoteFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "MISSING_CASE_QUOTE_LEDGER"
          });
          continue;
        }

        if (
          !record.claim ||
          !lineText.includes(
            record.claim
          )
        ) {
          caseQuoteFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "QUOTE_TEXT_MISMATCH",
            record
          });
          continue;
        }

        const normalizedLine =
          normalizeEvidenceText(lineText);
        const normalizedSignature =
          normalizeEvidenceText(
            record.caseSignature ?? ""
          );

        if (
          !normalizedSignature ||
          !normalizedLine.includes(
            normalizedSignature
          )
        ) {
          caseQuoteFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "CASE_SIGNATURE_MISSING",
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

      for (
        const match of lineText.matchAll(
          CASE_SUPPORT_MARKER
        )
      ) {
        const evidenceHash =
          match[1] ?? "";
        if (!evidenceHash) {
          continue;
        }

        const record =
          ledger.all().find(
            (candidate) =>
              candidate.status ===
                "SUPPORTED" &&
              candidate.kind === "case" &&
              candidate.caseScope ===
                "PROPOSITION_SUPPORT" &&
              candidate.evidenceHash ===
                evidenceHash
          );

        if (!record) {
          caseSupportFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "MISSING_CASE_SUPPORT_LEDGER"
          });
          continue;
        }

        if (
          !record.claim ||
          !lineText.includes(
            record.claim
          )
        ) {
          caseSupportFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "PROPOSITION_TEXT_MISMATCH",
            record
          });
          continue;
        }

        if (
          !record.supportQuote ||
          !lineText.includes(
            record.supportQuote
          )
        ) {
          caseSupportFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "SUPPORT_QUOTE_MISSING",
            record
          });
          continue;
        }

        const normalizedLine =
          normalizeEvidenceText(lineText);
        const normalizedSignature =
          normalizeEvidenceText(
            record.caseSignature ?? ""
          );

        if (
          !normalizedSignature ||
          !normalizedLine.includes(
            normalizedSignature
          )
        ) {
          caseSupportFindings.push({
            evidenceHash,
            line: index + 1,
            lineText,
            status:
              "CASE_SIGNATURE_MISSING",
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

    const blocked = findings.some((finding) =>
      [
        "MISSING_LEDGER_RECORD",
        "MISSING_VERIFICATION_MARKER",
        "VERIFICATION_MARKER_MISMATCH",
        "UNVERIFIED_NOT_MARKED"
      ].includes(finding.status)
    ) ||
    caseQuoteFindings.some(
      (finding) =>
        finding.status !== "VERIFIED"
    ) ||
    caseSupportFindings.some(
      (finding) =>
        finding.status !== "SUPPORTED"
    );

    const degraded =
      !blocked &&
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
export function markUnverifiedReferences(
  text: string,
  report: FinalizationReport
): string {
  const markable = new Set<FinalizationFinding["status"]>([
    "MISSING_LEDGER_RECORD",
    "UNVERIFIED_NOT_MARKED"
  ]);
  const byLine = new Map<number, string[]>();
  for (const finding of report.findings) {
    if (!markable.has(finding.status)) continue;
    if (finding.reference.kind === "case") continue;
    byLine.set(finding.reference.line, [
      ...(byLine.get(finding.reference.line) ?? []),
      finding.reference.span ?? finding.reference.claim
    ]);
  }
  if (byLine.size === 0) return text;
  const lines = text.split(/\r?\n/u);
  for (const [line, claims] of byLine) {
    let lineText = lines[line - 1] ?? "";
    for (const claim of [...new Set(claims)]) {
      const at = lineText.indexOf(claim);
      if (at < 0) continue;
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
export function addMissingVerificationMarkers(
  text: string,
  report: FinalizationReport
): string {
  const byLine = new Map<number, Set<string>>();
  for (const finding of report.findings) {
    if (finding.status !== "MISSING_VERIFICATION_MARKER" && finding.status !== "VERIFICATION_MARKER_MISMATCH") continue;
    const marker = finding.record ? expectedVerificationMarker(finding.record) : null;
    if (!marker) continue;
    byLine.set(finding.reference.line, (byLine.get(finding.reference.line) ?? new Set()).add(marker));
  }
  if (byLine.size === 0) return text;
  const lines = text.split(/\r?\n/u);
  for (const [line, markers] of byLine) {
    const current = lines[line - 1] ?? "";
    const missing = [...markers].filter((marker) => !current.includes(marker));
    if (missing.length === 0) continue;
    const insert = missing.join(" ");
    lines[line - 1] = /\|\s*$/u.test(current)
      ? current.replace(/\s*\|\s*$/u, ` ${insert} |`)
      : `${current.trimEnd()} ${insert}`;
  }
  return lines.join("\n");
}

