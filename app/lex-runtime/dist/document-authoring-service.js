import { createHash } from "node:crypto";
import { buildGenerationAliases, resolveGenerationAliases, applyRestorationOverrides, describeGenerationAliases, renderRestorationPreview } from "./generation-aliases.js";
import { legalDocumentPlainText, validateLegalDocumentAst } from "./legal-document-ast.js";
import { LocalLegalDocumentRenderer } from "./legal-document-renderer.js";
import { privacyVaultDeanonymizationKeyBinding } from "./privacy/vault-store.js";
import { rebuildGenerationExportState, validateLocalHybridDocument } from "./document-generation-validation.js";
import { ExportGate } from "./export-gate.js";
import { FinalizationGate } from "./finalization-gate.js";
import { stripAstVerificationMarkers } from "./verification-markers.js";
import { documentCompletenessWarnings } from "./document-completeness.js";
/**
 * Export refused: the gate's reasons and the references behind them, so the
 * user sees which provisions and judgments block the file. `draftAvailable`:
 * only unverified (not blocked) references - a draft naming them may be saved.
 */
export class ExportGateBlockedError extends Error {
    reasons;
    references;
    draftAvailable;
    constructor(code, reasons, references, draftAvailable) {
        super(`${code}:${reasons.join(",")}`);
        this.reasons = reasons;
        this.references = references;
        this.draftAvailable = draftAvailable;
        this.name = "ExportGateBlockedError";
    }
}
function blockedReferences(finalization) {
    if (!finalization)
        return [];
    return [
        ...finalization.findings
            .filter((finding) => finding.status !== "VERIFIED")
            .map((finding) => ({ claim: finding.reference.claim, status: finding.status, line: finding.reference.line })),
        ...finalization.caseQuoteFindings
            .filter((finding) => finding.status !== "VERIFIED")
            .map((finding) => ({ claim: finding.lineText.trim().slice(0, 160), status: finding.status, line: finding.line })),
        ...finalization.caseSupportFindings
            .filter((finding) => finding.status !== "SUPPORTED")
            .map((finding) => ({ claim: finding.lineText.trim().slice(0, 160), status: finding.status, line: finding.line }))
    ];
}
function exportBlocked(code, report) {
    return new ExportGateBlockedError(code, report.reasons, blockedReferences(report.finalization), report.reasons.length === 1 && report.reasons[0] === "UNVERIFIED_REFERENCE_REQUIRES_HUMAN_DECISION");
}
/**
 * The user's choice "save it as a draft" (W3-WERYFIKACJA, wybór b): the
 * references G8 finds unverified, named at the top of the file. Null when
 * nothing is unverified or something blocks outright.
 */
