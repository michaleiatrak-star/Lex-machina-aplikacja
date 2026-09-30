import { SESSION_EXECUTION_INTERNAL } from "./session-executor.js";
import { DOCUMENT_TYPES, STYLE_PROFILES, validateLegalDocumentAst } from "./legal-document-ast.js";
function extractJson(value) {
    const trimmed = value.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    const source = fenced?.[1] ?? trimmed;
    const first = source.indexOf("{");
    const last = source.lastIndexOf("}");
    if (first < 0 || last < first) {
        throw new Error("DOCUMENT_AST_JSON_MISSING");
    }
    try {
        return JSON.parse(source.slice(first, last + 1));
    }
    catch {
        throw new Error("DOCUMENT_AST_JSON_INVALID");
    }
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
// The header carries only values the runtime dictates (schema, locale, type and profile
// of the requested document). Models differ in how they echo it (schemaVersion 1 as a
// number, "pl" for the locale, a missing field, the AST wrapped in {"document": ...}), so
// the runtime fills and normalizes it. The blocks are never touched and are validated as
// before; a valid but different documentType/styleProfile still fails the contract check.
export function normalizeAstHeader(value, request) {
    if (!isRecord(value))
        return value;
    let record = value;
    if (!Array.isArray(record.blocks)) {
        const wrapped = ["document", "ast", "legalDocument", "result"]
            .map((key) => value[key])
            .find((item) => isRecord(item) && Array.isArray(item.blocks));
        if (wrapped)
            record = wrapped;
    }
    if (!Array.isArray(record.blocks) && Array.isArray(record.content)) {
        const { content, ...rest } = record;
        record = { ...rest, blocks: content };
    }
    const version = record.schemaVersion;
    const locale = typeof record.locale === "string" ? record.locale.trim() : undefined;
    return {
        ...record,
        schemaVersion: version === undefined || version === 1 || version === "1.0"
            ? "1"
            : version,
        locale: locale === undefined || /^pl([-_]pl)?$/i.test(locale)
            ? "pl-PL"
            : record.locale,
        documentType: DOCUMENT_TYPES.has(record.documentType)
            ? record.documentType
            : request.documentType,
        styleProfile: STYLE_PROFILES.has(record.styleProfile)
            ? record.styleProfile
            : request.styleProfile
    };
}
function generationInstruction(request) {
    const aliasRows = request.aliases.entries
        .map((entry) => entry.sourceToken + " -> " + entry.alias + " (" + entry.kind +
        (entry.entity === "organization"
            ? ", firma z imieniem/nazwiskiem w nazwie" + (entry.legalForm ? ` (${entry.legalForm})` : "") +
                " - nie odmieniaj, uzgadniaj przez „spółka”/„firma”: „spółka … wniosła”"
            : entry.entity === "group"
                ? entry.gender === "f"
                    ? ", kilka kobiet o wspólnym nazwisku - liczba mnoga niemęskoosobowa („wniosły”)"
                    : ", kilka osób o wspólnym nazwisku - liczba mnoga męskoosobowa („wnieśli”)"
                : entry.gender === "f"
                    ? ", rodzaj żeński"
                    : entry.gender === "m"
                        ? ", rodzaj męski"
                        : entry.gender === "unknown"
                            ? ", rodzaj nieustalony - formy neutralne"
                            : "") +
        ")")
        .join("\n");
    return [
        request.query,
        "",
        "# OUTPUT CONTRACT — LEGAL DOCUMENT AST",
        "Return ONLY one JSON object. No Markdown fence, explanation, commentary or prose outside JSON.",
        "schemaVersion must equal \"1\".",
        "documentType must equal \"" + request.documentType + "\".",
        "locale must equal \"pl-PL\".",
        "styleProfile must equal \"" + request.styleProfile + "\".",
        "Allowed block types: heading(level 1-3), paragraph, quote, list, table, signature, page_break.",
        "Allowed inline types: text, pii_ref, xref.",
        "Generate the actual finished legal document, not a chat answer about the document.",
        "Do not add meta-sections such as DANE DO UZUPEŁNIENIA, UWAGI PRAKTYCZNE, CO DALEJ, HYBRID-VALIDATION, disclaimers, routing notes or explanations outside the document itself.",
        "Use a professional Polish legal-office layout: concise title, date/party/address blocks where appropriate, clear subject or heading, logically separated body paragraphs, numbered or bulleted demands only when useful, and a signature block.",
        "For reusable templates, place missing user data directly in neutral square-bracket fields such as [Miejscowość, data], [Kwota] or [Termin zapłaty]; never use the marker [UZUPEŁNIJ].",
        "Avoid Markdown markers such as **, # or backticks inside text nodes. Structure belongs in AST block types.",
        "For a demand for payment, include at minimum: parties, title WEZWANIE DO ZAPŁATY, basis/description of the debt, amount, due date, an additional payment deadline, payment method/account placeholder, consequence of non-payment stated proportionately, and signature.",
        "Never emit raw OOXML, ODF, HTML, scripts, macros, URLs as package relationships, or executable content.",
        "Never place token-looking syntax inside a text node.",
        "When protected source context contains a source PII token listed below, use its generation alias only as a typed pii_ref node.",
        "HARD GATE: every PERSON or ADDRESS pii_ref MUST carry the grammatical case of that occurrence as \"case\" (a pii_ref without it is an error): NOM, GEN, DAT, ACC, INS, LOC or VOC, e.g. {\"type\":\"pii_ref\",\"alias\":\"[LMPII:D01:PERSON:0001]\",\"case\":\"GEN\"} after \"wobec\" or \"od\", or \"LOC\" for an ADDRESS after \"przy\". The value is inflected locally; never write the name or address yourself.",
        "Agree verbs, adjectives and participles with the gender and number given for a PERSON alias in the map below (e.g. \"wniosła\"/\"wniósł\", \"pozwana\"/\"pozwany\", several persons: \"wnieśli\"/\"wniosły\"); for an undetermined gender use neutral wording. Several persons on one side of a case: name all of them and state expressly whether the demand or award is joint and several (solidarnie) or in shares; never assume it without a factual basis.",
        "Do not invent aliases. Do not attempt to infer the underlying clear value.",
        "",
        "# PROVIDER-SAFE PII ALIAS MAP",
        aliasRows || "(no aliases available)"
    ].join("\n");
}
// Diagnostyka zablokowanej sesji pisma: tylko statusy, nazwy bramek i powołania (bez treści
// odpowiedzi i danych sprawy), żeby w UI było widać, która bramka zatrzymała dokument.
export class DocumentAstSessionBlockedError extends Error {
    reason;
    description;
    stage;
    constructor(reason, description, code = "DOCUMENT_AST_SESSION_BLOCKED", stage = "DOCUMENT_AST_SESSION") {
        super(code);
        this.reason = reason;
        this.description = description;
        this.stage = stage;
        this.name = "DocumentAstSessionBlockedError";
    }
}
// Shape of a rejected AST header: keys and header values only, never block content.
function astHeaderDiagnostic(value) {
    const record = isRecord(value) ? value : {};
    const shown = (key) => {
        const item = record[key];
        return item === undefined ? "brak" : JSON.stringify(item).slice(0, 60);
    };
    return new DocumentAstSessionBlockedError(["schemaVersion", "documentType", "locale", "styleProfile"]
        .map((key) => `${key}=${shown(key)}`)
        .join("; ") +
        `; blocks=${Array.isArray(record.blocks) ? `${record.blocks.length} bloków` : "brak"}`, `klucze odpowiedzi: ${Object.keys(record).slice(0, 20).join(", ") || "(nie obiekt JSON)"}`, "AST_HEADER_INVALID", "DOCUMENT_AST_VALIDATION");
}
function blockedSessionDiagnostic(result) {
    const reason = [
        `status=${result.status}`,
        `finalization=${result.finalization}`,
        `audit=${result.audit.result}`,
        `answer=${result.answer ? "present" : "missing"}`,
        ...(result.workflow ? [`workflow=${result.workflow.id}:${result.workflow.result}`] : []),
        ...(result.gateI ? [`gateI=${result.gateI.result}`] : [])
    ].join("; ");
    const details = [
        ...(result.audit.missing?.length ? [`audit.missing: ${result.audit.missing.join(", ")}`] : []),
        ...(result.audit.violations?.length ? [`audit.violations: ${result.audit.violations.join(", ")}`] : []),
        ...(result.workflow?.missingResources.length
            ? [`workflow.missingResources: ${result.workflow.missingResources.join(", ")}`]
            : []),
        ...(result.gateI
            ? result.gateI.checks
                .filter((check) => check.result === "BLOCKED")
                .map((check) => `gateI.${check.id}: ${check.detail.slice(0, 200)}`)
            : []),
        // Które zdarzenia audytu mają BLOCKED (bramka / odczyt / narzędzie): tylko typ, cel i kod
        // przyczyny, bez treści odpowiedzi i danych sprawy.
        ...(result[SESSION_EXECUTION_INTERNAL]?.auditEvents ?? [])
            .filter((event) => event.status === "BLOCKED")
            .slice(0, 12)
            .map((event) => {
            const code = [event.detail?.error, event.detail?.reason, event.detail?.decision]
                .find((value) => typeof value === "string" && value.trim());
            return `blockedEvent[${event.type}]: ${event.target.slice(0, 120)}${code ? ` — ${String(code).slice(0, 160)}` : ""}`;
        }),
        ...result.blockedReferences
            .slice(0, 10)
            .map((reference) => `blockedReference[${reference.kind}/${reference.status}]: ${reference.claim.slice(0, 80)}`),
        `verification: records=${result.verification.records}, verified=${result.verification.verified}, supported=${result.verification.supported}, unverified=${result.verification.unverified}`
    ];
    return new DocumentAstSessionBlockedError(reason, details.join("\n"));
}
export class LegalDocumentAstGenerator {
    sessions;
    constructor(sessions) {
        this.sessions = sessions;
    }
    async generate(request) {
        const result = await this.sessions.execute({
            query: generationInstruction(request),
            provider: request.provider,
            model: request.model,
            primarySkill: request.primarySkill,
            mode: request.mode,
            documentAstOutput: true,
            ...(request.privacySeed ? { privacySeed: request.privacySeed } : {}),
            ...(request.attachments?.length
                ? { documentAttachments: request.attachments }
                : {})
        });
        if (result.status !== "DRAFT_PRESENTABLE" ||
            result.finalization !== "PASS" ||
            result.audit.result !== "PASS" ||
            !result.answer) {
            throw blockedSessionDiagnostic(result);
        }
        const parsed = normalizeAstHeader(extractJson(result.answer), request);
        let validated;
        try {
            validated = validateLegalDocumentAst(parsed, request.aliases.entries);
        }
        catch (error) {
            if (error instanceof Error && error.message === "AST_HEADER_INVALID") {
                throw astHeaderDiagnostic(parsed);
            }
            throw error;
        }
        if (validated.ast.documentType !== request.documentType ||
            validated.ast.styleProfile !== request.styleProfile) {
            throw new Error("DOCUMENT_AST_CONTRACT_MISMATCH");
        }
        const internal = result[SESSION_EXECUTION_INTERNAL];
        if (!internal) {
            throw new Error("DOCUMENT_AST_INTERNAL_VALIDATION_MISSING");
        }
        return {
            ast: validated.ast,
            aliasesUsed: validated.aliasesUsed,
            sessionId: result.sessionId,
            validationContext: {
                schemaVersion: 1,
                sourceSessionId: result.sessionId,
                primarySkill: request.primarySkill,
                provider: request.provider,
                model: request.model,
                usedDocumentContext: Boolean(request.attachments
                    ?.length),
                verificationRecords: internal
                    .verificationRecords
                    .map((record) => ({
                    ...record
                })),
                auditEvents: internal.auditEvents
                    .map((event) => ({
                    ...event,
                    ...(event.detail
                        ? {
                            detail: {
                                ...event.detail
                            }
                        }
                        : {})
                }))
            }
        };
    }
}
