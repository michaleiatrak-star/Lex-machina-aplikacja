import type { AuditEvent } from "./audit-trail.js";
import { AuditTrail } from "./audit-trail.js";
import type { ProviderId } from "./providers/types.js";
import type { VerificationRecord } from "./verification-ledger.js";
import { VerificationLedger } from "./verification-ledger.js";

export type DocumentGenerationValidationContext = {
  schemaVersion: 1;
  sourceSessionId: string;
  primarySkill: string;
  provider: ProviderId;
  model: string;
  usedDocumentContext: boolean;
  verificationRecords: VerificationRecord[];
  // The proceeding's own case numbers: G8 does not treat them as case law in the file.
  caseFileNumbers?: string[];
  // Values the case itself states (user's messages, case documents): not statutory amounts.
  factAmounts?: string[];
  auditEvents: AuditEvent[];
  // The source session was blocked only by unverified legal references (DRAFT_PRESENTABLE,
  // DEGRADED) and the user chose a draft with them named (ZAKAZ-14, decision "a").
  acceptedUnverifiedSource?: { claims: string[] };
};

// Blocked events of a session degraded only by verification: a verification tool refused
// (source unavailable, wording after the t.j. unconfirmed) and the gates that follow from it.
const VERIFICATION_GATES = new Set([
  "G8_HARD_GATE_FINALIZATION",
  "G39I_WORKFLOW_CONTRACT",
  "G39I_TURN_STATE",
  "G39I_COMMON_LEGAL_INVARIANTS",
  "G39H_WORKFLOW_FINALIZATION"
]);

export function verificationOnlyBlock(event: Pick<AuditEvent, "type" | "target" | "status">): boolean {
  return (
    event.status === "BLOCKED" &&
    ((event.type === "tool_decision" && event.target.startsWith("verify_")) ||
      (event.type === "gate" && VERIFICATION_GATES.has(event.target)))
  );
}

export type LocalHybridValidationReport = {
  result: "PASS" | "BLOCKED";
  reasons: string[];
};

export function validateLocalHybridDocument(
  text: string,
  context: DocumentGenerationValidationContext
): LocalHybridValidationReport {
  const reasons: string[] = [];
  if (!text.trim()) reasons.push("EMPTY_DOCUMENT");
  if (/⬛/u.test(text) || /\[UZUPEŁNIJ(?::|\])/iu.test(text)) {
    reasons.push("OPEN_PLACEHOLDER");
  }
  if (/DRAFT\s*[—-]\s*NIEWERYFIKOWANY/iu.test(text)) {
    reasons.push("DRAFT_UNVERIFIED");
  }
  if (/\[(?:LMPII|PII):[^\]]+\]/u.test(text)) {
    reasons.push("PRIVACY_TOKEN_REMAINS");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    reasons.push("CONTROL_CHARACTER");
  }
  const blockedSourceEvent = context.auditEvents.some(
    (event) => event.status === "BLOCKED" && !(context.acceptedUnverifiedSource && verificationOnlyBlock(event))
  );
  if (blockedSourceEvent) reasons.push("SOURCE_SESSION_BLOCKED_EVENT");
  if (
    context.usedDocumentContext &&
    !context.auditEvents.some(
      (event) => event.type === "resource_read" && event.target.startsWith("local-document:")
    )
  ) {
    reasons.push("SOURCE_DOCUMENT_AUDIT_MISSING");
  }
  return {
    result: reasons.length === 0 ? "PASS" : "BLOCKED",
    reasons
  };
}

export function rebuildGenerationExportState(
  context: DocumentGenerationValidationContext
): { audit: AuditTrail; ledger: VerificationLedger } {
  if (
    context.schemaVersion !== 1 ||
    !context.sourceSessionId ||
    !context.primarySkill ||
    !context.model
  ) {
    throw new Error("GENERATION_VALIDATION_CONTEXT_INVALID");
  }

  const ledger = new VerificationLedger();
  for (const record of context.verificationRecords) {
    ledger.add({ ...record });
  }
  for (const signature of context.caseFileNumbers ?? []) ledger.addCaseFileNumber(signature);
  for (const key of context.factAmounts ?? []) ledger.addFactAmount(key);

  const audit = new AuditTrail(
    context.sourceSessionId + ":document-export"
  );
  audit.start({
    sourceSessionId: context.sourceSessionId,
    provider: context.provider,
    model: context.model,
    primarySkill: context.primarySkill,
    continuation: "FINAL_DOCUMENT_EXPORT"
  });

  const replayable = new Set([
    "skill_read",
    "resource_read",
    "route",
    "provider_start",
    "provider_end",
    "tool_decision",
    "gate"
  ]);

  for (const event of context.auditEvents) {
    if (!replayable.has(event.type)) continue;
    if (
      event.type === "gate" &&
      [
        "G8_HARD_GATE_FINALIZATION",
        "G15_SAFE_SESSION_EXECUTION",
        "HYBRID_VALIDATION",
        "G10_EXPORT_GATE"
      ].includes(event.target)
    ) {
      continue;
    }
    audit.record(
      event.type as
        | "skill_read"
        | "resource_read"
        | "route"
        | "provider_start"
        | "provider_end"
        | "tool_decision"
        | "gate",
      event.target,
      // An accepted draft: its verification refusals stay in the trail as degraded, not blocking.
      context.acceptedUnverifiedSource && verificationOnlyBlock(event) ? "DEGRADED" : event.status,
      {
        sourceSequence: event.sequence,
        ...(event.detail ? { sourceDetail: { ...event.detail } } : {})
      }
    );
  }

  return { audit, ledger };
}
