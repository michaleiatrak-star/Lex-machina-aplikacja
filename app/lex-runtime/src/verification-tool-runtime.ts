import {
  SupremeCourtCaseVerifier,
  propositionEvidenceHash,
  supremeCourtSearchUrl
} from "./case-law-verifier.js";
import {
  CASE_LAW_SEARCH_HOSTS,
  CaseLawSearchService,
  caseLawSearchEntryUrl,
  type CaseLawSearchSource
} from "./case-law-search.js";
import {
  DeterministicLegalActResolver,
  LegalActResolutionError,
  type LegalActDescriptor
} from "./legal-act-resolver.js";
import {
  ToolBroker,
  ToolPolicy,
  type ToolAuditEvent
} from "./tool-broker.js";
import {
  OFFICIAL_LEGAL_SOURCE_HOSTS,
  OfficialLegalSourceVerifier
} from "./legal-source-verifier.js";
import type {
  NormalizedToolCall,
  NormalizedToolResult,
  NormalizedToolSchema
} from "./providers/types.js";
import {
  TemporalSourceFreshnessChecker,
  type TemporalFreshnessResult
} from "./temporal-source-freshness.js";
import {
  resolveActByTitle,
  verifyFromCoreLaw,
  type CoreLawVerificationIndex
} from "./core-law-verification.js";
import type { CoreLawUseCheck } from "./core-law-index.js";
import { describeEliAct } from "./eli-act-descriptor.js";
import {
  verificationMarker,
  verificationSourceLink
} from "./source-anchor.js";
import {
  VerificationLedger,
  type VerificationKind,
  type VerificationRecord
} from "./verification-ledger.js";

const TOOL_NAME = "verify_legal_reference";

/** Wynik z lokalnej kopii ELI, gdy samo ELI nie odpowiada: data kopii i wyraźna informacja. */
function withEliOutageNotice(
  payload: Record<string, unknown>,
  cause: string
): Record<string, unknown> {
  const copyDate =
    typeof payload.fetchedAt === "string" ? payload.fetchedAt.slice(0, 10) : null;
  return {
    ...payload,
    sourceNotice: {
      eliUnavailable: true,
      cause,
      localCopyDate: copyDate
    },
    instruction:
      "ELI (the official source) is unavailable right now (" +
      cause +
      "). This result comes from the local ELI copy (RAG) dated " +
      (copyDate ?? "unknown") +
      ", not from a live ELI check. State this explicitly to the user next to the reference (e.g. \"zweryfikowano na lokalnej kopii ELI z dnia …, ELI niedostępne\"). " +
      String(payload.instruction ?? "")
  };
}
const CASE_SEARCH_TOOL_NAME =
  "search_case_law";
const CASE_TOOL_NAME = "verify_case_reference";
const CASE_QUOTE_TOOL_NAME =
  "verify_case_quote";
const CASE_PROPOSITION_TOOL_NAME =
  "verify_case_proposition";

const TOOL_SCHEMA: NormalizedToolSchema = {
  type: "function",
  function: {
    name: TOOL_NAME,
    description:
      "Verify one Polish statutory or Journal of Laws reference. " +
      "Provide the exact citation and the legal act identity/alias only. " +
      "The runtime resolves and freshness-checks the official source; never supply or invent transport URLs. " +
      "Only status VERIFIED permits copying the returned marker onto the same line as the exact citation. " +
      "Case-law signatures are not verified by this tool.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["claim", "kind", "act"],
      properties: {
        claim: {
          type: "string",
          description:
            "Exact legal reference that will appear in the answer, e.g. art. 5 KC."
        },
        kind: {
          type: "string",
          enum: ["statute", "journal"]
        },
        act: {
          type: "string",
          description:
            "Legal act identity or alias, e.g. KC, KPC, KPK, KK, KW, a Dz.U. reference (Dz.U. 2025 poz. 734), an ELI (DU/2025/734) or the full act title (also of an act outside the DR act maps)."
        },
        asOf: {
          type: "string",
          description:
            "Optional historical legal-state date in YYYY-MM-DD. Use only when the user asks for a past legal state. Omit for current law."
        },
        quote: {
          type: "string",
          description:
            "Optional exact wording you intend to quote from the provision. It is checked against the official ELI text; a mismatch makes the reference UNVERIFIED."
        }
      }
    }
  }
};


const CASE_SEARCH_TOOL_SCHEMA: NormalizedToolSchema = {
  type: "function",
  function: {
    name: CASE_SEARCH_TOOL_NAME,
    description:
      "Search Polish case-law candidates in SAOS or CBOSA. " +
      "This is discovery only: returned candidates are NOT verified for citation. " +
      "Use source=SAOS for broad full-text discovery and source=CBOSA for NSA/WSA discovery. " +
      "After selecting a candidate, run the applicable verification workflow before citing it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "query",
        "source"
      ],
      properties: {
        query: {
          type: "string",
          description:
            "Full-text legal phrase or issue to search for. Do not use this field to fabricate a case signature."
        },
        source: {
          type: "string",
          enum: [
            "SAOS",
            "CBOSA"
          ]
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10
        }
      }
    }
  }
};


const CASE_TOOL_SCHEMA: NormalizedToolSchema = {
  type: "function",
  function: {
    name: CASE_TOOL_NAME,
    description:
      "Verify a Sąd Najwyższy case signature against the official sn.pl database. " +
      "Provide the exact output claim, raw signature and courtFamily=SN. " +
      "Never supply a source URL. VERIFIED confirms official existence and full-text identity, not an arbitrary paraphrased thesis.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "claim",
        "signature",
        "courtFamily"
      ],
      properties: {
        claim: {
          type: "string",
          description:
            "Exact case citation as it will appear in the answer, e.g. sygn. III CZP 25/11."
        },
        signature: {
          type: "string",
          description:
            "Raw Sąd Najwyższy signature, e.g. III CZP 25/11."
        },
        courtFamily: {
          type: "string",
          enum: ["SN"]
        }
      }
    }
  }
};

