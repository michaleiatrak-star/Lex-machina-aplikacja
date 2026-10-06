import type { ChatWidget, RestorationMark } from "./workspace-client.js";

export type ProviderId = "openai" | "anthropic" | "xai" | "google";

export type AuthStatusResponse = {
  initialized: boolean;
  requiresBootstrap: boolean;
  temporaryAdminCredentialsActive: boolean;
};

export type AuthenticatedUser = {
  userId: string;
  loginName: string;
  displayName: string;
  appRole: "ADMIN" | "USER";
  status: "ACTIVE" | "DISABLED";
  passwordSetupPending?: boolean;
  createdAt: string;
  lastLoginAt?: string;
};

export type AdminUsersResponse = {
  users: AuthenticatedUser[];
};

export type DeletedUserResponse = {
  userId: string;
  deletedAt: string;
};

export type AuthSessionInfo = {
  sessionId: string;
  userId: string;
  createdAt: string;
  lastActivityAt: string;
  lastFullAuthenticationAt: string;
  idleExpiresAt: string;
  overallExpiresAt: string;
};

export type AuthSuccessResponse = {
  user: AuthenticatedUser;
  session: AuthSessionInfo;
  sessionToken?: string;
  recoveryCode?: string;
};

export type AuthMeResponse = {
  user: AuthenticatedUser;
  session: AuthSessionInfo;
};

export type SupportCapability =
  | "DIAGNOSTICS"
  | "ACCOUNT_READ"
  | "UPDATE_READ";

export type SupportSessionInfo = {
  sessionId: string;
  role: "SERVICE";
  installationId: string;
  capabilities: SupportCapability[];
  ticket: string;
  approvedByUserId: string;
  activatedAt: string;
  expiresAt: string;
};

export type SupportStatusResponse = {
  installationId: string;
  roleModel:
    ["SERVICE", "ADMIN", "USER"];
  configured: boolean;
  nativeIdentityReady: boolean;
  vendorKeyId?: string;
  activeSessions: number;
};

export type SupportChallengeResponse = {
  installationId: string;
  challengePublicKey: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  challengeSignature: string;
  challengeProofAlgorithm?: "Ed25519";
};

export type SignedSupportEntitlement = {
  keyId: string;
  entitlement: {
    version: 1;
    installationId: string;
    challengePublicKey: string;
    nonce: string;
    challengeSignature: string;
    capabilities:
      SupportCapability[];
    issuedAt: string;
    expiresAt: string;
    ticket: string;
  };
  signature: string;
};

export type RecoveryCodeResponse = {
  recoveryCode: string;
  createdAt: string;
};

export type AuthRecoveryResponse =
  AuthSuccessResponse & {
    recoveryCode: string;
  };

export type PiiKind =
  | "PESEL"
  | "NIP"
  | "REGON"
  | "IBAN"
  | "EMAIL"
  | "PHONE"
  | "PERSON"
  | "ADDRESS"
  | "ID_CARD"
  | "PASSPORT"
  | "KRS"
  | "LAND_REGISTRY"
  | "BIRTH_DATE"
  | "VEHICLE_PLATE"
  | "PAYMENT_CARD"
  | "CUSTOM";

export type PrivacyAction =
  | "PSEUDONYMIZE"
  | "KEEP"
  | "LABEL";

export type PagePrivacyDirective = {
  page: number;
  start: number;
  end: number;
  action: PrivacyAction;
  kind?: PiiKind;
  label?: string;
};

export type CaseRole =
  | "OWNER"
  | "EDITOR"
  | "ANALYST"
  | "VIEWER";

export type CaseKind =
  | "MATTER"
  | "FIRM_KNOWLEDGE";

export type CaseResponse = {
  caseId: string;
  caseKind: CaseKind;
  displayName?: string;
  createdAt: string;
  updatedAt?: string;
  createdByUserId?: string;
  keyVersion?: number;
  role?: CaseRole;
  canReidentify?: boolean;
  archivedAt?: string;
};

export type CaseListItem = {
  caseId: string;
  caseKind: CaseKind;
  displayName?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  keyVersion: number;
  role: CaseRole;
  canReidentify: boolean;
  archivedAt?: string;
};

export type CaseListResponse = {
  cases: CaseListItem[];
};

export type CaseScheduleKind =
  | "CLIENT_MEETING"
  | "COURT_HEARING"
  | "DEADLINE"
  | "OTHER";

export type CaseScheduleEvent = {
  eventId: string;
  kind: CaseScheduleKind;
  title: string;
  startsAt: string;
  location?: string;
  notes?: string;
  createdAt: string;
  createdByUserId: string;
};

export type CaseScheduleResponse = {
  events: CaseScheduleEvent[];
};

export type UpcomingCaseEvent = CaseScheduleEvent & {
  caseId: string;
  caseDisplayName?: string;
};

export type CaseContactKind = "PERSON" | "ORGANIZATION";

export type CaseContact = {
  contactId: string;
  kind: CaseContactKind;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  createdByUserId: string;
};

export type CaseContactInput = {
  kind: CaseContactKind;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};

export type CaseAccessEntry = {
  user: AuthenticatedUser;
  role: CaseRole;
  canReidentify: boolean;
  grantedByUserId: string;
  grantedAt: string;
  keyVersion: number;
};

export type CaseAccessResponse = {
  access: CaseAccessEntry[];
};

export type CaseAccessCandidatesResponse = {
  users: AuthenticatedUser[];
};

export type FirmKnowledgeWorkspaceResponse = {
  workspace: CaseListItem | null;
};

export type CaseKnowledgeHit = {
  documentId: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  score: number;
  text: string;
};

export type CaseKnowledgeSearchResponse = {
  caseId: string;
  caseKind: CaseKind;
  hits: CaseKnowledgeHit[];
};

export type StoredArchiveEntry = {
  relativePath: string;
  compressedBytes: number;
  uncompressedBytes: number;
  sha256: string;
  mediaType: string | null;
  processable: boolean;
};

export type StoredUploadResponse = {
  caseId: string;
  uploadId: string;
  filename: string;
  mediaType: string;
  sha256: string;
  bytes: number;
  storedAt: string;
  archive: boolean;
  extracted: StoredArchiveEntry[];
  processing?: {
    documentId: string;
    complete: true;
    totalPages: number;
    digitalPages: number;
    ocrPages: number;
    blankPages: number;
    chunkIndices: number[];
    // false: processed without anonymization (plain text, no key).
    anonymized?: boolean;
    // On the case's shared key (one symbol per person across the case).
    sharedKey?: boolean;
  };
};

export function joinSharedKey(
  caseId: string,
  documentId: string
): Promise<AnonymizedVersion & { remapped: number }> {
  return json(`/api/cases/${caseId}/documents/${documentId}/join-shared-key`, { method: "POST" });
}

/** Directives that keep every page as written: OCR/text only, no key. */
export function keepAllDirectives(review: DocumentReviewResponse): PagePrivacyDirective[] {
  return review.pages
    .filter((page) => page.text.length > 0)
    .map((page) => ({ page: page.page, start: 0, end: page.text.length, action: "KEEP" as const }));
}

export type CaseFilesResponse = {
  caseId: string;
  uploads: StoredUploadResponse[];
};

export type SharedTemplateManifest = {
  templateId: string;
  scope: "FIRM_SHARED";
  filename: string;
  mediaType:
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    | "application/vnd.oasis.opendocument.text";
  sha256: string;
  bytes: number;
  createdAt: string;
  createdByUserId: string;
  generationReady: false;
  // Set by the firm: document kind and default for that kind.
  role?: { kind: TemplateKindId; isDefault: boolean };
};

// Same list as the runtime's TEMPLATE_KINDS (template-roles.ts).
export const TEMPLATE_KINDS = [
  ["pozew", "Pozew"],
  ["apelacja", "Apelacja"],
  ["zazalenie", "Zażalenie"],
  ["sprzeciw", "Sprzeciw / zarzuty"],
  ["odpowiedz_na_pozew", "Odpowiedź na pozew"],
  ["wniosek", "Wniosek / pismo procesowe"],
  ["wezwanie", "Wezwanie"],
  ["pismo", "Pismo / list"],
  ["umowa", "Umowa"],
  ["regulamin", "Regulamin"],
  ["opinia", "Opinia prawna"],
  ["pelnomocnictwo", "Pełnomocnictwo"],
  ["inne", "Inny dokument"]
] as const;
export type TemplateKindId = (typeof TEMPLATE_KINDS)[number][0];

export function setSharedTemplateRole(
  templateId: string,
  role: { kind: TemplateKindId; isDefault: boolean } | null
): Promise<SharedTemplateListResponse> {
  return json<SharedTemplateListResponse>(`/api/shared/templates/${encodeURIComponent(templateId)}/role`, {
    method: "PUT",
    body: JSON.stringify({ role })
  });
}

export type SharedTemplateListResponse = {
  templates: SharedTemplateManifest[];
};

export type LegalDocumentFormat =
  | "docx"
  | "odt";

export type LegalDocumentType =
  | "pleading"
  | "contract"
  | "opinion"
  | "letter"
  | "report"
  | "other";

export type LegalStyleProfile =
  | "lex-classic-clean-v1"
  | "lex-light-legal-design-v1"
  | "lex-classic-tnr-v1";

export type StoredCaseArtifact = {
  schemaVersion: 1;
  caseId: string;
  artifactId: string;
  filename: string;
  mediaType: string;
  sha256: string;
  bytes: number;
  createdAt: string;
  createdByUserId?: string;
  sensitivity:
    | "PROTECTED"
    | "CLEAR_PII";
  storage:
    "ENCRYPTED_LME1";
};

export type GeneratedDocumentResponse = {
  sessionId: string;
  artifact:
    StoredCaseArtifact;
  format:
    LegalDocumentFormat;
  tokenizedSha256?: string;
  vaultGeneration?: number;
  sha256?: string;
  aliasesUsed: string[];
  deanonymizationKeyBound?: boolean;
  readyForDownload?: boolean;
  downloadTicket?: {
    ticketId: string;
    caseId: string;
    artifactId: string;
    finalSha256: string;
    expiresAt: string;
    remainingUses:
      0 | 1;
  };
  templateProfile?: {
    templateId: string;
    sourceFormat:
      LegalDocumentFormat;
    styleProfile:
      LegalStyleProfile;
    sourceSha256: string;
  };
};

export type DeanonymizationIntentResponse = {
  intent: {
    intentId: string;
    caseId: string;
    artifactId: string;
    artifactFormat:
      LegalDocumentFormat;
    expiresAt: string;
    status:
      | "PENDING"
      | "AUTHORIZED"
      | "CONSUMED"
      | "REVOKED"
      | "EXPIRED";
  };
};

export type DeanonymizationReauthorizationResponse = {
  grant: {
    grantId: string;
    intentId: string;
    caseId: string;
    artifactId: string;
    artifactFormat:
      LegalDocumentFormat;
    expiresAt: string;
  };
  session:
    AuthSessionInfo;
};

/** An alias used in a generated document, as it will be restored. */
export type DocumentRestoration = {
  alias: string;
  kind: string;
  case?: string;
  text: string;
  source: string;
  confidence: number;
  status: string;
  canonical?: string;
  gender?: "m1" | "f";
  caseMissing?: boolean;
  // A verb or role word next to the symbol disagrees with the key's gender or number.
  agreement?: string;
  occurrences: number;
};

export type DeanonymizationPreview = {
  text: string;
  restorations: DocumentRestoration[];
  marks: Array<{ start: number; end: number; alias: string }>;
};

export function previewDeanonymization(
  grantId: string
): Promise<DeanonymizationPreview> {
  return json<DeanonymizationPreview>(
    "/api/deanonymization/preview",
    {
      method: "POST",
      body: JSON.stringify({ grantId })
    }
  );
}

/** "Zapisz formę": remember how a name inflects on this computer. */
export async function saveNameForm(correction: {
  canonical: string;
  gender: "m1" | "f";
  case: string;
  text: string;
}): Promise<void> {
  const response = await fetch(`${apiBase()}/api/privacy/name-forms`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authorizationHeaders()
    },
    body: JSON.stringify(correction)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `HTTP_${response.status}`);
  }
}

export type FinalizedDocumentResponse = {
  artifact:
    StoredCaseArtifact;
  format:
    LegalDocumentFormat;
  sha256: string;
  replacements: number;
  deanonymizationBasis:
    "PRIVACY_VAULT_KEY";
  keyBindingVerified:
    boolean;
  restorations?: DocumentRestoration[];
  downloadTicket?: {
    ticketId: string;
    caseId: string;
    artifactId: string;
    finalSha256: string;
    expiresAt: string;
    remainingUses:
      0 | 1;
  };
};

