import {
  FinalizationGate,
  addMissingVerificationMarkers,
  markUnverifiedReferences
} from "./finalization-gate.js";
import type { MatterComplexity } from "./matter-complexity.js";
import { verificationSourceLink } from "./source-anchor.js";
import {
  evaluateStatusConsistency,
  reconcileStatusMarkers,
  stripUnbackedVerificationMarkers
} from "./status-consistency-gate.js";
import { genericWords } from "./privacy/generic-words.js";
import { compactActAbbreviations } from "./legal-act-abbreviations.js";
import { exampleDataKeepDirectives } from "./privacy/example-data.js";
import type { EvidenceImage } from "./document-evidence.js";
import type { PseudonymizationVaultSnapshot } from "./privacy/pseudonymizer.js";
import {
  placeholderGrammar,
  partyGroups,
  placeholderKeyPrompt,
  type PlaceholderGrammar
} from "./privacy/token-legend.js";
import { coreLawRetrievalPrompt } from "./core-law-tool-runtime.js";
import {
  restoreWithReport,
  type Restoration
} from "./privacy/restoration-report.js";
import type {
  PersonMorphology
} from "./privacy/person-morphology.js";
import {
  AuditTrail,
  type AuditEvent
} from "./audit-trail.js";
import { AuditedFinalizer } from "./audited-finalizer.js";
import {
  LexExecutionEngine,
  latestUserTurn,
  isTrivialChatCommand,
  type ExecutionEvent
} from "./execution-engine.js";
import { ProviderGateway } from "./providers/gateway.js";
import type { ExecutionStepReporter } from "./execution-steps.js";
import type {
  NormalizedToolCall,
  NormalizedToolResult,
  ProviderId,
  StreamCallbacks
} from "./providers/types.js";
import { LexSkillRegistry } from "./registry.js";
import {
  VerificationLedger,
  type VerificationRecord
} from "./verification-ledger.js";
import type {
  LegalVerificationToolFactory
} from "./verification-tool-runtime.js";
import {
  coreLawEliCaution,
  type CoreLawIndex
} from "./core-law-index.js";
import {
  CoreLawToolRuntime
} from "./core-law-tool-runtime.js";
import {
  LegalCorpusToolRuntime
} from "./legal-corpus-tool-runtime.js";
import {
  LegalFederationToolRuntime,
  type LegalFederationAuditEvent
} from "./legal-federation-tool-runtime.js";
import type {
  LegalSourceCrossCheckStatus,
  LegalSourceTier
} from "./legal-source-policy.js";
import { WidgetToolRuntime, type WidgetSpec } from "./widget-runtime.js";
import { CaseFileToolRuntime, type CaseFileAccess } from "./case-file-tool-runtime.js";
import {
  revalidateThreadEvidence,
  threadEvidencePrompt,
  type ThreadEvidence
} from "./thread-evidence.js";
import type { LegalActDescriptor } from "./legal-act-resolver.js";
import { MAX_SUMMARY_CHARS } from "./thread-summary.js";
import fs from "node:fs";
import {
  ROUTER_SKILL,
  evaluateMandatoryPath,
  loadMandatoryPathModel,
  mandatoryPathInstructions,
  pathProfile,
  preloadForTurn,
  type MandatoryPathModel,
  type MandatoryPathReport,
  type PathProfile
} from "./mandatory-path.js";
import { queryModePrompt, type QueryModeDecision } from "./query-mode.js";
import { meterUsage, type ModelUsage } from "./providers/usage-meter.js";
import type { TemporalFreshnessResult } from "./temporal-source-freshness.js";
import {
  ReportBlueprintToolRuntime,
  type AcceptedReportBlueprint,
  type ReportBlueprintKind
} from "./report-blueprint-tool-runtime.js";
import {
  evaluateDeterministicWorkflowOutput,
  evaluateDeterministicWorkflowReads,
  type DeterministicWorkflowReadReport
} from "./deterministic-workflow.js";
import {
  documentCitationSystemPrompt,
  processDocumentCitationMarkers,
  type PublicDocumentCitation
} from "./document-citations.js";
import type {
  ProcessPleadingCheckpoint,
  ProcessPleadingCheckpointStatus,
  ProcessPleadingMode,
  ProcessPleadingStage
} from "./process-pleading-state.js";
import type {
  CourtAnalysisCheckpoint,
  CourtAnalysisStage
} from "./court-analysis-state.js";
import type {
  ChronologyCheckpoint,
  ChronologyStage
} from "./chronology-state.js";
import type {
  ContractCheckpoint,
  ContractStage,
  ContractWorkflowMode
} from "./contract-analysis-state.js";
import {
  orchestrateDocumentContext,
  type ContextBudgetReport
} from "./context-orchestrator.js";
import {
  evaluateGuideOutput,
  type GuideSessionState
} from "./guide-session-state.js";
import {
  evaluateGateIInvariants,
  type GateIInvariantReport
} from "./gate-i-invariants.js";
import {
  blockGateITurn,
  createGateITurnState,
  passGateITurnPhase,
  type GateITurnState
} from "./gate-i-turn-state.js";
import {
  evaluateModelTaskOwnershipGate,
  resolveReferencePreflightOwnership
} from "./model-task-ownership.js";
import { detectLegalReferences } from "./finalization-gate.js";
import {
  applyAutomaticVerificationMarkers,
  releaseModelUnverifiedMarkers,
  detectHistoricalAsOf,
  planAutomaticLegalVerification
} from "./gate-i-auto-verification.js";
import {
  runGateIRuntimePrelude
} from "./gate-i-runtime-prelude.js";
import {
  evaluateGateIInputCompleteness,
  evaluateGateIWorkflowContract,
  gateIWorkflowContract,
  type GateIWorkflowContractReport
} from "./gate-i-contracts.js";
import type {
  OrderedCaseWorkflowId
} from "./ordered-case-workflow-state.js";
import {
  LocalPolishPseudonymizer,
  PseudonymizationVault,
  type NamedEntityRecognizer
} from "./privacy/pseudonymizer.js";
import {
  ModelAutoRouter,
  type ModelAutoRoutingResult
} from "./model-auto-routing.js";
import {
  privacyRecognizerFor
} from "./privacy/local-llm-ner.js";
import {
  parseSkillSelectionEnvelope
} from "./skill-selection.js";

export type SessionDocumentAttachment = {
  documentId: string;
  caseId?: string;
  grammar?: PlaceholderGrammar[];
  totalPages?: number;
  // Uses the case's shared key: its tokens are the chat's tokens, not namespaced.
  sharedKey?: boolean;
  sourceScope?:
    | "MANUAL"
    | "CASE_KNOWLEDGE"
    | "FIRM_KNOWLEDGE"
    | "FIRM_TEMPLATE";
  // Shown to the model for firm templates (a filename, no case data).
  title?: string;
  // Picked by the user (not retrieved): sent whole or not at all.
  selectedByUser?: boolean;
  // Page images (photos; text pages on request), personal data masked.
  images?: EvidenceImage[];
  chunks: Array<{
    index: number;
    pageStart: number;
    pageEnd: number;
    text: string;
    representation?:
      | "FULL"
      | "EXTRACTIVE_DIGEST";
    originalChars?: number;
  }>;
};

export type SessionExecutionRequest = {
  query: string;
  // The case's shared key: names in the message get the documents' symbols.
  privacySeed?: PseudonymizationVaultSnapshot;
  documentAttachments?: SessionDocumentAttachment[];
  provider: ProviderId;
  model: string;
  accountSessionKey?: string;
  // "none": fresh account host session, no resumed or recorded thread (document generator).
  accountContinuity?: "none";
  modelRouting?: {
    primary: {
      provider: ProviderId;
      model: string;
    };
  };
  primarySkill: string;
  mode: "LAIK" | "PRAWNIK";
  // Set only by the AUTO router (decision.legal === false): answer without
  // loading legal skills, modules or legal tools.
  conversationalOnly?: boolean;
  // AUTO for account/API models: the model picks skills itself.
  modelSelectsSkills?: boolean;
  // Runtime-only (never parsed from HTTP): result of the entry gate.
  matterComplexity?: MatterComplexity;
  // Runtime-only (never parsed from HTTP): receives the live draft text of
  // the model answer with the chat pseudonyms already restored.
  onDraft?: (text: string) => void;
  // Runtime-only: the stage of the turn and what was done in it (skills, tools).
  onStep?: ExecutionStepReporter;
  // Runtime-only (never parsed from HTTP): the matter's full files for the
  // case file tools, bound to the caller's access.
  caseFiles?: CaseFileAccess;
  // Runtime-only (never parsed from HTTP): the matter's evidence memory from
  // the encrypted case workspace.
  threadEvidence?: ThreadEvidence;
  // Runtime-only: LAIK / PRAWNIK decided at the entry from the question (KROK 1).
  modeDecision?: QueryModeDecision;
  modelContextTokens?: number;
  tokenCharsPerToken?: number;
  // The current user message without chat history (grammar of placeholders).
  auxiliaryText?: string;
  guideContext?: Pick<
    GuideSessionState,
    | "revision"
    | "audience"
    | "interactionMode"
    | "rawAnalysis"
    | "step"
    | "guidedQuestionIndex"
    | "pendingIrreversibleAction"
  >;
  // Sesja generatora pisma (LegalDocumentAstGenerator): wynik to JSON AST.
  documentAstOutput?: boolean;
  processWorkflowContext?: {
    stage: ProcessPleadingStage;
    checkpoint: ProcessPleadingCheckpoint;
    mode: ProcessPleadingMode;
  };
  courtWorkflowContext?: {
    stage: Exclude<
      CourtAnalysisStage,
      "COMPLETE"
    >;
    checkpoint:
      CourtAnalysisCheckpoint;
  };
  chronologyWorkflowContext?: {
    stage: Exclude<
      ChronologyStage,
      "COMPLETE"
    >;
    checkpoint:
      ChronologyCheckpoint;
    temporalGateRequired: boolean;
  };
  contractWorkflowContext?: {
    mode: ContractWorkflowMode;
    stage: Exclude<
      ContractStage,
      "COMPLETE"
    >;
    checkpoint:
      ContractCheckpoint;
  };
  orderedCaseWorkflowContext?: {
    workflowId:
      OrderedCaseWorkflowId;
    checkpoint: string;
    revision: number;
  };
};

export type PublicBlockedReference = {
  claim: string;
  kind: "statute" | "journal" | "case";
  line: number;
  status: string;
};

export type PublicAuxiliarySourceItem = {
  claim?: string;
  sourceUrl: string;
  sourceTier:
    LegalSourceTier;
  classification:
    "KNOWN_DOMAIN" |
    "CONSERVATIVE_R3";
  classificationBasis:
    string;
  crossCheckStatus:
    LegalSourceCrossCheckStatus;
  crossCheckUrl?: string;
  crossCheckTier?:
    | "R1"
    | "R2A";
  publishedAt?: string;
  updatedAt?: string;
  staleOrUndatedWarning:
    boolean;
  higherTierCrossCheckSatisfied:
    boolean;
  conflict: boolean;
  instruction: string;
};

export type PublicEvidenceItem = {
  claim: string;
  kind: VerificationRecord["kind"];
  status: VerificationRecord["status"];
  sourceUrl?: string;
  sourceAnchorUrl?: string;
  sourceTier?: VerificationRecord["sourceTier"];
  fetchedAt: string;
  verificationMethod?: VerificationRecord["verificationMethod"];
  temporalMode?: VerificationRecord["temporalMode"];
  asOf?: string;
  sourceFormat?: VerificationRecord["sourceFormat"];
  caseScope?: VerificationRecord["caseScope"];
  caseSignature?: string;
  evidenceHash?: string;
  supportQuoteHash?: string;
  // Judgment passage checked in the official text (exact quote or the quote
  // supporting a proposition): marked in the full-text preview.
  passage?: string;
};