const CASE_QUOTE_TOOL_SCHEMA: NormalizedToolSchema = {
  type: "function",
  function: {
    name: CASE_QUOTE_TOOL_NAME,
    description:
      "Verify an exact quotation against the official full text of a Sąd Najwyższy judgment. " +
      "Use only for verbatim quotations. Provide the exact case citation, signature, quote and courtFamily=SN. " +
      "Never supply a source URL. Paraphrases are not VERIFIED by this tool.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "caseClaim",
        "signature",
        "quote",
        "courtFamily"
      ],
      properties: {
        caseClaim: {
          type: "string",
          description:
            "Exact case citation as it will appear in the answer, e.g. sygn. II CSK 101/20."
        },
        signature: {
          type: "string",
          description:
            "Raw Sąd Najwyższy signature."
        },
        quote: {
          type: "string",
          description:
            "Exact verbatim quotation that will appear in the answer. Do not paraphrase."
        },
        courtFamily: {
          type: "string",
          enum: ["SN"]
        }
      }
    }
  }
};

const CASE_PROPOSITION_TOOL_SCHEMA: NormalizedToolSchema = {
  type: "function",
  function: {
    name: CASE_PROPOSITION_TOOL_NAME,
    description:
      "Link one paraphrased proposition to one exact quotation from the official full text of a Sąd Najwyższy judgment. " +
      "This returns status SUPPORTED, not VERIFIED: the runtime verifies the case and support quote, but does not independently decide semantic entailment. " +
      "Provide the exact output proposition, exact supportQuote, case citation, signature and courtFamily=SN. Never supply a source URL.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "caseClaim",
        "signature",
        "proposition",
        "supportQuote",
        "courtFamily"
      ],
      properties: {
        caseClaim: {
          type: "string",
          description:
            "Exact case citation as it will appear in the answer."
        },
        signature: {
          type: "string",
          description:
            "Raw Sąd Najwyższy signature."
        },
        proposition: {
          type: "string",
          description:
            "Exact paraphrased proposition that will appear in the answer. It will be evidence-linked, not semantically VERIFIED."
        },
        supportQuote: {
          type: "string",
          description:
            "Exact verbatim passage from the judgment that will be shown with the proposition."
        },
        courtFamily: {
          type: "string",
          enum: ["SN"]
        }
      }
    }
  }
};


function publicCasePropositionToolResult(
  caseRecord: VerificationRecord,
  quoteRecord: VerificationRecord,
  supportRecord: VerificationRecord
): string {
  if (
    caseRecord.status !== "VERIFIED" ||
    quoteRecord.status !== "VERIFIED" ||
    quoteRecord.caseScope !== "EXACT_QUOTE" ||
    supportRecord.status !== "SUPPORTED" ||
    supportRecord.caseScope !== "PROPOSITION_SUPPORT" ||
    !supportRecord.evidenceHash ||
    !supportRecord.supportQuoteHash
  ) {
    throw new Error(
      "CASE_PROPOSITION_SUPPORT_INVALID"
    );
  }

  const source =
    supportRecord.sourceUrl ??
    quoteRecord.sourceUrl ??
    caseRecord.sourceUrl ??
    "sn.pl";
  const date =
    supportRecord.fetchedAt.slice(0, 10);

  return JSON.stringify({
    status: "SUPPORTED",
    semanticVerification: false,
    courtFamily: "SN",
    caseClaim: caseRecord.claim,
    signature:
      supportRecord.caseSignature ?? null,
    proposition:
      supportRecord.claim,
    supportQuote:
      supportRecord.supportQuote ?? null,
    sourceUrl: source,
    fetchedAt:
      supportRecord.fetchedAt,
    caseMarker:
      "✅ [VER: " +
      source +
      ", " +
      date +
      "]",
    quoteMarker:
      "✅ [CASE-QUOTE:" +
      supportRecord.supportQuoteHash +
      "]",
    supportMarker:
      "🔗 [CASE-SUPPORT:" +
      supportRecord.evidenceHash +
      "]",
    evidenceHash:
      supportRecord.evidenceHash,
    supportQuoteHash:
      supportRecord.supportQuoteHash,
    instruction:
      "This proposition is evidence-linked, not semantically VERIFIED. Keep the proposition text unchanged. " +
      "Show the exact supportQuote, exact case citation, caseMarker, quoteMarker and supportMarker on the SAME LINE. " +
      "Do not replace SUPPORTED with VERIFIED and do not omit the supporting quotation."
  });
}

function publicCaseQuoteToolResult(
  caseRecord: VerificationRecord,
  quoteRecord: VerificationRecord,
  evidenceHash: string
): string {
  if (
    caseRecord.status !== "VERIFIED" ||
    quoteRecord.status !== "VERIFIED" ||
    quoteRecord.caseScope !== "EXACT_QUOTE"
  ) {
    throw new Error(
      "CASE_QUOTE_RECORD_NOT_VERIFIED"
    );
  }

  const source =
    quoteRecord.sourceUrl ??
    caseRecord.sourceUrl ??
    "sn.pl";
  const date =
    quoteRecord.fetchedAt
      .slice(0, 10);
  const caseMarker =
    "✅ [VER: " +
    source +
    ", " +
    date +
    "]";
  const quoteMarker =
    "✅ [CASE-QUOTE:" +
    evidenceHash +
    "]";

  return JSON.stringify({
    status: "VERIFIED",
    courtFamily: "SN",
    caseClaim:
      caseRecord.claim,
    signature:
      quoteRecord.caseSignature ??
      null,
    quote:
      quoteRecord.claim,
    sourceUrl:
      source,
    fetchedAt:
      quoteRecord.fetchedAt,
    caseMarker,
    quoteMarker,
    evidenceHash,
    instruction:
      "Use the quotation verbatim. Put the exact quotation, exact case citation, caseMarker and quoteMarker on the SAME LINE. " +
      "Do not edit the quotation and do not use this result to verify a paraphrase."
  });
}

function publicCaseToolResult(
  record: VerificationRecord,
  judgment: {
    signature: string;
    date?: string;
    form?: string;
    contentScope: "FULL_TEXT";
  }
): string {
  if (record.status !== "VERIFIED") {
    throw new Error(
      "CASE_VERIFICATION_RECORD_NOT_VERIFIED"
    );
  }

  const marker =
    "✅ [VER: " +
    (record.sourceUrl ?? "sn.pl") +
    ", " +
    record.fetchedAt.slice(0, 10) +
    "]";

  return JSON.stringify({
    claim: record.claim,
    status: record.status,
    courtFamily: "SN",
    signature: judgment.signature,
    date: judgment.date ?? null,
    form: judgment.form ?? null,
    contentScope:
      judgment.contentScope,
    sourceUrl:
      record.sourceUrl ?? null,
    fetchedAt: record.fetchedAt,
    marker,
    instruction:
      "The signature/metadata and official full-text identity are verified. " +
      "Copy the marker onto the same line as the exact signature. " +
      "Do not attribute a legal thesis or quote unless that proposition is separately verified against the fetched judgment text."
  });
}

