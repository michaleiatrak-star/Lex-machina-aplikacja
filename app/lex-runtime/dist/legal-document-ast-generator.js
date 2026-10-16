import { SESSION_EXECUTION_INTERNAL } from "./session-executor.js";
import { DOCUMENT_TYPES, STYLE_PROFILES, validateLegalDocumentAst } from "./legal-document-ast.js";
import { DOCUMENT_OUTPUT_CONTRACT_HEADING } from "./document-output-contract.js";
import { isLetterMarkup, LETTER_MARKUP_CONTRACT, letterMarkupAst, LetterMarkupError } from "./letter-markup.js";
import { ExportGateBlockedError } from "./document-authoring-service.js";
import { verificationOnlyBlock } from "./document-generation-validation.js";
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
// the runtime fills and normalizes it (block shapes: normalizeAstBlocks); a valid but
// different documentType/styleProfile still fails the contract check.
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
// Inline content in the shape the validator expects: a list of inline nodes. Models
// write a paragraph as "content": "ok", "text": "ok", one node object or a list of
// strings; only the shape is changed, never the wording.
function normalizeInlines(value) {
    if (typeof value === "string")
        return [{ type: "text", text: value }];
    if (isRecord(value))
        return [normalizeInline(value)];
    if (Array.isArray(value)) {
        return value.map((item) => typeof item === "string"
            ? { type: "text", text: item }
            : isRecord(item)
                ? normalizeInline(item)
                : item);
    }
    return value;
}
function normalizeInline(node) {
    if (node.type === undefined && typeof node.text === "string") {
        return { ...node, type: "text" };
    }
    return node;
}
const INLINE_BLOCKS = new Set(["paragraph", "heading", "quote", "signature"]);
const BLOCK_ALIASES = {
    text: { type: "paragraph" },
    para: { type: "paragraph" },
    p: { type: "paragraph" },
    title: { type: "heading", level: 1 },
    h1: { type: "heading", level: 1 },
    h2: { type: "heading", level: 2 },
    h3: { type: "heading", level: 3 }
};
function normalizeBlock(value, depth = 0) {
    if (typeof value === "string") {
        return { type: "paragraph", content: [{ type: "text", text: value }] };
    }
    if (!isRecord(value) || depth > 4)
        return value;
    const alias = typeof value.type === "string" ? BLOCK_ALIASES[value.type] : undefined;
    const block = alias
        ? { ...value, type: alias.type, ...(alias.level && value.level === undefined ? { level: alias.level } : {}) }
        : { ...value };
    if (typeof block.type === "string" && INLINE_BLOCKS.has(block.type)) {
        const content = block.content ?? block.text ?? block.inlines ?? block.children;
        block.content = normalizeInlines(content);
        if (block.type === "heading") {
            const level = Number(block.level ?? 1);
            block.level = Number.isInteger(level) ? Math.min(3, Math.max(1, level)) : 1;
        }
    }
    else if (block.type === "list") {
        if (typeof block.ordered !== "boolean") {
            block.ordered = block.ordered === "true" || block.style === "ordered" || block.numbered === true;
        }
        if (Array.isArray(block.items)) {
            block.items = block.items.map((item) => isRecord(item) && item.type === undefined && (item.content ?? item.text) !== undefined
                ? normalizeInlines(item.content ?? item.text)
                : normalizeInlines(item));
        }
    }
    else if (block.type === "table" && Array.isArray(block.rows)) {
        block.rows = block.rows.map((row) => Array.isArray(row)
            ? row.map((cell) => {
                if (isRecord(cell) && Array.isArray(cell.blocks)) {
                    return { ...cell, blocks: cell.blocks.map((child) => normalizeBlock(child, depth + 1)) };
                }
                if (Array.isArray(cell)) {
                    return { blocks: cell.map((child) => normalizeBlock(child, depth + 1)) };
                }
                const text = isRecord(cell) ? cell.content ?? cell.text : cell;
                return { blocks: [normalizeBlock({ type: "paragraph", content: normalizeInlines(text ?? "") }, depth + 1)] };
            })
            : row);
    }
    return block;
}
export function normalizeAstBlocks(value) {
    if (!isRecord(value))
        return value;
    return {
        ...value,
        ...(value.title !== undefined ? { title: normalizeInlines(value.title) } : {}),
        ...(Array.isArray(value.blocks)
            ? { blocks: value.blocks.map((block) => normalizeBlock(block)) }
            : {})
    };
}
// Shape of the blocks for a rejected AST: block types, keys and value kinds only,
// never the text of the document.
function astShape(value) {
    const record = isRecord(value) ? value : {};
    const blocks = Array.isArray(record.blocks) ? record.blocks : [];
    const kind = (item) => Array.isArray(item) ? "lista" : item === null ? "null" : typeof item;
    return blocks
        .slice(0, 6)
        .map((block, index) => isRecord(block)
        ? `blok ${index + 1}: type=${JSON.stringify(block.type ?? null)}; ` +
            Object.keys(block)
                .filter((key) => key !== "type")
                .slice(0, 8)
                .map((key) => `${key}:${kind(block[key])}`)
                .join(", ")
        : `blok ${index + 1}: ${kind(block)}`)
        .join("\n") || "brak bloków";
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
        ...(request.sourceText
            ? [
                `# TEKST PISMA DO ODWZOROWANIA — ${request.sourceText.label}`,
                "Przenieś ten tekst do bloków dokumentu 1:1: bez zmian merytorycznych, bez skracania i bez dopisków; tylko podział na nagłówki, akapity, listy i podpis. Tekst spoza tego bloku nie wchodzi do dokumentu.",
                request.sourceText.text,
                ""
            ]
            : []),
        DOCUMENT_OUTPUT_CONTRACT_HEADING,
        ...(letterMarkupMode(request)
            ? [
                LETTER_MARKUP_CONTRACT,
                "Use a professional Polish legal-office layout: concise title, the parties' blocks, a clear subject, logically separated body paragraphs, numbered demands only when useful, and the signature.",
                "For a demand for payment, include at minimum: parties, title WEZWANIE DO ZAPŁATY, basis/description of the debt, amount, due date, an additional payment deadline, payment method/account placeholder, consequence of non-payment stated proportionately, and signature.",
                "Agree verbs, adjectives and participles with the gender and number given for a PERSON alias in the map below (e.g. \"wniosła\"/\"wniósł\"); for an undetermined gender use neutral wording."
            ]
            : [
                "Return ONLY one JSON object. No Markdown fence, explanation, commentary or prose outside JSON.",
                "schemaVersion must equal \"1\".",
                "documentType must equal \"" + request.documentType + "\".",
                "locale must equal \"pl-PL\".",
                "styleProfile must equal \"" + request.styleProfile + "\".",
                "The object MUST contain a non-empty \"blocks\" array with the full text of the document. Never output routing keys (legal, primarySkill, domainSkills, executionSkills, workflowExecutionSkill).",
                "If the user refers to text from earlier in the conversation (e.g. \"wygeneruj to\"), put that text into the blocks.",
                "Allowed block types: heading(level 1-3), paragraph, quote, list, table, signature, page_break.",
                "Allowed inline types: text, pii_ref, xref.",
                "Generate the actual finished legal document, not a chat answer about the document.",
                "Do not add meta-sections such as DANE DO UZUPEŁNIENIA, UWAGI PRAKTYCZNE, CO DALEJ, HYBRID-VALIDATION, disclaimers, routing notes or explanations outside the document itself.",
                "Use a professional Polish legal-office layout: concise title, date/party/address blocks where appropriate, clear subject or heading, logically separated body paragraphs, numbered or bulleted demands only when useful, and a signature block.",
                "Letter or pleading header (the renderer lays it out from these blocks): place and date as their own first paragraph (\"Kraków, dnia 13 października 2026 r.\"), the sender's and the parties' blocks as paragraphs, the court or authority as one paragraph starting with its name (\"Sąd Rejonowy ...\", \"Do ...\"), lines of one address separated by \\n inside the text node, the title of the letter as a level-1 heading, the signer in a signature block; for a contract the title as a level-1 heading and each \"§ N\" as a level-2 heading.",
                "For reusable templates, place missing user data directly in neutral square-bracket fields such as [Miejscowość, data], [Kwota] or [Termin zapłaty]; never use the marker [UZUPEŁNIJ].",
                "Avoid Markdown markers such as **, # or backticks inside text nodes. Structure belongs in AST block types.",
                "For a demand for payment, include at minimum: parties, title WEZWANIE DO ZAPŁATY, basis/description of the debt, amount, due date, an additional payment deadline, payment method/account placeholder, consequence of non-payment stated proportionately, and signature.",
                "Never emit raw OOXML, ODF, HTML, scripts, macros, URLs as package relationships, or executable content.",
                "Never place token-looking syntax inside a text node.",
                "When protected source context contains a source PII token listed below, use its generation alias only as a typed pii_ref node.",
                "HARD GATE: every PERSON or ADDRESS pii_ref MUST carry the grammatical case of that occurrence as \"case\" (a pii_ref without it is an error): NOM, GEN, DAT, ACC, INS, LOC or VOC, e.g. {\"type\":\"pii_ref\",\"alias\":\"[LMPII:D01:PERSON:0001]\",\"case\":\"GEN\"} after \"wobec\" or \"od\", or \"LOC\" for an ADDRESS after \"przy\". The value is inflected locally; never write the name or address yourself.",
                "Agree verbs, adjectives and participles with the gender and number given for a PERSON alias in the map below (e.g. \"wniosła\"/\"wniósł\", \"pozwana\"/\"pozwany\", several persons: \"wnieśli\"/\"wniosły\"); for an undetermined gender use neutral wording. Several persons on one side of a case: name all of them and state expressly whether the demand or award is joint and several (solidarnie) or in shares; never assume it without a factual basis.",
            ]),
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
function astDiagnostic(value, code) {
    const record = isRecord(value) ? value : {};
    const shown = (key) => {
        const item = record[key];
        return item === undefined ? "brak" : JSON.stringify(item).slice(0, 60);
    };
    return new DocumentAstSessionBlockedError(["schemaVersion", "documentType", "locale", "styleProfile"]
        .map((key) => `${key}=${shown(key)}`)
        .join("; ") +
        `; blocks=${Array.isArray(record.blocks) ? `${record.blocks.length} bloków` : "brak"}`, `klucze odpowiedzi: ${Object.keys(record).slice(0, 20).join(", ") || "(nie obiekt JSON)"}\n${astShape(record)}`, code, "DOCUMENT_AST_VALIDATION");
}
const UNVERIFIED_STATUSES = new Set(["UNVERIFIED_MARKED", "UNVERIFIED_NOT_MARKED"]);
/**
 * A session the chat may present as a draft (DRAFT_PRESENTABLE, DEGRADED) whose only blockers
 * are unverified legal references: the file can be a draft with them named, on the user's
 * decision. A fabricated or mismatched reference, a missing step or resource still blocks.
 */
export function unverifiedOnlySession(result) {
    const events = result[SESSION_EXECUTION_INTERNAL]?.auditEvents ?? [];
    return (result.status === "DRAFT_PRESENTABLE" &&
        result.finalization === "DEGRADED" &&
        Boolean(result.answer) &&
        !(result.audit.missing?.length) &&
        (result.audit.violations ?? []).every((violation) => violation === "blocked_event_present") &&
        !(result.workflow?.missingResources.length) &&
        result.blockedReferences.length > 0 &&
        result.blockedReferences.every((reference) => UNVERIFIED_STATUSES.has(reference.status)) &&
        events.every((event) => event.status !== "BLOCKED" || verificationOnlyBlock(event)));
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
// The model writes chat habits into the AST text: Markdown emphasis and headings, a Markdown
// table or list inside one paragraph, its own numbers in a numbered list, blank lines, a code
// fence, a literal "\n". The file renders text as written, so "**Powód:**", "## Uzasadnienie"
// and "1. 1. zasądzenie" reached the DOCX/ODT. The structure is rebuilt here, before validation.
// A run of underscores is a blank to fill in ("Data: __________"), not emphasis.
const EMPHASIS = /(?<!\*)\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*(?!\*)|(?<!_)__(?=[^\s_])([\s\S]*?[^\s_])__(?!_)|`([^`\n]+)`/gu;
const HEADING_LINE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;
const FENCE_LINE = /^\s*```[\w-]*\s*$/u;
// Decimal numbers only: a lettered enumeration ("a) ... b) ...") is cited as "lit. a" and keeps its letters.
const ORDERED_ITEM = /^\s*\d{1,3}[.)]\s+/u;
const BULLET_ITEM = /^\s*[-•*–]\s+/u;
const TABLE_ROW = /^\s*\|.*\|\s*$/u;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/u;
function cleanText(text) {
    return text
        .replace(/\\n/gu, "\n")
        .replace(EMPHASIS, (_match, bold, underline, code) => bold ?? underline ?? code)
        .split("\n")
        .filter((line) => !FENCE_LINE.test(line))
        .join("\n");
}
function cleanInlines(content) {
    if (!Array.isArray(content))
        return content;
    return content.map((node) => isRecord(node) && node.type === "text" && typeof node.text === "string" ? { ...node, text: cleanText(node.text) } : node);
}
const onlyText = (content) => Array.isArray(content) && content.every((node) => isRecord(node) && node.type === "text" && typeof node.text === "string")
    ? content.map((node) => node.text).join("")
    : null;
