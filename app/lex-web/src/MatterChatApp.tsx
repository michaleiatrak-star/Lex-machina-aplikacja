import {
  AccountConnectProgress,
  type AccountConnectPhase
} from "./AccountConnectProgress.js";
import {
  canWriteCase,
  caseScheduleKindLabel,
  caseScheduleStartLabel
} from "./case-calendar.js";
import { CalendarPanel } from "./CalendarPanel.js";
import { McpSearchPanel } from "./McpSearchPanel.js";
import { InvoicesPanel } from "./InvoicesPanel.js";
import { InfoTip } from "./InfoTip.js";
import {
  CASE_FILE_REFRESH_MS,
  CASE_FILE_RETRY_DELAYS_MS,
  caseFileListView,
  caseFileStatusText,
  type CaseFileListLoad
} from "./case-file-list.js";
import { downloadBlob } from "./download-file.js";
import { ChatDocumentCard } from "./ChatDocumentCard.js";
import { ChatWidgetCard } from "./ChatWidgetCard.js";
import { CaseContactsCard } from "./CaseContactsCard.js";
import { ProvisionPreview } from "./ProvisionPreview.js";
import { CaseLawPreview, attributedSentence, caseLawDocument, caseLawReferences, isCaseLawSource } from "./CaseLawPreview.js";
import { MandatoryPathDetails } from "./MandatoryPathDetails.js";

// Same text as the runtime's PIPELINE_HANDOFF (task-routing.ts).
const PIPELINE_HANDOFF = "Następny etap pipeline'u:";
import { CaseMemoryCard } from "./CaseMemoryCard.js";
import { CollapsibleCaseSection } from "./CollapsibleCaseSection.js";
import { HomeDashboard } from "./HomeDashboard.js";
import {
  loadLastUsedModel,
  saveLastUsedModel,
  shouldAutoStartLocalModel, loadProviderChannels, saveProviderChannels } from "./last-used-model.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode
} from "react";
import { CaseCollaborationPanel } from "./CaseCollaborationPanel.js";
import { DocumentCitationContent } from "./DocumentCitationContent.js";
import type { SourceClaim } from "./SourceLinkedText.js";
import { documentFailure, privacyConfirmFailure } from "./document-errors.js";
import { DocumentPrivacyPanel } from "./DocumentPrivacyPanel.js";
import { PrivacyPreview, type PrivacyPreviewRequest } from "./PrivacyPreview.js";
import { FirmKnowledgePanel } from "./FirmKnowledgePanel.js";
import { FirmFilePicker } from "./FirmFilePicker.js";
import { pickKey, type FilePick } from "./file-pick-tree.js";
import { WorkspaceManager } from "./WorkspaceManager.js";
import { ProcessPleadingWorkflowPanel } from "./ProcessPleadingWorkflowPanel.js";
import {
  ApiError,
  getSkills,
  addCaseScheduleEvent,
  archiveCase,
  clearClaudeOAuthToken,
  clearProviderApiKey,
  createCase,
  createDeanonymizationIntent,
  deleteCase,
  deleteCaseScheduleEvent,
  downloadGeneratedArtifact,
  downloadSensitiveArtifact,
  executeSession,
  checkDocumentFit,
  getFirmKnowledgeWorkspace,
  getSessionProgress,
  finalizeDeanonymization,
  generateLegalDocument,
  getHealth,
  getLocalModels,
  getModels,
  getProviderAccountStatus,
  getProviderStatus,
  getRoutes,
  isDesktopShell,
  finalizeDocument as finalizeCaseDocument,
  getVisionOcrStatus,
  keepAllDirectives,
  listCaseArtifacts,
  listCaseFiles,
  processStoredCaseFile,
  resolveCaseLaw,
  type ProcessingProgress,
  uploadCaseFile,
  listCaseSchedule,
  listCases,
  loginProviderAccount,
  logoutProviderAccount,
  uninstallProviderAccountClient,
  startProviderAccountProvision,
  getProviderAccountProvision,
  provisionLocalModel,
  repairLocalModel,
  reauthorizeDeanonymization,
  previewDeanonymization,
  saveNameForm,
  renameCase,
  setClaudeOAuthToken,
  setProviderApiKey,
  startLocalModel,
  unarchiveCase,
  type AuthenticatedUser,
  type CaseListItem,
  type GeneratedDocumentResponse,
  type CaseScheduleEvent,
  type CaseScheduleKind,
  type DocumentAttachmentSelection,
  type DocumentDelivery,
  type DocumentFitResponse,
  type ExecutionStepsSnapshot,
  type EvidenceItem,
  type ModelDescriptor,
  type ProviderAccountSessionStatus,
  type ProviderId,
  type SessionExecutionResponse,
  type DeanonymizationPreview,
  type StoredUploadResponse,
  type LegalDocumentFormat,
  type LocalModelsResponse,
  initializeContractAnalysisWorkflow,
  initializeProcessPleadingWorkflow,
  acceptProcessPleadingWorkflowStart,
  resetCaseWorkflow,
  type ContractAnalysisMode
} from "./api.js";
import { workflowRecovery, type WorkflowRecovery } from "./workflow-recovery.js";
import { CoverageLine, UnfinishedAnalysis, unfinishedDocuments } from "./document-coverage-view.js";
import { CorrectionsDetails } from "./answer-corrections-view.js";
import { CONTRACT_MODES, automaticContractMode, suggestedContractMode } from "./contract-mode.js";


import {
  DOCUMENT_FILE_ACCEPT,
  MAX_DOCUMENT_DROP_QUEUE,
  consumeDocumentDropFile,
  documentDropSummary,
  documentStepLabel,
  createDocumentDropQueueState,
  describeDocumentFile,
  enqueueDocumentDropFiles
} from "./document-drop-queue.js";
import {
  createDocumentStagingState,
  setStagedDocumentMode,
  stageDocuments,
  takeStagedDocuments,
  updateStagedDocument
} from "./document-staging.js";
import {
  DOCUMENT_PROCESSING_MODES,
  processingModeKeepsClearText,
  processingModeOptions,
  type DocumentProcessingMode
} from "./document-processing-mode.js";
import {
  AUTO_CASE_TYPE,
  DETERMINISTIC_ACTIONS,
  DETERMINISTIC_ACTION_META_PREFIX,
  buildSkillSelectionEnvelope,
  choosePrimaryRoute,
  deterministicActionFromMeta,
  deterministicActionMeta,
  labelForSkill,
  setAllowedDomainSkills,
  setCaseTypeExecutionSkills,
  skillsForDeterministicAction,
  workModeForAction,
  type ChatWorkMode,
  type DeterministicActionId,
  type PublicSkillDescriptor
} from "./chat-routing.js";
import {
  useCaseThread,
  type CaseChatMessage
} from "./case-thread.js";
import {
  LOCAL_CONVERSATION_CHARS,
  conversationBudgetChars,
  conversationForProvider
} from "./conversation-context.js";
import {
  filterMatterCases,
  type MatterRoleFilter,
  type MatterSort,
  type MatterStatusFilter
} from "./search-filters.js";
import {
  accountModelChoices,
  accountModelIdForPrimarySource,
  canExecutePrimaryModel,
  isAccountPrimarySource,
  modelsForPrimarySource,
  runtimeProviderForPrimarySource,
  shouldLoadPrimaryModelCatalog,
  type PrimaryModelSource,
  PROVIDER_GROUPS,
  preferredSourceForGroup,
  providerGroupOf,
  sourceForGroup,
  type ProviderGroup
} from "./primary-model-policy.js";
import type {
  WorkspaceDocumentCitation
} from "./workspace-client.js";
import { RestorationReview } from "./RestorationReview.js";
import {
  DeanonymizationReview,
  applyAliasCorrection
} from "./DeanonymizationReview.js";
import {
  applyRestorationCorrection,
  shiftMarks,
  unresolvedPlaceholders,
  validMarks
} from "./restoration-review.js";
import "./chat.css";
import "./workspace.css";
import { progressLabel, progressPercent, trackProgress } from "./processing-progress.js";
import { SnVerification } from "./SnVerification.js";
import { autoAdvanceDecision, autoAdvanceNote, workflowProgress } from "./workflow-auto-advance.js";
import { actionMetaMessage, switchAction, switchMessage, switchTitle, type SkillSwitchOffer } from "./skill-switch-offer.js";
import {
  DeveloperModeContext,
  loadDeveloperMode,
  phaseLabel,
  plainErrorMessage,
  plainMeta,
  plainStepLabel,
  saveDeveloperMode,
  skillLabel,
  visibleContent
} from "./developer-mode.js";

type TabId =
  | "home"
  | "calendar"
  | "chat"
  | "case"
  | "firm"
  | "search"
  | "invoices"
  | "settings";

export type SettingsSection =
  | "models"
  | "users"
  | "security"
  | "mcp"
  | "invoices"
  | "skills"
  | "maintenance"
  | "server"
  | "account";

export type SettingsRequest = {
  section: SettingsSection;
  nonce: number;
};

type SettingsPanels = {
  localAi?: ReactNode;
  integrations?: ReactNode;
  users?: ReactNode;
  security?: ReactNode;
  mcp?: ReactNode;
  invoices?: ReactNode;
  maintenance?: ReactNode;
  server?: ReactNode;
  account?: ReactNode;
};

type ExtendedExecution = SessionExecutionResponse & {
  documentCitations?: WorkspaceDocumentCitation[];
  loadedSkills?: string[];
  executionSkills?: string[];
  domainSkills?: string[];
};

type ExecutionDiagnostic = {
  friendly: string;
  code: string;
  status?: number;
  reason?: string;
  description?: string;
  stage?: string;
  trace?: ApiError["trace"];
};

const WELCOME: CaseChatMessage = {
  id: "welcome",
  role: "system",
  content:
    "Ten wątek jest przypisany do jednej sprawy. Opisz zadanie, a Lex Machina dobierze potrzebne dziedziny prawa i współpracujące skille wykonawcze."
};

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  apiKeyUrl: string;
  accountClientLabel: string;
}> = [
  {
    id: "openai",
    label: "OpenAI",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    accountClientLabel: "Codex CLI"
  },
  {
    id: "anthropic",
    label: "Anthropic / Claude",
    apiKeyUrl: "https://platform.claude.com/settings/keys",
    accountClientLabel: "Claude Code"
  },
  {
    id: "xai",
    label: "xAI / Grok",
    apiKeyUrl: "https://console.x.ai/",
    accountClientLabel: "Grok Build"
  },
  {
    id: "google",
    label: "Google / Gemini",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    accountClientLabel: "Gemini CLI"
  }
];

// Runtime error codes from provisioning the pinned account client.
export function provisionFailureText(error: string): string {
  if (error.startsWith("ACCOUNT_SESSION_CLI_PROVISIONER_NOT_AVAILABLE")) {
    return "Nie można pobrać klienta: brak npm w pakiecie aplikacji. Przełącz źródło na API albo zgłoś błąd.";
  }
  if (error.startsWith("ACCOUNT_SESSION_COMMAND_TIMEOUT")) {
    return "Pobieranie klienta przekroczyło 10 minut (wolne łącze lub serwer npm). Spróbuj ponownie.";
  }
  if (error.startsWith("ACCOUNT_SESSION_CLI_PROVISION_FAILED")) {
    // ACCOUNT_SESSION_CLI_PROVISION_FAILED:<provider>:<exit code>:<npm error lines>
    const detail = error.split(":").slice(3).join(":").trim();
    const cause = /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|proxy|certificate|CERT_/i.test(detail)
      ? "brak połączenia z serwerem npm (sieć, proxy lub certyfikat)"
      : /not recognized|is not recognized|ENOENT/i.test(detail)
        ? "brak wymaganego programu podczas instalacji"
        : /EPERM|EACCES|EBUSY/i.test(detail)
          ? "brak dostępu do plików (program antywirusowy lub otwarty plik)"
          : "błąd instalacji npm";
    return `Pobieranie klienta nie powiodło się: ${cause}.${detail ? ` Szczegóły: ${detail}` : ""}`;
  }
  return `Nie udało się przygotować klienta: ${error || "nieznany błąd"}.`;
}

// Kolejność w selektorze: modele główne (konto/API) u góry, lokalna AI na dole.
const PRIMARY_MODEL_SOURCES: Array<{
  id: PrimaryModelSource;
  label: string;
}> = [
  {
    id: "openai-account",
    label: "ChatGPT · konto"
  },
  {
    id: "openai",
    label: "OpenAI · API"
  },
  {
    id: "anthropic-account",
    label: "Claude · konto / OAuth"
  },
  {
    id: "anthropic",
    label: "Anthropic · API"
  },
  {
    id: "xai-account",
    label: "Grok · konto"
  },
  {
    id: "xai",
    label: "xAI · API"
  },
  {
    id: "google-account",
    // Google odrzuca w Gemini CLI bezpłatny plan „Gemini Code Assist for individuals”.
    label: "Gemini · konto Google (plan płatny)"
  },
  {
    id: "google",
    label: "Google Gemini · API"
  },
  {
    id: "local",
    label: "Lokalne"
  }
];

const ACCOUNT_MODEL_LABELS: Record<
  ProviderId,
  string
> = {
  openai:
    "ChatGPT / Codex · model konta",
  anthropic:
    "Claude Code · model konta",
  xai:
    "Grok · model konta",
  google:
    "Gemini CLI · model konta"
};

// The case summary button's message (the server adds the template and keeps the answer).
const CASE_OVERVIEW_REQUEST =
  "Utwórz podsumowanie sprawy (metryka, dokumenty, podmioty, oś czasu, finanse, fakty kluczowe, czynniki krytyczne, spory i braki, synteza) na podstawie dokumentów sprawy.";

const MANDATORY_SKILLS = ["prawny-router-v3", "shared"] as const;
const KNOWN_EXECUTION_SKILLS = new Set([
  "analiza-sadowa-v6",
  "analizator-dowodow-v3",
  "analizator-przepisow-v2",
  "analizator-umow-v1",
  "chronologia-sprawy-v1",
  "orzeczenia-sadowe-v2",
  "pisma-procesowe-v3",
  "pisma-proste-v2",
  "przesluchanie-swiadkow-v2-min90",
  "przewodnik-prawny-v2",
  "raport-klienta-v1",
  "raport-sytuacyjny-v2"
]);

const FALLBACK_EXECUTION_SKILLS: PublicSkillDescriptor[] = [
  {
    name: "analiza-sadowa-v6",
    category: "execution",
    description: "Analiza sądowa i procesowa akt sprawy."
  },
  {
    name: "analizator-dowodow-v3",
    category: "execution",
    description: "Analiza materiału dowodowego, luk i ryzyk."
  },
  {
    name: "analizator-przepisow-v2",
    category: "execution",
    description: "Analiza i zestawienie przepisów istotnych dla sprawy."
  },
  {
    name: "analizator-umow-v1",
    category: "execution",
    description: "Analiza postanowień umowy, obowiązków i ryzyk."
  },
  {
    name: "chronologia-sprawy-v1",
    category: "execution",
    description: "Chronologia zdarzeń, terminów i zależności czasowych."
  },
  {
    name: "orzeczenia-sadowe-v2",
    category: "execution",
    description: "Praca z orzecznictwem i tezami judykatury."
  },
  {
    name: "pisma-procesowe-v3",
    category: "execution",
    description: "Przygotowanie pisma procesowego w checkpointowanym workflow."
  },
  {
    name: "pisma-proste-v2",
    category: "execution",
    description: "Przygotowanie prostego pisma prawnego lub procesowego."
  },
  {
    name: "przesluchanie-swiadkow-v2-min90",
    category: "execution",
    description: "Plan przesłuchania świadków i zestaw pytań."
  },
  {
    name: "przewodnik-prawny-v2",
    category: "execution",
    description: "Przewodnik po dalszych krokach i ścieżkach działania."
  },
  {
    name: "raport-klienta-v1",
    category: "execution",
    description: "Raport dla klienta."
  },
  {
    name: "raport-sytuacyjny-v2",
    category: "execution",
    description: "Raport sytuacyjny sprawy, ryzyk i kolejnych działań."
  }
];

function mergeSkillCatalog(
  ...catalogs: readonly PublicSkillDescriptor[][]
): PublicSkillDescriptor[] {
  const byName = new Map<string, PublicSkillDescriptor>();
  for (const catalog of catalogs) {
    for (const skill of catalog) {
      const existing = byName.get(skill.name);
      byName.set(
        skill.name,
        existing
          ? {
              ...existing,
              ...skill,
              category:
                skill.category ??
                existing.category
            }
          : skill
      );
    }
  }
  return [...byName.values()];
}

function messageId(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ??
    `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
      .replace(/[^a-f0-9]/g, "")
      .padEnd(32, "0")
      .slice(0, 32);
  return `message_${random}`;
}

function suggestedCaseName(input: string): string {
  const clean = input
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
  return clean.length >= 8 ? clean : "Nowa sprawa";
}

type DirectDocumentRequest = {
  format: "docx" | "odt";
  documentType:
    | "pleading"
    | "contract"
    | "opinion"
    | "letter"
    | "report"
    | "other";
};

// Letter skills end with a file on their own, without being asked:
// - a simple letter (mechanical workflow or chosen by the router in AUTO): a draft
//   after each cycle, the finished document when every gate passed;
// - a process pleading: a draft (marked PROJEKT – NIE SKŁADAĆ) when W2 wrote the
//   draft, and the finished document at FINAL.
// Other workflows produce no file on their own.
/**
 * An answer that is itself a letter: a place-and-date line or an addressee, and a closing
 * (a signature, "Z poważaniem") or fields to fill in. Questions alone are no letter.
 */
export function looksLikeLetter(answer: string): boolean {
  // The chat's Markdown ("**[Miejscowość], [data]**", "### Odpowiedź", "_[podpis]_") is not
  // the letter's text: without it the date line and the signature were not seen.
  const body = (answer.split(/⚖️|\bWażna informacja:/u)[0] ?? "")
    .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?)/gmu, "")
    .replace(/(\*\*|__)(.+?)\1/gu, "$2")
    .replace(/(?<![\p{L}\p{N}*_])[*_](?![\s*_])([^*_\n]+?)(?<![\s*_])[*_](?![\p{L}\p{N}*_])/gu, "$1");
  const heading = /(?:^|\n)\s*(?:\[[^\]\n]{1,40}\]|\p{Lu}[\p{L}-]+(?:\s+\p{Lu}[\p{L}-]+)?)\s*,\s*(?:dnia\s+)?(?:\[[^\]\n]{1,20}\]|\d{1,2}[.\s])/u.test(body) ||
    /(?:^|\n)\s*(?:Adresat|Do|Odbiorca)\s*:/u.test(body);
  const closing = /\[podpis\]|(?:^|\n)\s*(?:Z\s+poważaniem|Z\s+wyrazami\s+szacunku)\b|(?:^|\n)\s*\.{5,}\s*(?:\n|$)|⬛|\[UZUPEŁNIJ/iu.test(body);
  return heading && closing && body.replace(/\s+/gu, " ").length > 400;
}

export function letterDocumentPlan(
  result: Pick<
    ExtendedExecution,
    "status" | "answer" | "workflow" | "processWorkflow" | "finalization" | "gateI" | "verification" | "taskSkill" | "waitingForUser" | "skillSwitch" | "taskMode" | "contractWorkflow" | "longDocument" | "answerDocument"
  >
): { documentType: "letter" | "pleading" | "contract"; stage: "DRAFT" | "FINAL"; source?: "REDACTION" | "ANSWER"; answerSessionId?: string; longDocumentId?: string } | null {
  if (result.status !== "DRAFT_PRESENTABLE" || !result.answer) return null;
  // Questions to the user or an offer to switch the letter skill: no letter yet.
  if (result.waitingForUser || result.skillSwitch) return null;
  // A long letter in parts: no file of one part; one file of all the parts once each passed.
  // A contract's file waits for its pipeline (AU-HYBRID, AU-STRIP): "Generuj dokument".
  if (result.longDocument) {
    if (!result.longDocument.complete || !result.longDocument.id || result.taskSkill === "analizator-umow-v1") return null;
    return {
      documentType: longDocumentType(result.taskSkill),
      stage: result.finalization === "PASS" && result.gateI?.result !== "BLOCKED" && result.verification.unverified === 0 ? "FINAL" : "DRAFT",
      longDocumentId: result.longDocument.id
    };
  }
  // analizator-umow-v1: the contract drafted or corrected in its pipeline becomes a file in the
  // turn that closed AU-STRIP (after AU-HYBRID); the server checks the same state.
  const contract = result.contractWorkflow;
  if (contract && contract.mode && contract.mode !== "ANALYSIS" && contract.closedCheckpoints?.includes("AU-HYBRID") && contract.closedCheckpoints.includes("AU-STRIP") && contract.nextCheckpoint === "AU-POST") {
    return { documentType: "contract", stage: "FINAL" };
  }
  // MOD-REDAKCJA: the corrected pleading as a file ("jako artefakt/plik"); a draft while
  // fields are missing (⬛) or suggestions wait for a decision.
  if (result.taskMode === "REDACTION") {
    const ready =
      result.finalization === "PASS" &&
      result.gateI?.result !== "BLOCKED" &&
      result.verification.unverified === 0 &&
      !/⬛|WYMAGA DECYZJI/u.test(result.answer);
    return { documentType: "pleading", stage: ready ? "FINAL" : "DRAFT", source: "REDACTION" };
  }
  if (result.processWorkflow || result.workflow?.id === "PROCESS_PLEADING_V1") {
    if (result.processWorkflow?.documentStatus === "FINAL") return { documentType: "pleading", stage: "FINAL" };
    return result.processWorkflow?.draftWritten?.checkpoint === "CP-ATAK"
      ? { documentType: "pleading", stage: "DRAFT" }
      : null;
  }
  if (result.workflow?.id === "SIMPLE_LETTER_V1" || result.taskSkill === "pisma-proste-v2") {
    // The server kept the answer as a letter (its title, body and signer read): the file is
    // made from that text mechanically, with no model turn writing it again.
    if (result.answerDocument) {
      const ready = result.verification.unverified === 0 && result.gateI?.result !== "BLOCKED" && !/⬛|\[UZUPEŁNIJ/u.test(result.answer);
      return { documentType: "letter", stage: ready ? "FINAL" : "DRAFT", source: "ANSWER", answerSessionId: result.answerDocument.sessionId };
    }
    // Questions about missing data are no letter yet: no file from them.
    if (!looksLikeLetter(result.answer)) return null;
    return {
      documentType: "letter",
      stage:
        result.finalization === "PASS" &&
        result.gateI?.result !== "BLOCKED" &&
        result.verification.unverified === 0
          ? "FINAL"
          : "DRAFT"
    };
  }
  return null;
}

/** The document type of a long letter's file, by the skill that wrote it. */
export function longDocumentType(skill: string | undefined): "letter" | "pleading" | "contract" {
  return skill === "pisma-procesowe-v3" ? "pleading" : skill === "analizator-umow-v1" ? "contract" : "letter";
}

/** AUTO chose the process pleading skill, but its pipeline (and its file) has not started. */
export function pleadingPipelineNeeded(
  result: Pick<ExtendedExecution, "status" | "taskSkill" | "processWorkflow" | "taskMode">
): boolean {
  // A corrected pleading (Test A, MOD-REDAKCJA) needs no W1–W3 pipeline.
  return result.status === "DRAFT_PRESENTABLE" && result.taskSkill === "pisma-procesowe-v3" && !result.processWorkflow && result.taskMode !== "REDACTION";
}

// Word boundaries for Polish text: JavaScript's \b sees only ASCII letters, so
// "umowę" or "dokumentu" never matched a \b-delimited pattern.
// Patterns and message are compared without Polish letters: a message typed as
// "sporzadz zgloszenie" is the same request as "sporządź zgłoszenie".
function withoutPolishLetters(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/gu, "l").replace(/Ł/gu, "L");
}

function polishWords(alternatives: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\d])(?:${withoutPolishLetters(alternatives)})(?![\\p{L}\\d])`, "u");
}

// A contract asked to be written ("napisz umowę") is a document request too: the server sends
// it back to the contract workflow (WORKFLOW_PIPELINE_REQUIRED), which makes its file.
const DOCUMENT_NOUN = polishWords(
  "umow[aeyę]|umową|umowie|umowami|umowach|umowom|umów|aneks\\p{L}*|pism\\p{L}*|piśmie|dokument\\p{L}*|dokumencie|plik\\p{L}*|wezwani\\p{L}*|pozew|pozw\\p{L}*|wnios\\p{L}*|apelacj\\p{L}*|sprzeciw\\p{L}*|zażaleni\\p{L}*|opini\\p{L}*|raport\\p{L}*|oświadczeni\\p{L}*|reklamacj\\p{L}*|pełnomocnictw\\p{L}*|wz[oó]r\\p{L}*|" +
    // Other letters and acts one writes: "zawiadomienie o przestępstwie", "skarga do WSA",
    // "odwołanie od decyzji", "petycja", "zgłoszenie", "wypowiedzenie", "procedura", "regulamin".
    "zawiadomieni\\p{L}*|skarg\\p{L}*|odwołani\\p{L}*|protest\\p{L}*|petycj\\p{L}*|zgłoszeni\\p{L}*|wypowiedzeni\\p{L}*|upoważnieni\\p{L}*|procedur\\p{L}*|polityk\\p{L}*|regulamin\\p{L}*|uchwał\\p{L}*|kwestionariusz\\p{L}*|ankiet\\p{L}*|korekt\\p{L}*|żądani\\p{L}*|zarzut\\p{L}*|wyjaśnieni\\p{L}*|powiadomieni\\p{L}*|czynn\\p{L}*\\s+żal\\p{L}*"
);
const GENERATION_VERB = polishWords(
  "wygeneruj|przygotuj|stwórz|utwórz|sporządź|napisz|daj|opracuj|zapisz|wyeksportuj|eksportuj|zrób|przerób|zamień|przekształć"
);
// "Proszę o odwołanie, docx", "Potrzebuję pozwu o zapłatę, w docx" (test 500: went to the chat
// as a question): asking for a letter in a named file format is asking to write it. Without
// the format "proszę o wyjaśnienie" stays a question.
const REQUEST_VERB = polishWords("proszę\\s+o|poproszę|potrzebuję|potrzebny\\s+mi|potrzebna\\s+mi|potrzebne\\s+mi");
// "Proszę o napisanie umowy", "poproszę o sporządzenie wezwania", "proszę o dokument", "proszę o
// pismo do ZUS": asking for the writing of a named document, or for the document itself, is
// a request to write it, with or without a file format.
const REQUESTED_WRITING = new RegExp(
  withoutPolishLetters(
    /(?<![\p{L}])(?:proszę|poproszę|potrzebuję)(?:\s+\p{L}+)?\s+(?:o\s+)?(?:(?:napisanie|sporządzenie|przygotowanie|wygenerowanie|opracowanie|zredagowanie|stworzenie|utworzenie)(?![\p{L}])|umow(?:a|y|e|ie|ami|ach|om)(?![\p{L}])|(?:pism|dokument|aneks|wezwani|wnios|apelacj|sprzeciw|odwołani|zażaleni|wypowiedzeni|reklamacj|pełnomocnictw|oświadczeni|skarg|zawiadomieni|regulamin|wzor|wzór)\p{L}*|(?:umów|pozew|pozwu|pozwem)(?![\p{L}]))/u.source
  ),
  "u"
);
// A file named as the result: "do pobrania", "w postaci dokumentu", "jako plik".
const FILE_RESULT = new RegExp(
  withoutPolishLetters(
    /(?<![\p{L}])(?:do\s+(?:pobrania|ściągnięcia|zapisania|wydruku)|(?:w\s+(?:postaci|formie|formacie)|jako)\s+(?:pliku|plik|dokumentu|dokument)(?![\p{L}]))/u.source
  ),
  "u"
);
// Reading a document is not writing one: analysis or verification of a file
// goes to the chat unless a file is named as the result.
const READING_INTENT = polishWords(
  "przeanalizuj|analiz\\p{L}*|zweryfikuj|weryfik\\p{L}*|sprawdź|sprawdz|oceń|ocen\\p{L}*|porównaj|wskaż|zinterpretuj|wyjaśnij|streść|podsumuj|przejrzyj|co\\s+(?:jest|zawiera|wynika)"
);
// "procedura weryfikacji kontrahentów", "polityka oceny ryzyka": the reading word
// names what the document governs, it is not a request to read something.
const GOVERNED_ACTIVITY = new RegExp(
  `(?<![\\p{L}\\d])(${withoutPolishLetters("procedur\\p{L}*|polityk\\p{L}*|regulamin\\p{L}*|instrukcj\\p{L}*")})\\s+\\p{L}+`,
  "gu"
);

/**
 * A request for the file of the letter just written ("ok daj mi pismo", "wygeneruj to w docx"),
 * not for a new letter: short, or pointing back at it, with no new subject of its own.
 */
export function refersToLastAnswer(input: string): boolean {
  const words = withoutPolishLetters(input.toLocaleLowerCase("pl")).match(/\p{L}+/gu) ?? [];
  if (words.some((word) => /^(?:nowe|nowy|inne|inny|kolejne|drugie)$/u.test(word))) return false;
  if (words.some((word) => /^(?:to|tego|ten|te|tym|powyzsz\p{L}*|ostatni\p{L}*|gotow\p{L}*|przygotowan\p{L}*|wyzej)$/u.test(word))) return true;
  return words.length > 0 && words.every((word) => GENERIC_FILE_WORDS.has(word));
}

// Words of a bare request for a file, naming nothing new ("ok daj mi pismo w docx").
const GENERIC_FILE_WORDS = new Set([
  "ok", "okej", "dobrze", "tak", "prosze", "teraz", "juz", "a", "i", "mi", "mnie", "nam", "w", "we", "jako", "z", "do", "pobrania",
  "daj", "dawaj", "wygeneruj", "generuj", "przygotuj", "zrob", "stworz", "utworz", "zapisz", "pobierz", "wyeksportuj", "eksportuj",
  "pismo", "pisma", "plik", "pliku", "dokument", "dokumentu", "docx", "doc", "word", "wordzie", "worda", "formie", "formacie", "wersji", "wersje",
  // "wygeneruj odpowiedź w postaci dokumentu docx", "analizę jako plik": the answer itself.
  "odpowiedz", "odpowiedzi", "postaci", "analiza", "analize", "analizy", "opinia", "opinie", "opinii", "raport", "jej", "ja"
]);

export function directDocumentRequest(
  input: string
): DirectDocumentRequest | null {
  const normalized =
    withoutPolishLetters(
      input
        .normalize("NFKC")
        .toLocaleLowerCase("pl")
    );

  const explicitFormat =
    polishWords("odt").test(normalized)
      ? "odt" as const
      // "plik doc", "w Wordzie", "worda": the same .docx request.
      : polishWords("docx?|word(?:a|zie|owy|owym|ze)?").test(normalized)
        ? "docx" as const
        : null;

  const fileResult = FILE_RESULT.test(normalized);
  const drafting =
    DOCUMENT_NOUN.test(normalized) &&
    (GENERATION_VERB.test(normalized) || REQUESTED_WRITING.test(normalized) || ((explicitFormat !== null || fileResult) && REQUEST_VERB.test(normalized))) &&
    !READING_INTENT.test(normalized.replace(GOVERNED_ACTIVITY, "$1"));

  if (!explicitFormat && !fileResult && !drafting) {
    return null;
  }
  // "Jak zrobić tabelkę w Wordzie?" names the format but asks how to do something.
  if (explicitFormat && !fileResult && !drafting && !GENERATION_VERB.test(normalized)) {
    return null;
  }
  // "Sprawdź, co jest w pliku" names a file but asks to read it.
  if (!explicitFormat && !drafting && !GENERATION_VERB.test(normalized) && READING_INTENT.test(normalized)) {
    return null;
  }

  const documentType =
    polishWords("pozew|pozw\\p{L}*|apelacj\\p{L}*|sprzeciw\\p{L}*|zażaleni\\p{L}*|pism\\p{L}*\\s+procesow\\p{L}*|odpowied\\p{L}*\\s+na\\s+pozew|skarg\\p{L}*\\s+kasacyjn\\p{L}*")
      .test(normalized)
      ? "pleading" as const
      : polishWords("umow\\p{L}*|umów").test(normalized)
        ? "contract" as const
        : polishWords("opini\\p{L}*").test(normalized)
          ? "opinion" as const
          : polishWords("raport\\p{L}*").test(normalized)
            ? "report" as const
            : polishWords("wezwani\\p{L}*|reklamacj\\p{L}*|oświadczeni\\p{L}*|pełnomocnictw\\p{L}*|list\\p{L}*|zawiadomieni\\p{L}*|petycj\\p{L}*|zgłoszeni\\p{L}*|wypowiedzeni\\p{L}*|upoważnieni\\p{L}*").test(normalized)
              ? "letter" as const
              : "other" as const;

  return {
    format:
      explicitFormat ??
      "docx",
    documentType
  };
}

function upsertAttachment(
  current: DocumentAttachmentSelection[],
  selection: DocumentAttachmentSelection
): DocumentAttachmentSelection[] {
  const existing = current.findIndex(
    (item) =>
      item.caseId === selection.caseId &&
      item.documentId === selection.documentId
  );
  if (existing >= 0) {
    return current.map((item, index) =>
      index === existing ? selection : item
    );
  }
  // The limit is checked where files are picked, with a message; never drop one silently.
  return [...current, selection];
}

function isExecutionSkill(skill: PublicSkillDescriptor): boolean {
  return (
    skill.category === "execution" ||
    skill.type?.toLowerCase().startsWith("executive-") === true ||
    KNOWN_EXECUTION_SKILLS.has(skill.name)
  );
}

function visibleMessageMeta(
  meta?: string,
  developer = true
): string {
  if (!meta) return "";
  if (!developer) return plainMeta(meta);
  return meta
    .split(/\s*[|;]\s*/)
    .filter(
      (item) =>
        !item.startsWith(
          DETERMINISTIC_ACTION_META_PREFIX
        )
    )
    .join(" · ")
    .trim();
}