export function publicAuxiliarySourceFromToolResult(
  result:
    NormalizedToolResult
): PublicAuxiliarySourceItem | null {
  let payload:
    unknown;
  try {
    payload =
      JSON.parse(
        result.content
      );
  } catch {
    return null;
  }

  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    return null;
  }

  const value =
    payload as {
      status?: unknown;
      classification?: unknown;
      candidate?: {
        claim?: unknown;
        url?: unknown;
        tier?: unknown;
        provenance?: {
          classificationBasis?: unknown;
          publishedAt?: unknown;
          updatedAt?: unknown;
        };
        crossCheckStatus?: unknown;
        crossCheckUrl?: unknown;
        crossCheckTier?: unknown;
      };
      assessment?: {
        auxiliaryOnly?: unknown;
        staleOrUndatedWarning?: unknown;
        higherTierCrossCheckSatisfied?: unknown;
        conflict?: unknown;
        instruction?: unknown;
      };
    };

  const candidate =
    value.candidate;
  const assessment =
    value.assessment;
  const tier =
    candidate?.tier;

  if (
    value.status !== "OK" ||
    assessment
      ?.auxiliaryOnly !==
      true ||
    typeof candidate
      ?.url !== "string" ||
    (
      tier !== "R2B" &&
      tier !== "R3"
    ) ||
    (
      value.classification !==
        "KNOWN_DOMAIN" &&
      value.classification !==
        "CONSERVATIVE_R3"
    ) ||
    typeof candidate
      .provenance
      ?.classificationBasis !==
      "string" ||
    typeof candidate
      .crossCheckStatus !==
      "string" ||
    typeof assessment
      .staleOrUndatedWarning !==
      "boolean" ||
    typeof assessment
      .higherTierCrossCheckSatisfied !==
      "boolean" ||
    typeof assessment
      .conflict !==
      "boolean" ||
    typeof assessment
      .instruction !==
      "string"
  ) {
    return null;
  }

  const crossCheckStatus =
    candidate
      .crossCheckStatus;
  if (
    crossCheckStatus !==
      "NOT_REQUIRED" &&
    crossCheckStatus !==
      "PENDING" &&
    crossCheckStatus !==
      "CONFIRMED_R1_R2A" &&
    crossCheckStatus !==
      "CONFLICT" &&
    crossCheckStatus !==
      "UNAVAILABLE"
  ) {
    return null;
  }

  return {
    ...(typeof candidate
      .claim === "string" &&
    candidate.claim.trim()
      ? {
          claim:
            candidate.claim
              .trim()
        }
      : {}),
    sourceUrl:
      candidate.url,
    sourceTier:
      tier,
    classification:
      value
        .classification,
    classificationBasis:
      candidate
        .provenance
        .classificationBasis,
    crossCheckStatus,
    ...(typeof candidate
      .crossCheckUrl ===
      "string"
      ? {
          crossCheckUrl:
            candidate
              .crossCheckUrl
        }
      : {}),
    ...(candidate
      .crossCheckTier ===
        "R1" ||
    candidate
      .crossCheckTier ===
        "R2A"
      ? {
          crossCheckTier:
            candidate
              .crossCheckTier
        }
      : {}),
    ...(typeof candidate
      .provenance
      .publishedAt ===
      "string"
      ? {
          publishedAt:
            candidate
              .provenance
              .publishedAt
        }
      : {}),
    ...(typeof candidate
      .provenance
      .updatedAt ===
      "string"
      ? {
          updatedAt:
            candidate
              .provenance
              .updatedAt
        }
      : {}),
    staleOrUndatedWarning:
      assessment
        .staleOrUndatedWarning,
    higherTierCrossCheckSatisfied:
      assessment
        .higherTierCrossCheckSatisfied,
    conflict:
      assessment.conflict,
    instruction:
      assessment.instruction
  };
}

function normalizedAuxiliaryClaim(
  value: string
): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("pl")
    .replace(/\s+/gu, " ")
    .trim();
}

export function reconcileAuxiliarySourcesWithVerification(
  sources:
    PublicAuxiliarySourceItem[],
  records:
    VerificationRecord[]
): PublicAuxiliarySourceItem[] {
  return sources.map(
    (source) => {
      if (
        !source.claim ||
        source.conflict
      ) {
        return {
          ...source
        };
      }

      const claim =
        normalizedAuxiliaryClaim(
          source.claim
        );
      const verified =
        [...records]
          .reverse()
          .find(
            (record) =>
              normalizedAuxiliaryClaim(
                record.claim
              ) === claim &&
              (
                record.status ===
                  "VERIFIED" ||
                record.status ===
                  "SUPPORTED"
              ) &&
              (
                record.sourceTier ===
                  "R1" ||
                record.sourceTier ===
                  "R2A"
              ) &&
              Boolean(
                record.sourceUrl
                  ?.trim()
              )
          );

      if (
        !verified ||
        !verified.sourceUrl ||
        (
          verified.sourceTier !==
            "R1" &&
          verified.sourceTier !==
            "R2A"
        )
      ) {
        return {
          ...source,
          crossCheckStatus:
            source.crossCheckStatus ===
              "NOT_REQUIRED"
              ? "NOT_REQUIRED"
              : "PENDING",
          higherTierCrossCheckSatisfied:
            false
        };
      }

      return {
        ...source,
        crossCheckStatus:
          "CONFIRMED_R1_R2A",
        crossCheckUrl:
          verified.sourceUrl,
        crossCheckTier:
          verified.sourceTier,
        higherTierCrossCheckSatisfied:
          true
      };
    }
  );
}

// "art. 233 § 1 KK" next to "art. 233 KK" from the same place of the same
// source is one entry: the article is listed, its unit is not repeated.
function withoutRepeatedUnits(records: VerificationRecord[]): VerificationRecord[] {
  const key = (claim: string) => compactActAbbreviations(claim).toLocaleLowerCase("pl").replace(/\s+/g, " ").trim();
  const parts = (claim: string) => /^art\.?\s*(\d+[a-ząćęłńóśźż]*)(.*?)\s+(kc|kpc|kk|kpk|kpa|kp|kro|ksh|kw|kpw|pzp)$/u.exec(key(claim));
  const latest = new Map<string, VerificationRecord>();
  for (const record of records) {
    const id = `${record.kind}\u0000${key(record.claim)}\u0000${record.asOf ?? ""}`;
    latest.delete(id);
    latest.set(id, record);
  }
  const unique = [...latest.values()];
  return unique.filter((record) => {
    if (record.kind !== "statute" || record.status !== "VERIFIED") return true;
    const unit = parts(record.claim);
    if (!unit || !unit[2]!.trim()) return true;
    return !unique.some((other) => {
      const article = other.kind === "statute" && other.status === "VERIFIED" ? parts(other.claim) : null;
      return (
        article !== null &&
        !article[2]!.trim() &&
        article[1] === unit[1] &&
        article[3] === unit[3] &&
        (other.asOf ?? "") === (record.asOf ?? "") &&
        verificationSourceLink(other) === verificationSourceLink(record)
      );
    });
  });
}

export function publicEvidenceBundle(
  records: VerificationRecord[]
): PublicEvidenceItem[] {
  return withoutRepeatedUnits(records).map((record) => ({
    claim: record.claim,
    kind: record.kind,
    status: record.status,
    ...(record.sourceUrl ? { sourceUrl: record.sourceUrl } : {}),
    ...(verificationSourceLink(record) !== record.sourceUrl
      ? { sourceAnchorUrl: verificationSourceLink(record)! }
      : {}),
    ...(record.sourceTier ? { sourceTier: record.sourceTier } : {}),
    fetchedAt: record.fetchedAt,
    ...(record.verificationMethod
      ? { verificationMethod: record.verificationMethod }
      : {}),
    ...(record.temporalMode ? { temporalMode: record.temporalMode } : {}),
    ...(record.asOf ? { asOf: record.asOf } : {}),
    ...(record.sourceFormat ? { sourceFormat: record.sourceFormat } : {}),
    ...(record.caseScope ? { caseScope: record.caseScope } : {}),
    ...(record.caseSignature ? { caseSignature: record.caseSignature } : {}),
    ...(record.evidenceHash ? { evidenceHash: record.evidenceHash } : {}),
    ...(record.supportQuoteHash
      ? { supportQuoteHash: record.supportQuoteHash }
      : {}),
    ...(record.kind === "case" && record.caseScope === "EXACT_QUOTE"
      ? { passage: record.claim }
      : record.kind === "case" && record.supportQuote
        ? { passage: record.supportQuote }
        : {})
  }));
}

export type SessionExecutionInternalState = {
  verificationRecords: VerificationRecord[];
  auditEvents: AuditEvent[];
  documentAliasDocumentIds?: string[];
};

export const SESSION_EXECUTION_INTERNAL =
  Symbol("LEX_SESSION_EXECUTION_INTERNAL");

export type SessionExecutionResponse = {
  sessionId: string;
  status: "DRAFT_PRESENTABLE" | "BLOCKED";
  // Model tokens of the turn; unmeteredCalls = calls through account clients.
  usage?: ModelUsage;
  // Mandatory path of the turn (router, skills, verification, hard gate) from the audit.
  mandatoryPath?: MandatoryPathReport;
  modeDecision?: QueryModeDecision;
  provider: ProviderId;
  model: string;
  modelRouting?: {
    primary: {
      provider: ProviderId;
      model: string;
    };
  };
  primarySkill: string;
  loadedSkills?: string[];
  executionSkills?: string[];
  domainSkills?: string[];
  answer?: string;
  documentCitations?: PublicDocumentCitation[];
  restorations?: Restoration[];
  unresolvedTokens?: string[];
  documentCitationFreshness?: {
    result: "PASS";
    checked: number;
  };
  reportBlueprint?: AcceptedReportBlueprint;
  finalization: "PASS" | "DEGRADED" | "BLOCKED";
  blockedReferences: PublicBlockedReference[];
  verification: {
    records: number;
    verified: number;
    supported: number;
    unverified: number;
  };
  evidence: PublicEvidenceItem[];
  auxiliarySources?:
    PublicAuxiliarySourceItem[];
  // Widgety pokazane narzędziem show_widget (czat renderuje je w izolowanej ramce).
  widgets?: WidgetSpec[];
  audit: {
    result: "PASS" | "BLOCKED";
    eventCount: number;
    closed: boolean;
    missing?: string[];
    violations?: string[];
    // Zdarzenia BLOCKED: typ, cel i kod przyczyny, bez treści odpowiedzi i danych sprawy.
    blockedEvents?: string[];
  };
  workflow?: {
    id: string;
    result: "PASS" | "BLOCKED";
    requiredResources: string[];
    missingResources: string[];
  };
  gateI?: GateIInvariantReport;
  gateIWorkflowContract?: GateIWorkflowContractReport;
  gateITurn?: GateITurnState;
  context?: ContextBudgetReport;
  courtWorkflow?: {
    caseId: string;
    revision: number;
    stage:
      CourtAnalysisStage;
    nextCheckpoint:
      CourtAnalysisCheckpoint | null;
    closedCheckpoints:
      CourtAnalysisCheckpoint[];
  };
  chronologyWorkflow?: {
    caseId: string;
    revision: number;
    stage: ChronologyStage;
    temporalGateRequired: boolean;
    nextCheckpoint:
      ChronologyCheckpoint | null;
    closedCheckpoints:
      ChronologyCheckpoint[];
  };
  contractWorkflow?: {
    caseId: string;
    revision: number;
    mode: ContractWorkflowMode;
    stage: ContractStage;
    nextCheckpoint:
      ContractCheckpoint | null;
    closedCheckpoints:
      ContractCheckpoint[];
  };
  orderedCaseWorkflow?: {
    workflowId:
      OrderedCaseWorkflowId;
    caseId: string;
    revision: number;
    status:
      | "ACTIVE"
      | "COMPLETE";
    nextCheckpoint:
      string | null;
    closedCheckpoints:
      string[];
  };
  processAuto?: {
    maxSteps: number;
    stopped:
      | "FINAL"
      | "LIMIT_REACHED"
      | "NODE_BLOCKED";
    limitReached: boolean;
    steps: Array<{
      stage: Exclude<
        ProcessPleadingStage,
        "CG_ACCEPTANCE" | "FINAL"
      >;
      checkpoint:
        ProcessPleadingCheckpoint;
      revisionAfter: number;
      status:
        "DRAFT_PRESENTABLE" | "BLOCKED";
      answer?: string;
    }>;
  };
  processWorkflow?: {
    caseId: string;
    mode: ProcessPleadingMode;
    revision: number;
    stage: ProcessPleadingStage;
    documentStatus: "DRAFT" | "FINAL";
    pendingCheckpoint: ProcessPleadingCheckpoint | null;
    checkpoints: Record<
      ProcessPleadingCheckpoint,
      ProcessPleadingCheckpointStatus
    >;
  };
  [SESSION_EXECUTION_INTERNAL]?: SessionExecutionInternalState;
};

