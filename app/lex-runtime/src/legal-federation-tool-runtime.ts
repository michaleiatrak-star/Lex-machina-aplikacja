import {
  Client
} from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  NormalizedToolCall,
  NormalizedToolResult,
  NormalizedToolSchema
} from "./providers/types.js";
import {
  assessLegalSourceCandidate,
  classifyKnownLegalSourceUrl,
  federatedSourcePolicy
} from "./legal-source-policy.js";
import {
  AuxiliarySourceFetchError,
  SafeAuxiliarySourceFetcher
} from "./auxiliary-source-fetcher.js";
import {
  LEX_MCP_CATALOG,
  LEX_MCP_SERVER_IDS,
  type LexMcpConnectorStore,
  type LexMcpServerId
} from "./lex-mcp-connectors.js";
import {
  PublicWebSearch,
  WebSearchError,
  assertPublicWebSearchQuery,
  classifyWebSearchHits,
  type WebSearchProvider
} from "./web-search.js";

// Konektory MCP Lex Machina (audyt-systemu-v4/mcp-servers, dist/lex-mcp.mjs) zastępują
// agregator prawo-pl-mcp i flotę @matematicsolutions/*. Które serwery działają, decyduje
// instalator w Ustawieniach → Konektory MCP (LexMcpConnectorStore).
const CONNECTOR_PACKAGE =
  "lex-mcp.mjs (audyt-systemu-v4/mcp-servers)";

const SOURCE_IDS =
  LEX_MCP_SERVER_IDS;

const SOURCE_ENUM = [
  ...SOURCE_IDS
];

type SourceId =
  LexMcpServerId;

type NativeRequest = {
  tool: string;
  args: Record<string, unknown>;
};

type SearchInput = {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

// Ujednolicone search/get → natywne narzędzie serwera lex-*. Źródło bez odpowiednika
// (np. get w SAOS) mapuje się na najbliższe narzędzie odczytu; resztę daje call_federated_legal_source.
const NATIVE_SEARCH: Record<
  SourceId,
  (input: SearchInput) => NativeRequest
> = {
  isap: (input) => ({ tool: "isap_lookup", args: { query: input.query } }),
  eurlex: (input) => ({ tool: "eurlex_tsue", args: { fraza: input.query, dataOd: input.dateFrom, limit: input.limit } }),
  saos: (input) => ({ tool: "saos_search", args: { fraza: input.query, dataOd: input.dateFrom, dataDo: input.dateTo, pageSize: input.limit } }),
  cbosa: (input) => ({ tool: "cbosa_szukaj", args: { fraza: input.query, odDaty: input.dateFrom, doDaty: input.dateTo, strona: input.page } }),
  krs: (input) => ({ tool: "krs_lookup", args: { numerKrs: input.query } }),
  wl: (input) => ({ tool: "wl_sprawdz_nip", args: { nip: input.query, data: input.dateTo } }),
  ceidg: (input) => ({ tool: "ceidg_szukaj_firmy", args: { nip: input.query } }),
  nbp: (input) => ({ tool: "nbp_kurs_waluty", args: { kodWaluty: input.query, data: input.dateTo } }),
  eureka: (input) => ({ tool: "eureka_szukaj", args: { fraza: input.query, dataOd: input.dateFrom, dataDo: input.dateTo, rozmiar: input.limit } }),
  sudop: (input) => ({ tool: "sudop_szukaj_pomocy", args: { nip: input.query } }),
  uodo: (input) => ({ tool: "uodo_szukaj", args: { fraza: input.query, dataOd: input.dateFrom, dataDo: input.dateTo, strona: input.page } })
};

const NATIVE_GET: Record<
  SourceId,
  (documentId: string) => NativeRequest
> = {
  isap: (id) => ({ tool: "isap_tekst", args: { eli: id } }),
  eurlex: (id) => ({ tool: "eurlex_lookup", args: { celex: id } }),
  saos: (id) => ({ tool: "saos_search", args: { sygnatura: id } }),
  cbosa: (id) => ({ tool: "cbosa_pobierz", args: { doc_id: id } }),
  krs: (id) => ({ tool: "krs_lookup", args: { numerKrs: id } }),
  wl: (id) => ({ tool: "wl_sprawdz_nip", args: { nip: id } }),
  ceidg: (id) => ({ tool: "ceidg_szukaj_firmy", args: { nip: id } }),
  nbp: (id) => ({ tool: "nbp_kurs_waluty", args: { kodWaluty: id } }),
  eureka: (id) => ({ tool: "eureka_pobierz", args: { id } }),
  sudop: (id) => ({ tool: "sudop_odbierz_wynik", args: { kolejka_id: id } }),
  uodo: (id) => ({ tool: "uodo_pobierz", args: { urn_lub_sygnatura: id } })
};

const LOCAL_COVERAGE: Record<
  SourceId,
  {
    family: string;
    authority: string;
    role: string;
    fallback: string;
  }
> = {
  isap: {
    family: "polish-legislation",
    authority: "Sejm ELI",
    role: "retrieval",
    fallback: "Native Lex legal-act resolver, temporal freshness gate and verify_legal_reference."
  },
  eurlex: {
    family: "eu-law-and-cjeu",
    authority: "EUR-Lex/CELLAR/CJEU",
    role: "live official retrieval",
    fallback: "Native EUR-Lex/CELLAR official-source verification path."
  },
  saos: {
    family: "case-law",
    authority: "SAOS",
    role: "discovery/support",
    fallback: "Native Lex SAOS discovery; SN citations still require the official SN verifier."
  },
  cbosa: {
    family: "administrative-case-law",
    authority: "CBOSA",
    role: "snapshot 🟨 without promotion",
    fallback: "Native Lex direct-CBOSA adapter; no exact match = OUT_OF_SCOPE, never NOT_FOUND."
  },
  krs: {
    family: "company-register",
    authority: "KRS Ministry of Justice API",
    role: "registry lookup",
    fallback: "Native official KRS API path used by the entity verification gate."
  },
  wl: {
    family: "vat-register",
    authority: "Wykaz podatników VAT (MF)",
    role: "registry lookup",
    fallback: "Official white-list API at wl-api.mf.gov.pl."
  },
  ceidg: {
    family: "sole-trader-register",
    authority: "CEIDG API v3",
    role: "registry lookup (requires API key)",
    fallback: "Companies are not in CEIDG — use KRS; without a key the source is unavailable, not empty."
  },
  nbp: {
    family: "exchange-rates",
    authority: "NBP table A",
    role: "official data",
    fallback: "Official NBP API."
  },
  eureka: {
    family: "tax-interpretations",
    authority: "EUREKA MF/KIS",
    role: "interpretive practice",
    fallback: "EUREKA web/source lookup; statutory propositions still require ELI verification."
  },
  sudop: {
    family: "state-aid-register",
    authority: "SUDOP (UOKiK)",
    role: "registry lookup",
    fallback: "Official SUDOP search; asynchronous results may need sudop_odbierz_wynik."
  },
  uodo: {
    family: "data-protection-decisions",
    authority: "UODO",
    role: "decisional practice",
    fallback: "Native Lex official UODO API path."
  }
};

export type LegalFederationAuditEvent = {
  tool: string;
  source?: string;
  decision:
    "ALLOW" |
    "BLOCK";
  // Tylko przy BLOCK: POLICY_BLOCKED = odmowa polityki źródeł/prywatności,
  // SOURCE_UNAVAILABLE = źródło nie odpowiedziało (nie jest dowodem braku).
  outcome?:
    "POLICY_BLOCKED" |
    "SOURCE_UNAVAILABLE";
  detail?:
    Record<string, unknown>;
};

const LIST_TOOL =
  "list_federated_legal_sources";
const SEARCH_TOOL =
  "search_federated_legal_sources";
const GET_TOOL =
  "get_federated_legal_document";
const CALL_TOOL =
  "call_federated_legal_source";
const COVERAGE_TOOL =
  "federated_legal_coverage";
const ASSESS_SOURCE_TOOL =
  "assess_legal_source";
const FETCH_AUXILIARY_SOURCE_TOOL =
  "fetch_auxiliary_legal_source";
const WEB_SEARCH_TOOL =
  "web_search";

const LIST_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name: LIST_TOOL,
      description:
        "List the read-only Polish/EU legal sources served by the Lex Machina MCP connectors (lex-mcp). " +
        "Use without sourceId for the catalog with installation status; provide sourceId to inspect live native tool schemas. " +
        "This is research/discovery only and never replaces Lex Machina citation verification.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceId: {
            type: "string",
            enum: SOURCE_ENUM
          },
          group: {
            type: "string",
            enum: [
              "pl",
              "eu"
            ]
          }
        }
      }
    }
  };