function unverifiedDraft(markedText, context) {
    const report = new FinalizationGate().evaluate(markedText, rebuildGenerationExportState(context).ledger);
    if (report.result !== "DEGRADED")
        return null;
    const claims = [...new Set(report.findings.filter((finding) => finding.status === "UNVERIFIED_MARKED").map((finding) => finding.reference.claim))];
    return {
        claims,
        ast: (ast) => ({
            ...ast,
            blocks: [
                {
                    type: "paragraph",
                    content: [{
                            type: "text",
                            text: `PROJEKT – NIE SKŁADAĆ BEZ WERYFIKACJI. Powołania niezweryfikowane w źródle: ${claims.join("; ")}.`
                        }]
                },
                ...ast.blocks
            ]
        })
    };
}
export class LocalDocumentAuthoringService {
    vaults;
    artifacts;
    states;
    renderer;
    constructor(vaults, artifacts, states, renderer = new LocalLegalDocumentRenderer()) {
        this.vaults = vaults;
        this.artifacts = artifacts;
        this.states = states;
        this.renderer = renderer;
    }
    async aliasManifest(args) {
        const unique = [
            ...new Set(args
                .sourceDocumentIds)
        ];
        if (unique.length > 99 ||
            unique.some((documentId) => !/^doc_[a-f0-9]{24}$/
                .test(documentId))) {
            throw new Error("GENERATION_SOURCE_DOCUMENTS_INVALID");
        }
        const sharedMembers = this.vaults.sharedMembers
            ? await this.vaults.sharedMembers({
                caseId: args.caseId,
                caseDataKey: args.caseDataKey,
                keyVersion: args.keyVersion
            })
            : new Set();
        const documents = [];
        for (const documentId of unique) {
            documents.push({
                documentId,
                shared: sharedMembers.has(documentId),
                vault: await this.vaults
                    .loadDocumentVault({
                    caseId: args.caseId,
                    documentId,
                    caseDataKey: args.caseDataKey,
                    keyVersion: args.keyVersion
                })
            });
        }
        return buildGenerationAliases(documents);
    }
    async createTokenized(args) {
        const aliases = await this.aliasManifest({
            caseId: args.caseId,
            sourceDocumentIds: args
                .sourceDocumentIds,
            caseDataKey: args.caseDataKey,
            keyVersion: args.keyVersion
        });
        const validated = validateLegalDocumentAst(args.ast, aliases.entries);
        // STRIP-VER-GATE: the file carries the provisions, not their markers.
        const draft = args.acceptUnverified
            ? unverifiedDraft(legalDocumentPlainText(validated.ast), args.validationContext)
            : null;
        const stripped = stripAstVerificationMarkers(validated.ast).ast;
        const documentAst = draft ? draft.ast(stripped) : stripped;
        const rendered = await this.renderer
            .render(args.format, documentAst);
        try {
            const validation = await this.renderer
                .validate(args.format, rendered.data);
            const astText = legalDocumentPlainText(documentAst);
            if (validation.text
                .replace(/\s+/g, " ")
                .trim() !==
                rendered.text
                    .replace(/\s+/g, " ")
                    .trim() ||
                !validated
                    .aliasesUsed
                    .every((alias) => validation.text
                    .includes(alias)) ||
                !astText) {
                throw new Error("TOKENIZED_DOCUMENT_VALIDATION_FAILED");
            }
            const tokenizedSha256 = createHash("sha256")
                .update(rendered.data)
                .digest("hex");
            const vaultGeneration = await this.vaults
                .getGeneration({
                caseId: args.caseId,
                caseDataKey: args.caseDataKey,
                keyVersion: args.keyVersion
            });
            if (vaultGeneration < 1) {
                throw new Error("GENERATION_VAULT_EMPTY");
            }
            const ext = args.format;
            const artifact = await this.artifacts
                .saveArtifact({
                caseId: args.caseId,
                filename: args.filename ??
                    `document-tokenized.${ext}`,
                mediaType: args.format ===
                    "docx"
                    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    : "application/vnd.oasis.opendocument.text",
                data: rendered.data,
                caseDataKey: args.caseDataKey,
                keyVersion: args.keyVersion,
                sensitivity: "PROTECTED",
                createdByUserId: args
                    .createdByUserId
            });
            await this.states
                .saveTokenized({
                state: {
                    schemaVersion: 1,
                    caseId: args.caseId,
                    artifactId: artifact
                        .artifactId,
                    format: args.format,
                    state: "TOKENIZED_VALIDATED",
                    tokenizedSha256,
                    vaultGeneration,
                    caseKeyVersion: args.keyVersion,
                    deanonymizationKeyBinding: privacyVaultDeanonymizationKeyBinding({
                        caseId: args.caseId,
                        caseDataKey: args.caseDataKey,
                        keyVersion: args.keyVersion
                    }),
                    ...(validated.ast.documentType ===
                        "pleading"
                        ? {
                            workflowRequirement: "PROCESS_PLEADING_FINAL"
                        }
                        : {}),
                    ...(args.processDocumentStatus ? { processDocumentStatus: args.processDocumentStatus } : {}),
                    ...(draft ? { unverifiedAccepted: draft.claims } : {}),
                    createdAt: new Date()
                        .toISOString()
                },
                aliases,
                validation: args.validationContext,
                caseDataKey: args.caseDataKey
            });
            return {
                artifact,
                format: args.format,
                tokenizedSha256,
                vaultGeneration,
                aliases,
                aliasesUsed: validated
                    .aliasesUsed,
                text: rendered.text,
                deanonymizationKeyBound: true,
                warnings: documentCompletenessWarnings(documentAst, rendered.text)
            };
        }
        finally {
            rendered.data.fill(0);
        }
    }
    async createReady(args) {
        const validated = validateLegalDocumentAst(args.ast, []);
        if (validated
            .aliasesUsed
            .length > 0) {
            throw new Error("READY_DOCUMENT_PII_ALIAS_FORBIDDEN");
        }
        // G8 reads the markers; the court gets the document without them.
        const markedText = legalDocumentPlainText(validated.ast);
        const draft = args.acceptUnverified
            ? unverifiedDraft(markedText, args.validationContext)
            : null;
        const stripped = stripAstVerificationMarkers(validated.ast).ast;
        const documentAst = draft ? draft.ast(stripped) : stripped;
        const rendered = await this.renderer
            .render(args.format, documentAst);
        try {
            const validation = await this.renderer
                .validate(args.format, rendered.data);
            const astText = legalDocumentPlainText(documentAst);
            if (validation.aliases !==
                0 ||
                validation.text
                    .replace(/\s+/g, " ")
                    .trim() !==
                    rendered.text
                        .replace(/\s+/g, " ")
                        .trim() ||
                !astText) {
                throw new Error("READY_DOCUMENT_VALIDATION_FAILED");
            }
            const hybrid = validateLocalHybridDocument(validation.text, args.validationContext);
            if (hybrid.result !==
                "PASS") {
                throw new Error("READY_DOCUMENT_HYBRID_BLOCKED:" +
                    hybrid.reasons
                        .join(","));
            }
            const exportState = rebuildGenerationExportState(args.validationContext);
            const exportReport = new ExportGate()
                .evaluate({
                documentContent: rendered.data,
                documentText: validation.text,
                markedText,
                ...(draft ? { acceptUnverified: true } : {}),
                documentKind: args.format,
                documentSkill: args.validationContext
                    .primarySkill,
                ledger: exportState.ledger,
                audit: exportState.audit,
                hybridValidation: "PASS"
            });
            if (exportReport.result !==
                "PASS" ||
                !exportReport
                    .documentHash) {
                throw exportBlocked("READY_DOCUMENT_EXPORT_GATE_BLOCKED", exportReport);
            }
            const sha256 = createHash("sha256")
                .update(rendered.data)
                .digest("hex");
            if (sha256 !==
                exportReport
                    .documentHash) {
                throw new Error("READY_DOCUMENT_EXPORT_HASH_MISMATCH");
            }
            const artifact = await this.artifacts
                .saveArtifact({
                caseId: args.caseId,
                filename: args.filename ??
                    `LexMachina-document.${args.format}`,
                mediaType: args.format ===
                    "docx"
                    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    : "application/vnd.oasis.opendocument.text",
                data: rendered.data,
                caseDataKey: args.caseDataKey,
                keyVersion: args.keyVersion,
                sensitivity: "PROTECTED",
                createdByUserId: args
                    .createdByUserId
            });
            return {
                artifact,
                format: args.format,
                sha256,
                text: validation.text,
                warnings: documentCompletenessWarnings(documentAst, validation.text)
            };
        }
        finally {
            rendered.data.fill(0);
        }
    }
    /**
     * Checks key binding, vault generation and the tokenized hash, then resolves
     * every alias used in the document with its source and confidence.
     */
    async restorationInputs(args) {
        if (args.target
            .caseKeyVersion !==
            args.keyVersion) {
            throw new Error("GENERATION_CASE_KEY_CHANGED");
        }
        if (!args.target
            .deanonymizationKeyBinding) {
            throw new Error("GENERATION_DEANONYMIZATION_KEY_BINDING_MISSING");
        }
        const currentKeyBinding = privacyVaultDeanonymizationKeyBinding({
            caseId: args.target
                .caseId,
            caseDataKey: args.caseDataKey,
            keyVersion: args.keyVersion
        });
        const keyBindingVerified = currentKeyBinding ===
            args.target
                .deanonymizationKeyBinding;
        if (!keyBindingVerified) {
            throw new Error("GENERATION_DEANONYMIZATION_KEY_CHANGED");
        }
        const currentGeneration = await this.vaults
            .getGeneration({
            caseId: args.target
                .caseId,
            caseDataKey: args.caseDataKey,
            keyVersion: args.keyVersion
        });
        if (currentGeneration !==
            args.target
                .vaultGeneration) {
            throw new Error("GENERATION_VAULT_CHANGED");
        }
        const validationContext = await this.states
            .loadValidationContext({
            caseId: args.target
                .caseId,
            artifactId: args.target
                .artifactId,
            caseDataKey: args.caseDataKey,
            keyVersion: args.keyVersion
        });
        const aliases = await this.states
            .loadAliases({
            caseId: args.target
                .caseId,
            artifactId: args.target
                .artifactId,
            caseDataKey: args.caseDataKey,
            keyVersion: args.keyVersion
        });
        const vaults = new Map();
        for (const documentId of [
            ...new Set(aliases.entries
                .map((entry) => entry.documentId))
        ]) {
            vaults.set(documentId, await this.vaults
                .loadDocumentVault({
                caseId: args.target
                    .caseId,
                documentId,
                caseDataKey: args.caseDataKey,
                keyVersion: args.keyVersion
            }));
        }
        const replacements = resolveGenerationAliases(aliases, vaults);
        const tokenized = await this.artifacts
            .readArtifact({
            caseId: args.target
                .caseId,
            artifactId: args.target
                .artifactId,
            caseDataKey: args.caseDataKey,
            keyVersion: args.keyVersion,
            maxBytes: 64 * 1024 *
                1024
        });
        try {
            const hash = createHash("sha256")
                .update(tokenized)
                .digest("hex");
            if (hash !==
                args.target
                    .tokenizedSha256) {
                throw new Error("GENERATION_TOKENIZED_HASH_CHANGED");
            }
            const tokenizedText = (await this.renderer
                .validate(args.target
                .artifactFormat, tokenized)).text;
            const restorations = describeGenerationAliases(tokenizedText, aliases, vaults);
            return {
                validationContext,
                replacements,
                tokenized,
                tokenizedText,
                keyBindingVerified,
                restorations
            };
        }
        catch (error) {
            tokenized.fill(0);
            throw error;
        }
    }
    /** Restored text with every restored value marked, for review before finalizing. */
    async previewDeanonymization(args) {
        const inputs = await this.restorationInputs(args);
        inputs.tokenized.fill(0);
        return renderRestorationPreview(inputs.tokenizedText, inputs.restorations);
    }
    async deanonymizeConsumed(args) {
        const { validationContext, replacements, tokenized, restorations, keyBindingVerified } = await this.restorationInputs(args);
        try {
            applyRestorationOverrides(replacements, restorations, args.overrides);
            const finalPackage = await this.renderer
                .deanonymize(args.target
                .artifactFormat, tokenized, replacements);
            try {
                const validation = await this.renderer
                    .validate(args.target
                    .artifactFormat, finalPackage
                    .data);
                if (validation.aliases !==
                    0 ||
                    /\[(?:LMPII|PII):[^\]]+\]/
                        .test(validation.text)) {
                    throw new Error("FINAL_DOCUMENT_TOKEN_RESIDUE");
                }
                const hybrid = validateLocalHybridDocument(validation.text, validationContext);
                if (hybrid.result !==
                    "PASS") {
                    throw new Error("FINAL_DOCUMENT_HYBRID_BLOCKED:" +
                        hybrid.reasons
                            .join(","));
                }
                const exportState = rebuildGenerationExportState(validationContext);
                // A draft saved with its unverified references named stays one.
                const stored = await this.states.readState(args.target.caseId, args.target.artifactId);
                const exportReport = new ExportGate()
                    .evaluate({
                    ...(stored?.unverifiedAccepted?.length ? { acceptUnverified: true } : {}),
                    documentContent: finalPackage
                        .data,
                    documentText: validation.text,
                    documentKind: args.target
                        .artifactFormat,
                    documentSkill: validationContext
                        .primarySkill,
                    ledger: exportState
                        .ledger,
                    audit: exportState
                        .audit,
                    hybridValidation: "PASS"
                });
                if (exportReport.result !==
                    "PASS" ||
                    !exportReport
                        .documentHash) {
                    throw exportBlocked("FINAL_DOCUMENT_EXPORT_GATE_BLOCKED", exportReport);
                }
                const sha256 = createHash("sha256")
                    .update(finalPackage
                    .data)
                    .digest("hex");
                if (sha256 !==
                    exportReport
                        .documentHash) {
                    throw new Error("FINAL_DOCUMENT_EXPORT_HASH_MISMATCH");
                }
                const format = args.target
                    .artifactFormat;
                const artifact = await this.artifacts
                    .saveArtifact({
                    caseId: args.target
                        .caseId,
                    filename: args.filename ??
                        `document-final.${format}`,
                    mediaType: format ===
                        "docx"
                        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        : "application/vnd.oasis.opendocument.text",
                    data: finalPackage
                        .data,
                    caseDataKey: args.caseDataKey,
                    keyVersion: args.keyVersion,
                    sensitivity: "CLEAR_PII",
                    createdByUserId: args
                        .createdByUserId,
                    sourceArtifactId: args.target
                        .artifactId
                });
                await this.states
                    .markFinalized({
                    caseId: args.target
                        .caseId,
                    artifactId: args.target
                        .artifactId,
                    finalArtifactId: artifact
                        .artifactId,
                    finalSha256: sha256
                });
                return {
                    artifact,
                    format,
                    sha256,
                    text: validation.text,
                    replacements: finalPackage
                        .replaced ?? 0,
                    deanonymizationBasis: "PRIVACY_VAULT_KEY",
                    keyBindingVerified,
                    restorations: restorations.map((item) => args.overrides?.[item.alias] !== undefined
                        ? { ...item, text: replacements.get(item.alias), source: "manual", confidence: 1, status: "ok" }
                        : item)
                };
            }
            finally {
                finalPackage
                    .data.fill(0);
            }
        }
        finally {
            tokenized.fill(0);
        }
    }
}