export type CaseTemplateListResponse = {
  caseId: string;
  scope: "FIRM_SHARED";
  templates: SharedTemplateManifest[];
};

export type DocumentReviewResponse = {
  documentId: string;
  mediaType:
    | "application/pdf"
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/tiff"
    | "text/plain"
    | "text/markdown"
    | "text/csv"
    | "text/tab-separated-values"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    | "application/vnd.oasis.opendocument.text"
    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    | "application/vnd.ms-excel.sheet.macroenabled.12";
  complete: true;
  totalPages: number;
  pages: Array<{
    page: number;
    text: string;
    source: "DIGITAL" | "OCR" | "BLANK";
    confidence?: number;
    engine?: string;
    // Words the local model fixed after OCR.
    corrections?: Array<{ line: number; from: string; to: string }>;
    // The user corrected this page's text by hand.
    editedByUser?: boolean;
  }>;
  suggestions: Array<{
    page: number;
    start: number;
    end: number;
    kind: PiiKind;
  }>;
};

/** What reached the model for one document of a sent message. */
export type DocumentDelivery = {
  documentId: string;
  title?: string;
  sourceScope?: "MANUAL" | "CASE_KNOWLEDGE" | "FIRM_KNOWLEDGE" | "FIRM_TEMPLATE";
  chunks: number;
  fullChunks: number;
  digestChunks: number;
  status: "FULL" | "PARTIAL" | "DIGEST" | "OMITTED";
};

export type DocumentFitResponse = {
  limit: number;
  local: boolean;
  count: number;
  estimate: {
    modelContextTokens: number;
    budgetTokens: number;
    neededTokens: number;
    fits: boolean;
    documents: Array<{ documentId: string; title?: string; tokens: number }>;
  } | null;
};

/** Whether the picked files fit the chosen model, checked before sending. */
export function checkDocumentFit(input: {
  provider: ProviderId;
  model: string;
  attachments: DocumentAttachmentSelection[];
  firmTemplates: string[];
}): Promise<DocumentFitResponse> {
  return json<DocumentFitResponse>("/api/sessions/document-fit", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export type DocumentAttachmentSelection = {
  caseId: string;
  documentId: string;
  chunkIndices: number[];
};

export type DocumentIngestionResponse = {
  documentId: string;
  mediaType: DocumentReviewResponse["mediaType"];
  complete: true;
  totalPages: number;
  digitalPages: number;
  ocrPages: number;
  blankPages: number;
  sourceChars: number;
  pseudonymizedChars: number;
  chunks: Array<{
    index: number;
    pageStart: number;
    pageEnd: number;
    text: string;
  }>;
  privacy: {
    findings: number;
    counts: Partial<Record<PiiKind, number>>;
    manualPseudonymizations: number;
    keptRanges: number;
    annotations: Array<{
      page: number;
      start: number;
      end: number;
      label: string;
    }>;
    reversibleLocally: true;
  };
};

export type HealthResponse = {
  status: "ok";
  service: string;
  localOnly: boolean;
};

export type RouteListResponse = {
  jurisdiction: "PL";
  primarySkills: string[];
};

export type RouteValidationResponse = {
  valid: boolean;
  primarySkill: string;
  reason?: string;
};

export type ModelDescriptor = {
  provider: ProviderId;
  id: string;
  displayName: string;
  selectable: boolean;
  compatibilityReason?: string;
  createdAt?: string;
  ownedBy?: string;
  contextWindow?: number;
  nativeContextWindow?: number;
  contextMode?:
    | "NATIVE_OR_REDUCED"
    | "YARN_EXTENDED";
  inputModalities?: string[];
  outputModalities?: string[];
  capabilities?: string[];
};

export type ModelsResponse = {
  provider: ProviderId;
  models: ModelDescriptor[];
};

export type LocalModelDescriptor = {
  provider: "local";
  id: string;
  displayName: string;
  selectable: true;
  contextWindow: number;
  nativeContextWindow: number;
  minimumContextWindow: number;
  maximumContextWindow: number;
  configuredContextWindow?: number;
  contextMode:
    | "NATIVE_OR_REDUCED"
    | "YARN_EXTENDED";
  quantization: string;
  license: string;
  source: string;
  localOnly: true;
  installed: boolean;
};

export type LocalModelsResponse = {
  provider: "local";
  models: LocalModelDescriptor[];
  runtime: {
    configured: boolean;
    selectedModelId: string | null;
    activeModelId: string | null;
    state:
      | "STOPPED"
      | "PROVISIONING"
      | "STARTING"
      | "READY";
  };
};

export type ProviderConfigurationStatus = {
  provider: ProviderId;
  configured: boolean;
};

export type ProviderCredentialPersistence =
  | "PROCESS_MEMORY"
  | "OS_KEYRING";

export type ProviderCredentialMutationResponse = {
  provider: ProviderId;
  storage: "PROCESS_MEMORY";
  configured?: boolean;
  cleared?: boolean;
};

export type ProviderStatusResponse = {
  providers: ProviderConfigurationStatus[];
};

export type ProviderAccountSessionStatus = {
  provider: ProviderId;
  command: string;
  installed: boolean;
  authenticated: boolean;
  installHint: string;
  resumeMode:
    | "LAST_OR_NEW"
    | "LEX_CONTEXT_ONLY";
  oauthTokenConfigured?: boolean;
};

export type ProviderAccountStatusResponse = {
  providers: ProviderAccountSessionStatus[];
};

export type GuideSessionState = {
  schemaVersion: 1;
  sessionId: string;
  revision: number;
  audience: "LAIK" | "PRAWNIK";
  interactionMode:
    | "PROWADZENIE"
    | "QA"
    | "MENU";
  rawAnalysis: boolean;
  step:
    | "FAZA0"
    | "A"
    | "B"
    | "C"
    | "D"
    | "E"
    | "F"
    | "G"
    | "H"
    | "I"
    | "M"
    | "Q";
  guidedQuestionIndex:
    0 | 1 | 2 | 3;
  pendingIrreversibleAction:
    | {
        actionId: string;
        warningAcknowledged:
          boolean;
      }
    | null;
  createdAt: string;
  updatedAt: string;
};

export type GuideTransition =
  | {
      type: "SET_AUDIENCE";
      audience:
        "LAIK" | "PRAWNIK";
    }
  | {
      type:
        "SET_INTERACTION_MODE";
      mode:
        | "PROWADZENIE"
        | "QA"
        | "MENU";
    }
  | {
      type:
        "SET_RAW_ANALYSIS";
      enabled: boolean;
    }
  | {
      type: "MOVE_STEP";
      step:
        GuideSessionState["step"];
    }
  | {
      type:
        "ADVANCE_GUIDED_QUESTION";
    }
  | {
      type:
        | "BEGIN_IRREVERSIBLE_ACTION"
        | "ACKNOWLEDGE_IRREVERSIBLE_WARNING"
        | "CLEAR_IRREVERSIBLE_ACTION";
      actionId: string;
    };

export type UpdateStatusResponse = {
  currentVersion: string;
  status:
    | "NO_RELEASE"
    | "UP_TO_DATE"
    | "AVAILABLE"
    | "UNAVAILABLE";
  checkedAt: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseName?: string;
  publishedAt?: string;
};

export type ApplicationUpdateDownloadResponse = {
  version: string;
  token: string;
  receiptToken: string;
  filename: string;
  sha256: string;
  bytes: number;
  stagedAt: string;
  publisher:
    | {
        verification: "AUTHENTICODE";
        subject: string;
        thumbprint: string;
        productVersion: string;
      }
    | {
        verification: "UNSIGNED_ALLOWED";
        subject: null;
        thumbprint: null;
        productVersion: string;
        warning:
          "TEMPORARY_UNSIGNED_UPDATE_ALLOWED";
      };
};

export type SkillUpdateStatusResponse = {
  currentVersion: string;
  status: "UP_TO_DATE" | "AVAILABLE" | "UNAVAILABLE";
  latestVersion?: string;
  checkedAt: string;
  bundleReady: boolean;
  verificationReady: boolean;
  signatureMode:
    | "SIGNED_REQUIRED"
    | "UNSIGNED_ALLOWED";
  blockedReason?:
    | "INDEX_MISSING"
    | "SIGNED_INDEX_MISSING"
    | "SIGNER_POLICY_MISSING";
  unavailableReason?: string;
  repository?: string;
};

export type SkillUpdateApplyResponse = {
  previousVersion: string;
  installedVersion: string;
  installedAt: string;
  restartRequired: true;
  skillRoot: string;
};



export type BlockedReference = {
  claim: string;
  kind: "statute" | "journal" | "case" | "interpretation" | "amount";
  line: number;
  status: string;
};

export type AuxiliarySourceItem = {
  claim?: string;
  sourceUrl: string;
  sourceTier:
    | "R2B"
    | "R3";
  classification:
    | "KNOWN_DOMAIN"
    | "CONSERVATIVE_R3";
  classificationBasis: string;
  crossCheckStatus:
    | "NOT_REQUIRED"
    | "PENDING"
    | "CONFIRMED_R1_R2A"
    | "CONFLICT"
    | "UNAVAILABLE";
  crossCheckUrl?: string;
  crossCheckTier?:
    | "R1"
    | "R2A";
  publishedAt?: string;
  updatedAt?: string;
  staleOrUndatedWarning:
    boolean;
  higherTierCrossCheckSatisfied:
    boolean;
  conflict: boolean;
  instruction: string;
};

export type EvidenceItem = {
  claim: string;
  kind: "statute" | "journal" | "case" | "deadline" | "amount" | "interpretation";
  status: "VERIFIED" | "SUPPORTED" | "UNVERIFIED";
  sourceUrl?: string;
  // sourceUrl z kotwicą do artykułu/jednostki, gdy runtime ją ustalił.
  sourceAnchorUrl?: string;
  sourceTier?: "R1" | "R2A" | "R2B" | "R3";
  fetchedAt: string;
  // Przepis powołany tylko w bloku bramki (np. sąsiedni z WYJ-GATE S1).
  role?: "gate";
  verificationMethod?:
    | "web_fetch"
    | "web_fetch_pdf"
    | "web_search"
    | "mcp_call"
    | "provider_tool"
    | "file_read";
  temporalMode?: "CURRENT" | "HISTORICAL";
  asOf?: string;
  sourceFormat?: "TEXT" | "PDF";
  caseScope?:
    | "FULL_TEXT"
    | "EXACT_QUOTE"
    | "PROPOSITION_SUPPORT";
  caseSignature?: string;
  evidenceHash?: string;
  supportQuoteHash?: string;
  // Fragment orzeczenia sprawdzony w oficjalnym tekście (zaznaczany w podglądzie).
  passage?: string;
};

export type MandatoryPathStep = {
  layer: "ROUTER" | "SKILL" | "VERIFICATION" | "HARD_GATE";
  id: string;
  label: string;
  requirement: "CORE" | "TRIGGERED" | "CONDITIONAL";
  status: "MET" | "MISSING" | "NOT_TRIGGERED" | "NOT_EVALUATED";
  by?: "APLIKACJA" | "MODEL";
  evidence: string;
};

export type MandatoryPathView = {
  source: string;
  profile: "LEKKI" | "PELNY";
  complete: boolean;
  degraded: boolean;
  steps: MandatoryPathStep[];
  missing: string[];
  // KROK 3A wypisany przez aplikację z audytu.
  routingTrace?: string;
};

export type QueryModeDecisionView = {
  mode: "LAIK" | "PRAWNIK";
  decision: "PRAWNIK" | "LAIK" | "POPRZEDNI" | "ODPOWIEDZ_NA_PYTANIE" | "NIEROZSTRZYGNIETY";
  signals: { laik: string[]; prawnik: string[]; direct: string[] };
};

export type SessionExecutionResponse = {
  sessionId: string;
  mandatoryPath?: MandatoryPathView;
  // Next skill of the pipeline (ACTIVATION-MATRIX).
  pipelineNext?: { skill: string; reason: string };
  // The firm's default template the application used (none picked).
  firmTemplateApplied?: { templateId: string; filename: string; kind: string };
  modeDecision?: QueryModeDecisionView;
  // Values restored locally into the answer, for highlighting and correction.
  restorations?: RestorationMark[];
  unresolvedTokens?: string[];
  status: "DRAFT_PRESENTABLE" | "BLOCKED";
  provider: ProviderId;
  model: string;
  modelRouting?: {
    primary: {
      provider: ProviderId;
      model: string;
    };
  };
  primarySkill: string;
  answer?: string;
  documentCitationFreshness?: {
    result: "PASS";
    checked: number;
  };
  context?: {
    strategy:
      | "MODEL_CONTEXT_WINDOW"
      | "LEGACY_CHAR_CAP";
    modelContextTokens?: number;
    reservedOutputTokens?: number;
    reservedSystemTokens?: number;
    documentBudgetTokens?: number;
    estimatedDocumentTokens: number;
    instructionChars?: number;
    instructionSections?: Array<{ label: string; chars: number }>;
    charsPerTokenEstimate?: number;
    selectedChunks: number;
    omittedChunks: number;
    selectedDocuments: number;
    omittedDocuments: number;
    documents?: DocumentDelivery[];
  };
  finalization: "PASS" | "DEGRADED" | "BLOCKED";
  blockedReferences: BlockedReference[];
  verification: {
    records: number;
    verified: number;
    supported: number;
    unverified: number;
  };
  evidence: EvidenceItem[];
  auxiliarySources?:
    AuxiliarySourceItem[];
  widgets?: ChatWidget[];
  audit: {
    result: "PASS" | "BLOCKED";
    eventCount: number;
    closed: boolean;
    missing?: string[];
    violations?: string[];
    blockedEvents?: string[];
  };
  workflow?: {
    id: string;
    result: "PASS" | "BLOCKED";
    requiredResources: string[];
    missingResources: string[];
  };
  gateI?: {
    gate: string;
    result: "PASS" | "BLOCKED";
    verifiedOrSupportedRecords?: number;
    legalReferences?: number;
    caseReferences?: number;
  };
  processAuto?: {
    maxSteps: number;
    stopped:
      | "FINAL"
      | "LIMIT_REACHED"
      | "NODE_BLOCKED";
    limitReached: boolean;
    steps: Array<{
      stage:
        Exclude<
          ProcessPleadingStage,
          "CG_ACCEPTANCE" | "FINAL"
        >;
      checkpoint:
        ProcessPleadingCheckpoint;
      revisionAfter: number;
      status:
        | "DRAFT_PRESENTABLE"
        | "BLOCKED";
      answer?: string;
    }>;
  };
  processWorkflow?: ProcessPleadingWorkflowView;
  courtWorkflow?: CourtAnalysisWorkflowView;
};

export type ProcessPleadingCheckpoint =
  | "CP-1a"
  | "CP-1b"
  | "CP-1c-skan"
  | "CP-PD"
  | "CP-FSL-D"
  | "CP-1c-macierz"
  | "CP-1c-lancuch"
  | "CP-1d-anomalie"
  | "CP-1d"
  | "CP-W1"
  | "CP-PRE-W2"
  | "CP-ATAK"
  | "CP-PODMIOT"
  | "CP-QUALITY"
  | "CP-AUDYT"
  | "CP-PEER";

export type ProcessPleadingCheckpointStatus =
  | "OPEN"
  | "PENDING_CONFIRMATION"
  | "CLOSED"
  | "NA";

export type ProcessPleadingStage =
  | "CG_ACCEPTANCE"
  | "W1"
  | "PRE_W2"
  | "W2"
  | "W3"
  | "FINAL";

export type ProcessPleadingWorkflowView = {
  caseId: string;
  mode: "CHECKPOINT" | "AUTO";
  revision: number;
  stage: ProcessPleadingStage;
  documentStatus: "DRAFT" | "FINAL";
  pendingCheckpoint: ProcessPleadingCheckpoint | null;
  checkpoints: Record<
    ProcessPleadingCheckpoint,
    ProcessPleadingCheckpointStatus
  >;
};

export type ProcessPleadingWorkflowState =
  ProcessPleadingWorkflowView & {
    schemaVersion: 1;
    workflowId: "PROCESS_PLEADING_V1";
    startAccepted: boolean;
    history: Array<{
      sequence: number;
      at: string;
      type: string;
      checkpoint?: ProcessPleadingCheckpoint;
      fromStage?: ProcessPleadingStage;
      toStage?: ProcessPleadingStage;
    }>;
    createdAt: string;
    updatedAt: string;
  };

export type ProcessPleadingWorkflowResponse = {
  caseId: string;
  state: ProcessPleadingWorkflowState | null;
};

export type CourtAnalysisCheckpoint =
  | "SD_VER_COMPLETE"
  | "PASS_I_ISOLATION_CLEAN"
  | "PASS_II_SOURCES_VERIFIED"
  | "FIRST_VERIFICATION_COMPLETE"
  | "FINAL_VERIFICATION_COMPLETE"
  | "FINAL_GATE_APPROVED"
  | "FINAL_REPORT_PRESENTED"
  | "SITUATIONAL_REPORT_PRESENTED"
  | "PROCESS_PLEADING_OFFER_PRESENTED";

export type CourtAnalysisStage =
  | "EVIDENCE_SCAN"
  | "PASS_I_FACTS"
  | "PASS_II_LAW"
  | "PASS_III_ADVERSARIAL"
  | "PASS_IV_FINAL_VERIFICATION"
  | "FINAL_REPORT"
  | "SITUATIONAL_REPORT"
  | "PROCESS_PLEADING_OFFER"
  | "COMPLETE";

export type CourtAnalysisWorkflowView = {
  caseId: string;
  revision: number;
  stage:
    CourtAnalysisStage;
  nextCheckpoint:
    CourtAnalysisCheckpoint | null;
  closedCheckpoints:
    CourtAnalysisCheckpoint[];
};

export type ApiFailureTraceEvent = {
  sequence?: number;
  type?: string;
  target?: string;
  status?: string;
  detail?: string;
};

export type ApiFailure = {
  error: string;
  provider?: ProviderId;
  reason?: string;
  retryAfter?: string;
  description?: string;
  stage?: string;
  trace?: ApiFailureTraceEvent[];
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryAfter?: string,
    readonly reason?: string,
    readonly description?: string,
    readonly stage?: string,
    readonly trace?: ApiFailureTraceEvent[]
  ) {
    super(code);
    this.name = "ApiError";
  }
}

const DEFAULT_API_BASE = "http://127.0.0.1:4317";
const DESKTOP_API_BASE = "http://lex-api.localhost";

export function isDesktopShell(): boolean {
  if (
    typeof window ===
      "undefined"
  ) {
    return false;
  }
  return Boolean(
    (
      window as Window & {
        __TAURI_INTERNALS__?:
          unknown;
      }
    ).__TAURI_INTERNALS__
  );
}

let inMemorySessionToken: string | null = null;
let authenticationFailureHandler:
  (() => void) | null = null;

export function setAuthenticationFailureHandler(
  handler: (() => void) | null
): void {
  authenticationFailureHandler = handler;
}

export function clearAuthSession(): void {
  inMemorySessionToken = null;
}

function setAuthSessionToken(
  token: string | undefined
): void {
  if (isDesktopShell()) {
    inMemorySessionToken = null;
    return;
  }
  inMemorySessionToken =
    token ?? null;
}

export function authorizationHeaders():
  Record<string, string> {
  if (isDesktopShell()) {
    return {};
  }
  return inMemorySessionToken
    ? {
        Authorization:
          `Bearer ${inMemorySessionToken}`
      }
    : {};
}

export function apiBase(): string {
  if (isDesktopShell()) {
    return DESKTOP_API_BASE;
  }
  const configured = import.meta.env.VITE_LEX_API_BASE;
  return typeof configured === "string" && configured.trim()
    ? configured.trim().replace(/\/$/, "")
    : DEFAULT_API_BASE;
}

async function json<T>(
  pathname: string,
  init?: RequestInit,
  options?: {
    authenticated?: boolean;
  }
): Promise<T> {
  const authenticated =
    options?.authenticated !== false;
  const response = await fetch(
    `${apiBase()}${pathname}`,
    {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body
          ? {
              "Content-Type":
                "application/json"
            }
          : {}),
        ...(authenticated
          ? authorizationHeaders()
          : {}),
        ...init?.headers
      }
    }
  );

  const payload =
    await response.json() as
      | T
      | ApiFailure;
  if (!response.ok) {
    const failure =
      payload as ApiFailure;
    if (
      authenticated &&
      response.status === 401
    ) {
      clearAuthSession();
      authenticationFailureHandler?.();
    }
    throw new ApiError(
      failure.error ||
        `HTTP_${response.status}`,
      response.status,
      failure.retryAfter,
      failure.reason,
      failure.description,
      failure.stage,
      failure.trace
    );
  }
  return payload as T;
}

