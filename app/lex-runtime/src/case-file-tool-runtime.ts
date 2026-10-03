import type {
  NormalizedToolCall,
  NormalizedToolResult,
  NormalizedToolSchema
} from "./providers/types.js";
import type { CaseKnowledgeHit } from "./case-knowledge-search.js";

const LIST_TOOL = "list_case_files";
const SEARCH_TOOL = "search_case_files";
const READ_TOOL = "read_case_file";

const MAX_SEARCH_HITS = 8;
const SNIPPET_CHARS = 700;
const MAX_READ_CHUNKS = 6;
// Reads in one turn: the files must not crowd out the answer.
const DEFAULT_TURN_CHARS = 120_000;

export type CaseFileChunk = {
  index: number;
  pageStart: number;
  pageEnd: number;
  text: string;
};

/**
 * The matter's files, pseudonymized as stored, for one turn. Bound by the
 * HTTP layer to the caller's access to one case; never parsed from a request.
 */
export type CaseFileAccess = {
  caseId: string;
  listDocuments(): Promise<Array<{ documentId: string; totalPages: number; chunks: number }>>;
  search(query: string, limit: number): Promise<CaseKnowledgeHit[]>;
  // Restores the document locally (its key restores the answer's aliases).
  readChunks(documentId: string, chunkIndices: number[]): Promise<{ totalPages: number; chunks: CaseFileChunk[] }>;
  // Uses the chat's shared key in this turn: tokens are shown unchanged.
  sharedKey(documentId: string): boolean;
};

export type CaseFileAuditEvent = {
  tool: string;
  target: string;
  decision: "ALLOW" | "BLOCK";
  detail?: Record<string, unknown>;
};

const SCHEMAS: NormalizedToolSchema[] = [
  {
    type: "function",
    function: {
      name: LIST_TOOL,
      description:
        "List all documents in the matter's files: documentId, pages, chunk count and whether the document (or which chunks) is already in LOCAL_DOCUMENT_CONTEXT.",
      parameters: { type: "object", additionalProperties: false, properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: SEARCH_TOOL,
      description:
        "Search the full text of every document in the matter's files (not only the excerpts in context). Returns documentId, chunk, pages and a snippet. Use words from the documents, not symbols.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", description: "Words that occur in the passage, e.g. 'termin zapłaty faktury'." },
          limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_HITS }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: READ_TOOL,
      description:
        "Read whole chunks of one document from the matter's files, with page markers. Cite them with [[LEXDOC:<documentId>:<chunkIndex>]] like the context.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["documentId", "chunks"],
        properties: {
          documentId: { type: "string", description: "doc_... from list_case_files or search_case_files." },
          chunks: {
            type: "array",
            items: { type: "integer", minimum: 1 },
            minItems: 1,
            maxItems: MAX_READ_CHUNKS
          }
        }
      }
    }
  }
];

// Symbols in the query mean nothing to the stored text.
function cleanQuery(query: string): string {
  return query.replace(/\[(?:PII|LMPII):[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
}

function snippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const term = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, Math.max(4, word.length - 2)))
    .find((stem) => lower.includes(stem));
  const at = term ? Math.max(0, lower.indexOf(term) - 200) : 0;
  return (at > 0 ? "… " : "") + text.slice(at, at + SNIPPET_CHARS).replace(/\s+/g, " ") + (at + SNIPPET_CHARS < text.length ? " …" : "");
}

export class CaseFileToolRuntime {
  private readonly events: CaseFileAuditEvent[] = [];
  private readonly read: Array<{ documentId: string; chunks: CaseFileChunk[] }> = [];
  private usedChars = 0;

  constructor(
    private readonly access: CaseFileAccess,
    private readonly options: {
      // documentId -> chunk indices already in LOCAL_DOCUMENT_CONTEXT.
      inContext: Map<string, Set<number>>;
      // Own-key prefix (D01...) of a document; assigns the next one if new.
      prefixFor: (documentId: string) => string;
      namespace: (text: string, prefix: string) => string;
      markPages: (text: string, totalPages?: number) => string;
      maxTurnChars?: number;
    }
  ) {}

  schemas(): NormalizedToolSchema[] {
    return SCHEMAS;
  }

  handles(name: string): boolean {
    return name === LIST_TOOL || name === SEARCH_TOOL || name === READ_TOOL;
  }

  systemPromptAppendix(): string {
    return [
      "# AKTA SPRAWY (NARZĘDZIA)",
      "LOCAL_DOCUMENT_CONTEXT zawiera tylko część akt dobraną do budżetu okna. Pełne akta sprawy (wszystkie dokumenty, wszystkie fragmenty) są dostępne przez narzędzia:",
      `- ${LIST_TOOL}: spis dokumentów i co z nich już jest w kontekście;`,
      `- ${SEARCH_TOOL}: wyszukanie fragmentów w całych aktach;`,
      `- ${READ_TOOL}: pełny tekst wskazanych fragmentów.`,
      "Zanim stwierdzisz, że czegoś w aktach nie ma, albo oprzesz ustalenie na dokumencie, którego fragmentu nie masz, przeszukaj akta. Tekst z narzędzi jest spseudonimizowany jak kontekst; symbole przepisuj dokładnie i cytuj fragmenty znacznikiem [[LEXDOC:<documentId>:<chunkIndex>]].",
      "Akta nie są źródłem prawa: przepisy weryfikuj jak dotąd."
    ].join("\n");
  }