const SEARCH_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name: SEARCH_TOOL,
      description:
        "Search one Lex Machina MCP source. " +
        "Sources: ISAP/ELI, EUR-Lex/CJEU, SAOS, NSA/WSA (cbosa), KRS, VAT white list (wl), CEIDG, NBP, EUREKA/KIS, SUDOP and UODO. " +
        "Registry sources (krs, wl, ceidg, sudop) take the identifier (KRS number, NIP) as query; nbp takes the currency code. " +
        "Search results are discovery material; fetch the document before relying on its contents.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "source"
        ],
        properties: {
          source: {
            type: "string",
            enum: SOURCE_ENUM
          },
          query: {
            type: "string"
          },
          dateFrom: {
            type: "string",
            description:
              "Optional YYYY-MM-DD."
          },
          dateTo: {
            type: "string",
            description:
              "Optional YYYY-MM-DD."
          },
          page: {
            type: "integer",
            minimum: 1
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100
          },
          extra: {
            type: "object",
            description:
              "Optional source-native filters. Inspect the source schema first when uncertain."
          }
        }
      }
    }
  };

const GET_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name: GET_TOOL,
      description:
        "Fetch a full legal/research document from one federated source by the identifier returned from search. " +
        "Long documents are paginated. Federation documents remain research evidence; statutory and SN citation hard gates still use Lex Machina verification tools.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "source",
          "documentId"
        ],
        properties: {
          source: {
            type: "string",
            enum: SOURCE_ENUM
          },
          documentId: {
            type: "string"
          },
          page: {
            type: "integer",
            minimum: 1
          },
          extra: {
            type: "object"
          }
        }
      }
    }
  };