const textNode = (text) => [{ type: "text", text }];
const blank = (content) => (onlyText(content) ?? "x").trim() === "";
// One paragraph of plain text split by its own structure: blank lines, a heading line, a
// Markdown table, list lines. Text with references to aliases (pii_ref, xref) keeps its shape.
function splitParagraph(text) {
    const out = [];
    const chunks = text.split(/\n[ \t]*\n+/u);
    for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let prose = [];
        const flush = () => {
            const body = prose.join("\n").trim();
            if (body)
                out.push({ type: "paragraph", content: textNode(body) });
            prose = [];
        };
        for (let index = 0; index < lines.length;) {
            const line = lines[index];
            const heading = HEADING_LINE.exec(line);
            if (heading) {
                flush();
                out.push({ type: "heading", level: Math.min(3, heading[1].length), content: textNode(heading[2]) });
                index += 1;
                continue;
            }
            if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1])) {
                flush();
                const rows = [];
                for (; index < lines.length && TABLE_ROW.test(lines[index]); index += 1) {
                    if (TABLE_RULE.test(lines[index]))
                        continue;
                    rows.push(lines[index].trim().replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim()));
                }
                out.push({ type: "table", rows: rows.map((row) => row.map((cell) => ({ blocks: [{ type: "paragraph", content: textNode(cell || " ") }] }))) });
                continue;
            }
            const ordered = ORDERED_ITEM.test(line);
            if ((ordered || BULLET_ITEM.test(line)) && (index + 1 < lines.length ? ORDERED_ITEM.test(lines[index + 1]) || BULLET_ITEM.test(lines[index + 1]) : prose.length > 0)) {
                flush();
                const items = [];
                for (; index < lines.length && (ORDERED_ITEM.test(lines[index]) || BULLET_ITEM.test(lines[index])); index += 1) {
                    const item = lines[index].replace(ORDERED_ITEM, "").replace(BULLET_ITEM, "").trim();
                    if (item)
                        items.push(textNode(item));
                }
                if (items.length)
                    out.push({ type: "list", ordered, items });
                continue;
            }
            prose.push(line);
            index += 1;
        }
        flush();
    }
    return out;
}
function cleanBlock(block) {
    if (!isRecord(block))
        return [block];
    if (block.type === "heading" || block.type === "quote" || block.type === "signature") {
        const content = cleanInlines(block.content);
        const text = onlyText(content);
        if (block.type === "heading" && text !== null) {
            const plain = text.replace(/^\s*#{1,6}\s+/u, "").replace(/\s+/gu, " ").trim();
            return plain ? [{ ...block, content: textNode(plain) }] : [];
        }
        return blank(content) ? [] : [{ ...block, content }];
    }
    if (block.type === "paragraph") {
        const content = cleanInlines(block.content);
        const text = onlyText(content);
        if (text === null)
            return [{ ...block, content }];
        return splitParagraph(text);
    }
    if (block.type === "list" && Array.isArray(block.items)) {
        const marker = block.ordered ? ORDERED_ITEM : BULLET_ITEM;
        const items = block.items
            .map((item) => {
            const content = cleanInlines(item);
            const text = onlyText(content);
            return text === null ? content : textNode(text.replace(marker, "").replace(BULLET_ITEM, "").trim());
        })
            .filter((item) => !blank(item));
        return items.length ? [{ ...block, items }] : [];
    }
    if (block.type === "table" && Array.isArray(block.rows)) {
        return [{
                ...block,
                rows: block.rows.map((row) => Array.isArray(row)
                    ? row.map((cell) => (isRecord(cell) && Array.isArray(cell.blocks) ? { ...cell, blocks: cell.blocks.flatMap((child) => cleanBlock(child)) } : cell))
                    : row)
            }];
    }
    return [block];
}
export function cleanAstMarkup(value) {
    if (!isRecord(value) || !Array.isArray(value.blocks))
        return value;
    return {
        ...value,
        ...(value.title !== undefined ? { title: cleanInlines(value.title) } : {}),
        blocks: value.blocks.flatMap((block) => cleanBlock(block))
    };
}
const AST_GENERATION_ATTEMPTS = 2;
const REPAIRABLE_AST_ERROR = /^(?:DOCUMENT_AST_JSON_(?:MISSING|INVALID)|DOCUMENT_AST_CONTRACT_MISMATCH|AST_[A-Z_]+|LETTER_MARKUP_[A-Z_]+(?::[A-Z_]+)?)$/u;
/**
 * A letter or a pleading outside the process pipeline: the model writes the text in the
 * letter markup (letter-markup.ts) and the application lays it out, in the office's style.
 */
export function letterMarkupMode(request) {
    return (request.documentType === "letter" || request.documentType === "pleading") && !request.processRenderOnly;
}
function parseValidatedAst(answer, request) {
    // An answer the provider cut (its note at the end): never a file, whatever its format.
    if (/\[ODPOWIEDŹ UCIĘTA\b/u.test(answer))
        throw new Error("DOCUMENT_OUTPUT_TRUNCATED");
    // The letter markup: the AST is made here, its text as the model wrote it (no normalization).
    if (letterMarkupMode(request) && isLetterMarkup(answer)) {
        return validateLegalDocumentAst(letterMarkupAst(answer, request), request.aliases.entries);
    }
    // Neither the markup nor JSON (prose about the letter): the repair round asks for the markup.
    if (letterMarkupMode(request) && !answer.includes("{"))
        throw new LetterMarkupError("LETTER_MARKUP_MISSING");
    const parsed = cleanAstMarkup(normalizeAstBlocks(normalizeAstHeader(extractJson(answer), request)));
    let validated;
    try {
        validated = validateLegalDocumentAst(parsed, request.aliases.entries);
    }
    catch (error) {
        // Any AST shape error: header fields and block shapes (never document text).
        if (error instanceof Error && /^AST_[A-Z_]+$/.test(error.message)) {
            throw astDiagnostic(parsed, error.message);
        }
        throw error;
    }
    if (validated.ast.documentType !== request.documentType || validated.ast.styleProfile !== request.styleProfile) {
        throw new Error("DOCUMENT_AST_CONTRACT_MISMATCH");
    }
    return validated;
}
export class LegalDocumentAstGenerator {
    sessions;
    constructor(sessions) {
        this.sessions = sessions;
    }
    async generate(request) {
        // A malformed AST (no JSON, a block shape, the wrong type) gets one repair round with the
        // validation error; a session the gates blocked is a policy decision and is not retried.
        let repair = null;
        let acceptedUnverified = null;
        let result;
        let validated;
        for (let attempt = 1;; attempt += 1) {
            result = await this.sessions.execute({
                query: generationInstruction(request) + (repair ? `\n\n${repair}` : ""),
                provider: request.provider,
                model: request.model,
                primarySkill: request.primarySkill,
                mode: request.mode,
                documentAstOutput: true,
                // The instruction carries the whole conversation; a resumed account thread
                // (ChatGPT via Codex) made the model copy earlier router JSON instead of the AST.
                accountContinuity: "none",
                ...(request.privacySeed ? { privacySeed: request.privacySeed } : {}),
                ...(request.processRenderOnly ? { processRenderOnly: request.processRenderOnly } : {}),
                ...(request.attachments?.length
                    ? { documentAttachments: request.attachments }
                    : {})
            });
            if (result.status !== "DRAFT_PRESENTABLE" ||
                result.finalization !== "PASS" ||
                result.audit.result !== "PASS" ||
                !result.answer) {
                if (!unverifiedOnlySession(result))
                    throw blockedSessionDiagnostic(result);
                if (!request.acceptUnverified) {
                    // The same decision as at the export gate: a draft with these references named.
                    throw new ExportGateBlockedError("READY_DOCUMENT_EXPORT_GATE_BLOCKED", ["UNVERIFIED_REFERENCE_REQUIRES_HUMAN_DECISION"], result.blockedReferences
                        .filter((reference, index, all) => all.findIndex((other) => other.claim === reference.claim) === index)
                        .map((reference) => ({ claim: reference.claim, status: reference.status, line: reference.line })), true);
                }
                acceptedUnverified = [...new Set(result.blockedReferences.map((reference) => reference.claim))];
            }
            try {
                validated = parseValidatedAst(result.answer ?? "", request);
                break;
            }
            catch (error) {
                const code = error instanceof Error ? error.message : String(error);
                if (attempt >= AST_GENERATION_ATTEMPTS || !REPAIRABLE_AST_ERROR.test(code))
                    throw error;
                const detail = error instanceof DocumentAstSessionBlockedError ? `${error.reason}` : "";
                repair = letterMarkupMode(request)
                    ? `BŁĄD WALIDACJI POPRZEDNIEJ ODPOWIEDZI: ${code}${detail ? ` (${detail})` : ""}. Zwróć ponownie całe pismo w LETTER MARKUP opisanym powyżej (znaczniki @… na początku linii, wymagany @TYTUL:, tylko tekst pisma).`
                    : `BŁĄD WALIDACJI POPRZEDNIEJ ODPOWIEDZI: ${code}${detail ? ` (${detail})` : ""}. Zwróć ponownie cały dokument jako jeden obiekt JSON zgodny z kontraktem AST powyżej: bez Markdown, bez komentarzy, documentType "${request.documentType}", styleProfile "${request.styleProfile}".`;
            }
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
                ...(acceptedUnverified ? { acceptedUnverifiedSource: { claims: acceptedUnverified } } : {}),
                sourceSessionId: result.sessionId,
                primarySkill: request.primarySkill,
                provider: request.provider,
                model: request.model,
                usedDocumentContext: Boolean(request.attachments
                    ?.length),
                ...(internal.caseFileNumbers?.length ? { caseFileNumbers: [...internal.caseFileNumbers] } : {}),
                ...(internal.factAmounts?.length ? { factAmounts: [...internal.factAmounts] } : {}),
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
