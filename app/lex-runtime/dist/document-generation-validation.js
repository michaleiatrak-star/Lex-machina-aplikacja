import { AuditTrail } from "./audit-trail.js";
import { VerificationLedger } from "./verification-ledger.js";
// Blocked events of a session degraded only by verification: a verification tool refused
// (source unavailable, wording after the t.j. unconfirmed) and the gates that follow from it.
const VERIFICATION_GATES = new Set([
    "G8_HARD_GATE_FINALIZATION",
    "G39I_WORKFLOW_CONTRACT",
    "G39I_TURN_STATE",
    "G39I_COMMON_LEGAL_INVARIANTS",
    "G39H_WORKFLOW_FINALIZATION"
]);
export function verificationOnlyBlock(event) {
    return (event.status === "BLOCKED" &&
        ((event.type === "tool_decision" && event.target.startsWith("verify_")) ||
            (event.type === "gate" && VERIFICATION_GATES.has(event.target))));
}
// HYBRID-VAL findings as warnings shown with the file.
export const HYBRID_WARNING_TEXT = {
    DRAFT_UNVERIFIED: "dokument ma oznaczenie DRAFT — NIEWERYFIKOWANY: usuń je po sprawdzeniu powołań",
    PRIVACY_TOKEN_REMAINS: "w treści zostały symbole anonimizacji ([PII:…] / [LMPII:…]): wpisz w ich miejsce właściwe dane",
    CONTROL_CHARACTER: "tekst zawiera znaki sterujące (niewidoczne): sprawdź formatowanie w edytorze",
    SOURCE_SESSION_BLOCKED_EVENT: "w rozmowie, z której powstał dokument, był krok zatrzymany przez kontrolę (np. niezweryfikowane źródło): sprawdź powołania i fakty przed podpisaniem",
    SOURCE_DOCUMENT_AUDIT_MISSING: "brak śladu odczytu dokumentu źródłowego sprawy: porównaj fakty pisma z aktami"
};
export function validateLocalHybridDocument(text, context) {
    const reasons = [];
    const found = [];
    if (!text.trim())
        reasons.push("EMPTY_DOCUMENT");
    // Fields to fill in ([UZUPEŁNIJ: …], ⬛, [Sąd do ustalenia: …]) stay in the file and are
    // named to the user with it (documentCompletenessWarnings): never a reason to refuse the file.
    if (/DRAFT\s*[—-]\s*NIEWERYFIKOWANY/iu.test(text))
        found.push("DRAFT_UNVERIFIED");
    if (/\[(?:LMPII|PII):[^\]]+\]/u.test(text))
        found.push("PRIVACY_TOKEN_REMAINS");
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))
        found.push("CONTROL_CHARACTER");
    const blockedSourceEvent = context.auditEvents.some((event) => event.status === "BLOCKED" && !(context.acceptedUnverifiedSource && verificationOnlyBlock(event)));
    if (blockedSourceEvent)
        found.push("SOURCE_SESSION_BLOCKED_EVENT");
    if (context.usedDocumentContext &&
        !context.auditEvents.some((event) => event.type === "resource_read" && event.target.startsWith("local-document:"))) {
        found.push("SOURCE_DOCUMENT_AUDIT_MISSING");
    }
    return {
        result: reasons.length === 0 ? "PASS" : "BLOCKED",
        reasons,
        warnings: found
    };
}
/** The findings in words, for the file's warnings. */
export function hybridWarningTexts(codes) {
    return codes.map((code) => HYBRID_WARNING_TEXT[code] ?? code);
}
export function rebuildGenerationExportState(context) {
    if (context.schemaVersion !== 1 ||
        !context.sourceSessionId ||
        !context.primarySkill ||
        !context.model) {
        throw new Error("GENERATION_VALIDATION_CONTEXT_INVALID");
    }
    const ledger = new VerificationLedger();
    for (const record of context.verificationRecords) {
        ledger.add({ ...record });
    }
    for (const signature of context.caseFileNumbers ?? [])
        ledger.addCaseFileNumber(signature);
    for (const signature of context.caseReferences ?? [])
        ledger.addCaseReference(signature);
    for (const key of context.factAmounts ?? [])
        ledger.addFactAmount(key);
    const audit = new AuditTrail(context.sourceSessionId + ":document-export");
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
        if (!replayable.has(event.type))
            continue;
        if (event.type === "gate" &&
            [
                "G8_HARD_GATE_FINALIZATION",
                "G15_SAFE_SESSION_EXECUTION",
                "HYBRID_VALIDATION",
                "G10_EXPORT_GATE"
            ].includes(event.target)) {
            continue;
        }
        audit.record(event.type, event.target, 
        // A step the conversation stopped stays in the export's trail as degraded: it is named to
        // the user as a warning with the file (HYBRID-VAL), not a reason to refuse the file.
        event.status === "BLOCKED" ? "DEGRADED" : event.status, {
            sourceSequence: event.sequence,
            ...(event.status === "BLOCKED" ? { sourceStatus: "BLOCKED" } : {}),
            ...(event.detail ? { sourceDetail: { ...event.detail } } : {})
        });
    }
    return { audit, ledger };
}