export function getHealth(): Promise<HealthResponse> {
  return json<HealthResponse>(
    "/health",
    undefined,
    { authenticated: false }
  );
}

export function getAuthStatus():
  Promise<AuthStatusResponse> {
  return json<AuthStatusResponse>(
    "/api/auth/status",
    undefined,
    { authenticated: false }
  );
}

export async function bootstrapAdmin(input: {
  loginName: string;
  displayName: string;
  password: string;
}): Promise<AuthSuccessResponse> {
  const result =
    await json<AuthSuccessResponse>(
      "/api/auth/bootstrap",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      { authenticated: false }
    );
  setAuthSessionToken(
    result.sessionToken
  );
  return result;
}

export async function login(input: {
  loginName: string;
  password: string;
}): Promise<AuthSuccessResponse> {
  const payload =
    isDesktopShell() &&
    input.loginName ===
      "local-admin" &&
    input.password ===
      "__LEX_NATIVE_LOGIN__"
      ? {
          loginName:
            input.loginName,
          password:
            "__LEX_NATIVE_LOGIN__"
        }
      : input;
  const result =
    await json<AuthSuccessResponse>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      { authenticated: false }
    );
  setAuthSessionToken(
    result.sessionToken
  );
  return result;
}

export function getSupportStatus():
  Promise<SupportStatusResponse> {
  return json<SupportStatusResponse>(
    "/api/admin/support/status"
  );
}

export function issueSupportChallenge():
  Promise<SupportChallengeResponse> {
  return json<SupportChallengeResponse>(
    "/api/admin/support/challenge",
    {
      method: "POST"
    }
  );
}