  auditEvents(): CaseFileAuditEvent[] {
    return this.events.map((event) => ({ ...event, ...(event.detail ? { detail: { ...event.detail } } : {}) }));
  }

  /** Chunks read in this turn, as stored (for citation checks). */
  readChunks(): Array<{ documentId: string; chunks: CaseFileChunk[] }> {
    return this.read.map((item) => ({ documentId: item.documentId, chunks: item.chunks.map((chunk) => ({ ...chunk })) }));
  }

  private alias(documentId: string, text: string): string {
    return this.access.sharedKey(documentId) ? text : this.options.namespace(text, this.options.prefixFor(documentId));
  }

  private result(call: NormalizedToolCall, body: Record<string, unknown>): NormalizedToolResult {
    return { tool_use_id: call.id, content: JSON.stringify(body) };
  }

  private block(call: NormalizedToolCall, target: string, error: string): NormalizedToolResult {
    this.events.push({ tool: call.name, target, decision: "BLOCK", detail: { error } });
    return this.result(call, { status: "BLOCKED", error });
  }

  async runTools(calls: NormalizedToolCall[]): Promise<NormalizedToolResult[]> {
    const results: NormalizedToolResult[] = [];
    for (const call of calls) {
      try {
        results.push(await this.run(call));
      } catch (error) {
        results.push(this.block(call, this.access.caseId, error instanceof Error ? error.message : "CASE_FILE_TOOL_FAILED"));
      }
    }
    return results;
  }

  private async run(call: NormalizedToolCall): Promise<NormalizedToolResult> {
    const input = call.input ?? {};
    if (call.name === LIST_TOOL) {
      const documents = await this.access.listDocuments();
      this.events.push({ tool: call.name, target: this.access.caseId, decision: "ALLOW", detail: { documents: documents.length } });
      return this.result(call, {
        status: "OK",
        documents: documents.map((document) => {
          const inContext = this.options.inContext.get(document.documentId);
          return {
            ...document,
            inContext: !inContext ? "NONE" : inContext.size >= document.chunks ? "FULL" : [...inContext].sort((a, b) => a - b)
          };
        })
      });
    }

    if (call.name === SEARCH_TOOL) {
      const query = typeof input.query === "string" ? cleanQuery(input.query) : "";
      const limit = typeof input.limit === "number" && Number.isInteger(input.limit) ? Math.min(Math.max(input.limit, 1), MAX_SEARCH_HITS) : 6;
      if (query.length < 2) return this.block(call, this.access.caseId, "INVALID_KNOWLEDGE_QUERY");
      const hits = await this.access.search(query, limit);
      this.events.push({ tool: call.name, target: this.access.caseId, decision: "ALLOW", detail: { hits: hits.length } });
      return this.result(call, {
        status: hits.length ? "OK" : "NO_MATCH",
        hits: hits.map((hit) => ({
          documentId: hit.documentId,
          chunkIndex: hit.chunkIndex,
          pages: `${hit.pageStart}-${hit.pageEnd}`,
          inContext: this.options.inContext.get(hit.documentId)?.has(hit.chunkIndex) ?? false,
          snippet: this.alias(hit.documentId, snippet(hit.text, query))
        })),
        ...(hits.length ? {} : { note: "Brak trafień w aktach: spróbuj innych słów, zanim stwierdzisz brak w aktach." })
      });
    }

    const documentId = typeof input.documentId === "string" ? input.documentId : "";
    const indices = Array.isArray(input.chunks) ? [...new Set(input.chunks)] : [];
    if (!/^doc_[a-f0-9]{24}$/.test(documentId)) return this.block(call, this.access.caseId, "INVALID_DOCUMENT_ID");
    if (
      indices.length === 0 ||
      indices.length > MAX_READ_CHUNKS ||
      indices.some((index) => typeof index !== "number" || !Number.isInteger(index) || index < 1)
    ) {
      return this.block(call, documentId, "INVALID_DOCUMENT_CHUNK_SELECTION");
    }
    const document = await this.access.readChunks(documentId, indices as number[]);
    const size = document.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    const limit = this.options.maxTurnChars ?? DEFAULT_TURN_CHARS;
    if (this.usedChars + size > limit) {
      return this.block(call, documentId, "CASE_FILE_TURN_BUDGET_EXCEEDED");
    }
    this.usedChars += size;
    let stored = this.read.find((item) => item.documentId === documentId);
    if (!stored) {
      stored = { documentId, chunks: [] };
      this.read.push(stored);
    }
    for (const chunk of document.chunks) {
      if (!stored.chunks.some((item) => item.index === chunk.index)) stored.chunks.push({ ...chunk });
    }
    this.events.push({
      tool: call.name,
      target: documentId,
      decision: "ALLOW",
      detail: { chunks: document.chunks.map((chunk) => chunk.index), chars: size }
    });
    return this.result(call, {
      status: "OK",
      documentId,
      totalPages: document.totalPages,
      chunks: document.chunks.map((chunk) => ({
        chunkIndex: chunk.index,
        pages: `${chunk.pageStart}-${chunk.pageEnd}`,
        text: this.alias(documentId, this.options.markPages(chunk.text, document.totalPages))
      })),
      remainingTurnChars: limit - this.usedChars
    });
  }
}
