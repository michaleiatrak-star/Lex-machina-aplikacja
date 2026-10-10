import { todayWarsaw } from "./warsaw-date.js";
import { caseLawRepository } from "./case-law-store.js";
import { caseLinkProblem, misroutedSignature, signatureRedirect } from "./court-of-signature.js";
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
import { canonicalInterpretationSignature, verifyInterpretation } from "./interpretation-verifier.js";
import { SubstituteSourceError, verifySubstituteSources, type ConsolidatedIdentity, type SubstituteOutcome } from "./substitute-source.js";
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
const INTERPRETATION_TOOL_NAME = "verify_interpretation";

const INTERPRETATION_TOOL_SCHEMA: NormalizedToolSchema = {
  type: "function",
  function: {
    name: INTERPRETATION_TOOL_NAME,
    description:
      "Verify a Polish tax interpretation (individual or general, KIS/MF) by its exact signature in EUREKA (eureka.mf.gov.pl, RZĄD 2A). " +
      "Call before citing any interpretation signature. VERIFIED confirms the document exists under exactly this signature and returns its thesis, date and EUREKA status (current or not); " +
      "never supply a URL. An interpretation is not a source of law: the provision it applies is still verified with verify_legal_reference.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["signature"],
      properties: {
        signature: {
          type: "string",
          description: "Exact signature, e.g. 0114-KDIP1-2.4012.345.2024.1.RD, IPPP1/4512-123/15-2/AW or DD10.8201.1.2020."
        },
        quote: {
          type: "string",
          description: "Optional exact wording you intend to quote from the interpretation; a mismatch makes it UNVERIFIED."
        }
      }
    }
  }
};

const CASE_SEARCH_TOOL_NAME =
  "search_case_law";
const CASE_LIBRARY_TOOL_NAME = "search_case_law_library";
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
        },
        substituteSourceUrls: {
          type: "array",
          items: { type: "string" },
          maxItems: 3,
          description:
            "Only after a result with `substitute` (RZĄD 1 / Sejm ELI unavailable): https URLs of the same article. E-3: one RZĄD 2A source (LEX/Legalis, official databases) gives ✅ [VER]. E-4: two independent RZĄD 2B portals (e.g. arslege.pl, lexlege.pl) showing the t.j. Dz.U. number give at most 🟨 [KOTWICA-URZĘDOWA] (K-1…K-4). RZĄD 3 is refused."
        }
      }
    }
  }
};

const SUBSTITUTE_HINT =
  "BRAK-AKTU w RZĘDZIE 1: Sejm ELI is unavailable and the local ELI copy cannot confirm this provision. Per E-3/E-4 (shared/HIERARCHIA-ZRODEL.md) call verify_legal_reference again with substituteSourceUrls: first a RZĄD 2A source (LEX/Legalis or an official database) -> ✅ [VER]; if none, two independent RZĄD 2B portals -> at most 🟨 [KOTWICA-URZĘDOWA] + 📚 [TREŚĆ: …] (K-1…K-4). Otherwise ⚠️ [NIEWERYFIKOWANE]. RZĄD 3 never confirms a provision.";


const CASE_LIBRARY_TOOL_SCHEMA: NormalizedToolSchema = {
  type: "function",
  function: {
    name: CASE_LIBRARY_TOOL_NAME,
    description:
      "Search the user's local case-law library (decisions downloaded earlier from official sources, catalogued by court, signature and date; enabled in Settings). " +
      "Returns entries with the decision's card (source link) and a passage. Before citing as verified, run verify_case_reference (SN) or the court's own check.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", description: "Signature (e.g. II CSKP 89/26), court or a phrase from the text." },
        limit: { type: "integer", minimum: 1, maximum: 10 }
      }
    }
  }
};