export function activateSupport(
  input: SignedSupportEntitlement
): Promise<{
  session: SupportSessionInfo;
  serviceToken?: string;
}> {
  return json<{
    session: SupportSessionInfo;
    serviceToken?: string;
  }>(
    "/api/admin/support/activate",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function getSupportSession():
  Promise<{
    session: SupportSessionInfo;
  }> {
  return json<{
    session: SupportSessionInfo;
  }>(
    "/api/support/me",
    undefined,
    {
      authenticated: false
    }
  );
}

export function getSupportDiagnostics():
  Promise<{
    service: string;
    localOnly: true;
    role: "SERVICE";
    installationId: string;
    expiresAt: string;
  }> {
  return json(
    "/api/support/diagnostics",
    undefined,
    {
      authenticated: false
    }
  );
}

export async function deactivateSupport():
  Promise<void> {
  const response = await fetch(
    `${apiBase()}/api/support/logout`,
    {
      method: "POST",
      headers: {
        Accept:
          "application/json"
      }
    }
  );
  if (!response.ok) {
    let code =
      `HTTP_${response.status}`;
    try {
      const payload =
        await response.json() as
          ApiFailure;
      code =
        payload.error || code;
    } catch {
      // Preserve generic HTTP code.
    }
    throw new ApiError(
      code,
      response.status
    );
  }
}

export function listAdminUsers():
  Promise<AdminUsersResponse> {
  return json<AdminUsersResponse>(
    "/api/admin/users"
  );
}

export function createAdminUser(input: {
  loginName: string;
  displayName: string;
  password: string;
}): Promise<{
  user: AuthenticatedUser;
}> {
  return json<{
    user: AuthenticatedUser;
  }>(
    "/api/admin/users",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function setAdminUserStatus(
  userId: string,
  status:
    | "ACTIVE"
    | "DISABLED"
): Promise<{
  user: AuthenticatedUser;
}> {
  return json<{
    user: AuthenticatedUser;
  }>(
    `/api/admin/users/${userId}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status
      })
    }
  );
}

export function deleteAdminUser(
  userId: string
): Promise<DeletedUserResponse> {
  return json<DeletedUserResponse>(
    `/api/admin/users/${userId}`,
    {
      method: "DELETE"
    }
  );
}

export async function createRecoveryCode(
  password: string
): Promise<RecoveryCodeResponse> {
  return json<RecoveryCodeResponse>(
    "/api/auth/recovery-code",
    {
      method: "POST",
      body: JSON.stringify({
        password
      })
    }
  );
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<AuthSuccessResponse> {
  const result =
    await json<AuthSuccessResponse>(
      "/api/auth/password",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
  setAuthSessionToken(
    result.sessionToken
  );
  return result;
}

export async function recoverAccount(input: {
  loginName: string;
  recoveryCode: string;
  newPassword: string;
}): Promise<AuthRecoveryResponse> {
  const result =
    await json<AuthRecoveryResponse>(
      "/api/auth/recover",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      {
        authenticated: false
      }
    );
  setAuthSessionToken(
    result.sessionToken
  );
  return result;
}

export function getAuthMe():
  Promise<AuthMeResponse> {
  return json<AuthMeResponse>(
    "/api/auth/me"
  );
}

/**
 * Tells the runtime the user is active in the window. Best effort: an expired
 * session is detected by the regular /api/auth/me check.
 */
export async function reportUserActivity():
  Promise<void> {
  try {
    await fetch(
      `${apiBase()}/api/auth/activity`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...authorizationHeaders()
        }
      }
    );
  } catch {
    // Offline runtime: nothing to extend.
  }
}

export async function lockAuth():
  Promise<void> {
  const headers =
    authorizationHeaders();
  try {
    const response = await fetch(
      `${apiBase()}/api/auth/lock`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...headers
        }
      }
    );
    if (
      !response.ok &&
      response.status !== 401
    ) {
      let code =
        `HTTP_${response.status}`;
      try {
        const body =
          await response.json() as
            ApiFailure;
        code = body.error || code;
      } catch {
        // no body
      }
      throw new ApiError(
        code,
        response.status
      );
    }
  } finally {
    clearAuthSession();
  }
}

export async function logoutAuth():
  Promise<void> {
  const headers =
    authorizationHeaders();
  try {
    const response = await fetch(
      `${apiBase()}/api/auth/logout`,
      {
        method: "POST",
        headers: {
          Accept:
            "application/json",
          ...headers
        }
      }
    );
    if (
      !response.ok &&
      response.status !== 401
    ) {
      throw new ApiError(
        `HTTP_${response.status}`,
        response.status
      );
    }
  } finally {
    clearAuthSession();
  }
}

export function listCases():
  Promise<CaseListResponse> {
  return json<CaseListResponse>(
    "/api/cases"
  );
}

export function openCase(
  caseId: string
): Promise<CaseListItem> {
  return json<CaseListItem>(
    `/api/cases/${caseId}`
  );
}

export function createCase(
  displayName?: string
): Promise<CaseResponse> {
  return json<CaseResponse>("/api/cases", {
    method: "POST",
    body: JSON.stringify({
      ...(displayName?.trim()
        ? { displayName: displayName.trim() }
        : {})
    })
  });
}

export function renameCase(
  caseId: string,
  displayName: string
): Promise<CaseListItem> {
  return json<CaseListItem>(
    `/api/cases/${caseId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        displayName
      })
    }
  );
}

export type CaseThreadSummary = {
  text: string;
  coveredMessages: number;
  updatedAt: string;
  editedByUser?: boolean;
};

export type CaseMemory = {
  summary: CaseThreadSummary | null;
  evidence: {
    updatedAt: string;
    provisions: Array<{
      claim: string;
      status: string;
      sourceUrl: string | null;
      consolidatedText: string | null;
      fetchedAt: string;
      freshnessCheckedAt: string | null;
    }>;
    sources: Array<{ claim: string; status: string; url: string; fetchedAt: string }>;
    skills: string[];
  } | null;
};

export function getCaseMemory(caseId: string): Promise<CaseMemory> {
  return json<CaseMemory>(`/api/cases/${caseId}/memory`);
}

export function updateCaseSummary(caseId: string, text: string): Promise<{ summary: CaseThreadSummary }> {
  return json(`/api/cases/${caseId}/memory/summary`, {
    method: "PATCH",
    body: JSON.stringify({ text })
  });
}

export function clearCaseMemory(caseId: string): Promise<{ cleared: true }> {
  return json(`/api/cases/${caseId}/memory`, { method: "DELETE" });
}

export function listCaseSchedule(
  caseId: string
): Promise<CaseScheduleResponse> {
  return json<CaseScheduleResponse>(
    `/api/cases/${caseId}/schedule`
  );
}

export function addCaseScheduleEvent(
  caseId: string,
  input: {
    kind: CaseScheduleKind;
    title: string;
    startsAt: string;
    location?: string;
    notes?: string;
  }
): Promise<CaseScheduleEvent> {
  return json<CaseScheduleEvent>(
    `/api/cases/${caseId}/schedule`,
    {
      method: "POST",
      body:
        JSON.stringify(input)
    }
  );
}

export function deleteCaseScheduleEvent(
  caseId: string,
  eventId: string
): Promise<{
  eventId: string;
  deletedAt: string;
}> {
  return json(
    `/api/cases/${caseId}/schedule/${eventId}`,
    {
      method: "DELETE"
    }
  );
}

/** Events of all the user's active cases from the start of today (or `from`). */
export function listUpcomingEvents(
  options: { limit?: number; from?: string; until?: string } = {}
): Promise<{ events: UpcomingCaseEvent[] }> {
  const query = new URLSearchParams();
  if (options.limit) query.set("limit", String(options.limit));
  if (options.from) query.set("from", options.from);
  if (options.until) query.set("until", options.until);
  const suffix = query.toString();
  return json(`/api/schedule/upcoming${suffix ? `?${suffix}` : ""}`);
}

export function listCaseContacts(
  caseId: string
): Promise<{ contacts: CaseContact[] }> {
  return json(`/api/cases/${caseId}/contacts`);
}

export function addCaseContact(
  caseId: string,
  input: CaseContactInput
): Promise<CaseContact> {
  return json<CaseContact>(`/api/cases/${caseId}/contacts`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function deleteCaseContact(
  caseId: string,
  contactId: string
): Promise<{ contactId: string; deletedAt: string }> {
  return json(`/api/cases/${caseId}/contacts/${contactId}`, {
    method: "DELETE"
  });
}

export function archiveCase(
  caseId: string
): Promise<CaseListItem> {
  return json<CaseListItem>(
    `/api/cases/${caseId}/archive`,
    { method: "POST" }
  );
}

export function unarchiveCase(
  caseId: string
): Promise<CaseListItem> {
  return json<CaseListItem>(
    `/api/cases/${caseId}/unarchive`,
    { method: "POST" }
  );
}

export function deleteCase(
  caseId: string,
  password: string
): Promise<{
  caseId: string;
  deletedAt: string;
}> {
  return json(
    `/api/cases/${caseId}`,
    {
      method: "DELETE",
      body: JSON.stringify({
        password
      })
    }
  );
}

export function getFirmKnowledgeWorkspace():
  Promise<FirmKnowledgeWorkspaceResponse> {
  return json<FirmKnowledgeWorkspaceResponse>(
    "/api/firm-knowledge"
  );
}

export function createFirmKnowledgeWorkspace():
  Promise<FirmKnowledgeWorkspaceResponse> {
  return json<FirmKnowledgeWorkspaceResponse>(
    "/api/firm-knowledge",
    {
      method: "POST"
    }
  );
}

export function searchCaseKnowledge(
  caseId: string,
  query: string,
  limit = 8
): Promise<CaseKnowledgeSearchResponse> {
  return json<CaseKnowledgeSearchResponse>(
    `/api/cases/${caseId}/knowledge/search`,
    {
      method: "POST",
      body: JSON.stringify({
        query,
        limit
      })
    }
  );
}

export const getFirmKnowledge =
  getFirmKnowledgeWorkspace;

export const createFirmKnowledge =
  createFirmKnowledgeWorkspace;

export function listCaseAccess(
  caseId: string
): Promise<CaseAccessResponse> {
  return json<CaseAccessResponse>(
    `/api/cases/${caseId}/access`
  );
}

// Local copy of law from Sejm ELI (RAG) and its updates.
export type CoreLawAmendment = {
  eli: string;
  title: string | null;
  promulgation: string | null;
};

export type CoreLawActStatus = {
  eli: string;
  title: string | null;
  status: string | null;
  consolidated: boolean;
  labels: string[];
  domains: string[];
  textSource: "html" | "pdf" | "ocr" | "none" | null;
  articleCount: number;
  fetchedAt: string | null;
  lastError: string | null;
  unavailable?: string | null;
  relationsCheckedAt: string | null;
  currentEli: string;
  amendmentsAfter: CoreLawAmendment[];
  pendingConsolidated: CoreLawAmendment | null;
  pendingAmendments: CoreLawAmendment[];
  origin: "MAP" | "VERIFIED" | "USER";
  addedAt: string | null;
  addedBy: string | null;
  state: "CURRENT" | "UPDATE_AVAILABLE" | "CHECK_DUE" | "MISSING" | "ERROR" | "UNAVAILABLE";
};

export type CoreLawProgress = {
  eli: string;
  phase: "download" | "extract" | "ocr";
  done: number;
  total: number;
};

export type CoreLawStatus = {
  autoApply: boolean;
  refreshing: boolean;
  progress?: CoreLawProgress | null;
  blockedUntil: string | null;
  lastCheckAt: string | null;
  counts: { consolidated: number; amendments: number; other: number; articles: number };
  pending: { consolidated: number; amendments: number };
  recent: Array<{
    at: string;
    kind: "CONSOLIDATED" | "AMENDMENT" | "ADDED" | "REMOVED";
    actEli: string;
    eli: string;
    title: string | null;
  }>;
  acts: CoreLawActStatus[];
};

export function getCoreLawStatus(): Promise<CoreLawStatus> {
  return json<CoreLawStatus>("/api/core-law/status");
}

export function checkCoreLawUpdates(): Promise<CoreLawStatus> {
  return json<CoreLawStatus>("/api/core-law/check", { method: "POST" });
}

export function applyCoreLawUpdates(elis?: string[]): Promise<CoreLawStatus> {
  return json<CoreLawStatus>("/api/core-law/apply", {
    method: "POST",
    body: JSON.stringify(elis?.length ? { elis } : {})
  });
}

export function setCoreLawAutoApply(autoApply: boolean): Promise<CoreLawStatus> {
  return json<CoreLawStatus>("/api/core-law/settings", {
    method: "PUT",
    body: JSON.stringify({ autoApply })
  });
}

// An additional act checked in Sejm ELI before it is added to the copy.
export type CoreLawActLookup = {
  inputEli: string;
  baseEli: string;
  currentEli: string;
  title: string;
  type: string | null;
  status: string | null;
  promulgation: string | null;
  consolidated: boolean;
  consolidatedTitle: string | null;
  amendmentsAfter: number;
  sourceUrl: string;
};

export function lookupCoreLawAct(
  reference: string
): Promise<{ act: CoreLawActLookup; presentAs: string | null }> {
  return json("/api/core-law/acts/lookup", {
    method: "POST",
    body: JSON.stringify({ reference })
  });
}

export function addCoreLawAct(
  reference: string
): Promise<{ act: CoreLawActLookup; status: CoreLawStatus }> {
  return json("/api/core-law/acts", {
    method: "POST",
    body: JSON.stringify({ reference })
  });
}

export function removeCoreLawAct(eli: string): Promise<CoreLawStatus> {
  return json<CoreLawStatus>("/api/core-law/acts/remove", {
    method: "POST",
    body: JSON.stringify({ eli })
  });
}

// Administrator overview of who may open which case (metadata only).
export type CaseAccessOverviewItem = {
  caseId: string;
  caseKind: CaseKind;
  displayName?: string;
  archivedAt?: string;
  updatedAt: string;
  viewerRole?: CaseRole;
  canManage: boolean;
  members: Array<{
    userId: string;
    loginName: string;
    displayName: string;
    status: string;
    role: CaseRole;
    canReidentify: boolean;
    grantedAt: string;
  }>;
};

export function getCaseAccessOverview(): Promise<{
  cases: CaseAccessOverviewItem[];
}> {
  return json("/api/admin/case-access");
}

export function listCaseAccessCandidates(
  caseId: string
): Promise<CaseAccessCandidatesResponse> {
  return json<CaseAccessCandidatesResponse>(
    `/api/cases/${caseId}/access-candidates`
  );
}

export function grantCaseAccess(
  caseId: string,
  input: {
    userId: string;
    role: Exclude<
      CaseRole,
      "OWNER"
    >;
    canReidentify: boolean;
  }
): Promise<CaseAccessEntry> {
  return json<CaseAccessEntry>(
    `/api/cases/${caseId}/access`,
    {
      method: "POST",
      body: JSON.stringify(
        input
      )
    }
  );
}

export function transferCaseOwnership(
  caseId: string,
  userId: string,
  password: string
): Promise<{
  caseId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
  previousOwnerRole:
    "EDITOR";
  keyVersion: number;
  transferredAt: string;
}> {
  return json(
    `/api/cases/${caseId}/transfer-owner`,
    {
      method: "POST",
      body: JSON.stringify({
        userId,
        password
      })
    }
  );
}

export function revokeCaseAccess(
  caseId: string,
  userId: string
): Promise<{
  caseId: string;
  revokedUserId: string;
  keyVersion: number;
}> {
  return json(
    `/api/cases/${caseId}/access/${userId}`,
    {
      method: "DELETE"
    }
  );
}

export function listCaseFiles(
  caseId: string
): Promise<CaseFilesResponse> {
  return json<CaseFilesResponse>(
    `/api/cases/${caseId}/files`
  );
}

export function listCaseTemplates(
  caseId: string
): Promise<CaseTemplateListResponse> {
  return json<CaseTemplateListResponse>(
    `/api/cases/${caseId}/templates`
  );
}

export function listSharedTemplates():
  Promise<SharedTemplateListResponse> {
  return json<SharedTemplateListResponse>(
    "/api/shared/templates"
  );
}

export async function uploadSharedTemplate(
  file: File
): Promise<SharedTemplateManifest> {
  const lower =
    file.name.toLowerCase();
  const mediaType =
    file.type ||
    (
      lower.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : lower.endsWith(".odt")
          ? "application/vnd.oasis.opendocument.text"
          : "application/octet-stream"
    );

  const response = await fetch(
    `${apiBase()}/api/shared/templates`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": mediaType,
        ...authorizationHeaders(),
        "X-Lex-Filename":
          encodeURIComponent(
            file.name
          )
      },
      body: file
    }
  );
  const payload =
    await response.json() as
      | SharedTemplateManifest
      | ApiFailure;
  if (!response.ok) {
    throw new ApiError(
      (payload as ApiFailure)
        .error ||
        `HTTP_${response.status}`,
      response.status
    );
  }
  return payload as
    SharedTemplateManifest;
}

export function generateLegalDocument(
  caseId: string,
  input: {
    query: string;
    provider: ProviderId;
    model: string;
    primarySkill: string;
    mode:
      | "LAIK"
      | "PRAWNIK";
    format:
      LegalDocumentFormat;
    documentType:
      LegalDocumentType;
    styleProfile?:
      LegalStyleProfile;
    templateId?: string;
    attachments?:
      DocumentAttachmentSelection[];
    firmTemplates?: string[];
    filename?: string;
  }
): Promise<
  GeneratedDocumentResponse
> {
  return json<
    GeneratedDocumentResponse
  >(
    `/api/cases/${caseId}/artifacts/generate`,
    {
      method: "POST",
      body:
        JSON.stringify(
          input
        )
    }
  );
}

export async function downloadGeneratedArtifact(
  caseId: string,
  artifactId: string
): Promise<Blob> {
  const response =
    await fetch(
      `${apiBase()}/api/cases/${caseId}/artifacts/${artifactId}/download`,
      {
        headers: {
          ...authorizationHeaders()
        },
        cache: "no-store"
      }
    );

  if (!response.ok) {
    let code =
      `HTTP_${response.status}`;
    try {
      const failure =
        await response
          .json() as
            ApiFailure;
      code =
        failure.error ||
        code;
    } catch {
      // no JSON body
    }
    throw new ApiError(
      code,
      response.status
    );
  }

  return await response.blob();
}

export function createDeanonymizationIntent(
  caseId: string,
  artifactId: string
): Promise<
  DeanonymizationIntentResponse
> {
  return json<
    DeanonymizationIntentResponse
  >(
    `/api/cases/${caseId}/artifacts/${artifactId}/deanonymization-intent`,
    {
      method: "POST"
    }
  );
}

export function reauthorizeDeanonymization(
  intentId: string,
  password: string
): Promise<
  DeanonymizationReauthorizationResponse
> {
  return json<
    DeanonymizationReauthorizationResponse
  >(
    "/api/deanonymization/reauthorize",
    {
      method: "POST",
      body:
        JSON.stringify({
          intentId,
          // The password typed by the user is always forwarded verbatim.
          // The desktop bridge still substitutes __LEX_NATIVE_REAUTH__ when a
          // managed bootstrap secret exists, but that secret is absent once the
          // runtime seeds the first admin account, so a sentinel sent from here
          // would reach the runtime literally and fail reauthorization.
          password
        })
    }
  );
}

export function finalizeDeanonymization(
  grantId: string,
  filename?: string,
  overrides?: Record<string, string>
): Promise<
  FinalizedDocumentResponse
> {
  return json<
    FinalizedDocumentResponse
  >(
    "/api/deanonymization/finalize",
    {
      method: "POST",
      body:
        JSON.stringify({
          grantId,
          ...(filename
            ? {
                filename
              }
            : {}),
          ...(overrides &&
          Object.keys(overrides).length > 0
            ? { overrides }
            : {})
        })
    }
  );
}

export async function downloadSensitiveArtifact(
  ticketId: string
): Promise<Blob> {
  const response =
    await fetch(
      `${apiBase()}/api/sensitive-download/${ticketId}`,
      {
        headers: {
          ...authorizationHeaders()
        },
        cache: "no-store"
      }
    );
  if (!response.ok) {
    let code =
      `HTTP_${response.status}`;
    try {
      const failure =
        await response
          .json() as
            ApiFailure;
      code =
        failure.error ||
        code;
    } catch {
      // no JSON body
    }
    if (
      response.status ===
        401
    ) {
      clearAuthSession();
      authenticationFailureHandler
        ?.();
    }
    throw new ApiError(
      code,
      response.status
    );
  }
  return await response.blob();
}

export function getRoutes(): Promise<RouteListResponse> {
  return json<RouteListResponse>("/api/routes");
}

export function getSkills(): Promise<{
  count: number;
  skills: Array<{
    name: string;
    version?: string;
    type?: string;
    status?: string;
    description?: string;
    category?: string;
  }>;
}> {
  return json("/api/skills");
}

export function setProviderApiKey(
  provider: ProviderId,
  apiKey: string,
  persistence:
    ProviderCredentialPersistence =
      "PROCESS_MEMORY"
): Promise<ProviderCredentialMutationResponse> {
  return json<ProviderCredentialMutationResponse>(
    `/api/admin/providers/${provider}/credential`,
    {
      method: "PUT",
      body: JSON.stringify({
        apiKey,
        persistence
      })
    }
  );
}

export function clearProviderApiKey(
  provider: ProviderId
): Promise<ProviderCredentialMutationResponse> {
  return json<ProviderCredentialMutationResponse>(
    `/api/admin/providers/${provider}/credential`,
    {
      method: "DELETE"
    }
  );
}

export function setClaudeOAuthToken(
  token: string,
  persistence:
    ProviderCredentialPersistence =
      "PROCESS_MEMORY"
): Promise<ProviderCredentialMutationResponse> {
  return json<ProviderCredentialMutationResponse>(
    "/api/admin/provider-accounts/anthropic/oauth-token",
    {
      method: "PUT",
      body: JSON.stringify({
        token,
        persistence
      })
    }
  );
}

export function clearClaudeOAuthToken():
  Promise<ProviderCredentialMutationResponse> {
  return json<ProviderCredentialMutationResponse>(
    "/api/admin/provider-accounts/anthropic/oauth-token",
    {
      method: "DELETE"
    }
  );
}

export function getProviderAccountStatus():
  Promise<ProviderAccountStatusResponse> {
  return json<ProviderAccountStatusResponse>(
    "/api/provider-accounts"
  );
}

export type AccountClientProvisionProgress = {
  provider: ProviderId;
  stage: "IDLE" | "CHECKING" | "DOWNLOADING" | "VERIFYING" | "READY" | "FAILED";
  startedAt?: string;
  elapsedMs: number;
  packagesFetched: number;
  bytesOnDisk: number;
  error?: string;
  status?: ProviderAccountSessionStatus;
};

// Starts downloading the pinned account client (Codex, Claude Code, Gemini
// CLI, Grok Build) in the background; a first install can take minutes.
export function startProviderAccountProvision(
  provider: ProviderId
): Promise<AccountClientProvisionProgress> {
  return json<AccountClientProvisionProgress>(
    `/api/provider-accounts/${provider}/provision`,
    { method: "POST" }
  );
}

export function getProviderAccountProvision(
  provider: ProviderId
): Promise<AccountClientProvisionProgress> {
  return json<AccountClientProvisionProgress>(
    `/api/provider-accounts/${provider}/provision`
  );
}

export function loginProviderAccount(
  provider: ProviderId
): Promise<ProviderAccountSessionStatus> {
  return json<ProviderAccountSessionStatus>(
    `/api/provider-accounts/${provider}/login`,
    {
      method: "POST"
    }
  );
}

export function logoutProviderAccount(
  provider: ProviderId
): Promise<ProviderAccountSessionStatus> {
  return json<ProviderAccountSessionStatus>(
    `/api/provider-accounts/${provider}/logout`,
    { method: "POST" }
  );
}

export function getGuideState():
  Promise<{
    state:
      GuideSessionState | null;
  }> {
  return json(
    "/api/guide/state"
  );
}

export function initializeGuideState(
  audience:
    "LAIK" | "PRAWNIK"
): Promise<{
  state:
    GuideSessionState;
}> {
  return json(
    "/api/guide/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        audience
      })
    }
  );
}