/**
 * Prefixes D01, D02... of own-key documents, in the order they reach the
 * model (context first, then case files read by tools). Shared-key documents
 * get none: their tokens are the chat's. Restoring an alias reads the
 * document id at position n-1 of documentIds().
 */
export class DocumentAliasRegistry {
  private readonly prefixes = new Map<string, string>();

  prefixFor(documentId: string): string {
    const existing = this.prefixes.get(documentId);
    if (existing) return existing;
    const prefix = "D" + String(this.prefixes.size + 1).padStart(2, "0");
    this.prefixes.set(documentId, prefix);
    return prefix;
  }

  documentIds(): string[] {
    return [...this.prefixes.keys()];
  }
}

export function namespaceChunkTokens(text: string, prefix: string): string {
  return text.replace(
    /\[PII:([A-Z_]+):(\d{4})\]/g,
    (_token, kind, sequence) => `[LMPII:${prefix}:${kind}:${sequence}]`
  );
}

export function namespaceDocumentAttachmentTokens(
  attachments: SessionDocumentAttachment[],
  registry = new DocumentAliasRegistry()
): SessionDocumentAttachment[] {
  const prefixFor = (documentId: string): string => registry.prefixFor(documentId);

  return attachments.map(
    (attachment) => {
      if (attachment.sharedKey) {
        return { ...attachment, chunks: attachment.chunks.map((chunk) => ({ ...chunk })) };
      }
      const prefix =
        prefixFor(
          attachment.documentId
        );
      return {
        ...attachment,
        ...(attachment.grammar
          ? {
              grammar: attachment.grammar.map((entry) => ({
                ...entry,
                token: entry.token.replace(
                  /^\[PII:/,
                  `[LMPII:${prefix}:`
                ),
                ...(entry.owner ? { owner: entry.owner.replace(/^\[PII:/, `[LMPII:${prefix}:`) } : {})
              }))
            }
          : {}),
        chunks:
          attachment.chunks.map(
            (chunk) => ({
              ...chunk,
              text: namespaceChunkTokens(chunk.text, prefix)
            })
          )
      };
    }
  );
}

/**
 * Stored page headers ("[STRONA 3 · CZĘŚĆ 1/2 · OCR]") as an explicit page
 * boundary with the page count, so a model knows how long the document is
 * and where each page starts.
 */
export function markPages(text: string, totalPages?: number): string {
  return text.replace(
    /^\[STRONA (\d+)(?: · CZĘŚĆ (\d+)\/(\d+))? · ([A-Z]+)\]$/gm,
    (_header, page: string, part?: string, parts?: string, source?: string) =>
      `=== STRONA ${page}${totalPages ? `/${totalPages}` : ""}` +
      (part && part !== "1" ? ` (ciąg dalszy, część ${part}/${parts})` : part ? ` (część ${part}/${parts})` : "") +
      (source === "OCR" ? " · tekst z OCR" : source === "BLANK" ? " · pusta" : "") +
      " ==="
  );
}

export type SelectedEvidenceImage = EvidenceImage & { documentId: string };

// At most this many images per message, and this much image data.
export const MAX_EVIDENCE_IMAGES = 20;
const MAX_EVIDENCE_BASE64 = 20 * 1024 * 1024;

/** Images of the pages whose chunks made it into the context, in order. */
export function selectEvidenceImages(
  requested: SessionDocumentAttachment[],
  inContext: SessionDocumentAttachment[]
): SelectedEvidenceImage[] {
  const selected: SelectedEvidenceImage[] = [];
  let size = 0;
  for (const attachment of inContext) {
    const source = requested.find((item) => item.documentId === attachment.documentId && item.images?.length);
    if (!source?.images) continue;
    for (const image of source.images) {
      const covered = attachment.chunks.some((chunk) => chunk.pageStart <= image.page && image.page <= chunk.pageEnd);
      if (!covered || selected.length >= MAX_EVIDENCE_IMAGES || size + image.data.length > MAX_EVIDENCE_BASE64) continue;
      size += image.data.length;
      selected.push({ ...image, documentId: attachment.documentId });
    }
  }
  return selected;
}

export const EVIDENCE_IMAGE_NOTE = [
  "# OBRAZY JAKO DOWÓD",
  "Do kontekstu dołączono obrazy (zdjęcia, strony) w kolejności podanej przy znacznikach [OBRAZ n].",
  "Czarne prostokąty zasłaniają dane osobowe i nieczytelne napisy: nie zgaduj, co pod nimi jest.",
  "Opisuj to, co widać (stan rzeczy, uszkodzenia, miejsce, układ, podpisy i pieczęcie jako fakt ich obecności); oddziel obserwację od wniosku i nie przypisuj osób na podstawie wyglądu.",
  "Nazwy i dane z dokumentu bierz z tekstu z symbolami [PII:...], nie z obrazu."
].join("\n");

function buildDocumentContext(
  attachments: SessionDocumentAttachment[],
  images: SelectedEvidenceImage[] = []
): string {
  const sections = attachments.map((attachment) => {
    const chunks = attachment.chunks.map((chunk) => {
      const sourceLabel =
        attachment.sourceScope === "FIRM_TEMPLATE"
          ? "WZÓR KANCELARII"
          : attachment.sourceScope === "FIRM_KNOWLEDGE"
            ? "KNOW-HOW KANCELARII"
            : attachment.sourceScope === "CASE_KNOWLEDGE"
              ? "CASE KNOWLEDGE"
              : "DOCUMENT";
      const representation =
        chunk.representation ===
          "EXTRACTIVE_DIGEST"
          ? " · EXTRACTIVE DIGEST · BACKLINK=ORIGINAL_CHUNK"
          : "";
      return [
        `[${sourceLabel} ${attachment.documentId} · CHUNK ${chunk.index} · PAGES ${chunk.pageStart}-${chunk.pageEnd}${representation}]`,
        markPages(chunk.text, attachment.totalPages)
      ].join("\n");
    });
    return [
      ...(attachment.title
        ? [`[${attachment.documentId} · PLIK: ${attachment.title}]`]
        : []),
      ...(attachment.totalPages
        ? [
            `[${attachment.documentId} · STRON: ${attachment.totalPages} · każda strona zaczyna się znacznikiem "=== STRONA n/${attachment.totalPages} ==="]`
          ]
        : []),
      ...chunks
    ].join("\n\n");
  });

  const firm = attachments.some(
    (attachment) => attachment.sourceScope === "FIRM_TEMPLATE" || attachment.sourceScope === "FIRM_KNOWLEDGE"
  );
  const imageIndex = images.length
    ? [
        EVIDENCE_IMAGE_NOTE,
        ...images.map(
          (image, index) =>
            `[OBRAZ ${index + 1}: ${image.documentId} · STRONA ${image.page} · zamaskowane obszary: ${image.masked}]`
        )
      ].join("\n")
    : null;
  return [...(firm ? [FIRM_MATERIAL_NOTE] : []), ...sections, ...(imageIndex ? [imageIndex] : [])].join("\n\n---\n\n");
}

export const buildDocumentContextForTest = buildDocumentContext;

export const FIRM_MATERIAL_NOTE = [
  "# MATERIAŁY KANCELARII",
  "Bloki oznaczone WZÓR KANCELARII i KNOW-HOW KANCELARII pochodzą z biblioteki kancelarii, nie z akt sprawy.",
  "- Wzór: przejmij jego układ, kolejność części, styl i stałe formuły; treść merytoryczną bierz z dokumentów sprawy i wiadomości użytkownika.",
  "- Nie przenoś do pisma danych przykładowych z wzoru (stron, sygnatur, kwot, dat, adresów); w miejsca bez danych wstaw neutralne pole w nawiasie kwadratowym, np. [Kwota], [Termin].",
  "- Materiały kancelarii nie są dowodami ani faktami w sprawie; nie cytuj ich jako źródła faktów."
].join("\n");

function transferExecutionEvents(
  events: ExecutionEvent[],
  audit: AuditTrail
): void {
  for (const event of events) {
    if (
      event.type === "skill_read" ||
      event.type === "resource_read" ||
      event.type === "route" ||
      event.type === "provider_start" ||
      event.type === "provider_end" ||
      event.type === "gate"
    ) {
      audit.record(
        event.type,
        event.target,
        event.status === "BLOCKED" ? "BLOCKED" : "OK",
        event.detail ? { detail: event.detail } : undefined
      );
    }
  }
}

const DRAFT_PII_TOKEN =
  /\[PII:([A-Z_]+):(\d{4})(?:\|([A-Z]{2,4}))?\]/g;
// An incomplete token at the end of the stream is held back until complete.
const DRAFT_PARTIAL_TOKEN_TAIL =
  /\[(?:P(?:I(?:I(?::[A-Z_]*(?::\d{0,4}(?:\|[A-Z]{0,4})?)?)?)?)?)?$/;

export function createDraftCallbacks(
  vault: PseudonymizationVault,
  onDraft: (text: string) => void
): StreamCallbacks {
  let raw = "";
  const publish = () => {
    const visible =
      raw.replace(
        DRAFT_PARTIAL_TOKEN_TAIL,
        ""
      );
    onDraft(
      visible.replace(
        DRAFT_PII_TOKEN,
        (token, kind: string, sequence: string, requestedCase?: string) => {
          const base = `[PII:${kind}:${sequence}]`;
          return vault.hasToken(base)
            ? vault.restore(base, requestedCase ?? null).text
            : token;
        }
      )
    );
  };
  return {
    onContentDelta: (text: string) => {
      raw += text;
      publish();
    },
    // A tool round starts a new model turn; the previous partial text was
    // only a preamble to the tool call.
    onToolCallStart: () => {
      raw = "";
      publish();
    }
  };
}

export type ThreadSummaryRequest = {
  provider: ProviderId;
  model: string;
  privacySeed?: PseudonymizationVaultSnapshot;
  // Summary so far (also one corrected by the user); updated, not replaced.
  previousSummary?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  threadEvidence?: ThreadEvidence;
};

export const THREAD_SUMMARY_PROMPT = [
  "Jesteś asystentem Lex Machina. Tworzysz streszczenie wcześniejszej części rozmowy w sprawie, które zastąpi te wiadomości w kontekście kolejnych odpowiedzi.",
  "Układ (nagłówki dokładnie takie): ## Fakty, ## Stanowiska stron, ## Ustalenia prawne, ## Dokumenty i dowody, ## Otwarte kwestie.",
  "- Tylko to, co jest w rozmowie; nic nie dopisuj, nie oceniaj na nowo i nie rozstrzygaj.",
  "- Ustalenia prawne: przepis z oznaczeniem aktu tak, jak w rozmowie. Nie przepisuj znaczników weryfikacji i nie podawaj brzmienia przepisów; status nada aplikacja z rejestru weryfikacji.",
  "- Symbole [PII:...] przepisuj dokładnie; nie zgaduj, kto się pod nimi kryje.",
  "- Jeśli jest dotychczasowe streszczenie, zaktualizuj je o nowe wiadomości i zachowaj jego poprawki (mogła je wprowadzić osoba prowadząca sprawę).",
  "- Najwyżej ok. 6000 znaków; zwięźle, w punktach."
].join("\n");

export interface SessionExecutor {
  resolveAutoRouting?(
    request: SessionExecutionRequest
  ): Promise<ModelAutoRoutingResult>;
  execute(request: SessionExecutionRequest): Promise<SessionExecutionResponse>;
  // Structured summary of older thread messages (pseudonymized for the model).
  summarizeThread?(request: ThreadSummaryRequest): Promise<string>;
}

export class SafeSessionExecutor implements SessionExecutor {
  private readonly engine: LexExecutionEngine;
  private readonly autoRouter:
    ModelAutoRouter;

  constructor(
    private readonly registry: LexSkillRegistry,
    private readonly providers: ProviderGateway,
    private readonly finalizer = new AuditedFinalizer(),
    private readonly verificationToolFactory?: LegalVerificationToolFactory,
    private readonly chatNamedEntityRecognizer?: NamedEntityRecognizer,
    private readonly legalFederationTools?: LegalFederationToolRuntime,
    private readonly coreLawIndex?: CoreLawIndex,
    private readonly personMorphology?: PersonMorphology,
    // Current consolidated text of an act in Sejm ELI (evidence memory reuse).
    private readonly actFreshness?: (act: LegalActDescriptor) => Promise<TemporalFreshnessResult>
  ) {
    this.engine = new LexExecutionEngine(
      registry,
      providers
    );
    this.autoRouter =
      new ModelAutoRouter(
        registry,
        providers
      );
  }

  private mandatoryModelCache: { root: string; model: MandatoryPathModel } | null = null;

  // Corpus files of the mandatory path, by canonical path (router-relative or skill-qualified).
  private readCorpus(resource: string): string | null {
    const relative = resource.startsWith(`${ROUTER_SKILL}/`) ? resource.slice(ROUTER_SKILL.length + 1) : resource;
    const resolved = this.registry.resolveResource(ROUTER_SKILL, relative);
    if (!resolved) return null;
    try {
      return fs.readFileSync(resolved, "utf8");
    } catch {
      return null;
    }
  }

  private mandatoryModel(): MandatoryPathModel | null {
    if (this.mandatoryModelCache?.root === this.registry.root) return this.mandatoryModelCache.model;
    try {
      const model = loadMandatoryPathModel((resource) => this.readCorpus(resource));
      this.mandatoryModelCache = { root: this.registry.root, model };
      return model;
    } catch {
      return null;
    }
  }

  /**
   * Summary of older thread messages: the text goes to the model
   * pseudonymized like a chat message, without tools; provisions in the
   * summary get their status from the verification registry only (reused
   * evidence after the ELI check, otherwise NIEWERYFIKOWANE).
   */
  async summarizeThread(request: ThreadSummaryRequest): Promise<string> {
    const vault = new PseudonymizationVault(request.privacySeed);
    const pseudonymizer = new LocalPolishPseudonymizer(vault, this.chatRecognizerFor(request.model), this.personMorphology);
    const transcript = [
      ...(request.previousSummary ? [`[DOTYCHCZASOWE STRESZCZENIE]\n${request.previousSummary}\n[KONIEC STRESZCZENIA]`] : []),
      "[WIADOMOŚCI DO STRESZCZENIA]",
      ...request.messages.map((message) => `${message.role === "user" ? "Użytkownik" : "Asystent"}: ${message.content}`)
    ].join("\n\n");
    const protectedText = (await pseudonymizer.pseudonymize(transcript)).text;
    const ledger = new VerificationLedger();
    if (request.threadEvidence?.provisions.length && this.actFreshness) {
      for (const record of (await revalidateThreadEvidence(request.threadEvidence, this.actFreshness)).reused) ledger.add(record);
    }
    const key = placeholderKeyPrompt(placeholderGrammar(protectedText, vault));
    const response = await this.providers.stream(request.provider, {
      model: request.model,
      systemPrompt: [...(key ? [key] : []), THREAD_SUMMARY_PROMPT].join("\n\n"),
      messages: [{ role: "user", content: protectedText }],
      accountContinuity: "none",
      reasoning: "none"
    });
    let text = stripUnbackedVerificationMarkers(response.fullText.trim(), ledger).text;
    const gate = new FinalizationGate().evaluate(text, ledger);
    text = reconcileStatusMarkers(addMissingVerificationMarkers(markUnverifiedReferences(text, gate), gate), ledger).text;
    return restoreWithReport(text, vault).text.slice(0, MAX_SUMMARY_CHARS);
  }

  // A local primary model keeps the text on this machine, so the chat does
  // not also wait for local-model PII detection before answering.
  private chatRecognizerFor(
    model: string
  ): NamedEntityRecognizer | undefined {
    return this.chatNamedEntityRecognizer
      ? privacyRecognizerFor(
          this.chatNamedEntityRecognizer,
          !model.startsWith("local/")
        )
      : undefined;
  }

  async resolveAutoRouting(
    request: SessionExecutionRequest
  ): Promise<ModelAutoRoutingResult> {
    const vault =
      new PseudonymizationVault(request.privacySeed);
    const pseudonymizer =
      new LocalPolishPseudonymizer(
        vault,
        this.chatRecognizerFor(
          request.model
        ),
        this.personMorphology
      );
    let protectedQuery: string;
    try {
      protectedQuery =
        (
          await pseudonymizer
            .pseudonymize(
              request.query
            )
        ).text;
    } catch {
      throw new Error(
        "CHAT_PRIVACY_GATE_FAILED"
      );
    }

    const routed =
      await this.autoRouter
        .resolve({
          query:
            protectedQuery,
          provider:
            request.provider,
          model:
            request.model,
          ...(request.matterComplexity
            ? { matterComplexity: request.matterComplexity }
            : {})
        });

    // Keep the user's original text for the actual execution. Only the
    // model-selected routing envelope is copied from the protected prepass.
    const originalEnvelope =
      parseSkillSelectionEnvelope(
        request.query
      );
    const firstBreak =
      routed.query.indexOf(
        "\n"
      );
    const routingHeader =
      firstBreak >= 0
        ? routed.query.slice(
            0,
            firstBreak
          )
        : routed.query;

    return {
      decision:
        routed.decision,
      query:
        routingHeader +
        "\n" +
        originalEnvelope.query
    };
  }

  async execute(
    request: SessionExecutionRequest
  ): Promise<SessionExecutionResponse> {
    // Tokens of every model call in this turn (benchmark and cost display).
    const { result, usage } = await meterUsage(() => this.executeTurn(request));
    result.usage = usage;
    return result;
  }

  private async executeTurn(
    request: SessionExecutionRequest
  ): Promise<SessionExecutionResponse> {
    const step: ExecutionStepReporter = request.onStep ?? (() => undefined);
    step("PREPARE", "anonimizacja wiadomości");
    if (request.documentAttachments?.length) {
      step("PREPARE", `pliki w kontekście: ${request.documentAttachments.length}`);
    }
    const audit = new AuditTrail();
    audit.start({
      provider: request.provider,
      model: request.model,
      mode: request.mode
    });

    const chatPrivacyVault =
      new PseudonymizationVault(request.privacySeed);
    const chatPseudonymizer =
      new LocalPolishPseudonymizer(
        chatPrivacyVault,
        this.chatRecognizerFor(
          request.model
        ),
        this.personMorphology
      );
    let protectedQuery:
      string;
    let protectedAuxiliaryText:
      string | undefined;
    try {
      // Example data the assistant wrote earlier (a model letter) stays as written.
      const exampleData =
        /(?:^|\n\n)Asystent: /.test(request.query)
          ? exampleDataKeepDirectives(
              request.query,
              (
                await new LocalPolishPseudonymizer(
                  new PseudonymizationVault(request.privacySeed),
                  this.chatRecognizerFor(request.model),
                  this.personMorphology
                ).pseudonymize(request.query)
              ).findings,
              request.auxiliaryText ?? ""
            )
          : [];
      const protectedPrimary =
        await chatPseudonymizer
          .pseudonymize(
            request.query,
            exampleData
          );
      protectedQuery =
        protectedPrimary.text;

      if (
        request.auxiliaryText !==
          undefined &&
        request.auxiliaryText !==
          request.query
      ) {
        protectedAuxiliaryText =
          (
            await chatPseudonymizer
              .pseudonymize(
                request.auxiliaryText
              )
          ).text;
      } else if (
        request.auxiliaryText !==
          undefined
      ) {
        protectedAuxiliaryText =
          protectedQuery;
      }

      audit.record(
        "gate",
        "G39I_CHAT_PRIVACY",
        "OK",
        {
          pseudonymized:
            protectedPrimary
              .findings.length,
          exampleDataKept:
            exampleData.length,
          kinds:
            Object.keys(
              protectedPrimary
                .counts
            ).sort(),
          vaultTokens:
            chatPrivacyVault
              .size
        }
      );
    } catch (error) {
      audit.record(
        "gate",
        "G39I_CHAT_PRIVACY",
        "BLOCKED",
        {
          error:
            error instanceof Error
              ? error.message
              : String(error)
        }
      );
      audit.close(
        "BLOCKED",
        {
          finalization:
            "PRIVACY_GATE"
        }
      );
      throw new Error(
        "CHAT_PRIVACY_GATE_FAILED"
      );
    }

    const requestedHistoricalAsOf =
      detectHistoricalAsOf(
        protectedQuery
      );

    const ledger = new VerificationLedger();
    // Evidence memory: provisions verified in earlier messages are reused only
    // when ELI still has the same consolidated text and no amendment after it.
    let evidencePrompt: string | null = null;
    const memory = request.threadEvidence;
    if (
      memory &&
      !request.model.startsWith("local/") &&
      (memory.provisions.length || memory.sources.length || memory.skills.length || memory.lastPath)
    ) {
      const reuse = this.actFreshness
        ? await revalidateThreadEvidence(memory, this.actFreshness)
        : { reused: [], recheck: memory.provisions.map((record) => ({ claim: record.claim, reason: "ELI_CHECK_UNAVAILABLE" })) };
      for (const record of reuse.reused) ledger.add(record);
      evidencePrompt = threadEvidencePrompt(memory, reuse);
      step("VERIFY", `pamięć sprawy: ${reuse.reused.length} przepisów aktualnych w ELI, ${reuse.recheck.length} do ponownej weryfikacji`);
      audit.record("gate", "THREAD_EVIDENCE_REUSE", "OK", {
        reused: reuse.reused.map((record) => record.claim),
        recheck: reuse.recheck
      });
    }
    // Modele lokalne (Bielik, Mistral) weryfikują najpierw na lokalnej kopii ELI (RAG).
    const verificationTools = this.verificationToolFactory?.(ledger, {
      localModel: request.model.startsWith("local/")
    });
    const corpusTools = new LegalCorpusToolRuntime(
      this.registry,
      {
        modelSelectsSkills:
          request.modelSelectsSkills === true
      }
    );
    const reportTools = new ReportBlueprintToolRuntime();
    // Modele lokalne: bez widgetów (minimalny zestaw narzędzi i promptu).
    const widgetTools = request.model.startsWith("local/")
      ? undefined
      : new WidgetToolRuntime(this.registry);
    // Modele lokalne (Bielik, Mistral): bez federacji MCP. Jej instrukcje i schematy to
    // ~12 tys. znaków promptu przy oknie 32k, a lokalny model dostaje przepisy z RAG
    // rdzeniowego i verify_legal_reference na lokalnej kopii ELI.
    const federationTools =
      request.model.startsWith("local/")
        ? undefined
        : this.legalFederationTools;
    // Instancja federacji jest wspólna dla wszystkich sesji; ta sesja audytuje tylko własne wywołania.
    const federationEvents:
      LegalFederationAuditEvent[] =
      [];
    const auxiliarySources:
      PublicAuxiliarySourceItem[] =
      [];

    // References in the message are checked by the Gate I runtime prelude
    // (ELI); no model is asked to extract them.
    const modelTaskOwnership =
      evaluateModelTaskOwnershipGate(
        resolveReferencePreflightOwnership(
          detectLegalReferences(
            protectedAuxiliaryText ??
              protectedQuery
          ).length > 0
        )
      );
    audit.record(
      "gate",
      modelTaskOwnership.gate,
      modelTaskOwnership.result ===
        "PASS"
        ? "OK"
        : "BLOCKED",
      {
        registry:
          modelTaskOwnership.registry,
        resolution:
          modelTaskOwnership.resolution,
        errors:
          modelTaskOwnership.errors
      }
    );
    if (
      modelTaskOwnership.result !==
        "PASS"
    ) {
      audit.close(
        "BLOCKED",
        {
          finalization:
            "MODEL_TASK_OWNERSHIP"
        }
      );
      throw new Error(
        "MODEL_TASK_OWNERSHIP_GATE_FAILED"
      );
    }

    // Only the newest user turn asserts attachments: earlier turns and assistant
    // replies in the history ("w pliku", "te dokumenty") are not this request's input.
    const gateIInput =
      evaluateGateIInputCompleteness(
        latestUserTurn(request.query),
        request.documentAttachments
          ?.length ?? 0
      );

    audit.record(
      "gate",
      "G39I_INPUT_COMPLETENESS",
      gateIInput.result ===
        "PASS"
        ? "OK"
        : "BLOCKED",
      {
        attachmentAssertion:
          gateIInput.attachmentAssertion,
        attachmentCount:
          gateIInput.attachmentCount,
        reason:
          gateIInput.reason
      }
    );

    const contextSelection =
      orchestrateDocumentContext({
        attachments:
          request.documentAttachments ?? [],
        query: request.query,
        ...(request.modelContextTokens
          ? {
              modelContextTokens:
                request.modelContextTokens
            }
          : {}),
        ...(request.tokenCharsPerToken
          ? {
              tokenCharsPerToken:
                request.tokenCharsPerToken
            }
          : {})
      });
    const aliasRegistry =
      new DocumentAliasRegistry();
    const attachments =
      namespaceDocumentAttachmentTokens(
        contextSelection.attachments,
        aliasRegistry
      );
    // Chunks read by the case file tools are added after the model turn.
    const citationSources =
      [...contextSelection.citationSources];
    // Page images of the attachments in context (masked evidence), for
    // models that see images; others work from the text.
    const evidence = selectEvidenceImages(request.documentAttachments ?? [], attachments);
    const imagesDelivered =
      evidence.length > 0 && this.providers.supportsImages(request.provider, request.model);
    if (evidence.length) {
      step(
        "PREPARE",
        imagesDelivered
          ? `obrazy jako dowód: ${evidence.length} (dane osobowe zamaskowane)`
          : `obrazy pominięte: model przyjmuje tylko tekst (${evidence.length})`
      );
      audit.record("resource_read", "evidence-images", "OK", {
        delivered: imagesDelivered,
        images: evidence.map((image) => `${image.documentId}:${image.page}`),
        masked: evidence.reduce((sum, image) => sum + image.masked, 0)
      });
    }
    const documentContext =
      attachments.length > 0
        ? buildDocumentContext(
            attachments,
            imagesDelivered ? evidence : []
          )
        : undefined;

    audit.record(
      "gate",
      "G39C_CONTEXT_BUDGET",
      "OK",
      {
        ...contextSelection.report
      }
    );

    for (const attachment of attachments) {
      audit.record(
        "resource_read",
        `local-document:${attachment.documentId}`,
        "OK",
        {
          chunks: attachment.chunks.map((chunk) => chunk.index),
          representations:
            attachment.chunks.map(
              (chunk) =>
                chunk.representation ??
                "FULL"
            ),
          protectedOnly: true,
          ...(attachment.caseId ? { caseId: attachment.caseId } : {}),
          ...(attachment.sourceScope ? { sourceScope: attachment.sourceScope } : {})
        }
      );
    }

    const coreLawTools =
      this.coreLawIndex
        ? new CoreLawToolRuntime(
            this.coreLawIndex
          )
        : undefined;
    // The context holds what fits the window; the tools reach the rest of the
    // matter's files. Not for local models (window and tool reliability).
    const caseFileTools =
      request.caseFiles && !request.model.startsWith("local/")
        ? new CaseFileToolRuntime(request.caseFiles, {
            inContext: new Map(
              attachments
                .filter((attachment) => attachment.caseId === request.caseFiles!.caseId)
                .map((attachment) => [attachment.documentId, new Set(attachment.chunks.map((chunk) => chunk.index))])
            ),
            prefixFor: (documentId) => aliasRegistry.prefixFor(documentId),
            namespace: namespaceChunkTokens,
            markPages,
            ...(request.modelContextTokens
              ? {
                  maxTurnChars: Math.min(
                    120_000,
                    Math.floor(request.modelContextTokens * (request.tokenCharsPerToken ?? 3) * 0.3)
                  )
                }
              : {})
          })
        : undefined;
    // Local 11-12B models call tools unreliably: they get the most relevant
    // core law articles in the prompt (retrieval, not training).
    const coreLawRag =
      this.coreLawIndex && request.model.startsWith("local/")
        ? coreLawRetrievalPrompt(this.coreLawIndex, protectedQuery)
        : null;
    // Claude account in AUTO: skills are read natively from the corpus
    // directory, so the corpus tools are not offered; the rest go over MCP.
    const nativeCorpus =
      request.modelSelectsSkills === true &&
      this.providers.nativeCorpusAccess(request.provider, request.model);
    const toolSchemas = [
      ...(nativeCorpus ? [] : corpusTools.schemas()),
      ...(coreLawTools
        ? coreLawTools.schemas()
        : []),
      ...(caseFileTools ? caseFileTools.schemas() : []),
      ...reportTools.schemas(),
      ...(widgetTools ? widgetTools.schemas() : []),
      ...(federationTools
        ? federationTools.schemas()
        : []),
      ...(verificationTools ? verificationTools.schemas() : [])
    ];
    // Mandatory path (hosted models): the profile, the corpus files the router's
    // mandatory gates require, loaded up front, and the mode decided at the entry.
    const mandatoryModel = request.model.startsWith("local/") ? null : this.mandatoryModel();
    const legalTurn = !request.conversationalOnly && !isTrivialChatCommand(latestUserTurn(request.query));
    const pathFacts = {
      query: request.auxiliaryText ?? latestUserTurn(request.query),
      legal: legalTurn,
      criminal: request.primarySkill.startsWith("dr-03-"),
      documents: attachments.length > 0,
      documentsTruncated: contextSelection.report.documents?.some((item) => item.status !== "FULL") ?? false,
      documentGeneration: Boolean(request.documentAstOutput || request.processWorkflowContext),
      foreignJurisdiction: false
    };
    const profile: PathProfile = pathProfile({
      mode: request.modeDecision?.mode ?? request.mode,
      simple: request.matterComplexity?.level === "SIMPLE",
      criminal: pathFacts.criminal,
      documentGeneration: pathFacts.documentGeneration
    });
    // Already in the model's context: the router skill and the core legal resources.
    const contextResources = new Set<string>([
      `${ROUTER_SKILL}/SKILL.md`,
      "shared/PRAWO-HARDGATE.md",
      `${ROUTER_SKILL}/references/KROK0A-anonimizer.md`,
      `${ROUTER_SKILL}/references/KROK1-detekcja.md`,
      ...(pathFacts.criminal ? ["dr-03-prawo-karne-wykroczenia-egzekucja/modules/mod-KK-kwalifikator-karnomaterialny.md"] : [])
    ]);
    const pathSections: string[] = [];
    if (mandatoryModel && legalTurn) {
      const preloaded = preloadForTurn(mandatoryModel, { ...pathFacts, profile }).filter((resource) => !contextResources.has(resource));
      for (const resource of preloaded) {
        const content = this.readCorpus(resource);
        if (!content) {
          audit.record("resource_read", resource, "BLOCKED", { detail: "runtime-preload;mandatory-path;missing" });
          continue;
        }
        contextResources.add(resource);
        audit.record("resource_read", resource, "OK", { detail: "runtime-preload;mandatory-path", profile });
        pathSections.push(`# MANDATORY PATH RESOURCE: ${resource}\n\n${content}`);
      }
      step("SKILLS", `ścieżka obowiązkowa: profil ${profile === "PELNY" ? "PEŁNY" : "LEKKI"}, wczytano ${preloaded.length} plików`);
      pathSections.unshift(mandatoryPathInstructions(mandatoryModel, profile, [...contextResources]));
    }
    const identityPrompt = [
      "# MODEL TEJ SESJI (podaje aplikacja)",
      `Dostawca: ${request.provider}; identyfikator modelu w aplikacji: ${request.model}.` +
        (request.model.startsWith("account/") ? " Przy koncie konkretną wersję wybiera klient dostawcy; aplikacja jej nie zna." : ""),
      "Pytany, jakim jesteś modelem, podaj te dane; nie zgaduj nazwy ani wersji z pamięci."
    ].join("\n");

    const toolPrompt = [
      identityPrompt,
      ...(request.modeDecision ? [queryModePrompt(request.modeDecision)] : []),
      ...pathSections,
      ...(evidencePrompt ? [evidencePrompt] : []),
      ...(nativeCorpus ? [] : [corpusTools.systemPromptAppendix()]),
      ...(coreLawTools
        ? [coreLawTools.systemPromptAppendix()]
        : []),
      ...(caseFileTools ? [caseFileTools.systemPromptAppendix()] : []),
      reportTools.systemPromptAppendix(),
      ...(widgetTools ? [widgetTools.systemPromptAppendix()] : []),
      ...(federationTools
        ? [federationTools.systemPromptAppendix()]
        : []),
      ...(verificationTools
        ? [verificationTools.systemPromptAppendix()]
        : []),
      ...(attachments.length > 0
        ? [documentCitationSystemPrompt(attachments)]
        : []),
      ...(coreLawRag ? [coreLawRag] : [])
    ].join("\n\n");

    // Kind and gender of every placeholder the model will see: it inflects
    // around them without ever seeing a name.
    const roles = genericWords().partyRoles;
    const placeholderKey = placeholderKeyPrompt([
      ...placeholderGrammar(
        [
          protectedQuery,
          protectedAuxiliaryText ?? "",
          // Shared-key documents use the chat's own (seeded) tokens.
          ...attachments
            .filter((attachment) => attachment.sharedKey)
            .flatMap((attachment) => attachment.chunks.map((chunk) => chunk.text))
        ].join("\n"),
        chatPrivacyVault
      ),
      ...attachments
        .filter((attachment) => !attachment.sharedKey)
        .flatMap((attachment) => attachment.grammar ?? [])
    ], partyGroups(
      // Parties of several persons named after a role word ("powodowie [..] i [..]").
      [protectedQuery, protectedAuxiliaryText ?? "", ...attachments.flatMap((attachment) => attachment.chunks.map((chunk) => chunk.text))],
      (word) => roles.has(word)
    ));

    const draftCallbacks =
      request.onDraft
        ? createDraftCallbacks(
            chatPrivacyVault,
            request.onDraft
          )
        : undefined;
    const execution = await this.engine.executePolishLegalQuery({
      ...(this.coreLawIndex
        ? {
            coreLaw: this.coreLawIndex.summaries().map((act) => ({
              eli: act.eli,
              title: act.title,
              labels: act.labels,
              domains: act.domains,
              articleCount: act.articleCount,
              origin: act.origin,
              eliCaution: coreLawEliCaution(act)
            }))
          }
        : {}),
      onEvent: (event) => {
        if (event.status !== "OK") return;
        if (event.type === "route") step("ROUTING", event.target);
        else if (event.target === "MODEL_SKILL_SELECTION") step("ROUTING", "model dobiera skille według routera v3");
        else if (event.target === "LOCAL_QUICK_LEGAL") step("SKILLS", "szybka odpowiedź: węzły kwalifikatora i przepisy z ELI");
        else if (event.type === "skill_read") step("SKILLS", `skill ${event.target}`);
        else if (event.type === "resource_read") step("SKILLS", event.target);
        else if (event.type === "provider_start") step("MODEL", `model ${event.detail ?? event.target}`);
      },
      query: protectedQuery,
      ...(draftCallbacks
        ? {
            draftCallbacks
          }
        : {}),
      ...(documentContext ? { documentContext } : {}),
      ...(imagesDelivered
        ? { documentImages: evidence.map((image) => ({ mediaType: image.mediaType, data: image.data })) }
        : {}),
      ...(placeholderKey ? { placeholderKey } : {}),
      ...(request.conversationalOnly
        ? {
            conversationalOnly: true
          }
        : {}),
      ...(request.modelSelectsSkills
        ? {
            modelSelectsSkills: true
          }
        : {}),
      ...(request.modelSelectsSkills && !nativeCorpus
        ? {
            onCorpusPreloaded: (relativePath: string) => {
              corpusTools.recordPreloaded(relativePath);
              step("SKILLS", relativePath);
            }
          }
        : {}),
      ...(nativeCorpus
        ? {
            nativeCorpus: {
              root: this.registry.root,
              onRead: (relativePath: string) => {
                corpusTools.recordNativeRead(relativePath);
                step("SKILLS", relativePath);
              },
              onMissing: (relativePath: string) => corpusTools.recordNativeMissing(relativePath),
              missingQualifier: () => corpusTools.missingCriminalQualifier()
            }
          }
        : {}),
      provider: request.provider,
      model: request.model,
      ...(request.accountSessionKey
        ? {
            continuityKey:
              request.accountSessionKey
          }
        : {}),
      ...(request.accountContinuity
        ? { accountContinuity: request.accountContinuity }
        : {}),
      route: {
        jurisdiction: "PL",
        primarySkill: request.primarySkill,
        mode: request.mode
      },
      ...(request.guideContext
        ? {
            guideContext:
              request.guideContext
          }
        : {}),
      ...(request.documentAstOutput
        ? { documentAstOutput: true }
        : {}),
      ...(request.processWorkflowContext
        ? {
            processWorkflowContext:
              request.processWorkflowContext
          }
        : {}),
      ...(request.courtWorkflowContext
        ? {
            courtWorkflowContext:
              request.courtWorkflowContext
          }
        : {}),
      ...(request.chronologyWorkflowContext
        ? {
            chronologyWorkflowContext:
              request.chronologyWorkflowContext
          }
        : {}),
      ...(request.contractWorkflowContext
        ? {
            contractWorkflowContext:
              request.contractWorkflowContext
          }
        : {}),
      ...(request.orderedCaseWorkflowContext
        ? {
            orderedCaseWorkflowContext:
              request.orderedCaseWorkflowContext
          }
        : {}),
      tools: toolSchemas,
      toolSystemPromptAppendix: toolPrompt,
      // A SIMPLE matter (entry gate) on a local model takes the compact
      // lane: core-law texts in the prompt, core-law tools for the rest.
      ...(coreLawTools && request.model.startsWith("local/") && attachments.length === 0
        ? {
            quickLocalLegal: {
              toolPrompt: [
                coreLawTools.systemPromptAppendix(),
                coreLawRag ??
                  "# LOKALNE TEKSTY USTAW\nDla tego pytania nie dobrano automatycznie artykułów. Znajdź przepis search_core_law, a jego brzmienie weź z read_core_law_article; bez tego nie podawaj treści przepisu."
              ].join("\n\n")
            }
          }
        : {}),
      ...(request.matterComplexity
        ? { matterComplexity: request.matterComplexity }
        : {}),
      runGateIRuntimePrelude:
        (workflowPlan) =>
          runGateIRuntimePrelude({
            workflow:
              workflowPlan.id,
            query:
              protectedQuery,
            ledger,
            ...(verificationTools
              ? {
                  runTools:
                    (calls) =>
                      verificationTools
                        .runTools(
                          calls
                        )
                }
              : {})
          }),
      runTools: async (calls) => {
        for (const call of calls) {
          if (corpusTools.handles(call.name)) {
            const target = [call.input.skill, call.input.path].filter((part) => typeof part === "string").join("/");
            step("SKILLS", target || call.name);
          } else {
            step("MODEL", `narzędzie ${call.name}`);
          }
        }
        const corpusCalls = calls.filter((call) => corpusTools.handles(call.name));
        const reportCalls = calls.filter((call) => reportTools.handles(call.name));
        const caseFileCalls = calls.filter((call) => caseFileTools?.handles(call.name) ?? false);
        const widgetCalls = calls.filter((call) => widgetTools?.handles(call.name) ?? false);
        const federationCalls = calls.filter(
          (call) =>
            federationTools?.handles(
              call.name
            ) ?? false
        );
        const coreLawCalls = calls.filter(
          (call) =>
            coreLawTools?.handles(
              call.name
            ) ?? false
        );
        const verificationCalls = calls.filter(
          (call) =>
            !(coreLawTools?.handles(call.name) ?? false) &&
            !corpusTools.handles(call.name) &&
            !reportTools.handles(call.name) &&
            !(caseFileTools?.handles(call.name) ?? false) &&
            !(widgetTools?.handles(call.name) ?? false) &&
            !(federationTools?.handles(call.name) ?? false)
        );

        const corpusResults = corpusCalls.length > 0
          ? await corpusTools.runTools(corpusCalls)
          : [];
        const coreLawResults =
          coreLawTools &&
          coreLawCalls.length > 0
            ? await coreLawTools.runTools(
                coreLawCalls
              )
            : [];
        const reportResults = reportCalls.length > 0
          ? await reportTools.runTools(reportCalls)
          : [];
        const caseFileResults = caseFileTools && caseFileCalls.length > 0
          ? await caseFileTools.runTools(caseFileCalls)
          : [];
        const widgetResults = widgetTools && widgetCalls.length > 0
          ? await widgetTools.runTools(widgetCalls)
          : [];
        const federationResults =
          federationTools &&
          federationCalls.length > 0
            ? await federationTools
                .runTools(
                  federationCalls,
                  federationEvents
                )
            : [];

        for (
          const result
          of federationResults
        ) {
          const source =
            publicAuxiliarySourceFromToolResult(
              result
            );
          if (!source) {
            continue;
          }
          const key =
            [
              source.sourceUrl,
              source.claim ?? "",
              source.crossCheckStatus
            ].join("|");
          const exists =
            auxiliarySources.some(
              (item) =>
                [
                  item.sourceUrl,
                  item.claim ?? "",
                  item.crossCheckStatus
                ].join("|") ===
                key
            );
          if (!exists) {
            auxiliarySources.push(
              source
            );
          }
        }

        const verificationResults =
          verificationCalls.length > 0 &&
          verificationTools
            ? await verificationTools
                .runTools(
                  verificationCalls
                )
            : [];

        const byId = new Map(
          [
            ...corpusResults,
            ...coreLawResults,
            ...caseFileResults,
            ...reportResults,
            ...widgetResults,
            ...federationResults,
            ...verificationResults
          ].map((result) => [
            result.tool_use_id,
            result
          ])
        );

        return calls.map((call) =>
          byId.get(call.id) ?? {
            tool_use_id: call.id,
            content: JSON.stringify({
              status: "BLOCKED",
              error: "UNKNOWN_RUNTIME_TOOL"
            })
          }
        );
      }
    });

    transferExecutionEvents(execution.events, audit);

    const modelSelectedSkills =
      execution.events.some(
        (event) =>
          event.target ===
            "MODEL_SKILL_SELECTION" &&
          event.status === "OK"
      );
    if (modelSelectedSkills) {
      // Report what the model actually loaded (audited corpus reads).
      const selection =
        corpusTools.modelSkillSelection();
      execution.loadedSkills =
        selection.loadedSkills;
      execution.domainSkills =
        selection.domainSkills;
      execution.executionSkills =
        selection.executionSkills;
      if (selection.primarySkill) {
        execution.primarySkill =
          selection.primarySkill;
      }
      // The model routed itself: the route is the DR it actually read
      // (router-v3 only when it found no legal domain), not the placeholder.
      audit.record(
        "route",
        selection.primarySkill ?? "prawny-router-v3",
        "OK",
        {
          role: "primary-domain",
          selection: "model-auto-selection",
          domainSkills: selection.domainSkills
        }
      );
    }

    for (const event of caseFileTools?.auditEvents() ?? []) {
      audit.record(
        event.tool === "read_case_file" ? "resource_read" : "tool_decision",
        event.tool === "read_case_file" ? `local-document:${event.target}` : `case-files:${event.target}`,
        event.decision === "ALLOW" ? "OK" : "BLOCKED",
        { tool: event.tool, protectedOnly: true, ...(event.detail ?? {}) }
      );
    }
    for (const read of caseFileTools?.readChunks() ?? []) {
      citationSources.push({
        caseId: request.caseFiles!.caseId,
        documentId: read.documentId,
        sourceScope: "CASE_KNOWLEDGE",
        chunks: read.chunks
      });
    }

    for (const event of coreLawTools?.auditEvents() ?? []) {
      audit.record(
        event.tool === "read_core_law_article"
          ? "resource_read"
          : "tool_decision",
        `core-law:${event.target}`,
        event.decision === "ALLOW" ? "OK" : "BLOCKED",
        {
          tool: event.tool,
          ...(event.detail ? event.detail : {})
        }
      );
    }

    const corpusAudit = corpusTools.auditEvents();
    // A refused read that grants no content and that the model can correct
    // (router-v3 not read yet, a guessed file name, a malformed or binary read,
    // an unknown corpus tool) is guidance, not a failed turn - also when the
    // runtime routed the skills (document generation), where the required
    // reads are enforced separately by G39H. Path escapes (INVALID_RESOURCE_PREFIX,
    // PATH_ESCAPE), the criminal qualifier and other refusals still block.
    const correctableCorpusRefusal =
      /^(ROUTER_V3_REQUIRED_FIRST|LEGAL_RESOURCE_NOT_FOUND|LEGAL_SKILL_NOT_FOUND|LEGAL_RESOURCE_NOT_FILE|LEGAL_RESOURCE_NOT_TEXT|LEGAL_RESOURCE_REQUEST_INVALID|INVALID_RESOURCE_OFFSET|INVALID_RESOURCE_CURSOR|UNKNOWN_LEGAL_CORPUS_TOOL)/;
    const correctable = (event: (typeof corpusAudit)[number]) =>
      correctableCorpusRefusal.test(
        String(event.detail?.error ?? "")
      );
    // Poprawialna odmowa = DEGRADED, nie BLOCKED: HYBRID-VAL przed .docx odrzuca każde
    // zdarzenie BLOCKED sesji źródłowej, a bramka G36 takiej odmowy nie blokuje.
    for (const event of corpusAudit) {
      audit.record(
        event.tool === "read_legal_resource" || event.tool === "Read"
          ? "resource_read"
          : "tool_decision",
        event.target,
        event.decision === "ALLOW"
          ? "OK"
          : correctable(event)
            ? "DEGRADED"
            : "BLOCKED",
        {
          tool: event.tool,
          ...(event.detail ? event.detail : {})
        }
      );
    }

    const corpusBlocked = corpusAudit.some(
      (event) =>
        event.decision === "BLOCK" &&
        !correctable(event)
    );
    audit.record(
      "gate",
      "G36_LEGAL_CORPUS_RUNTIME",
      corpusBlocked ? "BLOCKED" : "OK",
      { toolEvents: corpusAudit.length }
    );

    const reportAudit =
      reportTools.auditEvents();
    for (const event of reportAudit) {
      audit.record(
        "tool_decision",
        event.target,
        event.decision === "ALLOW"
          ? "OK"
          : "BLOCKED",
        {
          tool: event.tool,
          ...(event.detail
            ? event.detail
            : {})
        }
      );
    }

    if (federationTools) {
      const federationAudit =
        federationEvents;
      for (
        const event
        of federationAudit
      ) {
        audit.record(
          "tool_decision",
          event.source
            ? "federated-legal:" +
              event.source
            : "federated-legal",
          // Niedostępne źródło = DEGRADED (jak bramka G40); odmowa polityki = BLOCKED.
          event.decision ===
            "ALLOW"
            ? "OK"
            : event.outcome ===
                "SOURCE_UNAVAILABLE"
              ? "DEGRADED"
              : "BLOCKED",
          {
            tool:
              event.tool,
            ...(event.detail
              ? event.detail
              : {})
          }
        );
      }
      audit.record(
        "gate",
        "G40_FEDERATED_LEGAL_RESEARCH",
        federationAudit.some(
          (event) =>
            event.decision ===
              "BLOCK"
        )
          ? "DEGRADED"
          : "OK",
        {
          toolEvents:
            federationAudit.length,
          verificationAuthority:
            "LEX_NATIVE_ONLY"
        }
      );
    }

    const workflowReads: DeterministicWorkflowReadReport =
      evaluateDeterministicWorkflowReads(
        execution.workflowPlan,
        corpusAudit,
        execution.events
      );
    const workflowResourcesBlocked =
      workflowReads.result === "BLOCKED";
    audit.record(
      "gate",
      "G39H_WORKFLOW_RESOURCE_READS",
      workflowResourcesBlocked ? "BLOCKED" : "OK",
      {
        workflow: workflowReads.workflow,
        required: workflowReads.required,
        observed: workflowReads.observed,
        missing: workflowReads.missing
      }
    );

    // The model's own ⚠️ at a statute does not stop the application from
    // verifying it: status comes from the registry only.
    const releasedDraft = releaseModelUnverifiedMarkers(execution.output);
    const automaticVerificationPlan =
      planAutomaticLegalVerification(
        releasedDraft.text,
        ledger,
        requestedHistoricalAsOf
      );
    let automaticVerificationExecuted = 0;

    if (
      automaticVerificationPlan.calls.length > 0 &&
      verificationTools
    ) {
      const results =
        await verificationTools.runTools(
          automaticVerificationPlan.calls
        );
      automaticVerificationExecuted =
        results.length;
    }

    // Model-written ✅ markers are claims, not verification: only the ledger
    // marker is shown, so a rewritten link or date cannot block the answer.
    const ledgerBackedOutput =
      stripUnbackedVerificationMarkers(
        releasedDraft.text,
        ledger
      );
    const automaticVerification =
      applyAutomaticVerificationMarkers(
        ledgerBackedOutput.text,
        ledger,
        requestedHistoricalAsOf
      );

    audit.record(
      "gate",
      "G39I_AUTO_POST_DRAFT_VERIFICATION",
      automaticVerificationPlan.calls.length > 0 &&
      !verificationTools
        ? "BLOCKED"
        : "OK",
      {
        planned:
          automaticVerificationPlan.calls.length,
        executed:
          automaticVerificationExecuted,
        insertedMarkers:
          automaticVerification.inserted,
        removedUnbackedMarkers:
          ledgerBackedOutput.removed,
        releasedModelUnverifiedMarkers:
          releasedDraft.released,
        skipped:
          automaticVerificationPlan.skipped
      }
    );

    if (verificationTools) {
      for (const toolEvent of verificationTools.auditEvents()) {
        audit.record(
          "tool_decision",
          toolEvent.tool,
          toolEvent.decision === "ALLOW" ? "OK" : "BLOCKED",
          {
            decision: toolEvent.decision,
            capability: toolEvent.capability ?? null,
            reason: toolEvent.reason ?? null
          }
        );
      }
    }

    const citedAnswer =
      processDocumentCitationMarkers(
        automaticVerification.text,
        citationSources
      );
    // HARD GATE: an unverified statute or Dz.U. reference is shown only with
    // its [NIEWERYFIKOWANE] marker, placed at the claim itself.
    const preFinalization =
      new FinalizationGate().evaluate(
        citedAnswer.text,
        ledger
      );
    const markedAnswer =
      preFinalization.result === "BLOCKED"
        ? {
            ...citedAnswer,
            // Najpierw prawdziwe znaczniki z rejestru dla przepisów powtórzonych bez
            // znacznika (np. tabela porównawcza), potem ⚠️ dla niezweryfikowanych.
            text: addMissingVerificationMarkers(
              markUnverifiedReferences(
                citedAnswer.text,
                preFinalization
              ),
              preFinalization
            )
          }
        : citedAnswer;
    // Końcowa kontrola spójności: jeden status źródła dla każdego przepisu w całej
    // odpowiedzi. Sprzeczność z rejestrem VERIFIED jest naprawiana według rejestru;
    // sprzeczność, której rejestr nie rozstrzyga, blokuje prezentację.
    const statusReconciliation =
      reconcileStatusMarkers(
        markedAnswer.text,
        ledger
      );
    const processedDocumentCitations =
      statusReconciliation.repaired > 0
        ? {
            ...markedAnswer,
            text: statusReconciliation.text
          }
        : markedAnswer;
    const statusConsistency =
      evaluateStatusConsistency(
        processedDocumentCitations.text,
        ledger
      );
    const statusConsistencyBlocked =
      statusConsistency.result ===
        "BLOCKED";
    audit.record(
      "gate",
      statusConsistency.gate,
      statusConsistencyBlocked
        ? "BLOCKED"
        : "OK",
      {
        repairedMarkers:
          statusReconciliation.repaired,
        provisions:
          statusConsistency.provisions.length,
        findings:
          statusConsistency.findings,
        orphanUnverifiedLines:
          statusConsistency.orphanUnverifiedLines
      }
    );
    audit.record(
      "gate",
      "LOCAL_DOCUMENT_DEEP_LINKS",
      "OK",
      {
        accepted: processedDocumentCitations.citations.length,
        rejected: processedDocumentCitations.rejectedMarkers,
        exactHighlights: processedDocumentCitations.citations.filter(
          (item) => item.highlightStart !== undefined && item.highlightEnd !== undefined
        ).length
      }
    );

    const workflowOutput =
      evaluateDeterministicWorkflowOutput(
        execution.workflowPlan,
        processedDocumentCitations.text,
        request.processWorkflowContext ||
        request.courtWorkflowContext ||
        request.orderedCaseWorkflowContext
          ? {
              ...(request.processWorkflowContext
                ? {
                    processCheckpoint:
                      request
                        .processWorkflowContext
                        .checkpoint
                  }
                : {}),
              ...(request.courtWorkflowContext
                ? {
                    courtCheckpoint:
                      request
                        .courtWorkflowContext
                        .checkpoint
                  }
                : {}),
              ...(request.orderedCaseWorkflowContext
                ? {
                    orderedCheckpoint:
                      request
                        .orderedCaseWorkflowContext
                        .checkpoint
                  }
                : {})
            }
          : undefined
      );
    const workflowOutputBlocked =
      workflowOutput.result ===
        "BLOCKED";
    audit.record(
      "gate",
      "G39H_WORKFLOW_OUTPUT",
      workflowOutputBlocked
        ? "BLOCKED"
        : "OK",
      {
        workflow:
          workflowOutput.workflow,
        mode:
          workflowOutput.mode,
        required:
          workflowOutput.required,
        observed:
          workflowOutput.observed,
        missing:
          workflowOutput.missing,
        orderValid:
          workflowOutput.orderValid
      }
    );

    const guideOutput =
      request.guideContext
        ? evaluateGuideOutput(
            request.guideContext,
            processedDocumentCitations.text
          )
        : null;
    const guideOutputBlocked =
      guideOutput?.result ===
        "BLOCKED";
    audit.record(
      "gate",
      "G39I_GUIDE_OUTPUT",
      guideOutputBlocked
        ? "BLOCKED"
        : "OK",
      guideOutput
        ? {
            questionCount:
              guideOutput.questionCount,
            oneQuestionRuleActive:
              guideOutput
                .oneQuestionRuleActive,
            irreversibleWarningRequired:
              guideOutput
                .irreversibleWarningRequired,
            irreversibleWarningPresent:
              guideOutput
                .irreversibleWarningPresent,
            violations:
              guideOutput.violations
          }
        : {
            active: false
          }
    );

    const requiredReportKind:
      ReportBlueprintKind | null =
        execution.workflowPlan.id ===
          "CLIENT_REPORT_V1"
          ? "CLIENT_REPORT_V1"
          : execution.workflowPlan.id ===
              "SITUATION_REPORT_V1"
            ? "SITUATION_REPORT_V1"
            : null;
    const reportBlueprint =
      requiredReportKind
        ? reportTools.acceptedFor(
            requiredReportKind
          )
        : null;
    const reportBlueprintBlocked =
      requiredReportKind !== null &&
      reportBlueprint === null;

    audit.record(
      "gate",
      "G39I_REPORT_BLUEPRINT",
      reportBlueprintBlocked
        ? "BLOCKED"
        : "OK",
      {
        required:
          requiredReportKind,
        accepted:
          reportBlueprint?.kind ??
          null,
        toolEvents:
          reportAudit.length
      }
    );

    const finalizationText =
      reportBlueprint
        ? [
            processedDocumentCitations.text,
            "[STRUCTURED_REPORT_BLUEPRINT_DATA]",
            JSON.stringify(
              reportBlueprint.blueprint
            ),
            "[/STRUCTURED_REPORT_BLUEPRINT_DATA]"
          ].join("\n")
        : processedDocumentCitations.text;

    step("VERIFY", "przepisy, orzeczenia i cytaty w odpowiedzi");
    const finalization = this.finalizer.finalize({
      text: finalizationText,
      ledger,
      audit,
      closeSession: false
    });

    const verificationRecords =
      ledger.all();
    const publicAuxiliarySources =
      reconcileAuxiliarySourcesWithVerification(
        auxiliarySources,
        verificationRecords
      );
    const gateI =
      evaluateGateIInvariants({
        events:
          execution.events,
        workflowReads,
        verificationRecords,
        finalization,
        outputValidation: {
          result:
            workflowOutputBlocked ||
            guideOutputBlocked ||
            reportBlueprintBlocked
              ? "BLOCKED"
              : "PASS",
          detail:
            [
              `workflow=${workflowOutput.result}`,
              `guide=${guideOutput?.result ?? "N/A"}`,
              `reportBlueprint=${reportBlueprintBlocked ? "BLOCKED" : "PASS"}`
            ].join(";")
        },
        documentCitations: {
          accepted:
            processedDocumentCitations
              .citations.length,
          rejected:
            processedDocumentCitations
              .rejectedMarkers,
          quotedWithoutExactHighlight:
            processedDocumentCitations
              .citations
              .filter(
                (citation) =>
                  Boolean(
                    citation.quote
                  ) &&
                  (
                    citation
                      .highlightStart ===
                      undefined ||
                    citation
                      .highlightEnd ===
                      undefined
                  )
              )
              .length
        }
      });
    const gateIBlocked =
      gateI.result ===
        "BLOCKED";

    const gateIContract =
      gateIWorkflowContract(
        execution.workflowPlan.id,
        execution.workflowPlan
          .executionSkill
      );

    const stateTransition:
      | "PASS"
      | "BLOCKED"
      | "NOT_APPLICABLE" =
      gateIContract.stateModel ===
        "DURABLE_CASE"
        ? (
            (
              execution.workflowPlan.id ===
                "PROCESS_PLEADING_V1" &&
              request
                .processWorkflowContext
            ) ||
            (
              execution.workflowPlan.id ===
                "COURT_ANALYSIS_V1" &&
              request
                .courtWorkflowContext
            ) ||
            (
              execution.workflowPlan.id ===
                "CHRONOLOGY_V1" &&
              request
                .chronologyWorkflowContext
            ) ||
            (
              execution.workflowPlan.id ===
                "CONTRACT_ANALYSIS_V1" &&
              request
                .contractWorkflowContext
            ) ||
            (
              (
                execution.workflowPlan.id ===
                  "EVIDENCE_ANALYSIS_V1" ||
                execution.workflowPlan.id ===
                  "WITNESS_QUESTIONING_V1"
              ) &&
              request
                .orderedCaseWorkflowContext
            )
          )
          ? "PASS"
          : "BLOCKED"
        : gateIContract.stateModel ===
            "DURABLE_SESSION"
          ? (
              execution.workflowPlan.id ===
                "LEGAL_GUIDE_V1" &&
              request.guideContext
            )
            ? "PASS"
            : "BLOCKED"
          : "NOT_APPLICABLE";

    const gateIWorkflowContractReport =
      evaluateGateIWorkflowContract({
        contract:
          gateIContract,
        invariants:
          gateI,
        input:
          gateIInput,
        stateTransition
      });
    const gateIWorkflowContractBlocked =
      gateIWorkflowContractReport.result ===
        "BLOCKED";

    audit.record(
      "gate",
      gateIWorkflowContractReport.gate,
      gateIWorkflowContractBlocked
        ? "BLOCKED"
        : "OK",
      {
        workflow:
          gateIWorkflowContractReport.workflow,
        stateModel:
          gateIWorkflowContractReport.stateModel,
        commonInvariants:
          gateIWorkflowContractReport.commonInvariants,
        checks:
          gateIWorkflowContractReport.checks
      }
    );

    let gateITurn =
      createGateITurnState(
        execution.workflowPlan.id
      );
    const check = (
      id:
        GateIInvariantReport["checks"][number]["id"]
    ) =>
      gateI.checks.find(
        (item) =>
          item.id === id
      );

    if (
      check("ROUTER_FIRST")
        ?.result !== "PASS"
    ) {
      gateITurn =
        blockGateITurn(
          gateITurn,
          "ROUTER_FIRST"
        );
    } else {
      gateITurn =
        passGateITurnPhase(
          gateITurn,
          "ROUTER_PREFLIGHT",
          "prawny-router-v3 first"
        );

      const workflowPreflight =
        execution.events.find(
          (event) =>
            event.type ===
              "gate" &&
            event.target ===
              "G39H_WORKFLOW_PREFLIGHT"
        );
      if (
        workflowPreflight
          ?.status !== "OK"
      ) {
        gateITurn =
          blockGateITurn(
            gateITurn,
            "SKILL_PREFLIGHT"
          );
      } else {
        gateITurn =
          passGateITurnPhase(
            gateITurn,
            "SKILL_PREFLIGHT",
            execution.workflowPlan.id
          );

        if (
          corpusBlocked ||
          check("CORE_RESOURCES")
            ?.result !==
              "PASS" ||
          check("WORKFLOW_RESOURCES")
            ?.result !==
              "PASS"
        ) {
          gateITurn =
            blockGateITurn(
              gateITurn,
              "RESOURCE_READS"
            );
        } else {
          gateITurn =
            passGateITurnPhase(
              gateITurn,
              "RESOURCE_READS",
              `workflowReads=${workflowReads.observed.length}`
            );

          const providerComplete =
            execution.events.find(
              (event) =>
                event.type ===
                  "gate" &&
                event.target ===
                  "G39H_WORKFLOW_PROVIDER_COMPLETE"
            );
          if (
            providerComplete
              ?.status !== "OK"
          ) {
            gateITurn =
              blockGateITurn(
                gateITurn,
                "SEMANTIC_EXECUTION"
              );
          } else {
            gateITurn =
              passGateITurnPhase(
                gateITurn,
                "SEMANTIC_EXECUTION"
              );

            if (
              check("SOURCE_PROVENANCE")
                ?.result !==
                  "PASS" ||
              check("SOURCE_HIERARCHY")
                ?.result !==
                  "PASS" ||
              check("TEMPORAL_FRESHNESS")
                ?.result !==
                  "PASS"
            ) {
              gateITurn =
                blockGateITurn(
                  gateITurn,
                  "SOURCE_VERIFICATION"
                );
            } else {
              gateITurn =
                passGateITurnPhase(
                  gateITurn,
                  "SOURCE_VERIFICATION",
                  `records=${gateI.verifiedOrSupportedRecords}`
                );

              if (
                check("CITATION_LEDGER")
                  ?.result !==
                    "PASS" ||
                check("LEGAL_CITATIONS")
                  ?.result !==
                    "PASS" ||
                check("CASE_SIGNATURES")
                  ?.result !==
                    "PASS" ||
                check("DOCUMENT_CITATIONS")
                  ?.result !==
                    "PASS"
              ) {
                gateITurn =
                  blockGateITurn(
                    gateITurn,
                    "CITATION_VALIDATION"
                  );
              } else {
                gateITurn =
                  passGateITurnPhase(
                    gateITurn,
                    "CITATION_VALIDATION",
                    `references=${gateI.legalReferences};cases=${gateI.caseReferences}`
                  );

                if (
                  workflowOutputBlocked ||
                  guideOutputBlocked ||
                  reportBlueprintBlocked
                ) {
                  gateITurn =
                    blockGateITurn(
                      gateITurn,
                      "OUTPUT_VALIDATION"
                    );
                } else {
                  gateITurn =
                    passGateITurnPhase(
                      gateITurn,
                      "OUTPUT_VALIDATION"
                    );

                  if (
                    check("FINALIZATION")
                      ?.result !==
                        "PASS"
                  ) {
                    gateITurn =
                      blockGateITurn(
                        gateITurn,
                        "FINALIZATION"
                      );
                  } else {
                    gateITurn =
                      passGateITurnPhase(
                        gateITurn,
                        "FINALIZATION"
                      );
                  }
                }
              }
            }
          }
        }
      }
    }

    audit.record(
      "gate",
      "G39I_TURN_STATE",
      gateITurn.result ===
        "PASS"
        ? "OK"
        : "BLOCKED",
      {
        workflow:
          gateITurn.workflowId,
        phase:
          gateITurn.phase,
        result:
          gateITurn.result,
        events:
          gateITurn.events.length
      }
    );

    audit.record(
      "gate",
      gateI.gate,
      gateIBlocked
        ? "BLOCKED"
        : "OK",
      {
        checks:
          gateI.checks,
        verifiedOrSupportedRecords:
          gateI.verifiedOrSupportedRecords,
        legalReferences:
          gateI.legalReferences,
        caseReferences:
          gateI.caseReferences
      }
    );

    const workflowFinalizationBlocked =
      finalization.result !== "PASS" ||
      statusConsistencyBlocked ||
      corpusBlocked ||
      workflowResourcesBlocked ||
      workflowOutputBlocked ||
      guideOutputBlocked ||
      reportBlueprintBlocked ||
      gateIBlocked ||
      gateIWorkflowContractBlocked;

    const presentationCriticalGateIds =
      new Set([
        "ROUTER_FIRST",
        "CORE_RESOURCES",
        "ROUTER_REQUIRED_MODULES",
        "WORKFLOW_RESOURCES",
        "OUTPUT_CONTRACT"
      ] as const);
    const criticalGateIBlocked =
      gateI.checks.some(
        (item) =>
          presentationCriticalGateIds.has(
            item.id as
              | "ROUTER_FIRST"
              | "CORE_RESOURCES"
              | "ROUTER_REQUIRED_MODULES"
              | "WORKFLOW_RESOURCES"
              | "OUTPUT_CONTRACT"
          ) &&
          item.result === "BLOCKED"
      );
    const workflowContractExtensionBlocked =
      gateIWorkflowContractReport
        .checks
        .some(
          (item) =>
            item.result ===
              "BLOCKED"
        );
    const verificationDegraded =
      finalization.result !==
        "PASS" ||
      gateIBlocked ||
      gateITurn.result !==
        "PASS";

    const presentationBlocked =
      // Still blocked after marking: a case-law claim without evidence or a
      // verification marker that does not match its source.
      finalization.result === "BLOCKED" ||
      statusConsistencyBlocked ||
      corpusBlocked ||
      workflowResourcesBlocked ||
      workflowOutputBlocked ||
      guideOutputBlocked ||
      reportBlueprintBlocked ||
      workflowContractExtensionBlocked;
    audit.record(
      "gate",
      "G39H_WORKFLOW_FINALIZATION",
      workflowFinalizationBlocked ? "BLOCKED" : "OK",
      {
        workflow: execution.workflowPlan.id,
        finalization: finalization.result,
        statusConsistency: statusConsistency.result,
        corpusBlocked,
        workflowResourcesBlocked,
        workflowOutputBlocked,
        guideOutputBlocked,
        reportBlueprintBlocked
      }
    );

    // The register of the mandatory path, from what really happened in the turn.
    const mandatoryPath =
      mandatoryModel && legalTurn
        ? evaluateMandatoryPath(mandatoryModel, {
            ...pathFacts,
            profile,
            contextResources,
            answer: processedDocumentCitations.text,
            records: ledger.all(),
            events: audit.events.map((event) => ({
              type: event.type,
              target: event.target,
              status: event.status,
              ...(event.detail ? { detail: event.detail } : {})
            })),
            loadedSkills: execution.loadedSkills ?? [],
            primarySkill: execution.primarySkill,
            finalization: finalization.result,
            federationTools: Boolean(federationTools)
          })
        : undefined;
    if (mandatoryPath) {
      audit.record("gate", "MANDATORY_PATH", mandatoryPath.complete ? "OK" : "DEGRADED", {
        profile: mandatoryPath.profile,
        missing: mandatoryPath.missing
      });
    }

    const safeToPresent =
      !presentationBlocked;
    audit.record(
      "gate",
      "G15_SAFE_SESSION_EXECUTION",
      presentationBlocked
        ? "BLOCKED"
        : verificationDegraded
          ? "DEGRADED"
          : "OK",
      {
        finalization:
          finalization.result,
        verificationDegraded,
        criticalGateIBlocked,
        workflowContractExtensionBlocked
      }
    );
    audit.close(
      presentationBlocked
        ? "BLOCKED"
        : verificationDegraded
          ? "DEGRADED"
          : "OK",
      {
        finalization:
          finalization.result,
        verificationDegraded
      }
    );

    const completeness = audit.validateCompletion({
      requireVerification: finalization.references.length > 0,
      requireToolActivity:
        finalization.references.length > 0 && Boolean(verificationTools),
      requireDeterministicWorkflow: true
    });
    const blockedReferences: PublicBlockedReference[] = finalization.findings
      .filter((finding) => finding.status !== "VERIFIED")
      .map((finding): PublicBlockedReference => ({
        claim: finding.reference.claim,
        kind: finding.reference.kind,
        line: finding.reference.line,
        status: finding.status
      }))
      .concat(
        statusConsistency.findings.flatMap((finding) =>
          finding.lines.map((line) => ({
            claim: finding.key,
            kind: "statute" as const,
            line,
            status: finding.code
          }))
        )
      )
      // Znaczniki orzeczeń bez dowodu (zmyślone albo cytat zmieniony po weryfikacji).
      .concat(
        [...finalization.caseQuoteFindings.filter((finding) => finding.status !== "VERIFIED"),
          ...finalization.caseSupportFindings.filter((finding) => finding.status !== "SUPPORTED")]
          .map((finding) => ({
            claim: finding.record?.caseSignature ?? `znacznik orzeczenia ${finding.evidenceHash}`,
            kind: "case" as const,
            line: finding.line,
            status: finding.status
          }))
      );

    step("RESTORE", "symbole zastępcze → dane z lokalnego klucza");
    // Every restored value is reported so the UI can mark it for review.
    const restoredAnswer = restoreWithReport(
      processedDocumentCitations.text,
      chatPrivacyVault
    );
    const response: SessionExecutionResponse = {
      sessionId: audit.sessionId,
      status: safeToPresent ? "DRAFT_PRESENTABLE" : "BLOCKED",
      ...(mandatoryPath ? { mandatoryPath } : {}),
      ...(request.modeDecision ? { modeDecision: request.modeDecision } : {}),
      provider: request.provider,
      model: request.model,
      modelRouting: {
        primary: {
          provider:
            request.provider,
          model:
            request.model
        }
      },
      primarySkill: execution.primarySkill,
      loadedSkills: execution.loadedSkills,
      executionSkills: execution.executionSkills,
      domainSkills: execution.domainSkills,
      ...(safeToPresent
        ? {
            answer:
              restoredAnswer.text,
            ...(restoredAnswer.restorations.length > 0
              ? { restorations: restoredAnswer.restorations }
              : {}),
            ...(restoredAnswer.unresolved.length > 0
              ? { unresolvedTokens: restoredAnswer.unresolved }
              : {}),
            documentCitations: processedDocumentCitations.citations,
            ...(reportBlueprint
              ? {
                  reportBlueprint
                }
              : {})
          }
        : {}),
      finalization: finalization.result,
      blockedReferences,
      verification: {
        records: verificationRecords.length,
        verified: verificationRecords.filter((record) => record.status === "VERIFIED").length,
        supported: verificationRecords.filter((record) => record.status === "SUPPORTED").length,
        unverified: verificationRecords.filter((record) => record.status === "UNVERIFIED").length
      },
      evidence: publicEvidenceBundle(verificationRecords),
      ...(publicAuxiliarySources.length > 0
        ? {
            auxiliarySources:
              publicAuxiliarySources
          }
        : {}),
      ...(widgetTools && widgetTools.widgets().length > 0
        ? { widgets: widgetTools.widgets() }
        : {}),
      context: {
        ...contextSelection.report
      },
      audit: {
        result: completeness.result,
        eventCount: completeness.eventCount,
        closed: audit.isClosed,
        missing: [...completeness.missing],
        violations: [...completeness.violations],
        blockedEvents: audit.events
          .filter((event) => event.status === "BLOCKED")
          .slice(0, 12)
          .map((event) => {
            const code = [event.detail?.error, event.detail?.reason, event.detail?.decision]
              .find((value) => typeof value === "string" && value.trim());
            return `${event.type}: ${event.target.slice(0, 120)}${code ? ` — ${String(code).slice(0, 160)}` : ""}`;
          })
      },
      workflow: {
        id: execution.workflowPlan.id,
        result:
          workflowResourcesBlocked ||
          workflowOutputBlocked ||
          guideOutputBlocked ||
          reportBlueprintBlocked ||
          finalization.result !== "PASS" ||
          gateIBlocked
            ? "BLOCKED"
            : "PASS",
        requiredResources: workflowReads.required,
        missingResources: workflowReads.missing
      },
      gateI,
      gateIWorkflowContract:
        gateIWorkflowContractReport,
      gateITurn
    };

    Object.defineProperty(
      response,
      SESSION_EXECUTION_INTERNAL,
      {
        value: {
          verificationRecords: verificationRecords.map((record) => ({ ...record })),
          auditEvents: audit.events.map((event) => ({
            ...event,
            ...(event.detail ? { detail: { ...event.detail } } : {})
          })),
          // Own-key documents by prefix (D01 = [0]); shared-key ones have none.
          documentAliasDocumentIds:
            aliasRegistry.documentIds()
        } satisfies SessionExecutionInternalState,
        enumerable: false,
        configurable: false,
        writable: false
      }
    );

    return response;
  }
}