const SN_FORMS = [
  "wyrok SN", "wyrok SN SD", "wyrok siedmiu sędziów SN", "wyrok siedmiu sędziów SN SD", "postanowienie SN", "postanowienie SN SD",
  "postanowienie siedmiu sędziów SN", "postanowienie całej Izby SN", "uchwała SN", "uchwała SN SD", "uchwała siedmiu sędziów SN",
  "uchwała siedmiu sędziów SN zasada prawna", "uchwała siedmiu sędziów SN SD", "uchwała całej izby SN", "uchwała całej Izby SN zasada prawna",
  "uchwała połączonych izb SN", "uchwała połączonych Izb SN zasada prawna", "uchwała pełnego składu SN", "uchwała pełnego składu SN zasada prawna",
  "orzeczenie", "zarządzenie", "wyciąg z protokołu", "opinia"
];
const SN_CHAMBERS = [
  "Izba Cywilna", "Izba Karna", "Izba Odpowiedzialności Zawodowej", "Izba Pracy i Ubezpieczeń Społecznych",
  "Izba Pracy, Ubezpieczeń Społecznych i Spraw Publicznych", "Izba Wojskowa", "Izba Administracyjna, Pracy i Ubezpieczeń Społecznych",
  "Izba Kontroli Nadzwyczajnej i Spraw Publicznych", "Izba Dyscyplinarna"
];

const SAOS_COURT_TYPES = ["SUPREME", "COMMON", "ADMINISTRATIVE", "CONSTITUTIONAL_TRIBUNAL", "NATIONAL_APPEAL_CHAMBER"];
const SAOS_JUDGMENT_TYPES = ["SENTENCE", "DECISION", "RESOLUTION", "REASONS", "REGULATION"];