const CALL_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name: CALL_TOOL,
      description:
        "Call a source-specific read-only Lex MCP tool, e.g. saos_cytator, krs_reprezentacja, cbosa_sprawdz_sygnature, wl_sprawdz_rachunek or eureka_sprawdz_sygnature. " +
        "The tool name must start with the source id and an underscore. " +
        "Inspect the source schema first. This tool cannot create Lex Machina VERIFIED markers.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "source",
          "tool"
        ],
        properties: {
          source: {
            type: "string",
            enum: SOURCE_ENUM
          },
          tool: {
            type: "string"
          },
          arguments: {
            type: "object"
          }
        }
      }
    }
  };

const ASSESS_SOURCE_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name:
        ASSESS_SOURCE_TOOL,
      description:
        "Classify and assess a public legal/research URL under Lex Machina source hierarchy without fetching it. " +
        "Known R1/R2A/R2B domains are classified deterministically; unknown domains are conservatively R3 until editorial criteria are independently established. " +
        "This tool never creates VERIFIED/SUPPORTED status and never replaces native verification.",
      parameters: {
        type: "object",
        additionalProperties:
          false,
        required: [
          "url"
        ],
        properties: {
          url: {
            type: "string",
            description:
              "Public HTTP(S) source URL to classify."
          },
          claim: {
            type: "string",
            description:
              "Optional exact proposition for which this source is being assessed."
          },

        }
      }
    }
  };

const FETCH_AUXILIARY_SOURCE_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name:
        FETCH_AUXILIARY_SOURCE_TOOL,
      description:
        "Safely fetch one public R2B/R3 auxiliary legal-research page through Lex Machina's SSRF-protected HTTPS retriever. " +
        "Use only after you have a specific public URL. The runtime classifies the final URL, extracts source-owned publication dates and records a content hash. " +
        "This tool never creates VERIFIED/SUPPORTED status and R2B/R3 can never be the sole legal basis.",
      parameters: {
        type: "object",
        additionalProperties:
          false,
        required: [
          "url"
        ],
        properties: {
          url: {
            type: "string",
            description:
              "Specific public HTTPS URL for an auxiliary legal/research page. Never include case facts, PII tokens or protected document context."
          },
          claim: {
            type: "string",
            description:
              "Optional exact public legal proposition being researched. Do not include client-specific facts."
          }
        }
      }
    }
  };

const WEB_SEARCH_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name:
        WEB_SEARCH_TOOL,
      description:
        "General internet search (DuckDuckGo, or Brave when BRAVE_SEARCH_API_KEY is set). " +
        "Returns titles, URLs and snippets, each classified R1/R2A/R2B/R3. Snippets are never evidence: " +
        "verify R1/R2A hits with the native verifiers and read R2B/R3 hits with fetch_auxiliary_legal_source.",
      parameters: {
        type: "object",
        additionalProperties:
          false,
        required: [
          "query"
        ],
        properties: {
          query: {
            type: "string",
            description:
              "Neutral public search phrase (max 300 chars). Never include case facts, names, PII tokens or document text."
          },
          maxResults: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description:
              "Number of results, default 5."
          }
        }
      }
    }
  };

const COVERAGE_SCHEMA:
  NormalizedToolSchema = {
    type: "function",
    function: {
      name: COVERAGE_TOOL,
      description:
        "Return Lex MCP connector coverage, installation status and known gaps. Use after an empty search before claiming that a legal source or material does not exist.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {}
      }
    }
  };