export function localModelFailureMessage(
  reason?: string
): string {
  switch (reason) {
    case "LOCAL_MODEL_SERVER_UNREACHABLE":
      return "Profil lokalnego modelu przeszedł przygotowanie, ale serwer llama.cpp przestał odpowiadać przed lub w trakcie generowania. Program uruchomi go ponownie przy następnej wiadomości. Kod: LOCAL_MODEL_SERVER_UNREACHABLE";
    case "LOCAL_MODEL_REQUEST_REJECTED":
      return "Połączenie z lokalnym serwerem działało, ale llama.cpp odrzucił żądanie inferencji. Kod: LOCAL_MODEL_REQUEST_REJECTED";
    case "LOCAL_MODEL_SERVER_ERROR":
      return "Połączenie z lokalnym serwerem działało, ale llama.cpp zwrócił błąd podczas generowania. Kod: LOCAL_MODEL_SERVER_ERROR";
    case "LOCAL_MODEL_CONTEXT_OVERFLOW":
      return "Lokalny model działa, ale żądanie przekroczyło dostępny kontekst. Zmniejsz zakres rozmowy lub kontekst załączników. Kod: LOCAL_MODEL_CONTEXT_OVERFLOW";
    case "LOCAL_MODEL_RESOURCE_EXHAUSTED":
      return "Lokalny model został uruchomiony, ale zabrakło pamięci RAM/VRAM podczas inferencji. Zmniejsz kontekst albo wybierz profil CPU/mniejszy model. Kod: LOCAL_MODEL_RESOURCE_EXHAUSTED";
    case "LOCAL_MODEL_INFERENCE_FAILED":
      return "Połączenie z lokalnym llama.cpp zostało wcześniej potwierdzone przez health-check, ale sama generacja odpowiedzi nie zakończyła się poprawnie. Kod: LOCAL_MODEL_INFERENCE_FAILED";
    default:
      return `Lokalny model nie mógł wykonać odpowiedzi.${reason ? ` Kod: ${reason}` : ""}`;
  }
}

export function providerFailureMessage(
  provider: PrimaryModelSource,
  reason?: string,
  description?: string
): string {
  const name =
    provider.startsWith("anthropic")
      ? "Claude"
      : provider.startsWith("xai")
        ? "Grok"
        : provider.startsWith("google")
          ? "Gemini"
          : "ChatGPT/Codex";
  const client =
    provider.startsWith("anthropic")
      ? "Claude Code"
      : provider.startsWith("xai")
        ? "Grok Build"
        : provider.startsWith("google")
          ? "Gemini CLI"
          : "Codex";
  const base = (() => {
    switch (reason) {
      case "ACCOUNT_SESSION_PLAN_UNSUPPORTED":
        return provider.startsWith("google")
          ? "Google nie obsługuje już Gemini CLI w bezpłatnym planie konta Google („Gemini Code Assist for individuals”) — ponowne logowanie nie pomoże. Użyj „Google Gemini · API” z kluczem z Google AI Studio (Ustawienia → Modele i AI) albo konta z płatnym planem."
          : `${name} odrzuca plan Twojego konta dla klienta ${client}; ponowne logowanie nie pomoże. Użyj połączenia przez klucz API albo konta z planem obsługującym ten klient.`;
      case "ACCOUNT_SESSION_MODEL_UNSUPPORTED":
        return `${name} odrzucił model domyślny dla tej sesji. Zaktualizuj aplikację i ponów połączenie konta.`;
      case "ACCOUNT_SESSION_AUTH_EXPIRED":
      case "ACCOUNT_SESSION_NOT_SUBSCRIPTION_AUTH":
        return `Sesja ${name} wygasła albo została odrzucona. Otwórz Ustawienia → Modele i AI i ponownie połącz konto.`;
      case "ACCOUNT_SESSION_CAPACITY":
        return `${name} odrzuca wykonanie z powodu limitu zapytań lub dostępności konta (Lex Machina ponowiła je już po odczekaniu). Pytanie prawne to kilka uruchomień modelu (odczyt skilli, weryfikacja przepisów), więc limit konta wyczerpuje się szybciej niż w zwykłej rozmowie. Odczekaj kilka minut albo wybierz inny model lub połączenie przez klucz API.`;
      case "ACCOUNT_SESSION_PROMPT_REJECTED":
        return `${name} odrzucił bieżące żądanie po stronie usługi.`;
      case "ACCOUNT_SESSION_CLI_INCOMPATIBLE":
        return `Klient ${client} jest niezgodny z kontraktem Lex Machina. Lex Machina używa przypiętej wersji prywatnego klienta; ponów połączenie konta.`;
      case "ACCOUNT_SESSION_CLI_SPAWN_FAILED":
        return `Nie udało się uruchomić klienta ${client}. Ponów połączenie konta w Ustawieniach, aby Lex Machina przygotowała przypiętą wersję klienta.`;
      case "ACCOUNT_SESSION_CLI_STALLED":
        return `Klient ${client} nie rozpoczął pracy w ciągu 120 s (brak żadnej odpowiedzi procesu).`;
      case "ACCOUNT_SESSION_COMMAND_TIMEOUT":
        return `Klient ${client} przekroczył limit czasu wykonania.`;
      case "ACCOUNT_SESSION_EMPTY_RESPONSE":
        return `${name} zakończył wykonanie bez treści odpowiedzi${provider.startsWith("anthropic") ? "" : " także po jednym ponowieniu z prośbą o tekst"}. Zwykle oznacza to, że model zużył limit odpowiedzi na rozumowanie nad długim kontekstem; „reasoning_out” w szczegółach pokazuje, ile. Ponów wiadomość albo zawęź pytanie lub kontekst sprawy.`;
      case "ACCOUNT_SESSION_CLI_FAILED":
        return `Klient ${client} zakończył wykonanie błędem.`;
      default:
        return `${name} odrzucił lub przerwał wykonanie.`;
    }
  })();
  const code =
    reason
      ? ` Kod: ${reason}.`
      : "";
  const detail =
    description?.trim()
      ? ` Szczegóły: ${description.trim().slice(0, 600)}`
      : "";
  return `${base}${code}${detail}`;
}

export function newExecutionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return Array.from(
    { length: 32 },
    () => Math.floor(Math.random() * 16).toString(16)
  ).join("");
}

/**
 * Polls the runtime for the live draft of a running execution. Returns a
 * stop function; the draft is cleared when polling stops.
 */
export const DRAFT_POLL_MS = 250;

