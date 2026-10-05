import { compactForModel, laterTurn, reachedStages } from "./skill-sections.js";
import { decodePromptBudget } from "./prompt-budget.js";
import { FinalizationGate, addMissingVerificationMarkers, markUnverifiedReferences } from "./finalization-gate.js";
import { verificationSourceLink } from "./source-anchor.js";
import { evaluateStatusConsistency, reconcileStatusMarkers, stripUnbackedVerificationMarkers } from "./status-consistency-gate.js";
import { genericWords } from "./privacy/generic-words.js";
import { compactActAbbreviations } from "./legal-act-abbreviations.js";
import { exampleDataKeepDirectives } from "./privacy/example-data.js";
import { placeholderGrammar, partyGroups, placeholderKeyPrompt } from "./privacy/token-legend.js";
import { coreLawRetrievalPrompt } from "./core-law-tool-runtime.js";
import { restoreWithReport } from "./privacy/restoration-report.js";
import { AuditTrail } from "./audit-trail.js";
import { AuditedFinalizer } from "./audited-finalizer.js";
import { LexExecutionEngine, latestUserTurn, isTrivialChatCommand } from "./execution-engine.js";
import { VerificationLedger } from "./verification-ledger.js";
import { coreLawEliCaution } from "./core-law-index.js";
import { CoreLawToolRuntime } from "./core-law-tool-runtime.js";
import { LegalCorpusToolRuntime } from "./legal-corpus-tool-runtime.js";
import { WidgetToolRuntime } from "./widget-runtime.js";
import { CaseFileToolRuntime } from "./case-file-tool-runtime.js";
import { revalidateThreadEvidence, threadEvidencePrompt } from "./thread-evidence.js";
import { MAX_SUMMARY_CHARS } from "./thread-summary.js";
import fs from "node:fs";
import path from "node:path";
import { ROUTER_SKILL, evaluateMandatoryPath, gateCorrectionPrompt, loadMandatoryPathModel, mandatoryPathInstructions, missingGateBlocks, pathProfile, preloadForTurn, routingTrace } from "./mandatory-path.js";
import { queryModePrompt } from "./query-mode.js";
import { meterUsage } from "./providers/usage-meter.js";
import { ReportBlueprintToolRuntime } from "./report-blueprint-tool-runtime.js";
import { evaluateDeterministicWorkflowOutput, evaluateDeterministicWorkflowReads } from "./deterministic-workflow.js";
import { documentCitationSystemPrompt, processDocumentCitationMarkers } from "./document-citations.js";
import { orchestrateDocumentContext } from "./context-orchestrator.js";
import { evaluateGuideOutput } from "./guide-session-state.js";
import { evaluateGateIInvariants } from "./gate-i-invariants.js";
import { blockGateITurn, createGateITurnState, passGateITurnPhase } from "./gate-i-turn-state.js";
import { evaluateModelTaskOwnershipGate, resolveReferencePreflightOwnership } from "./model-task-ownership.js";
import { detectLegalReferences } from "./finalization-gate.js";
import { checkProvisionsAtEventDates, eventDates } from "./event-date-check.js";
import { parseDisclaimer, splitTrailingDisclaimer, withDisclaimer } from "./legal-disclaimer.js";
import { criminalMatter } from "./matter-signals.js";
import { classifyDocument, recognisedDocumentsPrompt } from "./document-kind.js";
import { ANALYSIS_INTENT, classifyTask, decideTask, parseActivationMatrix, parseCombinations, parseRedactionTest, parseRoutingTable, pipelineNext } from "./task-routing.js";
import { CONTRACT_BUDGET_CHARS, contractPrompt, executiveContract, loadContract } from "./executive-skill-contract.js";
import { loadModules, modulesPrompt, schemaCatalog, skillModules } from "./skill-module-map.js";
import { domainHintPrompt, parseFlashRouting, rankDomains } from "./domain-module-map.js";
import { actModulesPrompt, loadActModules, resolveActModulesWithChecks } from "./act-map-resolver.js";
import { applyAutomaticVerificationMarkers, releaseModelUnverifiedMarkers, detectHistoricalAsOf, planAutomaticLegalVerification } from "./gate-i-auto-verification.js";
import { runGateIRuntimePrelude } from "./gate-i-runtime-prelude.js";
import { evaluateGateIInputCompleteness, evaluateGateIWorkflowContract, gateIWorkflowContract } from "./gate-i-contracts.js";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "./privacy/pseudonymizer.js";
import { ModelAutoRouter } from "./model-auto-routing.js";
import { privacyRecognizerFor } from "./privacy/local-llm-ner.js";
import { parseSkillSelectionEnvelope, threadUserText } from "./skill-selection.js";
const CRIMINAL_QUALIFIER_RESOURCE = "dr-03-prawo-karne-wykroczenia-egzekucja/modules/mod-KK-kwalifikator-karnomaterialny.md";
// Skills in the corpus under one base name in several versions ("x-v1", "x-v2").
// Host CLI thread per matter (Claude --resume, Codex resume): off unless LEX_ACCOUNT_RESUME=1.
export function resumeHostThread(env = process.env) {
    return env.LEX_ACCOUNT_RESUME === "1";
}
function duplicateSkills(names) {
    const byBase = new Map();
    for (const name of names) {
        const base = name.replace(/-v\d+$/u, "");
        byBase.set(base, [...(byBase.get(base) ?? []), name]);
    }
    return [...byBase.values()].filter((group) => group.length > 1).map((group) => group.sort().join(" i "));
}
export function publicAuxiliarySourceFromToolResult(result) {
    let payload;
    try {
        payload =
            JSON.parse(result.content);
    }
    catch {
        return null;
    }
    if (!payload ||
        typeof payload !==
            "object") {
        return null;
    }
    const value = payload;
    const candidate = value.candidate;
    const assessment = value.assessment;
    const tier = candidate?.tier;
    if (value.status !== "OK" ||
        assessment
            ?.auxiliaryOnly !==
            true ||
        typeof candidate
            ?.url !== "string" ||
        (tier !== "R2B" &&
            tier !== "R3") ||
        (value.classification !==
            "KNOWN_DOMAIN" &&
            value.classification !==
                "CONSERVATIVE_R3") ||
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
            "string") {
        return null;
    }
    const crossCheckStatus = candidate
        .crossCheckStatus;
    if (crossCheckStatus !==
        "NOT_REQUIRED" &&
        crossCheckStatus !==
            "PENDING" &&
        crossCheckStatus !==
            "CONFIRMED_R1_R2A" &&
        crossCheckStatus !==
            "CONFLICT" &&
        crossCheckStatus !==
            "UNAVAILABLE") {
        return null;
    }
    return {
        ...(typeof candidate
            .claim === "string" &&
            candidate.claim.trim()
            ? {
                claim: candidate.claim
                    .trim()
            }
            : {}),
        sourceUrl: candidate.url,
        sourceTier: tier,
        classification: value
            .classification,
        classificationBasis: candidate
            .provenance
            .classificationBasis,
        crossCheckStatus,
        ...(typeof candidate
            .crossCheckUrl ===
            "string"
            ? {
                crossCheckUrl: candidate
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
                crossCheckTier: candidate
                    .crossCheckTier
            }
            : {}),
        ...(typeof candidate
            .provenance
            .publishedAt ===
            "string"
            ? {
                publishedAt: candidate
                    .provenance
                    .publishedAt
            }
            : {}),
        ...(typeof candidate
            .provenance
            .updatedAt ===
            "string"
            ? {
                updatedAt: candidate
                    .provenance
                    .updatedAt
            }
            : {}),
        staleOrUndatedWarning: assessment
            .staleOrUndatedWarning,
        higherTierCrossCheckSatisfied: assessment
            .higherTierCrossCheckSatisfied,
        conflict: assessment.conflict,
        instruction: assessment.instruction
    };
}
function normalizedAuxiliaryClaim(value) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase("pl")
        .replace(/\s+/gu, " ")
        .trim();
}
export function reconcileAuxiliarySourcesWithVerification(sources, records) {
    return sources.map((source) => {
        if (!source.claim ||
            source.conflict) {
            return {
                ...source
            };
        }
        const claim = normalizedAuxiliaryClaim(source.claim);
        const verified = [...records]
            .reverse()
            .find((record) => normalizedAuxiliaryClaim(record.claim) === claim &&
            (record.status ===
                "VERIFIED" ||
                record.status ===
                    "SUPPORTED") &&
            (record.sourceTier ===
                "R1" ||
                record.sourceTier ===
                    "R2A") &&
            Boolean(record.sourceUrl
                ?.trim()));
        if (!verified ||
            !verified.sourceUrl ||
            (verified.sourceTier !==
                "R1" &&
                verified.sourceTier !==
                    "R2A")) {
            return {
                ...source,
                crossCheckStatus: source.crossCheckStatus ===
                    "NOT_REQUIRED"
                    ? "NOT_REQUIRED"
                    : "PENDING",
                higherTierCrossCheckSatisfied: false
            };
        }
        return {
            ...source,
            crossCheckStatus: "CONFIRMED_R1_R2A",
            crossCheckUrl: verified.sourceUrl,
            crossCheckTier: verified.sourceTier,
            higherTierCrossCheckSatisfied: true
        };
    });
}
// "art. 233 § 1 KK" next to "art. 233 KK" from the same place of the same
// source is one entry: the article is listed, its unit is not repeated.
function withoutRepeatedUnits(records) {
    const key = (claim) => compactActAbbreviations(claim).toLocaleLowerCase("pl").replace(/\s+/g, " ").trim();
    const parts = (claim) => /^art\.?\s*(\d+[a-ząćęłńóśźż]*)(.*?)\s+(kc|kpc|kk|kpk|kpa|kp|kro|ksh|kw|kpw|pzp)$/u.exec(key(claim));
    const latest = new Map();
    for (const record of records) {
        const id = `${record.kind}\u0000${key(record.claim)}\u0000${record.asOf ?? ""}`;
        latest.delete(id);
        latest.set(id, record);
    }
    const unique = [...latest.values()];
    return unique.filter((record) => {
        if (record.kind !== "statute" || record.status !== "VERIFIED")
            return true;
        const unit = parts(record.claim);
        if (!unit || !unit[2].trim())
            return true;
        return !unique.some((other) => {
            const article = other.kind === "statute" && other.status === "VERIFIED" ? parts(other.claim) : null;
            return (article !== null &&
                !article[2].trim() &&
                article[1] === unit[1] &&
                article[3] === unit[3] &&
                (other.asOf ?? "") === (record.asOf ?? "") &&
                verificationSourceLink(other) === verificationSourceLink(record));
        });
    });
}
// Wiersze bloków CN/WYJ/REM-GATE: nagłówek, CN-n, REM-n, „Oś n:”, „Art. X: S1 —”.
const GATE_LINE = /^\s*(?:(?:CN|WYJ|REM)-GATE\b|CN-\d|REM-\d|Oś \d+:|[^:\n]{0,80}:\s*S1\s*[—–-])/u;
function articleKey(claim) {
    const article = /art\.\s*(\d+[a-z]*)/iu.exec(claim);
    const act = claim.trim().split(/\s+/u).at(-1);
    return article && act ? `${article[1].toLocaleLowerCase("pl")} ${act.toLocaleLowerCase("pl")}` : null;
}
// Przepisy zweryfikowane przez model tylko na potrzeby bramek (sąsiednie
// artykuły z WYJ-GATE S1/S2), których odpowiedź nie powołuje poza blokami bramek.
export function gateOnlyStatutes(answer) {
    const lines = answer.split(/\r?\n/u);
    const inGate = new Set();
    const outside = new Set();
    for (const reference of detectLegalReferences(answer)) {
        if (reference.kind !== "statute")
            continue;
        const key = articleKey(reference.claim);
        if (!key)
            continue;
        (GATE_LINE.test(lines[reference.line - 1] ?? "") ? inGate : outside).add(key);
    }
    return new Set([...inGate].filter((key) => !outside.has(key)));
}
export function publicEvidenceBundle(records, answer) {
    const gateOnly = answer ? gateOnlyStatutes(answer) : new Set();
    const items = withoutRepeatedUnits(records).map((record) => ({
        ...(record.kind === "statute" && gateOnly.has(articleKey(record.claim) ?? "")
            ? { role: "gate" }
            : {}),
        claim: record.claim,
        kind: record.kind,
        status: record.status,
        ...(record.sourceUrl ? { sourceUrl: record.sourceUrl } : {}),
        ...(verificationSourceLink(record) !== record.sourceUrl
            ? { sourceAnchorUrl: verificationSourceLink(record) }
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
    return [...items.filter((item) => !item.role), ...items.filter((item) => item.role)];
}
export const SESSION_EXECUTION_INTERNAL = Symbol("LEX_SESSION_EXECUTION_INTERNAL");
/**
 * Prefixes D01, D02... of own-key documents, in the order they reach the
 * model (context first, then case files read by tools). Shared-key documents
 * get none: their tokens are the chat's. Restoring an alias reads the
 * document id at position n-1 of documentIds().
 */
export class DocumentAliasRegistry {
    prefixes = new Map();
    prefixFor(documentId) {
        const existing = this.prefixes.get(documentId);
        if (existing)
            return existing;
        const prefix = "D" + String(this.prefixes.size + 1).padStart(2, "0");
        this.prefixes.set(documentId, prefix);
        return prefix;
    }
    documentIds() {
        return [...this.prefixes.keys()];
    }
}
export function namespaceChunkTokens(text, prefix) {
    return text.replace(/\[PII:([A-Z_]+):(\d{4})\]/g, (_token, kind, sequence) => `[LMPII:${prefix}:${kind}:${sequence}]`);
}
export function namespaceDocumentAttachmentTokens(attachments, registry = new DocumentAliasRegistry()) {
    const prefixFor = (documentId) => registry.prefixFor(documentId);
    return attachments.map((attachment) => {
        if (attachment.sharedKey) {
            return { ...attachment, chunks: attachment.chunks.map((chunk) => ({ ...chunk })) };
        }
        const prefix = prefixFor(attachment.documentId);
        return {
            ...attachment,
            ...(attachment.grammar
                ? {
                    grammar: attachment.grammar.map((entry) => ({
                        ...entry,
                        token: entry.token.replace(/^\[PII:/, `[LMPII:${prefix}:`),
                        ...(entry.owner ? { owner: entry.owner.replace(/^\[PII:/, `[LMPII:${prefix}:`) } : {})
                    }))
                }
                : {}),
            chunks: attachment.chunks.map((chunk) => ({
                ...chunk,
                text: namespaceChunkTokens(chunk.text, prefix)
            }))
        };
    });
}
/**
 * Stored page headers ("[STRONA 3 · CZĘŚĆ 1/2 · OCR]") as an explicit page
 * boundary with the page count, so a model knows how long the document is
 * and where each page starts.
 */
export function markPages(text, totalPages) {
    return text.replace(/^\[STRONA (\d+)(?: · CZĘŚĆ (\d+)\/(\d+))? · ([A-Z]+)\]$/gm, (_header, page, part, parts, source) => `=== STRONA ${page}${totalPages ? `/${totalPages}` : ""}` +
        (part && part !== "1" ? ` (ciąg dalszy, część ${part}/${parts})` : part ? ` (część ${part}/${parts})` : "") +
        (source === "OCR" ? " · tekst z OCR" : source === "BLANK" ? " · pusta" : "") +
        " ===");
}
// At most this many images per message, and this much image data.
export const MAX_EVIDENCE_IMAGES = 20;
const MAX_EVIDENCE_BASE64 = 20 * 1024 * 1024;
/** Images of the pages whose chunks made it into the context, in order. */
export function selectEvidenceImages(requested, inContext) {
    const selected = [];
    let size = 0;
    for (const attachment of inContext) {
        const source = requested.find((item) => item.documentId === attachment.documentId && item.images?.length);
        if (!source?.images)
            continue;
        for (const image of source.images) {
            const covered = attachment.chunks.some((chunk) => chunk.pageStart <= image.page && image.page <= chunk.pageEnd);
            if (!covered || selected.length >= MAX_EVIDENCE_IMAGES || size + image.data.length > MAX_EVIDENCE_BASE64)
                continue;
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
function buildDocumentContext(attachments, images = []) {
    const sections = attachments.map((attachment) => {
        const chunks = attachment.chunks.map((chunk) => {
            const sourceLabel = attachment.sourceScope === "FIRM_TEMPLATE"
                ? "WZÓR KANCELARII"
                : attachment.sourceScope === "FIRM_KNOWLEDGE"
                    ? "KNOW-HOW KANCELARII"
                    : attachment.sourceScope === "CASE_KNOWLEDGE"
                        ? "CASE KNOWLEDGE"
                        : "DOCUMENT";
            const representation = chunk.representation ===
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
    const firm = attachments.some((attachment) => attachment.sourceScope === "FIRM_TEMPLATE" || attachment.sourceScope === "FIRM_KNOWLEDGE");
    const imageIndex = images.length
        ? [
            EVIDENCE_IMAGE_NOTE,
            ...images.map((image, index) => `[OBRAZ ${index + 1}: ${image.documentId} · STRONA ${image.page} · zamaskowane obszary: ${image.masked}]`)
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
function transferExecutionEvents(events, audit) {
    for (const event of events) {
        if (event.type === "skill_read" ||
            event.type === "resource_read" ||
            event.type === "route" ||
            event.type === "provider_start" ||
            event.type === "provider_end" ||
            event.type === "gate") {
            audit.record(event.type, event.target, event.status === "BLOCKED" ? "BLOCKED" : "OK", event.detail ? { detail: event.detail } : undefined);
        }
    }
}
const DRAFT_PII_TOKEN = /\[PII:([A-Z_]+):(\d{4})(?:\|([A-Z]{2,4}))?\]/g;
// An incomplete token at the end of the stream is held back until complete.
const DRAFT_PARTIAL_TOKEN_TAIL = /\[(?:P(?:I(?:I(?::[A-Z_]*(?::\d{0,4}(?:\|[A-Z]{0,4})?)?)?)?)?)?$/;
export function createDraftCallbacks(vault, onDraft) {
    let raw = "";
    const publish = () => {
        const visible = raw.replace(DRAFT_PARTIAL_TOKEN_TAIL, "");
        onDraft(visible.replace(DRAFT_PII_TOKEN, (token, kind, sequence, requestedCase) => {
            const base = `[PII:${kind}:${sequence}]`;
            return vault.hasToken(base)
                ? vault.restore(base, requestedCase ?? null).text
                : token;
        }));
    };
    return {
        onContentDelta: (text) => {
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
export const THREAD_SUMMARY_PROMPT = [
    "Jesteś asystentem Lex Machina. Tworzysz streszczenie wcześniejszej części rozmowy w sprawie, które zastąpi te wiadomości w kontekście kolejnych odpowiedzi.",
    "Układ (nagłówki dokładnie takie): ## Fakty, ## Stanowiska stron, ## Ustalenia prawne, ## Dokumenty i dowody, ## Otwarte kwestie.",
    "- Tylko to, co jest w rozmowie; nic nie dopisuj, nie oceniaj na nowo i nie rozstrzygaj.",
    "- Ustalenia prawne: przepis z oznaczeniem aktu tak, jak w rozmowie. Nie przepisuj znaczników weryfikacji i nie podawaj brzmienia przepisów; status nada aplikacja z rejestru weryfikacji.",
    "- Symbole [PII:...] przepisuj dokładnie; nie zgaduj, kto się pod nimi kryje.",
    "- Jeśli jest dotychczasowe streszczenie, zaktualizuj je o nowe wiadomości i zachowaj jego poprawki (mogła je wprowadzić osoba prowadząca sprawę).",
    "- Najwyżej ok. 6000 znaków; zwięźle, w punktach."
].join("\n");
export class SafeSessionExecutor {
    registry;
    providers;
    finalizer;
    verificationToolFactory;
    chatNamedEntityRecognizer;
    legalFederationTools;
    coreLawIndex;
    personMorphology;
    actFreshness;
    engine;
    autoRouter;
    constructor(registry, providers, finalizer = new AuditedFinalizer(), verificationToolFactory, chatNamedEntityRecognizer, legalFederationTools, coreLawIndex, personMorphology, 
    // Current consolidated text of an act in Sejm ELI (evidence memory reuse).
    actFreshness) {
        this.registry = registry;
        this.providers = providers;
        this.finalizer = finalizer;
        this.verificationToolFactory = verificationToolFactory;
        this.chatNamedEntityRecognizer = chatNamedEntityRecognizer;
        this.legalFederationTools = legalFederationTools;
        this.coreLawIndex = coreLawIndex;
        this.personMorphology = personMorphology;
        this.actFreshness = actFreshness;
        this.engine = new LexExecutionEngine(registry, providers);
        this.autoRouter =
            new ModelAutoRouter(registry, providers);
    }
    mandatoryModelCache = null;
    // Corpus files of the mandatory path, by canonical path (router-relative or skill-qualified).
    readCorpus(resource) {
        const relative = resource.startsWith(`${ROUTER_SKILL}/`) ? resource.slice(ROUTER_SKILL.length + 1) : resource;
        const resolved = this.registry.resolveResource(ROUTER_SKILL, relative);
        if (!resolved)
            return null;
        try {
            return fs.readFileSync(resolved, "utf8");
        }
        catch {
            return null;
        }
    }
    taskRoutesCache = null;
    // The router's KROK 2 table, re-read after a skill update.
    taskRoutes() {
        if (this.taskRoutesCache?.root === this.registry.root)
            return this.taskRoutesCache.routes;
        const routes = parseRoutingTable(this.readCorpus(`${ROUTER_SKILL}/SKILL.md`) ?? "");
        this.taskRoutesCache = { root: this.registry.root, routes };
        return routes;
    }
    flashRoutesCache = null;
    // prawo-polskie-v2 "Routing błyskawiczny", re-read after a skill update.
    flashRoutes() {
        if (this.flashRoutesCache?.root === this.registry.root)
            return this.flashRoutesCache.rows;
        const rows = parseFlashRouting(this.readCorpus("prawo-polskie-v2/SKILL.md") ?? "");
        this.flashRoutesCache = { root: this.registry.root, rows };
        return rows;
    }
    combinationsCache = null;
    skillCombinations() {
        if (this.combinationsCache?.root === this.registry.root)
            return this.combinationsCache.rows;
        const rows = parseCombinations(this.readCorpus("shared/ACTIVATION-MATRIX.md") ?? "");
        this.combinationsCache = { root: this.registry.root, rows };
        return rows;
    }
    redactionCache = null;
    // pisma-procesowe-v3 KROK 0 Test A (editing a finished pleading), from the corpus.
    redactionTest() {
        if (this.redactionCache?.root === this.registry.root)
            return this.redactionCache.test;
        const record = this.registry.get("pisma-procesowe-v3");
        let test = null;
        try {
            test = record ? parseRedactionTest(fs.readFileSync(record.skillFile, "utf8")) : null;
        }
        catch {
            test = null;
        }
        this.redactionCache = { root: this.registry.root, test };
        return test;
    }
    activationMatrixCache = null;
    // shared/ACTIVATION-MATRIX.md, re-read after a skill update.
    activationMatrix() {
        if (this.activationMatrixCache?.root === this.registry.root)
            return this.activationMatrixCache.rules;
        const rules = parseActivationMatrix(this.readCorpus("shared/ACTIVATION-MATRIX.md") ?? "");
        this.activationMatrixCache = { root: this.registry.root, rules };
        return rules;
    }
    mandatoryModel() {
        if (this.mandatoryModelCache?.root === this.registry.root)
            return this.mandatoryModelCache.model;
        try {
            const model = loadMandatoryPathModel((resource) => this.readCorpus(resource));
            this.mandatoryModelCache = { root: this.registry.root, model };
            return model;
        }
        catch {
            return null;
        }
    }
    /**
     * Summary of older thread messages: the text goes to the model
     * pseudonymized like a chat message, without tools; provisions in the
     * summary get their status from the verification registry only (reused
     * evidence after the ELI check, otherwise NIEWERYFIKOWANE).
     */
    async summarizeThread(request) {
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
            for (const record of (await revalidateThreadEvidence(request.threadEvidence, this.actFreshness)).reused)
                ledger.add(record);
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
    chatRecognizerFor(model) {
        return this.chatNamedEntityRecognizer
            ? privacyRecognizerFor(this.chatNamedEntityRecognizer, !model.startsWith("local/"))
            : undefined;
    }
    async resolveAutoRouting(request) {
        const vault = new PseudonymizationVault(request.privacySeed);
        const pseudonymizer = new LocalPolishPseudonymizer(vault, this.chatRecognizerFor(request.model), this.personMorphology);
        let protectedQuery;
        try {
            protectedQuery =
                (await pseudonymizer
                    .pseudonymize(request.query)).text;
        }
        catch {
            throw new Error("CHAT_PRIVACY_GATE_FAILED");
        }
        const routed = await this.autoRouter
            .resolve({
            query: protectedQuery,
            provider: request.provider,
            model: request.model,
            ...(request.matterComplexity
                ? { matterComplexity: request.matterComplexity }
                : {})
        });
        // Keep the user's original text for the actual execution. Only the
        // model-selected routing envelope is copied from the protected prepass.
        const originalEnvelope = parseSkillSelectionEnvelope(request.query);
        const firstBreak = routed.query.indexOf("\n");
        const routingHeader = firstBreak >= 0
            ? routed.query.slice(0, firstBreak)
            : routed.query;
        return {
            decision: routed.decision,
            query: routingHeader +
                "\n" +
                originalEnvelope.query
        };
    }
    async execute(request) {
        // Tokens of every model call in this turn (benchmark and cost display).
        const { result, usage } = await meterUsage(() => this.executeTurn(request));
        result.usage = usage;
        return result;
    }
    async executeTurn(request) {
        const step = request.onStep ?? (() => undefined);
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
        const chatPrivacyVault = new PseudonymizationVault(request.privacySeed);
        const chatPseudonymizer = new LocalPolishPseudonymizer(chatPrivacyVault, this.chatRecognizerFor(request.model), this.personMorphology);
        let protectedQuery;
        let protectedProcessContext = request.processWorkflowContext;
        let protectedAuxiliaryText;
        try {
            // Example data the assistant wrote earlier (a model letter) stays as written.
            const exampleData = /(?:^|\n\n)Asystent: /.test(request.query)
                ? exampleDataKeepDirectives(request.query, (await new LocalPolishPseudonymizer(new PseudonymizationVault(request.privacySeed), this.chatRecognizerFor(request.model), this.personMorphology).pseudonymize(request.query)).findings, request.auxiliaryText ?? "", request.threadEvidence?.realValueHashes ? new Set(request.threadEvidence.realValueHashes) : null)
                : [];
            const protectedPrimary = await chatPseudonymizer
                .pseudonymize(request.query, exampleData);
            protectedQuery =
                protectedPrimary.text;
            if (request.auxiliaryText !==
                undefined &&
                request.auxiliaryText !==
                    request.query) {
                protectedAuxiliaryText =
                    (await chatPseudonymizer
                        .pseudonymize(request.auxiliaryText)).text;
            }
            else if (request.auxiliaryText !==
                undefined) {
                protectedAuxiliaryText =
                    protectedQuery;
            }
            // The stored pleading draft and remarks reach the model like the chat text:
            // pseudonymized with the same vault (restored in the answer).
            if (request.processWorkflowContext?.draft || request.processWorkflowContext?.remarks) {
                const context = request.processWorkflowContext;
                protectedProcessContext = {
                    ...context,
                    ...(context.draft
                        ? { draft: { ...context.draft, text: (await chatPseudonymizer.pseudonymize(context.draft.text)).text } }
                        : {}),
                    ...(context.remarks ? { remarks: (await chatPseudonymizer.pseudonymize(context.remarks)).text } : {})
                };
            }
            audit.record("gate", "G39I_CHAT_PRIVACY", "OK", {
                pseudonymized: protectedPrimary
                    .findings.length,
                exampleDataKept: exampleData.length,
                kinds: Object.keys(protectedPrimary
                    .counts).sort(),
                vaultTokens: chatPrivacyVault
                    .size
            });
        }
        catch (error) {
            audit.record("gate", "G39I_CHAT_PRIVACY", "BLOCKED", {
                error: error instanceof Error
                    ? error.message
                    : String(error)
            });
            audit.close("BLOCKED", {
                finalization: "PRIVACY_GATE"
            });
            throw new Error("CHAT_PRIVACY_GATE_FAILED");
        }
        const requestedHistoricalAsOf = detectHistoricalAsOf(protectedQuery);
        const ledger = new VerificationLedger();
        // Evidence memory: provisions verified in earlier messages are reused only
        // when ELI still has the same consolidated text and no amendment after it.
        let evidencePrompt = null;
        const memory = request.threadEvidence;
        if (memory &&
            !request.model.startsWith("local/") &&
            (memory.provisions.length || memory.sources.length || memory.skills.length || memory.lastPath)) {
            const reuse = this.actFreshness
                ? await revalidateThreadEvidence(memory, this.actFreshness)
                : { reused: [], recheck: memory.provisions.map((record) => ({ claim: record.claim, reason: "ELI_CHECK_UNAVAILABLE" })) };
            for (const record of reuse.reused)
                ledger.add(record);
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
        const corpusTools = new LegalCorpusToolRuntime(this.registry, {
            modelSelectsSkills: request.modelSelectsSkills === true
        });
        const reportTools = new ReportBlueprintToolRuntime();
        // Modele lokalne: bez widgetów (minimalny zestaw narzędzi i promptu).
        const widgetTools = request.model.startsWith("local/")
            ? undefined
            : new WidgetToolRuntime(this.registry);
        // Modele lokalne (Bielik, Mistral): bez federacji MCP. Jej instrukcje i schematy to
        // ~12 tys. znaków promptu przy oknie 32k, a lokalny model dostaje przepisy z RAG
        // rdzeniowego i verify_legal_reference na lokalnej kopii ELI.
        const federationTools = request.model.startsWith("local/")
            ? undefined
            : this.legalFederationTools;
        // Instancja federacji jest wspólna dla wszystkich sesji; ta sesja audytuje tylko własne wywołania.
        const federationEvents = [];
        const auxiliarySources = [];
        // References in the message are checked by the Gate I runtime prelude
        // (ELI); no model is asked to extract them.
        const modelTaskOwnership = evaluateModelTaskOwnershipGate(resolveReferencePreflightOwnership(detectLegalReferences(protectedAuxiliaryText ??
            protectedQuery).length > 0));
        audit.record("gate", modelTaskOwnership.gate, modelTaskOwnership.result ===
            "PASS"
            ? "OK"
            : "BLOCKED", {
            registry: modelTaskOwnership.registry,
            resolution: modelTaskOwnership.resolution,
            errors: modelTaskOwnership.errors
        });
        if (modelTaskOwnership.result !==
            "PASS") {
            audit.close("BLOCKED", {
                finalization: "MODEL_TASK_OWNERSHIP"
            });
            throw new Error("MODEL_TASK_OWNERSHIP_GATE_FAILED");
        }
        // Only the newest user turn asserts attachments: earlier turns and assistant
        // replies in the history ("w pliku", "te dokumenty") are not this request's input.
        const gateIInput = evaluateGateIInputCompleteness(latestUserTurn(request.query), request.documentAttachments
            ?.length ?? 0);
        audit.record("gate", "G39I_INPUT_COMPLETENESS", gateIInput.result ===
            "PASS"
            ? "OK"
            : "BLOCKED", {
            attachmentAssertion: gateIInput.attachmentAssertion,
            attachmentCount: gateIInput.attachmentCount,
            reason: gateIInput.reason
        });
        const contextSelection = orchestrateDocumentContext({
            attachments: request.documentAttachments ?? [],
            query: request.query,
            ...(request.modelContextTokens
                ? {
                    modelContextTokens: request.modelContextTokens
                }
                : {}),
            ...(request.tokenCharsPerToken
                ? {
                    tokenCharsPerToken: request.tokenCharsPerToken
                }
                : {})
        });
        const aliasRegistry = new DocumentAliasRegistry();
        const attachments = namespaceDocumentAttachmentTokens(contextSelection.attachments, aliasRegistry);
        // Chunks read by the case file tools are added after the model turn.
        const citationSources = [...contextSelection.citationSources];
        // Page images of the attachments in context (masked evidence), for
        // models that see images; others work from the text.
        const evidence = selectEvidenceImages(request.documentAttachments ?? [], attachments);
        const imagesDelivered = evidence.length > 0 && this.providers.supportsImages(request.provider, request.model);
        if (evidence.length) {
            step("PREPARE", imagesDelivered
                ? `obrazy jako dowód: ${evidence.length} (dane osobowe zamaskowane)`
                : `obrazy pominięte: model przyjmuje tylko tekst (${evidence.length})`);
            audit.record("resource_read", "evidence-images", "OK", {
                delivered: imagesDelivered,
                images: evidence.map((image) => `${image.documentId}:${image.page}`),
                masked: evidence.reduce((sum, image) => sum + image.masked, 0)
            });
        }
        const documentContext = attachments.length > 0
            ? buildDocumentContext(attachments, imagesDelivered ? evidence : [])
            : undefined;
        audit.record("gate", "G39C_CONTEXT_BUDGET", "OK", {
            ...contextSelection.report
        });
        for (const attachment of attachments) {
            audit.record("resource_read", `local-document:${attachment.documentId}`, "OK", {
                chunks: attachment.chunks.map((chunk) => chunk.index),
                representations: attachment.chunks.map((chunk) => chunk.representation ??
                    "FULL"),
                protectedOnly: true,
                ...(attachment.caseId ? { caseId: attachment.caseId } : {}),
                ...(attachment.sourceScope ? { sourceScope: attachment.sourceScope } : {})
            });
        }
        const coreLawTools = this.coreLawIndex
            ? new CoreLawToolRuntime(this.coreLawIndex)
            : undefined;
        // The context holds what fits the window; the tools reach the rest of the
        // matter's files. Not for local models (window and tool reliability).
        const caseFileTools = request.caseFiles && !request.model.startsWith("local/")
            ? new CaseFileToolRuntime(request.caseFiles, {
                inContext: new Map(attachments
                    .filter((attachment) => attachment.caseId === request.caseFiles.caseId)
                    .map((attachment) => [attachment.documentId, new Set(attachment.chunks.map((chunk) => chunk.index))])),
                prefixFor: (documentId) => aliasRegistry.prefixFor(documentId),
                namespace: namespaceChunkTokens,
                markPages,
                ...(request.modelContextTokens
                    ? {
                        maxTurnChars: Math.min(120_000, Math.floor(request.modelContextTokens * (request.tokenCharsPerToken ?? 3) * 0.3))
                    }
                    : {})
            })
            : undefined;
        // Local 11-12B models call tools unreliably: they get the most relevant
        // core law articles in the prompt (retrieval, not training).
        const coreLawRag = this.coreLawIndex && request.model.startsWith("local/")
            ? coreLawRetrievalPrompt(this.coreLawIndex, protectedQuery)
            : null;
        // Claude account in AUTO: skills are read natively from the corpus
        // directory, so the corpus tools are not offered; the rest go over MCP.
        const nativeCorpus = request.modelSelectsSkills === true &&
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
            // AUTO: primarySkill is a placeholder until the model reads a domain skill,
            // so the criminal matter comes from the question itself.
            criminal: (!request.modelSelectsSkills && request.primarySkill.startsWith("dr-03-")) ||
                criminalMatter(request.auxiliaryText ?? latestUserTurn(request.query)) ||
                // A follow-up of a criminal matter ("a jaki termin?") stays one.
                (!request.auxiliaryText && criminalMatter(threadUserText(request.query))),
            documents: attachments.length > 0,
            documentsTruncated: contextSelection.report.documents?.some((item) => item.status !== "FULL") ?? false,
            documentGeneration: Boolean(request.documentAstOutput || request.processWorkflowContext),
            foreignJurisdiction: false
        };
        // PROFIL-LEKKI forbids the light profile for router category [11] (someone else's material).
        const verification = legalTurn && classifyTask(this.taskRoutes(), pathFacts.query)?.route.id === "11";
        const profile = pathProfile({
            mode: request.modeDecision?.mode ?? request.mode,
            simple: request.matterComplexity?.level === "SIMPLE",
            criminal: pathFacts.criminal,
            documentGeneration: pathFacts.documentGeneration,
            verification
        });
        // Already in the model's context: the router skill and the core legal resources.
        const contextResources = new Set([
            `${ROUTER_SKILL}/SKILL.md`,
            "shared/PRAWO-HARDGATE.md",
            `${ROUTER_SKILL}/references/KROK0A-anonimizer.md`,
            `${ROUTER_SKILL}/references/KROK1-detekcja.md`,
            // Route-based path: the engine puts the qualifier in the prompt itself.
            ...(pathFacts.criminal && !request.modelSelectsSkills ? [CRIMINAL_QUALIFIER_RESOURCE] : [])
        ]);
        const pathSections = [];
        // The kind of every document the user sent (court decision, pleading, contract,
        // evidence...), recognised locally from its protected text; the router chooses
        // the skill also by what the user delivers (ACTIVATION-MATRIX).
        const recognisedDocuments = mandatoryModel && legalTurn
            ? attachments
                .filter((attachment) => attachment.sourceScope !== "FIRM_TEMPLATE" && attachment.sourceScope !== "FIRM_KNOWLEDGE")
                .map((attachment) => ({
                documentId: attachment.documentId,
                ...classifyDocument({
                    text: attachment.chunks.map((chunk) => chunk.text).join("\n"),
                    images: attachment.images?.length ?? 0
                })
            }))
            : [];
        if (recognisedDocuments.length) {
            audit.record("gate", "DOCUMENT_KINDS", "OK", {
                documents: recognisedDocuments.map((document) => `${document.documentId}:${document.kind}`)
            });
            pathSections.push(recognisedDocumentsPrompt(recognisedDocuments));
            step("PREPARE", `rozpoznane dokumenty: ${recognisedDocuments.map((document) => document.label).join(", ")}`);
        }
        // AUTO: a criminal question gets the qualifier up front (Karne: +kwalifikator).
        if (mandatoryModel && legalTurn && pathFacts.criminal && request.modelSelectsSkills) {
            const qualifier = this.readCorpus(CRIMINAL_QUALIFIER_RESOURCE);
            if (qualifier) {
                contextResources.add(CRIMINAL_QUALIFIER_RESOURCE);
                audit.record("resource_read", CRIMINAL_QUALIFIER_RESOURCE, "OK", { detail: "runtime-preload;mandatory-path;criminal-question" });
                pathSections.push(`# MANDATORY PATH RESOURCE: ${CRIMINAL_QUALIFIER_RESOURCE}\n\n${qualifier}`);
            }
        }
        // AUTO: the domain (prawo-polskie-v2 flash routing) and its act modules
        // (MAPA-AKTOW) the case points to; the model decides and reads them.
        const caseText = [pathFacts.query, ...recognisedDocuments.map((document) => document.label)].join("\n");
        corpusTools.setCaseText(caseText);
        // MAPA-AKTOW resolved mechanically (Dz.U. number, article of a code, act or scope
        // named): those modules are loaded and required; the hint below covers the rest.
        if (mandatoryModel && legalTurn) {
            const documentText = attachments
                .filter((attachment) => attachment.sourceScope !== "FIRM_TEMPLATE" && attachment.sourceScope !== "FIRM_KNOWLEDGE")
                .map((attachment) => attachment.chunks.map((chunk) => chunk.text).join("\n"))
                .join("\n")
                .slice(0, 30_000);
            const acts = resolveActModulesWithChecks(this.registry, [caseText, documentText].join("\n"));
            if (acts.modules.length || acts.rejected.length) {
                const loaded = loadActModules(this.registry, acts.modules, contextResources);
                for (const item of loaded.loaded) {
                    contextResources.add(item.resource);
                    audit.record("resource_read", item.resource, "OK", { detail: `runtime-preload;act-map;${item.rule}` });
                }
                audit.record("gate", "ACT_MAP_MODULES", acts.rejected.length ? "DEGRADED" : "OK", {
                    detail: [
                        ...acts.modules.map((item) => `${item.skill}:${item.resource}:${item.rule}`),
                        ...acts.rejected.map((item) => `ODRZUCONY:${item.resource}`)
                    ].join(";"),
                    ...(acts.rejected.length ? { rejected: acts.rejected.map((item) => `${item.resource} — ${item.reason}`) } : {})
                });
                if (acts.modules.length)
                    pathSections.push(actModulesPrompt(loaded));
                if (acts.rejected.length) {
                    pathSections.push([
                        "# MAPA-AKTOW: WIERSZ WSKAZUJE NIEWŁAŚCIWY MODUŁ (aplikacja go nie wczytała)",
                        ...acts.rejected.map((item) => `- ${item.resource}: ${item.reason}`),
                        "Ustal właściwy moduł z mapy dziedziny albo powiedz wprost, że go brak; zgłoś rozbieżność mapy."
                    ].join("\n"));
                }
                step("PREPARE", `moduły aktów z mapy (mechanicznie): ${acts.modules.map((item) => path.basename(item.resource, ".md")).join(", ") || "brak"}`);
            }
        }
        if (mandatoryModel && legalTurn && request.modelSelectsSkills) {
            // A follow-up naming no domain of its own keeps the domain of the thread.
            const ownDomains = rankDomains(this.registry, this.flashRoutes(), caseText);
            const domains = ownDomains.length || request.auxiliaryText || !laterTurn(request.query)
                ? ownDomains
                : rankDomains(this.registry, this.flashRoutes(), [threadUserText(request.query), caseText].join("\n"));
            if (domains.length) {
                audit.record("gate", "DOMAIN_HINT", "OK", {
                    detail: domains.map((domain) => `${domain.skill}:${domain.modules.map((module) => module.resource).join(",")}`).join(";")
                });
                pathSections.push(domainHintPrompt(domains));
                step("PREPARE", `dziedzina wg routingu błyskawicznego: ${domains.map((domain) => domain.skill).join(", ")}`);
            }
        }
        // Sections the skill's author marked as executed by the application go to the
        // model as a one-line reference (skill-sections.ts); the audit names them.
        // KROK 7 is the application's only where it appends the canonical text after the
        // gates (free-text answer of a non-local model, not a report or a pipeline document).
        const appendsDisclaimer = !request.model.startsWith("local/") &&
            !request.documentAstOutput &&
            !request.processWorkflowContext &&
            !/^raport-/u.test(request.primarySkill);
        const inactiveComponents = new Set([
            ...(appendsDisclaimer ? [] : ["DISCLAIMER"]),
            // show_widget (with template data) exists for every model except a local one.
            ...(request.model.startsWith("local/") ? ["WIDGET-DANE"] : [])
        ]);
        // Stages of the skill reached in this thread (sections marked lex:wczytaj-gdy).
        const stages = reachedStages(request.query);
        const forModel = (resource, content) => {
            const result = compactForModel(content, undefined, inactiveComponents, stages);
            if (result.compacted.length) {
                audit.record("gate", "SECTIONS_EXECUTED_BY_APP", "OK", {
                    resource,
                    sections: result.compacted.map((item) => `${item.component}:${item.heading}`),
                    chars: result.compacted.reduce((sum, item) => sum + item.chars, 0)
                });
            }
            return result.text;
        };
        // PROFIL-LEKKI: a mandatory resource the application could not read is named to the
        // model before it answers and in the answer (⛔ TRYB ZDEGRADOWANY), never silently replaced by memory.
        const unreadableResources = [];
        if (mandatoryModel && legalTurn) {
            const preloaded = preloadForTurn(mandatoryModel, { ...pathFacts, profile }).filter((resource) => !contextResources.has(resource));
            for (const resource of preloaded) {
                const content = this.readCorpus(resource);
                if (!content) {
                    audit.record("resource_read", resource, "BLOCKED", { detail: "runtime-preload;mandatory-path;missing" });
                    unreadableResources.push(resource);
                    continue;
                }
                contextResources.add(resource);
                audit.record("resource_read", resource, "OK", { detail: "runtime-preload;mandatory-path", profile });
                pathSections.push(`# MANDATORY PATH RESOURCE: ${resource}\n\n${forModel(resource, content)}`);
            }
            if (unreadableResources.length) {
                pathSections.push([
                    "# ⛔ TRYB ZDEGRADOWANY — ZASOBY NIEWCZYTANE (ustalone przez aplikację)",
                    `Aplikacja nie wczytała: ${unreadableResources.join(", ")}.`,
                    "Nie odtwarzaj ich reguł z pamięci. Wskaż w odpowiedzi, której kontroli z tych zasobów nie wykonano."
                ].join("\n"));
            }
            step("SKILLS", `ścieżka obowiązkowa: profil ${profile === "PELNY" ? "PEŁNY" : "LEKKI"}, wczytano ${preloaded.length - unreadableResources.length} plików`);
            pathSections.unshift(mandatoryPathInstructions(mandatoryModel, profile, [...contextResources]));
        }
        // AUTO: the task type from the router's table [1]–[11] names the executive skill
        // the router requires; the app loads it in full with its contract (mechanically,
        // as in the mechanical mode) instead of leaving the choice to the model.
        let taskRoute = null;
        let routingMaterials = [];
        if (mandatoryModel &&
            legalTurn &&
            request.modelSelectsSkills &&
            !request.guideContext &&
            !request.processWorkflowContext &&
            !request.courtWorkflowContext &&
            !request.chronologyWorkflowContext &&
            !request.contractWorkflowContext &&
            !request.orderedCaseWorkflowContext) {
            // ACTIVATION-MATRIX first (phrases and delivered materials), then the
            // router table [1]–[11] on the question and the documents' kinds.
            // The matter's own files (case search on) count as delivered case files for a
            // request to analyse the matter ("całościowa analiza sprawy").
            const materials = [
                ...recognisedDocuments,
                ...(request.caseFiles && !recognisedDocuments.length && ANALYSIS_INTENT.test(pathFacts.query)
                    ? [{ category: "AKTA", evidence: false, label: "akta sprawy" }]
                    : [])
            ];
            routingMaterials = materials;
            taskRoute = decideTask(this.taskRoutes(), this.activationMatrix(), pathFacts.query, materials, this.redactionTest(), {
                skill: "pisma-proste-v2",
                entries: schemaCatalog(this.registry, "pisma-proste-v2")
            });
            const record = taskRoute ? this.registry.get(taskRoute.primary) : undefined;
            if (taskRoute && record) {
                const skill = record.name;
                const text = fs.readFileSync(record.skillFile, "utf8");
                corpusTools.recordPreloaded(`${path.basename(record.directory)}/SKILL.md`);
                audit.record("gate", "TASK_ROUTING", "OK", {
                    source: taskRoute.source,
                    skill,
                    ...(taskRoute.then ? { then: taskRoute.then } : {}),
                    reason: taskRoute.reason
                });
                pathSections.push([
                    `# SKILL WYKONAWCZY WG ROUTERA: ${skill} (wczytany przez aplikację w całości; nie czytaj go ponownie)`,
                    `Rozpoznanie aplikacji — ${taskRoute.reason}. To jest PRIMARY tej sprawy${taskRoute.route?.secondary.length ? `; SECONDARY: ${taskRoute.route.secondary.join(", ")}` : ""}.` +
                        (taskRoute.then ? ` Dalszy etap pipeline'u według macierzy: ${taskRoute.then} (po wyniku tego skilla).` : "") +
                        " Gdy treść sprawy wskazuje inny wiersz routingu, powiedz to wprost i wczytaj właściwy skill.",
                    ...(skill === "pisma-procesowe-v3" || skill === "pisma-proste-v2" || taskRoute.then === "pisma-procesowe-v3"
                        ? ["Pełny pipeline pisma (etapy, HYBRID-VAL, .docx) prowadzi tryb mechaniczny: zaproponuj użytkownikowi wybór tego skilla w trybie mechanicznym."]
                        : []),
                    forModel(`${skill}/SKILL.md`, text)
                ].join("\n\n"));
                const contract = executiveContract(this.registry, skill, (body) => compactForModel(body, undefined, inactiveComponents, stages).text);
                if (contract) {
                    const loaded = loadContract(this.registry, contract, { inContext: contextResources, budget: CONTRACT_BUDGET_CHARS / 2 });
                    for (const item of loaded.loaded) {
                        contextResources.add(item.resource);
                        audit.record("resource_read", item.resource, "OK", { detail: "runtime-preload;executive-contract" });
                    }
                    audit.record("gate", "EXECUTIVE_CONTRACT", "OK", {
                        detail: `skill=${skill};gates=${contract.gates.length};loaded=${loaded.loaded.map((item) => item.resource).join(",")};toRead=${loaded.toRead.join(",")}`
                    });
                    pathSections.push(contractPrompt(loaded));
                }
                // Shared files every executive skill names for this case: the runtime adapter
                // ("przed wykonaniem zastosuj"), and FAKTY_v2 for a letter drafted from the
                // delivered material (router KROK 5-6: "Materiały źródłowe? TAK -> FAKTY_v2").
                const draftsLetter = [skill, taskRoute.then].some((name) => /^pisma-/.test(name ?? ""));
                const sharedForSkill = [
                    "shared/UNIVERSAL-RUNTIME-ADAPTER.md",
                    ...(draftsLetter && attachments.length > 0 ? ["shared/FAKTY_v2.md"] : [])
                ];
                for (const resource of sharedForSkill) {
                    if (contextResources.has(resource))
                        continue;
                    const content = this.readCorpus(resource);
                    if (!content)
                        continue;
                    contextResources.add(resource);
                    audit.record("resource_read", resource, "OK", { detail: "runtime-preload;executive-shared" });
                    pathSections.push(`# ZASÓB SHARED WYMAGANY PRZEZ SKILL ${skill}: ${resource}\n\n${forModel(resource, content)}`);
                }
                // Modules the decision itself requires (Test A: MOD-REDAKCJA for a finished pleading).
                for (const resource of taskRoute.modules ?? []) {
                    if (contextResources.has(resource))
                        continue;
                    const content = this.readCorpus(resource);
                    if (!content)
                        continue;
                    contextResources.add(resource);
                    audit.record("resource_read", resource, "OK", { detail: "runtime-preload;task-decision" });
                    pathSections.push(`# MODUŁ WYMAGANY PRZEZ ROZPOZNANIE ZADANIA: ${resource}\n\n${content}`);
                }
                // Conditional modules of the skill's module map that this case triggers.
                const modules = loadModules(this.registry, skill, skillModules(this.registry, skill, {
                    // The kinds of the delivered material in the words module maps use.
                    text: [
                        pathFacts.query,
                        ...recognisedDocuments.map((document) => document.label),
                        recognisedDocuments.some((document) => document.evidence) ? "materiał zawiera dowody do oceny (dokumenty)" : "",
                        recognisedDocuments.some((document) => document.category === "PISMO_PROCESOWE" || document.category === "ORZECZENIE")
                            ? "materiał zawiera pisma procesowe, akta"
                            : ""
                    ].join("\n")
                }), contextResources);
                if (modules.loaded.length || modules.toRead.length) {
                    for (const item of modules.loaded) {
                        contextResources.add(item.resource);
                        audit.record("resource_read", item.resource, "OK", { detail: "runtime-preload;skill-module-map" });
                    }
                    audit.record("gate", "SKILL_MODULES", "OK", {
                        detail: `skill=${skill};loaded=${modules.loaded.map((item) => item.resource).join(",")};toRead=${modules.toRead.map((item) => item.resource).join(",")}`
                    });
                    pathSections.push(modulesPrompt(skill, modules));
                }
                step("SKILLS", `skill wykonawczy (${taskRoute.source === "MATRIX" ? "macierz aktywacji" : taskRoute.source === "SKILL" ? "rozpoznanie w skillu" : "routing"}): ${skill}`);
            }
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
            ...placeholderGrammar([
                protectedQuery,
                protectedAuxiliaryText ?? "",
                // Shared-key documents use the chat's own (seeded) tokens.
                ...attachments
                    .filter((attachment) => attachment.sharedKey)
                    .flatMap((attachment) => attachment.chunks.map((chunk) => chunk.text))
            ].join("\n"), chatPrivacyVault),
            ...attachments
                .filter((attachment) => !attachment.sharedKey)
                .flatMap((attachment) => attachment.grammar ?? [])
        ], partyGroups(
        // Parties of several persons named after a role word ("powodowie [..] i [..]").
        [protectedQuery, protectedAuxiliaryText ?? "", ...attachments.flatMap((attachment) => attachment.chunks.map((chunk) => chunk.text))], (word) => roles.has(word)));
        const draftCallbacks = request.onDraft
            ? createDraftCallbacks(chatPrivacyVault, request.onDraft)
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
                if (event.status !== "OK")
                    return;
                if (event.type === "route")
                    step("ROUTING", event.target);
                else if (event.target === "MODEL_SKILL_SELECTION")
                    step("ROUTING", "model dobiera skille według routera v3");
                else if (event.target === "LOCAL_QUICK_LEGAL")
                    step("SKILLS", "szybka odpowiedź: węzły kwalifikatora i przepisy z ELI");
                else if (event.type === "skill_read")
                    step("SKILLS", `skill ${event.target}`);
                else if (event.type === "resource_read")
                    step("SKILLS", event.target);
                else if (event.type === "provider_start")
                    step("MODEL", `model ${event.detail ?? event.target}`);
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
                    onCorpusPreloaded: (relativePath) => {
                        corpusTools.recordPreloaded(relativePath);
                        step("SKILLS", relativePath);
                    }
                }
                : {}),
            ...(nativeCorpus
                ? {
                    nativeCorpus: {
                        root: this.registry.root,
                        onRead: (relativePath) => {
                            corpusTools.recordNativeRead(relativePath);
                            step("SKILLS", relativePath);
                        },
                        onMissing: (relativePath) => corpusTools.recordNativeMissing(relativePath),
                        missingQualifier: () => corpusTools.missingCriminalQualifier()
                    }
                }
                : {}),
            provider: request.provider,
            model: request.model,
            // The app sends the instructions and the thread (summary + recent turns) on
            // every call, so a resumed host thread only repeated them: each turn and each
            // tool round appended the whole prompt again, and with no matter key the CLI
            // took over the user's latest unrelated session. LEX_ACCOUNT_RESUME=1 restores it.
            ...(request.accountSessionKey && resumeHostThread()
                ? {
                    continuityKey: request.accountSessionKey
                }
                : {}),
            ...(request.accountContinuity || !resumeHostThread()
                ? { accountContinuity: request.accountContinuity ?? "none" }
                : {}),
            route: {
                jurisdiction: "PL",
                primarySkill: request.primarySkill,
                mode: request.mode
            },
            ...(request.guideContext
                ? {
                    guideContext: request.guideContext
                }
                : {}),
            ...(request.documentAstOutput
                ? { documentAstOutput: true }
                : {}),
            ...(request.processRenderOnly && request.documentAstOutput
                ? { processRenderOnly: request.processRenderOnly }
                : {}),
            ...(protectedProcessContext
                ? {
                    processWorkflowContext: protectedProcessContext
                }
                : {}),
            ...(request.courtWorkflowContext
                ? {
                    courtWorkflowContext: request.courtWorkflowContext
                }
                : {}),
            ...(request.chronologyWorkflowContext
                ? {
                    chronologyWorkflowContext: request.chronologyWorkflowContext
                }
                : {}),
            ...(request.contractWorkflowContext
                ? {
                    contractWorkflowContext: request.contractWorkflowContext
                }
                : {}),
            ...(request.orderedCaseWorkflowContext
                ? {
                    orderedCaseWorkflowContext: request.orderedCaseWorkflowContext
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
            runGateIRuntimePrelude: (workflowPlan) => runGateIRuntimePrelude({
                workflow: workflowPlan.id,
                query: protectedQuery,
                ledger,
                ...(verificationTools
                    ? {
                        runTools: (calls) => verificationTools
                            .runTools(calls)
                    }
                    : {})
            }),
            runTools: async (calls) => {
                for (const call of calls) {
                    if (corpusTools.handles(call.name)) {
                        const target = [call.input.skill, call.input.path].filter((part) => typeof part === "string").join("/");
                        step("SKILLS", target || call.name);
                    }
                    else {
                        step("MODEL", `narzędzie ${call.name}`);
                    }
                }
                const corpusCalls = calls.filter((call) => corpusTools.handles(call.name));
                const reportCalls = calls.filter((call) => reportTools.handles(call.name));
                const caseFileCalls = calls.filter((call) => caseFileTools?.handles(call.name) ?? false);
                const widgetCalls = calls.filter((call) => widgetTools?.handles(call.name) ?? false);
                const federationCalls = calls.filter((call) => federationTools?.handles(call.name) ?? false);
                const coreLawCalls = calls.filter((call) => coreLawTools?.handles(call.name) ?? false);
                const verificationCalls = calls.filter((call) => !(coreLawTools?.handles(call.name) ?? false) &&
                    !corpusTools.handles(call.name) &&
                    !reportTools.handles(call.name) &&
                    !(caseFileTools?.handles(call.name) ?? false) &&
                    !(widgetTools?.handles(call.name) ?? false) &&
                    !(federationTools?.handles(call.name) ?? false));
                const corpusResults = corpusCalls.length > 0
                    ? await corpusTools.runTools(corpusCalls)
                    : [];
                const coreLawResults = coreLawTools &&
                    coreLawCalls.length > 0
                    ? await coreLawTools.runTools(coreLawCalls)
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
                const federationResults = federationTools &&
                    federationCalls.length > 0
                    ? await federationTools
                        .runTools(federationCalls, federationEvents)
                    : [];
                for (const result of federationResults) {
                    const source = publicAuxiliarySourceFromToolResult(result);
                    if (!source) {
                        continue;
                    }
                    const key = [
                        source.sourceUrl,
                        source.claim ?? "",
                        source.crossCheckStatus
                    ].join("|");
                    const exists = auxiliarySources.some((item) => [
                        item.sourceUrl,
                        item.claim ?? "",
                        item.crossCheckStatus
                    ].join("|") ===
                        key);
                    if (!exists) {
                        auxiliarySources.push(source);
                    }
                }
                const verificationResults = verificationCalls.length > 0 &&
                    verificationTools
                    ? await verificationTools
                        .runTools(verificationCalls)
                    : [];
                const byId = new Map([
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
                ]));
                return calls.map((call) => byId.get(call.id) ?? {
                    tool_use_id: call.id,
                    content: JSON.stringify({
                        status: "BLOCKED",
                        error: "UNKNOWN_RUNTIME_TOOL"
                    })
                });
            }
        });
        transferExecutionEvents(execution.events, audit);
        const modelSelectedSkills = execution.events.some((event) => event.target ===
            "MODEL_SKILL_SELECTION" &&
            event.status === "OK");
        if (modelSelectedSkills) {
            // Report what the model actually loaded (audited corpus reads).
            const selection = corpusTools.modelSkillSelection();
            execution.loadedSkills =
                selection.loadedSkills;
            execution.domainSkills =
                selection.domainSkills;
            execution.executionSkills =
                selection.executionSkills;
            // Every skill the model read (or the app preloaded) is a skill_read in the
            // audit; a SKILL.md read only in part is DEGRADED, not a read skill.
            for (const read of corpusTools.skillReads()) {
                if (audit.events.some((event) => event.type === "skill_read" && event.target === read.skill && event.status === "OK"))
                    continue;
                audit.record("skill_read", read.skill, read.complete ? "OK" : "DEGRADED", {
                    how: read.how,
                    ...(read.how === "tool" ? { readChars: read.read, totalChars: read.total } : {})
                });
            }
            // Never the placeholder: the DR the model read, else the router.
            execution.primarySkill =
                selection.primarySkill ?? ROUTER_SKILL;
            // The model routed itself: the route is the DR it actually read
            // (router-v3 only when it found no legal domain), not the placeholder.
            audit.record("route", selection.primarySkill ?? "prawny-router-v3", "OK", {
                role: "primary-domain",
                selection: "model-auto-selection",
                domainSkills: selection.domainSkills
            });
        }
        for (const event of caseFileTools?.auditEvents() ?? []) {
            audit.record(event.tool === "read_case_file" ? "resource_read" : "tool_decision", event.tool === "read_case_file" ? `local-document:${event.target}` : `case-files:${event.target}`, event.decision === "ALLOW" ? "OK" : "BLOCKED", { tool: event.tool, protectedOnly: true, ...(event.detail ?? {}) });
        }
        for (const read of caseFileTools?.readChunks() ?? []) {
            citationSources.push({
                caseId: request.caseFiles.caseId,
                documentId: read.documentId,
                sourceScope: "CASE_KNOWLEDGE",
                chunks: read.chunks
            });
        }
        for (const event of coreLawTools?.auditEvents() ?? []) {
            audit.record(event.tool === "read_core_law_article"
                ? "resource_read"
                : "tool_decision", `core-law:${event.target}`, event.decision === "ALLOW" ? "OK" : "BLOCKED", {
                tool: event.tool,
                ...(event.detail ? event.detail : {})
            });
        }
        const corpusAudit = corpusTools.auditEvents();
        // A refused read that grants no content and that the model can correct
        // (router-v3 not read yet, a guessed file name, a malformed or binary read,
        // an unknown corpus tool) is guidance, not a failed turn - also when the
        // runtime routed the skills (document generation), where the required
        // reads are enforced separately by G39H. Path escapes (INVALID_RESOURCE_PREFIX,
        // PATH_ESCAPE), the criminal qualifier and other refusals still block.
        const correctableCorpusRefusal = /^(ROUTER_V3_REQUIRED_FIRST|LEGAL_RESOURCE_NOT_FOUND|LEGAL_SKILL_NOT_FOUND|LEGAL_RESOURCE_NOT_FILE|LEGAL_RESOURCE_NOT_TEXT|LEGAL_RESOURCE_REQUEST_INVALID|INVALID_RESOURCE_OFFSET|INVALID_RESOURCE_CURSOR|UNKNOWN_LEGAL_CORPUS_TOOL)/;
        const correctable = (event) => correctableCorpusRefusal.test(String(event.detail?.error ?? ""));
        // Poprawialna odmowa = DEGRADED, nie BLOCKED: HYBRID-VAL przed .docx odrzuca każde
        // zdarzenie BLOCKED sesji źródłowej, a bramka G36 takiej odmowy nie blokuje.
        for (const event of corpusAudit) {
            audit.record(event.tool === "read_legal_resource" || event.tool === "Read"
                ? "resource_read"
                : "tool_decision", event.target, event.decision === "ALLOW"
                ? "OK"
                : correctable(event)
                    ? "DEGRADED"
                    : "BLOCKED", {
                tool: event.tool,
                ...(event.detail ? event.detail : {})
            });
        }
        const corpusBlocked = corpusAudit.some((event) => event.decision === "BLOCK" &&
            !correctable(event));
        audit.record("gate", "G36_LEGAL_CORPUS_RUNTIME", corpusBlocked ? "BLOCKED" : "OK", { toolEvents: corpusAudit.length });
        const reportAudit = reportTools.auditEvents();
        for (const event of reportAudit) {
            audit.record("tool_decision", event.target, event.decision === "ALLOW"
                ? "OK"
                : "BLOCKED", {
                tool: event.tool,
                ...(event.detail
                    ? event.detail
                    : {})
            });
        }
        if (federationTools) {
            const federationAudit = federationEvents;
            for (const event of federationAudit) {
                audit.record("tool_decision", event.source
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
                        : "BLOCKED", {
                    tool: event.tool,
                    ...(event.detail
                        ? event.detail
                        : {})
                });
            }
            audit.record("gate", "G40_FEDERATED_LEGAL_RESEARCH", federationAudit.some((event) => event.decision ===
                "BLOCK")
                ? "DEGRADED"
                : "OK", {
                toolEvents: federationAudit.length,
                verificationAuthority: "LEX_NATIVE_ONLY"
            });
        }
        const workflowReads = evaluateDeterministicWorkflowReads(execution.workflowPlan, corpusAudit, execution.events);
        const workflowResourcesBlocked = workflowReads.result === "BLOCKED";
        audit.record("gate", "G39H_WORKFLOW_RESOURCE_READS", workflowResourcesBlocked ? "BLOCKED" : "OK", {
            workflow: workflowReads.workflow,
            required: workflowReads.required,
            observed: workflowReads.observed,
            missing: workflowReads.missing
        });
        // Mandatory path, profile PEŁNY: the router's gate blocks (CN, REM, WYJ) must be
        // visible in the answer. One correcting round with the gate modules; what is
        // still missing after it degrades the answer (⛔ TRYB ZDEGRADOWANY).
        // The profile after the answer: a criminal domain the model read makes it PEŁNY.
        // Gate modules not yet in the context are loaded for the correcting round.
        const criminalAfter = pathFacts.criminal || [...(execution.domainSkills ?? []), execution.primarySkill].some((skill) => skill.startsWith("dr-03-"));
        const effectiveProfile = pathProfile({
            mode: request.modeDecision?.mode ?? request.mode,
            simple: request.matterComplexity?.level === "SIMPLE",
            criminal: criminalAfter,
            documentGeneration: pathFacts.documentGeneration,
            verification
        });
        if (mandatoryModel && legalTurn && effectiveProfile !== profile) {
            for (const resource of preloadForTurn(mandatoryModel, { ...pathFacts, criminal: criminalAfter, profile: effectiveProfile })) {
                if (contextResources.has(resource))
                    continue;
                const content = this.readCorpus(resource);
                if (!content)
                    continue;
                contextResources.add(resource);
                audit.record("resource_read", resource, "OK", { detail: "runtime-preload;mandatory-path;escalated", profile: effectiveProfile });
                pathSections.push(`# MANDATORY PATH RESOURCE: ${resource}\n\n${forModel(resource, content)}`);
            }
            pathSections.push(mandatoryPathInstructions(mandatoryModel, effectiveProfile, [...contextResources]));
        }
        let modelOutput = execution.output;
        // A legal answer (router: "odpowiedź prawna"): it cites the law or a domain skill was read.
        const domainSkillRead = audit.events.some((event) => event.type === "skill_read" && event.status === "OK" && event.target !== ROUTER_SKILL && event.target !== "prawo-polskie-v2");
        const legalAnswer = (text) => legalTurn && (domainSkillRead || detectLegalReferences(text).length > 0);
        const missingGates = mandatoryModel &&
            legalTurn &&
            !request.model.startsWith("local/") &&
            // Plain legal chat only: structured outputs and workflow checkpoints have their own contracts.
            !request.documentAstOutput &&
            !request.guideContext &&
            !request.processWorkflowContext &&
            !request.courtWorkflowContext &&
            !request.chronologyWorkflowContext &&
            !request.contractWorkflowContext &&
            !request.orderedCaseWorkflowContext &&
            legalAnswer(modelOutput)
            ? missingGateBlocks(mandatoryModel, effectiveProfile, modelOutput)
            : [];
        if (missingGates.length) {
            step("MODEL", `ścieżka obowiązkowa: uzupełnienie bramek ${missingGates.map((item) => item.block).join(", ")}`);
            try {
                const corrected = await this.providers.stream(request.provider, {
                    model: request.model,
                    systemPrompt: [
                        ...(placeholderKey ? [placeholderKey] : []),
                        identityPrompt,
                        ...(request.modeDecision ? [queryModePrompt(request.modeDecision)] : []),
                        ...pathSections
                    ].join("\n\n"),
                    messages: [
                        { role: "user", content: protectedQuery },
                        { role: "assistant", content: modelOutput },
                        { role: "user", content: gateCorrectionPrompt(missingGates) }
                    ],
                    accountContinuity: "none",
                    reasoning: "none"
                });
                const text = corrected.fullText.trim();
                const remaining = text ? missingGateBlocks(mandatoryModel, effectiveProfile, text) : missingGates;
                const accepted = Boolean(text) && remaining.length < missingGates.length;
                if (accepted)
                    modelOutput = text;
                audit.record("gate", "MANDATORY_PATH_CORRECTION", accepted && remaining.length === 0 ? "OK" : "DEGRADED", {
                    missing: missingGates.map((item) => item.block),
                    remaining: (accepted ? remaining : missingGates).map((item) => item.block)
                });
            }
            catch (error) {
                audit.record("gate", "MANDATORY_PATH_CORRECTION", "DEGRADED", {
                    missing: missingGates.map((item) => item.block),
                    error: error instanceof Error ? error.message.slice(0, 200) : "CORRECTION_FAILED"
                });
            }
        }
        // The model's own ⚠️ at a statute does not stop the application from
        // verifying it: status comes from the registry only.
        // KROK 7: the model's closing disclaimer is the fixed text of shared/DISCLAIMER.md.
        // It is cut off before the gates and put back after them (the canonical text, or
        // the model's own when the application adds none).
        const modelDisclaimer = legalTurn && !request.documentAstOutput && !request.model.startsWith("local/")
            ? splitTrailingDisclaimer(modelOutput)
            : { body: modelOutput, disclaimer: null };
        if (modelDisclaimer.disclaimer)
            modelOutput = modelDisclaimer.body;
        const releasedDraft = releaseModelUnverifiedMarkers(modelOutput);
        const automaticVerificationPlan = planAutomaticLegalVerification(releasedDraft.text, ledger, requestedHistoricalAsOf);
        let automaticVerificationExecuted = 0;
        if (automaticVerificationPlan.calls.length > 0 &&
            verificationTools) {
            const results = await verificationTools.runTools(automaticVerificationPlan.calls);
            automaticVerificationExecuted =
                results.length;
        }
        // Model-written ✅ markers are claims, not verification: only the ledger
        // marker is shown, so a rewritten link or date cannot block the answer.
        const ledgerBackedOutput = stripUnbackedVerificationMarkers(releasedDraft.text, ledger);
        const automaticVerification = applyAutomaticVerificationMarkers(ledgerBackedOutput.text, ledger, requestedHistoricalAsOf);
        audit.record("gate", "G39I_AUTO_POST_DRAFT_VERIFICATION", automaticVerificationPlan.calls.length > 0 &&
            !verificationTools
            ? "BLOCKED"
            : "OK", {
            planned: automaticVerificationPlan.calls.length,
            executed: automaticVerificationExecuted,
            insertedMarkers: automaticVerification.inserted,
            removedUnbackedMarkers: ledgerBackedOutput.removed,
            releasedModelUnverifiedMarkers: releasedDraft.released,
            skipped: automaticVerificationPlan.skipped
        });
        if (verificationTools) {
            for (const toolEvent of verificationTools.auditEvents()) {
                audit.record("tool_decision", toolEvent.tool, toolEvent.decision === "ALLOW" ? "OK" : "BLOCKED", {
                    decision: toolEvent.decision,
                    capability: toolEvent.capability ?? null,
                    reason: toolEvent.reason ?? null
                });
            }
        }
        const citedAnswer = processDocumentCitationMarkers(automaticVerification.text, citationSources);
        // HARD GATE: an unverified statute or Dz.U. reference is shown only with
        // its [NIEWERYFIKOWANE] marker, placed at the claim itself.
        const preFinalization = new FinalizationGate().evaluate(citedAnswer.text, ledger);
        const markedAnswer = preFinalization.result === "BLOCKED"
            ? {
                ...citedAnswer,
                // Najpierw prawdziwe znaczniki z rejestru dla przepisów powtórzonych bez
                // znacznika (np. tabela porównawcza), potem ⚠️ dla niezweryfikowanych.
                text: addMissingVerificationMarkers(markUnverifiedReferences(citedAnswer.text, preFinalization), preFinalization)
            }
            : citedAnswer;
        // Końcowa kontrola spójności: jeden status źródła dla każdego przepisu w całej
        // odpowiedzi. Sprzeczność z rejestrem VERIFIED jest naprawiana według rejestru;
        // sprzeczność, której rejestr nie rozstrzyga, blokuje prezentację.
        const statusReconciliation = reconcileStatusMarkers(markedAnswer.text, ledger);
        const processedDocumentCitations = statusReconciliation.repaired > 0
            ? {
                ...markedAnswer,
                text: statusReconciliation.text
            }
            : markedAnswer;
        const statusConsistency = evaluateStatusConsistency(processedDocumentCitations.text, ledger);
        const statusConsistencyBlocked = statusConsistency.result ===
            "BLOCKED";
        audit.record("gate", statusConsistency.gate, statusConsistencyBlocked
            ? "BLOCKED"
            : "OK", {
            repairedMarkers: statusReconciliation.repaired,
            provisions: statusConsistency.provisions.length,
            findings: statusConsistency.findings,
            orphanUnverifiedLines: statusConsistency.orphanUnverifiedLines
        });
        audit.record("gate", "LOCAL_DOCUMENT_DEEP_LINKS", "OK", {
            accepted: processedDocumentCitations.citations.length,
            rejected: processedDocumentCitations.rejectedMarkers,
            exactHighlights: processedDocumentCitations.citations.filter((item) => item.highlightStart !== undefined && item.highlightEnd !== undefined).length
        });
        const workflowOutput = evaluateDeterministicWorkflowOutput(execution.workflowPlan, processedDocumentCitations.text, request.processWorkflowContext ||
            request.courtWorkflowContext ||
            request.orderedCaseWorkflowContext
            ? {
                ...(request.processWorkflowContext
                    ? {
                        processCheckpoint: request
                            .processWorkflowContext
                            .checkpoint
                    }
                    : {}),
                ...(request.courtWorkflowContext
                    ? {
                        courtCheckpoint: request
                            .courtWorkflowContext
                            .checkpoint
                    }
                    : {}),
                ...(request.orderedCaseWorkflowContext
                    ? {
                        orderedCheckpoint: request
                            .orderedCaseWorkflowContext
                            .checkpoint
                    }
                    : {})
            }
            : undefined);
        const workflowOutputBlocked = workflowOutput.result ===
            "BLOCKED";
        audit.record("gate", "G39H_WORKFLOW_OUTPUT", workflowOutputBlocked
            ? "BLOCKED"
            : "OK", {
            workflow: workflowOutput.workflow,
            mode: workflowOutput.mode,
            required: workflowOutput.required,
            observed: workflowOutput.observed,
            missing: workflowOutput.missing,
            orderValid: workflowOutput.orderValid
        });
        const guideOutput = request.guideContext
            ? evaluateGuideOutput(request.guideContext, processedDocumentCitations.text)
            : null;
        const guideOutputBlocked = guideOutput?.result ===
            "BLOCKED";
        audit.record("gate", "G39I_GUIDE_OUTPUT", guideOutputBlocked
            ? "BLOCKED"
            : "OK", guideOutput
            ? {
                questionCount: guideOutput.questionCount,
                oneQuestionRuleActive: guideOutput
                    .oneQuestionRuleActive,
                irreversibleWarningRequired: guideOutput
                    .irreversibleWarningRequired,
                irreversibleWarningPresent: guideOutput
                    .irreversibleWarningPresent,
                violations: guideOutput.violations
            }
            : {
                active: false
            });
        const requiredReportKind = execution.workflowPlan.id ===
            "CLIENT_REPORT_V1"
            ? "CLIENT_REPORT_V1"
            : execution.workflowPlan.id ===
                "SITUATION_REPORT_V1"
                ? "SITUATION_REPORT_V1"
                : null;
        const reportBlueprint = requiredReportKind
            ? reportTools.acceptedFor(requiredReportKind)
            : null;
        const reportBlueprintBlocked = requiredReportKind !== null &&
            reportBlueprint === null;
        audit.record("gate", "G39I_REPORT_BLUEPRINT", reportBlueprintBlocked
            ? "BLOCKED"
            : "OK", {
            required: requiredReportKind,
            accepted: reportBlueprint?.kind ??
                null,
            toolEvents: reportAudit.length
        });
        const finalizationText = reportBlueprint
            ? [
                processedDocumentCitations.text,
                "[STRUCTURED_REPORT_BLUEPRINT_DATA]",
                JSON.stringify(reportBlueprint.blueprint),
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
        const verificationRecords = ledger.all();
        const publicAuxiliarySources = reconcileAuxiliarySourcesWithVerification(auxiliarySources, verificationRecords);
        const gateI = evaluateGateIInvariants({
            events: execution.events,
            workflowReads,
            verificationRecords,
            finalization,
            outputValidation: {
                result: workflowOutputBlocked ||
                    guideOutputBlocked ||
                    reportBlueprintBlocked
                    ? "BLOCKED"
                    : "PASS",
                detail: [
                    `workflow=${workflowOutput.result}`,
                    `guide=${guideOutput?.result ?? "N/A"}`,
                    `reportBlueprint=${reportBlueprintBlocked ? "BLOCKED" : "PASS"}`
                ].join(";")
            },
            documentCitations: {
                accepted: processedDocumentCitations
                    .citations.length,
                rejected: processedDocumentCitations
                    .rejectedMarkers,
                quotedWithoutExactHighlight: processedDocumentCitations
                    .citations
                    .filter((citation) => Boolean(citation.quote) &&
                    (citation
                        .highlightStart ===
                        undefined ||
                        citation
                            .highlightEnd ===
                            undefined))
                    .length
            }
        });
        const gateIBlocked = gateI.result ===
            "BLOCKED";
        const gateIContract = gateIWorkflowContract(execution.workflowPlan.id, execution.workflowPlan
            .executionSkill);
        const stateTransition = gateIContract.stateModel ===
            "DURABLE_CASE"
            ? ((execution.workflowPlan.id ===
                "PROCESS_PLEADING_V1" &&
                request
                    .processWorkflowContext) ||
                (execution.workflowPlan.id ===
                    "COURT_ANALYSIS_V1" &&
                    request
                        .courtWorkflowContext) ||
                (execution.workflowPlan.id ===
                    "CHRONOLOGY_V1" &&
                    request
                        .chronologyWorkflowContext) ||
                (execution.workflowPlan.id ===
                    "CONTRACT_ANALYSIS_V1" &&
                    request
                        .contractWorkflowContext) ||
                ((execution.workflowPlan.id ===
                    "EVIDENCE_ANALYSIS_V1" ||
                    execution.workflowPlan.id ===
                        "WITNESS_QUESTIONING_V1") &&
                    request
                        .orderedCaseWorkflowContext))
                ? "PASS"
                : "BLOCKED"
            : gateIContract.stateModel ===
                "DURABLE_SESSION"
                ? (execution.workflowPlan.id ===
                    "LEGAL_GUIDE_V1" &&
                    request.guideContext)
                    ? "PASS"
                    : "BLOCKED"
                : "NOT_APPLICABLE";
        const gateIWorkflowContractReport = evaluateGateIWorkflowContract({
            contract: gateIContract,
            invariants: gateI,
            input: gateIInput,
            stateTransition
        });
        const gateIWorkflowContractBlocked = gateIWorkflowContractReport.result ===
            "BLOCKED";
        audit.record("gate", gateIWorkflowContractReport.gate, gateIWorkflowContractBlocked
            ? "BLOCKED"
            : "OK", {
            workflow: gateIWorkflowContractReport.workflow,
            stateModel: gateIWorkflowContractReport.stateModel,
            commonInvariants: gateIWorkflowContractReport.commonInvariants,
            checks: gateIWorkflowContractReport.checks
        });
        let gateITurn = createGateITurnState(execution.workflowPlan.id);
        const check = (id) => gateI.checks.find((item) => item.id === id);
        if (check("ROUTER_FIRST")
            ?.result !== "PASS") {
            gateITurn =
                blockGateITurn(gateITurn, "ROUTER_FIRST");
        }
        else {
            gateITurn =
                passGateITurnPhase(gateITurn, "ROUTER_PREFLIGHT", "prawny-router-v3 first");
            const workflowPreflight = execution.events.find((event) => event.type ===
                "gate" &&
                event.target ===
                    "G39H_WORKFLOW_PREFLIGHT");
            if (workflowPreflight
                ?.status !== "OK") {
                gateITurn =
                    blockGateITurn(gateITurn, "SKILL_PREFLIGHT");
            }
            else {
                gateITurn =
                    passGateITurnPhase(gateITurn, "SKILL_PREFLIGHT", execution.workflowPlan.id);
                if (corpusBlocked ||
                    check("CORE_RESOURCES")
                        ?.result !==
                        "PASS" ||
                    check("WORKFLOW_RESOURCES")
                        ?.result !==
                        "PASS") {
                    gateITurn =
                        blockGateITurn(gateITurn, "RESOURCE_READS");
                }
                else {
                    gateITurn =
                        passGateITurnPhase(gateITurn, "RESOURCE_READS", `workflowReads=${workflowReads.observed.length}`);
                    const providerComplete = execution.events.find((event) => event.type ===
                        "gate" &&
                        event.target ===
                            "G39H_WORKFLOW_PROVIDER_COMPLETE");
                    if (providerComplete
                        ?.status !== "OK") {
                        gateITurn =
                            blockGateITurn(gateITurn, "SEMANTIC_EXECUTION");
                    }
                    else {
                        gateITurn =
                            passGateITurnPhase(gateITurn, "SEMANTIC_EXECUTION");
                        if (check("SOURCE_PROVENANCE")
                            ?.result !==
                            "PASS" ||
                            check("SOURCE_HIERARCHY")
                                ?.result !==
                                "PASS" ||
                            check("TEMPORAL_FRESHNESS")
                                ?.result !==
                                "PASS") {
                            gateITurn =
                                blockGateITurn(gateITurn, "SOURCE_VERIFICATION");
                        }
                        else {
                            gateITurn =
                                passGateITurnPhase(gateITurn, "SOURCE_VERIFICATION", `records=${gateI.verifiedOrSupportedRecords}`);
                            if (check("CITATION_LEDGER")
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
                                    "PASS") {
                                gateITurn =
                                    blockGateITurn(gateITurn, "CITATION_VALIDATION");
                            }
                            else {
                                gateITurn =
                                    passGateITurnPhase(gateITurn, "CITATION_VALIDATION", `references=${gateI.legalReferences};cases=${gateI.caseReferences}`);
                                if (workflowOutputBlocked ||
                                    guideOutputBlocked ||
                                    reportBlueprintBlocked) {
                                    gateITurn =
                                        blockGateITurn(gateITurn, "OUTPUT_VALIDATION");
                                }
                                else {
                                    gateITurn =
                                        passGateITurnPhase(gateITurn, "OUTPUT_VALIDATION");
                                    if (check("FINALIZATION")
                                        ?.result !==
                                        "PASS") {
                                        gateITurn =
                                            blockGateITurn(gateITurn, "FINALIZATION");
                                    }
                                    else {
                                        gateITurn =
                                            passGateITurnPhase(gateITurn, "FINALIZATION");
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        audit.record("gate", "G39I_TURN_STATE", gateITurn.result ===
            "PASS"
            ? "OK"
            : "BLOCKED", {
            workflow: gateITurn.workflowId,
            phase: gateITurn.phase,
            result: gateITurn.result,
            events: gateITurn.events.length
        });
        audit.record("gate", gateI.gate, gateIBlocked
            ? "BLOCKED"
            : "OK", {
            checks: gateI.checks,
            verifiedOrSupportedRecords: gateI.verifiedOrSupportedRecords,
            legalReferences: gateI.legalReferences,
            caseReferences: gateI.caseReferences
        });
        const workflowFinalizationBlocked = finalization.result !== "PASS" ||
            statusConsistencyBlocked ||
            corpusBlocked ||
            workflowResourcesBlocked ||
            workflowOutputBlocked ||
            guideOutputBlocked ||
            reportBlueprintBlocked ||
            gateIBlocked ||
            gateIWorkflowContractBlocked;
        const presentationCriticalGateIds = new Set([
            "ROUTER_FIRST",
            "CORE_RESOURCES",
            "ROUTER_REQUIRED_MODULES",
            "WORKFLOW_RESOURCES",
            "OUTPUT_CONTRACT"
        ]);
        const criticalGateIBlocked = gateI.checks.some((item) => presentationCriticalGateIds.has(item.id) &&
            item.result === "BLOCKED");
        const workflowContractExtensionBlocked = gateIWorkflowContractReport
            .checks
            .some((item) => item.result ===
            "BLOCKED");
        const verificationDegraded = finalization.result !==
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
        audit.record("gate", "G39H_WORKFLOW_FINALIZATION", workflowFinalizationBlocked ? "BLOCKED" : "OK", {
            workflow: execution.workflowPlan.id,
            finalization: finalization.result,
            statusConsistency: statusConsistency.result,
            corpusBlocked,
            workflowResourcesBlocked,
            workflowOutputBlocked,
            guideOutputBlocked,
            reportBlueprintBlocked
        });
        // KROK 4: provisions verified in their current wording, checked again on the
        // event date from the question (separate ledger: answer markers stay as they are).
        const dates = mandatoryModel && legalTurn && this.verificationToolFactory && !requestedHistoricalAsOf
            ? eventDates(pathFacts.query, new Date().toISOString().slice(0, 10))
            : [];
        const eventDateCheck = dates.length
            ? await checkProvisionsAtEventDates({
                records: ledger.all(),
                dates,
                runTools: (calls) => this.verificationToolFactory(new VerificationLedger(), { localModel: false }).runTools(calls)
            })
            : undefined;
        if (eventDateCheck?.items.length) {
            audit.record("gate", "EVENT_DATE_CHECK", eventDateCheck.items.every((item) => item.result === "SAME") ? "OK" : "DEGRADED", {
                dates: eventDateCheck.dates,
                items: eventDateCheck.items.map((item) => `${item.claim}@${item.asOf}:${item.result}`)
            });
        }
        // KROK 7: the disclaimer from shared/DISCLAIMER.md is the last element of a
        // legal answer; the application adds it when the model did not end with it.
        const mode = request.modeDecision?.mode ?? request.mode;
        // Structured output (document AST, report blueprint) is parsed by the app: no text around it.
        const freeText = !request.documentAstOutput && !reportBlueprint;
        const disclaimerTexts = legalAnswer(processedDocumentCitations.text) && freeText && !request.model.startsWith("local/") ? parseDisclaimer(this.readCorpus("shared/DISCLAIMER.md") ?? "") : null;
        const disclaimed = disclaimerTexts
            ? withDisclaimer(processedDocumentCitations.text, disclaimerTexts, { mode, pleading: pathFacts.documentGeneration })
            : modelDisclaimer.disclaimer
                ? { text: `${processedDocumentCitations.text.trimEnd()}\n\n${modelDisclaimer.disclaimer}`, appended: false }
                : { text: processedDocumentCitations.text, appended: false };
        const disclaimerBy = modelDisclaimer.disclaimer ? "MODEL" : disclaimed.appended ? "APLIKACJA" : "MODEL";
        if (disclaimed.appended)
            audit.record("gate", "DISCLAIMER_LAST", "OK", { by: disclaimerBy, mode, canonical: true });
        // The register of the mandatory path, from what really happened in the turn.
        const evaluatedPath = mandatoryModel && legalTurn
            ? evaluateMandatoryPath(mandatoryModel, {
                ...pathFacts,
                criminal: criminalAfter,
                profile: effectiveProfile,
                contextResources,
                answer: processedDocumentCitations.text,
                ...(disclaimerTexts ? { disclaimerBy } : {}),
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
                federationTools: Boolean(federationTools),
                ...(eventDateCheck ? { eventDateCheck } : {})
            })
            : undefined;
        // KROK 3A written by the application from the audit.
        const trace = evaluatedPath
            ? routingTrace({
                mode,
                report: evaluatedPath,
                // AUTO with a recognised task type: PRIMARY is the router's executive skill.
                primarySkill: taskRoute ? taskRoute.primary : execution.primarySkill,
                loadedSkills: [...(execution.loadedSkills ?? []), ...(taskRoute ? [execution.primarySkill] : [])],
                events: audit.events.map((event) => ({ type: event.type, target: event.target, status: event.status })),
                routerVersion: String(this.registry.get(ROUTER_SKILL)?.frontmatter.version ?? "") || null,
                sharedRoot: `${path.basename(this.registry.root)}/shared`,
                duplicates: duplicateSkills([...this.registry.skills.keys()])
            })
            : null;
        const mandatoryPath = evaluatedPath && trace ? { ...evaluatedPath, routingTrace: trace.text } : evaluatedPath;
        // Router: a missing mandatory read or gate is declared, never silent.
        const degradedReasons = mandatoryPath
            ? [
                ...(trace && !trace.primaryRead ? ["router niewczytany (PRIMARY)"] : []),
                ...(unreadableResources.length ? [`nie wczytano: ${unreadableResources.join(", ")}`] : []),
                ...(mandatoryPath.degraded
                    ? [`brak obowiązkowego kroku: ${mandatoryPath.steps.filter((item) => item.requirement === "CORE" && item.layer === "ROUTER" && item.status === "MISSING").map((item) => item.id).join(", ")}`]
                    : [])
            ]
            : [];
        const presentedText = degradedReasons.length && freeText && legalAnswer(processedDocumentCitations.text)
            ? `⛔ TRYB ZDEGRADOWANY — ${degradedReasons.join("; ")}\n\n${disclaimed.text}`
            : disclaimed.text;
        if (mandatoryPath) {
            audit.record("gate", "MANDATORY_PATH", mandatoryPath.complete ? "OK" : "DEGRADED", {
                profile: mandatoryPath.profile,
                missing: mandatoryPath.missing
            });
        }
        const safeToPresent = !presentationBlocked;
        audit.record("gate", "G15_SAFE_SESSION_EXECUTION", presentationBlocked
            ? "BLOCKED"
            : verificationDegraded
                ? "DEGRADED"
                : "OK", {
            finalization: finalization.result,
            verificationDegraded,
            criticalGateIBlocked,
            workflowContractExtensionBlocked
        });
        audit.close(presentationBlocked
            ? "BLOCKED"
            : verificationDegraded
                ? "DEGRADED"
                : "OK", {
            finalization: finalization.result,
            verificationDegraded
        });
        const completeness = audit.validateCompletion({
            requireVerification: finalization.references.length > 0,
            requireToolActivity: finalization.references.length > 0 && Boolean(verificationTools),
            requireDeterministicWorkflow: true
        });
        const blockedReferences = finalization.findings
            .filter((finding) => finding.status !== "VERIFIED")
            .map((finding) => ({
            claim: finding.reference.claim,
            kind: finding.reference.kind,
            line: finding.reference.line,
            status: finding.status
        }))
            .concat(statusConsistency.findings.flatMap((finding) => finding.lines.map((line) => ({
            claim: finding.key,
            kind: "statute",
            line,
            status: finding.code
        }))))
            // Znaczniki orzeczeń bez dowodu (zmyślone albo cytat zmieniony po weryfikacji).
            .concat([...finalization.caseQuoteFindings.filter((finding) => finding.status !== "VERIFIED"),
            ...finalization.caseSupportFindings.filter((finding) => finding.status !== "SUPPORTED")]
            .map((finding) => ({
            claim: finding.record?.caseSignature ?? `znacznik orzeczenia ${finding.evidenceHash}`,
            kind: "case",
            line: finding.line,
            status: finding.status
        })));
        step("RESTORE", "symbole zastępcze → dane z lokalnego klucza");
        // Every restored value is reported so the UI can mark it for review.
        const restoredAnswer = restoreWithReport(presentedText, chatPrivacyVault);
        // Next step of the pipeline: after the AUTO entry skill, or after the final
        // result of the mechanical workflow.
        const nextContext = { question: pathFacts.query, materials: routingMaterials };
        const next = taskRoute
            ? pipelineNext(taskRoute.primary, taskRoute.then, this.skillCombinations(), nextContext)
            : execution.workflowPlan.executionSkill && workflowOutput.mode.endsWith("_FINAL")
                ? pipelineNext(execution.workflowPlan.executionSkill, null, this.skillCombinations(), nextContext)
                : null;
        const response = {
            sessionId: audit.sessionId,
            status: safeToPresent ? "DRAFT_PRESENTABLE" : "BLOCKED",
            ...(next && safeToPresent ? { pipelineNext: next } : {}),
            ...(mandatoryPath ? { mandatoryPath } : {}),
            ...(request.modeDecision ? { modeDecision: request.modeDecision } : {}),
            provider: request.provider,
            model: request.model,
            modelRouting: {
                primary: {
                    provider: request.provider,
                    model: request.model
                }
            },
            primarySkill: execution.primarySkill,
            loadedSkills: execution.loadedSkills,
            executionSkills: execution.executionSkills,
            domainSkills: execution.domainSkills,
            ...(safeToPresent
                ? {
                    answer: restoredAnswer.text,
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
            evidence: publicEvidenceBundle(verificationRecords, restoredAnswer.text),
            ...(publicAuxiliarySources.length > 0
                ? {
                    auxiliarySources: publicAuxiliarySources
                }
                : {}),
            ...(widgetTools && widgetTools.widgets().length > 0
                ? { widgets: widgetTools.widgets() }
                : {}),
            context: {
                ...contextSelection.report,
                ...(() => {
                    const budget = decodePromptBudget(String([...execution.events].reverse().find((event) => event.target === "PROMPT_BUDGET")?.detail ?? ""));
                    return budget ? { instructionChars: budget.chars, instructionSections: budget.sections } : {};
                })()
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
                result: workflowResourcesBlocked ||
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
            gateIWorkflowContract: gateIWorkflowContractReport,
            gateITurn
        };
        Object.defineProperty(response, SESSION_EXECUTION_INTERNAL, {
            value: {
                verificationRecords: verificationRecords.map((record) => ({ ...record })),
                auditEvents: audit.events.map((event) => ({
                    ...event,
                    ...(event.detail ? { detail: { ...event.detail } } : {})
                })),
                // Own-key documents by prefix (D01 = [0]); shared-key ones have none.
                documentAliasDocumentIds: aliasRegistry.documentIds()
            },
            enumerable: false,
            configurable: false,
            writable: false
        });
        return response;
    }
}