function guardOutboundPayload(
  value:
    Record<string, unknown>
): Record<string, unknown> {
  const serialized =
    JSON.stringify(
      value
    );
  if (
    serialized.length >
      20_000
  ) {
    throw new Error(
      "FEDERATED_PAYLOAD_TOO_LARGE"
    );
  }
  if (
    /\[(?:DOCUMENT|CASE KNOWLEDGE|FIRM KNOWLEDGE)\s/i
      .test(
        serialized
      ) ||
    /\[(?:LM)?PII:/i
      .test(
        serialized
      )
  ) {
    throw new Error(
      "FEDERATED_CASE_DATA_FORBIDDEN"
    );
  }
  return value;
}

function sourceFrom(
  input:
    Record<string, unknown>
): SourceId | undefined {
  const raw =
    typeof input.source ===
      "string"
      ? input.source
      : typeof input.sourceId ===
          "string"
        ? input.sourceId
        : undefined;
  if (
    !raw ||
    !SOURCE_IDS.includes(
      raw as SourceId
    )
  ) {
    return undefined;
  }
  return raw as SourceId;
}

function extractToolText(
  value: unknown
): string {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return String(
      value ?? ""
    );
  }

  const result =
    value as {
      content?: Array<
        {
          type?: string;
          text?: string;
        }
      >;
      structuredContent?: unknown;
      isError?: boolean;
    };

  const text =
    (result.content ?? [])
      .filter(
        (item) =>
          item.type === "text" &&
          typeof item.text ===
            "string"
      )
      .map(
        (item) =>
          item.text!
      )
      .join("\n");

  if (text) {
    if (
      result.isError
    ) {
      throw new Error(
        text
      );
    }
    return text;
  }

  if (
    result.structuredContent !==
      undefined
  ) {
    const serialized =
      JSON.stringify(
        result.structuredContent
      );
    if (
      result.isError
    ) {
      throw new Error(
        serialized
      );
    }
    return serialized;
  }

  if (
    result.isError
  ) {
    throw new Error(
      "FEDERATED_LEGAL_SOURCE_ERROR"
    );
  }

  return JSON.stringify(
    value
  );
}

export function annotateFederatedLegalContent(
  source:
    string,
  content:
    string
): string {
  const sourcePolicy =
    federatedSourcePolicy(
      source
    );

  try {
    const parsed =
      JSON.parse(
        content
      ) as unknown;

    if (
      parsed &&
      typeof parsed ===
        "object" &&
      !Array.isArray(
        parsed
      )
    ) {
      return JSON.stringify({
        ...(
          parsed as
            Record<
              string,
              unknown
            >
        ),
        _lexSourcePolicy:
          sourcePolicy
      });
    }

    return JSON.stringify({
      _lexSourcePolicy:
        sourcePolicy,
      results:
        parsed
    });
  } catch {
    return JSON.stringify({
      _lexSourcePolicy:
        sourcePolicy,
      content
    });
  }
}

class LexMcpClient {
  private client:
    Client | null = null;
  private connecting:
    Promise<Client> | null =
      null;
  private revision = -1;
  private servers = "";

  constructor(
    private readonly connectors:
      LexMcpConnectorStore | undefined
  ) {}

  installed(): SourceId[] {
    return this.connectors?.readyServers() ?? [];
  }

  private async ensureClient():
    Promise<Client> {
    const connectors =
      this.connectors;
    if (!connectors) {
      throw new Error(
        "LEX_MCP_CONNECTORS_NOT_CONFIGURED"
      );
    }
    const servers =
      connectors.readyServers().join(",");
    if (
      this.client &&
      (
        this.revision !==
          connectors.revision ||
        this.servers !==
          servers
      )
    ) {
      await this.close();
    }
    if (this.client) {
      return this.client;
    }
    if (this.connecting) {
      return this.connecting;
    }
    if (!servers) {
      throw new Error(
        "LEX_MCP_NO_SERVERS_INSTALLED"
      );
    }

    this.connecting =
      (async () => {
        const transport =
          new StdioClientTransport({
            command:
              connectors.command,
            // Lista po przecinku = jeden proces z narzędziami wszystkich wybranych serwerów.
            args: [
              connectors.packagePath,
              servers
            ],
            env:
              connectors.serverEnvironment(),
            stderr: "pipe"
          });
        const client =
          new Client({
            name:
              "lex-machina-legal-federation",
            version:
              "0.2.0"
          });
        await client.connect(
          transport
        );
        this.client =
          client;
        this.revision =
          connectors.revision;
        this.servers =
          servers;
        return client;
      })();

    try {
      return await this
        .connecting;
    } catch (error) {
      this.client = null;
      throw error;
    } finally {
      this.connecting =
        null;
    }
  }

  async close():
    Promise<void> {
    const client =
      this.client;
    this.client = null;
    this.connecting = null;
    if (client) {
      try {
        await client.close();
      } catch {
        // Best-effort shutdown.
      }
    }
  }

  async tools(
    source: SourceId
  ): Promise<unknown[]> {
    const client =
      await this.ensureClient();
    const listed =
      await client.listTools();
    return listed.tools
      .filter(
        (tool) =>
          tool.name.startsWith(
            `${source}_`
          )
      )
      .map(
        (tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        })
      );
  }

  async call(
    name: string,
    args:
      Record<string, unknown>
  ): Promise<string> {
    const client =
      await this.ensureClient();
    try {
      const result =
        await client.callTool(
          {
            name,
            arguments:
              guardOutboundPayload(
                args
              )
          },
          undefined,
          // SDK default is 60 s; SAOS (3 x 45 s), CEIDG (2 x 45 s) and SUDOP
          // (waits up to 50 s for its queue) need longer. Stays under the
          // desktop proxy's 300 s for direct search.
          { timeout: 280_000 }
        );
      return extractToolText(
        result
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith(
          "FEDERATED_"
        )
      ) {
        throw error;
      }
      try {
        await client.close();
      } catch {
        // Best effort: the next call creates a fresh MCP transport.
      }
      this.client = null;
      throw error;
    }
  }
}

function withoutUndefined(
  value:
    Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([, item]) =>
          item !== undefined
      )
  );
}

function extraFrom(
  input:
    Record<string, unknown>
): Record<string, unknown> {
  const extra =
    input.extra;
  return extra &&
    typeof extra ===
      "object" &&
    !Array.isArray(extra)
    ? extra as Record<string, unknown>
    : {};
}

type AuxiliarySourceFetcher =
  Pick<
    SafeAuxiliarySourceFetcher,
    "fetch"
  >;

export class LegalFederationToolRuntime {
  private readonly client:
    LexMcpClient;

  constructor(
    private readonly auxiliarySourceFetcher:
      AuxiliarySourceFetcher =
        new SafeAuxiliarySourceFetcher(),
    private readonly webSearch:
      WebSearchProvider =
        new PublicWebSearch(),
    connectors?:
      LexMcpConnectorStore
  ) {
    this.client =
      new LexMcpClient(
        connectors
      );
  }

  private assertInstalled(
    source: SourceId
  ): void {
    if (
      !this.client
        .installed()
        .includes(source)
    ) {
      throw new Error(
        source === "ceidg"
          ? "FEDERATED_SOURCE_NOT_INSTALLED:ceidg (klucz API CEIDG: Ustawienia → Konektory MCP)"
          : `FEDERATED_SOURCE_NOT_INSTALLED:${source}`
      );
    }
  }
  private readonly events:
    LegalFederationAuditEvent[] =
      [];