export function transitionGuideState(
  expectedRevision: number,
  transition: GuideTransition
): Promise<{
  state:
    GuideSessionState;
}> {
  return json(
    "/api/guide/transition",
    {
      method: "POST",
      body: JSON.stringify({
        expectedRevision,
        transition
      })
    }
  );
}

export function getUpdateStatus():
  Promise<UpdateStatusResponse> {
  return json<UpdateStatusResponse>(
    "/api/update/status"
  );
}

export function getSkillUpdateStatus():
  Promise<SkillUpdateStatusResponse> {
  return json<SkillUpdateStatusResponse>(
    "/api/skills/update/status"
  );
}

export type SkillChannel = "stable" | "development";

export type SkillChannelStatusResponse = {
  channel: SkillChannel;
  repository: string;
  status: "UP_TO_DATE" | "AVAILABLE" | "UNAVAILABLE";
  checkedAt: string;
  installed: {
    channel: SkillChannel;
    commit: string;
    directory: string;
    treeSha: string;
    installedAt: string;
    health: string | null;
  } | null;
  latest?: {
    commit: string;
    committedAt: string | null;
    directory: string;
    treeSha: string;
    files: number;
  };
  unavailableReason?: string;
};

export type SkillChannelRefreshResponse = {
  channel: SkillChannel;
  commit: string;
  directory: string;
  files: number;
  installedAt: string;
  restartRequired: true;
  skillRoot: string;
};

export function getSkillChannelStatus(
  channel: SkillChannel
): Promise<SkillChannelStatusResponse> {
  return json<SkillChannelStatusResponse>(
    `/api/skills/channel/status?channel=${encodeURIComponent(channel)}`
  );
}

export function refreshSkillsFromChannel(
  channel: SkillChannel
): Promise<SkillChannelRefreshResponse> {
  return json<SkillChannelRefreshResponse>(
    "/api/skills/channel/refresh",
    {
      method: "POST",
      body: JSON.stringify({ channel })
    }
  );
}

export function applySkillUpdate():
  Promise<SkillUpdateApplyResponse> {
  return json<SkillUpdateApplyResponse>(
    "/api/skills/update/apply",
    { method: "POST" }
  );
}

export function downloadApplicationUpdate():
  Promise<ApplicationUpdateDownloadResponse> {
  return json<ApplicationUpdateDownloadResponse>(
    "/api/update/download",
    { method: "POST" }
  );
}

export async function installStagedApplicationUpdate(
  receiptToken: string
): Promise<void> {
  if (!isDesktopShell()) {
    throw new ApiError(
      "APPLICATION_UPDATE_DESKTOP_REQUIRED",
      409
    );
  }
  const internals = (
    window as Window & {
      __TAURI_INTERNALS__?: {
        invoke?: (
          command: string,
          args?: Record<string, unknown>
        ) => Promise<unknown>;
      };
    }
  ).__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    throw new ApiError(
      "TAURI_INVOKE_UNAVAILABLE",
      503
    );
  }
  await internals.invoke(
    "install_application_update",
    { receiptToken }
  );
}

export function getProviderStatus(): Promise<ProviderStatusResponse> {
  return json<ProviderStatusResponse>("/api/providers");
}

export function validateRoute(
  primarySkill: string
): Promise<RouteValidationResponse> {
  return json<RouteValidationResponse>("/api/routes/validate", {
    method: "POST",
    body: JSON.stringify({ primarySkill })
  });
}