export function startDraftPolling(
  executionId: string,
  onDraft: (text: string) => void,
  // The runtime's progress route is local and cheap; a second between polls showed the
  // model's text up to a second after it arrived.
  intervalMs = DRAFT_POLL_MS,
  fetchProgress: typeof getSessionProgress = getSessionProgress,
  onSteps?: (steps: ExecutionStepsSnapshot | null) => void
): () => void {
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    void fetchProgress(executionId)
      .then((progress) => {
        if (!stopped && progress?.text) {
          onDraft(progress.text);
        }
        if (!stopped && progress?.steps) {
          onSteps?.(progress.steps);
        }
      })
      .catch(() => {
        // A missed poll is harmless; the final answer still arrives.
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    onDraft("");
    onSteps?.(null);
  };
}

async function openExternalUrl(url: string): Promise<void> {
  if (isDesktopShell()) {
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
      throw new Error("TAURI_INVOKE_UNAVAILABLE");
    }
    await internals.invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

// A conversational answer loads no legal skills; the routing label would
// suggest a legal domain that was never used.
export function routingMeta(
  execution: Pick<
    ExtendedExecution,
    "primarySkill" | "loadedSkills"
  >,
  route: string
): string {
  return execution.loadedSkills?.length === 0
    ? "rozmowa bez skilli prawnych"
    : `routing: ${labelForSkill(execution.primarySkill || route)}`;
}

// Przyczyna blokady wprost: stan, bramki i zdarzenia BLOCKED z kodem.
export function blockedReasonText(
  execution: Pick<
    ExtendedExecution,
    "status" | "answer" | "audit" | "workflow" | "gateI" | "finalization"
  > & { blockedReferences?: ExtendedExecution["blockedReferences"] }
): string {
  const references = (execution.blockedReferences ?? []).slice(0, 12);
  const lines = [
    `status=${execution.status}; finalization=${execution.finalization}; audit=${execution.audit?.result ?? "?"}; answer=${execution.answer ? "present" : "missing"}` +
      (execution.workflow ? `; workflow=${execution.workflow.id}:${execution.workflow.result}` : "") +
      (execution.gateI ? `; gateI=${execution.gateI.result}` : ""),
    ...(execution.audit?.missing?.length ? [`audit.missing: ${execution.audit.missing.join(", ")}`] : []),
    ...(execution.audit?.violations?.length ? [`audit.violations: ${execution.audit.violations.join(", ")}`] : []),
    ...(execution.workflow?.missingResources.length
      ? [`workflow.missingResources: ${execution.workflow.missingResources.join(", ")}`]
      : []),
    ...(references.length
      ? [`odwołania zablokowane przez G8: ${references.map((item) => `${item.claim} (${item.status}, wiersz ${item.line})`).join("; ")}`]
      : []),
    ...(execution.audit?.blockedEvents ?? []).map((event) => `blokada: ${event}`)
  ];
  return `\n\nPrzyczyna:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

function executionMessage(
  execution: ExtendedExecution,
  route: string
): CaseChatMessage {
  if (
    execution.status === "DRAFT_PRESENTABLE" &&
    execution.answer
  ) {
    const skillMeta = execution.executionSkills?.length
      ? ` · skille: ${execution.executionSkills.map(labelForSkill).join(", ")}`
      : "";
    const domainMeta = execution.domainSkills?.length
      ? ` · domeny: ${execution.domainSkills.map(labelForSkill).join(", ")}`
      : "";
    const contextMeta =
      execution.context?.modelContextTokens
        ? ` · runtime ${execution.context.modelContextTokens.toLocaleString("pl-PL")} tok. · dokumenty ~${execution.context.estimatedDocumentTokens.toLocaleString("pl-PL")} tok.${execution.context.omittedChunks > 0 ? ` · pominięte chunki: ${execution.context.omittedChunks}` : ""}`
        : execution.context
          ? ` · dokumenty ~${execution.context.estimatedDocumentTokens.toLocaleString("pl-PL")} tok.`
          : "";
    // Instruction text of the turn (measure for moving skill procedure into the app).
    const instructionMeta = execution.context?.instructionChars
      ? ` · instrukcje ~${Math.round(execution.context.instructionChars / (execution.context.charsPerTokenEstimate || 3.5)).toLocaleString("pl-PL")} tok.`
      : "";
    const citationMeta =
      execution.documentCitationFreshness
        ? ` · cytaty odświeżone: ${execution.documentCitationFreshness.checked}`
        : "";
    const workflowMeta =
      execution.processAuto
        ? ` · AUTO: ${execution.processAuto.steps.length}/${execution.processAuto.maxSteps} kroków · ${execution.processAuto.stopped}`
        : execution.processWorkflow
          ? ` · proces: ${execution.processWorkflow.stage}${execution.processWorkflow.pendingCheckpoint ? ` · czeka: ${execution.processWorkflow.pendingCheckpoint}` : ""}`
          : execution.courtWorkflow
            ? ` · analiza sądowa: ${execution.courtWorkflow.stage}${execution.courtWorkflow.nextCheckpoint ? ` · następny: ${execution.courtWorkflow.nextCheckpoint}` : ""}`
            : "";
    const modelRoutingMeta = ` · model: ${execution.model}`;
    const verificationDegraded =
      execution.finalization !== "PASS" ||
      execution.gateI?.result === "BLOCKED";
    const verificationWarning =
      verificationDegraded
        ? "⚠️ Weryfikacja źródeł lub śladu Gate I nie jest kompletna. Odpowiedź jest prezentowana roboczo i może wymagać potwierdzenia w źródłach.\n\n"
        : "";
    // The chronology was kept as the case's timeline: said under the answer.
    const timelineNote = execution.chronologySaved
      ? "\n\n_Oś czasu zapisana w pamięci sprawy: kolejne prace w tej sprawie (także w nowym wątku) z niej korzystają._"
      : "";
    // The step passed but a tool call was refused on the way: its checkpoint stays open.
    const heldNotice = execution.checkpointHeld
      ? `${checkpointHeldNotice(execution.checkpointHeld.steps)}\n\n`
      : "";

    return {
      id: messageId(),
      role: "assistant",
      content:
        verificationWarning +
        heldNotice +
        execution.answer +
        timelineNote,
      evidence: execution.evidence,
      ...(execution.mandatoryPath ? { mandatoryPath: execution.mandatoryPath } : {}),
      ...(execution.pipelineNext ? { pipelineNext: execution.pipelineNext } : {}),
      ...(execution.answerDocument ? { answerDocument: execution.answerDocument } : {}),
      ...(execution.documentCoverage?.length
        ? { documentCoverage: execution.documentCoverage, ...(execution.documentAnalysis ? { documentAnalysis: true } : {}) }
        : {}),
      ...(execution.corrections?.length ? { corrections: execution.corrections } : {}),
      ...(execution.auxiliarySources?.length
        ? {
            auxiliarySources:
              execution.auxiliarySources
          }
        : {}),
      documentCitations: execution.documentCitations,
      ...(execution.widgets?.length ? { widgets: execution.widgets } : {}),
      ...(execution.sourceVerification ? { sourceVerification: execution.sourceVerification } : {}),
      ...(execution.restorations?.length
        ? {
            restorations:
              shiftMarks(
                execution.restorations,
                verificationWarning.length + heldNotice.length
              )
          }
        : {}),
      meta:
        routingMeta(
          execution,
          route
        ) +
        skillMeta +
        domainMeta +
        contextMeta +
        instructionMeta +
        citationMeta +
        workflowMeta +
        modelRoutingMeta +
        (execution.modeDecision ? ` · tryb ${execution.modeDecision.mode}` : "") +
        (execution.firmTemplateApplied
          ? ` · wzór kancelarii: ${execution.firmTemplateApplied.filename} (domyślny: ${execution.firmTemplateApplied.kind})`
          : "") +
        (execution.mandatoryPath
          ? ` · ścieżka ${execution.mandatoryPath.profile === "PELNY" ? "PEŁNA" : "LEKKA"} ${execution.mandatoryPath.steps.filter((step) => step.status === "MET").length}/${execution.mandatoryPath.steps.filter((step) => step.status === "MET" || step.status === "MISSING").length}`
          : "") +
        ` · VERIFIED ${execution.verification.verified}` +
        ` · SUPPORTED ${execution.verification.supported}` +
        (verificationDegraded
          ? ` · WERYFIKACJA NIEPEŁNA · UNVERIFIED ${execution.verification.unverified}`
          : "")
    };
  }

  return {
    id: messageId(),
    role: "system",
    content:
      "Nie udało się zaprezentować odpowiedzi z powodu blokady wykonania lub wymaganego workflow. Sama niepełna weryfikacja źródeł nie blokuje już odpowiedzi." +
      blockedReasonText(execution),
    evidence: execution.evidence,
    ...(execution.auxiliarySources?.length
      ? {
          auxiliarySources:
            execution.auxiliarySources
        }
      : {}),
    meta:
      `routing: ${labelForSkill(execution.primarySkill || route)}` +
      ` · finalization ${execution.finalization}` +
      ` · UNVERIFIED ${execution.verification.unverified}`
  };
}

// Adres ze znacznika VER → weryfikowany przepis (z kotwicą strony, jak w znaczniku).
function verifiedSources(evidence: EvidenceItem[]): SourceClaim[] {
  return evidence.flatMap((item) => {
    const urls = [item.sourceAnchorUrl, item.sourceUrl].filter((url): url is string => Boolean(url));
    return [...new Set(urls)].map((url) => ({ claim: item.claim, url }));
  });
}

// Login failures in words; an unknown code is shown with its identifier for support.
function accountLoginFailureText(code: string): string {
  switch (code) {
    case "ACCOUNT_SESSION_SUBSCRIPTION_LOGIN_REQUIRED":
      return "Claude Code nie potwierdził aktywnego logowania do subskrypcji Claude. Program używa wyłącznie sesji Claude.ai/Pro/Max i nie przełącza tego kanału na rozliczane API.";
    case "ACCOUNT_SESSION_CLI_NOT_INSTALLED":
      return "Nie udało się przygotować oficjalnego klienta tego dostawcy. Spróbuj ponownie albo przełącz źródło na API.";
    case "ACCOUNT_SESSION_LOGIN_FAILED":
      return "Klient dostawcy nie potwierdził logowania (okno zamknięte przed końcem albo upłynął czas). Kliknij „Połącz konto” i dokończ logowanie w oknie klienta.";
    case "ACCOUNT_SESSION_CLI_INCOMPATIBLE":
      return "Zainstalowana wersja klienta dostawcy nie jest obsługiwana. Usuń ją albo przełącz źródło na API.";
    case "ACCOUNT_SESSION_AUTH_EXPIRED":
      return "Sesja klienta dostawcy wygasła. Zaloguj się ponownie.";
    default:
      return `Logowanie nie powiodło się (kod: ${code}).`;
  }
}

const EXPORT_REFERENCE_STATUS: Record<string, string> = {
  UNVERIFIED_MARKED: "niezweryfikowany w źródle",
  UNVERIFIED_NOT_MARKED: "niezweryfikowany",
  MISSING_LEDGER_RECORD: "bez weryfikacji",
  MISSING_VERIFICATION_MARKER: "niespójny ślad weryfikacji",
  VERIFICATION_MARKER_MISMATCH: "niespójny ślad weryfikacji"
};

/** What to check in a generated file before using it (empty when nothing). */
export function documentWarningsText(warnings: string[] | undefined): string {
  return warnings?.length ? ` Sprawdź przed użyciem: ${warnings.join("; ")}.` : "";
}

// Whether the firm's letterhead (header, footer, page setup of its DOCX template) is in the file.
export function letterheadText(letterhead: GeneratedDocumentResponse["letterhead"]): string {
  if (!letterhead) return "";
  return letterhead.applied
    ? ` Pismo wstawione do wzoru kancelarii (nagłówek: ${letterhead.headers}, stopka: ${letterhead.footers}, grafiki: ${letterhead.images}; marginesy ze wzoru).`
    : ` Wzoru kancelarii nie wstawiono do pliku (${letterhead.reason}); plik ma układ Lex.`;
}

type PipelineNext = NonNullable<ExtendedExecution["pipelineNext"]>;

/** The message the app sends for a chosen option: the stage alone, without a new analysis. */
// The file of the result itself, by its kind: directDocumentRequest reads the kind from these
// words, and the server makes it through that skill's pipeline (pleading: W1–W3; contract:
// AU-HYBRID and AU-STRIP), with HYBRID-VAL before the file.
const OWN_DOCUMENT_NOUN: Record<string, string> = {
  "pisma-procesowe-v3": "pismo procesowe",
  "analizator-umow-v1": "umowę",
  "pisma-proste-v2": "pismo"
};

export function pipelineChoiceMessage(choice: { skill: string; kind: "DOCUMENT" | "ANALYSIS" | "CONTINUE"; own?: true; reason?: string }): string {
  // A long letter in parts: the next part, or the same part again with its problems.
  const part = choice.kind === "CONTINUE" ? /^(Popraw )?część (\d{1,2}) z (\d{1,2})/iu.exec(choice.reason ?? "") : null;
  if (part) return part[1] ? `Popraw część ${part[2]} z ${part[3]}.` : `Kontynuuj: napisz część ${part[2]} z ${part[3]}.`;
  if (choice.kind === "CONTINUE") {
    return "Kontynuuj: wykonaj teraz zapowiedzianą weryfikację przepisów w źródłach (ELI) i podaj pełną odpowiedź na pismo, bez zapowiadania kolejnych kroków.";
  }
  if (choice.own) {
    return `Wygeneruj ${OWN_DOCUMENT_NOUN[choice.skill] ?? "dokument"} w pliku .docx z powyższego wyniku, bez zmian merytorycznych.`;
  }
  return choice.kind === "DOCUMENT"
    ? `${PIPELINE_HANDOFF} ${choice.skill}. Wynik powyżej jest zadowalający: przygotuj dokument na jego podstawie, bez ponownej analizy i bez nowych wątków.`
    : `${PIPELINE_HANDOFF} ${choice.skill}. Kontynuuj na podstawie powyższego wyniku, tylko w zakresie tego etapu.`;
}

type StepSummary = NonNullable<NonNullable<PipelineNext["choices"]>[number]["steps"]>;

/** The pipeline's steps before a file: done, skipped and why, still open (in words). */
export function stepSummaryText(steps: StepSummary): string {
  const skipped = steps.skipped.map((entry) => `${entry.checkpoint} (${entry.reason ?? "bez podanego powodu"})`);
  return [
    `Kroki pisma: wykonane ${steps.done} z ${steps.total}`,
    skipped.length ? `pominięte: ${skipped.join("; ")}` : "",
    steps.open.length ? `otwarte: ${steps.open.join(", ")}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A file over open or unexplained steps is only a draft (ZAKAZ-14: DRAFT — NIEWERYFIKOWANY). */
export function documentChoiceLabel(steps: StepSummary | undefined): string {
  return steps && (steps.open.length || steps.skipped.some((entry) => !entry.reason)) ? "Generuj projekt (DRAFT)" : "Generuj dokument";
}

/**
 * After a result: generate the document when it is satisfactory, or one further stage of
 * analysis. Nothing starts on its own, so the conversation does not drift into side issues.
 */
export function PipelineChoices({
  developer = true,
  next,
  auto,
  disabled,
  onChoose,
  onDocument,
  onLongDocument
}: {
  // Off: skills by what they do, no validation names.
  developer?: boolean;
  next: PipelineNext;
  auto: boolean;
  disabled: boolean;
  onChoose: (text: string) => void;
  // The answer is itself a ready letter: the file is made from it, no new session.
  onDocument?: () => void;
  // A long letter written in parts: one file of all its checked parts.
  onLongDocument?: (longDocumentId: string) => void;
}) {
  const choices: NonNullable<PipelineNext["choices"]> = next.choices?.length
    ? next.choices
    : [{ skill: next.skill, kind: /^pisma-/.test(next.skill) ? "DOCUMENT" : "ANALYSIS", reason: next.reason }];
  const longFile = choices.find((choice) => choice.kind === "DOCUMENT" && choice.longDocumentId);
  if (longFile?.longDocumentId && onLongDocument) {
    const id = longFile.longDocumentId;
    return (
      <div className="chat-pipeline-next" role="note">
        <button type="button" className="primary-button" disabled={disabled} onClick={() => onLongDocument(id)}>
          Generuj dokument
        </button>
        <InfoTip>
          {developer
            ? `Pismo powstało w częściach, każda sprawdzona z planem (numeracja, sekcje, załączniki). Plik .docx powstaje z całości (${longFile.reason}) po walidacji HYBRID-VAL.`
            : "Pismo powstało w częściach, każda sprawdzona z planem (numeracja, sekcje, załączniki). Plik .docx powstaje z całości po końcowej kontroli."}
        </InfoTip>
      </div>
    );
  }
  const ownDocument = choices.find((choice) => choice.own);
  const resume = choices.find((choice) => choice.kind === "CONTINUE");
  const resumesPart = Boolean(resume && /część \d{1,2} z \d{1,2}/iu.test(resume.reason));
  if (!auto && resume) {
    return (
      <div className="chat-pipeline-next" role="note">
        <button type="button" className="primary-button" disabled={disabled} onClick={() => onChoose(pipelineChoiceMessage(resume))}>
          Kontynuuj
        </button>
        <InfoTip>
          {resumesPart
            ? `Długie pismo powstaje w częściach (${resume.reason}). „Kontynuuj” prosi o tę część; aplikacja sprawdza ją z planem i poprzednimi częściami.`
            : "Odpowiedź zapowiada krok (np. weryfikację przepisów), którego jeszcze nie wykonała. „Kontynuuj” go uruchamia."}
        </InfoTip>
      </div>
    );
  }
  if (!auto) {
    // A mechanical thread stays with its skill; the file of its own result is still at hand.
    const others = choices.filter((choice) => !choice.own);
    return (
      <div className="chat-pipeline-next" role="note">
        {ownDocument ? (
          <button type="button" className="primary-button" disabled={disabled} onClick={() => onChoose(pipelineChoiceMessage(ownDocument))}>
            {documentChoiceLabel(ownDocument.steps)}
          </button>
        ) : null}
        {ownDocument?.steps ? <small className="field-help">{plainStepLabel(stepSummaryText(ownDocument.steps), developer)}</small> : null}
        {others.length ? (
          <span>
            Dalej możliwe: {others.map((choice) => skillLabel(choice.skill, developer)).join(", ")}.
            <InfoTip>
              {developer
                ? "Ten wątek jest przypięty do swojego skilla. Inny skill wybierzesz w nowym wątku tej sprawy; pamięć sprawy przejdzie razem z nim."
                : "Ten wątek jest przypięty do swojego rodzaju pracy. Inną pracę wybierzesz w nowym wątku tej sprawy; pamięć sprawy przejdzie razem z nim."}
            </InfoTip>
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className="chat-pipeline-next" role="group" aria-label="Co dalej">
      <span>
        Co dalej? Wybierz jedną opcję; nic nie uruchomi się bez Twojej decyzji.
        {choices.some((choice) => choice.kind === "DOCUMENT") ? (
          <InfoTip>
            {!developer
              ? "„Generuj dokument” tworzy plik .docx z tego wyniku po końcowej kontroli pisma."
              : ownDocument
              ? "„Generuj dokument” tworzy plik z tego wyniku po walidacji HYBRID-VAL."
              : onDocument
                ? "„Generuj dokument” tworzy plik .docx z pisma powyżej (format kancelaryjny, pola do uzupełnienia) po walidacji HYBRID-VAL."
                : `„Generuj dokument” tworzy plik po walidacji HYBRID-VAL (${choices.find((choice) => choice.kind === "DOCUMENT")!.skill}).`}
          </InfoTip>
        ) : null}
      </span>
      <div className="chat-pipeline-choices">
        {choices.map((choice) => (
          <button
            key={`${choice.kind}-${choice.skill}`}
            type="button"
            className={choice.kind === "DOCUMENT" || choice.kind === "CONTINUE" ? "primary-button" : "chat-secondary-action"}
            disabled={disabled}
            title={developer ? `${choice.skill} (${choice.reason})` : choice.reason}
            onClick={() =>
              choice.kind === "DOCUMENT" && !choice.own && onDocument ? onDocument() : onChoose(pipelineChoiceMessage(choice))
            }
          >
            {choice.kind === "CONTINUE"
              ? "Kontynuuj"
              : choice.kind === "DOCUMENT"
                ? documentChoiceLabel(choice.steps)
                : `Dalsza analiza: ${skillLabel(choice.skill, developer)}`}
          </button>
        ))}
      </div>
      {ownDocument?.steps ? <small className="field-help">{plainStepLabel(stepSummaryText(ownDocument.steps), developer)}</small> : null}
    </div>
  );
}

/** A workflow step whose checkpoint was not closed: which refused steps, and what to do. */
export function checkpointHeldNotice(steps: string[]): string {
  return `Etap nie został zamknięty: w tej turze odmówiono kroku (${steps.join("; ")}). Odpowiedź poniżej jest robocza; powtórz etap, aby zamknąć go z pełnym śladem audytu.`;
}

// HYBRID-VAL (document-generation-validation.ts) before the .docx, in words.
const HYBRID_REASON: Record<string, string> = {
  EMPTY_DOCUMENT: "dokument jest pusty",
  OPEN_PLACEHOLDER: "zostały niewypełnione pola ([UZUPEŁNIJ] lub ⬛)",
  DRAFT_UNVERIFIED: "dokument ma oznaczenie DRAFT — NIEWERYFIKOWANY",
  PRIVACY_TOKEN_REMAINS: "zostały symbole anonimizacji",
  CONTROL_CHARACTER: "tekst zawiera znaki sterujące",
  SOURCE_SESSION_BLOCKED_EVENT: "w rozmowie, z której powstaje dokument, był zablokowany krok",
  SOURCE_DOCUMENT_AUDIT_MISSING: "brak śladu odczytu dokumentu źródłowego sprawy"
};

/** A refused export in words: which provisions or judgments stopped the file. */
export function exportBlockedMessage(error: unknown): string | null {
  // A letter the model's answer cut short: no file of a shortened letter.
  if (error instanceof ApiError && /^(?:LETTER_MARKUP_TRUNCATED|DOCUMENT_OUTPUT_TRUNCATED)$/.test(error.code)) {
    return "Plik nie został zapisany: pismo urywa się przed końcem (odpowiedź modelu ucięta na limicie długości). Długie pismo powstanie w częściach: poproś o nie ponownie albo kliknij Kontynuuj przy ostatniej części.";
  }
  if (error instanceof ApiError && /^(?:READY|FINAL|TOKENIZED)_DOCUMENT_HYBRID_BLOCKED:/.test(error.code)) {
    const reasons = error.code.split(":")[1]!.split(",").filter(Boolean);
    return `Dokument nie został zapisany: walidacja HYBRID-VAL przed plikiem wykazała, że ${reasons
      .map((reason) => HYBRID_REASON[reason] ?? reason)
      .join("; ")}. Popraw treść w rozmowie i wygeneruj dokument ponownie.`;
  }
  if (error instanceof ApiError && /^TOKENIZED_DOCUMENT_VALIDATION_FAILED/.test(error.code)) {
    const reason = error.code.split(":").slice(1).join(":");
    return `Plik nie został zapisany: ${
      reason === "EMPTY_DOCUMENT"
        ? "z odpowiedzi nie powstała treść pisma (sama odpowiedź nie zawiera pisma: najpierw poproś o jego treść)"
        : reason === "RENDERED_TEXT_MISMATCH"
          ? "tekst zapisanego pliku różni się od przygotowanej treści (kontrola zgodności pliku)"
          : reason.startsWith("ALIAS_MISSING")
            ? "w pliku zabrakło symboli danych osobowych z dokumentów sprawy (kontrola anonimizacji)"
            : "kontrola zgodności pliku nie przeszła"
    }. Spróbuj ponownie; jeśli się powtórzy, zgłoś kod: ${error.code}.`;
  }
  if (!(error instanceof ApiError) || !/^(?:READY|FINAL)_DOCUMENT_EXPORT_GATE_BLOCKED/.test(error.code)) return null;
  const references = error.references ?? [];
  const listed = references
    .slice(0, 12)
    .map((reference) => `${reference.claim} (${EXPORT_REFERENCE_STATUS[reference.status] ?? "orzeczenie: cytat lub teza niepotwierdzone"})`);
  const more = references.length > listed.length ? ` i ${references.length - listed.length} innych` : "";
  return listed.length
    ? `Pismo nie zostało zapisane: powołania bez potwierdzenia w źródle: ${listed.join("; ")}${more}.` +
        (error.draftAvailable ? " Możesz zapisać je jako projekt z tymi powołaniami wskazanymi w nagłówku." : " Popraw lub usuń te powołania i spróbuj ponownie.")
    : `Pismo nie zostało zapisane: bramka eksportu (${error.code}).`;
}

export default function MatterChatApp({
  user,
  serverMode = false,
  settingsPanels,
  settingsRequest,
  onLock,
  onLogout
}: {
  user: AuthenticatedUser;
  serverMode?: boolean;
  settingsPanels?: SettingsPanels;
  settingsRequest?: SettingsRequest | null;
  onLock?: () => void;
  onLogout?: () => void;
}) {
  // Tryb serwerowy: kanał API (bez kont przez klienta CLI); model lokalny tylko wtedy, gdy
  // serwer go ma (llama.cpp na serwerze albo LEX_LOCAL_LLM_ENDPOINT). null: jeszcze nie wiadomo.
  const [serverLocalModel, setServerLocalModel] = useState<boolean | null>(null);
  useEffect(() => {
    if (!serverMode) return;
    let cancelled = false;
    getLocalModels()
      .then((response) => {
        if (!cancelled) setServerLocalModel(response.models.some((item) => item.installed));
      })
      .catch(() => {
        if (!cancelled) setServerLocalModel(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverMode]);
  const providerGroups = serverMode && serverLocalModel !== true
    ? PROVIDER_GROUPS.filter((item) => item.id !== "local")
    : PROVIDER_GROUPS;
  const [activeTab, setActiveTab] = useState<TabId>("home");
  // Bumped when events change anywhere, so the home screen, the calendar and
  // the case schedule show the same data.
  const [scheduleRefresh, setScheduleRefresh] = useState(0);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("models");
  // Developer mode: journal, skills, gates, codes and traces; off for a lawyer's view.
  // Tryb dewelopera tylko dla administratora; konto użytkownika zawsze w widoku dla prawnika.
  const developerAllowed = user.appRole === "ADMIN";
  const [developerModeStored, setDeveloperModeState] = useState(() => loadDeveloperMode(user.userId));
  const developerMode = developerAllowed && developerModeStored;
  useEffect(() => {
    setDeveloperModeState(loadDeveloperMode(user.userId));
  }, [user.userId]);
  function setDeveloperMode(enabled: boolean): void {
    setDeveloperModeState(enabled);
    saveDeveloperMode(user.userId, enabled);
  }
  const [runtimeOnline, setRuntimeOnline] = useState(false);
  const [runtimeError, setRuntimeError] = useState("");

  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [caseId, setCaseId] = useState("");
  const [caseSearch, setCaseSearch] = useState("");
  const [caseStatusFilter, setCaseStatusFilter] =
    useState<MatterStatusFilter>("ALL");
  const [caseRoleFilter, setCaseRoleFilter] =
    useState<MatterRoleFilter>("ALL");
  const [caseSort, setCaseSort] =
    useState<MatterSort>("UPDATED_DESC");
  const [newCaseName, setNewCaseName] = useState("");
  const [caseNameDraft, setCaseNameDraft] = useState("");
  const [caseBusy, setCaseBusy] = useState(false);
  const [caseError, setCaseError] = useState("");
  // Szybka zmiana nazwy sprawy w panelu bocznym.
  const [sidebarRename, setSidebarRename] =
    useState<{ caseId: string; value: string; error: string } | null>(null);
  const [caseSchedule, setCaseSchedule] =
    useState<CaseScheduleEvent[]>([]);
  const [caseScheduleLoading, setCaseScheduleLoading] =
    useState(false);
  const [caseScheduleBusy, setCaseScheduleBusy] =
    useState(false);
  const [caseScheduleError, setCaseScheduleError] =
    useState("");
  const [scheduleKind, setScheduleKind] =
    useState<CaseScheduleKind>("CLIENT_MEETING");
  const [scheduleTitle, setScheduleTitle] =
    useState("");
  const [scheduleStartsAt, setScheduleStartsAt] =
    useState("");
  const [scheduleLocation, setScheduleLocation] =
    useState("");
  const [scheduleNotes, setScheduleNotes] =
    useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0);
  const [memoryRefresh, setMemoryRefresh] = useState(0);
  // Evidence item whose provision preview is open ("<messageId>:<index>").
  const [provisionPreview, setProvisionPreview] = useState<string | null>(null);
  // Current names of documents made by a model (renamed in the case files or
  // in the chat card); the thread keeps the name given at generation.
  const [artifactNames, setArtifactNames] =
    useState<Record<string, string>>({});
  const [caseFiles, setCaseFiles] =
    useState<StoredUploadResponse[]>([]);
  const [pickerAnonymizing, setPickerAnonymizing] = useState<string | null>(null);
  // Load state of the list (failed is unknown, not empty), manual/automatic reloads,
  // automatic retries done since the last success, and processing errors per upload.
  const [caseFilesLoad, setCaseFilesLoad] = useState<CaseFileListLoad | null>(null);
  const [caseFilesReload, setCaseFilesReload] = useState(0);
  const [caseFilesRetries, setCaseFilesRetries] = useState(0);
  const [caseFileErrors, setCaseFileErrors] = useState<Record<string, string>>({});
  // A processed document waiting for the user's confirmation in its preview.
  const [privacyPreview, setPrivacyPreview] = useState<{
    request: PrivacyPreviewRequest;
    resolve: (result: Awaited<ReturnType<typeof finalizeCaseDocument>> | null) => void;
  } | null>(null);
  const [privacyPreviewBusy, setPrivacyPreviewBusy] = useState(false);
  // A failed confirmation keeps the preview open with the user's marks and says why.
  const [privacyPreviewError, setPrivacyPreviewError] = useState("");
  // Every document is finalized after its preview; null when the user cancels it.
  function previewThenFinalize(
    targetCase: string,
    review: Awaited<ReturnType<typeof processStoredCaseFile>>,
    fileName: string,
    keepClear: boolean
  ): Promise<Awaited<ReturnType<typeof finalizeCaseDocument>> | null> {
    return new Promise((resolve) =>
      setPrivacyPreview({ request: { caseId: targetCase, review, fileName, keepClear }, resolve })
    );
  }
  // Stage and page of documents processed from the chat (staged file id or upload id).
  const [documentProgress, setDocumentProgress] = useState<Record<string, ProcessingProgress>>({});
  // Runs one document request with its progress shown under `key`.
  async function withDocumentProgress<T>(key: string, targetCase: string, run: (progressId: string) => Promise<T>): Promise<T> {
    const tracker = trackProgress(targetCase, (progress) => setDocumentProgress((current) => ({ ...current, [key]: progress })));
    try {
      return await run(tracker.progressId);
    } finally {
      tracker.stop();
      setDocumentProgress((current) => {
        const { [key]: _done, ...rest } = current;
        return rest;
      });
    }
  }
  const [caseFilePickerOpen, setCaseFilePickerOpen] =
    useState(false);
  const [generatedDocumentMessage, setGeneratedDocumentMessage] =
    useState("");
  const [pendingFinalDocument, setPendingFinalDocument] =
    useState<{
      caseId: string;
      artifactId: string;
      format: LegalDocumentFormat;
    } | null>(null);
  const [finalDocumentBusy, setFinalDocumentBusy] =
    useState(false);
  const [finalReview, setFinalReview] =
    useState<{
      grantId: string;
      preview: DeanonymizationPreview;
      overrides: Record<string, string>;
    } | null>(null);
  // A review belongs to one generated document.
  useEffect(() => {
    setFinalReview(null);
  }, [pendingFinalDocument?.artifactId]);

  // The source and model the user last worked with become the default.
  const [rememberedModel] = useState(() => loadLastUsedModel(user.userId));
  const [provider, setProvider] =
    useState<PrimaryModelSource>(rememberedModel?.provider ?? "local");
  // The connection (account or API key) the user chose per provider, remembered on this device.
  const [providerChannels, setProviderChannels] = useState<Partial<Record<ProviderGroup, "account" | "api">>>(() =>
    loadProviderChannels(user.userId)
  );
  function rememberChannel(group: ProviderGroup, channel: "account" | "api"): void {
    setProviderChannels((current) => {
      const next = { ...current, [group]: channel };
      saveProviderChannels(user.userId, next);
      return next;
    });
  }
  function sourceOfGroup(group: ProviderGroup): PrimaryModelSource {
    if (serverMode && group === "local" && serverLocalModel === true) return "local";
    if (serverMode) return runtimeProviderForPrimarySource(group === "local" ? "openai" : sourceForGroup(group, "api"));
    if (group === "local") return "local";
    return preferredSourceForGroup(group, providerChannels[group], {
      accountConnected: providerAccounts[group]?.authenticated === true,
      apiConfigured: providerConfiguration[group] === true
    });
  }
  // Tryb serwerowy: źródło konta (CLI) albo lokalne bez modelu na serwerze przechodzi na kanał API dostawcy.
  useEffect(() => {
    if (serverMode && ((provider === "local" && serverLocalModel === false) || isAccountPrimarySource(provider))) {
      setProvider(runtimeProviderForPrimarySource(provider));
    }
  }, [serverMode, provider, serverLocalModel]);
  const [providerConfiguration, setProviderConfiguration] = useState<
    Record<ProviderId, boolean | undefined>
  >({ openai: undefined, anthropic: undefined, xai: undefined, google: undefined });
  const [providerAccounts, setProviderAccounts] = useState<
    Record<
      ProviderId,
      ProviderAccountSessionStatus | undefined
    >
  >({
    openai: undefined,
    anthropic: undefined,
    xai: undefined,
    google: undefined
  });
  const [providerAccountBusy, setProviderAccountBusy] =
    useState(false);
  const [localStartBusy, setLocalStartBusy] =
    useState(false);
  const [localStartMessage, setLocalStartMessage] =
    useState("");
  const [accountConnectPhase, setAccountConnectPhase] =
    useState<AccountConnectPhase | null>(null);
  const [providerAccountMessage, setProviderAccountMessage] =
    useState("");
  const [claudeOAuthToken, setClaudeOAuthTokenInput] =
    useState("");
  const [claudeOAuthBusy, setClaudeOAuthBusy] =
    useState(false);
  const [claudeOAuthMessage, setClaudeOAuthMessage] =
    useState("");
  const [providerApiKey, setProviderApiKeyInput] = useState("");
  const [providerKeyBusy, setProviderKeyBusy] = useState(false);
  const [providerKeyMessage, setProviderKeyMessage] = useState("");
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [model, setModel] = useState(rememberedModel?.model ?? "");
  const localAutoStartTried = useRef(false);
  const [modelError, setModelError] = useState("");
  // The chosen model disappeared from its source and another one was picked: said, not silent.
  const [modelNotice, setModelNotice] = useState("");
  const [
    modelCatalogLoading,
    setModelCatalogLoading
  ] = useState(false);
  const [
    localModelsRefreshToken,
    setLocalModelsRefreshToken
  ] = useState(0);
  const [
    localRuntimeStatus,
    setLocalRuntimeStatus
  ] = useState<
    LocalModelsResponse["runtime"] | null
  >(null);

  const [routes, setRoutes] = useState<string[]>([]);
  const [skills, setSkills] = useState<PublicSkillDescriptor[]>(
    FALLBACK_EXECUTION_SKILLS
  );
  // null = every optional execution skill is selected. This mirrors the DR
  // domain selector and makes newly discovered execution skills selected by
  // default without a second initialization race.
  const [manualSkills, setManualSkills] =
    useState<string[] | null>(null);
  const [
    deterministicAction,
    setDeterministicAction
  ] = useState<DeterministicActionId | "">("");
  const [
    workMode,
    setWorkMode
  ] = useState<ChatWorkMode>("AUTO");
  const [caseTypeSkills, setCaseTypeSkills] = useState<string[]>([]);
  // null = every DR module is selected. Kept as null rather than a filled list
  // so the default sends no restriction at all and routing stays unchanged
  // until the user actually narrows it.
  const [allowedDomains, setAllowedDomains] =
    useState<string[] | null>(null);
  const [automaticSkills, setAutomaticSkills] = useState(true);
  const [skillFilter, setSkillFilter] = useState("");

  const [query, setQuery] = useState("");
  const [pendingFirstMessage, setPendingFirstMessage] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  // The case whose answer is being generated: the thread list stays on it
  // until the answer lands (a late message must not reach another case).
  const [executingCaseId, setExecutingCaseId] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState("");
  // CONTRACT_STATE_REQUIRED: the message waits for the contract mode; resent after it is chosen.
  const [contractModeRequest, setContractModeRequest] = useState<{
    caseId: string; text: string; messageId: string; suggested: ContractAnalysisMode;
  } | null>(null);
  const [contractModeBusy, setContractModeBusy] = useState(false);
  const [contractRetry, setContractRetry] = useState<{ text: string; messageId: string; switchTo?: { action: DeterministicActionId; label: string } } | null>(null);
  // Checkpoint workflows: the next step the chat sends by itself, the closed steps per
  // case (progress check) and the user's "Zatrzymaj".
  const [autoNext, setAutoNext] = useState<{ caseId: string; text: string; meta: string; step: number } | null>(null);
  const workflowClosedRef = useRef<Record<string, number>>({});
  const autoStopRef = useRef(false);
  // Export refused for unverified references only: the user may save a draft naming them.
  const [unverifiedDraftRequest, setUnverifiedDraftRequest] = useState<{
    caseId: string; text: string; messageId: string;
  } | null>(null);
  const [unverifiedDraftRetry, setUnverifiedDraftRetry] = useState<{ text: string; messageId: string } | null>(null);
  // A case workflow stopped the message (pleading pipeline not started, workflow finished):
  // the message waits for the user's choice and is resent through contractRetry.
  // Escalation / reduction between the letter skills offered by the runtime, and a switch being sent.
  const [skillSwitchOffer, setSkillSwitchOffer] = useState<{ caseId: string; offer: SkillSwitchOffer } | null>(null);
  const [pendingSkillSwitch, setPendingSkillSwitch] = useState<{ caseId: string; action: DeterministicActionId; text: string; label: string } | null>(null);
  const [workflowRecoveryRequest, setWorkflowRecoveryRequest] = useState<{
    caseId: string; text: string; messageId: string; recovery: WorkflowRecovery;
    // The failed message switched the thread's letter skill: the retry switches again.
    switchTo?: { action: DeterministicActionId; label: string };
  } | null>(null);
  const [workflowRecoveryBusy, setWorkflowRecoveryBusy] = useState(false);
  const [executionDiagnostic, setExecutionDiagnostic] =
    useState<ExecutionDiagnostic | null>(null);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStepsSnapshot | null>(null);
  const [executionStage, setExecutionStage] =
    useState("Przygotowanie sesji");
  const [draftText, setDraftText] =
    useState("");
  const [executionElapsedSeconds, setExecutionElapsedSeconds] =
    useState(0);
  const [runtimePulse, setRuntimePulse] =
    useState<"CHECKING" | "OK" | "LOST">("CHECKING");
  const [processWorkflowVisible, setProcessWorkflowVisible] =
    useState(false);
  const [processWorkflowRefresh, setProcessWorkflowRefresh] =
    useState(0);
  const {
    messages,
    setMessages,
    updateMessage,
    loading: threadLoading,
    error: threadError
  } = useCaseThread(caseId, WELCOME);

  const [documentAttachments, setDocumentAttachments] = useState<
    DocumentAttachmentSelection[]
  >([]);
  const [firmKnowledgeWorkspace, setFirmKnowledgeWorkspace] =
    useState<CaseListItem | null>(null);
  // Firm templates (DOCX/ODT) picked for the message, sent as text.
  const [firmTemplateIds, setFirmTemplateIds] = useState<string[]>([]);
  const [pickerTab, setPickerTab] = useState<"case" | "firm">("case");
  const [pickerNotice, setPickerNotice] = useState("");
  const [firmPickerReload, setFirmPickerReload] = useState(0);
  const [documentFit, setDocumentFit] = useState<DocumentFitResponse | null>(null);
  // What reached the model with the last message.
  const [lastDelivery, setLastDelivery] = useState<{ documents: DocumentDelivery[]; names: Record<string, string> } | null>(null);
  const [includeCaseKnowledge, setIncludeCaseKnowledge] = useState(false);
  const [includeFirmKnowledge, setIncludeFirmKnowledge] = useState(false);
  // Photos go to image-capable models as evidence; pages with text only on request.
  const [imagesWithText, setImagesWithText] = useState(false);
  // Added files wait for a per-file decision; nothing starts OCR on its own.
  const [documentStaging, setDocumentStaging] = useState(
    createDocumentStagingState
  );
  // Mode of each file handed to the privacy review (anonymization modes).
  const reviewModes = useRef(new WeakMap<File, DocumentProcessingMode>());
  const [documentDropQueue, setDocumentDropQueue] = useState(
    createDocumentDropQueueState
  );
  const [dropActive, setDropActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const activeCaseIdRef =
    useRef(caseId);

  const matterCases = useMemo(
    () => cases.filter((item) => item.caseKind === "MATTER"),
    [cases]
  );
  const matterSearchResult =
    useMemo(
      () =>
        filterMatterCases(
          cases,
          {
            query:
              caseSearch,
            status:
              caseStatusFilter,
            role:
              caseRoleFilter,
            sort:
              caseSort,
            currentCaseId:
              caseId
          }
        ),
      [
        cases,
        caseSearch,
        caseStatusFilter,
        caseRoleFilter,
        caseSort,
        caseId
      ]
    );
  const filteredMatterCases =
    matterSearchResult.items;
  const caseSearchMatchCount =
    matterSearchResult.matchCount;
  const selectedCase = useMemo(
    () => matterCases.find((item) => item.caseId === caseId),
    [matterCases, caseId]
  );
  const runtimeProvider =
    runtimeProviderForPrimarySource(provider);
  const localModelSelected =
    provider === "local" || model.startsWith("local/");
  // History sent with each message: sized to the model window, small for local models.
  const conversationChars =
    localModelSelected
      ? LOCAL_CONVERSATION_CHARS
      : conversationBudgetChars(runtimeProvider, model);
  // Files per message: 20 for a hosted model, 4 for a local one (server decides).
  const documentLimit =
    documentFit?.limit ?? (localModelSelected ? 4 : 20);
  const selectedFileCount =
    documentAttachments.length + firmTemplateIds.length;
  const firmCaseId = firmKnowledgeWorkspace?.caseId;
  const selectedFirmKeys = useMemo(
    () =>
      new Set([
        ...firmTemplateIds,
        ...documentAttachments
          .filter((attachment) => attachment.caseId === firmCaseId)
          .map((attachment) => attachment.documentId)
      ]),
    [firmTemplateIds, documentAttachments, firmCaseId]
  );

  /** Adds or removes picked files; over the limit only what fits is added, with a message. */
  function pickFiles(picks: FilePick[], select: boolean, pickCaseId: string): void {
    if (!select) {
      const keys = new Set(picks.map(pickKey));
      setDocumentAttachments((current) =>
        current.filter((attachment) => !(attachment.caseId === pickCaseId && keys.has(attachment.documentId)))
      );
      setFirmTemplateIds((current) => current.filter((id) => !keys.has(id)));
      setPickerNotice("");
      return;
    }
    const chosen = new Set([...firmTemplateIds, ...documentAttachments.map((attachment) => attachment.documentId)]);
    const fresh = picks.filter((pick) => !chosen.has(pickKey(pick)));
    const taken = fresh.slice(0, Math.max(0, documentLimit - selectedFileCount));
    setPickerNotice(
      taken.length < fresh.length
        ? `Limit ${documentLimit} plików w jednej wiadomości` +
            (localModelSelected ? " dla modelu lokalnego" : "") +
            `: dodano ${taken.length} z ${fresh.length}. Odznacz inne pliki albo wyślij pozostałe w kolejnej wiadomości.`
        : ""
    );
    const documents = taken.flatMap((pick) => (pick.kind === "document" ? [pick] : []));
    const templates = taken.flatMap((pick) => (pick.kind === "template" ? [pick.templateId] : []));
    if (documents.length) {
      setDocumentAttachments((current) =>
        documents.reduce(
          (list, pick) =>
            upsertAttachment(list, { caseId: pickCaseId, documentId: pick.documentId, chunkIndices: pick.chunkIndices }),
          current
        )
      );
    }
    if (templates.length) setFirmTemplateIds((current) => [...current, ...templates]);
  }

  const [firmFileNames, setFirmFileNames] = useState<Record<string, string>>({});
  function fileLabel(documentId: string, title?: string): string {
    return (
      title ??
      caseFiles.find((file) => file.processing?.documentId === documentId)?.filename ??
      firmFileNames[documentId] ??
      "plik"
    );
  }

  // The firm library is known to the chat without visiting the Kancelaria tab.
  useEffect(() => {
    if (firmKnowledgeWorkspace) return;
    let cancelled = false;
    getFirmKnowledgeWorkspace()
      .then((result) => {
        if (!cancelled && result.workspace) setFirmKnowledgeWorkspace(result.workspace);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [firmKnowledgeWorkspace]);

  // Does the pick fit the chosen model? Checked on the server with the same count as sending.
  useEffect(() => {
    if (!model || selectedFileCount === 0) {
      setDocumentFit(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      checkDocumentFit({
        provider: runtimeProvider,
        model,
        attachments: documentAttachments,
        firmTemplates: firmTemplateIds
      })
        .then((result) => {
          if (!cancelled) setDocumentFit(result);
        })
        .catch(() => {
          if (!cancelled) setDocumentFit(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [model, runtimeProvider, documentAttachments, firmTemplateIds, selectedFileCount]);
  const providerDefinition =
    PROVIDERS.find(
      (item) =>
        item.id ===
        runtimeProvider
    );
  const providerConfigured =
    providerConfiguration[runtimeProvider];
  const accountSession =
    providerAccounts[runtimeProvider];
  const accountAuthenticated =
    isAccountPrimarySource(provider) &&
    accountSession?.authenticated === true;
  const selectedModel = models.find((item) => item.id === model);
  const localModelReady =
    provider === "local" &&
    localRuntimeStatus?.state ===
      "READY" &&
    localRuntimeStatus
      .activeModelId === model;
  const localModelStarting =
    provider === "local" &&
    (
      localRuntimeStatus?.state ===
        "STARTING" ||
      localRuntimeStatus?.state ===
        "PROVISIONING"
    );
  const executionSkills = useMemo(
    () => skills
      .filter(isExecutionSkill)
      .sort((a, b) =>
        labelForSkill(a.name).localeCompare(labelForSkill(b.name), "pl")
      ),
    [skills]
  );
  const domainSelection = allowedDomains ?? routes;
  const conversationIsNew = useMemo(
    () =>
      messages.every(
        (message) => message.role === "system"
      ),
    [messages]
  );
  const availableActions = useMemo(
    () =>
      DETERMINISTIC_ACTIONS.filter(
        (action) =>
          action.skills.every(
            (name) =>
              skills.some(
                (skill) =>
                  skill.name === name
              )
          )
      ),
    [skills]
  );
  const selectedDeterministicAction =
    useMemo(
      () =>
        DETERMINISTIC_ACTIONS.find(
          (action) =>
            action.id ===
            deterministicAction
        ) ?? null,
      [deterministicAction]
    );
  const selectableExecutionSkills = useMemo(
    () =>
      executionSkills.filter(
        (item) =>
          !MANDATORY_SKILLS.includes(
            item.name as (typeof MANDATORY_SKILLS)[number]
          ) &&
          item.name !== "prawo-polskie-v2"
      ),
    [executionSkills]
  );
  const manualSkillSelection = useMemo(
    () =>
      manualSkills ??
      selectableExecutionSkills.map(
        (item) => item.name
      ),
    [
      manualSkills,
      selectableExecutionSkills
    ]
  );
  const filteredSkills = useMemo(() => {
    const needle = skillFilter.trim().toLowerCase();
    return selectableExecutionSkills.filter(
      (item) =>
        !needle ||
        item.name.toLowerCase().includes(needle) ||
        item.description?.toLowerCase().includes(needle)
    );
  }, [
    selectableExecutionSkills,
    skillFilter
  ]);
  useEffect(() => {
    setCaseTypeExecutionSkills(caseTypeSkills);
    return () => setCaseTypeExecutionSkills([]);
  }, [caseTypeSkills]);

  useEffect(() => {
    setDeterministicAction("");
    setWorkMode("AUTO");
    setCaseTypeSkills([]);
    setManualSkills(null);
    setAllowedDomains(null);
    setAutomaticSkills(true);
  }, [caseId]);

  useEffect(() => {
    if (threadLoading) {
      return;
    }
    const actionMessage =
      actionMetaMessage(messages);
    if (!actionMessage) {
      return;
    }
    const restored =
      deterministicActionFromMeta(
        actionMessage.meta
      );
    setDeterministicAction(
      restored
    );
    setWorkMode(
      workModeForAction(
        restored
      )
    );
    setCaseTypeSkills(
      skillsForDeterministicAction(
        restored
      )
    );
    setAutomaticSkills(
      restored === ""
    );
  }, [
    messages,
    threadLoading
  ]);

  useEffect(() => {
    const restricted =
      allowedDomains !== null &&
      allowedDomains.length < routes.length;
    setAllowedDomainSkills(
      restricted ? allowedDomains : []
    );
    return () => setAllowedDomainSkills([]);
  }, [allowedDomains, routes.length]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getHealth(),
      getRoutes(),
      getProviderStatus(),
      serverMode ? Promise.resolve({ providers: [] }) : getProviderAccountStatus(),
      listCases()
    ])
      .then(([
        health,
        routeList,
        providerStatus,
        accountStatus,
        caseList
      ]) => {
        if (cancelled) return;
        setRuntimeOnline(health.status === "ok" && health.localOnly === true);
        setRoutes(routeList.primarySkills);
        setCases(caseList.cases);
        const matters = caseList.cases.filter((item) => item.caseKind === "MATTER");
        setCaseId(
          matters.find((item) => !item.archivedAt)?.caseId ??
          matters[0]?.caseId ??
          ""
        );
        setProviderConfiguration(
          Object.fromEntries(
            providerStatus.providers.map((item) => [item.provider, item.configured])
          ) as Record<ProviderId, boolean>
        );
        setProviderAccounts(
          Object.fromEntries(
            accountStatus.providers.map(
              (item) => [
                item.provider,
                item
              ]
            )
          ) as Record<
            ProviderId,
            ProviderAccountSessionStatus
          >
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setRuntimeOnline(false);
        setRuntimeError(error instanceof Error ? error.message : String(error));
      });

    void getSkills()
      .then((payload) => {
        if (
          !cancelled &&
          Array.isArray(payload.skills)
        ) {
          setSkills((current) =>
            mergeSkillCatalog(
              FALLBACK_EXECUTION_SKILLS,
              current,
              payload.skills
            )
          );
        }
      })
      .catch(() => {
        // The built-in execution catalog stays visible even when the runtime
        // skill registry is temporarily unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (routes.length === 0) {
      return;
    }
    setSkills((current) =>
      mergeSkillCatalog(
        FALLBACK_EXECUTION_SKILLS,
        current,
        routes.map((name) => ({
          name,
          category: "domain"
        }))
      )
    );
  }, [routes]);

  useEffect(() => {
    const refreshLocalModels = () => {
      setLocalModelsRefreshToken(
        (value) => value + 1
      );
    };
    window.addEventListener(
      "lex-local-models-changed",
      refreshLocalModels
    );
    return () => {
      window.removeEventListener(
        "lex-local-models-changed",
        refreshLocalModels
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    // Keep the user's explicit model choice while the catalog refreshes.
    // Execution is disabled by modelCatalogLoading, so there is no need to
    // blank the selection and accidentally fall back to the first model.
    setModelError("");
    setModelCatalogLoading(true);

    if (
      isAccountPrimarySource(
        provider
      )
    ) {
      const accountModelId =
        accountModelIdForPrimarySource(
          provider
        );
      if (accountModelId) {
        const authenticated =
          accountSession
            ?.authenticated === true;
        const choices =
          accountModelChoices(
            provider,
            ACCOUNT_MODEL_LABELS[
              runtimeProvider
            ]
          );
        setModels(
          choices.map((choice) => ({
            provider:
              runtimeProvider,
            id: choice.id,
            displayName:
              choice.label,
            selectable:
              authenticated,
            ownedBy:
              "account-session",
            capabilities: [
              "account-session",
              "lex-runtime-tools"
            ]
          }))
        );
        // Keep the chosen account model while the source stays the same.
        setModel((current) =>
          choices.some(
            (choice) =>
              choice.id === current
          )
            ? current
            : accountModelId
        );
        if (
          accountSession &&
          !accountSession.installed
        ) {
          setModelError(
            "ACCOUNT_SESSION_CLI_NOT_INSTALLED"
          );
        } else if (
          !authenticated
        ) {
          setModelError(
            "ACCOUNT_SESSION_NOT_AUTHENTICATED"
          );
        }
      }
      setModelCatalogLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (
      !shouldLoadPrimaryModelCatalog(
        provider,
        providerConfigured
      )
    ) {
      if (
        providerConfigured === false &&
        provider !== "local"
      ) {
        setModelError("PROVIDER_NOT_CONFIGURED");
      }
      setModelCatalogLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const loadModels =
      provider === "local"
        ? getLocalModels().then(
            (response) => {
              if (!cancelled) {
                setLocalRuntimeStatus(
                  response.runtime
                );
              }
              return {
              models:
                response.models
                  .filter(
                    (item) =>
                      item.installed
                  )
                  .map<ModelDescriptor>(
                    (item) => ({
                      provider:
                        "openai",
                      id:
                        item.id,
                      displayName:
                        `Lokalny · ${item.displayName}`,
                      selectable:
                        true,
                      contextWindow:
                        item.configuredContextWindow ??
                        item.contextWindow,
                      nativeContextWindow:
                        item.nativeContextWindow,
                      contextMode:
                        item.contextMode,
                      ownedBy:
                        "local",
                      inputModalities:
                        ["text"],
                      outputModalities:
                        ["text"],
                      capabilities: [
                        "local-only",
                        "offline-inference",
                        item.configuredContextWindow !==
                          undefined
                          ? "qualified-profile"
                          : "installed-profile-recovery"
                      ]
                    })
                  )
              };
            }
          )
        : getModels(
            runtimeProvider
          );

    void loadModels
      .then((response) => {
        if (cancelled) return;
        const sourceModels =
          modelsForPrimarySource(
            provider,
            response.models
          );
        setModels(sourceModels);
        setModel((current) => {
          if (sourceModels.some((item) => item.id === current && item.selectable)) return current;
          const next = sourceModels.find((item) => item.selectable);
          if (current && next) {
            queueMicrotask(() =>
              setModelNotice(`Poprzednio wybrany model jest niedostępny w tym źródle. Wybrano: ${next.displayName}.`)
            );
          }
          return next?.id ?? "";
        });
        setModelCatalogLoading(false);
      })
      .catch((error) => {
        if (!cancelled) {
          setModelError(error instanceof Error ? error.message : String(error));
          setModelCatalogLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    provider,
    providerConfigured,
    runtimeProvider,
    accountSession,
    localModelsRefreshToken
  ]);

  // A different case: its files, attachments and drafts start empty. Only the case id: the
  // name arrives later (a case created by the first file, a rename) and must not drop the
  // files just anonymized and attached.
  useEffect(() => {
    setDocumentDropQueue(createDocumentDropQueueState());
    setDocumentAttachments([]);
    setFirmTemplateIds([]);
    setLastDelivery(null);
    setPickerNotice("");
    setIncludeCaseKnowledge(false);
    setCaseScheduleError("");
    setScheduleTitle("");
    setScheduleStartsAt("");
    setScheduleLocation("");
    setScheduleNotes("");
    setDeletePhrase("");
    setDeletePassword("");
    setPendingFinalDocument(null);
    setProcessWorkflowVisible(false);
    setProcessWorkflowRefresh((value) => value + 1);
  }, [caseId]);

  useEffect(() => {
    setCaseNameDraft(selectedCase?.displayName ?? "");
  }, [caseId, selectedCase?.displayName]);

  useEffect(() => {
    let cancelled = false;
    setCaseScheduleError("");
    if (!caseId) {
      setCaseSchedule([]);
      setCaseScheduleLoading(false);
      return;
    }

    setCaseScheduleLoading(true);
    void listCaseSchedule(
      caseId
    )
      .then((result) => {
        if (!cancelled) {
          setCaseSchedule(
            result.events
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCaseSchedule([]);
          setCaseScheduleError(
            error instanceof Error
              ? error.message
              : String(error)
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCaseScheduleLoading(
            false
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [caseId, scheduleRefresh]);

  useEffect(() => {
    activeCaseIdRef.current =
      caseId;
  }, [caseId]);

  useEffect(() => {
    let cancelled = false;
    if (!caseId) {
      setArtifactNames({});
      return;
    }
    void listCaseArtifacts(caseId)
      .then((list) => {
        if (!cancelled) {
          setArtifactNames(
            Object.fromEntries(list.map((item) => [item.artifactId, item.filename]))
          );
        }
      })
      .catch(() => {
        if (!cancelled) setArtifactNames({});
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, workspaceRefresh]);

  const rememberArtifactName = (artifactId: string, filename: string) =>
    setArtifactNames((current) => ({ ...current, [artifactId]: filename }));

  // A different case closes the file list; a refresh within one case keeps it open.
  useEffect(() => {
    setCaseFilePickerOpen(false);
  }, [caseId]);

  // A different case starts with an unknown list: no files, no retries, no file errors.
  useEffect(() => {
    setCaseFiles([]);
    setCaseFilesRetries(0);
    setCaseFileErrors({});
    setCaseFilesLoad(caseId ? { caseId, status: "loading" } : null);
  }, [caseId]);

  useEffect(() => {
    let cancelled = false;
    if (!caseId) return;
    // A reload of a loaded list keeps it on screen; only an unknown list shows "loading".
    setCaseFilesLoad((current) =>
      current?.caseId === caseId && current.status === "loaded"
        ? current
        : { caseId, status: "loading", error: current?.caseId === caseId ? current.error : undefined }
    );
    void listCaseFiles(caseId)
      .then((result) => {
        if (cancelled) return;
        setCaseFiles(result.uploads);
        setCaseFilesLoad({ caseId, status: "loaded" });
        setCaseFilesRetries(0);
      })
      .catch((error) => {
        if (cancelled) return;
        setCaseFilesLoad({ caseId, status: "failed", error: error instanceof Error ? error.message : String(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [caseId, workspaceRefresh, caseFilesReload]);

  // A failed load retries on its own while the picker is open (2 s, 5 s, 10 s), then waits for the button.
  const caseFilesRetrying =
    caseFilePickerOpen && caseFilesLoad?.status === "failed" && caseFilesRetries < CASE_FILE_RETRY_DELAYS_MS.length;
  useEffect(() => {
    if (!caseFilesRetrying) return;
    const timer = window.setTimeout(() => {
      setCaseFilesRetries((value) => value + 1);
      setCaseFilesReload((value) => value + 1);
    }, CASE_FILE_RETRY_DELAYS_MS[caseFilesRetries]);
    return () => window.clearTimeout(timer);
  }, [caseFilesRetrying, caseFilesRetries, caseFilesLoad]);

  // While a file is still being added, read or anonymized, the open picker refreshes the list,
  // and once more when that ends, so a newly processed file shows up and can be selected.
  const caseFilesProcessing =
    pickerAnonymizing !== null ||
    documentDropQueue.files.length > 0 ||
    documentStaging.items.some((item) => item.status === "SAVING") ||
    Object.keys(documentProgress).length > 0;
  const caseFilesWasProcessing = useRef(false);
  useEffect(() => {
    const ended = caseFilesWasProcessing.current && !caseFilesProcessing;
    caseFilesWasProcessing.current = caseFilesProcessing;
    if (!caseFilePickerOpen || !caseId) return;
    if (ended) setCaseFilesReload((value) => value + 1);
    if (!caseFilesProcessing) return;
    const timer = window.setInterval(() => setCaseFilesReload((value) => value + 1), CASE_FILE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [caseFilePickerOpen, caseFilesProcessing, caseId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, executing]);

  useEffect(() => {
    if (!settingsRequest) {
      return;
    }
    setActiveTab("settings");
    setSettingsSection(
      // Konto użytkownika nie ma zakładki „Aplikacja i utrzymanie”.
      !developerAllowed && settingsRequest.section === "maintenance" ? "models" : settingsRequest.section
    );
  }, [
    settingsRequest?.nonce,
    settingsRequest?.section
  ]);

  useEffect(() => {
    if (!executing) {
      setExecutionElapsedSeconds(0);
      setRuntimePulse("CHECKING");
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();

    const tick = () => {
      if (!cancelled) {
        setExecutionElapsedSeconds(
          Math.max(
            0,
            Math.floor(
              (Date.now() - startedAt) /
                1000
            )
          )
        );
      }
    };

    const probeRuntime = async () => {
      try {
        await getHealth();
        if (!cancelled) {
          setRuntimePulse("OK");
        }
      } catch {
        if (!cancelled) {
          setRuntimePulse("LOST");
        }
      }
    };

    tick();
    void probeRuntime();
    const clock = window.setInterval(
      tick,
      1000
    );
    const heartbeat =
      window.setInterval(
        () => {
          void probeRuntime();
        },
        4000
      );

    return () => {
      cancelled = true;
      window.clearInterval(clock);
      window.clearInterval(
        heartbeat
      );
    };
  }, [executing]);

  useEffect(() => {
    if (
      pendingFirstMessage &&
      caseId &&
      !threadLoading &&
      !executing
    ) {
      const pending = pendingFirstMessage;
      setPendingFirstMessage(null);
      void executeMessage(pending);
    }
  }, [pendingFirstMessage, caseId, threadLoading, executing]);

  // The switch is sent once the thread's action shows the new skill (fresh routing state).
  useEffect(() => {
    if (!pendingSkillSwitch || executing || threadLoading || deterministicAction !== pendingSkillSwitch.action) return;
    const pending = pendingSkillSwitch;
    setPendingSkillSwitch(null);
    if (pending.caseId !== caseId) return;
    void executeMessage(pending.text, { switchTo: { action: pending.action, label: pending.label } });
  }, [pendingSkillSwitch, deterministicAction, caseId, threadLoading, executing]);

  async function acceptSkillSwitch(): Promise<void> {
    const current = skillSwitchOffer;
    if (!current || current.caseId !== caseId) return;
    setSkillSwitchOffer(null);
    const action = switchAction(current.offer);
    // Reduction at the start of the pleading pipeline: its state (per case) would be
    // resumed by the next pleading thread, so it starts again.
    if (current.offer.direction === "REDUCTION") {
      try {
        await resetCaseWorkflow(current.caseId, { kind: "process-pleading" });
        setProcessWorkflowRefresh((value) => value + 1);
      } catch (error) {
        setExecutionError("Nie udało się zamknąć pipeline'u pisma procesowego: " + (error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error)));
        return;
      }
    }
    const label = DETERMINISTIC_ACTIONS.find((item) => item.id === action)?.label ?? action;
    selectDeterministicAction(action);
    setPendingSkillSwitch({ caseId: current.caseId, action, text: switchMessage(current.offer), label });
  }

  function switchToCase(
    nextCaseId: string
  ): void {
    if (
      caseBusy ||
      executing ||
      !nextCaseId ||
      nextCaseId === caseId
    ) {
      return;
    }
    setPendingFirstMessage(null);
    // Files waiting for a decision were added for the case being left.
    setDocumentStaging(createDocumentStagingState());
    setExecutionError("");
    setGeneratedDocumentMessage("");
    setPendingFinalDocument(null);
    setCaseFilePickerOpen(false);
    setCaseId(nextCaseId);
    setActiveTab("chat");
  }

  async function refreshCases(preferredCaseId?: string): Promise<void> {
    const response = await listCases();
    setCases(response.cases);
    const matters = response.cases.filter((item) => item.caseKind === "MATTER");
    const next =
      matters.find((item) => item.caseId === preferredCaseId) ??
      matters.find((item) => !item.archivedAt) ??
      matters[0];
    setCaseId(next?.caseId ?? "");
  }

  async function createLocalCase(displayName?: string): Promise<string> {
    setCaseBusy(true);
    setCaseError("");
    try {
      const created = await createCase(displayName?.trim() || undefined);
      await refreshCases(created.caseId);
      setNewCaseName("");
      setActiveTab("chat");
      return created.caseId;
    } catch (error) {
      setCaseError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setCaseBusy(false);
    }
  }

  async function acceptFiles(files: readonly File[] | FileList): Promise<void> {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    try {
      if (!selectedCase || selectedCase.archivedAt) {
        await createLocalCase(newCaseName.trim() || "Nowa sprawa");
      }
      setDocumentStaging((current) =>
        stageDocuments(current, incoming)
      );
      setActiveTab("chat");
    } catch {
      setExecutionError(
        "Nie udało się utworzyć aktywnej sprawy dla dodawanych plików."
      );
    }
  }

  function processStagedDocuments(ids?: string[]): void {
    const pending = documentStaging.items.filter(
      (item) => item.status !== "SAVING" && (!ids || ids.includes(item.id))
    );
    const clear = pending.filter((item) => processingModeKeepsClearText(item.mode));
    if (
      clear.length > 0 &&
      !window.confirm(
        `${clear.map((item) => `„${item.file.name}”`).join(", ")}: bez anonimizacji - wybrane do czatu trafią do modelu z danymi osobowymi w jawnej postaci. Kontynuować?`
      )
    ) {
      return;
    }
    // Anonymization modes: the per-file privacy review (with AI when chosen).
    const review = pending.filter((item) => !processingModeKeepsClearText(item.mode));
    if (review.length > 0) {
      const taken = takeStagedDocuments(documentStaging, review.map((item) => item.id));
      for (const item of taken.items) reviewModes.current.set(item.file, item.mode);
      setDocumentStaging(taken.state);
      setDocumentDropQueue((current) =>
        enqueueDocumentDropFiles(current, taken.files)
      );
    }
    void processStagedClearTexts(clear);
  }

  // OCR only, several files: all read one after another (the vision model needs the memory
  // and one at a time), then the preview of each.
  async function processStagedClearTexts(items: Array<{ id: string; file: File; mode: DocumentProcessingMode }>): Promise<void> {
    if (items.some((item) => processingModeOptions(item.mode)?.ocrFix)) {
      const vision = await getVisionOcrStatus().catch(() => null);
      if (!vision?.installed || !vision.engineInstalled) {
        setExecutionError("„Tylko OCR z korektą AI” wymaga modelu wizyjnego: w panelu lokalnej AI użyj „Pobierz model wizyjny”.");
        return;
      }
    }
    const reads: Array<{ id: string; file: File; mode: DocumentProcessingMode; read: Promise<Awaited<ReturnType<typeof processStoredCaseFile>> | null> }> = [];
    let chain: Promise<unknown> = Promise.resolve();
    for (const item of items) {
      const read = chain.then(() => readStagedClearText(item.id, item.file, item.mode));
      reads.push({ ...item, read });
      chain = read;
    }
    for (const item of reads) {
      const review = await item.read;
      if (review) await confirmStagedClearText(item.id, item.file, review);
    }
  }

  // OCR only (optionally with the vision model's OCR correction): stored in the case and read;
  // null when it failed (the staged item shows why).
  async function readStagedClearText(
    id: string,
    file: File,
    mode: DocumentProcessingMode
  ): Promise<Awaited<ReturnType<typeof processStoredCaseFile>> | null> {
    const targetCase = caseId;
    setDocumentStaging((current) =>
      updateStagedDocument(current, id, { status: "SAVING" })
    );
    try {
      const stored = await uploadCaseFile(targetCase, file);
      return await withDocumentProgress(id, targetCase, (progressId) =>
        processStoredCaseFile(targetCase, stored.uploadId, undefined, progressId, processingModeOptions(mode))
      );
    } catch (error) {
      setDocumentStaging((current) =>
        updateStagedDocument(current, id, { status: "FAILED", error: documentFailure(error).message })
      );
      return null;
    }
  }

  // The preview of a read file, then finalized without anonymization and attached to the message.
  async function confirmStagedClearText(
    id: string,
    file: File,
    review: Awaited<ReturnType<typeof processStoredCaseFile>>
  ): Promise<void> {
    const targetCase = caseId;
    const finalized = await previewThenFinalize(targetCase, review, file.name, true);
    if (!finalized) {
      setDocumentStaging((current) => updateStagedDocument(current, id, { status: "PENDING" }));
      return;
    }
    pickFiles(
      [{ kind: "document", documentId: finalized.documentId, chunkIndices: finalized.chunks.map((chunk) => chunk.index) }],
      true,
      targetCase
    );
    setDocumentStaging((current) =>
      takeStagedDocuments(
        updateStagedDocument(current, id, { status: "PENDING" }),
        [id]
      ).state
    );
    setWorkspaceRefresh((value) => value + 1);
  }

  // A decision from its official card saved in the case's files (local RAG).
  async function saveCaseLawToCase(file: File): Promise<DocumentAttachmentSelection> {
    const targetCase = caseId;
    // The same decision already in the case files is reused, not stored twice.
    const existing = caseFiles.find((item) => item.filename === file.name && item.processing?.documentId);
    if (existing?.processing) {
      return { caseId: targetCase, documentId: existing.processing.documentId, chunkIndices: existing.processing.chunkIndices };
    }
    const stored = await uploadCaseFile(targetCase, file);
    const review = await processStoredCaseFile(targetCase, stored.uploadId);
    // A published, court-anonymized decision from the official database: confirmed without a preview.
    const result = await finalizeCaseDocument(targetCase, review.documentId, keepAllDirectives(review), undefined, true);
    setWorkspaceRefresh((value) => value + 1);
    return { caseId: targetCase, documentId: result.documentId, chunkIndices: result.chunks.map((chunk) => chunk.index) };
  }

  // Decisions the user points to (card, or a blob:/old PDF link of sn.pl with
  // the signature): taken from the official database, stored in the case
  // files and attached to this message. A blob: address cannot be read by
  // anyone outside the browser tab that made it.
  async function attachUserCaseLaw(text: string): Promise<DocumentAttachmentSelection[]> {
    const references = caseLawReferences(text);
    if (!references.length || !caseId) return [];
    const attached: DocumentAttachmentSelection[] = [];
    const notes: string[] = [];
    for (const reference of references) {
      if (reference.kind === "BLOB_WITHOUT_SIGNATURE") {
        notes.push(
          "Link blob: istnieje tylko w karcie przeglądarki, w której otwarto orzeczenie - aplikacja nie ma do niego dostępu. " +
            "Podaj sygnaturę (np. II CSKP 89/26) albo adres karty z paska przeglądarki (…?orzeczenie=…), a orzeczenie zostanie pobrane z sn.pl i dodane do akt; " +
            "możesz też zapisać PDF (Ctrl+S) i przeciągnąć go do czatu."
        );
        continue;
      }
      setPickerNotice(`Pobieram orzeczenie ${reference.kind === "SIGNATURE" ? reference.signature : "z karty"} i dodaję do akt sprawy…`);
      try {
        const copy = await resolveCaseLaw({
          ...(reference.kind === "CARD" ? { cardUrl: reference.cardUrl } : { signature: reference.signature, cardUrl: reference.link }),
          caseId
        });
        const attachment = await saveCaseLawToCase(caseLawDocument(copy));
        attached.push(attachment);
        notes.push(`Dodano do akt: ${[copy.court, copy.signature].filter(Boolean).join(" ")} (karta: ${copy.cardUrl}).`);
      } catch (error) {
        const code = error instanceof Error ? error.message : String(error);
        notes.push(`Nie udało się pobrać orzeczenia (${code}). Model sprawdzi je narzędziem weryfikacji.`);
      }
    }
    if (attached.length) pickFiles(attached.map((item) => ({ kind: "document" as const, documentId: item.documentId, chunkIndices: item.chunkIndices })), true, caseId);
    setPickerNotice(notes.join(" "));
    return attached;
  }

  async function saveStagedDocuments(ids?: string[]): Promise<void> {
    const targetCase = caseId;
    const items = documentStaging.items.filter(
      (item) => item.status !== "SAVING" && (!ids || ids.includes(item.id))
    );
    for (const item of items) {
      setDocumentStaging((current) =>
        updateStagedDocument(current, item.id, { status: "SAVING" })
      );
      try {
        await uploadCaseFile(targetCase, item.file);
        setDocumentStaging((current) =>
          takeStagedDocuments(
            updateStagedDocument(current, item.id, { status: "PENDING" }),
            [item.id]
          ).state
        );
        setWorkspaceRefresh((value) => value + 1);
      } catch (error) {
        setDocumentStaging((current) =>
          updateStagedDocument(current, item.id, {
            status: "FAILED",
            error: documentFailure(error).message
          })
        );
      }
    }
  }

  function removeStagedDocuments(ids?: string[]): void {
    setDocumentStaging((current) => takeStagedDocuments(current, ids).state);
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    void acceptFiles(event.dataTransfer.files);
  }

  function toggleManualSkill(name: string): void {
    if (
      MANDATORY_SKILLS.includes(
        name as (typeof MANDATORY_SKILLS)[number]
      )
    ) return;
    setManualSkills((current) => {
      const selected =
        current ??
        selectableExecutionSkills.map(
          (item) => item.name
        );
      return selected.includes(name)
        ? selected.filter(
            (item) => item !== name
          )
        : [
            ...selected,
            name
          ];
    });
  }

  function selectAllManualSkills(): void {
    setManualSkills(null);
  }

  function clearManualSkills(): void {
    setManualSkills([]);
  }

  function selectAllDomainSkills(): void {
    setAllowedDomains(null);
  }

  function clearDomainSkills(): void {
    setAllowedDomains([]);
  }

  function selectAllSkills(): void {
    selectAllDomainSkills();
    selectAllManualSkills();
  }

  function clearAllSkills(): void {
    clearDomainSkills();
    clearManualSkills();
  }

  function toggleDomainSkill(name: string): void {
    setAllowedDomains((current) => {
      const selected = current ?? routes;
      return selected.includes(name)
        ? selected.filter((item) => item !== name)
        : [...selected, name];
    });
  }

  function selectDeterministicAction(
    actionId:
      DeterministicActionId | ""
  ): void {
    const mappedSkills =
      skillsForDeterministicAction(
        actionId
      );
    setDeterministicAction(
      actionId
    );
    if (actionId) {
      setWorkMode("MECHANICAL");
    }
    setCaseTypeSkills(
      mappedSkills
    );
    // Keep the non-React routing bridge in sync immediately. This prevents a
    // click+send race on the first turn before useEffect has a chance to run.
    setCaseTypeExecutionSkills(
      mappedSkills
    );
    // No action = full router-controlled AUTO. A selected action pins the
    // execution pipeline programmatically; the router still selects DR domains.
    setAutomaticSkills(
      actionId === ""
    );
  }

  async function refreshProviderStatus(): Promise<void> {
    const result = await getProviderStatus();
    setProviderConfiguration(
      Object.fromEntries(
        result.providers.map((item) => [item.provider, item.configured])
      ) as Record<ProviderId, boolean>
    );
  }

  async function refreshProviderAccountStatus(): Promise<Record<ProviderId, ProviderAccountSessionStatus>> {
    const result =
      await getProviderAccountStatus();
    const accounts = Object.fromEntries(
      result.providers.map(
        (item) => [
          item.provider,
          item
        ]
      )
    ) as Record<
      ProviderId,
      ProviderAccountSessionStatus
    >;
    setProviderAccounts(accounts);
    return accounts;
  }

  async function disconnectProviderAccount(): Promise<void> {
    if (!isAccountPrimarySource(provider) || user.appRole !== "ADMIN" || providerAccountBusy) return;
    setProviderAccountBusy(true);
    try {
      await logoutProviderAccount(runtimeProvider);
      setProviderAccountMessage("Wylogowano konto w kliencie dostawcy.");
    } catch {
      setProviderAccountMessage(
        "Nie udało się wylogować: sesja nadal jest aktywna (np. token ze środowiska albo klient bez polecenia wylogowania). Wyloguj w oficjalnym kliencie dostawcy."
      );
    } finally {
      await refreshProviderAccountStatus().catch(() => undefined);
      setProviderAccountBusy(false);
    }
  }

  async function uninstallProviderAccount(): Promise<void> {
    if (!isAccountPrimarySource(provider) || user.appRole !== "ADMIN" || providerAccountBusy) return;
    const label = providerDefinition?.accountClientLabel ?? "klienta";
    if (
      !window.confirm(
        `Odinstalować ${label} pobranego przez Lex Machina? Logowanie u dostawcy pozostaje; aby je usunąć, najpierw kliknij „Wyloguj”.`
      )
    ) {
      return;
    }
    setProviderAccountBusy(true);
    try {
      const result = await uninstallProviderAccountClient(runtimeProvider);
      setProviderAccountMessage(
        result.status.installed
          ? `Usunięto klienta Lex Machina, ale nadal działa inny klient (${result.status.command}) spoza katalogu Lex Machina — odinstaluj go w systemie.`
          : "Klient odinstalowany. „Połącz konto” pobierze go ponownie."
      );
    } catch (error) {
      setProviderAccountMessage(
        error instanceof Error && error.message.includes("ACCOUNT_CLIENT_UNINSTALL_BUSY")
          ? "Trwa pobieranie klienta — odinstaluj po jego zakończeniu."
          : "Nie udało się odinstalować klienta (plik może być używany). Zamknij okna klienta i spróbuj ponownie."
      );
    } finally {
      await refreshProviderAccountStatus().catch(() => undefined);
      setProviderAccountBusy(false);
    }
  }

  function switchAccountToApi(): void {
    setProvider(
      runtimeProvider
    );
    setProviderApiKeyInput("");
    setProviderKeyMessage("");
    setProviderAccountMessage(
      "Przełączono na kanał API. Wklej klucz dostawcy; w aplikacji desktopowej możesz zapisać go w systemowym magazynie poświadczeń."
    );
    setActiveTab("settings");
    setSettingsSection("models");
  }

  async function connectProviderAccount(): Promise<boolean> {
    if (
      !isAccountPrimarySource(
        provider
      ) ||
      user.appRole !== "ADMIN" ||
      providerAccountBusy
    ) {
      return false;
    }
    setProviderAccountBusy(true);
    setAccountConnectPhase(null);
    try {
      // Lex's own pinned client is downloaded whenever it is missing, also when a
      // system-wide CLI exists (it remains the runtime's fallback).
      if (
        accountSession?.installed === false ||
        accountSession?.managedClientInstalled === false
      ) {
        setProviderAccountMessage("");
        let progress =
          await startProviderAccountProvision(
            runtimeProvider
          );
        setAccountConnectPhase({ kind: "provision", progress });
        while (
          progress.stage !== "READY" &&
          progress.stage !== "FAILED"
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          progress =
            await getProviderAccountProvision(
              runtimeProvider
            );
          setAccountConnectPhase({ kind: "provision", progress });
        }
        if (progress.stage === "FAILED") {
          setAccountConnectPhase({
            kind: "failed",
            message: provisionFailureText(progress.error ?? "")
          });
          return false;
        }
        if (progress.status) {
          const provisioned = progress.status;
          setProviderAccounts(
            (current) => ({
              ...current,
              [runtimeProvider]:
                provisioned
            })
          );
          if (provisioned.authenticated) {
            setAccountConnectPhase({ kind: "done" });
            return true;
          }
        }
      }
      setAccountConnectPhase({ kind: "login" });
      setProviderAccountMessage(
        isDesktopShell()
          ? "Otwieram widoczne okno oficjalnego logowania dostawcy. Dokończ logowanie w tym oknie lub w uruchomionej przez nie przeglądarce…"
          : "Otwieram oficjalne logowanie dostawcy…"
      );
      const status =
        await loginProviderAccount(
          runtimeProvider
        );
      setProviderAccounts(
        (current) => ({
          ...current,
          [runtimeProvider]:
            status
        })
      );
      setAccountConnectPhase(
        status.authenticated
          ? { kind: "done" }
          : null
      );
      setProviderAccountMessage(
        status.authenticated
          ? "Konto połączone. Każda wiadomość idzie w nowej sesji klienta; historię sprawy dołącza Lex Machina."
          : "Logowanie zakończone, ale klient nie potwierdził aktywnej sesji."
      );
      return status.authenticated;
    } catch (error) {
      const code =
        error instanceof ApiError
          ? error.code
          : error instanceof Error
            ? error.message
            : String(error);
      setAccountConnectPhase(null);
      // The login may still complete in the client's own window after the call failed:
      // a session that is active now is not reported as a failure.
      const refreshed = await refreshProviderAccountStatus().catch(() => null);
      setProviderAccountMessage(
        refreshed?.[runtimeProvider]?.authenticated
          ? "Konto połączone (logowanie dokończone w oknie klienta dostawcy)."
          : accountLoginFailureText(code)
      );
      return false;
    } finally {
      setProviderAccountBusy(false);
    }
  }

  async function saveClaudeOAuthToken(): Promise<void> {
    if (
      provider !==
        "anthropic-account" ||
      user.appRole !==
        "ADMIN" ||
      !claudeOAuthToken.trim()
    ) {
      return;
    }
    setClaudeOAuthBusy(true);
    setClaudeOAuthMessage("");
    try {
      await setClaudeOAuthToken(
        claudeOAuthToken,
        isDesktopShell()
          ? "OS_KEYRING"
          : "PROCESS_MEMORY"
      );
      setClaudeOAuthTokenInput("");
      await refreshProviderAccountStatus();
      setClaudeOAuthMessage(
        isDesktopShell()
          ? "Token OAuth Claude zapisano w systemowym magazynie poświadczeń."
          : "Token OAuth Claude jest aktywny w pamięci procesu."
      );
    } catch (error) {
      setClaudeOAuthMessage(
        error instanceof Error
          ? error.message
          : String(error)
      );
    } finally {
      setClaudeOAuthBusy(false);
    }
  }

  async function removeClaudeOAuthToken(): Promise<void> {
    if (
      user.appRole !==
        "ADMIN"
    ) {
      return;
    }
    setClaudeOAuthBusy(true);
    setClaudeOAuthMessage("");
    try {
      await clearClaudeOAuthToken();
      await refreshProviderAccountStatus();
      setClaudeOAuthMessage(
        "Token OAuth Claude został usunięty."
      );
    } catch (error) {
      setClaudeOAuthMessage(
        error instanceof Error
          ? error.message
          : String(error)
      );
    } finally {
      setClaudeOAuthBusy(false);
    }
  }

  async function saveApiKey(): Promise<void> {
    if (
      provider === "local" ||
      isAccountPrimarySource(
        provider
      ) ||
      user.appRole !== "ADMIN" ||
      !providerApiKey.trim()
    ) return;
    setProviderKeyBusy(true);
    setProviderKeyMessage("");
    try {
      await setProviderApiKey(
        provider,
        providerApiKey,
        isDesktopShell() ? "OS_KEYRING" : "PROCESS_MEMORY"
      );
      setProviderApiKeyInput("");
      await refreshProviderStatus();
      setProviderKeyMessage(
        isDesktopShell()
          ? "Klucz zapisano w systemowym magazynie poświadczeń."
          : "Klucz jest aktywny w pamięci procesu."
      );
    } catch (error) {
      setProviderKeyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderKeyBusy(false);
    }
  }

  async function removeApiKey(): Promise<void> {
    if (
      provider === "local" ||
      isAccountPrimarySource(
        provider
      ) ||
      user.appRole !== "ADMIN"
    ) return;
    setProviderKeyBusy(true);
    try {
      await clearProviderApiKey(provider);
      await refreshProviderStatus();
      setProviderKeyMessage("Klucz został usunięty.");
    } catch (error) {
      setProviderKeyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderKeyBusy(false);
    }
  }

  async function prepareLocalPrimaryModel():
    Promise<string | null> {
    if (
      provider !== "local" ||
      !model.startsWith("local/")
    ) {
      return null;
    }

    const codeOf = (
      error: unknown
    ): string =>
      error instanceof ApiError
        ? error.code
        : error instanceof Error
          ? error.message
          : String(error);

    try {
      const started =
        await startLocalModel(
          model
        );
      setLocalRuntimeStatus(
        started.runtime
      );
      setModelError("");
      return null;
    } catch (initialError) {
      if (
        user.appRole !==
          "ADMIN"
      ) {
        return (
          "Lokalny model wymaga naprawy profilu. " +
          "Poproś administratora aplikacji o uruchomienie naprawy lokalnej AI. " +
          `Kod: ${codeOf(initialError)}`
        );
      }

      setModelError(
        "Przygotowuję i weryfikuję lokalny model…"
      );

      try {
        let snapshot =
          await getLocalModels();
        let local =
          snapshot.models.find(
            (item) =>
              item.id === model
          );
        if (!local) {
          throw new Error(
            "LOCAL_MODEL_NOT_FOUND"
          );
        }

        const preferredContext =
          local
            .configuredContextWindow ??
          local.contextWindow;

        if (
          snapshot.runtime
            .configured &&
          snapshot.runtime
            .selectedModelId ===
            model
        ) {
          try {
            await repairLocalModel();
          } catch {
            await provisionLocalModel(
              model,
              preferredContext
            );
          }
        } else {
          await provisionLocalModel(
            model,
            preferredContext
          );
        }

        try {
          const started =
            await startLocalModel(
              model
            );
          setLocalRuntimeStatus(
            started.runtime
          );
        } catch (startError) {
          snapshot =
            await getLocalModels();
          local =
            snapshot.models.find(
              (item) =>
                item.id === model
            );
          if (!local) {
            throw startError;
          }

          const activeContext =
            local
              .configuredContextWindow ??
            local.contextWindow;
          const fallbackContext =
            local
              .minimumContextWindow;

          if (
            fallbackContext >=
              activeContext
          ) {
            throw startError;
          }

          // 128k remains the preferred default. This fallback is used only
          // after the qualified profile cannot start on the current machine.
          await provisionLocalModel(
            model,
            fallbackContext
          );
          const started =
            await startLocalModel(
              model
            );
          setLocalRuntimeStatus(
            started.runtime
          );
        }

        setLocalModelsRefreshToken(
          (value) => value + 1
        );
        setModelError("");
        return null;
      } catch (recoveryError) {
        const code =
          codeOf(
            recoveryError
          );
        setModelError(code);
        return (
          "Nie udało się uruchomić lokalnego modelu nawet po automatycznej naprawie profilu. " +
          `Kod: ${code}`
        );
      }
    }
  }

  async function startSelectedLocalModel():
    Promise<void> {
    if (
      provider !== "local" ||
      !model.startsWith("local/") ||
      localStartBusy ||
      executing
    ) {
      return;
    }
    setLocalStartBusy(true);
    setLocalStartMessage(
      "Uruchamiam lokalny model…"
    );
    try {
      const failure =
        await prepareLocalPrimaryModel();
      if (failure) {
        setLocalStartMessage(
          failure
        );
        return;
      }
      const snapshot =
        await getLocalModels();
      setLocalRuntimeStatus(
        snapshot.runtime
      );
      setLocalStartMessage(
        snapshot.runtime.state ===
            "READY" &&
          snapshot.runtime
            .activeModelId === model
          ? "Lokalny model działa."
          : "Runtime odpowiedział, ale model nie osiągnął stanu READY."
      );
    } catch (error) {
      setLocalStartMessage(
        error instanceof Error
          ? error.message
          : String(error)
      );
    } finally {
      setLocalStartBusy(false);
    }
  }

  // The last used model was local: start it on entry, once per session.
  useEffect(() => {
    if (
      localAutoStartTried.current ||
      !runtimeOnline ||
      modelCatalogLoading ||
      !models.some((item) => item.id === model && item.selectable) ||
      !shouldAutoStartLocalModel({
        remembered: rememberedModel,
        provider,
        model,
        runtimeState: localRuntimeStatus?.state,
        activeModelId: localRuntimeStatus?.activeModelId
      })
    ) {
      return;
    }
    localAutoStartTried.current = true;
    void startSelectedLocalModel();
  });

  async function chooseContractMode(mode: ContractAnalysisMode): Promise<void> {
    const pending = contractModeRequest;
    if (!pending || contractModeBusy) return;
    setContractModeBusy(true);
    try {
      try {
        await initializeContractAnalysisWorkflow(pending.caseId, mode);
      } catch (error) {
        // Initialized meanwhile (another window): the message can go.
        if (!(error instanceof ApiError && error.code === "CONTRACT_STATE_EXISTS")) throw error;
      }
      setContractModeRequest(null);
      setExecutionError("");
      setExecutionDiagnostic(null);
      // The failed message leaves the thread and is sent again (no duplicate).
      setMessages((current) => current.filter((message) => message.id !== pending.messageId));
      setContractRetry({ text: pending.text, messageId: pending.messageId });
    } catch (error) {
      setExecutionError(
        "Nie udało się ustawić trybu analizy umowy: " +
          (error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error))
      );
    } finally {
      setContractModeBusy(false);
    }
  }

  async function recoverWorkflow(mode?: "CHECKPOINT" | "AUTO"): Promise<void> {
    const pending = workflowRecoveryRequest;
    if (!pending || workflowRecoveryBusy) return;
    setWorkflowRecoveryBusy(true);
    try {
      const { recovery } = pending;
      if (recovery.kind === "process-start") {
        if (!recovery.acceptOnly) {
          try {
            await initializeProcessPleadingWorkflow(pending.caseId, mode ?? "CHECKPOINT");
          } catch (error) {
            if (!(error instanceof ApiError && error.code === "PROCESS_PLEADING_STATE_EXISTS")) throw error;
          }
        }
        await acceptProcessPleadingWorkflowStart(pending.caseId);
        setProcessWorkflowRefresh((value) => value + 1);
      } else {
        await resetCaseWorkflow(pending.caseId, recovery.workflow);
        if (recovery.workflow.kind === "process-pleading") setProcessWorkflowRefresh((value) => value + 1);
      }
      setWorkflowRecoveryRequest(null);
      setExecutionError("");
      setExecutionDiagnostic(null);
      setMessages((current) => current.filter((message) => message.id !== pending.messageId));
      setContractRetry({ text: pending.text, messageId: pending.messageId, ...(pending.switchTo ? { switchTo: pending.switchTo } : {}) });
    } catch (error) {
      setExecutionError(
        "Nie udało się przygotować etapu sprawy: " +
          (error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error))
      );
    } finally {
      setWorkflowRecoveryBusy(false);
    }
  }

  useEffect(() => {
    if (!autoNext || executing) return;
    if (autoStopRef.current || autoNext.caseId !== caseId) {
      setAutoNext(null);
      return;
    }
    const next = autoNext;
    setAutoNext(null);
    void executeMessage(next.text, { autoStep: next.step, autoMeta: next.meta });
    // executeMessage reads the current thread state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoNext, executing, caseId]);

  useEffect(() => {
    if (!contractRetry || executing) return;
    if (messages.some((message) => message.id === contractRetry.messageId)) return;
    const { text, switchTo } = contractRetry;
    setContractRetry(null);
    // A retried switch: the removal restored the previous action; select the new one again.
    if (switchTo && caseId) {
      selectDeterministicAction(switchTo.action);
      setPendingSkillSwitch({ caseId, action: switchTo.action, text, label: switchTo.label });
      return;
    }
    void executeMessage(text);
    // executeMessage reads the current thread state; the effect waits for the removal above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractRetry, messages, executing]);

  useEffect(() => {
    if (!unverifiedDraftRetry || executing) return;
    if (messages.some((message) => message.id === unverifiedDraftRetry.messageId)) return;
    const { text } = unverifiedDraftRetry;
    setUnverifiedDraftRetry(null);
    void executeMessage(text, { acceptUnverified: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unverifiedDraftRetry, messages, executing]);

  function saveUnverifiedDraft(): void {
    const pending = unverifiedDraftRequest;
    if (!pending) return;
    setUnverifiedDraftRequest(null);
    setExecutionError("");
    setExecutionDiagnostic(null);
    setMessages((current) => current.filter((message) => message.id !== pending.messageId));
    setUnverifiedDraftRetry({ text: pending.text, messageId: pending.messageId });
  }

  // A letter, a pleading or a contract of an answer as a .docx (HYBRID-VAL on the server): after a
  // workflow's turn, and from an answer that is itself a ready letter ("Generuj dokument").
  async function createLetterFile({
    executionCaseId,
    context,
    plan,
    route,
    attachments,
    download = false
  }: {
    executionCaseId: string;
    context: CaseChatMessage[];
    plan: NonNullable<ReturnType<typeof letterDocumentPlan>>;
    route: string;
    attachments: DocumentAttachmentSelection[];
    // "Pobierz .docx": the file is saved at once, not only shown in the thread.
    download?: boolean;
  }): Promise<void> {
    const letterWorkflow = plan.documentType;
    const stage = plan.stage;
    setExecutionStage(
      stage === "FINAL"
        ? "Tworzenie gotowego dokumentu"
        : "Tworzenie szkicu dokumentu"
    );
    try {
      const generated =
        await generateLegalDocument(
          executionCaseId,
          {
            query:
              buildSkillSelectionEnvelope(
                conversationForProvider(
                  context,
                  letterWorkflow === "contract"
                    ? "Przygotuj plik .docx z umową z ostatniej odpowiedzi Asystenta. Zachowaj treść umowy bez zmian merytorycznych; pomiń sekcje techniczne (rejestr kroków, HYBRID-VALIDATION, ślad weryfikacji, uwagi dla prawnika)."
                    : "Przygotuj plik .docx z pismem z ostatniej odpowiedzi Asystenta. Zachowaj treść pisma bez zmian merytorycznych; pomiń sekcje techniczne (routing, weryfikacja, HYBRID-VALIDATION, raport redakcji, uwagi dla prawnika).",
                  conversationChars
                ),
                automaticSkills,
                [],
                manualSkills === null
                  ? null
                  : manualSkillSelection
              ),
            provider: runtimeProvider,
            model,
            primarySkill: route,
            mode: "PRAWNIK",
            format: "docx",
            documentType: letterWorkflow,
            // A letter or pleading in the office's style (Times New Roman 12, party names in bold).
            styleProfile: letterWorkflow === "contract" ? "lex-classic-clean-v1" : "lex-office-tnr-v1",
            attachments,
            ...(firmTemplateIds.length > 0
              ? { firmTemplates: firmTemplateIds }
              : {}),
            ...(plan.source ? { source: plan.source } : {}),
            ...(plan.answerSessionId ? { answerSessionId: plan.answerSessionId } : {}),
            ...(plan.longDocumentId ? { longDocumentId: plan.longDocumentId } : {}),
            filename:
              (plan.source === "REDACTION"
                ? "LexMachina-pismo-poprawione"
                : letterWorkflow === "contract"
                ? "LexMachina-umowa"
                : letterWorkflow === "pleading"
                ? "LexMachina-pismo-procesowe"
                : "LexMachina-pismo") +
              (stage === "DRAFT" ? "-szkic" : "") +
              ".docx"
          }
        );
      if (
        activeCaseIdRef.current ===
          executionCaseId
      ) {
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "assistant",
            content:
              (stage === "FINAL"
                ? "Gotowy dokument pisma jest poniżej: pobierz, obejrzyj i edytuj albo otwórz w edytorze."
                : "Szkic pisma jako plik .docx jest poniżej. Po zakończeniu kolejnych etapów powstanie wersja gotowa.") +
              documentWarningsText(generated.warnings) + letterheadText(generated.letterhead),
            meta: "dokument: " + generated.artifact.filename,
            generatedDocument: {
              artifactId: generated.artifact.artifactId,
              filename: generated.artifact.filename,
              format: generated.format,
              tokenized: generated.readyForDownload !== true,
              stage
            }
          }
        ]);
        setWorkspaceRefresh((value) => value + 1);
      }
      if (download) {
        const blob = await downloadGeneratedArtifact(executionCaseId, generated.artifact.artifactId);
        await downloadBlob(blob, generated.artifact.filename);
      }
    } catch (documentError) {
      // The answer itself stays; only the file is missing.
      if (
        activeCaseIdRef.current ===
          executionCaseId
      ) {
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "system",
            content:
              exportBlockedMessage(documentError) ??
              "Nie udało się utworzyć pliku pisma: " +
              (documentError instanceof ApiError
                ? [documentError.code, documentError.reason].filter(Boolean).join(" · ")
                : documentError instanceof Error
                  ? documentError.message
                  : String(documentError)) +
              ". Możesz poprosić: „wygeneruj to w pliku docx”."
          }
        ]);
      }
    }
  }

  // "Generuj dokument" under an answer that is itself a letter: its file at once, from that
  // answer (fields to fill in stay marked), with no new session that would ask again.
  // An answer the server kept as a letter (answerDocument): the file is made from its text
  // mechanically (no model turn); otherwise the model lays out the letter of the answer.
  async function fileFromAnswer(answer: CaseChatMessage, download = false): Promise<void> {
    if (executing || !caseId || !model) return;
    const index = messages.findIndex((item) => item.id === answer.id);
    const context = index >= 0 ? messages.slice(0, index + 1) : [...messages];
    setExecuting(true);
    try {
      await createLetterFile({
        executionCaseId: caseId,
        context,
        plan: {
          documentType: "letter",
          stage: /⬛|\[UZUPEŁNIJ|\[(?:podpis|data|Miejscowość)\]|\[NIEWERYFIKOWANE/iu.test(answer.content) ? "DRAFT" : "FINAL",
          ...(answer.answerDocument ? { source: "ANSWER" as const, answerSessionId: answer.answerDocument.sessionId } : {})
        },
        route: automaticSkills ? "AUTO" : choosePrimaryRoute(answer.content, routes, skills, []) ?? "AUTO",
        attachments: documentAttachments,
        download
      });
    } finally {
      setExecuting(false);
      setExecutionStage("");
    }
  }

  // "Generuj dokument" of a long letter: one file of its parts kept in the case (the server
  // checks each was accepted), not of the chat.
  async function fileFromLongDocument(answer: CaseChatMessage, longDocumentId: string): Promise<void> {
    if (executing || !caseId || !model) return;
    const index = messages.findIndex((item) => item.id === answer.id);
    const skill = answer.pipelineNext?.choices?.find((choice) => choice.longDocumentId === longDocumentId)?.skill;
    setExecuting(true);
    try {
      await createLetterFile({
        executionCaseId: caseId,
        context: index >= 0 ? messages.slice(0, index + 1) : [...messages],
        plan: { documentType: longDocumentType(skill), stage: "DRAFT", longDocumentId },
        route: automaticSkills ? "AUTO" : choosePrimaryRoute(answer.content, routes, skills, []) ?? "AUTO",
        attachments: documentAttachments
      });
    } finally {
      setExecuting(false);
      setExecutionStage("");
    }
  }

  async function executeMessage(
    plain: string,
    options: { acceptUnverified?: boolean; autoStep?: number; autoMeta?: string; switchTo?: { action: DeterministicActionId; label: string } } = {}
  ): Promise<void> {
    const trimmed =
      plain.trim();
    if (
      executing ||
      !trimmed ||
      !caseId ||
      selectedCase?.archivedAt ||
      !runtimeOnline ||
      !model
    ) return;
    // Plik w kolejce (przetwarzany, czeka na decyzję albo z błędem odczytu) nie trafiłby do
    // wiadomości: model odpowiadałby bez niego ("nie widzę wyroku"). Najpierw decyzja o pliku.
    if (documentDropQueue.files.length > 0 || documentStaging.items.length > 0) {
      const pending = documentDropQueue.files[0]?.name ?? documentStaging.items[0]?.file?.name;
      setExecutionError(
        `${pending ? `Plik ${pending}` : "Dodany plik"} nie jest jeszcze przyjęty (przetwarzanie, decyzja o anonimizacji albo błąd odczytu). Zatwierdź go albo kliknij „Pomiń ten plik”, a potem wyślij wiadomość.`
      );
      return;
    }
    saveLastUsedModel(user.userId, { provider, model });
    const userCaseLaw = await attachUserCaseLaw(trimmed);
    const sendAttachments = userCaseLaw.reduce((list, item) => upsertAttachment(list, item), documentAttachments);

    if (
      conversationIsNew &&
      workMode === "MECHANICAL" &&
      !deterministicAction
    ) {
      setExecutionError(
        "Tryb mechaniczny: wybierz skill wykonawczy albo przełącz na tryb automatyczny."
      );
      return;
    }

    const route =
      automaticSkills
        ? "AUTO"
        : choosePrimaryRoute(
            trimmed,
            routes,
            skills,
            []
          );
    if (!route) {
      setExecutionError(
        "Nie udało się wybrać dziedziny głównej dla tej wiadomości."
      );
      return;
    }

    const priorMessages =
      messages;
    const userMessage:
      CaseChatMessage = {
        id: messageId(),
        role: "user",
        content: trimmed,
        ...(options.autoMeta
          ? { meta: options.autoMeta }
          : conversationIsNew
            ? {
                meta:
                  deterministicActionMeta(
                    deterministicAction
                  )
              }
            : options.switchTo
              ? { meta: `${deterministicActionMeta(options.switchTo.action)} | Przełączono na: ${options.switchTo.label}` }
              : {})
      };
    // A message the user sends starts a new chain of automatic steps.
    if (options.autoStep === undefined) autoStopRef.current = false;

    // Optimistic UI: move the message into the thread immediately. Provider
    // login/model startup/repair happens only after the user sees what was sent.
    setMessages((current) => [
      ...current,
      userMessage
    ]);
    const executionCaseId =
      caseId;

    setQuery("");
    setExecuting(true);
    setExecutingCaseId(executionCaseId);
    setExecutionStage(
      "Przygotowanie sesji"
    );
    setExecutionError("");
    setExecutionDiagnostic(null);
    setGeneratedDocumentMessage("");
    // A new message supersedes a pending choice for an earlier one.
    setContractModeRequest(null);
    setWorkflowRecoveryRequest(null);

    try {
      // "daj mi pismo", "wygeneruj to w docx" after an answer that is itself a letter: the file of
      // that answer, mechanically, not a new letter the model would write again.
      const lastAnswer = [...priorMessages].reverse().find((item) => item.role === "assistant");
      if (directDocumentRequest(trimmed) && caseId && lastAnswer?.answerDocument && refersToLastAnswer(trimmed)) {
        await createLetterFile({
          executionCaseId,
          context: priorMessages,
          plan: {
            documentType: "letter",
            stage: /⬛|\[UZUPEŁNIJ|\[NIEWERYFIKOWANE/u.test(lastAnswer.content) ? "DRAFT" : "FINAL",
            source: "ANSWER",
            answerSessionId: lastAnswer.answerDocument.sessionId
          },
          route,
          attachments: sendAttachments
        });
        return;
      }
      let readyAccount =
        accountAuthenticated;
      if (
        isAccountPrimarySource(
          provider
        ) &&
        !readyAccount
      ) {
        setExecutionStage(
          "Łączenie konta modelu"
        );
        const connected =
          await connectProviderAccount();
        if (!connected) {
          throw new Error(
            accountSession?.installed ===
              false
              ? "ACCOUNT_SESSION_CLI_NOT_INSTALLED"
              : user.appRole === "ADMIN"
                ? "ACCOUNT_SESSION_LOGIN_NOT_CONFIRMED"
                : "ACCOUNT_SESSION_LOGIN_ADMIN_REQUIRED"
          );
        }
        readyAccount = true;
      }

      if (
        !canExecutePrimaryModel(
          providerConfigured,
          model,
          readyAccount
        )
      ) {
        throw new Error(
          "PRIMARY_MODEL_NOT_READY"
        );
      }

      setExecutionStage(
        provider === "local"
          ? "Przygotowanie modelu lokalnego"
          : "Sprawdzanie gotowości modelu"
      );
      const localPreparationError =
        await prepareLocalPrimaryModel();
      if (localPreparationError) {
        throw new Error(
          localPreparationError
        );
      }

      const documentRequest =
        directDocumentRequest(
          trimmed
        );
      if (
        documentRequest &&
        caseId
      ) {
        setExecutionStage(
          "Tworzenie dokumentu i weryfikacja źródeł"
        );
        // A pleading not yet written by the case's pipeline goes to that pipeline
        // (the chat below) instead of a file without HYBRID-VAL.
        const generated =
          await generateLegalDocument(
            executionCaseId,
            {
              query:
                buildSkillSelectionEnvelope(
                  conversationForProvider(
                    priorMessages,
                    trimmed,
                    conversationChars
                  ),
                  automaticSkills,
                  [],
                  manualSkills === null
                    ? null
                    : manualSkillSelection
                ),
              provider:
                runtimeProvider,
              model,
              primarySkill:
                route,
              mode:
                "PRAWNIK",
              format:
                documentRequest
                  .format,
              documentType:
                documentRequest
                  .documentType,
              styleProfile:
                "lex-classic-clean-v1",
              attachments:
                sendAttachments,
              ...(firmTemplateIds.length > 0
                ? { firmTemplates: firmTemplateIds }
                : {}),
              ...(options.acceptUnverified ? { acceptUnverified: true } : {}),
              filename:
                (
                  documentRequest.documentType ===
                    "letter"
                    ? "LexMachina-pismo"
                    : documentRequest.documentType ===
                        "pleading"
                      ? "LexMachina-pismo-procesowe"
                      : documentRequest.documentType ===
                          "contract"
                        ? "LexMachina-umowa"
                        : documentRequest.documentType ===
                            "opinion"
                          ? "LexMachina-opinia"
                          : documentRequest.documentType ===
                              "report"
                            ? "LexMachina-raport"
                            : "LexMachina-dokument"
                ) +
                "." +
                documentRequest.format
            }
          ).catch((error: unknown) => {
            if (
              documentRequest.documentType === "pleading" &&
              error instanceof ApiError &&
              error.code === "PROCESS_PLEADING_PIPELINE_REQUIRED"
            ) {
              return null;
            }
            // A contract, chronology, court analysis and the other workflows with saved
            // checkpoints write their document in the chat pipeline (mode first).
            if (error instanceof ApiError && error.code === "WORKFLOW_PIPELINE_REQUIRED") {
              return null;
            }
            throw error;
          });
        if (generated) {
          // The document with the case's data at once (no password): the file is saved now
          // (a one-time ticket); the card keeps the placeholder version for the preview,
          // the editor and another restoration.
          let savedFinal: string | null = null;
          if (generated.deanonymized && generated.downloadTicket) {
            const blob = await downloadSensitiveArtifact(generated.downloadTicket.ticketId);
            savedFinal = (await downloadBlob(blob, generated.artifact.filename)) ?? generated.artifact.filename;
          }
          const downloadedFinal =
            generated
              .readyForDownload ===
              true && !generated.deanonymized;

          // The document is shown in the chat as a card (download, preview, open in
          // Word, machine deanonymization) instead of being saved without asking.
          const generatedDocument = generated.deanonymized
            ? {
                artifactId: generated.deanonymized.tokenizedArtifactId,
                filename: generated.artifact.filename,
                format: generated.format,
                tokenized: true
              }
            : {
                artifactId: generated.artifact.artifactId,
                filename: generated.artifact.filename,
                format: generated.format,
                tokenized: !downloadedFinal
              };
          const toCheck = (generated.deanonymized?.restorations ?? []).filter((item) => item.status !== "ok").length;

          if (
            activeCaseIdRef.current ===
              executionCaseId
          ) {
            setPendingFinalDocument(null);
            setMessages(
              (
                current
              ) => [
                ...current,
                {
                  id:
                    messageId(),
                  role:
                    "assistant",
                  content:
                    (savedFinal
                      ? "Dokument " +
                        documentRequest.format.toUpperCase() +
                        " z danymi osobowymi zapisano: " +
                        savedFinal +
                        "." +
                        (toCheck ? ` Formy do sprawdzenia: ${toCheck} - użyj podglądu w karcie.` : "") +
                        " Karta poniżej: wersja z symbolami (podgląd, edycja, ponowne przywrócenie danych)."
                      : downloadedFinal
                      ? "Gotowy dokument " +
                        documentRequest.format.toUpperCase() +
                        " jest poniżej: pobierz go, obejrzyj podgląd albo otwórz w edytorze."
                      : "Dokument " +
                        documentRequest.format.toUpperCase() +
                        " jest gotowy w wersji z symbolami danych osobowych. Użyj „Deanonimizuj”, aby Lex Machina maszynowo przywróciła dane z klucza sprawy.") +
                    documentWarningsText(generated.warnings) + letterheadText(generated.letterhead),
                  meta:
                    "dokument: " +
                    generated
                      .artifact
                      .filename,
                  generatedDocument
                }
              ]
            );
            setGeneratedDocumentMessage("");
            setWorkspaceRefresh(
              (value) =>
                value + 1
            );
          }
          return;
        }
      }

      setExecutionStage(
        selectedFileCount > 0
          ? `Wysyłanie ${selectedFileCount} ${selectedFileCount === 1 ? "pliku" : "plików"} do modelu · analiza prawna i weryfikacja źródeł`
          : developerMode ? "Analiza prawna, routing i weryfikacja źródeł" : "Analiza prawna i weryfikacja źródeł"
      );
      setLastDelivery(null);
      const executionId =
        newExecutionId();
      const stopDraftPolling =
        startDraftPolling(
          executionId,
          setDraftText,
          DRAFT_POLL_MS,
          getSessionProgress,
          setExecutionSteps
        );
      const result = await executeSession({
        query: buildSkillSelectionEnvelope(
          conversationForProvider(
            priorMessages,
            trimmed,
            conversationChars
          ),
          automaticSkills,
          [],
          manualSkills === null
            ? null
            : manualSkillSelection
        ),
        provider: runtimeProvider,
        model,
        auxiliaryText:
          trimmed,
        primarySkill: route,
        mode: "PRAWNIK",
        ...(sendAttachments.length > 0
          ? {
              attachments: sendAttachments,
              evidenceImages: imagesWithText ? "all" as const : "photos" as const
            }
          : {}),
        ...(firmTemplateIds.length > 0
          ? { firmTemplates: firmTemplateIds }
          : {}),
        knowledge: {
          caseId,
          includeCase: includeCaseKnowledge,
          includeFirm: includeFirmKnowledge,
          limit: 8
        }
      }, executionId).finally(
        stopDraftPolling
      ) as ExtendedExecution;
      // The answer updated the matter's memory (provisions, summary).
      setMemoryRefresh((value) => value + 1);

      setExecutionStage(
        "Finalizacja odpowiedzi"
      );
      if (result.context?.documents?.length) {
        setLastDelivery({
          documents: result.context.documents,
          names: Object.fromEntries(
            result.context.documents.map((document) => [
              document.documentId,
              fileLabel(document.documentId, document.title)
            ])
          )
        });
      }
      if (result.processWorkflow) {
        setProcessWorkflowVisible(true);
        setProcessWorkflowRefresh(
          (value) => value + 1
        );
      }
      const answerMessage =
        executionMessage(
          result,
          route
        );
      if (
        activeCaseIdRef.current ===
          executionCaseId
      ) {
        setMessages((current) => [
          ...current,
          answerMessage
        ]);
        setSkillSwitchOffer(result.skillSwitch ? { caseId: executionCaseId, offer: result.skillSwitch } : null);
      }

      // Checkpoint workflows go on by themselves; the thread names the next step.
      const autoDecision = autoAdvanceDecision(
        result,
        workflowClosedRef.current[executionCaseId] ?? null,
        options.autoStep ?? 0,
        options.autoMeta
      );
      const autoProgress = workflowProgress(result);
      if (autoProgress) workflowClosedRef.current[executionCaseId] = autoProgress.closed;
      const autoNote = autoAdvanceNote(result, autoDecision);
      if (autoNote && activeCaseIdRef.current === executionCaseId) {
        setMessages((current) => [...current, { id: messageId(), role: "system", content: autoNote }]);
      }
      if (autoDecision.advance && !autoStopRef.current && activeCaseIdRef.current === executionCaseId) {
        setAutoNext({ caseId: executionCaseId, text: autoDecision.message, meta: autoDecision.meta, step: (options.autoStep ?? 0) + 1 });
      }

      // Letter workflows end with a file, like a document artifact: after each
      // completed cycle a draft .docx, and the finished document at the end
      // (simple letter: all gates passed; process pleading: FINAL status).
      // AUTO answered a court pleading without its pipeline: the pipeline (which makes
      // the file itself) is offered at once, continuing this request.
      if (pleadingPipelineNeeded(result) && canWriteCase(selectedCase)) {
        setWorkflowRecoveryRequest({
          caseId: executionCaseId,
          text: "Rozpocznij pipeline pisma procesowego dla tej sprawy zgodnie z moją wcześniejszą prośbą.",
          messageId: `pipeline-${userMessage.id}`,
          recovery: { kind: "process-start", acceptOnly: false }
        });
      }
      const letterPlan = letterDocumentPlan(result);
      if (letterPlan && canWriteCase(selectedCase)) {
        await createLetterFile({
          executionCaseId,
          context: [...priorMessages, { id: messageId(), role: "user", content: trimmed }, answerMessage],
          plan: letterPlan,
          route,
          attachments: sendAttachments
        });
      }
    } catch (error) {
      const code =
        error instanceof ApiError
          ? error.code
          : error instanceof Error
            ? error.message
            : String(error);
      const reason =
        error instanceof ApiError
          ? error.reason
          : undefined;
      // A plain analysis request sets the analysis mode itself and goes again.
      const automaticMode = code === "CONTRACT_STATE_REQUIRED" ? automaticContractMode(trimmed) : null;
      let contractModeSet = false;
      if (automaticMode) {
        try {
          await initializeContractAnalysisWorkflow(executionCaseId, automaticMode);
          contractModeSet = true;
        } catch (initError) {
          contractModeSet = initError instanceof ApiError && initError.code === "CONTRACT_STATE_EXISTS";
        }
      }
      if (contractModeSet) {
        setMessages((current) => current.filter((message) => message.id !== userMessage.id));
        setContractRetry({ text: trimmed, messageId: userMessage.id });
        setGeneratedDocumentMessage("Ustawiono tryb „Analiza umowy” dla tej sprawy; wiadomość wysłana ponownie.");
        return;
      }
      if (code === "CONTRACT_STATE_REQUIRED") {
        setContractModeRequest({
          caseId: executionCaseId,
          text: trimmed,
          messageId: userMessage.id,
          suggested: suggestedContractMode(trimmed)
        });
      }
      if (error instanceof ApiError && error.draftAvailable && exportBlockedMessage(error)) {
        setUnverifiedDraftRequest({ caseId: executionCaseId, text: trimmed, messageId: userMessage.id });
      }
      const recovery = workflowRecovery(code, reason);
      if (recovery) {
        setWorkflowRecoveryRequest({
          caseId: executionCaseId,
          text: trimmed,
          messageId: userMessage.id,
          recovery,
          ...(options.switchTo ? { switchTo: options.switchTo } : {})
        });
      }
      if (
        code.startsWith(
          "PROCESS_PLEADING_"
        )
      ) {
        setProcessWorkflowVisible(true);
        setProcessWorkflowRefresh(
          (value) => value + 1
        );
      }
      const friendly =
        exportBlockedMessage(error) ??
        (code ===
          "ACCOUNT_SESSION_CLI_NOT_INSTALLED"
          ? "Tryb konta wymaga oficjalnego klienta dostawcy zainstalowanego osobno. Otwórz Ustawienia → Modele i AI, zainstaluj klienta albo przełącz źródło na API."
        : code ===
            "ACCOUNT_SESSION_LOGIN_NOT_CONFIRMED"
          ? "Nie udało się potwierdzić logowania do wybranego konta. Zakończ oficjalne logowanie w widocznym terminalu lub przeglądarce i spróbuj ponownie."
        : code ===
            "ACCOUNT_SESSION_LOGIN_ADMIN_REQUIRED"
          ? "Wybrane konto dostawcy nie jest zalogowane. Połączenie konta wymaga administratora aplikacji."
        : code ===
            "PRIMARY_MODEL_NOT_READY"
          ? "Wybrany model nie jest jeszcze gotowy do użycia."
        : code === "PROVIDER_NOT_CONFIGURED"
          ? "Brak lokalnego klucza API dla wybranego dostawcy."
          : code === "CHAT_PRIVACY_GATE_FAILED"
            ? "Lokalna pseudonimizacja nie mogła się wykonać, więc zapytanie zostało zatrzymane przed wysłaniem do modelu. Sprawdź lokalny runtime prywatności w panelu Utrzymanie."
          : code === "LOCAL_MODEL_EXECUTION_FAILED"
            ? localModelFailureMessage(
                reason
              )
          : code === "PROVIDER_EXECUTION_FAILED"
            ? provider === "local"
              ? localModelFailureMessage(
                  reason
                )
              : providerFailureMessage(
                  provider,
                  reason,
                  error instanceof ApiError
                    ? error.description
                    : undefined
                )
          : code ===
              "AUTO_ROUTING_FAILED"
            ? `Model nie zwrócił poprawnego wyboru domeny i skilli w trybie AUTO${reason ? ` (kod: ${reason})` : ""}. Lex Machina nie zgaduje routingu zastępczego.`
          : code ===
              "LEGAL_WORKFLOW_EXECUTION_FAILED"
            ? `Deterministyczny workflow prawny zatrzymał wykonanie${
                reason
                  ? ` na etapie: ${reason}`
                  : ""
              }.`
            : code === "DOCUMENT_NOT_REVIEWED"
              ? "Dokument nie jest zatwierdzony po podglądzie. Otwórz go w aktach sprawy („Podgląd i zatwierdzenie”), sprawdź i zatwierdź - wtedy trafi do modelu."
            : code === "DOCUMENT_ATTACHMENT_RESOLUTION_FAILED"
              ? "Nie udało się bezpiecznie dołączyć wybranych fragmentów dokumentu."
              : code === "CONTRACT_STATE_REQUIRED"
                ? "Analiza umowy wymaga jednorazowego wyboru trybu dla tej sprawy. Wybierz go poniżej — wiadomość zostanie wysłana ponownie."
              : code === "CONTRACT_CASE_REQUIRED"
                ? "Analiza umowy musi być powiązana z jedną aktywną sprawą (dołącz plik ze sprawy)."
              : code === "CONTRACT_ALREADY_COMPLETE"
                ? "Analiza umowy w tej sprawie została już zakończona. Możesz rozpocząć nowy etap poniżej — wiadomość zostanie wysłana ponownie."
              : code === "PROCESS_PLEADING_STATE_REQUIRED"
                ? "Pismo procesowe prowadzi pipeline sprawy (etapy, HYBRID-VAL przed plikiem .docx). Uruchom go poniżej — wiadomość zostanie wysłana ponownie."
                : code === "PROCESS_PLEADING_START_ACCEPTANCE_REQUIRED"
                  ? "Pipeline pisma procesowego czeka na Twoją akceptację startu. Zaakceptuj go poniżej — wiadomość zostanie wysłana ponownie."
                  : code === "PROCESS_PLEADING_CONFIRMATION_REQUIRED"
                    ? "Pipeline czeka na potwierdzenie bieżącego checkpointu."
                    : code === "PROCESS_PLEADING_CASE_REQUIRED"
                      ? "Pismo procesowe musi być powiązane z aktywną sprawą."
                      : code === "PROCESS_PLEADING_ALREADY_FINAL"
                        ? "Pismo procesowe tej sprawy ma już status FINAL. Możesz rozpocząć nowe pismo poniżej — wiadomość zostanie wysłana ponownie."
                        : code.startsWith("PROCESS_PLEADING_")
                          ? `Pipeline pisma procesowego zablokował wykonanie: ${code}`
                          : code === "COURT_ANALYSIS_CASE_REQUIRED"
                            ? "Analiza sądowa musi być powiązana z aktywną sprawą."
                            : code === "COURT_ANALYSIS_ALREADY_COMPLETE"
                              ? "Analiza sądowa tej sprawy została już zakończona. Możesz rozpocząć nową poniżej — wiadomość zostanie wysłana ponownie."
                              : code.startsWith("COURT_ANALYSIS_")
                                ? `Pipeline analizy sądowej zablokował wykonanie: ${code}`
                              : code === "ORDERED_WORKFLOW_ALREADY_COMPLETE"
                                ? "Ten etap pracy ze sprawą (analiza dowodów lub przesłuchanie) jest już zakończony. Możesz rozpocząć nowy poniżej — wiadomość zostanie wysłana ponownie."
                              : code === "ORDERED_WORKFLOW_CASE_REQUIRED"
                                ? "Analiza dowodów musi być powiązana z jedną aktywną sprawą (dołącz pliki ze sprawy)."
                              : code.startsWith("ORDERED_WORKFLOW_")
                                ? `Pipeline sprawy zablokował wykonanie: ${code}`
                                : code.startsWith(
                                    "Nie udało się uruchomić lokalnego modelu"
                                  ) ||
                                  code.startsWith(
                                    "Lokalny model wymaga naprawy profilu"
                                  )
                                  ? code
                                  : `Nie udało się wykonać sesji: ${code}`);
      setExecutionError(friendly);
      setExecutionDiagnostic({
        friendly,
        code,
        ...(error instanceof ApiError
          ? {
              status:
                error.status,
              ...(error.reason
                ? {
                    reason:
                      error.reason
                  }
                : {}),
              ...(error.description
                ? {
                    description:
                      error.description
                  }
                : {}),
              ...(error.stage
                ? {
                    stage:
                      error.stage
                  }
                : {}),
              ...(error.trace
                ? {
                    trace:
                      error.trace
                  }
                : {})
            }
          : {
              description:
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : String(error)
            })
      });
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: "system",
          content:
            friendly,
          plainContent: plainErrorMessage(code, friendly, reason)
        }
      ]);
    } finally {
      // Restore the persistent DR bridge after a zero-selection turn.
      if (
        allowedDomains !== null &&
        allowedDomains.length === 0
      ) {
        setAllowedDomainSkills([]);
      }
      setExecuting(false);
      setExecutingCaseId(null);
    }
  }

  // Step 1: the session's grant -> restored text with every value marked.
  async function reviewPendingDocument(): Promise<void> {
    if (
      !pendingFinalDocument ||
      finalDocumentBusy
    ) {
      return;
    }
    setFinalDocumentBusy(true);
    setExecutionError("");
    try {
      const intent = await createDeanonymizationIntent(
        pendingFinalDocument.caseId,
        pendingFinalDocument.artifactId
      );
      // The signed-in session's grant: no second password (the chat shows the data too).
      const authorized = await reauthorizeDeanonymization(
        intent.intent.intentId
      );
      const preview = await previewDeanonymization(
        authorized.grant.grantId
      );
      setFinalReview({
        grantId: authorized.grant.grantId,
        preview,
        overrides: {}
      });
    } catch (error) {
      setExecutionError(
        error instanceof Error
          ? "Nie udało się przygotować podglądu przywróconych danych: " + error.message
          : "Nie udało się przygotować podglądu przywróconych danych."
      );
    } finally {
      setFinalDocumentBusy(false);
    }
  }

  // Step 2: the reviewed (and corrected) values go into the one-time final file.
  async function finalizePendingDocument(): Promise<void> {
    if (!pendingFinalDocument || !finalReview || finalDocumentBusy) {
      return;
    }
    setFinalDocumentBusy(true);
    setExecutionError("");
    try {
      const final = await finalizeDeanonymization(
        finalReview.grantId,
        "LexMachina-final." + pendingFinalDocument.format,
        finalReview.overrides
      );
      if (!final.downloadTicket) {
        throw new Error("SENSITIVE_DOWNLOAD_TICKET_MISSING");
      }
      const blob = await downloadSensitiveArtifact(
        final.downloadTicket.ticketId
      );
      const savedPath = await downloadBlob(blob, final.artifact.filename);
      const corrected = Object.keys(finalReview.overrides).length;
      setPendingFinalDocument(null);
      setFinalReview(null);
      setGeneratedDocumentMessage(
        (savedPath
          ? `Finalny dokument z przywróconymi danymi został zapisany: ${savedPath}.`
          : "Finalny dokument z przywróconymi danymi został utworzony i pobrany.") +
          (corrected > 0 ? ` Ręczne poprawki: ${corrected}.` : "")
      );
      setWorkspaceRefresh((value) => value + 1);
    } catch (error) {
      setExecutionError(
        error instanceof Error
          ? "Nie udało się przywrócić danych do finalnego dokumentu: " +
            error.message +
            (/REAUTH_GRANT_(EXPIRED|ALREADY_USED)/.test(error.message)
              ? ". Podaj hasło ponownie."
              : "")
          : "Nie udało się przywrócić danych do finalnego dokumentu."
      );
      if (error instanceof Error && /REAUTH_GRANT_(EXPIRED|ALREADY_USED)/.test(error.message)) {
        setFinalReview(null);
      }
    } finally {
      setFinalDocumentBusy(false);
    }
  }

  async function sendMessage(): Promise<void> {
    const plain = query.trim();
    if (!plain || executing || caseBusy) return;
    if (!caseId || !selectedCase || selectedCase.archivedAt) {
      setQuery("");
      setPendingFirstMessage(plain);
      await createLocalCase(newCaseName.trim() || suggestedCaseName(plain));
      return;
    }
    await executeMessage(plain);
  }

  async function saveCaseName(): Promise<void> {
    if (!selectedCase || !caseNameDraft.trim()) return;
    setCaseBusy(true);
    setCaseError("");
    try {
      await renameCase(selectedCase.caseId, caseNameDraft.trim());
      await refreshCases(selectedCase.caseId);
      setWorkspaceRefresh(
        (value) => value + 1
      );
    } catch (error) {
      setCaseError(error instanceof Error ? error.message : String(error));
    } finally {
      setCaseBusy(false);
    }
  }

  async function saveSidebarRename(): Promise<void> {
    if (!sidebarRename) return;
    const value = sidebarRename.value.trim();
    const current = matterCases.find((item) => item.caseId === sidebarRename.caseId);
    if (!value || value === current?.displayName) {
      setSidebarRename(null);
      return;
    }
    setCaseBusy(true);
    try {
      await renameCase(sidebarRename.caseId, value);
      await refreshCases(caseId || sidebarRename.caseId);
      if (sidebarRename.caseId === caseId) setCaseNameDraft(value);
      setWorkspaceRefresh((count) => count + 1);
      setSidebarRename(null);
    } catch (error) {
      setSidebarRename({
        ...sidebarRename,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setCaseBusy(false);
    }
  }

  async function saveCaseScheduleEvent(): Promise<void> {
    if (
      !selectedCase ||
      !canWriteCase(
        selectedCase
      ) ||
      !scheduleTitle.trim() ||
      !scheduleStartsAt ||
      caseScheduleBusy
    ) {
      return;
    }

    setCaseScheduleBusy(true);
    setCaseScheduleError("");
    try {
      const created =
        await addCaseScheduleEvent(
          selectedCase.caseId,
          {
            kind:
              scheduleKind,
            title:
              scheduleTitle.trim(),
            startsAt:
              scheduleStartsAt,
            ...(scheduleLocation
              .trim()
              ? {
                  location:
                    scheduleLocation
                      .trim()
                }
              : {}),
            ...(scheduleNotes
              .trim()
              ? {
                  notes:
                    scheduleNotes
                      .trim()
                }
              : {})
          }
        );
      setCaseSchedule(
        (current) =>
          [...current, created]
            .sort(
              (
                left,
                right
              ) =>
                left.startsAt
                  .localeCompare(
                    right.startsAt
                  ) ||
                left.createdAt
                  .localeCompare(
                    right.createdAt
                  )
            )
      );
      setScheduleTitle("");
      setScheduleLocation("");
      setScheduleNotes("");
    } catch (error) {
      setCaseScheduleError(
        error instanceof Error
          ? error.message
          : String(error)
      );
    } finally {
      setCaseScheduleBusy(false);
    }
  }

  async function removeCaseScheduleEvent(
    eventId: string
  ): Promise<void> {
    if (
      !selectedCase ||
      !canWriteCase(
        selectedCase
      ) ||
      caseScheduleBusy
    ) {
      return;
    }

    setCaseScheduleBusy(true);
    setCaseScheduleError("");
    try {
      await deleteCaseScheduleEvent(
        selectedCase.caseId,
        eventId
      );
      setCaseSchedule(
        (current) =>
          current.filter(
            (event) =>
              event.eventId !==
                eventId
          )
      );
    } catch (error) {
      setCaseScheduleError(
        error instanceof Error
          ? error.message
          : String(error)
      );
    } finally {
      setCaseScheduleBusy(false);
    }
  }

  async function toggleArchive(): Promise<void> {
    if (!selectedCase) return;
    setCaseBusy(true);
    setCaseError("");
    try {
      if (selectedCase.archivedAt) {
        await unarchiveCase(selectedCase.caseId);
      } else {
        await archiveCase(selectedCase.caseId);
      }
      await refreshCases(selectedCase.caseId);
    } catch (error) {
      setCaseError(error instanceof Error ? error.message : String(error));
    } finally {
      setCaseBusy(false);
    }
  }

  async function permanentlyDeleteCase(): Promise<void> {
    if (
      !selectedCase ||
      deletePhrase !== "USUŃ" ||
      !deletePassword
    ) return;
    setCaseBusy(true);
    setCaseError("");
    try {
      await deleteCase(selectedCase.caseId, deletePassword);
      setDeletePhrase("");
      setDeletePassword("");
      await refreshCases();
    } catch (error) {
      setCaseError(error instanceof Error ? error.message : String(error));
    } finally {
      setCaseBusy(false);
    }
  }

  const accountCanLoginInline =
    isAccountPrimarySource(
      provider
    ) &&
    user.appRole === "ADMIN" &&
    accountSession?.installed !== false;

  const canSend =
    runtimeOnline &&
    (
      canExecutePrimaryModel(
        providerConfigured,
        model,
        accountAuthenticated
      ) ||
      accountCanLoginInline
    ) &&
    Boolean(model) &&
    Boolean(query.trim()) &&
    !executing &&
    !caseBusy &&
    !selectedCase?.archivedAt &&
    // Picked files that do not fit the model are not sent at all.
    selectedFileCount <= documentLimit &&
    documentFit?.estimate?.fits !== false;

  return (
    <DeveloperModeContext.Provider value={developerMode}>
    <div className="chat-app-shell matter-chat-app">
      {privacyPreview ? (
        <div className="privacy-preview-overlay" role="dialog" aria-modal="true">
          <PrivacyPreview
            {...privacyPreview.request}
            busy={privacyPreviewBusy}
            confirmError={privacyPreviewError}
            onCancel={() => {
              privacyPreview.resolve(null);
              setPrivacyPreviewError("");
              setPrivacyPreview(null);
            }}
            onConfirm={(directives) => {
              setPrivacyPreviewBusy(true);
              setPrivacyPreviewError("");
              void finalizeCaseDocument(privacyPreview.request.caseId, privacyPreview.request.review.documentId, directives, undefined, true)
                .then((result) => {
                  privacyPreview.resolve(result);
                  setPrivacyPreview(null);
                })
                .catch((failure) => setPrivacyPreviewError(privacyConfirmFailure(failure)))
                .finally(() => setPrivacyPreviewBusy(false));
            }}
          />
        </div>
      ) : null}
      <aside className="chat-sidebar">
        <div className="chat-brand">
          <span className="chat-brand-mark">LM</span>
          <div>
            <strong>Lex Machina</strong>
            <small>1 wątek = 1 sprawa<InfoTip>Każdy wątek czatu to osobna sprawa z własnymi dokumentami, pamięcią i terminami.</InfoTip></small>
          </div>
        </div>

        <div className="matter-thread-list" aria-label="Wątki spraw">
          <div className="matter-thread-heading">
            <strong>Sprawy</strong>
            <button
              type="button"
              disabled={caseBusy || executing}
              onClick={() => void createLocalCase(newCaseName.trim() || "Nowa sprawa")}
            >
              + Nowa sprawa
            </button>
          </div>
          <input
            value={newCaseName}
            maxLength={160}
            placeholder="Nazwa nowej sprawy"
            onChange={(event) => setNewCaseName(event.target.value)}
          />
          <div className="matter-thread-items">
            {matterCases.map((item) =>
              sidebarRename?.caseId === item.caseId ? (
                <form
                  key={item.caseId}
                  className="matter-thread-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveSidebarRename();
                  }}
                >
                  <input
                    autoFocus
                    value={sidebarRename.value}
                    maxLength={160}
                    disabled={caseBusy}
                    aria-label="Nowa nazwa sprawy"
                    onChange={(event) =>
                      setSidebarRename({ ...sidebarRename, value: event.target.value, error: "" })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setSidebarRename(null);
                    }}
                  />
                  <div className="matter-thread-rename-actions">
                    <button type="submit" disabled={caseBusy || !sidebarRename.value.trim()}>
                      Zapisz
                    </button>
                    <button type="button" disabled={caseBusy} onClick={() => setSidebarRename(null)}>
                      Anuluj
                    </button>
                  </div>
                  {sidebarRename.error ? (
                    <small className="matter-thread-rename-error">{sidebarRename.error}</small>
                  ) : null}
                </form>
              ) : (
                <div key={item.caseId} className="matter-thread-row">
                  <button
                    type="button"
                    disabled={caseBusy || executing}
                    title={executing ? "Trwa przygotowanie odpowiedzi — sprawę zmienisz po jej zakończeniu" : undefined}
                    aria-busy={item.caseId === executingCaseId}
                    className={[
                      "matter-thread",
                      item.caseId === caseId ? "active" : "",
                      item.caseId === executingCaseId ? "thinking" : ""
                    ].filter(Boolean).join(" ")}
                    onClick={() => {
                      setPendingFirstMessage(null);
                      setExecutionError("");
                      setCaseId(item.caseId);
                      setActiveTab("chat");
                    }}
                  >
                    <strong>
                      {item.caseId === executingCaseId ? (
                        <span className="matter-thread-spinner" role="status" aria-label="Trwa przygotowanie odpowiedzi" />
                      ) : null}
                      {item.displayName || "Sprawa bez nazwy"}
                    </strong>
                    <small>
                      {item.archivedAt ? "archiwalna" : item.role.toLowerCase()}
                    </small>
                  </button>
                  {item.role === "OWNER" ? (
                    <button
                      type="button"
                      className="matter-thread-edit"
                      disabled={caseBusy}
                      title="Zmień nazwę sprawy"
                      aria-label={`Zmień nazwę sprawy ${item.displayName || "bez nazwy"}`}
                      onClick={() =>
                        setSidebarRename({ caseId: item.caseId, value: item.displayName ?? "", error: "" })
                      }
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                        <path
                          d="M11.3 1.9a1.5 1.5 0 0 1 2.1 0l.7.7a1.5 1.5 0 0 1 0 2.1l-8 8-3.3.9.9-3.3 7.6-8.4zM10 4.3l1.7 1.7"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
              )
            )}
          </div>
        </div>

        <nav className="chat-tabs" aria-label="Sekcje aplikacji">
          {([
            ["home", "Start"],
            ["calendar", "Kalendarz"],
            ["chat", "Czat"],
            ["case", "Sprawa"],
            ["firm", "Kancelaria"],
            ["search", "Wyszukiwanie"],
            ["invoices", "Faktury"],
            ["settings", "Ustawienia"]
          ] as Array<[TabId, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={activeTab === id ? "chat-tab chat-tab-active" : "chat-tab"}
              onClick={() => setActiveTab(id)}
            >
              {label}
              {id === "case" && documentDropQueue.files.length + documentStaging.items.length > 0 ? (
                <span title="Pliki czekające na odczyt lub zapis (nie dokumenty sprawy)">
                  {documentDropQueue.files.length + documentStaging.items.length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="chat-sidebar-card">
          <div className="chat-status-line">
            <span className={runtimeOnline ? "chat-dot online" : "chat-dot offline"} />
            <strong>{runtimeOnline ? "Runtime aktywny" : "Runtime offline"}</strong>
          </div>
          <small>
            {selectedCase?.displayName || "Nowy wątek utworzy własną sprawę"}
          </small>
        </div>

        <div className="chat-sidebar-foot">
          <span>prawny-router-v3 ✓</span>
          <span>shared ✓</span>
          <span>
            {selectedDeterministicAction
              ? selectedDeterministicAction.label
              : AUTO_CASE_TYPE}
          </span>
        </div>

        <div className="chat-account-card">
          <div className="chat-account-identity">
            <strong>
              {user.displayName}
            </strong>
            <small>
              @{user.loginName} · {user.appRole}
            </small>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveTab("settings");
              setSettingsSection(
                "security"
              );
            }}
          >
            Ustawienia
          </button>
          <div className="chat-account-actions">
            <button
              type="button"
              onClick={onLock}
              disabled={!onLock}
            >
              Zablokuj
            </button>
            <button
              type="button"
              onClick={onLogout}
              disabled={!onLogout}
            >
              Wyloguj
            </button>
          </div>
        </div>
      </aside>

      <main className="chat-main">
        {activeTab === "chat" ? (
          <section
            className="chat-model-dock"
            aria-label="Aktywny model rozmowy"
          >
            <div className="chat-model-dock-status">
              <span
                className={
                  provider === "local"
                    ? localModelReady
                      ? "chat-dot online"
                      : localModelStarting
                        ? "chat-dot starting"
                        : "chat-dot offline"
                    : runtimeOnline
                      ? "chat-dot online"
                      : "chat-dot offline"
                }
              />
              <div>
                <strong>
                  {selectedModel?.displayName ??
                    (provider === "local"
                      ? "Model lokalny"
                      : "Wybierz model")}
                </strong>
                <small>
                  {provider === "local"
                    ? localModelReady
                      ? "lokalny model · działa"
                      : localModelStarting
                        ? "lokalny model · uruchamianie"
                        : localRuntimeStatus
                          ? "lokalny model · zatrzymany"
                          : "lokalny model · sprawdzanie stanu"
                    : PRIMARY_MODEL_SOURCES.find(
                        (item) =>
                          item.id ===
                          provider
                      )?.label ??
                      provider}
                </small>
                {modelNotice ? (
                  <small className="chat-model-dock-notice" role="status">
                    {modelNotice}{" "}
                    <button type="button" className="chat-link-button" onClick={() => setModelNotice("")}>
                      OK
                    </button>
                  </small>
                ) : null}
              </div>
            </div>
            <div className="chat-model-dock-controls">
              <select
                aria-label="Dostawca modelu głównego"
                value={providerGroupOf(provider)}
                disabled={executing}
                onChange={(event) => {
                  setProvider(sourceOfGroup(event.target.value as ProviderGroup));
                  localAutoStartTried.current = true;
                  setProviderApiKeyInput("");
                  setProviderKeyMessage("");
                  setProviderAccountMessage("");
                  setLocalStartMessage("");
                }}
              >
                {providerGroups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Model główny"
                value={model}
                disabled={
                  executing ||
                  modelCatalogLoading ||
                  models.length === 0
                }
                onChange={(event) => {
                  setModel(
                    event.target.value
                  );
                  saveLastUsedModel(user.userId, { provider, model: event.target.value });
                  setLocalStartMessage("");
                }}
              >
                {modelCatalogLoading ? (
                  <option value="">
                    Odświeżam modele…
                  </option>
                ) : models.length === 0 ? (
                  <option value="">
                    {provider === "local"
                      ? "Brak zainstalowanego modelu"
                      : "Brak modeli"}
                  </option>
                ) : null}
                {models.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={
                      !item.selectable
                    }
                  >
                    {item.displayName}
                  </option>
                ))}
              </select>
              {provider === "local" ? (
                <button
                  type="button"
                  className="chat-primary-action chat-model-start"
                  disabled={
                    executing ||
                    localStartBusy ||
                    localModelReady ||
                    !model.startsWith(
                      "local/"
                    )
                  }
                  onClick={() =>
                    void startSelectedLocalModel()
                  }
                >
                  {localStartBusy ||
                  localModelStarting
                    ? "Uruchamianie…"
                    : localModelReady
                      ? "Model uruchomiony"
                      : "Uruchom lokalny model"}
                </button>
              ) : isAccountPrimarySource(
                  provider
                ) &&
                !accountAuthenticated ? (
                <button
                  type="button"
                  className="chat-secondary-action"
                  disabled={
                    executing ||
                    providerAccountBusy ||
                    user.appRole !==
                      "ADMIN"
                  }
                  onClick={() =>
                    void connectProviderAccount()
                  }
                >
                  {providerAccountBusy
                    ? accountConnectPhase?.kind === "provision"
                      ? "Pobieranie klienta…"
                      : "Logowanie…"
                    : "Połącz konto"}
                </button>
              ) : null}
              <button
                type="button"
                className="chat-secondary-action"
                onClick={() => {
                  setActiveTab(
                    "settings"
                  );
                  setSettingsSection(
                    "models"
                  );
                }}
              >
                Zarządzaj modelami
              </button>
            </div>
            {isAccountPrimarySource(provider) ? (
              <AccountConnectProgress
                phase={accountConnectPhase}
                clientLabel={providerDefinition?.accountClientLabel ?? "klient"}
              />
            ) : null}
            {localStartMessage ? (
              <small
                className={
                  localStartMessage ===
                  "Lokalny model działa."
                    ? "chat-model-dock-message ready"
                    : "chat-model-dock-message"
                }
              >
                {localStartMessage}
              </small>
            ) : null}
          </section>
        ) : null}
        <header className="chat-page-header">
          <div>
            <p className="eyebrow">
              {selectedCase ? selectedCase.displayName || "Sprawa bez nazwy" : "Nowa sprawa"}
            </p>
            <h1>
              {activeTab === "home"
                ? "Start"
                : activeTab === "calendar"
                ? "Kalendarz spraw"
                : activeTab === "chat"
                ? "Czat sprawy"
                : activeTab === "case"
                    ? "Sprawa i dokumenty"
                    : activeTab === "firm"
                      ? "Know-how i wzory kancelarii"
                      : activeTab === "search"
                        ? "Wyszukiwanie w źródłach MCP"
                        : activeTab === "invoices"
                          ? "Faktury"
                          : "Ustawienia"}
            </h1>
          </div>
          <div className="chat-header-actions">
            <div className="chat-case-switcher">
              <label className="chat-case-search">
                <span>Szukaj spraw</span>
                <input
                  type="search"
                  value={caseSearch}
                  placeholder="Nazwa lub ID sprawy"
                  aria-label="Szukaj spraw"
                  onChange={(event) =>
                    setCaseSearch(
                      event.target.value
                    )
                  }
                />
              </label>
              <label className="chat-case-filter">
                <span>Status</span>
                <select
                  aria-label="Filtr statusu spraw"
                  value={caseStatusFilter}
                  onChange={(event) =>
                    setCaseStatusFilter(
                      event.target
                        .value as MatterStatusFilter
                    )
                  }
                >
                  <option value="ALL">
                    Wszystkie
                  </option>
                  <option value="ACTIVE">
                    Aktywne
                  </option>
                  <option value="ARCHIVED">
                    Archiwalne
                  </option>
                </select>
              </label>
              <label className="chat-case-filter">
                <span>Rola</span>
                <select
                  aria-label="Filtr roli w sprawie"
                  value={caseRoleFilter}
                  onChange={(event) =>
                    setCaseRoleFilter(
                      event.target
                        .value as MatterRoleFilter
                    )
                  }
                >
                  <option value="ALL">
                    Wszystkie
                  </option>
                  <option value="OWNER">
                    Owner
                  </option>
                  <option value="EDITOR">
                    Editor
                  </option>
                  <option value="ANALYST">
                    Analyst
                  </option>
                  <option value="VIEWER">
                    Viewer
                  </option>
                </select>
              </label>
              <label className="chat-case-filter">
                <span>Sortuj</span>
                <select
                  aria-label="Sortowanie spraw"
                  value={caseSort}
                  onChange={(event) =>
                    setCaseSort(
                      event.target
                        .value as MatterSort
                    )
                  }
                >
                  <option value="UPDATED_DESC">
                    Ostatnio zmieniane
                  </option>
                  <option value="CREATED_DESC">
                    Najnowsze
                  </option>
                  <option value="NAME_ASC">
                    Nazwa A–Z
                  </option>
                </select>
              </label>
              <label>
                <span>Sprawa</span>
                <select
                  aria-label="Wybierz sprawę"
                  value={caseId}
                  disabled={
                    caseBusy
                  }
                  onChange={(event) =>
                    switchToCase(
                      event.target
                        .value
                    )
                  }
                >
                  {filteredMatterCases.map(
                    (item) => (
                      <option
                        key={
                          item.caseId
                        }
                        value={
                          item.caseId
                        }
                      >
                        {item.displayName ||
                          "Sprawa bez nazwy"}
                        {item.archivedAt
                          ? " · archiwalna"
                          : ""}
                      </option>
                    )
                  )}
                </select>
                {caseSearch.trim() ||
                caseStatusFilter !== "ALL" ||
                caseRoleFilter !== "ALL" ? (
                  <small className="chat-case-search-count">
                    {caseSearchMatchCount} wyników
                    {matterSearchResult.currentPreserved
                      ? " · bieżąca sprawa pokazana dodatkowo"
                      : ""}
                  </small>
                ) : null}
              </label>
              {caseSearch.trim() ||
              caseStatusFilter !== "ALL" ||
              caseRoleFilter !== "ALL" ||
              caseSort !== "UPDATED_DESC" ? (
                <button
                  type="button"
                  className="chat-secondary-action chat-case-filter-reset"
                  onClick={() => {
                    setCaseSearch("");
                    setCaseStatusFilter(
                      "ALL"
                    );
                    setCaseRoleFilter(
                      "ALL"
                    );
                    setCaseSort(
                      "UPDATED_DESC"
                    );
                  }}
                >
                  Wyczyść filtry
                </button>
              ) : null}
              <button
                type="button"
                className="chat-secondary-action"
                disabled={
                  caseBusy
                }
                onClick={() =>
                  void createLocalCase(
                    newCaseName
                      .trim() ||
                      "Nowa sprawa"
                  )
                }
              >
                + Nowa sprawa
              </button>
            </div>
            <button
              type="button"
              className="chat-secondary-action"
              disabled={Boolean(selectedCase?.archivedAt)}
              onClick={() => fileInputRef.current?.click()}
            >
              + Dodaj pliki
            </button>
            <input
              ref={fileInputRef}
              className="chat-hidden-file-input"
              type="file"
              multiple
              accept={DOCUMENT_FILE_ACCEPT}
              onChange={(event) => {
                if (event.target.files) void acceptFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </header>

        {Array.from(
          new Set(
            [runtimeError, caseError, threadError]
              .filter(Boolean)
          )
        ).map((error) => (
          <div key={error} className="chat-alert chat-alert-error">
            {error === "CASE_ACCESS_DENIED"
              ? "Nie udało się otworzyć tej sprawy w bieżącej sesji. Wybierz inną sprawę albo utwórz nową."
              : error}
          </div>
        ))}

        {documentStaging.items.length > 0 ? (
          <section className="chat-card-stack chat-document-flow" aria-label="Pliki do decyzji">
            <article className="chat-card">
              <p className="eyebrow">Dodane pliki</p>
              <h2>
                {documentStaging.items.length} do decyzji
                <InfoTip>
                  OCR nie startuje sam: wybierz sposób dla każdego pliku. AI oznacza model lokalny, tylko do plików.
                  Plik zapisany bez przetwarzania przetworzysz później w zakładce Sprawa.
                </InfoTip>
              </h2>
              {documentStaging.rejected > 0 ? (
                <p className="chat-inline-error">
                  Pominięto {documentStaging.rejected} plików (puste albo ponad limit {MAX_DOCUMENT_DROP_QUEUE}).
                </p>
              ) : null}
              <ul className="chat-file-list">
                {documentStaging.items.map((item) => (
                  <li key={item.id}>
                    <strong>{item.file.name}</strong>
                    <small>
                      {describeDocumentFile(item.file)}
                      {item.status === "SAVING"
                        ? documentProgress[item.id]
                          ? ` · ${progressLabel(documentProgress[item.id]!)}`
                          : " · zapisuję i przetwarzam…"
                        : ""}
                      {item.status === "FAILED" ? ` · nie zapisano: ${item.error ?? "spróbuj ponownie"}` : ""}
                    </small>
                    <span className="chat-file-actions">
                      <select
                        aria-label={`Sposób przetwarzania: ${item.file.name}`}
                        value={item.mode}
                        disabled={item.status === "SAVING"}
                        title={DOCUMENT_PROCESSING_MODES.find((entry) => entry.mode === item.mode)?.title}
                        onChange={(event) =>
                          setDocumentStaging((current) =>
                            setStagedDocumentMode(current, item.id, event.target.value as DocumentProcessingMode)
                          )
                        }
                      >
                        {DOCUMENT_PROCESSING_MODES.map((entry) => (
                          <option key={entry.mode} value={entry.mode} title={entry.title}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="chat-secondary-action"
                        disabled={item.status === "SAVING" || !caseId}
                        onClick={() => processStagedDocuments([item.id])}
                      >
                        Przetwórz
                      </button>
                      <button
                        type="button"
                        className="chat-secondary-action"
                        disabled={item.status === "SAVING" || !caseId}
                        onClick={() => void saveStagedDocuments([item.id])}
                      >
                        Zapisz bez przetwarzania
                      </button>
                      <button
                        type="button"
                        className="chat-secondary-action"
                        disabled={item.status === "SAVING"}
                        onClick={() => removeStagedDocuments([item.id])}
                      >
                        Usuń
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {documentStaging.items.length > 1 ? (
                <span className="chat-file-actions">
                  <button type="button" className="chat-secondary-action" onClick={() => processStagedDocuments()}>
                    Przetwórz wszystkie (wybrane sposoby)
                  </button>
                  <button
                    type="button"
                    className="chat-secondary-action"
                    disabled={!caseId}
                    onClick={() => void saveStagedDocuments()}
                  >
                    Zapisz wszystkie bez przetwarzania
                  </button>
                </span>
              ) : null}
            </article>
          </section>
        ) : null}

        {documentDropQueue.total > 0 ? (
          <section className="chat-card-stack chat-document-flow" aria-label="Odczyt plików i ochrona danych">
            <article className="chat-card">
              <p className="eyebrow">
                Dodawanie plików
                <InfoTip>
                  Pliki są odczytywane na tym komputerze, po jednym. Przed zapisem w aktach decydujesz, które dane
                  osobowe ukryć.
                </InfoTip>
              </p>
              <h2 aria-live="polite">{documentDropSummary(documentDropQueue)}</h2>
              {documentDropQueue.rejected > 0 ? (
                <p className="chat-inline-error">
                  Nie dodano plików: {documentDropQueue.rejected} (puste albo ponad limit {MAX_DOCUMENT_DROP_QUEUE} w kolejce).
                </p>
              ) : null}
              <ul className="chat-file-list">
                {documentDropQueue.files.slice(0, 12).map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    <strong>{file.name}</strong>
                    <small>
                      {index === 0 ? documentStepLabel(file) : "Oczekuje"} · {describeDocumentFile(file)}
                    </small>
                  </li>
                ))}
              </ul>
              <small>limit kolejki {MAX_DOCUMENT_DROP_QUEUE}</small>
            </article>

            <DocumentPrivacyPanel
              caseId={caseId}
              incomingFile={documentDropQueue.files[0] ?? null}
              queuedFiles={documentDropQueue.files}
              processingOptionsFor={(file) => {
                const mode = reviewModes.current.get(file);
                return mode ? processingModeOptions(mode) : undefined;
              }}
              onIncomingFileConsumed={(outcome) =>
                setDocumentDropQueue((current) => consumeDocumentDropFile(current, outcome))
              }
              onCaseFilesChange={() =>
                setWorkspaceRefresh((value) => value + 1)
              }
              onAttachmentSelectionChange={(selection) => {
                if (!selection) return;
                setDocumentAttachments((current) => upsertAttachment(current, selection));
              }}
            />
          </section>
        ) : null}

        {activeTab === "chat" ? (
          <section
            className={dropActive ? "chat-panel chat-drop-active" : "chat-panel"}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                dragDepth.current += 1;
                setDropActive(true);
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDropActive(true);
              }
            }}
            onDragLeave={() => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDropActive(false);
            }}
            onDrop={handleDrop}
          >
            <ProcessPleadingWorkflowPanel
              caseId={caseId}
              forceVisible={processWorkflowVisible}
              refreshToken={processWorkflowRefresh}
              canWrite={Boolean(
                selectedCase &&
                !selectedCase.archivedAt &&
                canWriteCase(selectedCase)
              )}
              busy={executing || caseBusy}
              onContinue={() => {
                void executeMessage(
                  "Kontynuuj pipeline pisma procesowego zgodnie z aktywnym checkpointem."
                );
              }}
              onDownloadDraft={() => {
                void executeMessage(
                  "Przygotuj plik docx: pismo procesowe z zapisanego projektu sprawy."
                );
              }}
            />
            {conversationIsNew ? (
              <section
                className="chat-pipeline-picker"
                aria-label="Tryb pracy dla nowej rozmowy"
              >
                <div>
                  <p className="eyebrow">Tryb pracy</p>
                  <h3>
                    {workMode === "AUTO"
                      ? developerMode ? "Automatyczny — prawny router" : "Automatyczny"
                      : selectedDeterministicAction
                        ? `Mechaniczny — ${selectedDeterministicAction.label}`
                        : developerMode ? "Mechaniczny — wybierz skill wykonawczy" : "Mechaniczny — wybierz rodzaj pracy"}
                    <InfoTip>
                      {!developerMode
                        ? workMode === "AUTO"
                          ? "Aplikacja sama rozpoznaje dziedzinę prawa i sposób pracy z treści wiadomości."
                          : "Wybrany rodzaj pracy przebiega stałymi etapami. Po pierwszej wiadomości wybór zostaje przypięty do wątku."
                        : workMode === "AUTO"
                        ? "Router dobiera dziedziny DR, skille i moduły z treści wiadomości. Pytania bez kwestii prawnej nie ładują skilli prawnych."
                        : "Wybrany skill uruchamia stały pipeline; router nadal dobiera dziedzinę DR. Po pierwszej wiadomości wybór zostaje przypięty do wątku."}
                    </InfoTip>
                  </h3>
                </div>
                <div
                  className="chat-work-mode"
                  role="radiogroup"
                  aria-label="Tryb pracy"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={workMode === "AUTO"}
                    className={
                      workMode === "AUTO"
                        ? "chat-pipeline-option selected"
                        : "chat-pipeline-option"
                    }
                    onClick={() => {
                      selectDeterministicAction("");
                      setWorkMode("AUTO");
                    }}
                  >
                    <strong>Automatyczny</strong>
                    <small>{developerMode ? "Router sam dobiera skille i moduły." : "Aplikacja sama dobiera sposób pracy."}</small>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={workMode === "MECHANICAL"}
                    disabled={availableActions.length === 0}
                    className={
                      workMode === "MECHANICAL"
                        ? "chat-pipeline-option selected"
                        : "chat-pipeline-option"
                    }
                    onClick={() => setWorkMode("MECHANICAL")}
                  >
                    <strong>Mechaniczny</strong>
                    <small>
                      {availableActions.length > 0
                        ? developerMode
                          ? "Ty wybierasz skill wykonawczy i jego pipeline."
                          : "Ty wybierasz rodzaj pracy (np. pismo, analiza umowy)."
                        : developerMode
                          ? "Brak skilli wykonawczych w korpusie."
                          : "Brak dostępnych rodzajów pracy."}
                    </small>
                  </button>
                </div>
                {workMode === "MECHANICAL" ? (
                  <div className="chat-pipeline-options">
                    {availableActions.map((action) => {
                      const checked =
                        deterministicAction ===
                        action.id;
                      return (
                        <button
                          key={action.id}
                          type="button"
                          className={
                            checked
                              ? "chat-pipeline-option selected"
                              : "chat-pipeline-option"
                          }
                          aria-pressed={checked}
                          onClick={() =>
                            selectDeterministicAction(
                              action.id
                            )
                          }
                        >
                          <strong>
                            {action.label}
                          </strong>
                          <small>
                            {action.description}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="chat-message-list" aria-live="polite">
              {threadLoading ? (
                <article className="chat-message chat-message-system">
                  Ładowanie zaszyfrowanego wątku sprawy…
                </article>
              ) : null}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`chat-message chat-message-${message.role}`}
                >
                  <div className="chat-message-role">
                    {message.role === "user"
                      ? "Ty"
                      : message.role === "assistant"
                        ? "Lex Machina"
                        : "System"}
                  </div>
                  <DocumentCitationContent
                    content={visibleContent(message, developerMode)}
                    citations={message.documentCitations}
                    onOpenUrl={openExternalUrl}
                    {...(selectedCase?.caseId ? { caseId: selectedCase.caseId } : {})}
                    {...(message.evidence?.length ? { sources: verifiedSources(message.evidence) } : {})}
                    markdown={message.role === "assistant"}
                  />
                  {message.role === "assistant" &&
                  (message.restorations?.length ||
                    unresolvedPlaceholders(message.content).length) ? (
                    <RestorationReview
                      key={`${message.id}-${message.content.length}`}
                      content={message.content}
                      marks={validMarks(message.content, message.restorations)}
                      unresolved={unresolvedPlaceholders(message.content)}
                      readOnly={!canWriteCase(selectedCase)}
                      onCorrect={async (index, text, remember) => {
                        const marks = validMarks(message.content, message.restorations);
                        const mark = marks[index];
                        if (remember && mark?.canonical && mark.gender && mark.case) {
                          await saveNameForm({
                            canonical: mark.canonical,
                            gender: mark.gender,
                            case: mark.case,
                            text: text.trim()
                          });
                        }
                        const corrected = applyRestorationCorrection(
                          message.content,
                          marks,
                          index,
                          text
                        );
                        await updateMessage({
                          ...message,
                          content: corrected.content,
                          restorations: corrected.marks
                        });
                      }}
                    />
                  ) : null}
                  {message.widgets?.map((widget, index) => (
                    <ChatWidgetCard
                      key={`${message.id}-widget-${index}`}
                      widget={widget}
                      onPrompt={(text) => {
                        // Widget w trakcie odpowiedzi: tekst czeka w polu wiadomości.
                        if (executing || caseBusy || !caseId) {
                          setQuery(text);
                          return;
                        }
                        void executeMessage(text);
                      }}
                    />
                  ))}
                  {message.role === "assistant" && message.answerDocument && caseId && canWriteCase(selectedCase) ? (
                    <div className="chat-pipeline-next" role="note">
                      <button type="button" className="primary-button" disabled={executing} onClick={() => void fileFromAnswer(message, true)}>
                        Pobierz .docx
                      </button>
                      <InfoTip>
                        {developerMode
                          ? "Plik .docx z pisma powyżej, w formacie kancelaryjnym (Times New Roman 12, strony, tytuł, podpis): powstaje mechanicznie z tekstu tej odpowiedzi, bez ponownej pracy modelu. Przed zapisem przechodzi HYBRID-VAL i bramkę eksportu (przepisy z rejestru weryfikacji tej odpowiedzi); znaczniki weryfikacji nie trafiają do pliku."
                          : "Plik .docx z pisma powyżej, w formacie kancelaryjnym (Times New Roman 12, strony, tytuł, podpis): powstaje z tekstu tej odpowiedzi, bez ponownej pracy modelu. Przed zapisem przechodzi kontrolę powołanych przepisów; znaczniki weryfikacji nie trafiają do pliku."}
                      </InfoTip>
                    </div>
                  ) : null}
                  {message.generatedDocument && caseId ? (
                    <ChatDocumentCard
                      caseId={caseId}
                      document={message.generatedDocument}
                      canWrite={canWriteCase(selectedCase)}
                      filename={artifactNames[message.generatedDocument.artifactId]}
                      onRenamed={rememberArtifactName}
                    />
                  ) : null}
                  {visibleMessageMeta(message.meta, developerMode) ? (
                    <small className="chat-message-meta">
                      {visibleMessageMeta(message.meta, developerMode)}
                    </small>
                  ) : null}
                  {message.evidence?.length ? (
                    <details className="chat-evidence">
                      <summary>Źródła i weryfikacja ({message.evidence.length})</summary>
                      <ul>
                        {message.evidence.map((item: EvidenceItem, index: number) => (
                          <li key={`${item.claim}-${index}`}>
                            <span className="chat-evidence-meta">
                              <b>{item.status}</b>
                              <span>· {item.kind}</span>
                              {item.sourceTier ? (
                                <span className={`chat-source-tier chat-source-tier-${item.sourceTier.toLocaleLowerCase("en")}`}>
                                  {item.sourceTier}
                                </span>
                              ) : null}
                              {item.role === "gate" ? (
                                developerMode ? (
                                  <span className="chat-evidence-gate" title="Przepis sprawdzony przez model tylko na potrzeby bramek (np. sąsiednie artykuły w WYJ-GATE), nie jest podstawą odpowiedzi">
                                    pomocniczy — bramka
                                  </span>
                                ) : (
                                  <span className="chat-evidence-gate" title="Przepis sprawdzony pomocniczo, nie jest podstawą odpowiedzi">
                                    pomocniczy
                                  </span>
                                )
                              ) : null}
                            </span>
                            <strong>{item.claim}</strong>
                            {item.sourceUrl ? (
                              <a
                                className="source-inline-link"
                                href={item.sourceAnchorUrl ?? item.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => {
                                  event.preventDefault();
                                  void openExternalUrl(item.sourceAnchorUrl ?? item.sourceUrl!);
                                }}
                              >
                                Otwórz źródło w przeglądarce ↗
                              </a>
                            ) : null}
                            {item.kind === "statute" ? (
                              <>
                                <button
                                  type="button"
                                  className="chat-secondary-action chat-provision-preview-toggle"
                                  onClick={() => {
                                    const key = `${message.id}:${index}`;
                                    setProvisionPreview((current) => (current === key ? null : key));
                                  }}
                                >
                                  {provisionPreview === `${message.id}:${index}` ? "Zwiń podgląd" : "Podgląd z zaznaczeniem"}
                                </button>
                                {provisionPreview === `${message.id}:${index}` ? (
                                  <ProvisionPreview claim={item.claim} {...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {})} />
                                ) : null}
                              </>
                            ) : item.sourceUrl && (item.kind === "case" || isCaseLawSource(item.sourceUrl)) ? (
                              <>
                                <button
                                  type="button"
                                  className="chat-secondary-action chat-provision-preview-toggle"
                                  onClick={() => {
                                    const key = `${message.id}:${index}`;
                                    setProvisionPreview((current) => (current === key ? null : key));
                                  }}
                                >
                                  {provisionPreview === `${message.id}:${index}` ? "Zwiń pełny tekst" : "Pełny tekst z zaznaczeniem"}
                                </button>
                                {provisionPreview === `${message.id}:${index}` ? (
                                  <CaseLawPreview
                                    sourceUrl={item.sourceUrl}
                                    {...(item.passage ? { passage: item.passage } : {})}
                                    {...(item.caseSignature ? { signature: item.caseSignature } : {})}
                                    {...(attributedSentence(message.content, item.caseSignature) ? { attributed: attributedSentence(message.content, item.caseSignature)! } : {})}
                                    onSaveToCase={saveCaseLawToCase}
                                    caseId={caseId}
                                  />
                                ) : null}
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {developerMode && message.mandatoryPath ? <MandatoryPathDetails path={message.mandatoryPath} /> : null}
                  {developerMode && message.corrections?.length ? <CorrectionsDetails corrections={message.corrections} /> : null}
                  {message.documentCoverage?.length ? (
                    <CoverageLine entries={message.documentCoverage} label={(entry) => fileLabel(entry.documentId, entry.title)} />
                  ) : null}
                  {message.pipelineNext ? (
                    <PipelineChoices
                      developer={developerMode}
                      next={message.pipelineNext}
                      auto={workMode === "AUTO"}
                      disabled={executing}
                      onChoose={(text) => void executeMessage(text)}
                      onDocument={
                        message.role === "assistant" && (message.answerDocument || looksLikeLetter(message.content)) && canWriteCase(selectedCase)
                          ? () => void fileFromAnswer(message)
                          : undefined
                      }
                      onLongDocument={canWriteCase(selectedCase) ? (longDocumentId) => void fileFromLongDocument(message, longDocumentId) : undefined}
                    />
                  ) : null}
                  {message.sourceVerification ? (
                    <SnVerification
                      verification={{ url: message.sourceVerification.url }}
                      onVerified={() => {
                        const index = messages.findIndex((item) => item.id === message.id);
                        const question = messages.slice(0, index).reverse().find((item) => item.role === "user")?.content;
                        if (question && !executing) void executeMessage(question);
                      }}
                    />
                  ) : null}
                  {message.auxiliarySources?.length ? (
                    <details className="chat-auxiliary-sources">
                      <summary>
                        Źródła pomocnicze R2B/R3 ({message.auxiliarySources.length})
                      </summary>
                      <p className="chat-auxiliary-intro">
                        Materiały pomocnicze nie tworzą znacznika VERIFIED ani samodzielnej podstawy prawnej.
                      </p>
                      <ul>
                        {message.auxiliarySources.map((item, index) => (
                          <li
                            key={`${item.sourceUrl}-${item.claim ?? ""}-${index}`}
                            className={item.conflict ? "conflict" : ""}
                          >
                            <div className="chat-auxiliary-source-head">
                              <span className={`chat-source-tier chat-source-tier-${item.sourceTier.toLocaleLowerCase("en")}`}>
                                {item.sourceTier}
                              </span>
                              <strong>
                                {item.claim || "Materiał pomocniczy"}
                              </strong>
                            </div>
                            <small>
                              Cross-check: {
                                item.crossCheckStatus === "CONFIRMED_R1_R2A"
                                  ? `potwierdzony w ${item.crossCheckTier ?? "R1/2A"}`
                                  : item.crossCheckStatus === "CONFLICT"
                                    ? "konflikt ze źródłem wyższego rzędu"
                                    : item.crossCheckStatus === "UNAVAILABLE"
                                      ? "niedostępny"
                                      : "wymagany / oczekuje"
                              }
                            </small>
                            {item.staleOrUndatedWarning ? (
                              <small className="chat-source-warning">
                                Uwaga: brak aktualnej daty albo materiał starszy niż 24 miesiące.
                              </small>
                            ) : null}
                            {item.conflict ? (
                              <small className="chat-source-warning">
                                Uwaga: nie buduj wniosku na tym materiale; pierwszeństwo ma R1/2A.
                              </small>
                            ) : null}
                            <div className="chat-auxiliary-source-links">
                              <a
                                className="source-inline-link"
                                href={item.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => {
                                  event.preventDefault();
                                  void openExternalUrl(item.sourceUrl);
                                }}
                              >
                                Otwórz źródło pomocnicze ↗
                              </a>
                              {isCaseLawSource(item.sourceUrl) ? (
                                <button
                                  type="button"
                                  className="chat-secondary-action chat-provision-preview-toggle"
                                  onClick={() => {
                                    const key = `${message.id}:aux:${index}`;
                                    setProvisionPreview((current) => (current === key ? null : key));
                                  }}
                                >
                                  {provisionPreview === `${message.id}:aux:${index}` ? "Zwiń pełny tekst" : "Pełny tekst z zaznaczeniem"}
                                </button>
                              ) : null}
                              {item.crossCheckUrl ? (
                                <a
                                  className="source-inline-link"
                                  href={item.crossCheckUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    void openExternalUrl(item.crossCheckUrl!);
                                  }}
                                >
                                  Otwórz cross-check {item.crossCheckTier ?? "R1/2A"} ↗
                                </a>
                              ) : null}
                            </div>
                            {provisionPreview === `${message.id}:aux:${index}` ? (
                              <CaseLawPreview
                                sourceUrl={item.sourceUrl}
                                {...(item.claim ? { signature: item.claim } : {})}
                                {...(attributedSentence(message.content, item.claim) ? { attributed: attributedSentence(message.content, item.claim)! } : {})}
                                onSaveToCase={saveCaseLawToCase}
                                caseId={caseId}
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </article>
              ))}
              {executing ? (
                <article
                  className="chat-message chat-message-assistant chat-thinking chat-working-status"
                  role="status"
                  aria-live="polite"
                >
                  <div className="chat-message-role">
                    Lex Machina
                  </div>
                  <div className="chat-working-head">
                    <span
                      className="chat-working-spinner"
                      aria-hidden="true"
                    />
                    <strong>Pracuję</strong>
                    <span>
                      {executionElapsedSeconds}s
                    </span>
                  </div>
                  <div className="chat-message-content">
                    {executionStage}
                  </div>
                  {(messages.at(-1)?.meta ?? "").startsWith("automatycznie") && !autoStopRef.current ? (
                    <button
                      type="button"
                      className="chat-link-button"
                      onClick={() => {
                        autoStopRef.current = true;
                        setAutoNext(null);
                        setGeneratedDocumentMessage("Automatyczne kroki zatrzymane po bieżącym kroku. Napisz „Kontynuuj”, aby iść dalej.");
                      }}
                    >
                      Zatrzymaj automatyczne kroki
                    </button>
                  ) : null}
                  {executionSteps ? (
                    <ol className="chat-steps" aria-label="Etapy pracy">
                      <li className="chat-steps-summary">
                        Etap {executionSteps.current} z {executionSteps.total} · zakończone:{" "}
                        {executionSteps.phases.filter((phase) => phase.status === "done").length} · pozostało:{" "}
                        {executionSteps.phases.filter((phase) => phase.status !== "done").length}
                      </li>
                      {executionSteps.phases.map((phase) => (
                        <li key={phase.key} className={`chat-step chat-step-${phase.status}`}>
                          <span className="chat-step-status">
                            {phase.status === "done" ? "zakończono" : phase.status === "active" ? "w toku" : "oczekuje"}
                          </span>
                          <strong>{phaseLabel(phase.key, phase.label, developerMode)}</strong>
                          {developerMode && phase.details.length ? (
                            <small>{phase.details.slice(-6).join(" · ")}</small>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {draftText ? (
                    <div className="chat-draft">
                      <div className="chat-draft-label">
                        Wersja robocza — odpowiedź powstaje, weryfikacja źródeł jeszcze trwa
                      </div>
                      <div className="chat-draft-text">
                        {draftText}
                      </div>
                    </div>
                  ) : null}
                  <div className="chat-working-meta">
                    <span>
                      {runtimePulse === "OK"
                        ? developerMode ? "Runtime odpowiada" : "Aplikacja pracuje"
                        : runtimePulse === "LOST"
                          ? developerMode
                            ? "Brak odpowiedzi z runtime — operacja nadal oczekuje"
                            : "Aplikacja chwilowo nie odpowiada — operacja nadal oczekuje"
                          : developerMode ? "Sprawdzam runtime…" : "Sprawdzam połączenie…"}
                    </span>
                    <span>
                      To okno aktualizuje się podczas oczekiwania na model i źródła.
                    </span>
                  </div>
                </article>
              ) : null}
              <div ref={chatEndRef} />
            </div>

            <div className="chat-composer">
              {dropActive ? (
                <div className="chat-drop-overlay">
                  Upuść pliki, aby dodać je do tej sprawy
                </div>
              ) : null}
              <div className="chat-composer-meta">
                <span>Sprawa: {selectedCase?.displayName || "utworzy się przy pierwszej wiadomości"}</span>
                <span>
                  Działanie: {selectedDeterministicAction
                    ? selectedDeterministicAction.label
                    : developerMode ? "AUTO · prawny router" : "automatycznie"}
                </span>
                <span>Załączniki: {selectedFileCount}</span>
                {firmTemplateIds.length > 0 ||
                documentAttachments.some((attachment) =>
                  caseFiles.some(
                    (file) =>
                      file.processing?.documentId === attachment.documentId &&
                      file.processing.anonymized === false
                  )
                ) ? (
                  <span className="chat-clear-text-warning">Uwaga: część załączników to tekst jawny</span>
                ) : null}
              </div>
              <UnfinishedAnalysis
                items={unfinishedDocuments(messages)}
                label={(item) => fileLabel(item.documentId, item.title)}
                disabled={executing || Boolean(selectedCase?.archivedAt)}
                onFinish={(text) => void executeMessage(text)}
              />
              {lastDelivery ? (
                <div className="chat-delivery" role="status">
                  <strong>
                    Do modelu trafiło w całości:{" "}
                    {lastDelivery.documents.filter((document) => document.status === "FULL").length} z{" "}
                    {lastDelivery.documents.length} plików
                    {lastDelivery.documents.some((document) => document.status !== "FULL")
                      ? " - reszta skrócona lub pominięta (brak miejsca w oknie modelu)"
                      : ""}
                  </strong>
                  <details>
                    <summary>Szczegóły wysyłki</summary>
                    <ul>
                      {lastDelivery.documents.map((document) => (
                        <li key={document.documentId} className={`chat-delivery-${document.status.toLowerCase()}`}>
                          <span>{lastDelivery.names[document.documentId]}</span>
                          <small>
                            {document.sourceScope === "FIRM_TEMPLATE"
                              ? "wzór kancelarii · "
                              : document.sourceScope === "FIRM_KNOWLEDGE"
                                ? "kancelaria · "
                                : document.sourceScope === "CASE_KNOWLEDGE"
                                  ? "wyszukane w sprawie · "
                                  : ""}
                            {document.status === "FULL"
                              ? `w całości (${document.chunks} ${document.chunks === 1 ? "fragment" : "fragmentów"})`
                              : document.status === "PARTIAL"
                                ? `częściowo: ${document.fullChunks + document.digestChunks} z ${document.chunks} fragmentów`
                                : document.status === "DIGEST"
                                  ? "tylko streszczenie fragmentów"
                                  : "pominięty - brak miejsca w oknie modelu"}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <button type="button" className="chat-secondary-action" onClick={() => setLastDelivery(null)}>
                    Ukryj
                  </button>
                </div>
              ) : null}
              <textarea
                value={query}
                maxLength={20_000}
                disabled={Boolean(selectedCase?.archivedAt)}
                placeholder={
                  selectedCase?.archivedAt
                    ? "Sprawa archiwalna jest tylko do odczytu."
                    : "Napisz wiadomość. Jeśli nie ma sprawy, pierwszy wpis utworzy dla niego osobny katalog i wątek…"
                }
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (canSend) void sendMessage();
                  }
                }}
              />
              <div className="chat-composer-actions">
                <button
                  type="button"
                  className="chat-secondary-action"
                  aria-expanded={
                    caseFilePickerOpen
                  }
                  onClick={() => {
                    const opening = !caseFilePickerOpen;
                    setCaseFilePickerOpen(opening);
                    if (opening) setFirmPickerReload((value) => value + 1);
                    // Files added in the Sprawa tab since the list was read.
                    if (opening && caseId) {
                      setCaseFilesRetries(0);
                      setCaseFilesReload((value) => value + 1);
                    }
                  }}
                >
                  Pliki{selectedFileCount ? ` (${selectedFileCount})` : ""}
                </button>
                {developerMode ? (
                  <button
                    type="button"
                    className="chat-secondary-action"
                    onClick={() => {
                      setSettingsSection("skills");
                      setActiveTab("settings");
                    }}
                  >
                    ⚙ Skille
                  </button>
                ) : null}
                <span className="chat-composer-spacer" />
                <button
                  type="button"
                  className="chat-primary-action"
                  disabled={!canSend}
                  onClick={() => void sendMessage()}
                >
                  {executing || pendingFirstMessage ? "Wysyłanie…" : "Wyślij"}
                </button>
              </div>
              {caseFilePickerOpen ? (
                <div
                  className="chat-case-file-picker"
                  aria-label="Pliki do dołączenia"
                >
                  <div className="chat-file-picker-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={pickerTab === "case"}
                      onClick={() => setPickerTab("case")}
                    >
                      Dokumenty sprawy ({documentAttachments.filter((attachment) => attachment.caseId !== firmCaseId).length})
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={pickerTab === "firm"}
                      disabled={!firmCaseId}
                      title={firmCaseId ? undefined : "Biblioteka kancelarii nie jest jeszcze utworzona (zakładka Kancelaria)"}
                      onClick={() => setPickerTab("firm")}
                    >
                      Wzory i know-how kancelarii ({selectedFirmKeys.size})
                    </button>
                    <span className="chat-file-picker-count">
                      {selectedFileCount} z {documentLimit} plików
                    </span>
                  </div>
                  {pickerNotice ? <p className="chat-inline-error" role="status">{pickerNotice}</p> : null}
                  {documentFit?.estimate ? (
                    <div
                      className={`chat-file-fit ${documentFit.estimate.fits ? "" : "chat-file-fit-over"}`}
                      role="status"
                    >
                      <div className="chat-file-fit-bar">
                        <span
                          style={{
                            width: `${Math.min(100, Math.round((documentFit.estimate.neededTokens / Math.max(1, documentFit.estimate.budgetTokens)) * 100))}%`
                          }}
                        />
                      </div>
                      <small>
                        Okno modelu na dokumenty: ~{Math.round(documentFit.estimate.neededTokens / 1000)} tys. z{" "}
                        {Math.round(documentFit.estimate.budgetTokens / 1000)} tys. tokenów
                        {documentFit.estimate.fits
                          ? ""
                          : ` - za dużo; największe: ${[...documentFit.estimate.documents]
                              .sort((left, right) => right.tokens - left.tokens)
                              .slice(0, 3)
                              .map((document) => `${fileLabel(document.documentId, document.title)} (~${Math.round(document.tokens / 1000)} tys.)`)
                              .join(", ")}. Odznacz część plików; wysyłka jest zablokowana.`}
                      </small>
                    </div>
                  ) : null}
                  {pickerTab === "firm" && firmCaseId ? (
                    <FirmFilePicker
                      firmCaseId={firmCaseId}
                      selected={selectedFirmKeys}
                      reloadToken={firmPickerReload}
                      onChange={(picks, select) => pickFiles(picks, select, firmCaseId)}
                      onNames={setFirmFileNames}
                    />
                  ) : (
                  <>
                  <div className="chat-case-file-picker-head">
                    <strong>
                      Dokumenty sprawy
                      <InfoTip>
                        Zaznaczone pliki idą z wiadomością, z numerami stron. Plik zanonimizowany trafia do modelu
                        tylko w wersji z symbolami, plik bez anonimizacji jako tekst jawny.
                      </InfoTip>
                    </strong>
                    <button
                      type="button"
                      className="chat-secondary-action"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Dodaj pliki do sprawy
                    </button>
                  </div>
                  {(() => {
                    const view = caseFileListView(caseFilesLoad, caseId, caseFiles.length, caseFilesRetrying);
                    if (view.kind === "failed") {
                      return (
                        <p className="chat-inline-error" role="alert">
                          {view.text}{" "}
                          <button
                            type="button"
                            className="chat-secondary-action"
                            disabled={caseFilesLoad?.status === "loading"}
                            onClick={() => {
                              setCaseFilesRetries(0);
                              setCaseFilesReload((value) => value + 1);
                            }}
                          >
                            Spróbuj ponownie
                          </button>
                        </p>
                      );
                    }
                    if (view.kind === "loading") return <small role="status">{view.text}</small>;
                    if (view.kind === "empty") return <small>{view.text}</small>;
                    return null;
                  })()}
                  {caseFiles.length === 0 ? null : (
                    <ul className="chat-case-file-picker-list">
                      {caseFiles.map(
                        (item) => {
                          const ready =
                            Boolean(
                              item.processing &&
                              item.processing.chunkIndices.length > 0
                            );
                          const selected =
                            Boolean(
                              item.processing &&
                              documentAttachments.some(
                                (attachment) =>
                                  attachment.documentId ===
                                    item.processing!.documentId
                              )
                            );
                          return (
                            <li
                              key={
                                item.uploadId
                              }
                            >
                              <label>
                                <input
                                  type="checkbox"
                                  disabled={
                                    !ready
                                  }
                                  checked={
                                    selected
                                  }
                                  onChange={(event) => {
                                    const processing = item.processing;
                                    if (!processing) return;
                                    pickFiles(
                                      [{ kind: "document", documentId: processing.documentId, chunkIndices: processing.chunkIndices }],
                                      event.target.checked,
                                      caseId
                                    );
                                  }}
                                />
                                <span>
                                  <strong>
                                    {item.filename}
                                  </strong>
                                  <small
                                    className={
                                      caseFileErrors[item.uploadId] && pickerAnonymizing !== item.uploadId
                                        ? "chat-source-warning"
                                        : undefined
                                    }
                                  >
                                    {caseFileStatusText(item, {
                                      busy: pickerAnonymizing === item.uploadId,
                                      progress: documentProgress[item.uploadId],
                                      error: caseFileErrors[item.uploadId]
                                    })}
                                  </small>
                                </span>
                              </label>
                              {!item.processing && canWriteCase(selectedCase) ? (
                                <>
                                <button
                                  type="button"
                                  className="chat-secondary-action"
                                  disabled={pickerAnonymizing !== null}
                                  onClick={() => {
                                    setPickerAnonymizing(item.uploadId);
                                    setCaseFileErrors(({ [item.uploadId]: _cleared, ...rest }) => rest);
                                    void withDocumentProgress(item.uploadId, caseId, (progressId) =>
                                      processStoredCaseFile(caseId, item.uploadId, undefined, progressId)
                                    )
                                      .then((review) => previewThenFinalize(caseId, review, item.filename, false))
                                      .then((result) => {
                                        if (!result) return;
                                        pickFiles(
                                          [{ kind: "document", documentId: result.documentId, chunkIndices: result.chunks.map((chunk) => chunk.index) }],
                                          true,
                                          caseId
                                        );
                                        setWorkspaceRefresh((value) => value + 1);
                                      })
                                      .catch((error) =>
                                        setCaseFileErrors((current) => ({
                                          ...current,
                                          [item.uploadId]: error instanceof Error ? error.message : String(error)
                                        }))
                                      )
                                      .finally(() => setPickerAnonymizing(null));
                                  }}
                                >
                                  {pickerAnonymizing === item.uploadId ? "Przetwarzam…" : "Anonimizuj i zaznacz"}
                                </button>
                                <button
                                  type="button"
                                  className="chat-secondary-action"
                                  disabled={pickerAnonymizing !== null}
                                  title="Tylko OCR/tekst, bez anonimizacji - plik trafi do modelu z jawnymi danymi"
                                  onClick={() => {
                                    if (
                                      !window.confirm(
                                        `„${item.filename}” trafi do modelu bez anonimizacji, z danymi osobowymi w jawnej postaci. Kontynuować?`
                                      )
                                    ) {
                                      return;
                                    }
                                    setPickerAnonymizing(item.uploadId);
                                    setCaseFileErrors(({ [item.uploadId]: _cleared, ...rest }) => rest);
                                    void withDocumentProgress(item.uploadId, caseId, (progressId) =>
                                      processStoredCaseFile(caseId, item.uploadId, undefined, progressId)
                                    )
                                      .then((review) => previewThenFinalize(caseId, review, item.filename, true))
                                      .then((result) => {
                                        if (!result) return;
                                        pickFiles(
                                          [{ kind: "document", documentId: result.documentId, chunkIndices: result.chunks.map((chunk) => chunk.index) }],
                                          true,
                                          caseId
                                        );
                                        setWorkspaceRefresh((value) => value + 1);
                                      })
                                      .catch((error) =>
                                        setCaseFileErrors((current) => ({
                                          ...current,
                                          [item.uploadId]: error instanceof Error ? error.message : String(error)
                                        }))
                                      )
                                      .finally(() => setPickerAnonymizing(null));
                                  }}
                                >
                                  Tylko OCR i zaznacz
                                </button>
                                </>
                              ) : null}
                            </li>
                          );
                        }
                      )}
                    </ul>
                  )}
                  </>
                  )}
                </div>
              ) : null}
              {pendingFinalDocument ? (
                <div className="chat-final-document">
                  <div>
                    <strong>
                      Finalny dokument z przywróconymi danymi
                      <InfoTip>Każdy dokument źródłowy ma własny vault; alias D01/D02/… odwraca tylko jego deanonimizator.</InfoTip>
                    </strong>
                  </div>
                  {finalReview ? (
                    <DeanonymizationReview
                      preview={finalReview.preview}
                      busy={finalDocumentBusy}
                      onCorrect={async (restoration, text, remember) => {
                        if (
                          remember &&
                          restoration.canonical &&
                          restoration.gender &&
                          restoration.case
                        ) {
                          await saveNameForm({
                            canonical: restoration.canonical,
                            gender: restoration.gender,
                            case: restoration.case,
                            text: text.trim()
                          });
                        }
                        setFinalReview((current) =>
                          current
                            ? {
                                ...current,
                                preview: applyAliasCorrection(
                                  current.preview,
                                  restoration.alias,
                                  text
                                ),
                                overrides: {
                                  ...current.overrides,
                                  [restoration.alias]: text.trim()
                                }
                              }
                            : current
                        );
                      }}
                      onConfirm={() => void finalizePendingDocument()}
                      onCancel={() => setFinalReview(null)}
                    />
                  ) : (
                  <>
                  <div className="chat-form-row compact">
                    <button
                      type="button"
                      className="chat-primary-action"
                      disabled={finalDocumentBusy}
                      onClick={() =>
                        void reviewPendingDocument()
                      }
                    >
                      {finalDocumentBusy
                        ? "Przywracam dane…"
                        : "Przywróć dane i sprawdź przed zapisem"}
                    </button>
                    <button
                      type="button"
                      className="chat-secondary-action"
                      disabled={finalDocumentBusy}
                      onClick={async () => {
                        try {
                          const blob =
                            await downloadGeneratedArtifact(
                              pendingFinalDocument.caseId,
                              pendingFinalDocument.artifactId
                            );
                          const savedPath = await downloadBlob(
                            blob,
                            "LexMachina-tokenized." +
                              pendingFinalDocument.format
                          );
                          if (savedPath) {
                            setGeneratedDocumentMessage(`Wersja tokenizowana zapisana: ${savedPath}`);
                          }
                        } catch (error) {
                          setExecutionError(
                            error instanceof Error
                              ? error.message
                              : String(error)
                          );
                        }
                      }}
                    >
                      Pobierz wersję tokenizowaną
                    </button>
                  </div>
                  </>
                  )}
                </div>
              ) : null}
              {generatedDocumentMessage ? (
                <p className="chat-inline-success">
                  {generatedDocumentMessage}
                </p>
              ) : null}
              {contractModeRequest && contractModeRequest.caseId === caseId ? (
                <div className="chat-contract-mode" role="group" aria-label="Tryb analizy umowy">
                  <strong>
                    Wybierz tryb pracy z umową
                    <InfoTip>Tryb ustawia się raz dla sprawy. Po wyborze wiadomość zostanie wysłana ponownie.</InfoTip>
                  </strong>
                  <div className="chat-contract-mode-options">
                    {CONTRACT_MODES.map((option) => (
                      <button
                        key={option.mode}
                        type="button"
                        className={option.mode === contractModeRequest.suggested ? "chat-primary-action" : "chat-secondary-action"}
                        disabled={contractModeBusy}
                        onClick={() => void chooseContractMode(option.mode)}
                        title={option.hint}
                      >
                        {option.label}
                        {option.mode === contractModeRequest.suggested ? " (sugerowany)" : ""}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {unverifiedDraftRequest && unverifiedDraftRequest.caseId === caseId ? (
                <div className="chat-contract-mode" role="group" aria-label="Projekt z niezweryfikowanymi powołaniami">
                  <strong>
                    Zapisać pismo jako projekt?
                    <InfoTip>Decyzja trafia do audytu sesji; wiadomość zostanie wysłana ponownie.</InfoTip>
                  </strong>
                  <div className="chat-contract-mode-options">
                    <button type="button" className="chat-primary-action" disabled={executing} onClick={saveUnverifiedDraft}>
                      Zapisz jako projekt
                    </button>
                    <button type="button" className="chat-secondary-action" onClick={() => setUnverifiedDraftRequest(null)}>
                      Nie zapisuj
                    </button>
                  </div>
                  <small>Plik dostanie nagłówek „PROJEKT – NIE SKŁADAĆ BEZ WERYFIKACJI” z listą niezweryfikowanych powołań.</small>
                </div>
              ) : null}
              {skillSwitchOffer && skillSwitchOffer.caseId === caseId && !executing ? (
                <div className="chat-contract-mode" role="group" aria-label="Zmiana rodzaju pisma">
                  <strong>
                    {switchTitle(skillSwitchOffer.offer)}
                    <InfoTip>
                      {skillSwitchOffer.offer.direction === "ESCALATION"
                        ? developerMode
                          ? "Pismo procesowe powstaje etapami (W1-W3); przed startem aplikacja poprosi o akceptację. Rozmowa zostaje w wątku."
                          : "Pismo procesowe powstaje etapami; przed startem aplikacja poprosi o akceptację. Rozmowa zostaje w wątku."
                        : developerMode
                          ? "Pipeline pisma procesowego tej sprawy zostanie zamknięty; rozmowa zostaje w wątku."
                          : "Rozpoczęte pismo procesowe tej sprawy zostanie zamknięte; rozmowa zostaje w wątku."}
                    </InfoTip>
                  </strong>
                  {skillSwitchOffer.offer.reason ? <small>{skillSwitchOffer.offer.reason}</small> : null}
                  <div className="chat-contract-mode-options">
                    <button type="button" className="chat-primary-action" onClick={() => void acceptSkillSwitch()}>
                      {skillSwitchOffer.offer.direction === "ESCALATION" ? "Przełącz na pismo procesowe" : "Przełącz na pismo proste"}
                    </button>
                    <button type="button" className="chat-secondary-action" onClick={() => setSkillSwitchOffer(null)}>
                      Zostań przy obecnym
                    </button>
                  </div>
                </div>
              ) : null}
              {workflowRecoveryRequest && workflowRecoveryRequest.caseId === caseId ? (
                <div className="chat-contract-mode" role="group" aria-label="Etap sprawy">
                  {workflowRecoveryRequest.recovery.kind === "process-start" ? (
                    <>
                      <strong>
                        {developerMode ? "Uruchomić pipeline pisma procesowego?" : "Przygotować pismo procesowe etapami?"}
                        <InfoTip>
                          {developerMode
                            ? "Etapy: W1 rama, W2 projekt, W3 weryfikacja. Plik .docx powstaje sam (szkic po W2, gotowe pismo po W3); dokumenty sprawy i materiały kancelarii są dostępne w każdym etapie."
                            : "Etapy: rama, projekt, weryfikacja. Plik .docx powstaje sam (szkic po projekcie, gotowe pismo po weryfikacji); dokumenty sprawy i materiały kancelarii są dostępne w każdym etapie."}
                        </InfoTip>
                      </strong>
                      <div className="chat-contract-mode-options">
                        {workflowRecoveryRequest.recovery.acceptOnly ? (
                          <button
                            type="button"
                            className="chat-primary-action"
                            disabled={workflowRecoveryBusy}
                            onClick={() => void recoverWorkflow()}
                          >
                            Akceptuję start
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="chat-primary-action"
                              disabled={workflowRecoveryBusy}
                              onClick={() => void recoverWorkflow("CHECKPOINT")}
                              title="po każdym etapie potwierdzasz wynik"
                            >
                              Z potwierdzaniem etapów
                            </button>
                            <button
                              type="button"
                              className="chat-secondary-action"
                              disabled={workflowRecoveryBusy}
                              onClick={() => void recoverWorkflow("AUTO")}
                              title={developerMode ? "etapy przechodzą bez pytania; HYBRID-VAL przed plikiem nadal obowiązuje" : "etapy przechodzą bez pytania; kontrola końcowa przed plikiem nadal obowiązuje"}
                            >
                              Automatycznie
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <strong>
                        {workflowRecoveryRequest.recovery.title}
                        <InfoTip>Dotychczasowy przebieg zostaje w historii czatu; wiadomość zostanie wysłana ponownie.</InfoTip>
                      </strong>
                      <div className="chat-contract-mode-options">
                        <button
                          type="button"
                          className="chat-primary-action"
                          disabled={workflowRecoveryBusy}
                          onClick={() => void recoverWorkflow()}
                        >
                          Rozpocznij nowy etap
                        </button>
                        <button
                          type="button"
                          className="chat-secondary-action"
                          disabled={workflowRecoveryBusy}
                          onClick={() => setWorkflowRecoveryRequest(null)}
                        >
                          Anuluj
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
              {executionError ? (
                <div className="chat-error-diagnostic">
                  <p className="chat-inline-error">
                    {developerMode || !executionDiagnostic
                      ? executionError
                      : plainErrorMessage(executionDiagnostic.code, executionError, executionDiagnostic.reason)}
                  </p>
                  {developerMode && executionDiagnostic ? (
                    <details>
                      <summary>
                        Pełne informacje diagnostyczne
                      </summary>
                      <dl>
                        <div>
                          <dt>Kod</dt>
                          <dd>
                            <code>
                              {executionDiagnostic.code}
                            </code>
                          </dd>
                        </div>
                        {executionDiagnostic.status !== undefined ? (
                          <div>
                            <dt>HTTP</dt>
                            <dd>
                              {executionDiagnostic.status}
                            </dd>
                          </div>
                        ) : null}
                        {executionDiagnostic.stage ? (
                          <div>
                            <dt>Etap</dt>
                            <dd>
                              <code>
                                {executionDiagnostic.stage}
                              </code>
                            </dd>
                          </div>
                        ) : null}
                        {executionDiagnostic.reason ? (
                          <div>
                            <dt>Powód</dt>
                            <dd>
                              <code>
                                {executionDiagnostic.reason}
                              </code>
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      {executionDiagnostic.description ? (
                        <pre>
                          {executionDiagnostic.description}
                        </pre>
                      ) : null}
                      {executionDiagnostic.trace &&
                      executionDiagnostic.trace.length > 0 ? (
                        <ol className="chat-error-trace">
                          {executionDiagnostic.trace.map(
                            (event, index) => (
                              <li
                                key={
                                  String(
                                    event.sequence ??
                                      index
                                  ) +
                                  ":" +
                                  String(
                                    event.target ??
                                      ""
                                  )
                                }
                              >
                                <code>
                                  {event.sequence ??
                                    index + 1}
                                  {" · "}
                                  {event.type ??
                                    "event"}
                                  {" · "}
                                  {event.target ??
                                    "unknown"}
                                  {" · "}
                                  {event.status ??
                                    "?"}
                                </code>
                                {event.detail ? (
                                  <span>
                                    {event.detail}
                                  </span>
                                ) : null}
                              </li>
                            )
                          )}
                        </ol>
                      ) : null}
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeTab === "home" ? (
          <HomeDashboard
            user={user}
            cases={cases}
            modelLabel={
              selectedModel?.displayName ??
              (model ? model : "")
            }
            modelStatus={
              (PRIMARY_MODEL_SOURCES.find((item) => item.id === provider)?.label ?? provider) +
              (provider === "local"
                ? localModelReady
                  ? " · działa"
                  : localModelStarting || localStartBusy
                    ? " · uruchamianie"
                    : localRuntimeStatus
                      ? " · zatrzymany"
                      : " · sprawdzanie stanu"
                : "")
            }
            refreshToken={scheduleRefresh}
            onOpenCase={(nextCaseId) => {
              switchToCase(nextCaseId);
              setActiveTab("chat");
            }}
            onOpenCalendar={() => setActiveTab("calendar")}
            onOpenFirm={() => setActiveTab("firm")}
            onOpenModels={() => {
              setActiveTab("settings");
              setSettingsSection("models");
            }}
            onNewCase={() => void createLocalCase(newCaseName.trim() || "Nowa sprawa").catch(() => undefined)}
          />
        ) : null}

        {activeTab === "search" ? (
          <McpSearchPanel />
        ) : null}

        {activeTab === "invoices" ? (
          <InvoicesPanel
            onOpenSettings={() => {
              setActiveTab("settings");
              setSettingsSection("invoices");
            }}
          />
        ) : null}

        {activeTab === "calendar" ? (
          <CalendarPanel
            cases={cases}
            refreshToken={scheduleRefresh}
            onOpenCase={(nextCaseId) => {
              switchToCase(nextCaseId);
              setActiveTab("case");
            }}
            onChanged={() => setScheduleRefresh((value) => value + 1)}
          />
        ) : null}

        {activeTab === "case" ? (
          <section className="chat-card-stack">
            <article className="chat-card">
              <p className="eyebrow">Wątek = sprawa</p>
              <h2>
                Nazwa sprawy
                <InfoTip>Sygnatura nie jest wymagana. Nazwa jest niezależna od sygnatury i możesz ją zmienić w każdej chwili.</InfoTip>
              </h2>
              <div className="chat-form-row">
                <input
                  value={caseNameDraft}
                  maxLength={160}
                  disabled={!selectedCase || caseBusy}
                  placeholder="np. Kowalski przeciwko ABC — odszkodowanie"
                  onChange={(event) => setCaseNameDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="chat-primary-action"
                  disabled={!selectedCase || caseBusy || !caseNameDraft.trim()}
                  onClick={() => void saveCaseName()}
                >
                  Zapisz nazwę
                </button>
              </div>
              {selectedCase ? (
                <div className="matter-case-meta">
                  <span>ID katalogu: {selectedCase.caseId}</span>
                  <span>Rola: {selectedCase.role}</span>
                  <span>{selectedCase.archivedAt ? "ARCHIWALNA (tylko odczyt)" : "AKTYWNA"}</span>
                </div>
              ) : null}
            </article>

            <CollapsibleCaseSection
              eyebrow="Terminarz sprawy"
              title="Spotkania, posiedzenia i terminy"
              count={caseSchedule.length}
              loading={caseScheduleLoading}
              error={caseScheduleError}
              resetKey={selectedCase?.caseId ?? null}
              addLabel="Dodaj termin"
              hint="Terminy są przypisane do bieżącej sprawy i przechowywane w jej zaszyfrowanych danych. OWNER i EDITOR mogą dopisywać oraz usuwać wpisy."
              addForm={
                <div className="matter-schedule-form">
                  <div className="chat-form-row">
                    <select
                      aria-label="Rodzaj terminu"
                      value={scheduleKind}
                      disabled={
                        !canWriteCase(
                          selectedCase
                        ) ||
                        caseScheduleBusy
                      }
                      onChange={(event) =>
                        setScheduleKind(
                          event.target.value as CaseScheduleKind
                        )
                      }
                    >
                      <option value="CLIENT_MEETING">
                        Spotkanie z klientem
                      </option>
                      <option value="COURT_HEARING">
                        Posiedzenie sądu
                      </option>
                      <option value="DEADLINE">
                        Termin
                      </option>
                      <option value="OTHER">
                        Inne
                      </option>
                    </select>
                    <input
                      type="datetime-local"
                      aria-label="Data i godzina terminu"
                      value={scheduleStartsAt}
                      disabled={
                        !canWriteCase(
                          selectedCase
                        ) ||
                        caseScheduleBusy
                      }
                      onChange={(event) =>
                        setScheduleStartsAt(
                          event.target.value
                        )
                      }
                    />
                  </div>

                  <input
                    value={scheduleTitle}
                    maxLength={180}
                    disabled={
                      !canWriteCase(
                        selectedCase
                      ) ||
                      caseScheduleBusy
                    }
                    placeholder="Opis, np. rozprawa apelacyjna"
                    onChange={(event) =>
                      setScheduleTitle(
                        event.target.value
                      )
                    }
                  />

                  <div className="chat-form-row">
                    <input
                      value={scheduleLocation}
                      maxLength={180}
                      disabled={
                        !canWriteCase(
                          selectedCase
                        ) ||
                        caseScheduleBusy
                      }
                      placeholder="Miejsce / sala / adres (opcjonalnie)"
                      onChange={(event) =>
                        setScheduleLocation(
                          event.target.value
                        )
                      }
                    />
                    <button
                      type="button"
                      className="chat-primary-action"
                      disabled={
                        !canWriteCase(
                          selectedCase
                        ) ||
                        caseScheduleBusy ||
                        !scheduleTitle.trim() ||
                        !scheduleStartsAt
                      }
                      onClick={() =>
                        void saveCaseScheduleEvent()
                      }
                    >
                      Dodaj termin
                    </button>
                  </div>

                  <textarea
                    value={scheduleNotes}
                    maxLength={2000}
                    disabled={
                      !canWriteCase(
                        selectedCase
                      ) ||
                      caseScheduleBusy
                    }
                    placeholder="Notatka do terminu (opcjonalnie)"
                    onChange={(event) =>
                      setScheduleNotes(
                        event.target.value
                      )
                    }
                  />
                </div>
              }
            >
              {caseSchedule.map(
                (event) => (
                  <div
                    className="matter-schedule-item"
                    key={event.eventId}
                  >
                    <div className="matter-schedule-item-main">
                      <span className="matter-schedule-kind">
                        {caseScheduleKindLabel(
                          event.kind
                        )}
                      </span>
                      <strong>
                        {event.title}
                      </strong>
                      <small>
                        {caseScheduleStartLabel(
                          event.startsAt
                        )}
                        {event.location
                          ? " · " +
                            event.location
                          : ""}
                      </small>
                      {event.notes ? (
                        <p>
                          {event.notes}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="workspace-delete"
                      disabled={
                        !canWriteCase(
                          selectedCase
                        ) ||
                        caseScheduleBusy
                      }
                      onClick={() =>
                        void removeCaseScheduleEvent(
                          event.eventId
                        )
                      }
                    >
                      Usuń
                    </button>
                  </div>
                )
              )}
            </CollapsibleCaseSection>

            <CaseContactsCard
              caseId={selectedCase?.caseId ?? null}
              canWrite={canWriteCase(selectedCase)}
            />

            <article
              className="chat-card chat-file-drop-card"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={handleDrop}
            >
              <div>
                <p className="eyebrow">Dokumenty sprawy</p>
                <h2>
                  Kliknij lub przeciągnij pliki
                  <InfoTip>
                    Pliki trafiają do zaszyfrowanego magazynu sprawy. OCR i decyzja o danych osobowych odbywają się w
                    czacie, plik po pliku.
                  </InfoTip>
                </h2>
              </div>
              <button
                type="button"
                className="chat-primary-action"
                disabled={Boolean(selectedCase?.archivedAt)}
                onClick={() => fileInputRef.current?.click()}
              >
                Otwórz eksplorator
              </button>
            </article>

            <article className="chat-card">
              <p className="eyebrow">Wiedza w sesji</p>
              <div className="chat-check-row">
                <label>
                  <input
                    type="checkbox"
                    checked={includeCaseKnowledge}
                    disabled={!selectedCase || Boolean(selectedCase.archivedAt)}
                    onChange={(event) => setIncludeCaseKnowledge(event.target.checked)}
                  />
                  Przeszukuj dokumenty bieżącej sprawy
                  <InfoTip>
                    Fragmenty pasujące do pytania trafiają do kontekstu. Model w chmurze może też sam czytać całe akta
                    sprawy (tekst spseudonimizowany).
                  </InfoTip>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={includeFirmKnowledge}
                    disabled={!firmKnowledgeWorkspace}
                    onChange={(event) => setIncludeFirmKnowledge(event.target.checked)}
                  />
                  Przeszukuj know-how kancelarii
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={imagesWithText}
                    onChange={(event) => setImagesWithText(event.target.checked)}
                  />
                  Wysyłaj też obrazy stron z tekstem (dane osobowe zamaskowane)
                  <InfoTip>Zdjęcia bez tekstu modele w chmurze dostają zawsze jako obraz; modele lokalne czytają tylko tekst.</InfoTip>
                </label>
              </div>
            </article>

            {selectedCase ? (
              <CaseMemoryCard
                caseId={caseId}
                canWrite={canWriteCase(selectedCase)}
                refreshToken={memoryRefresh}
                onRequestOverview={() => {
                  if (!executing) void executeMessage(CASE_OVERVIEW_REQUEST);
                }}
              />
            ) : null}

            {selectedCase ? (
              <WorkspaceManager
                caseId={caseId}
                title={`Dokumenty sprawy — ${selectedCase.displayName || "Sprawa bez nazwy"}`}
                canWrite={canWriteCase(selectedCase)}
                refreshToken={workspaceRefresh}
                onArtifactRenamed={rememberArtifactName}
              />
            ) : null}

            {selectedCase ? (
              <article className="chat-card">
                <p className="eyebrow">Cykl życia</p>
                <h2>Zarządzanie sprawą</h2>
                <button
                  type="button"
                  className="chat-secondary-action"
                  disabled={caseBusy}
                  onClick={() => void toggleArchive()}
                >
                  {selectedCase.archivedAt ? "Przywróć z archiwum" : "Archiwizuj sprawę"}
                </button>

                {selectedCase.role === "OWNER" && user.appRole === "ADMIN" ? (
                  <details className="matter-danger-zone">
                    <summary>Trwałe usunięcie sprawy</summary>
                    <p>Wpisz USUŃ i podaj aktualne hasło.</p>
                    <div className="chat-form-row">
                      <input
                        value={deletePhrase}
                        placeholder="Wpisz USUŃ"
                        onChange={(event) => setDeletePhrase(event.target.value)}
                      />
                      <input
                        type="password"
                        value={deletePassword}
                        autoComplete="current-password"
                        placeholder="Aktualne hasło"
                        onChange={(event) => setDeletePassword(event.target.value)}
                      />
                      <button
                        type="button"
                        className="workspace-delete"
                        disabled={
                          caseBusy ||
                          deletePhrase !== "USUŃ" ||
                          !deletePassword
                        }
                        onClick={() => void permanentlyDeleteCase()}
                      >
                        Usuń sprawę trwale
                      </button>
                    </div>
                  </details>
                ) : null}
              </article>
            ) : null}
          </section>
        ) : null}

        {activeTab === "firm" ? (
          <section className="chat-card-stack">
            <FirmKnowledgePanel
              user={user}
              currentCase={selectedCase}
              onUseHit={(selection) =>
                setDocumentAttachments((current) => upsertAttachment(current, selection))
              }
              onWorkspaceChange={setFirmKnowledgeWorkspace}
            />
            {firmKnowledgeWorkspace ? (
              <WorkspaceManager
                caseId={firmKnowledgeWorkspace.caseId}
                title="Know-how i wzory kancelarii"
                canWrite={
                  user.appRole === "ADMIN" &&
                  !firmKnowledgeWorkspace.archivedAt
                }
                refreshToken={workspaceRefresh}
              />
            ) : null}
          </section>
        ) : null}

        {activeTab === "settings" ? (
          <section className="chat-settings-hub">
            <nav
              className="chat-settings-nav"
              aria-label="Sekcje ustawień"
            >
              {([
                ["models", "Modele i AI"],
                ["users", "Użytkownicy i uprawnienia"],
                ["security", "Hasło i bezpieczeństwo"],
                ["mcp", "Integracje i konektory"],
                ["invoices", "Faktury i KSeF"],
                ["skills", "Skille i routing"],
                ["maintenance", "Aplikacja i utrzymanie"],
                ...(settingsPanels?.account ? [["account", "Plan i klucze API"]] : []),
                ...(settingsPanels?.server ? [["server", "Tryb serwerowy"]] : [])
              ] as Array<
                [SettingsSection, string]
              >)
                .filter(([section]) => developerMode || section !== "skills")
                // Konto użytkownika: bez zakładek administracyjnych i technicznych.
                .filter(
                  ([section]) =>
                    developerAllowed ||
                    (section !== "maintenance" && (section !== "mcp" || Boolean(settingsPanels?.integrations)))
                )
                .map(
                  ([section, label]) => (
                    <button
                      key={section}
                      type="button"
                      className={
                        settingsSection ===
                        section
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        setSettingsSection(
                          section
                        )
                      }
                    >
                      {label}
                    </button>
                  )
                )}
            </nav>
            <div className="chat-settings-content">
              {settingsSection === "models" ? (
                <div className="chat-settings-grid">
            <article className="chat-card chat-settings-primary">
              <p className="eyebrow">Model główny</p>
              <h2>
                {selectedModel?.displayName ??
                  (provider === "local"
                    ? "Lokalny model główny"
                    : "Wybierz źródło i model")}
              </h2>
              <div className="chat-settings-field-grid">
              <label>
                Dostawca
                <select
                  value={providerGroupOf(provider)}
                  onChange={(event) => {
                    setProvider(sourceOfGroup(event.target.value as ProviderGroup));
                    setProviderApiKeyInput("");
                    setProviderKeyMessage("");
                    setProviderAccountMessage("");
                  }}
                >
                  {providerGroups.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              {provider !== "local" ? (
                <fieldset className="chat-settings-channel">
                  <legend>Połączenie</legend>
                  {(serverMode ? (["api"] as const) : (["account", "api"] as const)).map((channel) => {
                    const group = providerGroupOf(provider) as ProviderId;
                    const account = providerAccounts[group];
                    const apiReady = providerConfiguration[group];
                    const status =
                      channel === "account"
                        ? account?.authenticated
                          ? "połączone"
                          : account?.installed === false
                            ? "brak klienta"
                            : account
                              ? "niezalogowane"
                              : "sprawdzanie"
                        : apiReady === true
                          ? "klucz zapisany"
                          : apiReady === false
                            ? "brak klucza"
                            : "sprawdzanie";
                    return (
                      <label key={channel} className="chat-settings-channel-option">
                        <input
                          type="radio"
                          name="provider-channel"
                          checked={(channel === "account") === isAccountPrimarySource(provider)}
                          onChange={() => {
                            rememberChannel(group, channel);
                            setProvider(sourceForGroup(group, channel));
                            setProviderApiKeyInput("");
                            setProviderKeyMessage("");
                            setProviderAccountMessage("");
                          }}
                        />
                        {channel === "account" ? "Konto (logowanie, OAuth)" : "Klucz API"} · {status}
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
              <label>
                Model
                <select
                  value={model}
                  disabled={
                    modelCatalogLoading ||
                    models.length === 0
                  }
                  onChange={(event) => {
                    setModel(
                      event.target.value
                    );
                    saveLastUsedModel(user.userId, { provider, model: event.target.value });
                  }}
                >
                  {modelCatalogLoading ? (
                    <option value="">
                      Odświeżam listę modeli…
                    </option>
                  ) : models.length === 0 ? (
                    <option value="">
                      {provider === "local"
                        ? "Brak zainstalowanych modeli lokalnych"
                        : "Brak dostępnych modeli"}
                    </option>
                  ) : null}
                  {models.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!item.selectable}
                    >
                      {item.displayName}
                      {!item.selectable
                        ? isAccountPrimarySource(provider)
                          ? " · wymaga logowania"
                          : " · nieobsługiwany"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              </div>
              {provider === "local" ? (
                <div className="chat-settings-status-row">
                  <span className="chat-settings-status ready">
                    {modelCatalogLoading
                      ? "Odświeżam lokalny katalog…"
                      : `Wykryto modeli lokalnych: ${models.length}`}
                  </span>
                </div>
              ) : isAccountPrimarySource(provider) ? (
                <div className="chat-settings-status-row">
                  <span
                    className={
                      accountAuthenticated
                        ? "chat-settings-status ready"
                        : "chat-settings-status"
                    }
                  >
                    {accountAuthenticated
                      ? "Konto połączone"
                      : "Konto wymaga połączenia"}
                  </span>
                </div>
              ) : (
                <div className="chat-settings-status-row">
                  <span
                    className={
                      providerConfigured
                        ? "chat-settings-status ready"
                        : "chat-settings-status"
                    }
                  >
                    {providerConfigured
                      ? "Klucz API aktywny"
                      : "Brak aktywnego klucza API"}
                  </span>
                </div>
              )}
              {modelError ? (
                <p className="chat-inline-error">
                  {modelError === "PROVIDER_NOT_CONFIGURED"
                    ? "Najpierw dodaj klucz API dla tego dostawcy."
                    : modelError === "ACCOUNT_SESSION_CLI_NOT_INSTALLED"
                      ? "Nie znaleziono oficjalnego klienta tego dostawcy. Zainstaluj go z instrukcji poniżej albo wybierz kanał API."
                      : modelError === "ACCOUNT_SESSION_NOT_AUTHENTICATED"
                        ? "Najpierw połącz konto użytkownika."
                        : modelError}
                </p>
              ) : null}
              {selectedModel?.contextWindow ? (
                <small>
                  Aktywne okno runtime: {selectedModel.contextWindow.toLocaleString("pl-PL")} tokenów
                  {selectedModel.nativeContextWindow
                    ? ` · natywne: ${selectedModel.nativeContextWindow.toLocaleString("pl-PL")}`
                    : ""}
                  {selectedModel.contextMode === "YARN_EXTENDED"
                    ? " · rozszerzone YaRN"
                    : ""}
                </small>
              ) : null}
              {providerDefinition &&
              !model.startsWith("local/") &&
              !isAccountPrimarySource(provider) ? (
                <button
                  type="button"
                  className="chat-link-action"
                  onClick={() => void openExternalUrl(providerDefinition.apiKeyUrl)}
                >
                  {model
                    ? `Klucz API dla ${providerDefinition.label} — otwórz w przeglądarce ↗`
                    : `Utwórz / pobierz klucz ${providerDefinition.label} — otwórz w przeglądarce ↗`}
                </button>
              ) : null}
            </article>

            <article className="chat-card chat-settings-auth">
              <p className="eyebrow">
                {provider === "local"
                  ? "Lokalne AI"
                  : isAccountPrimarySource(provider)
                    ? "Konto użytkownika"
                    : "Klucz API"}
              </p>
              <h2>
                {provider === "local"
                  ? "Konfiguracja lokalna"
                  : isAccountPrimarySource(provider)
                    ? "Połączenie z kontem"
                    : "Konfiguracja API"}
                {provider === "local" ? (
                  <InfoTip>Modele lokalne działają przez llama.cpp, bez klucza API i bez logowania do konta.</InfoTip>
                ) : isAccountPrimarySource(provider) ? (
                  <InfoTip>
                    Lex Machina otwiera okno terminala z oficjalnym klientem
                    {runtimeProvider === "openai"
                      ? " Codex CLI"
                      : runtimeProvider === "anthropic"
                        ? " Claude Code"
                        : runtimeProvider === "google"
                          ? " Gemini CLI (po zalogowaniu kontem Google wpisz /quit)"
                          : " Grok Build"}
                    , który prowadzi logowanie w przeglądarce. Token OAuth zostaje w kliencie i nie trafia do Lex
                    Machina.
                  </InfoTip>
                ) : null}
              </h2>
              {provider === "local" ? (
                <>
                  <div className="chat-local-inventory">
                    <strong>
                      {modelCatalogLoading
                        ? "Odświeżam lokalny katalog…"
                        : `Zainstalowane modele: ${models.length}`}
                    </strong>
                    {models.length > 0 ? (
                      <div className="chat-model-chip-list">
                        {models.map((item) => (
                          <span key={item.id} className="chat-model-chip">
                            {item.displayName}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <small>
                        Nie wykryto zainstalowanego modelu GGUF. Lista odświeży się sama po instalacji.
                      </small>
                    )}
                    <button
                      type="button"
                      className="chat-secondary-action"
                      disabled={modelCatalogLoading}
                      onClick={() =>
                        setLocalModelsRefreshToken(
                          (value) => value + 1
                        )
                      }
                    >
                      {modelCatalogLoading
                        ? "Odświeżanie…"
                        : "Odśwież modele lokalne"}
                    </button>
                  </div>
                </>
              ) : isAccountPrimarySource(provider) ? (
                <>
                  {runtimeProvider === "anthropic" ? (
                    <>
                      <small>
                        {accountSession?.oauthTokenConfigured
                          ? "OAuth setup-token: skonfigurowany"
                          : "OAuth setup-token: nie skonfigurowany"}
                        <InfoTip>
                          Token z <code>claude setup-token</code> Lex Machina przekaże do Claude Code jako
                          <code> CLAUDE_CODE_OAUTH_TOKEN</code>; w aplikacji desktopowej trafia do systemowego magazynu
                          poświadczeń. W środowisku zarządzanym działa też <code>CLAUDE_CODE_OAUTH_REFRESH_TOKEN</code> z
                          <code> CLAUDE_CODE_OAUTH_SCOPES</code>.
                        </InfoTip>
                      </small>
                      {user.appRole === "ADMIN" ? (
                        <>
                          <input
                            type="password"
                            autoComplete="off"
                            value={claudeOAuthToken}
                            placeholder="Wklej token z: claude setup-token"
                            onChange={(event) =>
                              setClaudeOAuthTokenInput(
                                event.target.value
                              )
                            }
                          />
                          <div className="chat-form-row compact">
                            <button
                              type="button"
                              className="chat-primary-action"
                              disabled={
                                claudeOAuthBusy ||
                                !claudeOAuthToken.trim()
                              }
                              onClick={() =>
                                void saveClaudeOAuthToken()
                              }
                            >
                              {claudeOAuthBusy
                                ? "Zapisywanie…"
                                : isDesktopShell()
                                  ? "Zapisz token w systemie"
                                  : "Użyj tokenu w sesji"}
                            </button>
                            <button
                              type="button"
                              className="chat-secondary-action"
                              disabled={claudeOAuthBusy}
                              onClick={() =>
                                void removeClaudeOAuthToken()
                              }
                            >
                              Usuń token OAuth
                            </button>
                          </div>
                          {claudeOAuthMessage ? (
                            <small>
                              {claudeOAuthMessage}
                            </small>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : null}
                  <small>
                    Bez instalowania klienta CLI: wybierz kanał API.
                  </small>
                  <p
                    className={`chat-provider-account-status ${
                      !accountSession
                        ? "checking"
                        : !accountSession.installed
                          ? "missing"
                          : accountSession.authenticated
                            ? "connected"
                            : "pending"
                    }`}
                    role="status"
                  >
                    <span aria-hidden="true" className="chat-provider-account-dot" />
                    {accountSession
                      ? accountSession.installed
                        ? accountSession.authenticated
                          ? `Połączone · ${accountSession.command}`
                          : `Klient zainstalowany, brak aktywnej sesji · ${accountSession.command}`
                        : `Brak klienta · ${accountSession.command}`
                      : "Sprawdzanie klienta i sesji…"}
                  </p>
                  {accountSession && !accountSession.installed && accountSession.installHint ? (
                    <small className="chat-account-note">{accountSession.installHint}</small>
                  ) : null}
                  {user.appRole === "ADMIN" ? (
                    <div className="chat-form-row compact chat-provider-account-actions">
                      {/* The runtime provisions the pinned client (Codex, Claude Code,
                          Gemini CLI, Grok Build) on "Połącz konto". Once connected the
                          status above says so; no disabled "Połączone" button. */}
                      {!accountSession?.authenticated || providerAccountBusy ? (
                        <button
                          type="button"
                          className="chat-primary-action"
                          disabled={providerAccountBusy}
                          onClick={() => void connectProviderAccount()}
                        >
                          {providerAccountBusy
                            ? accountConnectPhase?.kind === "provision"
                              ? "Pobieranie klienta…"
                              : "Logowanie…"
                            : "Połącz konto"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="chat-secondary-action"
                        disabled={providerAccountBusy}
                        onClick={() => {
                          setProviderAccountMessage("");
                          void refreshProviderAccountStatus();
                        }}
                      >
                        Sprawdź ponownie
                      </button>
                      {accountSession?.authenticated ? (
                        <button
                          type="button"
                          className="chat-secondary-action"
                          disabled={providerAccountBusy}
                          onClick={() => void disconnectProviderAccount()}
                        >
                          Wyloguj
                        </button>
                      ) : null}
                      {accountSession?.managedClientInstalled ? (
                        <button
                          type="button"
                          className="chat-secondary-action"
                          disabled={providerAccountBusy}
                          onClick={() => void uninstallProviderAccount()}
                        >
                          Odinstaluj klienta
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="chat-secondary-action"
                        disabled={providerAccountBusy}
                        onClick={switchAccountToApi}
                      >
                        Przejdź na API
                      </button>
                    </div>
                  ) : (
                    <p>
                      Konto dostawcy może połączyć administrator aplikacji.
                    </p>
                  )}
                  {accountSession?.authenticated ? (
                    <small className="chat-account-note">
                      Aby zmienić konto, kliknij „Wyloguj”, a potem „Połącz konto”.
                    </small>
                  ) : null}
                  <AccountConnectProgress
                    phase={accountConnectPhase}
                    clientLabel={providerDefinition?.accountClientLabel ?? "klient"}
                  />
                  {providerAccountMessage ? (
                    <small className="chat-account-note">{providerAccountMessage}</small>
                  ) : null}
                </>
              ) : serverMode ? (
                <p>W trybie serwerowym klucze API dla wszystkich kont ustawia administrator w zakładce „Tryb serwerowy”.</p>
              ) : user.appRole === "ADMIN" ? (
                <>
                  {runtimeProvider === "anthropic" ? (
                    <p className="chat-inline-warning">
                      Ten kanał używa klucza Anthropic API. Dla Claude Code/OAuth zaznacz wyżej „Połączenie: Konto (logowanie, OAuth)”.
                    </p>
                  ) : null}
                  <input
                    type="password"
                    autoComplete="off"
                    value={providerApiKey}
                    placeholder="Wklej klucz API"
                    onChange={(event) => setProviderApiKeyInput(event.target.value)}
                  />
                  <div className="chat-form-row compact">
                    <button
                      type="button"
                      className="chat-primary-action"
                      disabled={providerKeyBusy || !providerApiKey.trim()}
                      onClick={() => void saveApiKey()}
                    >
                      {isDesktopShell() ? "Zapisz w systemie" : "Użyj w sesji"}
                    </button>
                    <button
                      type="button"
                      className="chat-secondary-action"
                      disabled={providerKeyBusy}
                      onClick={() => void removeApiKey()}
                    >
                      Usuń klucz
                    </button>
                  </div>
                  {providerKeyMessage ? <small>{providerKeyMessage}</small> : null}
                </>
              ) : (
                <p>Klucz API może zmieniać administrator aplikacji.</p>
              )}
            </article>
                {settingsPanels?.localAi ? (
                  <div className="chat-settings-embedded-wide">
                    {settingsPanels.localAi}
                  </div>
                ) : null}
                </div>
              ) : settingsSection === "users" ? (
                <div className="chat-settings-section-stack">
                  {user.appRole === "ADMIN"
                    ? settingsPanels?.users
                    : (
                      <article className="chat-card">
                        <p className="eyebrow">
                          Konto aplikacji
                        </p>
                        <h2>
                          Użytkownicy globalni
                        </h2>
                        <p>
                          Kontami aplikacji zarządza administrator. Uprawnienia do bieżącej sprawy są poniżej.
                        </p>
                      </article>
                    )}
                  {caseId ? (
                    <article className="chat-card chat-settings-case-access">
                      <p className="eyebrow">
                        Bieżąca sprawa
                      </p>
                      <h2>
                        Uprawnienia do sprawy
                        <InfoTip>Role OWNER, EDITOR, ANALYST i VIEWER dotyczą tylko wybranej sprawy.</InfoTip>
                      </h2>
                      <CaseCollaborationPanel
                        caseId={caseId}
                        caseRole={
                          selectedCase?.role
                        }
                      />
                    </article>
                  ) : null}
                </div>
              ) : settingsSection === "security" ? (
                <div className="chat-settings-section-stack">
                  {settingsPanels?.security}
                </div>
              ) : settingsSection === "mcp" ? (
                <div className="chat-settings-section-stack">
                  {settingsPanels?.integrations}
                  {user.appRole === "ADMIN"
                    ? settingsPanels?.mcp
                    : (
                      <article className="chat-card">
                        <p className="eyebrow">
                          Konektory MCP
                        </p>
                        <p>
                          Instalacją konektorów MCP i kluczem CEIDG zarządza administrator aplikacji.
                        </p>
                      </article>
                    )}
                </div>
              ) : settingsSection === "server" ? (
                <div className="chat-settings-section-stack">
                  {settingsPanels?.server}
                </div>
              ) : settingsSection === "account" ? (
                <div className="chat-settings-section-stack">
                  {settingsPanels?.account}
                </div>
              ) : settingsSection === "invoices" ? (
                <div className="chat-settings-section-stack">
                  {settingsPanels?.invoices}
                </div>
              ) : settingsSection === "skills" && developerMode ? (
                <section className="chat-card-stack">
            <article className="chat-card">
              <p className="eyebrow">Sterowanie wykonaniem</p>
              <h2>
                {selectedDeterministicAction
                  ? selectedDeterministicAction.label
                  : "AUTO · prawny-router-v3"}
                <InfoTip>
                  Tryb pracy wybierasz nad polem pierwszej wiadomości; bez wyboru router sam dobiera dziedziny DR i
                  skille. Po pierwszej wiadomości tryb jest przypięty do wątku.
                </InfoTip>
              </h2>
              <div className="chat-model-select-row">
                <button
                  type="button"
                  className="chat-secondary-action"
                  disabled={
                    domainSelection.length === routes.length &&
                    manualSkillSelection.length ===
                      selectableExecutionSkills.length
                  }
                  onClick={
                    selectAllSkills
                  }
                >
                  Zaznacz wszystkie skille
                </button>
                <button
                  type="button"
                  className="chat-secondary-action"
                  disabled={
                    domainSelection.length === 0 &&
                    manualSkillSelection.length === 0
                  }
                  onClick={
                    clearAllSkills
                  }
                >
                  Odznacz wszystkie opcjonalne
                </button>
              </div>
            </article>

            <article className="chat-card">
              <p className="eyebrow">Obowiązkowy rdzeń</p>
              <div className="chat-mandatory-grid">
                <div>
                  <strong>✓ prawny-router-v3</strong>
                  <small>zawsze aktywny</small>
                </div>
                <div>
                  <strong>✓ shared</strong>
                  <small>zawsze aktywny</small>
                </div>
                <div>
                  <strong>✓ prawo-polskie-v2</strong>
                  <small>zawsze aktywny dla zapytań prawnych PL</small>
                </div>
              </div>
            </article>

            <article className="chat-card">
              <div className="chat-card-heading">
                <div>
                  <p className="eyebrow">Dziedziny prawa</p>
                  <h2>
                    {domainSelection.length === routes.length
                      ? `Wszystkie moduły DR (${routes.length})`
                      : `${domainSelection.length} z ${routes.length} modułów DR`}
                    <InfoTip>Odznaczenie ogranicza dziedziny, z których router korzysta w tej rozmowie. Pełny zestaw nie nakłada ograniczeń.</InfoTip>
                  </h2>
                </div>
                <div className="chat-model-select-row">
                  <button
                    type="button"
                    className="chat-secondary-action"
                    disabled={
                      domainSelection.length ===
                      routes.length
                    }
                    onClick={
                      selectAllDomainSkills
                    }
                  >
                    Zaznacz wszystkie
                  </button>
                  <button
                    type="button"
                    className="chat-secondary-action"
                    disabled={
                      domainSelection.length === 0
                    }
                    onClick={
                      clearDomainSkills
                    }
                  >
                    Odznacz wszystkie
                  </button>
                </div>
              </div>
              <div className="chat-skill-grid">
                {routes.map((name) => {
                  const checked =
                    domainSelection.includes(name);
                  return (
                    <label
                      key={name}
                      className={checked ? "chat-skill-card selected" : "chat-skill-card"}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDomainSkill(name)}
                      />
                      <span>
                        <strong>{labelForSkill(name)}</strong>
                        <small>dziedzina prawa</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </article>

            <article className="chat-card">
              <div className="chat-card-heading">
                <div>
                  <p className="eyebrow">Skille wykonawcze</p>
                  <h2>
                    Dodatkowe skille wykonawcze · {manualSkillSelection.length} z {selectableExecutionSkills.length} zaznaczonych
                    <InfoTip>Domyślnie zaznaczone są wszystkie. Moduły DR (dziedziny prawa) wybierasz w sekcji powyżej.</InfoTip>
                  </h2>
                </div>
                <div className="chat-model-select-row">
                  <button
                    type="button"
                    className="chat-secondary-action"
                    disabled={
                      manualSkillSelection.length ===
                      selectableExecutionSkills.length
                    }
                    onClick={
                      selectAllManualSkills
                    }
                  >
                    Zaznacz wszystkie
                  </button>
                  <button
                    type="button"
                    className="chat-secondary-action"
                    disabled={
                      manualSkillSelection.length === 0
                    }
                    onClick={
                      clearManualSkills
                    }
                  >
                    Odznacz wszystkie
                  </button>
                  <input
                    className="chat-search"
                    value={skillFilter}
                    placeholder="Filtruj skille…"
                    onChange={(event) =>
                      setSkillFilter(
                        event.target.value
                      )
                    }
                  />
                </div>
              </div>
              <div className="chat-skill-grid">
                {filteredSkills.map((skill) => {
                  const checked =
                    manualSkillSelection.includes(
                      skill.name
                    );
                  return (
                    <label
                      key={skill.name}
                      className={checked ? "chat-skill-card selected" : "chat-skill-card"}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleManualSkill(skill.name)}
                      />
                      <span>
                        <strong>{labelForSkill(skill.name)}</strong>
                        <small>{skill.description || skill.type || "skill"}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            </article>
          </section>
              ) : (
                <div className="chat-settings-section-stack">
                  <article className="chat-card developer-mode-card">
                    <label className="developer-mode-toggle">
                      <input
                        type="checkbox"
                        checked={developerMode}
                        onChange={(event) => setDeveloperMode(event.target.checked)}
                      />
                      <span>
                        <strong>Tryb dewelopera</strong>
                        <small>
                          Pokazuje dziennik wykonania, skille i moduły użyte w odpowiedzi, bramki, kody błędów
                          i inne informacje techniczne. Wyłączony: widok dla prawnika.
                        </small>
                      </span>
                    </label>
                  </article>
                  {settingsPanels?.maintenance}
                </div>
              )}
            </div>
          </section>
        ) : null}
      </main>
    </div>
    </DeveloperModeContext.Provider>
  );
}