  schemas():
    NormalizedToolSchema[] {
    return [
      LIST_SCHEMA,
      SEARCH_SCHEMA,
      GET_SCHEMA,
      CALL_SCHEMA,
      ASSESS_SOURCE_SCHEMA,
      FETCH_AUXILIARY_SOURCE_SCHEMA,
      WEB_SEARCH_SCHEMA,
      COVERAGE_SCHEMA
    ];
  }

  handles(
    name: string
  ): boolean {
    return [
      LIST_TOOL,
      SEARCH_TOOL,
      GET_TOOL,
      CALL_TOOL,
      ASSESS_SOURCE_TOOL,
      FETCH_AUXILIARY_SOURCE_TOOL,
      WEB_SEARCH_TOOL,
      COVERAGE_TOOL
    ].includes(
      name
    );
  }

  systemPromptAppendix():
    string {
    return [
      "# FEDERATED LEGAL RESEARCH",
      "Lex Machina has optional read-only MCP connectors (lex-mcp, audyt-systemu-v4/mcp-servers): ISAP/ELI, EUR-Lex/CJEU, SAOS, NSA/WSA (cbosa), KRS, VAT white list (wl), CEIDG, NBP, EUREKA/KIS, SUDOP and UODO. Only sources installed in Settings → MCP connectors are available.",
      "NSA/WSA results from cbosa are a snapshot 🟨 and are never promoted to VERIFIED; no exact match is OUT_OF_SCOPE, not absence of the ruling.",
      "Use list_federated_legal_sources when you need source capabilities or a native schema. Search first, then fetch the actual document before relying on its contents.",
      "This federation is DISCOVERY/RESEARCH ONLY. It never creates a Lex Machina VERIFIED ledger entry and never bypasses Gate I.",
      "Every federated search/get/call result carries _lexSourcePolicy with sourceTier, provenance and verificationAuthority=LEX_NATIVE_ONLY. Preserve that metadata when reasoning about the result.",
      "Use assess_legal_source for classification only. Use fetch_auxiliary_legal_source to retrieve a specific public R2B/R3 page through the SSRF-protected HTTPS channel; the fetched page remains auxiliary evidence.",
      "R2B and R3 material is auxiliary only: it can never create VERIFIED or formal SUPPORTED status and can never be the sole legal basis. Cross-check the proposition against R1/R2A before using it.",
      "Use web_search for general internet discovery (current events, non-legal facts, locating a page). Send only neutral public phrases, never case facts or PII tokens. Snippets are not evidence: verify R1/R2A hits with verify_legal_reference / verify_case_* and read R2B/R3 hits with fetch_auxiliary_legal_source before relying on them.",
      "For R3 material, check publication/update date. Missing date or material older than 24 months requires an explicit staleness warning.",
      "For Polish statutory citations and current legal wording, verify_legal_reference remains authoritative. For Sąd Najwyższy signatures/quotes/propositions, use verify_case_reference / verify_case_quote / verify_case_proposition.",
      "SAOS, CBOSA and ISAP connector results can broaden discovery or retrieve source material, but they do not replace the native Lex verification path.",
      "EUREKA interpretations, UODO decisions and other administrative/case materials must be described with their actual legal status; do not present them as generally binding statutory law.",
      "After an empty federated search, call federated_legal_coverage before concluding that material is absent.",
      "Never send case facts, uploaded-document text, secrets, PII tokens or client-specific narrative to the MCP connectors (they call public APIs). Restrict calls to public legal concepts, act/case identifiers, citations and neutral search phrases.",
      "If a federated result conflicts with a native official-source verifier, the native official verification path is authoritative; fail closed until the conflict is resolved.",
      "Do not expose connector implementation details or treat a source_unavailable error as absence of law."
    ].join(
      "\n"
    );
  }

  async close():
    Promise<void> {
    await this.client.close();
  }

  auditEvents():
    LegalFederationAuditEvent[] {
    return this.events.map(
      (event) => ({
        ...event,
        ...(event.detail
          ? {
              detail: {
                ...event.detail
              }
            }
          : {})
      })
    );
  }

  // Karta „Wyszukiwanie": te same bramki co narzędzia modelu (instalacja, zgodność
  // narzędzia ze źródłem, ochrona danych sprawy), ale wywołanie wprost, bez modelu.
  // Bez `tool` zwraca listę narzędzi źródła ze schematami parametrów.
  async direct(
    request: {
      source: string;
      tool?: string;
      arguments?: Record<string, unknown>;
    }
  ): Promise<{
    ok: boolean;
    result: unknown;
  }> {
    // Własny dziennik: zdarzenia karty nie trafiają do audytu żadnej sesji.
    const events: LegalFederationAuditEvent[] = [];
    const [reply] =
      await this.runTools([
        request.tool
          ? {
              id: "direct",
              name: CALL_TOOL,
              input: {
                source:
                  request.source,
                tool:
                  request.tool,
                arguments:
                  request.arguments ??
                  {}
              }
            }
          : {
              id: "direct",
              name: LIST_TOOL,
              input: {
                source:
                  request.source
              }
            }
      ], events);
    let result: unknown;
    try {
      result =
        JSON.parse(
          reply!.content
        );
    } catch {
      result = {
        content:
          reply!.content
      };
    }
    const status =
      result &&
      typeof result ===
        "object"
        ? (result as { status?: unknown }).status
        : undefined;
    return {
      ok:
        status !==
          "SOURCE_UNAVAILABLE" &&
        status !==
          "POLICY_BLOCKED",
      result
    };
  }