export type QualitySummary = {
  turns: number;
  score: number;
  blockedRate: number;
  verificationRate: number | null;
  topicCoverage: number;
  actCoverage: number | null;
  continuity: number | null;
  pathCoverage?: number | null;
  unbackedClaimRate?: number;
  meanTimeMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type QualityBenchmarkJob = {
  reportId: string;
  provider: string;
  model: string;
  startedAt: string;
  done: number;
  total: number;
  current: string | null;
  cancelling: boolean;
  error?: string;
};

export type QualityBenchmarkReportSummary = {
  reportId: string;
  createdAt: string;
  finishedAt: string;
  provider: string;
  model: string;
  historyChars: number;
  cases: string[];
  cancelled: boolean;
  summary: QualitySummary;
  comparison?: {
    baselineReportId: string;
    items: Array<{ metric: keyof QualitySummary; baseline: number | null; current: number | null; delta: number | null; regression: boolean }>;
  };
};

export function getQualityBenchmark(): Promise<{
  job: QualityBenchmarkJob | null;
  failed: QualityBenchmarkJob | null;
  reports: QualityBenchmarkReportSummary[];
}> {
  return json("/api/admin/quality-benchmark");
}

export function startQualityBenchmark(input: {
  provider: ProviderId;
  model: string;
  cases?: string[];
  historyChars?: number;
}): Promise<{ job: QualityBenchmarkJob }> {
  return json("/api/admin/quality-benchmark", { method: "POST", body: JSON.stringify(input) });
}

export function cancelQualityBenchmark(): Promise<{ job: QualityBenchmarkJob | null }> {
  return json("/api/admin/quality-benchmark/cancel", { method: "POST", body: "{}" });
}

export function getQualityBenchmarkReport(reportId: string): Promise<{ report: QualityBenchmarkReportSummary & { answers: unknown[] }; markdown: string }> {
  return json(`/api/admin/quality-benchmark/reports/${reportId}`);
}

export function getModels(
  provider: ProviderId
): Promise<ModelsResponse> {
  return json<ModelsResponse>(`/api/models/${provider}`);
}

export function getLocalModels():
  Promise<LocalModelsResponse> {
  return json<LocalModelsResponse>(
    "/api/local-models"
  );
}

export function startLocalModel(
  modelId: string
): Promise<{
  model: LocalModelDescriptor;
  runtime: LocalModelsResponse["runtime"];
}> {
  return json(
    "/api/local-models/start",
    {
      method: "POST",
      body: JSON.stringify({
        modelId
      })
    }
  );
}

export function repairLocalModel(): Promise<{
  model: LocalModelDescriptor;
  contextTokens: number;
  configPath: string;
  runtime: LocalModelsResponse["runtime"];
}> {
  return json(
    "/api/local-models/repair",
    {
      method: "POST"
    }
  );
}

export function provisionLocalModel(
  modelId: string,
  contextTokens: number
): Promise<{
  model: LocalModelDescriptor;
  contextTokens: number;
  configPath: string;
  runtime: LocalModelsResponse["runtime"];
}> {
  return json(
    "/api/local-models/provision",
    {
      method: "POST",
      body: JSON.stringify({
        modelId,
        contextTokens
      })
    }
  );
}

export type ContractAnalysisMode = "ANALYSIS" | "REDACTION" | "DRAFT" | "SUPPLEMENT";

// Contract analysis needs its mode chosen once per case before the first execution
// (G39I); the runtime answers CONTRACT_STATE_REQUIRED until it is.
export function initializeContractAnalysisWorkflow(
  caseId: string,
  mode: ContractAnalysisMode
): Promise<{ caseId: string; state: unknown }> {
  return json(`/api/cases/${caseId}/workflow/contract-analysis/initialize`, {
    method: "POST",
    body: JSON.stringify({ mode })
  });
}

export type ResettableWorkflow =
  | { kind: "process-pleading" }
  | { kind: "court-analysis" }
  | { kind: "contract-analysis" }
  | { kind: "ordered"; workflowId: string };

// A finished workflow of the case starts again: the current revision is read and the
// reset confirmed with it (the runtime refuses a reset of a changed state).
export async function resetCaseWorkflow(caseId: string, workflow: ResettableWorkflow): Promise<void> {
  const path =
    workflow.kind === "ordered"
      ? `ordered/${encodeURIComponent(workflow.workflowId)}`
      : workflow.kind;
  const confirmation =
    workflow.kind === "process-pleading"
      ? "RESET_PROCESS_PLEADING"
      : workflow.kind === "court-analysis"
        ? "RESET_COURT_ANALYSIS"
        : workflow.kind === "contract-analysis"
          ? "RESET_CONTRACT_ANALYSIS"
          : "RESET_ORDERED_WORKFLOW";
  const current = await json<{ state: { revision: number } | null }>(`/api/cases/${caseId}/workflow/${path}`);
  if (!current.state) return;
  await json(`/api/cases/${caseId}/workflow/${path}/reset`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision: current.state.revision, confirmation })
  });
}

export function getProcessPleadingWorkflow(
  caseId: string
): Promise<ProcessPleadingWorkflowResponse> {
  return json<ProcessPleadingWorkflowResponse>(
    `/api/cases/${caseId}/workflow/process-pleading`
  );
}

export function initializeProcessPleadingWorkflow(
  caseId: string,
  mode: "CHECKPOINT" | "AUTO" = "CHECKPOINT"
): Promise<{
  caseId: string;
  state: ProcessPleadingWorkflowState;
}> {
  return json(
    `/api/cases/${caseId}/workflow/process-pleading/initialize`,
    {
      method: "POST",
      body: JSON.stringify({ mode })
    }
  );
}

export function acceptProcessPleadingWorkflowStart(
  caseId: string
): Promise<{
  caseId: string;
  state: ProcessPleadingWorkflowState;
}> {
  return json(
    `/api/cases/${caseId}/workflow/process-pleading/accept-start`,
    { method: "POST" }
  );
}

export function confirmProcessPleadingCheckpoint(
  caseId: string,
  checkpoint: ProcessPleadingCheckpoint
): Promise<{
  caseId: string;
  state: ProcessPleadingWorkflowState;
}> {
  return json(
    `/api/cases/${caseId}/workflow/process-pleading/confirm`,
    {
      method: "POST",
      body: JSON.stringify({
        checkpoint
      })
    }
  );
}

export type ProcessPleadingDraftVersion = {
  version: number;
  text: string;
  source: "PIPELINE" | "USER";
  stage: ProcessPleadingWorkflowState["stage"];
  checkpoint?: ProcessPleadingCheckpoint;
  change?: "MINOR" | "SUBSTANTIVE";
  createdAt: string;
};

export type ProcessPleadingDraftView = {
  revision: number;
  latest: ProcessPleadingDraftVersion | null;
  versions: Array<Omit<ProcessPleadingDraftVersion, "text"> & { chars: number }>;
  remarks?: { checkpoint: ProcessPleadingCheckpoint; text: string; at: string };
} | null;

// The pleading text the pipeline keeps between its stages (newest version and history).
export function getProcessPleadingDraft(caseId: string): Promise<{ caseId: string; draft: ProcessPleadingDraftView }> {
  return json(`/api/cases/${caseId}/workflow/process-pleading/draft`);
}

// The user's own version: MINOR keeps the closed checks, SUBSTANTIVE reopens CP-ATAK and W3.
export function saveProcessPleadingDraft(
  caseId: string,
  input: { text: string; change: "MINOR" | "SUBSTANTIVE"; expectedRevision: number }
): Promise<{ caseId: string; draft: ProcessPleadingDraftView; state: ProcessPleadingWorkflowState }> {
  return json(`/api/cases/${caseId}/workflow/process-pleading/draft`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

// CHECKPOINT mode: the step waiting for confirmation goes back with remarks.
export function reviseProcessPleadingCheckpoint(
  caseId: string,
  checkpoint: ProcessPleadingCheckpoint,
  remarks: string
): Promise<{ caseId: string; state: ProcessPleadingWorkflowState }> {
  return json(`/api/cases/${caseId}/workflow/process-pleading/revise`, {
    method: "POST",
    body: JSON.stringify({ checkpoint, remarks })
  });
}

export function executeSession(input: {
  query: string;
  provider: ProviderId;
  model: string;
  primarySkill: string;
  auxiliaryText?: string;
  mode?: "LAIK" | "PRAWNIK";
  attachments?: DocumentAttachmentSelection[];
  // Page images as evidence: photos (default) or also pages with text.
  evidenceImages?: "photos" | "all";
  // Firm templates (DOCX/ODT) sent as text with the message.
  firmTemplates?: string[];
  knowledge?: {
    caseId?: string;
    includeCase?: boolean;
    includeFirm?: boolean;
    limit?: number;
  };
}, executionId?: string): Promise<SessionExecutionResponse> {
  return json<SessionExecutionResponse>("/api/sessions/execute", {
    method: "POST",
    ...(executionId
      ? {
          headers: {
            "X-Lex-Execution-Id":
              executionId
          }
        }
      : {}),
    body: JSON.stringify({
      ...input,
      mode: input.mode ?? "PRAWNIK"
    })
  });
}

export type ExecutionStepsSnapshot = {
  current: number;
  total: number;
  phases: Array<{
    key: string;
    label: string;
    status: "done" | "active" | "pending";
    details: string[];
  }>;
};

export type SessionExecutionProgress = {
  text: string;
  updatedAt: string;
  // Stages of the turn: done, running, pending, with skills and tools used.
  steps?: ExecutionStepsSnapshot;
};

/** Live draft of a running execution (null when not available). */
export async function getSessionProgress(
  executionId: string
): Promise<SessionExecutionProgress | null> {
  try {
    return await json<SessionExecutionProgress>(
      `/api/sessions/progress/${encodeURIComponent(executionId)}`
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 404
    ) {
      return null;
    }
    throw error;
  }
}

function uploadMediaType(file: File): string {
  if (file.type) return file.type;
  const lower =
    file.name.toLowerCase();
  if (lower.endsWith(".zip")) {
    return "application/zip";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".odt")) {
    return "application/vnd.oasis.opendocument.text";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xlsm")) {
    return "application/vnd.ms-excel.sheet.macroenabled.12";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv";
  }
  if (lower.endsWith(".tsv")) {
    return "text/tab-separated-values";
  }

  if (lower.endsWith(".md")) {
    return "text/markdown";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  return "application/octet-stream";
}

// Desktop: the runtime saves the file in the user's Downloads folder (the WebView does
// not perform <a download> of blob URLs). Returns the saved path.
export async function saveToDownloads(
  blob: Blob,
  filename: string
): Promise<{ path: string; filename: string }> {
  const response = await fetch(
    `${apiBase()}/api/downloads/save`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/octet-stream",
        ...authorizationHeaders(),
        "X-Lex-Filename": encodeURIComponent(filename)
      },
      body: blob
    }
  );
  const payload =
    await response.json() as
      | { path: string; filename: string }
      | ApiFailure;
  if (!response.ok) {
    throw new ApiError(
      (payload as ApiFailure).error || `HTTP_${response.status}`,
      response.status
    );
  }
  return payload as { path: string; filename: string };
}

export async function uploadCaseFile(
  caseId: string,
  file: File
): Promise<StoredUploadResponse> {
  const response = await fetch(
    `${apiBase()}/api/cases/${caseId}/files`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": uploadMediaType(file),
        ...authorizationHeaders(),
        "X-Lex-Filename":
          encodeURIComponent(file.name)
      },
      body: file
    }
  );
  const payload =
    await response.json() as
      | StoredUploadResponse
      | ApiFailure;
  if (!response.ok) {
    throw new Error(
      (payload as ApiFailure).error ||
      `HTTP_${response.status}`
    );
  }
  return payload as StoredUploadResponse;
}

export async function reviewDocument(
  file: File,
  caseId: string,
  // localAi: the local model also checks personal data; ocrFix: it corrects OCR.
  options?: { localAi?: boolean; ocrFix?: boolean },
  progressId?: string
): Promise<DocumentReviewResponse> {
  const processing = [
    ...(options?.localAi ? ["local-ai"] : []),
    ...(options?.ocrFix ? ["ocr-fix"] : [])
  ].join(",");
  const response = await fetch(
    `${apiBase()}/api/documents/review`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": uploadMediaType(file),
        ...authorizationHeaders(),
        "X-Lex-Case-Id": caseId,
        ...(processing ? { "X-Lex-Processing": processing } : {}),
        ...(progressId ? { "X-Lex-Progress": progressId } : {}),
        "X-Lex-Filename":
          encodeURIComponent(file.name)
      },
      body: file
    }
  );
  const payload =
    await response.json() as
      | DocumentReviewResponse
      | ApiFailure;
  if (!response.ok) {
    const failure =
      payload as ApiFailure;
    throw new ApiError(
      failure.error ||
        `HTTP_${response.status}`,
      response.status,
      failure.retryAfter,
      failure.reason,
      failure.description,
      failure.stage,
      failure.trace
    );
  }
  return payload as DocumentReviewResponse;
}

