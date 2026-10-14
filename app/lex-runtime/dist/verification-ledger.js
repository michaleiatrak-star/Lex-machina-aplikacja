import { compactActAbbreviations } from "./legal-act-abbreviations.js";
import { assertVerificationTierPolicy } from "./legal-source-policy.js";
// Najstarsze sprawdzenie aktualności t.j. w ELI, które jeszcze potwierdza brzmienie
// obowiązujące (relacje ELI są odświeżane raz dziennie).
export const FRESHNESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function normalizeClaim(value) {
    return compactActAbbreviations(value.normalize("NFKC"))
        .toLocaleLowerCase("pl")
        .replace(/[.,;:()[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
export class VerificationLedger {
    records = new Map();
    add(record) {
        if (!record.claim.trim()) {
            throw new Error("Verification claim cannot be empty.");
        }
        assertVerificationTierPolicy({
            status: record.status,
            ...(record.sourceTier
                ? {
                    sourceTier: record.sourceTier
                }
                : {})
        });
        if (record.crossCheckStatus ===
            "CONFIRMED_R1_R2A" &&
            (!record.crossCheckUrl?.trim() ||
                (record.crossCheckTier !==
                    "R1" &&
                    record.crossCheckTier !==
                        "R2A"))) {
            throw new Error("Confirmed higher-tier cross-check requires R1/R2A tier and source URL.");
        }
        if ((record.status === "VERIFIED" ||
            record.status === "SUPPORTED") &&
            !record.sourceUrl?.trim()) {
            throw new Error("Verified/supported claims require a source URL.");
        }
        if (record.status === "SUPPORTED" &&
            (record.caseScope !==
                "PROPOSITION_SUPPORT" ||
                !record.caseSignature?.trim() ||
                !record.evidenceHash?.trim() ||
                !record.supportQuoteHash?.trim() ||
                !record.supportQuote?.trim())) {
            throw new Error("Supported propositions require case signature, support quote and evidence hashes.");
        }
        const key = normalizeClaim(record.claim);
        const current = this.records.get(key) ?? [];
        current.push({ ...record });
        this.records.set(key, current);
    }
    find(claim) {
        return [...(this.records.get(normalizeClaim(claim)) ?? [])];
    }
    latest(claim) {
        const records = this.find(claim);
        return records.at(-1);
    }
    all() {
        return [...this.records.values()].flatMap((records) => records);
    }
    // Signatures of the user's own proceeding (header of the case's documents, the user's
    // messages): the case file number, not a judgment cited as authority.
    caseFiles = new Set();
    addCaseFileNumber(signature) {
        const key = caseFileKey(signature);
        if (key)
            this.caseFiles.add(key);
    }
    caseFileNumbers() {
        return [...this.caseFiles];
    }
    // Signatures the case's materials or the user's messages name (a related or another
    // proceeding, often absent from the judgment databases): shown marked, never blocking.
    caseReferenceKeys = new Set();
    addCaseReference(signature) {
        const key = caseFileKey(signature);
        if (key)
            this.caseReferenceKeys.add(key);
    }
    caseReferences() {
        return [...this.caseReferenceKeys];
    }
    // Signatures an official database returned in this turn (search hits, fetched documents).
    retrievedCaseKeys = new Set();
    addRetrievedCase(signature) {
        const key = caseFileKey(signature);
        if (key)
            this.retrievedCaseKeys.add(key);
    }
    retrievedCases() {
        return [...this.retrievedCaseKeys];
    }
    // Values the case itself states (the user's messages, the case's documents): a fact of the
    // matter ("pozew o 48 000 zł"), not a statutory rate or term to verify.
    factAmounts = new Set();
    addFactAmount(key) {
        if (key)
            this.factAmounts.add(key);
    }
    factAmountKeys() {
        return [...this.factAmounts];
    }
}
export const caseFileKey = (value) => value.replace(/^sygn\.?\s*(?:akt\s*)?:?\s*/iu, "").replace(/\./g, "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pl");