  // Instancja jest współdzielona przez sesje: każda sesja przekazuje własny dziennik,
  // inaczej zdarzenia jednej rozmowy trafiałyby do audytu kolejnych.
  async runTools(
    calls:
      NormalizedToolCall[],
    events:
      LegalFederationAuditEvent[] =
        this.events
  ): Promise<
    NormalizedToolResult[]
  > {
    const results:
      NormalizedToolResult[] =
      [];

    // Intentionally sequential: several upstreams publish explicit rate limits.
    for (
      const call
      of calls
    ) {
      const source =
        sourceFrom(
          call.input
        );
      try {
        const content =
          await this.execute(
            call
          );
        events.push({
          tool:
            call.name,
          ...(source
            ? {
                source
              }
            : {}),
          decision:
            "ALLOW"
        });
        results.push({
          tool_use_id:
            call.id,
          content
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(
                error
              );
        const policyBlocked =
          call.name ===
            ASSESS_SOURCE_TOOL ||
          (
            call.name ===
              WEB_SEARCH_TOOL &&
            error instanceof
              WebSearchError &&
            error.code !==
              "WEB_SEARCH_NO_RESULTS"
          ) ||
          (
            call.name ===
              FETCH_AUXILIARY_SOURCE_TOOL &&
            (
              message ===
                "AUX_SOURCE_REQUIRES_R2B_R3" ||
              message ===
                "AUX_SOURCE_CASE_DATA_FORBIDDEN" ||
              (
                error instanceof
                  AuxiliarySourceFetchError &&
                [
                  "AUX_SOURCE_URL_INVALID",
                  "AUX_SOURCE_HOST_FORBIDDEN",
                  "AUX_SOURCE_DNS_PRIVATE"
                ].includes(
                  error.code
                )
              )
            )
          );
        events.push({
          tool:
            call.name,
          ...(source
            ? {
                source
              }
            : {}),
          decision:
            "BLOCK",
          // Próba wysłania danych sprawy do zewnętrznego źródła to zawsze odmowa polityki.
          outcome:
            policyBlocked ||
            /CASE_DATA_FORBIDDEN/.test(
              message
            )
              ? "POLICY_BLOCKED"
              : "SOURCE_UNAVAILABLE",
          detail: {
            error:
              message
          }
        });
        results.push({
          tool_use_id:
            call.id,
          content:
            JSON.stringify({
              status:
                policyBlocked
                  ? "POLICY_BLOCKED"
                  : "SOURCE_UNAVAILABLE",
              error:
                message,
              instruction:
                policyBlocked
                  ? "Source assessment was rejected by Lex source policy. Correct the URL/cross-check evidence; do not treat this as a source outage."
                  : "Do not infer absence of law from this failure. Use another verified source path or report the source as temporarily unavailable."
            })
        });
      }
    }

    return results;
  }

  private async execute(
    call:
      NormalizedToolCall
  ): Promise<string> {
    if (
      call.name ===
        LIST_TOOL
    ) {
      const source =
        sourceFrom(
          call.input
        );
      if (source) {
        this.assertInstalled(
          source
        );
        return JSON.stringify({
          status: "OK",
          source,
          tools:
            await this.client.tools(
              source
            )
        });
      }
      const installed =
        new Set(
          this.client.installed()
        );
      return JSON.stringify({
        status: "OK",
        connectorPackage:
          CONNECTOR_PACKAGE,
        sources:
          LEX_MCP_CATALOG.map(
            (server) => ({
              source:
                server.id,
              group:
                server.group,
              label:
                server.label,
              installed:
                installed.has(
                  server.id
                ),
              ...(server.requiresKey
                ? {
                    requiresKey:
                      server.requiresKey
                  }
                : {})
            })
          )
      });
    }

    if (
      call.name ===
        ASSESS_SOURCE_TOOL
    ) {
      const rawUrl =
        typeof call.input
          .url === "string"
          ? call.input.url
              .trim()
          : "";
      let url: URL;
      try {
        url =
          new URL(rawUrl);
      } catch {
        throw new Error(
          "LEGAL_SOURCE_URL_INVALID"
        );
      }
      if (
        (
          url.protocol !==
            "https:" &&
          url.protocol !==
            "http:"
        ) ||
        url.username ||
        url.password
      ) {
        throw new Error(
          "LEGAL_SOURCE_URL_INVALID"
        );
      }

      const knownTier =
        classifyKnownLegalSourceUrl(
          url.toString()
        );
      const tier =
        knownTier ??
        "R3";
      const crossCheckStatus =
        tier === "R2B" ||
        tier === "R3"
          ? "PENDING" as const
          : "NOT_REQUIRED" as const;

      const candidate = {
        ...(typeof call.input
          .claim ===
          "string" &&
        call.input
          .claim
          .trim()
          ? {
              claim:
                call.input
                  .claim
                  .trim()
            }
          : {}),
        url:
          url.toString(),
        tier,
        provenance: {
          sourceUrl:
            url.toString(),
          retrievedVia:
            "WEB_RESEARCH" as const,
          accessMode:
            "UNKNOWN" as const,
          classificationBasis:
            knownTier
              ? "KNOWN_CANONICAL_DOMAIN"
              : "UNKNOWN_DOMAIN_CONSERVATIVE_R3_UNTIL_EDITORIAL_CRITERIA_VERIFIED",
        },
        crossCheckStatus
      };

      return JSON.stringify({
        status: "OK",
        candidate,
        assessment:
          assessLegalSourceCandidate(
            candidate
          ),
        classification:
          knownTier
            ? "KNOWN_DOMAIN"
            : "CONSERVATIVE_R3",
        instruction:
          knownTier
            ? "Preserve the tier and assessment. R2B/R3 remains auxiliary only. A higher-tier cross-check can be confirmed only by the session runtime from a real VerificationLedger record; model input cannot attest it."
            : "Unknown domain was conservatively classified as R3. It may be reconsidered as R2B only after independent evidence of professional editorial board, recognized publisher/brand and systematic updating. A higher-tier cross-check can be confirmed only by the session runtime."
      });
    }

    if (
      call.name ===
        WEB_SEARCH_TOOL
    ) {
      const query =
        assertPublicWebSearchQuery(
          call.input.query
        );
      const requested =
        typeof call.input.maxResults ===
          "number" &&
        Number.isFinite(
          call.input.maxResults
        )
          ? Math.trunc(
              call.input.maxResults
            )
          : 5;
      const response =
        await this.webSearch.search(
          query,
          Math.max(
            1,
            Math.min(
              10,
              requested
            )
          )
        );
      return JSON.stringify({
        status: "OK",
        query,
        provider:
          response.provider,
        results:
          classifyWebSearchHits(
            response.hits
          ),
        _lexSourcePolicy: {
          verificationAuthority:
            "LEX_NATIVE_ONLY",
          verificationEligible:
            false,
          note:
            "Search snippets are discovery only and never create VERIFIED/SUPPORTED status. Cite only URLs returned here, after the nextStep for each result."
        }
      });
    }

    if (
      call.name ===
        FETCH_AUXILIARY_SOURCE_TOOL
    ) {
      const rawUrl =
        typeof call.input
          .url === "string"
          ? call.input.url
              .trim()
          : "";
      const publicClaim =
        typeof call.input
          .claim === "string"
          ? call.input.claim
              .trim()
          : "";

      if (
        /\[(?:DOCUMENT|CASE KNOWLEDGE|FIRM KNOWLEDGE)\s/iu
          .test(
            rawUrl +
              " " +
              publicClaim
          ) ||
        /\[(?:LM)?PII:/iu
          .test(
            rawUrl +
              " " +
              publicClaim
          )
      ) {
        throw new Error(
          "AUX_SOURCE_CASE_DATA_FORBIDDEN"
        );
      }

      const requestedTier =
        classifyKnownLegalSourceUrl(
          rawUrl
        );
      if (
        requestedTier === "R1" ||
        requestedTier === "R2A"
      ) {
        throw new Error(
          "AUX_SOURCE_REQUIRES_R2B_R3"
        );
      }

      const fetched =
        await this
          .auxiliarySourceFetcher
          .fetch(
            rawUrl
          );
      const finalKnownTier =
        classifyKnownLegalSourceUrl(
          fetched.finalUrl
        );
      if (
        finalKnownTier === "R1" ||
        finalKnownTier === "R2A"
      ) {
        throw new Error(
          "AUX_SOURCE_REQUIRES_R2B_R3"
        );
      }
      const tier =
        finalKnownTier ??
        "R3";
      const candidate = {
        ...(publicClaim
          ? {
              claim:
                publicClaim
            }
          : {}),
        url:
          fetched.finalUrl,
        tier,
        provenance: {
          sourceUrl:
            fetched.finalUrl,
          retrievedVia:
            "WEB_RESEARCH" as const,
          accessMode:
            "DIRECT_LIVE" as const,
          classificationBasis:
            finalKnownTier
              ? "KNOWN_CANONICAL_DOMAIN_AFTER_SAFE_FETCH"
              : "UNKNOWN_DOMAIN_CONSERVATIVE_R3_AFTER_SAFE_FETCH",
          ...(fetched
            .publishedAt
            ? {
                publishedAt:
                  fetched
                    .publishedAt
              }
            : {}),
          ...(fetched
            .updatedAt
            ? {
                updatedAt:
                  fetched
                    .updatedAt
              }
            : {})
        },
        crossCheckStatus:
          "PENDING" as const
      };
      const textLimit =
        80_000;
      return JSON.stringify({
        status:
          "OK",
        classification:
          finalKnownTier
            ? "KNOWN_DOMAIN"
            : "CONSERVATIVE_R3",
        candidate,
        assessment:
          assessLegalSourceCandidate(
            candidate
          ),
        retrieval: {
          requestedUrl:
            fetched.requestedUrl,
          finalUrl:
            fetched.finalUrl,
          fetchedAt:
            fetched.fetchedAt,
          contentType:
            fetched.contentType,
          bytes:
            fetched.bytes,
          sha256:
            fetched.sha256,
          redirectCount:
            fetched
              .redirectCount,
          ...(fetched
            .publishedAt
            ? {
                publishedAt:
                  fetched
                    .publishedAt
              }
            : {}),
          ...(fetched
            .updatedAt
            ? {
                updatedAt:
                  fetched
                    .updatedAt
              }
            : {}),
          text:
            fetched.text
              .slice(
                0,
                textLimit
              ),
          textTruncated:
            fetched.text
              .length >
            textLimit
        },
        instruction:
          "This is auxiliary R2B/R3 research material. Do not create VERIFIED/SUPPORTED from it and do not use it as the sole legal basis. For a legal proposition, obtain a real R1/R2A verification record for the same claim."
      });
    }

    if (
      call.name ===
        COVERAGE_TOOL
    ) {
      const installed =
        new Set(
          this.client.installed()
        );
      return JSON.stringify({
        status:
          "OK",
        connectorPackage:
          CONNECTOR_PACKAGE,
        sources:
          SOURCE_IDS.map(
            (source) => ({
              source,
              ...LOCAL_COVERAGE[
                source
              ],
              installed:
                installed.has(
                  source
                ),
              transport:
                "LEX_MCP_STDIO",
              sourcePolicy:
                federatedSourcePolicy(
                  source
                )
            })
          ),
        policy: {
          verificationAuthority:
            "LEX_NATIVE_ONLY",
          emptySearch:
            "OUT_OF_SCOPE_UNTIL_FALLBACK_CHECKED",
          notInstalled:
            "REPORT_AS_UNAVAILABLE_NEVER_AS_ABSENT",
          conflict:
            "REVERIFY_WITH_OFFICIAL_NATIVE_PATH_AND_FAIL_CLOSED",
          privacy:
            "NO_CASE_FACTS_DOCUMENT_TEXT_OR_PII_TOKENS_TO_EXTERNAL_MCP",
          sourceTierCoverage: {
            tier1:
              "IMPLEMENTED_OFFICIAL_RETRIEVAL_WITH_NATIVE_VERIFICATION",
            tier2A:
              "IMPLEMENTED_OFFICIAL_AND_AUTHORITY_RETRIEVAL_WITH_NATIVE_VERIFICATION_WHERE_SUPPORTED",
            tier2B:
              "SAFE_AUXILIARY_HTTPS_RETRIEVER_AND_RUNTIME_HARD_GATE_IMPLEMENTED",
            tier3:
              "SAFE_AUXILIARY_HTTPS_RETRIEVER_AND_RUNTIME_HARD_GATE_IMPLEMENTED_WITH_CONSERVATIVE_UNKNOWN_DOMAIN_CLASSIFICATION"
          }
        }
      });
    }

    const source =
      sourceFrom(
        call.input
      );
    if (!source) {
      throw new Error(
        "FEDERATED_SOURCE_INVALID"
      );
    }
    this.assertInstalled(
      source
    );

    if (
      call.name ===
        SEARCH_TOOL
    ) {
      const request =
        NATIVE_SEARCH[source]({
          ...(typeof call.input
            .query === "string"
            ? {
                query:
                  call.input
                    .query
              }
            : {}),
          ...(typeof call.input
            .dateFrom === "string"
            ? {
                dateFrom:
                  call.input
                    .dateFrom
              }
            : {}),
          ...(typeof call.input
            .dateTo === "string"
            ? {
                dateTo:
                  call.input
                    .dateTo
              }
            : {}),
          ...(Number.isInteger(
            call.input.page
          )
            ? {
                page:
                  call.input
                    .page as number
              }
            : {}),
          ...(Number.isInteger(
            call.input.limit
          )
            ? {
                limit:
                  call.input
                    .limit as number
              }
            : {})
        });
      const content =
        await this.client.call(
          request.tool,
          withoutUndefined({
            ...request.args,
            ...extraFrom(
              call.input
            )
          })
        );
      return annotateFederatedLegalContent(
        source,
        content
      );
    }

    if (
      call.name ===
        GET_TOOL
    ) {
      const documentId =
        typeof call.input
          .documentId ===
          "string"
          ? call.input
              .documentId
              .trim()
          : "";
      if (!documentId) {
        throw new Error(
          "FEDERATED_DOCUMENT_ID_REQUIRED"
        );
      }
      const request =
        NATIVE_GET[source](
          documentId
        );
      const content =
        await this.client.call(
          request.tool,
          withoutUndefined({
            ...request.args,
            ...extraFrom(
              call.input
            )
          })
        );
      return annotateFederatedLegalContent(
        source,
        content
      );
    }

    if (
      call.name ===
        CALL_TOOL
    ) {
      const tool =
        typeof call.input
          .tool ===
          "string"
          ? call.input.tool
              .trim()
          : "";
      if (!tool) {
        throw new Error(
          "FEDERATED_NATIVE_TOOL_REQUIRED"
        );
      }
      if (
        !tool.startsWith(
          `${source}_`
        )
      ) {
        throw new Error(
          "FEDERATED_NATIVE_TOOL_SOURCE_MISMATCH"
        );
      }
      const args =
        call.input.arguments &&
        typeof call.input
          .arguments ===
          "object" &&
        !Array.isArray(
          call.input.arguments
        )
          ? call.input
              .arguments as
              Record<
                string,
                unknown
              >
          : {};
      const content =
        await this.client.call(
          tool,
          args
        );
      return annotateFederatedLegalContent(
        source,
        content
      );
    }

    throw new Error(
      "UNKNOWN_FEDERATED_LEGAL_TOOL"
    );
  }
}

export const FEDERATED_LEGAL_TOOL_NAMES =
  new Set([
    LIST_TOOL,
    SEARCH_TOOL,
    GET_TOOL,
    CALL_TOOL,
    ASSESS_SOURCE_TOOL,
    FETCH_AUXILIARY_SOURCE_TOOL,
    WEB_SEARCH_TOOL,
    COVERAGE_TOOL
  ]);