/**
 * Re-run OCR and the local pseudonymizer over a file that is already stored in
 * the case files. Until now this endpoint existed but nothing called it, so the
 * privacy pipeline could only ever run at upload time and a document that
 * failed or arrived before a decision could not be reprocessed.
 */
export async function processStoredCaseFile(
  caseId: string,
  uploadId: string,
  fileId?: string,
  progressId?: string,
  // "z lokalnym AI": the running local model also checks the document.
  options?: { localAi?: boolean; ocrFix?: boolean }
): Promise<DocumentReviewResponse> {
  const path = fileId
    ? `/api/cases/${caseId}/files/${uploadId}/members/${fileId}/process`
    : `/api/cases/${caseId}/files/${uploadId}/process`;
  return json<DocumentReviewResponse>(
    path,
    {
      method: "POST",
      ...(progressId ? { headers: { "X-Lex-Progress": progressId } } : {}),
      ...(options?.localAi || typeof options?.ocrFix === "boolean"
        ? {
            headers: {
              ...(progressId ? { "X-Lex-Progress": progressId } : {}),
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              ...(options.localAi ? { localAi: true } : {}),
              ...(typeof options.ocrFix === "boolean" ? { ocrFix: options.ocrFix } : {})
            })
          }
        : {})
    }
  );
}

export function finalizeDocument(
  caseId: string,
  documentId: string,
  directives: PagePrivacyDirective[],
  progressId?: string
): Promise<DocumentIngestionResponse> {
  return json<DocumentIngestionResponse>(
    `/api/documents/${documentId}/finalize`,
    {
      method: "POST",
      ...(progressId ? { headers: { "X-Lex-Progress": progressId } } : {}),
      body: JSON.stringify({
        caseId,
        directives
      })
    }
  );
}

/** The user's own correction of one page's text (a poor scan); personal data on it is detected again. */
export function editDocumentPage(
  caseId: string,
  documentId: string,
  page: number,
  text: string
): Promise<{
  page: DocumentReviewResponse["pages"][number];
  suggestions: DocumentReviewResponse["suggestions"];
}> {
  return json(`/api/documents/${documentId}/pages/${page}/text`, {
    method: "POST",
    body: JSON.stringify({ caseId, text })
  });
}

export type ProcessingProgress = {
  stage: "READING" | "OCR" | "DETECTING" | "AI_CHECK" | "PSEUDONYMIZING" | "SAVING";
  done?: number;
  total?: number;
  // The document page being processed now.
  page?: number;
  // AI_CHECK: the words the local model is checking now.
  item?: string;
  updatedAt: string;
};

export function newProgressId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getProcessingProgress(
  caseId: string,
  progressId: string
): Promise<ProcessingProgress | null> {
  const body = await json<{ progress: ProcessingProgress | null }>(
    `/api/cases/${caseId}/progress/${progressId}`
  );
  return body.progress;
}

export type PrivacyKeyEntry = {
  token: string;
  kind: string;
  value: string;
  forms?: Array<{ case: string; text: string }>;
  gender?: "m" | "f" | "unknown";
  // Person tokens: one person, several persons named together, or a firm.
  entity?: "person" | "group" | "organization";
  legalForm?: string;
  occurrences: number;
};

export type KeyGrammar = "m" | "f" | "group-m" | "group-f" | "organization";

export type AnonymizedVersion = {
  documentId: string;
  totalPages: number;
  chunks: Array<{ index: number; pageStart: number; pageEnd: number; text: string }>;
  highlighted: Array<{
    index: number;
    pageStart: number;
    pageEnd: number;
    text: string;
    marks: Array<{ start: number; end: number; token: string; kind: string }>;
  }>;
  entries: PrivacyKeyEntry[];
  // Legend and key for a model (no values); null without person/address symbols.
  modelKey?: string | null;
};

export type CaseArtifact = {
  artifactId: string;
  filename: string;
  mediaType: string;
  bytes: number;
  createdAt: string;
  sensitivity: "PROTECTED" | "CLEAR_PII";
  sourceArtifactId?: string;
};

export async function listCaseArtifacts(caseId: string): Promise<CaseArtifact[]> {
  return (await json<{ artifacts: CaseArtifact[] }>(`/api/cases/${caseId}/workspace/artifacts`)).artifacts;
}

export async function renameCaseArtifact(
  caseId: string,
  artifactId: string,
  filename: string
): Promise<{ artifactId: string; filename: string }> {
  return json<{ artifactId: string; filename: string }>(
    `/api/cases/${caseId}/workspace/artifacts/${artifactId}`,
    { method: "PATCH", body: JSON.stringify({ filename }) }
  );
}

export function deanonymizeUpload(
  caseId: string,
  uploadId: string,
  documentId: string
): Promise<{ upload: StoredUploadResponse; restored: number; unresolved: string[] }> {
  return json(`/api/cases/${caseId}/files/${uploadId}/deanonymize`, {
    method: "POST",
    body: JSON.stringify({ documentId })
  });
}

function anonymizedPath(caseId: string, documentId: string, action = ""): string {
  return `/api/cases/${caseId}/documents/${documentId}/anonymized${action ? `/${action}` : ""}`;
}

export function getAnonymizedVersion(caseId: string, documentId: string): Promise<AnonymizedVersion> {
  return json<AnonymizedVersion>(anonymizedPath(caseId, documentId));
}

export function addToAnonymization(
  caseId: string,
  documentId: string,
  text: string,
  kind: PiiKind
): Promise<AnonymizedVersion & { token: string; replaced: number }> {
  return json(anonymizedPath(caseId, documentId, "protect"), {
    method: "POST",
    body: JSON.stringify({ text, kind })
  });
}

export function removeFromAnonymization(
  caseId: string,
  documentId: string,
  token: string
): Promise<AnonymizedVersion & { restored: number }> {
  return json(anonymizedPath(caseId, documentId, "unprotect"), {
    method: "POST",
    body: JSON.stringify({ token })
  });
}

export function updateAnonymizationForms(
  caseId: string,
  documentId: string,
  token: string,
  forms: Record<string, string>
): Promise<AnonymizedVersion> {
  return json(anonymizedPath(caseId, documentId, "forms"), {
    method: "POST",
    body: JSON.stringify({ token, forms })
  });
}

/** What a person symbol is: a man, a woman, several persons, a firm. */
export function updateAnonymizationGrammar(
  caseId: string,
  documentId: string,
  token: string,
  grammar: KeyGrammar
): Promise<AnonymizedVersion> {
  return json(anonymizedPath(caseId, documentId, "grammar"), {
    method: "POST",
    body: JSON.stringify({ token, grammar })
  });
}

export async function getPrivacyKey(
  caseId: string,
  documentId: string
): Promise<PrivacyKeyEntry[]> {
  const body = await json<{ entries: PrivacyKeyEntry[] }>(
    `/api/cases/${caseId}/documents/${documentId}/privacy-key`
  );
  return body.entries;
}

export type McpServerCheck = {
  at: string;
  ok: boolean;
  tools?: string[];
  error?: string;
};

export type McpServerStatus = {
  id: string;
  group: string;
  label: string;
  requiresKey?: string;
  installed: boolean;
  ready: boolean;
  desktopInstalled: boolean;
  lastCheck?: McpServerCheck;
};

export type McpPackageInfo = {
  integrity: "MATCH" | "MISMATCH" | "UNVERIFIED" | "MISSING";
  sha256?: string;
  expectedSha256?: string;
  version?: string;
  skillVersion?: string;
};

export type McpConnectorStatusResponse = {
  packagePath: string;
  packageAvailable: boolean;
  package: McpPackageInfo;
  ceidg: {
    keyConfigured: boolean;
    keyUrl: string;
  };
  desktop: {
    configPath: string;
    available: boolean;
  };
  servers: McpServerStatus[];
};

export type CeidgKeyResponse = {
  verification:
    | "VERIFIED"
    | "RATE_LIMITED"
    | "UNREACHABLE";
  httpStatus?: number;
  containsPersonalData: boolean;
  status: McpConnectorStatusResponse;
};

export function getMcpConnectors(): Promise<McpConnectorStatusResponse> {
  return json<McpConnectorStatusResponse>("/api/admin/mcp-connectors");
}

export function installMcpConnector(
  server: string,
  desktop: boolean
): Promise<{ server: string; tools: string[]; status: McpConnectorStatusResponse }> {
  return json(
    `/api/admin/mcp-connectors/${encodeURIComponent(server)}/install`,
    {
      method: "POST",
      body: JSON.stringify({ desktop })
    }
  );
}