function isVerifiedRecord(
  record: VerificationRecord | undefined
): record is VerificationRecord & {
  status: "VERIFIED";
} {
  return record?.status === "VERIFIED";
}

function kind(value: unknown): VerificationKind | null {
  return value === "statute" || value === "journal"
    ? value
    : null;
}

function publicToolResult(
  record: {
    claim: string;
    status: "VERIFIED" | "UNVERIFIED";
    sourceUrl?: string;
    sourceAnchorUrl?: string;
    fetchedAt: string;
    temporalMode?: "CURRENT" | "HISTORICAL";
    asOf?: string;
    sourceFormat?: "TEXT" | "PDF";
    evidence?: string;
  },
  act: LegalActDescriptor,
  freshness?: TemporalFreshnessResult
): string {
  const marker =
    record.status === "VERIFIED"
      ? verificationMarker({
          ...record,
          sourceUrl:
            record.sourceUrl ?? "official-source"
        })
      : "⚠️ [NIEWERYFIKOWANE]";

  return JSON.stringify({
    claim: record.claim,
    status: record.status,
    act: {
      id: act.id,
      title: act.title,
      eli: act.eli,
      baseEli: act.baseEli,
      sourceKind: act.sourceKind,
      registryAsOf: act.registryAsOf
    },
    freshness: freshness
      ? {
          status: freshness.status,
          mode: freshness.mode,
          checkedAt: freshness.checkedAt,
          requestedAsOf: freshness.requestedAsOf ?? null,
          currentEli: freshness.currentEli ?? null,
          amendmentsAfter: freshness.amendmentsAfter.length
        }
      : null,
    sourceUrl: record.sourceUrl ?? null,
    sourceLink: verificationSourceLink(record) ?? null,
    sourceFormat: record.sourceFormat ?? null,
    evidence: record.evidence ?? null,
    fetchedAt: record.fetchedAt,
    marker,
    instruction:
      record.status === "VERIFIED"
        ? "Copy the marker verbatim onto the same line as this exact legal reference. " + STATUS_CONSISTENCY_INSTRUCTION + " When the user asks for the wording of a statute provision, use the returned evidence as the official provision text and do not reconstruct it from model memory."
        : "Do not present this reference as verified; if it must be mentioned, use the unverified marker."
  });
}

// Status źródła (✅/⚠️) to wynik sprawdzenia brzmienia w źródle; ocena, czy przepis
// ma zastosowanie do faktów, jest osobną informacją i nie zmienia znacznika.
export const STATUS_CONSISTENCY_INSTRUCTION =
  "The marker states only whether the provision text was verified at the official source (the link points to the provision itself where possible). It never expresses whether the provision applies to the facts: write that separately (e.g. 'Ocena zastosowania: ...') and never replace or add ⚠️ [NIEWERYFIKOWANE] because the application is uncertain. A provision keeps ONE status from the start to the end of the answer, summaries and tables included: repeat the same ✅ [VER: ...] marker wherever it is mentioned again.";

export const LEGAL_VERIFICATION_SYSTEM_APPENDIX = [
  "RUNTIME LEGAL-SOURCE VERIFICATION:",
  "- Before emitting any statutory citation (art. or Dz.U.), call verify_legal_reference.",
  "- Pass only claim + kind + legal act identity/alias. Never invent or supply an official-source URL.",  "- The runtime resolves the canonical official source and checks temporal freshness before reading the citation.",
  "- For current law omit asOf. A citation is verified only when the freshness check is CURRENT and the verification tool returns status=VERIFIED.",
  "- If the user explicitly asks for a past legal state, pass asOf=YYYY-MM-DD. Historical verification is allowed only when ELI proves the act was in force on that date and the selected historical consolidated text covers that date without intervening amendments.",
  "- For VERIFIED results, copy the returned marker verbatim onto the SAME LINE as the exact citation.",
  "- " + STATUS_CONSISTENCY_INSTRUCTION,
  "- Every act, KC/KPC/KPK/KK included, is verified at the source (Sejm ELI: current consolidated text and amendments after it); an act outside the DR act maps is found by its Dz.U. reference or an unambiguous title and then added to the local copy. The local official ELI copy (RAG) is used only when ELI itself fails; such a result carries sourceNotice.eliUnavailable and you must say so explicitly next to the reference. Local models (Bielik, Mistral) check the local copy first. The act may be named by its full or inflected title, Dz.U. reference or ELI; what decides is whether the provision exists in the consolidated text and whether your optional quote matches it.",
  "- Never invent a verification marker, source URL, or tool result.",
  "- For UNVERIFIED/DENIED results, do not represent the citation as verified.",
  "- For case-law discovery, call search_case_law. Search SAOS and CBOSA as separate sources when both are relevant.",
  "- search_case_law returns candidates only and never creates a VERIFIED ledger record. Never cite a discovered signature as verified without the applicable verification step.",
  "- NSA/WSA (CBOSA) material is a dated SNAPSHOT: present it as a snapshot and never promote it to VERIFIED. A CBOSA search with no hits is OUT_OF_SCOPE, never evidence that no judgment exists.",
  "- SAOS is a discovery source; CBOSA discovery is direct NSA/WSA retrieval but remains DISCOVERY until the candidate is verified under the case-law rules.",
  "- Before emitting a case signature (sygn.), call verify_case_reference.",
  "- The first supported courtFamily is SN. Pass only claim + signature + courtFamily; never invent or supply the sn.pl URL.",
  "- VERIFIED case output confirms exact official signature/metadata and full-text identity. It does not authorize an invented thesis or quote.",
  "- For a verbatim quotation attributed to SN, call verify_case_quote. Copy the exact quote plus both returned markers onto the SAME LINE as the exact case citation.",
  "- For a paraphrased proposition attributed to SN, call verify_case_proposition with the exact proposition plus an exact supporting quotation.",
  "- verify_case_proposition returns SUPPORTED, never VERIFIED. SUPPORTED means the proposition is transparently linked to official evidence; semantic entailment is not independently decided by the runtime.",
  "- For SUPPORTED propositions, keep the exact proposition and supportQuote unchanged and put them with the case citation, case marker, CASE-QUOTE marker and CASE-SUPPORT marker on the SAME LINE."
].join("\n");