const CASE_SEARCH_TOOL_SCHEMA: NormalizedToolSchema = {
  type: "function",
  function: {
    name: CASE_SEARCH_TOOL_NAME,
    description:
      "Search Polish case-law candidates. source=SN: the official sn.pl search form (text of the decision and its reasons, signature, form, date range, chamber, panel, judges); hits carry the decision's card. " +
      "source=CBOSA for NSA/WSA. SAOS is an academic aggregator (lowest rank) with partial coverage: common courts current, SN only to 2016, TK to 2015, KIO to 2018, no NSA/WSA; use it for older rulings and common courts, as a citator, and as the fallback when the court's official source fails. " +
      "A known signature goes straight to the official registry (verify_case_reference / CBOSA / court portal), not here and not to web search. For recent rulings (SN after 2016, TK after 2015, KIO after 2018, or the last 2-3 years) run web_search with an abstract legal phrase (never case data) to find signatures in secondary sources, in parallel with source=SN or source=CBOSA. " +
      "This is discovery only: returned candidates are NOT verified for citation. After selecting a candidate, run the applicable verification workflow before citing it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["source"],
      properties: {
        query: {
          type: "string",
          description: "Full-text legal phrase (SN: searched in the decision and its reasons). May be empty for SN when other fields are given. Do not fabricate a case signature."
        },
        source: { type: "string", enum: ["SN", "SAOS", "CBOSA"] },
        limit: { type: "integer", minimum: 1, maximum: 10 },
        signature: { type: "string", description: "SN only: case signature, e.g. II CSKP 89/26." },
        form: { type: "string", enum: SN_FORMS, description: "SN only: form of the decision." },
        dateOn: { type: "string", description: "SN only: issued on YYYY-MM-DD." },
        dateFrom: { type: "string", description: "SN only: issued from YYYY-MM-DD." },
        dateTo: { type: "string", description: "SN only: issued until YYYY-MM-DD." },
        chamber: { type: "string", enum: SN_CHAMBERS, description: "SN only: chamber (Izba SN)." },
        panel: { type: "string", description: "SN only: panel, e.g. Skład 7-osobowy." },
        judge: { type: "string", description: "SN only: judge on the panel (surname)." },
        presiding: { type: "string", description: "SN only: presiding judge." },
        rapporteur: { type: "string", description: "SN only: judge rapporteur." },
        reasonsAuthor: { type: "string", description: "SN only: author of the reasons." },
        courtType: { type: "string", enum: SAOS_COURT_TYPES, description: "SAOS only: court type (SUPREME = Sąd Najwyższy)." },
        judgmentType: { type: "string", enum: SAOS_JUDGMENT_TYPES, description: "SAOS only: SENTENCE = wyrok, DECISION = postanowienie, RESOLUTION = uchwała." }
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
      "Provide the exact output claim, raw signature and courtFamily=SN; with only a card link from the user, pass card_url and leave signature empty. " +
      "Never invent a source URL. The cited source is the returned card (sn.pl ?orzeczenie=ID), never a PDF or blob: address. VERIFIED confirms official existence and full-text identity, not an arbitrary paraphrased thesis.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [
        "claim",
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
            "Raw Sąd Najwyższy signature, e.g. III CZP 25/11 (may be empty when card_url is given)."
        },
        courtFamily: {
          type: "string",
          enum: ["SN"]
        },
        card_url: {
          type: "string",
          description:
            "Optional: the decision's card on sn.pl (https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ID or the bare ID) when the user gave it or one signature has several decisions."
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
  "- If the user explicitly asks for a past legal state, or the matter turns on an event in the past (PRAWO-HARDGATE KROK 4: the wording in force on the event date), pass asOf=YYYY-MM-DD for the provisions that decide it. The application also re-checks provisions verified in their current wording on event dates found in the question and reports a different wording in the mandatory-path register. Historical verification is allowed only when ELI proves the act was in force on that date and the selected historical consolidated text covers that date without intervening amendments.",
  "- For VERIFIED results, copy the returned marker verbatim onto the SAME LINE as the exact citation.",
  "- " + STATUS_CONSISTENCY_INSTRUCTION,
  "- Every act, KC/KPC/KPK/KK included, is verified at the source (Sejm ELI: current consolidated text and amendments after it); an act outside the DR act maps is found by its Dz.U. reference or an unambiguous title and then added to the local copy. The local official ELI copy (RAG) is used only when ELI itself fails; such a result carries sourceNotice.eliUnavailable and you must say so explicitly next to the reference. Local models (Bielik, Mistral) check the local copy first. The act may be named by its full or inflected title, Dz.U. reference or ELI; what decides is whether the provision exists in the consolidated text and whether your optional quote matches it.",
  "- Source canon E-1…E-5 (shared/HIERARCHIA-ZRODEL.md): RZĄD 1 (Sejm ELI) first. Only when verify_legal_reference returns `substitute` (BRAK-AKTU in RZĄD 1), pass substituteSourceUrls: E-3 one RZĄD 2A source (LEX/Legalis, official databases) -> ✅ [VER]; E-4 two independent RZĄD 2B portals with the t.j. number -> at most 🟨 [KOTWICA-URZĘDOWA] + 📚 [TREŚĆ: …]; otherwise ⚠️ [NIEWERYFIKOWANE]. RZĄD 3 is auxiliary only. The status hierarchy is closed (✅ > 🟨 > ⚠️ > ⬛): never create another label. Copy the returned marker verbatim and state that RZĄD 1 was unavailable (K-4).",
  "- Never invent a verification marker, source URL, or tool result.",
  "- For UNVERIFIED/DENIED results, do not represent the citation as verified.",
  "- For case-law discovery, call search_case_law. Search SAOS and CBOSA as separate sources when both are relevant.",
  "- Case-law discovery policy: (a) signature known -> look it up by repertory in the official registry (verify_case_reference / CBOSA / court portal); no web search, no SAOS. " +
    "(b) Topic search for recent rulings (SN after 2016, TK after 2015, KIO after 2018, or rulings of the last 2-3 years) -> web_search (when available) with an abstract legal phrase, never case data, to find signatures in secondary sources, in parallel with the official full-text search (search_case_law source=SN / source=CBOSA) using the topic in its legal terms and the provision (e.g. 'zorganizowana grupa przestępcza', 'art. 258 k.k.'), then a second phrasing if the first gives nothing usable. SAOS does not hold these rulings. " +
    "(c) Older rulings or common courts -> search_case_law source=SAOS plus web_search; SAOS also serves as a citator. " +
    "Secondary sources (web pages, commentaries, news) give only the signature: the thesis and any quote come only from the verified official text.",
  "- Form of the decision: when the user asks for a judgment (wyrok), pass form=wyrok (SN) or judgmentType=SENTENCE (SAOS) and never present a postanowienie or uchwała as a wyrok; if only another form exists, say so plainly.",
  "- search_case_law returns candidates only and never creates a VERIFIED ledger record. Never cite a discovered signature as verified without the applicable verification step.",
  "- NSA/WSA (CBOSA) material is a dated SNAPSHOT: present it as a snapshot and never promote it to VERIFIED. A CBOSA search with no hits is OUT_OF_SCOPE, never evidence that no judgment exists.",
  "- SAOS is a discovery source; CBOSA discovery is direct NSA/WSA retrieval but remains DISCOVERY until the candidate is verified under the case-law rules.",
  "- Before citing a tax interpretation (KIS/MF signature, e.g. 0114-KDIP1-2.4012.345.2024.1.RD), call verify_interpretation and copy the returned marker onto the SAME LINE as the signature. Say whether it is an interpretation of an authority (not binding on a court, 📋) or a court ruling (⚖️); an interpretation EUREKA does not list as current is never presented as the authority's current position. Without VERIFIED: ⚠️ [NIEWERYFIKOWANE] or omit the signature.",
  "- Before emitting a case signature (sygn.), call verify_case_reference.",
  "- The first supported courtFamily is SN. Pass claim + signature + courtFamily; pass card_url only when the user gave a card link or ID. Never invent an sn.pl URL.",
  "- SN source = the decision's card (https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ID) returned by verify_case_reference: cite it, never a PDF/text address. A blob: link is a temporary copy in one browser tab; the old /sites/orzecznictwo/Orzeczenia… PDF directory no longer serves decisions. Neither proves anything; no hit there is not evidence that a decision is unpublished.",
  "- Look a signature up where its court publishes: SN repertories (CSK, CSKP, CZP, KK, UK…) → verify_case_reference; NSA/WSA (OSK, FSK, GSK, SA/xx) → CBOSA; KIO → kio; common courts (C, Ca, ACa, K, AKa, P, U…) → orzeczenia.ms.gov.pl (court portal; SAOS as fallback); TK (K, P, SK, U) → ipo.trybunal.gov.pl. Never search an SN signature in CBOSA. A misrouted call returns SIGNATURE_OF_OTHER_COURT with the right tool.",
  "- With the case-law library enabled, search_case_law_library finds decisions downloaded earlier (by signature, court or phrase); cite their card.",
  "- SAOS is an academic aggregator (lowest rank, coverage: common courts current, SN only to 2016, TK to 2015, KIO to 2018, no NSA/WSA): to confirm a ruling use the court's official source first; SAOS only when the official server fails, or as the permanent link when the official portal gives none (SN has its card, so not for SN).",
  "- VERIFIED case output confirms exact official signature/metadata and full-text identity. It does not authorize an invented thesis or quote.",
  "- For a verbatim quotation attributed to SN, call verify_case_quote. Copy the exact quote plus both returned markers onto the SAME LINE as the exact case citation.",
  "- For a paraphrased proposition attributed to SN, call verify_case_proposition with the exact proposition plus an exact supporting quotation.",
  "- verify_case_proposition returns SUPPORTED, never VERIFIED. SUPPORTED means the proposition is transparently linked to official evidence; semantic entailment is not independently decided by the runtime.",
  "- For SUPPORTED propositions, keep the exact proposition and supportQuote unchanged and put them with the case citation, case marker, CASE-QUOTE marker and CASE-SUPPORT marker on the SAME LINE."
].join("\n");

// search_case_law source=SN: tool fields → the sn.pl search form fields.
function snSearchFilters(input: Record<string, unknown>): Record<string, string> {
  const text = (value: unknown, max = 200) => (typeof value === "string" && value.trim() && value.length <= max ? value.trim() : "");
  const date = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : "");
  const on = date(input.dateOn);
  const fields: Record<string, string> = {
    sygnatura: text(input.signature, 40),
    forma_orzeczenia: SN_FORMS.includes(text(input.form)) ? text(input.form) : "",
    data_wydania_od: on || date(input.dateFrom),
    data_wydania_do: on || date(input.dateTo),
    izba: SN_CHAMBERS.includes(text(input.chamber)) ? text(input.chamber) : "",
    sklad_sedziowski: text(input.panel, 60),
    sedzia_w_skladzie: text(input.judge, 80),
    przewodniczacy: text(input.presiding, 80),
    sprawozdawca: text(input.rapporteur, 80),
    autor_uzasadnienia: text(input.reasonsAuthor, 80)
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
}

// search_case_law source=SAOS: court type and form of the decision.
function saosSearchFilters(input: Record<string, unknown>): { courtType?: string; judgmentType?: string } {
  const courtType = typeof input.courtType === "string" && SAOS_COURT_TYPES.includes(input.courtType) ? input.courtType : undefined;
  const judgmentType = typeof input.judgmentType === "string" && SAOS_JUDGMENT_TYPES.includes(input.judgmentType) ? input.judgmentType : undefined;
  return { ...(courtType ? { courtType } : {}), ...(judgmentType ? { judgmentType } : {}) };
}

function searchCaseLawLibrary(input: Record<string, unknown>): string {
  const repository = caseLawRepository();
  if (!repository?.libraryEnabled()) {
    return JSON.stringify({ status: "DISABLED", instruction: "The case-law library is off (Settings). Use search_case_law or verify_case_reference." });
  }
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 200) : "";
  const limit = typeof input.limit === "number" ? Math.min(10, Math.max(1, Math.trunc(input.limit))) : 5;
  if (query.length < 2) return JSON.stringify({ status: "INVALID_QUERY" });
  const entries = repository.catalog(query, limit).map(({ sha256: _sha, ...entry }) => entry);
  return JSON.stringify({
    status: entries.length ? "FOUND" : "NOT_FOUND",
    query,
    entries,
    instruction: "Local copies of official decisions; the card (cardUrl) is the source to cite. Verify before citing as VERIFIED."
  });
}

// sn.pl (Imperva) stopped the request until a person passes its check: the chat shows
// the user the sn.pl verification window and repeats the question afterwards.
export function snVerificationNeeded(reason: string | undefined): boolean {
  return /^SN_[A-Z_]*(?:HTTP_403|BOT_PROTECTION)$/.test(reason ?? "");
}
const SN_VERIFICATION_INSTRUCTION =
  "SN_WERYFIKACJA_WYMAGANA: sn.pl requires a person to pass its check (captcha). The application shows the user the sn.pl verification window and repeats the question once it is passed. " +
  "Say so in one sentence; never say SN has no such decision and never conclude that the ruling does not exist. " +
  "Meanwhile use web_search (abstract legal phrase, never case data) for leads to signatures in secondary sources; search source=SAOS only for SN rulings issued before 2017 (SAOS holds SN decisions only up to 2016). " +
  "Mark every such hit as an unverified candidate; the thesis and quotes come only from the verified sn.pl text.";

export class LegalVerificationToolRuntime {
  // Pobieranie źródła zastępczego (testy podstawiają własne).
  substituteFetcher: typeof fetch | null = null;

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
    // Każdy akt zweryfikowany w źródle: brak w lokalnej kopii -> dołączany do kopii
    // i RAG; starszy t.j. w kopii niż w ELI -> pobranie nowego (adopt nic nie robi,
    // gdy kopia jest zgodna).
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

        const sn =
          source === "SN" && input.sn && typeof input.sn === "object" ? (input.sn as Record<string, string>) : {};
        if (
          (!query && !(source === "SN" && Object.keys(sn).length)) ||
          (
            source !== "SAOS" &&
            source !== "CBOSA" &&
            source !== "SN"
          )
        ) {
          throw new Error(
            "INVALID_CASE_SEARCH_INPUT"
          );
        }

        // A signature of another court: where to look instead of a misleading "no hits".
        const misrouted = misroutedSignature(source, [query, sn.sygnatura ?? ""].join(" "));
        if (misrouted) {
          return JSON.stringify({ source, query, candidates: [], ...misrouted, verificationStatus: "DISCOVERY_ONLY" });
        }

        const result =
          await this.caseLawSearch.search({
            query,
            ...(Object.keys(sn).length ? { sn } : {}),
            ...(source === "SAOS" ? { saos: saosSearchFilters(input) } : {}),
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
            snVerificationNeeded(result.reason)
              ? SN_VERIFICATION_INSTRUCTION
              : "Do not cite a candidate as verified. Run the applicable case verification workflow first."
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
        let signature =
          typeof input.signature === "string"
            ? input.signature.trim()
            : "";
        const toolCallId =
          typeof input.toolCallId === "string"
            ? input.toolCallId
            : "";
        let cardUrl =
          typeof input.card_url === "string" && input.card_url.trim() ? input.card_url.trim() : undefined;

        if (!claim || (!signature && !cardUrl) || !toolCallId) {
          throw new Error(
            "INVALID_CASE_VERIFICATION_INPUT"
          );
        }

        // Links that are not sources: a blob: address lives in one browser tab;
        // the old sn.pl PDF directory no longer serves decisions (its name keeps the signature).
        const linkProblem = cardUrl ? caseLinkProblem(cardUrl) : null;
        if (linkProblem) {
          cardUrl = undefined;
          if (!signature && linkProblem.signature) signature = linkProblem.signature;
          if (!signature) {
            return JSON.stringify({
              status: "OUT_OF_SCOPE",
              reason: linkProblem.kind === "BLOB" ? "TEMPORARY_BLOB_LINK" : "SN_LEGACY_PDF_LINK",
              instruction:
                linkProblem.kind === "BLOB"
                  ? "A blob: link is a copy in the user's browser tab that no one else can open. Pass the signature from the conversation (the decision is then taken from sn.pl), or ask the user for the signature, the card link (https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ID) or the saved PDF; never cite a blob: link."
                  : "The old sn.pl PDF directory is not a source. Ask for the signature or the card link; never cite this address."
            });
          }
        }
        // A card without a signature: the signature is read from the card's official text.
        if (!signature && cardUrl) {
          const fromCard = await this.caseVerifier.signatureFromCard(cardUrl).catch(() => null);
          if (!fromCard) {
            return JSON.stringify({
              status: "OUT_OF_SCOPE",
              reason: "SN_CARD_UNREADABLE",
              instruction: "The card did not return a readable SN decision. Ask for the signature; do not cite the card as verified."
            });
          }
          signature = fromCard.signature;
          cardUrl = fromCard.cardUrl;
        }
        const otherCourt = signatureRedirect(signature);
        if (otherCourt && otherCourt.court !== "Sąd Najwyższy") {
          return JSON.stringify({
            status: "OUT_OF_SCOPE",
            reason: "SIGNATURE_OF_OTHER_COURT",
            signature,
            ...otherCourt,
            instruction: `${signature} is not an SN signature. Use ${otherCourt.useInstead}.`
          });
        }

        const result =
          await this.caseVerifier.verify({
            claim,
            signature,
            toolCallId,
            ...(cardUrl ? { cardUrl } : {})
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
              result.rejectedNearMatches,
            ...(snVerificationNeeded(result.reason) ? { instruction: SN_VERIFICATION_INSTRUCTION } : {})
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
            ...(asOf ? { asOf } : {}),
            actDescriptor: { ...act }
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
      INTERPRETATION_TOOL_SCHEMA,
      CASE_SEARCH_TOOL_SCHEMA,
      CASE_LIBRARY_TOOL_SCHEMA,
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
        today: todayWarsaw()
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
  private async eliOutageFallback(
    call: NormalizedToolCall,
    actInput: string,
    asOf: string,
    cause: string,
    localCopy: string | undefined
  ): Promise<string> {
    let denied = localCopy;
    let localResult: Record<string, unknown> | null = null;
    if (!this.localModel && this.coreLaw) {
      const local = this.verifyWithCoreLaw(call, actInput, asOf);
      if (!local.denied) {
        localResult = withEliOutageNotice(JSON.parse(local.content) as Record<string, unknown>, cause);
        if (localResult.status === "VERIFIED") return JSON.stringify(localResult);
      } else {
        denied = local.denied;
      }
    }
    // BRAK-AKTU w RZĘDZIE 1 (ELI nie działa, kopia nie potwierdza): źródła zastępcze
    // wskazane przez model wg kanonu E-3/E-4.
    const substitute = Array.isArray(call.input.substituteSourceUrls)
      ? call.input.substituteSourceUrls.filter((item): item is string => typeof item === "string")
      : [];
    if (substitute.length > 0 && !asOf) {
      return this.verifyWithSubstitute(call, actInput, substitute, cause);
    }
    if (localResult) {
      return JSON.stringify({ ...localResult, substitute: SUBSTITUTE_HINT });
    }
    return JSON.stringify({
      status: "DENIED",
      error: cause,
      ...(denied ? { localCopy: denied } : {}),
      ...(asOf ? {} : { substitute: SUBSTITUTE_HINT })
    });
  }

  private async verifyWithSubstitute(
    call: NormalizedToolCall,
    actInput: string,
    urls: string[],
    cause: string
  ): Promise<string> {
    const claim = typeof call.input.claim === "string" ? call.input.claim.trim() : "";
    const verificationKind = kind(call.input.kind);
    const quote = typeof call.input.quote === "string" ? call.input.quote.trim() : "";
    if (!claim || !verificationKind) {
      return JSON.stringify({ status: "DENIED", error: "INVALID_VERIFICATION_INPUT" });
    }
    let outcome: SubstituteOutcome;
    try {
      outcome = await verifySubstituteSources({
        urls,
        claim,
        kind: verificationKind,
        ...(quote ? { quote } : {}),
        identity: this.consolidatedIdentity(actInput),
        r1Cause: cause,
        toolCallId: call.id,
        ...(this.substituteFetcher ? { fetcher: this.substituteFetcher } : {})
      });
    } catch (error) {
      const code = error instanceof SubstituteSourceError ? error.code : "SUBSTITUTE_FAILED";
      this.resolverAudit.push({ sequence: this.resolverAudit.length + 1, tool: TOOL_NAME, capability: "read", decision: "DENY", reason: code });
      return JSON.stringify({ status: "DENIED", error: cause, substituteError: code });
    }
    this.ledger.add(outcome.record);
    this.resolverAudit.push({
      sequence: this.resolverAudit.length + 1,
      tool: TOOL_NAME,
      capability: "read",
      decision: outcome.status === "NIEWERYFIKOWANE" ? "DENY" : "ALLOW",
      reason: `SUBSTITUTE_${outcome.status}`
    });
    return JSON.stringify({
      claim: outcome.record.claim,
      status: outcome.record.status,
      sourceStatus: outcome.status,
      sourceTier: outcome.record.sourceTier ?? null,
      substituteFor: "R1",
      r1Unavailable: cause,
      sourceUrl: outcome.record.sourceUrl ?? null,
      evidence: outcome.record.evidence ?? null,
      fetchedAt: outcome.record.fetchedAt,
      marker: outcome.marker,
      ...(outcome.reasons.length ? { reasons: outcome.reasons } : {}),
      instruction:
        "Copy the marker verbatim onto the line with the citation. K-4: say explicitly that RZĄD 1 (Sejm ELI) was unavailable and why (" +
        cause +
        "). " +
        (outcome.status === "VER"
          ? "Confirmed in a RZĄD 2A source (E-3)."
          : outcome.status === "KOTWICA"
            ? "🟨 KOTWICA URZĘDOWA is not ✅: present the wording as read from RZĄD 2B; in a pleading it needs closure (HYBRID-VALIDATION)."
            : "Not confirmed: present the provision as ⚠️ [NIEWERYFIKOWANE]; never quote it from memory.")
    });
  }

  // K-1: numer aktualnego t.j. z indeksu RZĘDU 1 zapisanego w kopii ELI.
  private consolidatedIdentity(actInput: string): ConsolidatedIdentity | null {
    const index = this.coreLaw;
    if (!index) return null;
    const eli = index.resolve(actInput)?.eli ?? resolveActByTitle(index, actInput);
    const summary = eli ? index.summary(eli) : null;
    const current = summary?.consolidated ? (summary.currentEli ?? summary.eli) : null;
    const match = current ? /^DU\/(\d{4})\/(\d+)$/.exec(current) : null;
    return match ? { year: match[1]!, position: match[2]! } : null;
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

  // Pobieranie EUREKA (testy podstawiają własne).
  interpretationFetcher: typeof fetch | null = null;

  private async verifyInterpretationCall(call: NormalizedToolCall): Promise<string> {
    const signature = typeof call.input.signature === "string" ? call.input.signature.trim() : "";
    const quote = typeof call.input.quote === "string" ? call.input.quote : undefined;
    const audit = (decision: "ALLOW" | "DENY", reason?: string) =>
      this.resolverAudit.push({
        sequence: this.resolverAudit.length + 1,
        tool: INTERPRETATION_TOOL_NAME,
        capability: "network",
        decision,
        ...(reason ? { reason } : {})
      });
    if (!signature) {
      audit("DENY", "INVALID_INTERPRETATION_INPUT");
      return JSON.stringify({ status: "DENIED", error: "INVALID_INTERPRETATION_INPUT" });
    }
    const outcome = await verifyInterpretation({
      signature,
      ...(quote ? { quote } : {}),
      toolCallId: call.id,
      ...(this.interpretationFetcher ? { fetcher: this.interpretationFetcher } : {})
    });
    const claim = canonicalInterpretationSignature(signature);
    if (outcome.status !== "VERIFIED" || !outcome.record) {
      audit("DENY", outcome.reason ?? outcome.status);
      // Brak potwierdzenia też trafia do rejestru: G8 wymaga wtedy ⚠️ przy sygnaturze.
      this.ledger.add({
        claim,
        kind: "interpretation",
        status: "UNVERIFIED",
        fetchedAt: new Date().toISOString(),
        toolCallId: call.id,
        ...(outcome.eurekaStatus ? { interpretationStatus: outcome.eurekaStatus } : {})
      });
      return JSON.stringify({
        status: outcome.status === "SOURCE_UNAVAILABLE" ? "UNVERIFIED" : outcome.status,
        error: outcome.reason ?? null,
        marker: "⚠️ [NIEWERYFIKOWANE]",
        instruction:
          outcome.status === "NOT_FOUND"
            ? "EUREKA has no document under exactly this signature (EUREKA does not hold every ruling; no hit is not proof it does not exist). Do not cite it as verified."
            : "Do not present this interpretation as verified; if it must be mentioned, put ⚠️ [NIEWERYFIKOWANE] next to the signature."
      });
    }
    audit("ALLOW");
    this.ledger.add(outcome.record);
    return JSON.stringify({
      status: "VERIFIED",
      signature: claim,
      sourceUrl: outcome.record.sourceUrl,
      issuedAt: outcome.issuedAt ?? null,
      thesis: outcome.thesis ?? null,
      eurekaStatus: outcome.eurekaStatus,
      current: outcome.current,
      evidence: outcome.record.evidence,
      marker: verificationMarker(outcome.record),
      instruction: outcome.current
        ? "Copy the marker verbatim onto the SAME LINE as the signature. It is an interpretation of an authority (📋, binding only on its addressee), not a source of law."
        : `EUREKA status: ${outcome.eurekaStatus}. The interpretation is NOT current: never present it as the authority's current position; copy the marker verbatim (it states the status).`
    });
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

  // One turn: the same call with the same input asks the source once.
  private readonly answered = new Map<string, string>();

  async runTools(
    calls: NormalizedToolCall[]
  ): Promise<NormalizedToolResult[]> {
    const key = (call: NormalizedToolCall) => `${call.name}:${stableJson(call.input)}`;
    const fresh = calls.filter((call, index) => !this.answered.has(key(call)) && calls.findIndex((other) => key(other) === key(call)) === index);
    const ran = new Map((await this.runFresh(fresh)).map((result) => [result.tool_use_id, result.content] as const));
    const now = new Map<string, string>();
    for (const call of fresh) {
      const content = ran.get(call.id) ?? "";
      now.set(key(call), content);
      // A failure (source down, timeout, refusal) is not remembered: a retry asks again.
      if (!/"status"\s*:\s*"(?:ERROR|DENIED|BLOCKED|TIMEOUT|UNAVAILABLE|SOURCE_UNAVAILABLE)"/.test(content)) this.answered.set(key(call), content);
    }
    return calls.map((call) => ({ tool_use_id: call.id, content: now.get(key(call)) ?? this.answered.get(key(call)) ?? "" }));
  }

  private async runFresh(
    calls: NormalizedToolCall[]
  ): Promise<NormalizedToolResult[]> {
    const results: NormalizedToolResult[] = [];

    for (const call of calls) {
      if (call.name === CASE_LIBRARY_TOOL_NAME) {
        results.push({ tool_use_id: call.id, content: searchCaseLawLibrary(call.input) });
        continue;
      }
      if (call.name === INTERPRETATION_TOOL_NAME) {
        results.push({ tool_use_id: call.id, content: await this.verifyInterpretationCall(call) });
        continue;
      }
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

        const snFilters = source === "SN" ? snSearchFilters(call.input) : {};
        if (
          (!query && !(source === "SN" && Object.keys(snFilters).length)) ||
          (
            source !== "SAOS" &&
            source !== "CBOSA" &&
            source !== "SN"
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
              ...(Object.keys(snFilters).length ? { sn: snFilters } : {}),
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
              ...(typeof call.input.card_url === "string" ? { card_url: call.input.card_url } : {}),
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
              content: await this.eliOutageFallback(
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
            content: await this.eliOutageFallback(
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
          content: await this.eliOutageFallback(
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

/** JSON with sorted keys: the same input written in another key order is the same call. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${stableJson((value as Record<string, unknown>)[name])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