export function checkMcpConnector(
  server: string
): Promise<{ server: string; check: McpServerCheck; status: McpConnectorStatusResponse }> {
  return json(
    `/api/admin/mcp-connectors/${encodeURIComponent(server)}/check`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function uninstallMcpConnector(
  server: string,
  desktop: boolean
): Promise<{ server: string; status: McpConnectorStatusResponse }> {
  return json(
    `/api/admin/mcp-connectors/${encodeURIComponent(server)}/uninstall`,
    {
      method: "POST",
      body: JSON.stringify({ desktop })
    }
  );
}

export function setCeidgApiKey(
  key: string
): Promise<CeidgKeyResponse> {
  return json<CeidgKeyResponse>(
    "/api/admin/mcp-connectors/ceidg/key",
    {
      method: "PUT",
      body: JSON.stringify({ key })
    }
  );
}

export function clearCeidgApiKey(): Promise<{ status: McpConnectorStatusResponse }> {
  return json(
    "/api/admin/mcp-connectors/ceidg/key",
    {
      method: "DELETE"
    }
  );
}

export type McpSearchSource = {
  id: string;
  group: string;
  label: string;
  ready: boolean;
  lastCheck?: McpServerCheck;
};

export type McpToolInputProperty = {
  type?: string;
  description?: string;
  enum?: string[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  items?: {
    type?: string;
  };
};

export type McpSearchTool = {
  name: string;
  description?: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, McpToolInputProperty>;
    required?: string[];
  };
};

export type McpSearchQueryResponse = {
  source: string;
  tool: string;
  ok: boolean;
  result: unknown;
};

export type McpSourcePreview =
  | { kind: "html"; url: string; html: string }
  | { kind: "pdf"; url: string; base64: string };

// Page of an official source (search result) fetched by the runtime without scripts.
// Widget: rejestracja ramki (zalogowany użytkownik) i adres ramki z własnym CSP runtime.
export function registerChatWidget(widget: ChatWidget): Promise<{ widgetId: string }> {
  return json("/api/widgets", { method: "POST", body: JSON.stringify({ widget }) });
}

export function chatWidgetFrameUrl(widgetId: string): string {
  return `${apiBase()}/api/widgets/frame/${widgetId}`;
}

export type ProvisionPreview = {
  kind: "html";
  html: string;
  anchor: string;
  eli: string;
  article: string;
  unit: string | null;
  unitFound: boolean;
  copyFetchedAt: string;
  sourceUrl: string;
};

export function previewProvision(claim: string, sourceUrl?: string): Promise<ProvisionPreview> {
  return json<ProvisionPreview>("/api/core-law/provision-preview", {
    method: "POST",
    body: JSON.stringify({ claim, ...(sourceUrl ? { sourceUrl } : {}) })
  });
}

export type CaseLawPreview = {
  url: string;
  html: string;
  anchor: string;
  match: "EXACT" | "PARTIAL" | "SIGNATURE" | "NONE";
  chars: number;
  source?: "LOCAL" | "NETWORK";
  storedAt?: string;
};

// Pełny tekst orzeczenia/interpretacji z oficjalnego źródła, cytowany fragment zaznaczony.
export function previewCaseLaw(input: {
  sourceUrl: string;
  passage?: string;
  signature?: string;
  attributed?: string;
  caseId?: string;
}): Promise<CaseLawPreview> {
  return json<CaseLawPreview>("/api/case-law/preview", { method: "POST", body: JSON.stringify(input) });
}

export type CaseLawCopy = {
  cardUrl: string;
  court: string;
  signature?: string;
  date?: string;
  form?: string;
  text: string;
  sha256: string;
  fetchedAt: string;
};

// Kopia orzeczenia zapisana w aplikacji (do akt sprawy); źródłem jest karta orzeczenia.
export function copyCaseLaw(input: { sourceUrl: string; signature?: string; caseId?: string }): Promise<CaseLawCopy> {
  return json<CaseLawCopy>("/api/case-law/copy", { method: "POST", body: JSON.stringify(input) });
}

// Orzeczenie wskazane przez użytkownika (karta, sygnatura SN, blob: z sygnaturą) pobrane z bazy urzędowej.
export function resolveCaseLaw(input: { cardUrl?: string; signature?: string; caseId?: string }): Promise<CaseLawCopy> {
  return json<CaseLawCopy>("/api/case-law/resolve", { method: "POST", body: JSON.stringify(input) });
}

export type CaseLawCatalogEntry = Omit<CaseLawCopy, "text"> & { chars: number; snippet?: string };

export function getCaseLawLibrary(query = ""): Promise<{ enabled: boolean; available: boolean; entries: CaseLawCatalogEntry[] }> {
  return json(`/api/case-law/library${query ? `?q=${encodeURIComponent(query)}` : ""}`);
}

export function setCaseLawLibrary(enabled: boolean): Promise<{ enabled: boolean }> {
  return json("/api/case-law/library", { method: "PUT", body: JSON.stringify({ enabled }) });
}

export function removeCaseLawLibraryEntry(cardUrl: string): Promise<{ removed: boolean }> {
  return json("/api/case-law/library/remove", { method: "POST", body: JSON.stringify({ cardUrl }) });
}

export function previewMcpSource(url: string): Promise<McpSourcePreview> {
  return json<McpSourcePreview>("/api/mcp-search/source-preview", {
    method: "POST",
    body: JSON.stringify({ url })
  });
}

export function getMcpSearchSources(): Promise<{ package: McpPackageInfo; sources: McpSearchSource[] }> {
  return json("/api/mcp-search/sources");
}

export function getMcpSearchTools(
  source: string
): Promise<{ source: string; tools: McpSearchTool[] }> {
  return json(`/api/mcp-search/sources/${encodeURIComponent(source)}/tools`);
}

export function queryMcpSearch(
  source: string,
  tool: string,
  args: Record<string, unknown>
): Promise<McpSearchQueryResponse> {
  return json<McpSearchQueryResponse>(
    "/api/mcp-search/query",
    {
      method: "POST",
      body: JSON.stringify({ source, tool, arguments: args })
    }
  );
}

export type AnomalySeverity = "WARN" | "ERROR";
export type AnomalyArea = "SKILL_PATH" | "CORPUS" | "GATE" | "SESSION" | "EXECUTION";

export type AnomalyEntry = {
  at: string;
  severity: AnomalySeverity;
  area: AnomalyArea;
  code: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  target?: string;
  detail?: Record<string, string | number | boolean | string[]>;
};

export type AnomalySummaryRow = {
  severity: AnomalySeverity;
  area: AnomalyArea;
  code: string;
  target: string | null;
  count: number;
  lastAt: string;
  providers: string[];
};

export function getAnomalies(filter: { severity?: AnomalySeverity; since?: string; limit?: number } = {}):
  Promise<{ file: string; summary: AnomalySummaryRow[]; entries: AnomalyEntry[] }> {
  const params = new URLSearchParams();
  if (filter.severity) params.set("severity", filter.severity);
  if (filter.since) params.set("since", filter.since);
  if (filter.limit) params.set("limit", String(filter.limit));
  const query = params.toString();
  return json(`/api/diagnostics/anomalies${query ? `?${query}` : ""}`);
}

// Faktura w PDF z logo wystawcy (z ustawień). logoOmitted: logo, którego nie dało się osadzić.
export async function exportInvoicePdf(invoiceId: string): Promise<{ blob: Blob; filename: string; logoOmitted: boolean }> {
  const response = await fetch(`${apiBase()}/api/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
    headers: authorizationHeaders()
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `HTTP_${response.status}`, response.status);
  }
  const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "Faktura.pdf";
  return { blob: await response.blob(), filename, logoOmitted: Boolean(response.headers.get("x-lex-invoice-logo")) };
}

export async function exportAnomalies(): Promise<Blob> {
  const response = await fetch(`${apiBase()}/api/diagnostics/anomalies/export`, {
    headers: authorizationHeaders()
  });
  if (!response.ok) throw new ApiError(`HTTP_${response.status}`, response.status);
  return response.blob();
}

export async function clearAnomalies(): Promise<void> {
  const response = await fetch(`${apiBase()}/api/diagnostics/anomalies`, {
    method: "DELETE",
    headers: authorizationHeaders()
  });
  if (!response.ok) throw new ApiError(`HTTP_${response.status}`, response.status);
}

// Faktury i KSeF (dane użytkownika szyfrowane jego kluczem; token nie wraca z API).

export type KsefEnvironment = "test" | "production";

export type KsefSettings = {
  environment: KsefEnvironment;
  tokenConfigured: boolean;
  tokenHint?: string;
  tokenSetAt?: string;
  contextNip?: string;
};

export type InvoiceParty = {
  name: string;
  nip?: string;
  address: string;
  countryCode?: string;
};

export type InvoiceLine = {
  name: string;
  unit: string;
  quantity: string;
  unitNetPrice: string;
  vatRate: string;
  discount?: string;
};

export type InvoiceAnnotations = {
  cashMethod?: boolean;
  selfBilling?: boolean;
  reverseCharge?: boolean;
  splitPayment?: boolean;
  exemptionBasis?: string;
};

export type NumberingSettings = {
  pattern: string;
  reset: "monthly" | "yearly" | "never";
  padding: number;
};

export type InvoiceRequirementStatus = "UNVERIFIED" | "VERIFIED" | "MISMATCH" | "NOT_FOUND";

export type InvoiceRequirementsReport = {
  eli: string;
  article: string;
  sourceUrl?: string;
  statusDate?: string;
  retrievedAt?: string;
  requirements: Array<{
    id: string;
    point: string;
    label: string;
    fields: string[];
    condition?: string;
    status: InvoiceRequirementStatus;
    excerpt?: string;
  }>;
  uncoveredPoints: Array<{ point: string; excerpt: string }>;
  error?: string;
};

export type InvoiceLogo = {
  mediaType: "image/png" | "image/jpeg";
  fileName: string;
  base64: string;
  uploadedAt: string;
};

export type InvoiceDraft = {
  number: string;
  issueDate: string;
  saleDate?: string;
  placeOfIssue?: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  currency: string;
  paymentMethod?: string;
  paymentDueDate?: string;
  bankAccount?: string;
  notes?: string;
  annotations?: InvoiceAnnotations;
};

export type InvoiceTotals = {
  byRate: Array<{ vatRate: string; net: string; vat: string; gross: string }>;
  net: string;
  vat: string;
  gross: string;
};

export type InvoiceView = InvoiceDraft & {
  invoiceId: string;
  status: "DRAFT" | "ISSUED";
  basedOnInvoiceId?: string;
  createdAt: string;
  updatedAt: string;
  totals: InvoiceTotals;
};

export type InvoiceSort = "date-desc" | "date-asc" | "client-asc" | "client-desc";

export type InvoicePaymentMethod = "przelew" | "gotówka" | "zapłacono";

export type InvoiceDefaults = {
  paymentMethod: InvoicePaymentMethod;
  paymentTermDays: number;
  vatRate: string;
};

export type InvoiceSettingsResponse = {
  ksef: KsefSettings;
  seller?: InvoiceParty;
  logo?: InvoiceLogo;
  defaults?: InvoiceDefaults;
  numbering?: NumberingSettings;
};

export function setInvoiceDefaults(defaults: InvoiceDefaults): Promise<{ defaults: InvoiceDefaults }> {
  return json("/api/invoices/settings/defaults", {
    method: "PUT",
    body: JSON.stringify({ defaults })
  });
}

export function getInvoiceSettings(): Promise<InvoiceSettingsResponse> {
  return json<InvoiceSettingsResponse>("/api/invoices/settings");
}

export function setKsefToken(token: string, contextNip?: string): Promise<{ ksef: KsefSettings }> {
  return json("/api/invoices/settings/ksef-token", {
    method: "PUT",
    body: JSON.stringify({ token, ...(contextNip ? { contextNip } : {}) })
  });
}

export function clearKsefToken(): Promise<{ ksef: KsefSettings }> {
  return json("/api/invoices/settings/ksef-token", { method: "DELETE" });
}

export function setKsefEnvironment(
  environment: KsefEnvironment,
  confirmProduction = false
): Promise<{ ksef: KsefSettings }> {
  return json("/api/invoices/settings/ksef-environment", {
    method: "PUT",
    body: JSON.stringify({ environment, confirmProduction })
  });
}

export function setInvoiceSeller(seller: InvoiceParty): Promise<{ seller: InvoiceParty }> {
  return json("/api/invoices/settings/seller", {
    method: "PUT",
    body: JSON.stringify({ seller })
  });
}

export function setInvoiceLogo(logo: {
  mediaType: string;
  base64: string;
  fileName: string;
}): Promise<{ logo: InvoiceLogo }> {
  return json("/api/invoices/settings/logo", {
    method: "PUT",
    body: JSON.stringify(logo)
  });
}

export function clearInvoiceLogo(): Promise<{ ok: true }> {
  return json("/api/invoices/settings/logo", { method: "DELETE" });
}

export function listInvoices(query: string, sort: InvoiceSort): Promise<{ invoices: InvoiceView[] }> {
  const params = new URLSearchParams({ sort });
  if (query.trim()) params.set("q", query.trim());
  return json(`/api/invoices?${params.toString()}`);
}

export function createInvoice(invoice: InvoiceDraft): Promise<{ invoice: InvoiceView }> {
  return json("/api/invoices", { method: "POST", body: JSON.stringify({ invoice }) });
}

export function updateInvoice(invoiceId: string, invoice: InvoiceDraft): Promise<{ invoice: InvoiceView }> {
  return json(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "PUT",
    body: JSON.stringify({ invoice })
  });
}

export function deleteInvoice(invoiceId: string): Promise<{ ok: true }> {
  return json(`/api/invoices/${encodeURIComponent(invoiceId)}`, { method: "DELETE" });
}

export function issueInvoice(invoiceId: string): Promise<{ invoice: InvoiceView }> {
  return json(`/api/invoices/${encodeURIComponent(invoiceId)}/issue`, { method: "POST" });
}

// Wzór faktury do wielokrotnego użytku (nabywca, pozycje, płatność).
export type InvoiceTemplate = {
  templateId: string;
  name: string;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  currency: string;
  paymentMethod?: string;
  paymentTermDays?: number;
  bankAccount?: string;
  placeOfIssue?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceTemplateInput = Omit<InvoiceTemplate, "templateId" | "createdAt" | "updatedAt">;

export function listInvoiceTemplates(): Promise<{ templates: InvoiceTemplate[] }> {
  return json("/api/invoices/templates");
}

export function saveInvoiceTemplate(
  template: InvoiceTemplateInput,
  templateId?: string
): Promise<{ template: InvoiceTemplate }> {
  return json(templateId ? `/api/invoices/templates/${encodeURIComponent(templateId)}` : "/api/invoices/templates", {
    method: templateId ? "PUT" : "POST",
    body: JSON.stringify({ template })
  });
}

export function deleteInvoiceTemplate(templateId: string): Promise<{ ok: true }> {
  return json(`/api/invoices/templates/${encodeURIComponent(templateId)}`, { method: "DELETE" });
}

export function duplicateInvoice(invoiceId: string): Promise<{ invoice: InvoiceView }> {
  return json(`/api/invoices/${encodeURIComponent(invoiceId)}/duplicate`, { method: "POST" });
}

// Bez tematu: art. 106e; "vat-rate": fragmenty ustawy o VAT z frazą stawki, z ELI.
export function getInvoiceLegalBasis(topic?: "vat-rate"): Promise<{
  eli: string;
  article?: string;
  search?: string;
  ok: boolean;
  result: unknown;
  retrievedAt: string;
  report: InvoiceRequirementsReport;
  secondarySources: string[];
}> {
  return json(topic ? `/api/invoices/legal-basis?topic=${topic}` : "/api/invoices/legal-basis");
}

export function getInvoiceRequirements(): Promise<{
  report: InvoiceRequirementsReport;
  secondarySources: string[];
}> {
  return json("/api/invoices/requirements");
}

export function setInvoiceNumbering(
  numbering: NumberingSettings | null
): Promise<{ numbering: NumberingSettings | null }> {
  return json("/api/invoices/settings/numbering", {
    method: "PUT",
    body: JSON.stringify({ numbering })
  });
}

export function previewInvoiceNumber(issueDate: string): Promise<{ number: string | null }> {
  return json(`/api/invoices/next-number?issueDate=${encodeURIComponent(issueDate)}`);
}