export class LegalVerificationToolRuntime {
  private readonly broker: ToolBroker;
  private readonly resolverAudit: ToolAuditEvent[] = [];

  constructor(
    private readonly ledger: VerificationLedger,
    private readonly verifier =
      new OfficialLegalSourceVerifier(),
    private readonly resolver =
      new DeterministicLegalActResolver(),
    private readonly freshnessChecker:
      TemporalSourceFreshnessChecker | null = null,
    private readonly caseVerifier =
      new SupremeCourtCaseVerifier(),
    private readonly caseLawSearch =
      new CaseLawSearchService(),
    private readonly coreLaw:
      CoreLawVerificationIndex | null = null,
    private readonly eliFetch: (
      url: string,
      init?: RequestInit
    ) => Promise<Response> =
      globalThis.fetch.bind(globalThis),
    // Akt zweryfikowany w źródle, którego nie ma w lokalnej kopii (albo ma tam starszy
    // tekst): dołączany do kopii i RAG, jak akty z map DR.
    private readonly adoptAct:
      | ((act: LegalActDescriptor) => void)
      | null = null,
    // Model lokalny (Bielik, Mistral): lokalna kopia ELI (RAG) pierwsza.
    private readonly localModel = false
  ) {
    this.broker = new ToolBroker(
      new ToolPolicy({
        allowNetwork: true,
        allowedNetworkHosts: [
          ...OFFICIAL_LEGAL_SOURCE_HOSTS,
          ...CASE_LAW_SEARCH_HOSTS
        ]
      })
    );

    this.broker.register({
      name: CASE_SEARCH_TOOL_NAME,
      capability: "network",
      execute: async (input) => {
        const query =
          typeof input.query === "string"
            ? input.query.trim()
            : "";
        const source =
          typeof input.source === "string"
            ? input.source.trim()
            : "";
        const limit =
          typeof input.limit === "number"
            ? input.limit
            : undefined;

        if (
          !query ||
          (
            source !== "SAOS" &&
            source !== "CBOSA"
          )
        ) {
          throw new Error(
            "INVALID_CASE_SEARCH_INPUT"
          );
        }

        const result =
          await this.caseLawSearch.search({
            query,
            source:
              source as CaseLawSearchSource,
            ...(limit !== undefined
              ? { limit }
              : {})
          });

        return JSON.stringify({
          ...result,
          verificationStatus:
            "DISCOVERY_ONLY",
          instruction:
            "Do not cite a candidate as verified. Run the applicable case verification workflow first."
        });
      }
    });

    this.broker.register({
      name: CASE_PROPOSITION_TOOL_NAME,
      capability: "network",
      execute: async (input) => {
        const caseClaim =
          typeof input.caseClaim === "string"
            ? input.caseClaim.trim()
            : "";
        const signature =
          typeof input.signature === "string"
            ? input.signature.trim()
            : "";
        const proposition =
          typeof input.proposition === "string"
            ? input.proposition.trim()
            : "";
        const supportQuote =
          typeof input.supportQuote === "string"
            ? input.supportQuote.trim()
            : "";
        const toolCallId =
          typeof input.toolCallId === "string"
            ? input.toolCallId
            : "";

        if (
          !caseClaim ||
          !signature ||
          !proposition ||
          !supportQuote ||
          !toolCallId
        ) {
          throw new Error(
            "INVALID_CASE_PROPOSITION_INPUT"
          );
        }

        const quoteResult =
          await this.caseVerifier
            .verifyExactQuote({
              caseClaim,
              signature,
              quote:
                supportQuote,
              toolCallId
            });

        const caseRecord =
          quoteResult.caseResult.record;
        const quoteRecord =
          quoteResult.quoteRecord;

        if (
          quoteResult.status !== "VERIFIED" ||
          !quoteResult.evidenceHash ||
          !isVerifiedRecord(caseRecord) ||
          !isVerifiedRecord(quoteRecord)
        ) {
          return JSON.stringify({
            status:
              "UNVERIFIED",
            error:
              quoteResult.reason ?? null,
            normalizedSignature:
              quoteResult.normalizedSignature
          });
        }

        const evidenceHash =
          propositionEvidenceHash(
            quoteResult.normalizedSignature,
            proposition,
            supportQuote
          );

        const supportSource =
          quoteRecord.sourceUrl ??
          caseRecord.sourceUrl;

        if (!supportSource) {
          throw new Error(
            "CASE_PROPOSITION_SOURCE_MISSING"
          );
        }

        const supportRecord:
          VerificationRecord = {
            claim: proposition,
            kind: "case",
            status: "SUPPORTED",
            sourceUrl:
              supportSource,
            ...(quoteRecord.sourceTier
              ? {
                  sourceTier:
                    quoteRecord.sourceTier
                }
              : {}),
            fetchedAt:
              quoteRecord.fetchedAt,
            toolCallId,
            verificationMethod:
              "web_fetch",
            sourceFormat: "TEXT",
            caseScope:
              "PROPOSITION_SUPPORT",
            caseSignature:
              quoteResult.normalizedSignature,
            evidenceHash,
            supportQuoteHash:
              quoteResult.evidenceHash,
            supportQuote,
            evidence:
              "Evidence-linked proposition; semantic entailment not independently verified."
          };

        this.ledger.add(
          caseRecord
        );
        this.ledger.add(
          quoteRecord
        );
        this.ledger.add(
          supportRecord
        );

        return publicCasePropositionToolResult(
          caseRecord,
          quoteRecord,
          supportRecord
        );
      }
    });

    this.broker.register({
      name: CASE_QUOTE_TOOL_NAME,
      capability: "network",
      execute: async (input) => {
        const caseClaim =
          typeof input.caseClaim === "string"
            ? input.caseClaim.trim()
            : "";
        const signature =
          typeof input.signature === "string"
            ? input.signature.trim()
            : "";
        const quote =
          typeof input.quote === "string"
            ? input.quote.trim()
            : "";
        const toolCallId =
          typeof input.toolCallId === "string"
            ? input.toolCallId
            : "";

        if (
          !caseClaim ||
          !signature ||
          !quote ||
          !toolCallId
        ) {
          throw new Error(
            "INVALID_CASE_QUOTE_INPUT"
          );
        }

        const result =
          await this.caseVerifier
            .verifyExactQuote({
              caseClaim,
              signature,
              quote,
              toolCallId
            });

        const caseRecord =
          result.caseResult.record;
        const quoteRecord =
          result.quoteRecord;

        if (
          result.status !== "VERIFIED" ||
          !result.evidenceHash ||
          !isVerifiedRecord(caseRecord) ||
          !isVerifiedRecord(quoteRecord)
        ) {
          return JSON.stringify({
            status: result.status,
            error:
              result.reason ?? null,
            normalizedSignature:
              result.normalizedSignature
          });
        }

        this.ledger.add(
          caseRecord
        );
        this.ledger.add(
          quoteRecord
        );

        return publicCaseQuoteToolResult(
          caseRecord,
          quoteRecord,
          result.evidenceHash
        );
      }
    });

    this.broker.register({
      name: CASE_TOOL_NAME,
      capability: "network",
      execute: async (input) => {
        const claim =
          typeof input.claim === "string"
            ? input.claim.trim()
            : "";
        const signature =
          typeof input.signature === "string"
            ? input.signature.trim()
            : "";
        const toolCallId =
          typeof input.toolCallId === "string"
            ? input.toolCallId
            : "";

        if (!claim || !signature || !toolCallId) {
          throw new Error(
            "INVALID_CASE_VERIFICATION_INPUT"
          );
        }

        const result =
          await this.caseVerifier.verify({
            claim,
            signature,
            toolCallId
          });

        if (
          result.status !== "FOUND" ||
          !isVerifiedRecord(result.record) ||
          !result.judgment
        ) {
          return JSON.stringify({
            status: result.status,
            error:
              result.reason ?? null,
            normalizedSignature:
              result.normalizedSignature,
            rejectedNearMatches:
              result.rejectedNearMatches
          });
        }

        this.ledger.add(
          result.record
        );

        return publicCaseToolResult(
          result.record,
          result.judgment
        );
      }
    });

    this.broker.register({
      name: TOOL_NAME,
      capability: "network",
      execute: async (input) => {
        const claim =
          typeof input.claim === "string"
            ? input.claim.trim()
            : "";
        const verificationKind = kind(input.kind);
        const url =
          typeof input.url === "string"
            ? input.url.trim()
            : "";
        const expectedTitle =
          typeof input.expectedTitle === "string"
            ? input.expectedTitle.trim()
            : "";
        const toolCallId =
          typeof input.toolCallId === "string"
            ? input.toolCallId
            : "";
        const act = input.resolvedAct as
          | LegalActDescriptor
          | undefined;
        const freshness = input.freshness as
          | TemporalFreshnessResult
          | undefined;
        const temporalMode =
          input.temporalMode === "HISTORICAL"
            ? "HISTORICAL"
            : "CURRENT";
        const asOf =
          typeof input.asOf === "string"
            ? input.asOf
            : undefined;

        if (
          !claim ||
          !verificationKind ||
          !url ||
          !expectedTitle ||
          !toolCallId ||
          !act
        ) {
          throw new Error("INVALID_VERIFICATION_INPUT");
        }

        const result = await this.verifier.verify({
          claim,
          kind: verificationKind,
          url,
          expectedTitle,
          toolCallId
        });

        if (
          result.record.status ===
          "SUPPORTED"
        ) {
          throw new Error(
            "STATUTE_VERIFIER_RETURNED_SUPPORTED"
          );
        }

        const statutoryStatus:
          "VERIFIED" | "UNVERIFIED" =
          result.record.status;

        const acceptedFreshnessStatus:
          | "CURRENT"
          | "HISTORICAL"
          | undefined =
          freshness?.status ===
            "CURRENT" ||
          freshness?.status ===
            "HISTORICAL"
            ? freshness.status
            : result.record
                .sourceFormat ===
                "PDF" &&
              freshness?.status ===
                "CURRENT_TEXT_REQUIRES_PDF"
              ? "CURRENT"
              : result.record
                    .sourceFormat ===
                    "PDF" &&
                  freshness?.status ===
                    "HISTORICAL_TEXT_REQUIRES_PDF"
                ? "HISTORICAL"
                : undefined;

        const statutoryRecord:
          VerificationRecord = {
            ...result.record,
            status:
              statutoryStatus,
            temporalMode,
            ...(freshness &&
            acceptedFreshnessStatus
              ? {
                  temporalFreshnessStatus:
                    acceptedFreshnessStatus,
                  freshnessCheckedAt:
                    freshness.checkedAt,
                  ...(freshness.currentEli
                    ? {
                        currentEli:
                          freshness.currentEli
                      }
                    : {})
                }
              : {}),
            ...(asOf ? { asOf } : {})
          };

        this.ledger.add(
          statutoryRecord
        );

        return publicToolResult(
          {
            claim:
              statutoryRecord.claim,
            status:
              statutoryStatus,
            ...(statutoryRecord.sourceUrl
              ? {
                  sourceUrl:
                    statutoryRecord.sourceUrl
                }
              : {}),
            fetchedAt:
              statutoryRecord.fetchedAt,
            temporalMode,
            ...(asOf ? { asOf } : {}),
            ...(statutoryRecord.sourceFormat
              ? {
                  sourceFormat:
                    statutoryRecord.sourceFormat
                }
              : {}),
            ...(statutoryRecord.evidence
              ? {
                  evidence:
                    statutoryRecord.evidence
                }
              : {})
          },
          act,
          freshness
        );
      }
    });
  }

