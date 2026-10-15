import type { LegalActDescriptor } from "./legal-act-resolver.js";
import { compactActAbbreviations } from "./legal-act-abbreviations.js";
import {
  assertVerificationTierPolicy,
  type LegalSourceCrossCheckStatus,
  type LegalSourceProvenance,
  type LegalSourceTier
} from "./legal-source-policy.js";

export type VerificationKind =
  | "statute"
  | "journal"
  | "case"
  | "deadline"
  | "amount"
  | "interpretation";

export type VerificationStatus =
  | "VERIFIED"
  | "SUPPORTED"
  | "UNVERIFIED";

export type VerificationMethod =
  | "web_fetch"
  | "web_fetch_pdf"
  | "web_search"
  | "mcp_call"
  | "provider_tool"
  | "file_read";

// Najstarsze sprawdzenie aktualności t.j. w ELI, które jeszcze potwierdza brzmienie
// obowiązujące (relacje ELI są odświeżane raz dziennie).
export const FRESHNESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type VerificationRecord = {
  claim: string;
  kind: VerificationKind;
  status: VerificationStatus;
  sourceUrl?: string;
  // sourceUrl z kotwicą do jednostki redakcyjnej (#page=N w PDF, id jednostki w HTML ELI).
  sourceAnchorUrl?: string;
  sourceTier?: LegalSourceTier;
  sourceProvenance?: LegalSourceProvenance;
  crossCheckStatus?: LegalSourceCrossCheckStatus;
  crossCheckUrl?: string;
  crossCheckTier?: "R1" | "R2A";
  fetchedAt: string;
  toolCallId?: string;
  verificationMethod?: VerificationMethod;
  temporalMode?: "CURRENT" | "HISTORICAL";
  temporalFreshnessStatus?: "CURRENT" | "HISTORICAL";
  freshnessCheckedAt?: string;
  currentEli?: string;
  asOf?: string;
  sourceFormat?: "TEXT" | "PDF";
  caseScope?:
    | "FULL_TEXT"
    | "EXACT_QUOTE"
    | "PROPOSITION_SUPPORT";
  caseSignature?: string;
  evidenceHash?: string;
  supportQuoteHash?: string;
  supportQuote?: string;
  evidence?: string;
  // NSA/WSA (CBOSA) material is kept as a dated snapshot and never promoted
  // to VERIFIED/SUPPORTED.
  verificationCeiling?: "SNAPSHOT_NO_PROMOTION";
  // Źródło zastępcze przy BRAKU-AKTU w RZĘDZIE 1 (kanon E-3/E-4): RZĄD 2A daje VERIFIED,
  // RZĄD 2B najwyżej 🟨 KOTWICA URZĘDOWA (officialAnchor, status UNVERIFIED).
  substituteFor?: "R1";
  officialAnchor?: true;
  // Akt, którego aktualny t.j. sprawdzono (pamięć dowodowa wątku sprawdza go ponownie w ELI).
  actDescriptor?: LegalActDescriptor;
  // Interpretacja (EUREKA): status aktualności w dniu sprawdzenia, np. "Aktualna".
  interpretationStatus?: string;
};

function normalizeClaim(value: string): string {
  // Superscripts first: NFKC would turn "101²" into "1012".
  return compactActAbbreviations(value).normalize("NFKC")
    .toLocaleLowerCase("pl")
    .replace(/[.,;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class VerificationLedger {
  private readonly records = new Map<string, VerificationRecord[]>();

  add(record: VerificationRecord): void {
    if (!record.claim.trim()) {
      throw new Error("Verification claim cannot be empty.");
    }

    assertVerificationTierPolicy({
      status:
        record.status,
      ...(record.sourceTier
        ? {
            sourceTier:
              record.sourceTier
          }
        : {})
    });

    if (
      record.crossCheckStatus ===
        "CONFIRMED_R1_R2A" &&
      (
        !record.crossCheckUrl?.trim() ||
        (
          record.crossCheckTier !==
            "R1" &&
          record.crossCheckTier !==
            "R2A"
        )
      )
    ) {
      throw new Error(
        "Confirmed higher-tier cross-check requires R1/R2A tier and source URL."
      );
    }
    if (
      (record.status === "VERIFIED" ||
        record.status === "SUPPORTED") &&
      !record.sourceUrl?.trim()
    ) {
      throw new Error(
        "Verified/supported claims require a source URL."
      );
    }

    if (
      record.status === "SUPPORTED" &&
      (
        record.caseScope !==
          "PROPOSITION_SUPPORT" ||
        !record.caseSignature?.trim() ||
        !record.evidenceHash?.trim() ||
        !record.supportQuoteHash?.trim() ||
        !record.supportQuote?.trim()
      )
    ) {
      throw new Error(
        "Supported propositions require case signature, support quote and evidence hashes."
      );
    }

    const key = normalizeClaim(record.claim);
    const current = this.records.get(key) ?? [];
    current.push({ ...record });
    this.records.set(key, current);
  }

  find(claim: string): VerificationRecord[] {
    return [...(this.records.get(normalizeClaim(claim)) ?? [])];
  }

  latest(claim: string): VerificationRecord | undefined {
    const records = this.find(claim);
    return records.at(-1);
  }

  all(): VerificationRecord[] {
    return [...this.records.values()].flatMap((records) => records);
  }

  // Signatures of the user's own proceeding (header of the case's documents, the user's
  // messages): the case file number, not a judgment cited as authority.
  private readonly caseFiles = new Set<string>();

  addCaseFileNumber(signature: string): void {
    const key = caseFileKey(signature);
    if (key) this.caseFiles.add(key);
  }

  caseFileNumbers(): string[] {
    return [...this.caseFiles];
  }

  // Signatures the case's materials or the user's messages name (a related or another
  // proceeding, often absent from the judgment databases): shown marked, never blocking.
  private readonly caseReferenceKeys = new Set<string>();

  addCaseReference(signature: string): void {
    const key = caseFileKey(signature);
    if (key) this.caseReferenceKeys.add(key);
  }

  caseReferences(): string[] {
    return [...this.caseReferenceKeys];
  }

  // Signatures an official database returned in this turn (search hits, fetched documents).
  private readonly retrievedCaseKeys = new Set<string>();

  addRetrievedCase(signature: string): void {
    const key = caseFileKey(signature);
    if (key) this.retrievedCaseKeys.add(key);
  }

  retrievedCases(): string[] {
    return [...this.retrievedCaseKeys];
  }

  // Values the case itself states (the user's messages, the case's documents): a fact of the
  // matter ("pozew o 48 000 zł"), not a statutory rate or term to verify.
  private readonly factAmounts = new Set<string>();

  addFactAmount(key: string): void {
    if (key) this.factAmounts.add(key);
  }

  factAmountKeys(): string[] {
    return [...this.factAmounts];
  }
}

export const caseFileKey = (value: string): string =>
  value.replace(/^sygn\.?\s*(?:akt\s*)?:?\s*/iu, "").replace(/\./g, "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pl");