  schemas(): NormalizedToolSchema[] {
    return [
      TOOL_SCHEMA,
      CASE_SEARCH_TOOL_SCHEMA,
      CASE_TOOL_SCHEMA,
      CASE_QUOTE_TOOL_SCHEMA,
      CASE_PROPOSITION_TOOL_SCHEMA
    ];
  }

  systemPromptAppendix(): string {
    return LEGAL_VERIFICATION_SYSTEM_APPENDIX;
  }

  private async describeUnregisteredAct(
    act: string,
    claim: string
  ): Promise<{ act?: LegalActDescriptor; outage?: string }> {
    try {
      const described = await describeEliAct({
        act,
        claim,
        index: this.coreLaw,
        fetcher: this.eliFetch,
        today: new Date().toISOString().slice(0, 10)
      });
      return described ? { act: described } : {};
    } catch (error) {
      // Awaria ELI (sieć, 5xx, 429, 403), a nie brak aktu.
      return {
        outage:
          "ELI_UNAVAILABLE:" +
          (error instanceof Error ? error.message : String(error))
      };
    }
  }

  /**
   * Model w chmurze: lokalna kopia ELI (RAG) tylko przy awarii samego ELI, z wyraźną
   * informacją w wyniku; odmowa kopii zostaje odmową. Model lokalny próbował kopii już
   * wcześniej, więc tu tylko odmowa z przyczyną.
   */
  private eliOutageFallback(
    call: NormalizedToolCall,
    actInput: string,
    asOf: string,
    cause: string,
    localCopy: string | undefined
  ): string {
    if (this.localModel || !this.coreLaw) {
      return JSON.stringify({
        status: "DENIED",
        error: cause,
        ...(localCopy ? { localCopy } : {})
      });
    }
    const local = this.verifyWithCoreLaw(call, actInput, asOf);
    if (local.denied) {
      return JSON.stringify({ status: "DENIED", error: cause, localCopy: local.denied });
    }
    return JSON.stringify(
      withEliOutageNotice(JSON.parse(local.content) as Record<string, unknown>, cause)
    );
  }

  /**
   * Model lokalny: przed użyciem kopii sprawdzenie w ELI, czy nie ma nowszego t.j. albo
   * nowych nowelizacji (CoreLawIndex.confirmCurrent). Znaleziona zmiana -> kopia odmawia
   * (TEMPORAL_UPDATE_PENDING) i weryfikacja idzie do ELI; ELI niedostępne -> kopia z informacją.
   */
  private async checkCopyInEli(actInput: string): Promise<CoreLawUseCheck | undefined> {
    const index = this.coreLaw;
    if (!index?.confirmCurrent) return undefined;
    const eli = index.resolve(actInput)?.eli ?? resolveActByTitle(index, actInput);
    if (!eli) return undefined;
    try {
      return await index.confirmCurrent(eli);
    } catch (error) {
      return {
        state: "UNREACHABLE",
        checkedAt: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private verifyWithCoreLaw(
    call: NormalizedToolCall,
    actInput: string,
    asOf: string,
    liveCheck?: CoreLawUseCheck
  ): { content: string; denied?: string } {
    const claim =
      typeof call.input.claim === "string"
        ? call.input.claim.trim()
        : "";
    const quote =
      typeof call.input.quote === "string"
        ? call.input.quote.trim()
        : "";
    const verificationKind = kind(call.input.kind);
    if (!claim || !verificationKind || !this.coreLaw) {
      return {
        content: JSON.stringify({ status: "DENIED", error: "INVALID_VERIFICATION_INPUT" }),
        denied: "INVALID_VERIFICATION_INPUT"
      };
    }
    const outcome = verifyFromCoreLaw({
      index: this.coreLaw,
      claim,
      kind: verificationKind,
      act: actInput,
      ...(quote ? { quote } : {}),
      ...(asOf ? { asOf } : {}),
      toolCallId: call.id
    });
    this.resolverAudit.push({
      sequence: this.resolverAudit.length + 1,
      tool: TOOL_NAME,
      capability: "read",
      decision: outcome.decision === "DENY" ? "DENY" : "ALLOW",
      reason:
        outcome.decision === "DENY"
          ? outcome.reason
          : "CORE_LAW_LOCAL_ELI_COPY"
    });
    if (outcome.decision === "DENY") {
      return {
        content: JSON.stringify({ status: "DENIED", error: outcome.reason, localCopy: outcome.reason }),
        denied: outcome.reason
      };
    }

    const { record, act } = outcome;
    this.ledger.add(record);
    const verified = record.status === "VERIFIED";
    const payload = {
      claim: record.claim,
      status: record.status,
      act: {
        eli: act.eli,
        currentEli: act.currentEli,
        title: act.title,
        resolvedBy: act.resolvedBy,
        sourceKind: "local_eli_copy"
      },
      freshness: {
        textFetchedAt: record.fetchedAt,
        relationsCheckedAt: act.relationsCheckedAt,
        amendmentsAfter: 0,
        ...(liveCheck ? { liveCheck: liveCheck.state } : {})
      },
      sourceUrl: record.sourceUrl ?? null,
      sourceLink: verificationSourceLink(record) ?? null,
      sourceFormat: record.sourceFormat ?? null,
      evidence: record.evidence ?? null,
      fetchedAt: record.fetchedAt,
      marker: verified
        ? verificationMarker(record)
        : "⚠️ [NIEWERYFIKOWANE]",
      instruction: verified
        ? "Copy the marker verbatim onto the same line as this exact legal reference. " + STATUS_CONSISTENCY_INSTRUCTION + " Use the returned evidence (official ELI consolidated text as of the copy date) as the provision wording; never reconstruct it from memory."
        : "Do not present this reference as verified; if it must be mentioned, use the unverified marker."
    };
    return {
      content: JSON.stringify(
        liveCheck?.state === "UNREACHABLE"
          ? withEliOutageNotice(payload, `ELI_UNAVAILABLE:${liveCheck.error ?? "USE_CHECK_FAILED"}`)
          : payload
      )
    };
  }

  auditEvents(): readonly ToolAuditEvent[] {
    return [
      ...this.resolverAudit.map((event) => ({ ...event })),
      ...this.broker.audit.map((event) => ({ ...event }))
    ].map((event, index) => ({
      ...event,
      sequence: index + 1
    }));
  }

  async runTools(
    calls: NormalizedToolCall[]
  ): Promise<NormalizedToolResult[]> {
    const results: NormalizedToolResult[] = [];

    for (const call of calls) {
      if (
        call.name ===
        CASE_SEARCH_TOOL_NAME
      ) {
        const query =
          typeof call.input.query === "string"
            ? call.input.query.trim()
            : "";
        const source =
          typeof call.input.source === "string"
            ? call.input.source.trim()
            : "";
        const limit =
          typeof call.input.limit === "number"
            ? call.input.limit
            : undefined;

        if (
          !query ||
          (
            source !== "SAOS" &&
            source !== "CBOSA"
          )
        ) {
          this.resolverAudit.push({
            sequence:
              this.resolverAudit.length + 1,
            tool:
              CASE_SEARCH_TOOL_NAME,
            capability: "network",
            decision: "DENY",
            reason:
              "INVALID_CASE_SEARCH_INPUT"
          });
          results.push({
            tool_use_id: call.id,
            content:
              JSON.stringify({
                status:
                  "OUT_OF_SCOPE",
                error:
                  "INVALID_CASE_SEARCH_INPUT"
              })
          });
          continue;
        }

        const typedSource =
          source as CaseLawSearchSource;
        const result =
          await this.broker.execute({
            name:
              CASE_SEARCH_TOOL_NAME,
            input: {
              query,
              source:
                typedSource,
              ...(limit !== undefined
                ? { limit }
                : {}),
              url:
                caseLawSearchEntryUrl(
                  typedSource
                )
            }
          });

        results.push({
          tool_use_id: call.id,
          content: result.ok
            ? String(
                result.output ?? ""
              )
            : JSON.stringify({
                status:
                  "OUT_OF_SCOPE",
                error:
                  result.error ??
                  "CASE_SEARCH_TOOL_FAILED"
              })
        });
        continue;
      }

      if (
        call.name ===
        CASE_PROPOSITION_TOOL_NAME
      ) {
        const signature =
          typeof call.input.signature === "string"
            ? call.input.signature.trim()
            : "";
        const courtFamily =
          typeof call.input.courtFamily === "string"
            ? call.input.courtFamily.trim()
            : "";

        if (courtFamily !== "SN") {
          this.resolverAudit.push({
            sequence:
              this.resolverAudit.length + 1,
            tool:
              CASE_PROPOSITION_TOOL_NAME,
            capability: "network",
            decision: "DENY",
            reason:
              "UNSUPPORTED_COURT_FAMILY"
          });
          results.push({
            tool_use_id: call.id,
            content:
              JSON.stringify({
                status: "OUT_OF_SCOPE",
                error:
                  "UNSUPPORTED_COURT_FAMILY"
              })
          });
          continue;
        }

        const result =
          await this.broker.execute({
            name:
              CASE_PROPOSITION_TOOL_NAME,
            input: {
              caseClaim:
                call.input.caseClaim,
              signature,
              proposition:
                call.input.proposition,
              supportQuote:
                call.input.supportQuote,
              toolCallId:
                call.id,
              url:
                supremeCourtSearchUrl(
                  signature
                )
            }
          });

        results.push({
          tool_use_id: call.id,
          content: result.ok
            ? String(
                result.output ?? ""
              )
            : JSON.stringify({
                status:
                  "OUT_OF_SCOPE",
                error:
                  result.error ??
                  "CASE_PROPOSITION_TOOL_FAILED"
              })
        });
        continue;
      }

      if (
        call.name ===
        CASE_QUOTE_TOOL_NAME
      ) {
        const signature =
          typeof call.input.signature === "string"
            ? call.input.signature.trim()
            : "";
        const courtFamily =
          typeof call.input.courtFamily === "string"
            ? call.input.courtFamily.trim()
            : "";

        if (courtFamily !== "SN") {
          this.resolverAudit.push({
            sequence:
              this.resolverAudit.length + 1,
            tool: CASE_QUOTE_TOOL_NAME,
            capability: "network",
            decision: "DENY",
            reason:
              "UNSUPPORTED_COURT_FAMILY"
          });
          results.push({
            tool_use_id: call.id,
            content: JSON.stringify({
              status: "OUT_OF_SCOPE",
              error:
                "UNSUPPORTED_COURT_FAMILY"
            })
          });
          continue;
        }

        const result =
          await this.broker.execute({
            name:
              CASE_QUOTE_TOOL_NAME,
            input: {
              caseClaim:
                call.input.caseClaim,
              signature,
              quote:
                call.input.quote,
              toolCallId:
                call.id,
              url:
                supremeCourtSearchUrl(
                  signature
                )
            }
          });

        results.push({
          tool_use_id: call.id,
          content: result.ok
            ? String(
                result.output ?? ""
              )
            : JSON.stringify({
                status: "OUT_OF_SCOPE",
                error:
                  result.error ??
                  "CASE_QUOTE_TOOL_FAILED"
              })
        });
        continue;
      }

      if (call.name === CASE_TOOL_NAME) {
        const signature =
          typeof call.input.signature === "string"
            ? call.input.signature.trim()
            : "";
        const courtFamily =
          typeof call.input.courtFamily === "string"
            ? call.input.courtFamily.trim()
            : "";

        if (courtFamily !== "SN") {
          this.resolverAudit.push({
            sequence:
              this.resolverAudit.length + 1,
            tool: CASE_TOOL_NAME,
            capability: "network",
            decision: "DENY",
            reason:
              "UNSUPPORTED_COURT_FAMILY"
          });
          results.push({
            tool_use_id: call.id,
            content: JSON.stringify({
              status: "OUT_OF_SCOPE",
              error:
                "UNSUPPORTED_COURT_FAMILY"
            })
          });
          continue;
        }

        const result =
          await this.broker.execute({
            name: CASE_TOOL_NAME,
            input: {
              claim: call.input.claim,
              signature,
              toolCallId: call.id,
              url:
                supremeCourtSearchUrl(
                  signature
                )
            }
          });

        results.push({
          tool_use_id: call.id,
          content: result.ok
            ? String(
                result.output ?? ""
              )
            : JSON.stringify({
                status: "OUT_OF_SCOPE",
                error:
                  result.error ??
                  "CASE_TOOL_FAILED"
              })
        });
        continue;
      }

      const actInput =
        typeof call.input.act === "string"
          ? call.input.act.trim()
          : "";
      const asOf =
        typeof call.input.asOf === "string"
          ? call.input.asOf.trim()
          : "";

      // Modele lokalne (Bielik, Mistral): najpierw lokalna kopia ELI (RAG), także KC/KPC/KK/KPK.
      // Gdy kopia nie może odpowiedzieć, próba w źródle i dołączenie aktu do kopii.
      // Modele w chmurze: wyłącznie źródło (Sejm ELI), bez cichego przejścia na kopię.
      let localCopy: string | undefined;
      if (this.localModel && this.coreLaw) {
        const liveCheck = asOf ? undefined : await this.checkCopyInEli(actInput);
        const local = this.verifyWithCoreLaw(call, actInput, asOf, liveCheck);
        if (!local.denied) {
          results.push({ tool_use_id: call.id, content: local.content });
          continue;
        }
        localCopy = local.denied;
      }
      const deny = (error: string, extra: Record<string, unknown> = {}) =>
        JSON.stringify({
          status: "DENIED",
          error,
          ...extra,
          ...(localCopy ? { localCopy } : {})
        });

      let resolvedAct: LegalActDescriptor | undefined;
      try {
        resolvedAct = this.resolver.resolve(actInput);
      } catch (error) {
        const reason =
          error instanceof LegalActResolutionError
            ? error.code
            : "LEGAL_ACT_RESOLUTION_FAILED";

        // Akty spoza rejestru: w źródle (Sejm ELI) z kontrolą aktualności, tak jak KC/KPC/KK/KPK.
        if (
          reason === "UNKNOWN_LEGAL_ACT" &&
          this.freshnessChecker
        ) {
          const described =
            await this.describeUnregisteredAct(
              actInput,
              typeof call.input.claim === "string"
                ? call.input.claim
                : ""
            );
          if (described.outage) {
            results.push({
              tool_use_id: call.id,
              content: this.eliOutageFallback(
                call,
                actInput,
                asOf,
                described.outage,
                localCopy
              )
            });
            continue;
          }
          resolvedAct = described.act;
        }

        if (!resolvedAct) {
          this.resolverAudit.push({
            sequence: this.resolverAudit.length + 1,
            tool: TOOL_NAME,
            capability: "network",
            decision: "DENY",
            reason
          });
          results.push({
            tool_use_id: call.id,
            content: deny(reason)
          });
          continue;
        }
      }

      let freshness:
        | TemporalFreshnessResult
        | undefined;

      if (this.freshnessChecker) {
        freshness =
          await this.freshnessChecker.check(
            resolvedAct,
            {
              ...(asOf
                ? { asOf }
                : {}),
              ...(typeof call.input.claim ===
                "string"
                ? {
                    claim:
                      call.input.claim
                  }
                : {})
            }
          );

        const directTextStatus =
          freshness.status === "CURRENT" ||
          freshness.status === "HISTORICAL";
        const pdfTextStatus =
          freshness.status ===
            "CURRENT_TEXT_REQUIRES_PDF" ||
          freshness.status ===
            "HISTORICAL_TEXT_REQUIRES_PDF";
        const temporalStatusPermitsVerification =
          directTextStatus ||
          (
            pdfTextStatus &&
            this.verifier.supportsPdf()
          );

        if (
          !temporalStatusPermitsVerification &&
          freshness.status === "SOURCE_METADATA_UNAVAILABLE"
        ) {
          results.push({
            tool_use_id: call.id,
            content: this.eliOutageFallback(
              call,
              actInput,
              asOf,
              "ELI_UNAVAILABLE:TEMPORAL_SOURCE_METADATA_UNAVAILABLE",
              localCopy
            )
          });
          continue;
        }

        if (!temporalStatusPermitsVerification) {
          const reason =
            "TEMPORAL_" + freshness.status;

          this.resolverAudit.push({
            sequence:
              this.resolverAudit.length + 1,
            tool: TOOL_NAME,
            capability: "network",
            decision: "DENY",
            reason
          });
          results.push({
            tool_use_id: call.id,
            content: JSON.stringify({
              status: "DENIED",
              error: reason,
              ...(localCopy ? { localCopy } : {}),
              freshness: {
                status: freshness.status,
                checkedAt:
                  freshness.checkedAt,
                currentEli:
                  freshness.currentEli ??
                  null,
                amendmentsAfter:
                  freshness.amendmentsAfter
                    .length,
                reason:
                  freshness.reason ?? null
              }
            })
          });
          continue;
        }
      }

      const sourceUrl =
        freshness?.sourceUrl ??
        resolvedAct.sourceUrl;

      const result = await this.broker.execute({
        name: call.name,
        input: {
          claim: call.input.claim,
          kind: call.input.kind,
          toolCallId: call.id,
          url: sourceUrl,
          expectedTitle: resolvedAct.title,
          resolvedAct,
          ...(freshness
            ? { freshness }
            : {}),
          ...(freshness?.mode === "HISTORICAL"
            ? {
                temporalMode: "HISTORICAL",
                ...(freshness.requestedAsOf
                  ? {
                      asOf:
                        freshness.requestedAsOf
                    }
                  : {})
              }
            : {
                temporalMode: "CURRENT"
              })
        }
      });

      // Tekstu nie dało się pobrać z ELI (sieć, 5xx, 429, 403): awaria źródła, nie wynik.
      if (
        !result.ok &&
        /could not be fetched|returned HTTP (?!404\b)\d{3}|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|aborted|timeout/i.test(
          result.error ?? ""
        )
      ) {
        results.push({
          tool_use_id: call.id,
          content: this.eliOutageFallback(
            call,
            actInput,
            asOf,
            "ELI_UNAVAILABLE:SOURCE_FETCH_FAILED",
            localCopy
          )
        });
        continue;
      }

      if (
        result.ok &&
        (resolvedAct.id === "ELI" || this.localModel) &&
        this.adoptAct
      ) {
        try {
          if (
            (JSON.parse(String(result.output ?? "")) as { status?: unknown })
              .status === "VERIFIED"
          ) {
            this.adoptAct({
              ...resolvedAct,
              eli:
                freshness?.currentEli ??
                resolvedAct.eli
            });
          }
        } catch {
          // Wynik bez JSON: nic do dołączenia.
        }
      }


      results.push({
        tool_use_id: call.id,
        content: result.ok
          ? String(result.output ?? "")
          : deny(result.error ?? "TOOL_FAILED")
      });
    }

    return results;
  }
}

export type LegalVerificationToolFactory = (
  ledger: VerificationLedger,
  context?: { localModel: boolean }
) => LegalVerificationToolRuntime;