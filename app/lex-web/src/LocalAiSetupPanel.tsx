import { currentLocale, t } from "./i18n";
import { useDeveloperMode } from "./developer-mode.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { startGuardedPolling } from "./guarded-polling.js";
import {
  apiBase,
  authorizationHeaders,
  isDesktopShell,
  type AuthenticatedUser
} from "./api.js";
import {
  useFloatingPanelDrag
} from "./use-floating-panel.js";
import "./local-ai.css";
import { InfoTip } from "./InfoTip";
import { LocalOfflineSection } from "./LocalOfflineSection.js";

type LocalModel = {
  provider: "local";
  id: string;
  displayName: string;
  selectable: true;
  contextWindow: number;
  nativeContextWindow: number;
  minimumContextWindow: number;
  maximumContextWindow: number;
  configuredContextWindow?: number;
  contextMode: "NATIVE_OR_REDUCED" | "YARN_EXTENDED";
  quantization: string;
  license: string;
  source: string;
  localOnly: true;
  installed: boolean;
};

type BackendPreference =
  | "AUTO"
  | "VULKAN_X64"
  | "CPU_X64_PORTABLE"
  | "METAL_ARM64";

type BackendPolicy = {
  allowed:
    BackendPreference[];
  default:
    BackendPreference;
};

type ContextPolicy = {
  minimum: number;
  maximum: number;
  step: number;
  recommendedProfiles: number[];
  default: number;
};

type LocalRuntimeStatus = {
  configured: boolean;
  provisioning: boolean;
  configPath: string;
  enginePresent: boolean;
  modelsPresent: Record<string, boolean>;
  selectedModelId: string | null;
  configuredContextTokens: number | null;
  activeModelId: string | null;
  state: "STOPPED" | "PROVISIONING" | "STARTING" | "READY";
  endpoint: string;
  contextPolicy: ContextPolicy;
  backendPolicy: BackendPolicy;
  qualification: {
    schemaVersion: 1;
    result: "PASS";
    modelId: string;
    contextTokens: number;
    contextMode:
      | "NATIVE_OR_REDUCED"
      | "YARN_EXTENDED";
    engine: "llama.cpp";
    backend?:
      | "VULKAN_X64"
      | "CPU_X64_PORTABLE"
      | "METAL_ARM64";
    startupMs: number;
    validatedAt: string;
  } | null;
  progress: {
    phase:
      | "STARTING"
      | "DOWNLOAD"
      | "CACHE_HIT"
      | "VERIFIED"
      | "VALIDATING_RUNTIME"
      | "READY"
      | "FAILED";
    label: string;
    bytesDownloaded: number;
    bytesTotal: number | null;
    percent: number | null;
    updatedAt: string;
  } | null;
  hardware: {
    platform: string;
    arch: string;
    totalMemoryBytes: number;
    logicalCpuCount: number;
    cpuModel: string | null;
    accelerators: Array<{
      name: string;
      driverVersion?: string;
    }>;
    packagedBackend: string;
    configuredBackend:
      | "VULKAN_X64"
      | "CPU_X64_PORTABLE"
      | "METAL_ARM64"
      | null;
    backendSelectionMode:
      BackendPreference | null;
    gpuCandidateDetected: boolean;
    gpuOffloadEnabled: boolean;
    gpuFailure?: { at: string; error: string; appVersion: string } | null;
    detectedAt: string;
  };
};

type LocalModelsResponse = {
  provider: "local";
  models: LocalModel[];
  runtime: LocalRuntimeStatus;
};

type LocalProvisionResponse = {
  model: LocalModel;
  contextTokens: number;
  configPath: string;
  runtime: LocalRuntimeStatus;
};

type ModelPackUpdateStatus = {
  status:
    | "NOT_CONFIGURED"
    | "UP_TO_DATE"
    | "AVAILABLE"
    | "UNAVAILABLE"
    | "BLOCKED";
  checkedAt: string;
  packPublished?: boolean;
  modelId?: string;
  modelFamily?: "BIELIK" | "MISTRAL";
  currentSha256?: string;
  latestPackVersion?: string;
  targetModelId?: string;
  targetDisplayName?: string;
  targetBytes?: number;
  targetSha256?: string;
  verificationReady: boolean;
  signatureMode:
    | "SIGNED_REQUIRED"
    | "UNSIGNED_ALLOWED";
  signerKeyId?: string;
  blockedReason?:
    | "SIGNED_INDEX_MISSING"
    | "SIGNER_POLICY_MISSING"
    | "APP_INCOMPATIBLE"
    | "MODEL_NOT_IN_INDEX"
    | "PACK_VERSION_ROLLBACK"
    | "PACK_VERSION_HASH_CONFLICT"
    | "INDEX_INVALID";
};

async function request<T>(
  pathname: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${apiBase()}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...authorizationHeaders(),
      ...init?.headers
    }
  });
  const payload = await response.json() as T | { error?: string };
  if (!response.ok) {
    const code =
      typeof (payload as { error?: unknown }).error === "string"
        ? String((payload as { error: string }).error)
        : `HTTP_${response.status}`;
    throw new Error(code);
  }
  return payload as T;
}

function formatTokens(value: number): string {
  return value.toLocaleString(currentLocale());
}

function formatBytes(value: number): string {
  if (value >= 1024 ** 3) {
    return `${(value / (1024 ** 3)).toFixed(2)} GB`;
  }
  if (value >= 1024 ** 2) {
    return `${(value / (1024 ** 2)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function progressLabel(
  phase: NonNullable<
    LocalRuntimeStatus["progress"]
  >["phase"]
): string {
  switch (phase) {
    case "STARTING":
      return t("Przygotowanie");
    case "DOWNLOAD":
      return t("Pobieranie");
    case "CACHE_HIT":
      return t("Zweryfikowany cache");
    case "VERIFIED":
      return "SHA-256 zweryfikowane";
    case "VALIDATING_RUNTIME":
      return t("Test uruchomienia");
    case "READY":
      return t("Gotowe");
    case "FAILED":
      return t("Błąd");
  }
}

function modelPackBlockLabel(
  reason:
    ModelPackUpdateStatus["blockedReason"]
): string {
  switch (reason) {
    case "SIGNED_INDEX_MISSING":
      return t("brak podpisu indeksu model-pack w trybie wymagającym podpisu");
    case "SIGNER_POLICY_MISSING":
      return "brak skonfigurowanego zaufanego klucza Ed25519";
    case "APP_INCOMPATIBLE":
      return t("pakiet nie jest zgodny z tą wersją aplikacji");
    case "MODEL_NOT_IN_INDEX":
      return t("zainstalowanego modelu nie ma w indeksie aktualizacji");
    case "PACK_VERSION_ROLLBACK":
      return t("wykryto próbę cofnięcia do starszego pakietu");
    case "PACK_VERSION_HASH_CONFLICT":
      return t("ta sama wersja pakietu ma inny hash modelu");
    case "INDEX_INVALID":
    case undefined:
      return t("indeks aktualizacji jest nieprawidłowy");
  }
}

function contextLabel(
  tokens: number,
  nativeContext: number
): string {
  return tokens > nativeContext
    ? `${formatTokens(tokens)} · rozszerzony YaRN`
    : t("{tokens} · w granicach natywnych", { tokens: formatTokens(tokens) });
}

function backendLabel(
  value: BackendPreference,
  mac = false
): string {
  switch (value) {
    case "AUTO":
      return mac ? "Auto · karta graficzna Apple (Metal)" : t("Automatycznie: najpierw karta graficzna (Vulkan), przy błędzie procesor");
    case "VULKAN_X64":
      return "Vulkan GPU · bez automatycznego fallbacku";
    case "CPU_X64_PORTABLE":
      return t("CPU · maksymalna zgodność");
    case "METAL_ARM64":
      return "Metal · karta graficzna Apple";
  }
}

type VisionOcrStatus = {
  available: boolean;
  modelId: string | null;
  label: string;
  license: string | null;
  bytes: number;
  installed: boolean;
  engineInstalled: boolean;
  state: "IDLE" | "DOWNLOADING" | "FAILED";
  progress: LocalRuntimeStatus["progress"];
  error?: string;
};

/**
 * Vision model for OCR: reads doubtful lines of scans again in "korekta AI" mode; a
 * dictionary check decides what is taken, so it never adds dates or names on its own.
 */
function VisionOcrSection({ admin }: { admin: boolean }) {
  const [status, setStatus] = useState<VisionOcrStatus | null>(null);
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    try {
      setStatus(await request<VisionOcrStatus>("/api/local-models/vision-ocr"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (status?.state !== "DOWNLOADING") return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [status?.state]);

  async function act(action: "install" | "remove"): Promise<void> {
    setError("");
    try {
      setStatus(await request<VisionOcrStatus>(`/api/local-models/vision-ocr/${action}`, { method: "POST" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  if (!status) return null;
  if (!status.available) {
    return (
      <div className="local-ai-facts">
        <strong>{t("Odczyt wątpliwych linii skanu")}</strong>
        <small>{t("Ta wersja aplikacji nie zawiera modelu wizyjnego w manifeście.")}</small>
      </div>
    );
  }
  const progress = status.progress;
  return (
    <div className="local-ai-facts">
      <strong>
        {t("Odczyt wątpliwych linii skanu")}
        <InfoTip>
          {t("Działa w trybie z korektą AI: czyta ponownie tylko niepewne linie, a zmianę zatwierdza słownik (bez dopisywania dat, nazwisk i liczb). Pliki są weryfikowane SHA-256.")}
        </InfoTip>
      </strong>
      <small>
        {status.label}, {formatBytes(status.bytes)}{status.license ? `, licencja ${status.license}` : ""}
      </small>
      {status.state === "DOWNLOADING" ? (
        <div className="local-ai-progress">
          <div>
            <strong>{progress ? progressLabel(progress.phase) : t("Przygotowanie")}</strong>
            {progress ? <small>{progress.label}</small> : null}
          </div>
          {progress?.percent !== null && progress?.percent !== undefined ? (
            <progress max={100} value={progress.percent} />
          ) : (
            <progress />
          )}
          {progress ? (
            <small>
              {formatBytes(progress.bytesDownloaded)}
              {progress.bytesTotal !== null ? ` / ${formatBytes(progress.bytesTotal)}` : ""}
              {progress.percent !== null ? ` · ${progress.percent}%` : ""}
            </small>
          ) : null}
        </div>
      ) : status.installed ? (
        <small>{t("Zainstalowany")}{status.engineInstalled ? "." : t(", ale brak silnika lokalnej AI: najpierw zainstaluj lokalną AI.")}</small>
      ) : (
        <small>{t("Nie zainstalowany.")}</small>
      )}
      {status.state === "FAILED" && status.error ? <small className="local-ai-error">{t("Pobieranie nie powiodło się:")} {status.error}</small> : null}
      {admin ? (
        <div className="local-ai-actions">
          <button
            type="button"
            disabled={status.installed || status.state === "DOWNLOADING"}
            onClick={() => void act("install")}
          >
            {t("Pobierz model wizyjny")}
          </button>
          <button
            type="button"
            className="local-ai-danger"
            disabled={!status.installed || status.state === "DOWNLOADING"}
            onClick={() => void act("remove")}
          >
            {t("Usuń model wizyjny")}
          </button>
        </div>
      ) : null}
      {error ? <small className="local-ai-error">{error}</small> : null}
    </div>
  );
}

type OcrAccelStatus = {
  supported: boolean;
  provider: "dml" | "coreml" | null;
  bytes: number;
  installed: boolean;
  active: boolean;
  state: "IDLE" | "DOWNLOADING" | "MEASURING" | "FAILED";
  progress: { file: string; received: number; total: number; percent: number } | null;
  benchmark: {
    cpuSeconds: number;
    accelSeconds: number;
    lines: number;
    sameLines: number;
    accepted: boolean;
    reason: "FASTER_SAME_TEXT" | "NOT_FASTER" | "TEXT_DIFFERS" | "ACCEL_NOT_USED";
  } | null;
  auto: boolean;
  lastRun: {
    at: string;
    loadSeconds: number;
    pageSeconds: number[];
    threads: number | null;
    mkldnn: boolean;
    mkldnnError?: string | null;
    accel: string | null;
    workers: number;
    pages?: number;
    wallSeconds?: number;
    textModelResident?: boolean;
  } | null;
  error?: string;
};

/** One sentence for anyone: what OCR uses now and why, without settings to think about. */
export function ocrAccelHeadline(status: Pick<OcrAccelStatus, "active" | "installed" | "benchmark" | "state" | "auto" | "provider">): string {
  if (status.state === "DOWNLOADING" || status.state === "MEASURING") return t("Trwa jednorazowe ustawianie OCR na tym komputerze (w tle).");
  if (status.active) return t("OCR korzysta z karty graficznej: na tym komputerze jest szybsza (wybrane automatycznie).");
  if (status.benchmark) {
    return status.benchmark.reason === "NOT_FASTER"
      ? t("OCR korzysta z procesora: na tym komputerze jest szybszy od karty (wybrane automatycznie).")
      : t("OCR korzysta z procesora: karta graficzna nie dała tu pewnego wyniku (wybrane automatycznie).");
  }
  return status.auto
    ? t("OCR korzysta z procesora. Kilka minut po uruchomieniu aplikacja sama, jednorazowo sprawdzi kartę graficzną.")
    : t("OCR korzysta z procesora.");
}

/** "Ostatni OCR: 3 str., 12,4 s/str. (wczytanie modeli 6,1 s), procesor: oneDNN, 28 wątków". */
export function ocrRunSummary(run: NonNullable<OcrAccelStatus["lastRun"]>): string {
  const number = (value: number) => value.toLocaleString(currentLocale(), { maximumFractionDigits: 1 });
  const pages = run.pageSeconds.length;
  const average = pages ? run.pageSeconds.reduce((sum, value) => sum + value, 0) / pages : 0;
  const engine = run.accel ? `karta (${run.accel.replace("ExecutionProvider", "")})` : `procesor${run.mkldnn ? t(" z oneDNN") : " BEZ oneDNN (wolny tryb)"}`;
  // The whole document: what the user waited per page; per process it is longer when several
  // processes read pages at once.
  if (run.pages && run.wallSeconds) {
    return (
      t("Ostatni OCR: {pages} str. w {wallSeconds} s, {pages2} s/str. dokumentu", { pages: run.pages, wallSeconds: number(run.wallSeconds), pages2: number(run.wallSeconds / run.pages) }) +
      (run.workers > 1 ? t(" ({workers} procesy naraz, w każdym {average} s/str.)", { workers: run.workers, average: number(average) }) : "") +
      t(" (wczytanie modeli {loadSeconds} s), {engine}{value}", { loadSeconds: number(run.loadSeconds), engine: engine, value: run.threads ? `, ${run.threads} wątków` : "" }) +
      (run.accel && run.textModelResident ? t(", model tekstowy w pamięci karty") : "") +
      "." +
      (!run.accel && !run.mkldnn && run.mkldnnError ? t(" Powód wolnego trybu: {mkldnnError}", { mkldnnError: run.mkldnnError }) : "")
    );
  }
  return (
    `Ostatni OCR: ${pages} str., ${number(average)} s/str. (wczytanie modeli ${number(run.loadSeconds)} s), ${engine}` +
    `${run.threads ? t(", {threads} wątków", { threads: run.threads }) : ""}${run.workers > 1 ? `, ${run.workers} procesy` : ""}.` +
    (!run.accel && !run.mkldnn && run.mkldnnError ? t(" Powód wolnego trybu: {mkldnnError}", { mkldnnError: run.mkldnnError }) : "")
  );
}

const OCR_ACCEL_REASONS: Record<NonNullable<OcrAccelStatus["benchmark"]>["reason"], string> = {
  FASTER_SAME_TEXT: t("karta szybsza, ten sam tekst: OCR korzysta z karty"),
  NOT_FASTER: t("karta nie była wyraźnie szybsza od procesora: OCR zostaje na procesorze"),
  TEXT_DIFFERS: t("karta odczytała tekst inaczej niż procesor: OCR zostaje na procesorze"),
  ACCEL_NOT_USED: t("nie udało się uruchomić OCR na karcie: OCR zostaje na procesorze")
};

/**
 * OCR on the graphics card (any vendor: DirectML on Windows, CoreML on Apple Silicon): models
 * downloaded once, then the same pages are read both ways here and the faster one with the
 * same text is kept.
 */
function OcrAccelerationSection({ admin }: { admin: boolean }) {
  const developer = useDeveloperMode();
  const [status, setStatus] = useState<OcrAccelStatus | null>(null);
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    try {
      setStatus(await request<OcrAccelStatus>("/api/local-models/ocr-acceleration"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const working = status?.state === "DOWNLOADING" || status?.state === "MEASURING";
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [working]);

  async function act(action: "install" | "measure" | "remove"): Promise<void> {
    setError("");
    try {
      setStatus(await request<OcrAccelStatus>(`/api/local-models/ocr-acceleration/${action}`, { method: "POST" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  if (!status || !status.supported) return null;
  const progress = status.progress;
  const bench = status.benchmark;
  // Measurement figures, the last pass and the buttons: developer mode only (the choice is automatic).
  return (
    <div className="local-ai-facts">
      <strong>
        {t("OCR: procesor czy karta graficzna")}
        <InfoTip>
          {t("Aplikacja raz, sama i w tle, sprawdza, czy rozpoznawanie tekstu ze skanów jest szybsze na karcie graficznej (")}{status.provider === "dml" ? "DirectML: NVIDIA, AMD, Intel" : t("CoreML: układ graficzny i Neural Engine Apple")}{t(") czy na procesorze, i zostawia szybsze rozwiązanie, jeśli daje ten sam tekst. Nic nie trzeba ustawiać.")}
        </InfoTip>
      </strong>
      <small>{ocrAccelHeadline(status)}</small>
      {status.state === "DOWNLOADING" ? (
        <div className="local-ai-progress">
          <div>
            <strong>{t("Pobieranie modeli OCR dla karty (")}{formatBytes(status.bytes)})</strong>
            {progress ? <small>{progress.file}</small> : null}
          </div>
          {progress ? <progress max={100} value={progress.percent} /> : <progress />}
        </div>
      ) : status.state === "MEASURING" ? (
        <div className="local-ai-progress">
          <div>
            <strong>{t("Jednorazowy pomiar: procesor i karta (w tle, wstrzymuje się, gdy pracujesz)")}</strong>
          </div>
          <progress />
        </div>
      ) : null}
      {developer ? (
      <details className="local-ai-details">
        <summary>{t("Szczegóły")}</summary>
        {bench ? (
          <small>
            {t("Pomiar: procesor")} {bench.cpuSeconds} {t("s, karta")} {bench.accelSeconds} {t("s (4 strony), zgodne linie")} {bench.sameLines}/{bench.lines}: {OCR_ACCEL_REASONS[bench.reason]}.
          </small>
        ) : null}
        {status.lastRun ? <small>{ocrRunSummary(status.lastRun)}</small> : null}
        {status.state === "FAILED" && status.error ? <small className="local-ai-error">{t("Ostatnia próba:")} {status.error}</small> : null}
        {admin ? (
          <div className="local-ai-actions">
            <button type="button" disabled={status.installed || working} onClick={() => void act("install")}>
              {t("Pobierz i zmierz teraz")}
            </button>
            <button type="button" disabled={!status.installed || working} title={t("Po wymianie karty graficznej")} onClick={() => void act("measure")}>
              {t("Zmierz ponownie")}
            </button>
            <button type="button" className="local-ai-danger" disabled={!status.installed || working} onClick={() => void act("remove")}>
              {t("Usuń modele karty")}
            </button>
          </div>
        ) : null}
      </details>
      ) : null}
      {error ? <small className="local-ai-error">{error}</small> : null}
    </div>
  );
}

type SttAccelStatus = {
  supported: boolean;
  bytes: number;
  installed: boolean;
  active: boolean;
  state: "IDLE" | "DOWNLOADING" | "MEASURING" | "FAILED";
  progress: { file: string; received: number; total: number; percent: number } | null;
  benchmark: {
    cpuSeconds: number;
    cudaSeconds: number;
    words: number;
    sameWords: number;
    accepted: boolean;
    reason: "FASTER_SAME_TEXT" | "NOT_FASTER" | "TEXT_DIFFERS" | "CUDA_NOT_USED";
    cudaError?: string;
  } | null;
  auto: boolean;
  lastRun: { device: "cpu" | "cuda"; seconds: number; audioSeconds: number; cudaError?: string; at: string } | null;
  error?: string;
};

/** One sentence for anyone: what transcription uses now, without settings to think about. */
export function sttAccelHeadline(status: Pick<SttAccelStatus, "active" | "benchmark" | "state" | "auto">, modelInstalled: boolean): string {
  if (status.state === "DOWNLOADING" || status.state === "MEASURING") return t("Trwa jednorazowe ustawianie transkrypcji na karcie NVIDIA (w tle).");
  if (status.active) return t("Transkrypcja korzysta z karty NVIDIA: na tym komputerze jest szybsza (wybrane automatycznie).");
  if (status.benchmark) {
    return status.benchmark.reason === "NOT_FASTER"
      ? t("Transkrypcja korzysta z procesora: na tym komputerze jest szybszy od karty (wybrane automatycznie).")
      : t("Transkrypcja korzysta z procesora: karta NVIDIA nie dała tu pewnego wyniku (wybrane automatycznie).");
  }
  if (!modelInstalled) return t("Po zainstalowaniu modelu transkrypcji aplikacja sama, jednorazowo sprawdzi kartę NVIDIA.");
  return status.auto
    ? t("Transkrypcja korzysta z procesora. Kilka minut po uruchomieniu aplikacja sama, jednorazowo sprawdzi kartę NVIDIA.")
    : t("Transkrypcja korzysta z procesora.");
}

/** "Ostatnia transkrypcja: 12:30 nagrania w 41 s (18x szybciej niż czas nagrania), karta NVIDIA." */
export function sttRunSummary(run: NonNullable<SttAccelStatus["lastRun"]>): string {
  const number = (value: number) => value.toLocaleString(currentLocale(), { maximumFractionDigits: 1 });
  const minutes = Math.floor(run.audioSeconds / 60);
  const seconds = Math.round(run.audioSeconds % 60);
  const speed = run.seconds > 0 ? run.audioSeconds / run.seconds : 0;
  return (
    t("Ostatnia transkrypcja: {minutes}:{value} nagrania w {seconds} s", { minutes: minutes, value: String(seconds).padStart(2, "0"), seconds: number(run.seconds) }) +
    `${speed ? ` (${number(speed)}x czasu nagrania)` : ""}, ${run.device === "cuda" ? "karta NVIDIA" : "procesor"}.` +
    (run.cudaError ? t(" Karta nie zadziałała: {cudaError}", { cudaError: run.cudaError }) : "")
  );
}

const STT_ACCEL_REASONS: Record<NonNullable<SttAccelStatus["benchmark"]>["reason"], string> = {
  FASTER_SAME_TEXT: t("karta szybsza, te same słowa: transkrypcja korzysta z karty"),
  NOT_FASTER: t("karta nie była wyraźnie szybsza od procesora: transkrypcja zostaje na procesorze"),
  TEXT_DIFFERS: t("karta napisała inny tekst niż procesor: transkrypcja zostaje na procesorze"),
  CUDA_NOT_USED: t("nie udało się uruchomić transkrypcji na karcie: transkrypcja zostaje na procesorze")
};

/**
 * Transcription on an NVIDIA card (CUDA): the NVIDIA libraries downloaded once, then the same
 * recording transcribed both ways here and the faster one with the same words kept.
 */
function TranscriptionAccelerationSection({ admin, modelInstalled }: { admin: boolean; modelInstalled: boolean }) {
  const developer = useDeveloperMode();
  const [status, setStatus] = useState<SttAccelStatus | null>(null);
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    try {
      setStatus(await request<SttAccelStatus>("/api/local-models/transcription-acceleration"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const working = status?.state === "DOWNLOADING" || status?.state === "MEASURING";
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [working]);

  async function act(action: "install" | "measure" | "remove"): Promise<void> {
    setError("");
    try {
      setStatus(await request<SttAccelStatus>(`/api/local-models/transcription-acceleration/${action}`, { method: "POST" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  if (!status || !status.supported) return null;
  const progress = status.progress;
  const bench = status.benchmark;
  return (
    <div className="local-ai-facts">
      <strong>
        {t("Transkrypcja: procesor czy karta NVIDIA")}
        <InfoTip>
          {t("Na komputerze z kartą NVIDIA aplikacja raz, sama i w tle, pobiera biblioteki NVIDIA (cuBLAS, cuDNN; około")}{" "}
          {formatBytes(status.bytes)}{t(", każda sprawdzona SHA-256), zamienia to samo nagranie na tekst na procesorze i na karcie i zostawia szybsze rozwiązanie, jeśli daje te same słowa. Nic nie trzeba ustawiać.")}
        </InfoTip>
      </strong>
      <small>{sttAccelHeadline(status, modelInstalled)}</small>
      {status.state === "DOWNLOADING" ? (
        <div className="local-ai-progress">
          <div>
            <strong>{t("Pobieranie bibliotek NVIDIA (")}{formatBytes(status.bytes)})</strong>
            {progress ? <small>{progress.file}</small> : null}
          </div>
          {progress ? <progress max={100} value={progress.percent} /> : <progress />}
        </div>
      ) : status.state === "MEASURING" ? (
        <div className="local-ai-progress">
          <div>
            <strong>{t("Jednorazowy pomiar: procesor i karta (w tle, wstrzymuje się, gdy pracujesz)")}</strong>
          </div>
          <progress />
        </div>
      ) : null}
      {developer ? (
        <details className="local-ai-details">
          <summary>{t("Szczegóły")}</summary>
          {bench ? (
            <small>
              {t("Pomiar (90 s nagrania): procesor")} {bench.cpuSeconds} {t("s, karta")} {bench.cudaSeconds} {t("s, zgodne słowa")} {bench.sameWords}/{bench.words}:{" "}
              {STT_ACCEL_REASONS[bench.reason]}.{bench.cudaError ? t(" Błąd karty: {cudaError}", { cudaError: bench.cudaError }) : ""}
            </small>
          ) : null}
          {status.lastRun ? <small>{sttRunSummary(status.lastRun)}</small> : null}
          {status.state === "FAILED" && status.error ? <small className="local-ai-error">{t("Ostatnia próba:")} {status.error}</small> : null}
          {admin ? (
            <div className="local-ai-actions">
              <button type="button" disabled={status.installed || working || !modelInstalled} onClick={() => void act("install")}>
                {t("Pobierz i zmierz teraz")}
              </button>
              <button type="button" disabled={!status.installed || working || !modelInstalled} title={t("Po wymianie karty lub sterownika")} onClick={() => void act("measure")}>
                {t("Zmierz ponownie")}
              </button>
              <button type="button" className="local-ai-danger" disabled={!status.installed || working} onClick={() => void act("remove")}>
                {t("Usuń biblioteki NVIDIA")}
              </button>
            </div>
          ) : null}
        </details>
      ) : null}
      {error ? <small className="local-ai-error">{error}</small> : null}
    </div>
  );
}

type ChatTurnsSummary = {
  file: string;
  turns: number;
  paths: Array<{
    path: string;
    modelKind: "local" | "api" | "account";
    turns: number;
    errors: number;
    blocked: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    phasesP50Ms: Partial<Record<"PREPARE" | "ROUTING" | "SKILLS" | "MODEL" | "VERIFY" | "RESTORE", number>>;
  }>;
};

const PHASE_SHORT: Record<string, string> = {
  PREPARE: "anonimizacja",
  ROUTING: "routing",
  SKILLS: "skille",
  MODEL: "model",
  VERIFY: "weryfikacja",
  RESTORE: "przywrócenie"
};

/** "local · pisma-procesowe-v3: 12 tur, mediana 41 s, 95% do 78 s, błędy 1 (model 36 s, anonimizacja 3 s)". */
export function chatPathLine(row: ChatTurnsSummary["paths"][number]): string {
  const sec = (ms: number) => (ms / 1000).toLocaleString(currentLocale(), { maximumFractionDigits: 1 });
  const kind = row.modelKind === "local" ? "lokalny" : row.modelKind === "account" ? "konto" : "API";
  const phases = Object.entries(row.phasesP50Ms)
    .filter(([, ms]) => (ms ?? 0) >= 500)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([phase, ms]) => `${PHASE_SHORT[phase] ?? phase} ${sec(ms ?? 0)} s`)
    .join(", ");
  return (
    t("{kind} · {path}: {turns} tur, mediana {p50Ms} s, 95% do {p95Ms} s", { kind: kind, path: row.path, turns: row.turns, p50Ms: sec(row.p50Ms), p95Ms: sec(row.p95Ms) }) +
    (row.errors ? t(", błędy {errors}", { errors: row.errors }) : "") +
    (row.blocked ? `, zablokowane ${row.blocked}` : "") +
    (phases ? ` (${phases})` : "")
  );
}

/** Developer mode: times of the chat paths on this computer (no text of the messages). */
function ChatTurnsSection() {
  const developer = useDeveloperMode();
  const [data, setData] = useState<ChatTurnsSummary | null>(null);
  useEffect(() => {
    if (!developer) return;
    request<ChatTurnsSummary>("/api/diagnostics/chat-turns").then(setData, () => setData(null));
  }, [developer]);
  if (!developer || !data) return null;
  return (
    <div className="local-ai-facts">
      <strong>
        {t("Czas czatu na tym komputerze")}
        <InfoTip>{t("Ostatnie")} {data.turns} {t("tur czatu według ścieżki i etapu. Bez treści wiadomości. Plik:")} {data.file}</InfoTip>
      </strong>
      {data.paths.length === 0 ? <small>{t("Brak zapisanych tur.")}</small> : data.paths.slice(0, 12).map((row) => <small key={`${row.modelKind}:${row.path}`}>{chatPathLine(row)}</small>)}
    </div>
  );
}

type TranscriptionStatus = {
  modelId: string;
  label: string;
  license: string;
  bytes: number;
  installed: boolean;
  state: "IDLE" | "DOWNLOADING" | "FAILED";
  progress: { file: string; received: number; total: number; percent: number } | null;
  error?: string;
  // Who speaks when (older runtimes do not send it); count 0 = estimated.
  speakers?: { installed: boolean; bytes: number; count?: number };
  // Mac with Apple Silicon: the copy of the model for the GPU (null elsewhere).
  gpu?: { installed: boolean; bytes: number } | null;
};

/**
 * Speech-to-text of recordings (audio, video) uploaded to a case: Whisper on this computer,
 * downloaded once (about 1.6 GB, each file checked against its SHA-256).
 */
function TranscriptionSection({ admin }: { admin: boolean }) {
  const [status, setStatus] = useState<TranscriptionStatus | null>(null);
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    try {
      setStatus(await request<TranscriptionStatus>("/api/local-models/transcription"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (status?.state !== "DOWNLOADING") return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [status?.state]);

  async function act(action: "install" | "remove"): Promise<void> {
    setError("");
    try {
      setStatus(await request<TranscriptionStatus>(`/api/local-models/transcription/${action}`, { method: "POST" }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function setSpeakers(count: number): Promise<void> {
    setError("");
    try {
      setStatus(await request<TranscriptionStatus>("/api/local-models/transcription/speakers", { method: "POST", body: JSON.stringify({ count }) }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  if (!status) return null;
  const progress = status.progress;
  return (
    <>
    <div className="local-ai-facts">
      <strong>
        {t("Transkrypcja nagrań")}
        <InfoTip>
          {t("Nagrania audio i wideo (MP3, M4A, WAV, MP4, MOV i inne) wgrane do sprawy zamieniają się w tekst z oznaczeniem czasu, na tym komputerze: nagranie nigdzie nie jest wysyłane. Potem tekst przechodzi anonimizację jak każdy dokument.")}
        </InfoTip>
      </strong>
      <small>
        {status.label}, {formatBytes(status.bytes)}{t(", licencja")} {status.license}
      </small>
      {status.state === "DOWNLOADING" ? (
        <div className="local-ai-progress">
          <div>
            <strong>{t("Pobieranie i sprawdzanie SHA-256")}</strong>
            {progress ? <small>{progress.file}</small> : null}
          </div>
          {progress ? <progress max={100} value={progress.percent} /> : <progress />}
          {progress ? (
            <small>
              {formatBytes(progress.received)} / {formatBytes(progress.total)} · {progress.percent}%
            </small>
          ) : null}
        </div>
      ) : status.installed ? (
        <>
          <small>{t("Zainstalowany. Wgraj nagranie do sprawy, a powstanie z niego tekst ze znacznikami czasu.")}</small>
          {status.speakers ? (
            <small>
              {t("Rozpoznawanie rozmówców:")}{" "}
              {status.speakers.installed
                ? t("gotowe (transkrypcja dzieli tekst na osoby, nazwy zmienisz w podglądzie dokumentu).")
                : t("modele ({value} MB) pobiorą się same w tle albo przyciskiem „Pobierz model transkrypcji”.", { value: Math.round(status.speakers.bytes / 1_000_000) })}
            </small>
          ) : null}
          {status.gpu ? (
            <small>
              {t("Karta graficzna Apple:")}{" "}
              {status.gpu.installed
                ? t("model gotowy; przy pierwszym nagraniu aplikacja zmierzy, czy karta jest szybsza od procesora, i wtedy jej użyje.")
                : t("model ({value} MB) pobierze się sam w tle albo przyciskiem „Pobierz model transkrypcji”.", { value: Math.round(status.gpu.bytes / 1_000_000) })}
            </small>
          ) : null}
          {status.speakers?.installed && admin ? (
            <label className="local-ai-inline-select">
              {t("Liczba rozmówców w nagraniach")}
              <InfoTip>{t("Znana liczba osób (np. 3 na rozprawie: sąd i dwie strony) daje dokładniejszy podział niż ocena automatyczna.")}</InfoTip>
              <select value={status.speakers.count ?? 0} onChange={(event) => void setSpeakers(Number(event.target.value))}>
                <option value={0}>{t("automatycznie")}</option>
                <option value={2}>2</option>
                <option value={3}>{t("3 (np. rozprawa)")}</option>
                {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      ) : (
        <small>{t("Nie zainstalowany.")}</small>
      )}
      {status.state === "FAILED" && status.error ? <small className="local-ai-error">{t("Pobieranie nie powiodło się:")} {status.error}</small> : null}
      {admin ? (
        <div className="local-ai-actions">
          <button
            type="button"
            disabled={(status.installed && (status.speakers?.installed ?? true) && (status.gpu?.installed ?? true)) || status.state === "DOWNLOADING"}
            onClick={() => void act("install")}
          >
            {t("Pobierz model transkrypcji")}
          </button>
          <button
            type="button"
            className="local-ai-danger"
            disabled={!status.installed || status.state === "DOWNLOADING"}
            onClick={() => void act("remove")}
          >
            {t("Usuń model transkrypcji")}
          </button>
        </div>
      ) : (
        <small>{t("Model pobiera administrator.")}</small>
      )}
      {error ? <small className="local-ai-error">{error}</small> : null}
    </div>
    <TranscriptionAccelerationSection admin={admin} modelInstalled={status.installed} />
    </>
  );
}

export function LocalAiSetupPanel({
  user,
  embedded = false
}: {
  user: AuthenticatedUser;
  embedded?: boolean;
}) {
  const [data, setData] = useState<LocalModelsResponse | null>(null);
  const [modelId, setModelId] = useState("");
  const [contextTokens, setContextTokens] = useState(64_000);
  const [backendPreference, setBackendPreference] =
    useState<BackendPreference>("AUTO");
  const [busy, setBusy] = useState(false);
  const [modelUpdate, setModelUpdate] =
    useState<ModelPackUpdateStatus | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [
    minimized,
    setMinimized
  ] = useState(!embedded);
  const floatingDrag =
    useFloatingPanelDrag();

  const available = isDesktopShell();
  const selected = useMemo(
    () => data?.models.find((model) => model.id === modelId),
    [data, modelId]
  );
  const policy = data?.runtime.contextPolicy;
  const profiles = useMemo(() => {
    if (!policy || !selected) return [];
    return policy.recommendedProfiles.filter(
      (value) =>
        value >= selected.minimumContextWindow &&
        value <= selected.maximumContextWindow
    );
  }, [policy, selected]);

  async function refresh(): Promise<void> {
    if (!available) return;
    try {
      const next =
        await request<LocalModelsResponse>(
          "/api/local-models"
        );
      setData(next);
      window.dispatchEvent(
        new Event(
          "lex-local-models-changed"
        )
      );
      const preferred =
        modelId &&
        next.models.some(
          (item) =>
            item.id === modelId
        )
          ? modelId
          : next.runtime.selectedModelId ??
            next.models[0]?.id ??
            "";
      setModelId(preferred);
      if (
        user.appRole === "ADMIN" &&
        preferred
      ) {
        setModelUpdate(
          await request<ModelPackUpdateStatus>(
            `/api/local-models/update/status?modelId=${encodeURIComponent(
              preferred
            )}`
          )
        );
      } else {
        setModelUpdate(null);
      }
      const preferredModel = next.models.find((item) => item.id === preferred);
      const preferredContext =
        next.runtime.configuredContextTokens ??
        next.runtime.contextPolicy.default;
      setContextTokens(
        preferredModel
          ? Math.min(
              preferredModel.maximumContextWindow,
              Math.max(preferredModel.minimumContextWindow, preferredContext)
            )
          : preferredContext
      );
      setBackendPreference(
        next.runtime.hardware
          .backendSelectionMode ??
        next.runtime.backendPolicy
          .default
      );
      setError("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }

  useEffect(() => {
    void refresh();
  }, [available, user.appRole]);

  // Zatrzymanie odpytywania w toku (także przy odmontowaniu panelu).
  const stopActivePolling =
    useRef<(() => void) | null>(null);

  function startProvisioningPolling(): () => void {
    stopActivePolling.current?.();
    const stop = startGuardedPolling(
      () => request<LocalModelsResponse>("/api/local-models"),
      setData,
      750
    );
    stopActivePolling.current = stop;
    return stop;
  }

  function stopProvisioningPolling(stop: () => void): void {
    stop();
    if (stopActivePolling.current === stop) {
      stopActivePolling.current = null;
    }
  }

  useEffect(() => () => {
    stopActivePolling.current?.();
    stopActivePolling.current = null;
  }, []);

  useEffect(() => {
    if (!selected) return;
    setContextTokens((current) =>
      Math.min(
        selected.maximumContextWindow,
        Math.max(selected.minimumContextWindow, current)
      )
    );
    if (
      user.appRole === "ADMIN"
    ) {
      void request<ModelPackUpdateStatus>(
        `/api/local-models/update/status?modelId=${encodeURIComponent(
          selected.id
        )}`
      )
        .then((status) => {
          setModelUpdate(status);
        })
        .catch((problem) => {
          setModelUpdate(null);
          setError(
            problem instanceof Error
              ? problem.message
              : String(problem)
          );
        });
    }
  }, [
    selected?.id,
    user.appRole
  ]);

  if (!available) return null;

  const configured = data?.runtime.configured === true;
  const extended = Boolean(
    selected && contextTokens > selected.nativeContextWindow
  );
  // Installation runs on Windows and on Macs with Apple Silicon (runtime:
  // LOCAL_MODEL_PROVISIONING_PLATFORM_UNSUPPORTED elsewhere); elsewhere it is not offered.
  const provisioningSupported = data?.runtime.hardware?.platform
    ? data.runtime.hardware.platform === "win32" || (data.runtime.hardware.platform === "darwin" && data.runtime.hardware.arch === "arm64")
    : !/Linux/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");
  const canProvision =
    provisioningSupported &&
    user.appRole === "ADMIN" &&
    Boolean(selected) &&
    !busy &&
    !data?.runtime.provisioning &&
    contextTokens >= (selected?.minimumContextWindow ?? Number.MAX_SAFE_INTEGER) &&
    contextTokens <= (selected?.maximumContextWindow ?? 0) &&
    Boolean(policy) &&
    Boolean(
      data?.runtime
        .backendPolicy
        .allowed.includes(
          backendPreference
        )
    ) &&
    ((contextTokens - (policy?.minimum ?? 0)) % (policy?.step ?? 1) === 0);

  async function provision(): Promise<void> {
    if (!canProvision || !selected) return;
    setBusy(true);
    setError("");
    setMessage(
      t("Pobieram zweryfikowany silnik i wybrany model. Aplikacja pozostaje zainstalowana niezależnie od tej operacji.")
    );
    const polling =
      startProvisioningPolling();
    try {
      const result = await request<LocalProvisionResponse>(
        "/api/local-models/provision",
        {
          method: "POST",
          body: JSON.stringify({
            modelId: selected.id,
            contextTokens,
            backendPreference
          })
        }
      );
      setData((current) => current ? {
        ...current,
        runtime: result.runtime,
        models: current.models.map((item) =>
          item.id === result.model.id ? result.model : item
        )
      } : current);
      setMessage(
        t("Lokalna AI gotowa: {displayName}, kontekst {contextTokens}. Przeładowuję interfejs.", { displayName: result.model.displayName, contextTokens: formatTokens(result.contextTokens) })
      );
      window.setTimeout(() => window.location.reload(), 350);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setMessage("");
    } finally {
      stopProvisioningPolling(
        polling
      );
      await refresh();
      setBusy(false);
    }
  }

  async function applyModelUpdate(): Promise<void> {
    if (
      user.appRole !== "ADMIN" ||
      busy ||
      modelUpdate?.status !== "AVAILABLE" ||
      !selected ||
      modelUpdate.modelId !==
        selected.id
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage(
      modelUpdate.signatureMode === "UNSIGNED_ALLOWED"
        ? t("Pobieram aktualizację modelu do stagingu. Tryb przejściowy dopuszcza brak podpisu, ale SHA-256, indeks, zgodność i rollback pozostają obowiązkowe.")
        : t("Pobieram podpisaną aktualizację modelu do stagingu. Stary GGUF pozostaje rollbackiem do czasu udanego testu /health.")
    );
    const polling =
      startProvisioningPolling();
    try {
      const result = await request<
        LocalProvisionResponse & {
          receipt: {
            packVersion: string;
            signerKeyId: string;
            indexSha256: string;
            modelSha256: string;
          };
          update: ModelPackUpdateStatus;
        }
      >(
        "/api/local-models/update/apply",
        {
          method: "POST",
          body:
            JSON.stringify({
              modelId:
                selected.id,
              contextTokens,
              backendPreference
            })
        }
      );
      setData((current) => current ? {
        ...current,
        runtime: result.runtime,
        models: current.models.map((item) =>
          item.id === result.model.id ? result.model : item
        )
      } : current);
      setModelUpdate(result.update);
      const preservedOtherActive =
        Boolean(
          data?.runtime
            .selectedModelId &&
          data.runtime
            .selectedModelId !==
            result.model.id
        );
      setMessage(
        result.receipt.signerKeyId === "UNSIGNED_ALLOWED"
          ? t("Model {displayName} zaktualizowano z pakietu {packVersion}. Pakiet bez podpisu: sprawdzono SHA-256, indeks i działanie modelu (PASS). Profil {contextTokens} tokenów przeszedł ponowną walidację.{value}", { displayName: result.model.displayName, packVersion: result.receipt.packVersion, contextTokens: formatTokens(result.contextTokens), value: preservedOtherActive ? t(" Poprzednio aktywny model pozostał aktywny.") : "" })
          : t("Model {displayName} zaktualizowano z podpisanego pakietu {packVersion}. Podpis: {signerKeyId}. Profil {contextTokens} tokenów przeszedł ponowną walidację.{value}", { displayName: result.model.displayName, packVersion: result.receipt.packVersion, signerKeyId: result.receipt.signerKeyId, contextTokens: formatTokens(result.contextTokens), value: preservedOtherActive ? t(" Poprzednio aktywny model pozostał aktywny.") : "" })
      );
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : String(problem)
      );
      setMessage("");
    } finally {
      stopProvisioningPolling(
        polling
      );
      await refresh();
      setBusy(false);
    }
  }

  async function repair(): Promise<void> {
    if (
      user.appRole !== "ADMIN" ||
      busy ||
      !configured
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage(
      t("Weryfikuję zapisany model, silnik i kontekst oraz wykonuję test uruchomienia.")
    );
    const polling =
      startProvisioningPolling();
    try {
      const result = await request<LocalProvisionResponse>(
        "/api/local-models/repair",
        { method: "POST" }
      );
      setData((current) => current ? {
        ...current,
        runtime: result.runtime,
        models: current.models.map((item) =>
          item.id === result.model.id ? result.model : item
        )
      } : current);
      setMessage(
        t("Naprawa zakończona: {displayName}, {contextTokens} tokenów.", { displayName: result.model.displayName, contextTokens: formatTokens(result.contextTokens) })
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setMessage("");
    } finally {
      stopProvisioningPolling(
        polling
      );
      await refresh();
      setBusy(false);
    }
  }

  async function startLocal(): Promise<void> {
    if (!configured || busy || !modelId) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{
        runtime: LocalRuntimeStatus;
      }>(
        "/api/local-models/start",
        {
          method: "POST",
          body: JSON.stringify({
            // Start exactly what the user selected in the dropdown. Do not
            // silently fall back to the previously configured model.
            modelId
          })
        }
      );
      setData((current) => current ? {
        ...current,
        runtime: result.runtime
      } : current);
      setMessage(t("Lokalny model został uruchomiony."));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  async function stopLocal(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{
        runtime: LocalRuntimeStatus;
      }>(
        "/api/local-models/stop",
        { method: "POST" }
      );
      setData((current) => current ? {
        ...current,
        runtime: result.runtime
      } : current);
      setMessage(t("Lokalny model został zatrzymany."));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected(): Promise<void> {
    if (
      user.appRole !== "ADMIN" ||
      busy ||
      !selected?.installed
    ) {
      return;
    }
    if (
      !window.confirm(
        t("Usunąć model „{displayName}” z dysku (plik modelu i jego kopię w pamięci podręcznej instalatora)? Ponowne użycie będzie wymagało ponownego pobrania.", { displayName: selected.displayName })
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("Usuwam wybrany lokalny model.");
    try {
      await request<{
        removedModelId: string;
        configRemoved: boolean;
        runtime: LocalRuntimeStatus;
      }>(
        "/api/local-models/remove",
        {
          method: "POST",
          body: JSON.stringify({
            modelId: selected.id
          })
        }
      );
      setMessage(t("Model został usunięty. Odświeżam konfigurację."));
      window.setTimeout(() => window.location.reload(), 350);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setMessage("");
      setBusy(false);
    }
  }

  if (minimized && !embedded) {
    return (
      <div
        className="local-ai-setup local-ai-setup-minimized"
        data-floating-panel="true"
        style={
          floatingDrag.style
        }
      >
        <span
          className="floating-drag-handle"
          title={t("Przeciągnij panel")}
          aria-label={t("Przeciągnij panel lokalnej AI")}
          {...floatingDrag.handleProps}
        >
          ⋮⋮
        </span>
        <button
          type="button"
          className="floating-icon-button"
          aria-label={t("Rozwiń panel lokalnej AI")}
          title={
            configured
              ? "Lokalna AI · gotowa"
              : "Lokalna AI · konfiguracja"
          }
          onClick={() =>
            setMinimized(false)
          }
        >
          🤖
        </button>
        {configured ? (
          <span
            className="local-ai-ready-dot"
            aria-label={t("Lokalna AI gotowa")}
          />
        ) : null}
      </div>
    );
  }

  return (
    <details
      className={
        embedded
          ? "local-ai-setup local-ai-setup-embedded"
          : "local-ai-setup"
      }
      open={
        embedded
          ? true
          : !configured
      }
      data-floating-panel={
        embedded ? undefined : "true"
      }
      style={
        embedded
          ? undefined
          : floatingDrag.style
      }
    >
      <summary>
        {!embedded ? (
          <span
            className="floating-drag-handle"
            title={t("Przeciągnij panel")}
            aria-label={t("Przeciągnij panel lokalnej AI")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            {...floatingDrag.handleProps}
          >
            ⋮⋮
          </span>
        ) : null}
        <span className="local-ai-title">
          <strong>{t("Lokalna AI")}</strong>
          <small>
            {configured
              ? t("gotowa · {value} tokenów", { value: formatTokens(data?.runtime.configuredContextTokens ?? 0) })
              : t("opcjonalna · instalowana dopiero na żądanie")}
          </small>
        </span>
        <span className={configured ? "local-ai-badge ready" : "local-ai-badge"}>
          {configured ? "GOTOWA" : "NIEZAINSTALOWANA"}
        </span>
        {!embedded ? (
          <button
            type="button"
            className="floating-minimize-button"
            aria-label={t("Zminimalizuj panel lokalnej AI")}
            title={t("Zminimalizuj do ikony")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMinimized(true);
            }}
          >
            −
          </button>
        ) : null}
      </summary>

      <div className="local-ai-body">
        {provisioningSupported ? null : (
          <p className="local-ai-error" role="note">
            {t("Instalacja modelu lokalnego jest dostępna w Windows i na Macach z procesorem Apple. W tym systemie korzystaj z modeli przez klucz API albo konto dostawcy (Ustawienia → Modele i AI).")}
          </p>
        )}

        {data ? (
          <>
            <label>
              {t("Model lokalny")}
              {provisioningSupported ? (
                <InfoTip>
                  {t("Program działa też bez niego. Instalacja pobiera silnik i jeden wybrany model, który potem działa wyłącznie na tym komputerze.")}
                </InfoTip>
              ) : null}
              <select
                value={modelId}
                disabled={busy || user.appRole !== "ADMIN"}
                onChange={(event) => setModelId(event.target.value)}
              >
                {data.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {item.quantization}
                    {item.installed ? " · pobrany" : ""}
                  </option>
                ))}
              </select>
            </label>

            {selected && policy ? (
              <>
                <label>
                  {t("Sposób obliczeń")}
                  <select
                    value={backendPreference}
                    disabled={busy || user.appRole !== "ADMIN"}
                    onChange={(event) =>
                      setBackendPreference(
                        event.target.value as BackendPreference
                      )
                    }
                  >
                    {data.runtime.backendPolicy.allowed.map((value) => (
                      <option key={value} value={value}>
                        {backendLabel(value, data.runtime.backendPolicy.allowed.includes("METAL_ARM64"))}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {t("Kontekst")}
                  <select
                    value={contextTokens}
                    disabled={busy || user.appRole !== "ADMIN"}
                    onChange={(event) => setContextTokens(Number(event.target.value))}
                  >
                    {profiles.map((value) => (
                      <option key={value} value={value}>
                        {contextLabel(value, selected.nativeContextWindow)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {t("Dokładna wartość:")} {formatTokens(contextTokens)} {t("tokenów")}
                  <input
                    type="range"
                    min={selected.minimumContextWindow}
                    max={selected.maximumContextWindow}
                    step={policy.step}
                    value={contextTokens}
                    disabled={busy || user.appRole !== "ADMIN"}
                    onChange={(event) => setContextTokens(Number(event.target.value))}
                  />
                </label>

                <div className="local-ai-facts">
                  <span>{t("Natywny kontekst:")} {formatTokens(selected.nativeContextWindow)}</span>
                  <span>{t("Dozwolony profil:")} {formatTokens(selected.minimumContextWindow)}–{formatTokens(selected.maximumContextWindow)}</span>
                  <span>{extended ? "Tryb: YaRN — rozszerzenie ponad natywne okno" : "Tryb: natywny / zredukowany"}</span>
                  <span>
                    {t("Sprzęt:")} {formatBytes(data.runtime.hardware.totalMemoryBytes)} RAM
                    {" · "}{data.runtime.hardware.logicalCpuCount} {t("wątków logicznych")}
                    {data.runtime.hardware.cpuModel
                      ? ` · ${data.runtime.hardware.cpuModel}`
                      : ""}
                  </span>
                  <span>
                    {t("Aktywny sposób obliczeń:")} {data.runtime.hardware.configuredBackend ?? t("nie skonfigurowano")}
                    {" · "}{t("tryb wyboru:")} {data.runtime.hardware.backendSelectionMode ?? backendPreference}
                    {data.runtime.hardware.accelerators.length > 0
                      ? t(" · urządzenia graficzne: {value}", { value: data.runtime.hardware.accelerators.map((item) => item.name).join(", ") })
                      : t(" · brak wykrytego urządzenia graficznego")}
                    {data.runtime.hardware.gpuOffloadEnabled
                      ? " · GPU offload potwierdzony"
                      : data.runtime.hardware.gpuCandidateDetected
                        ? " · GPU wykryte, ale niepotwierdzone jako aktywne"
                        : ""}
                    {!data.runtime.hardware.gpuOffloadEnabled && data.runtime.hardware.gpuFailure
                      ? t(" · ostatni start na karcie (wersja {appVersion}) nie powiódł się: {error}; kolejna próba po aktualizacji aplikacji", { appVersion: data.runtime.hardware.gpuFailure.appVersion, error: data.runtime.hardware.gpuFailure.error })
                      : ""}
                  </span>
                  {data.runtime.qualification &&
                  data.runtime.qualification.modelId === selected.id ? (
                    <span>
                      {t("Walidacja sprzętowa: PASS ·")} {formatTokens(data.runtime.qualification.contextTokens)} {t("tokenów")}
                      {" · "}{t("obliczenia")} {data.runtime.qualification.backend ?? data.runtime.hardware.configuredBackend ?? "CPU_X64_PORTABLE"}
                      {" · "}{t("start")} {data.runtime.qualification.startupMs.toLocaleString(currentLocale())} {t("ms")}
                      {" · "}{new Date(data.runtime.qualification.validatedAt).toLocaleString(currentLocale())}
                    </span>
                  ) : (
                    <span>{t("Walidacja sprzętowa: brak potwierdzonego profilu dla tego modelu.")}</span>
                  )}
                  {user.appRole === "ADMIN" && modelUpdate ? (
                    <span>
                      {t("Kanał aktualizacji")}{" "}
                      {modelUpdate.modelFamily === "BIELIK"
                        ? "Bielik"
                        : modelUpdate.modelFamily === "MISTRAL"
                          ? "Mistral"
                          : "modelu"}:{" "}
                      {modelUpdate.status === "UP_TO_DATE"
                        ? modelUpdate.packPublished === false
                          ? t("aktualny (model z instalatora; nowsza paczka modelu nie została opublikowana)")
                          : "aktualny"
                        : modelUpdate.status === "AVAILABLE"
                          ? [
                              modelUpdate.signatureMode === "SIGNED_REQUIRED"
                                ? t("dostępna podpisana paczka {value}", { value: modelUpdate.latestPackVersion ?? "" })
                                : t("dostępna paczka {value} · podpis tymczasowo opcjonalny", { value: modelUpdate.latestPackVersion ?? "" }),
                              modelUpdate.targetDisplayName
                                ? `→ ${modelUpdate.targetDisplayName}`
                                : "",
                              modelUpdate.targetBytes
                                ? `(${formatBytes(modelUpdate.targetBytes)})`
                                : ""
                            ].filter(Boolean).join(" ")
                          : modelUpdate.status === "NOT_CONFIGURED"
                            ? t("model nie jest jeszcze skonfigurowany")
                            : modelUpdate.status === "UNAVAILABLE"
                              ? t("sprawdzenie niedostępne")
                              : `zablokowany bezpiecznie: ${modelPackBlockLabel(modelUpdate.blockedReason)}`}
                    </span>
                  ) : null}
                </div>

                {modelUpdate?.signatureMode === "UNSIGNED_ALLOWED" ? (
                  <p className="local-ai-warning">
                    {t("Tryb przejściowy: podpis Ed25519 indeksu modeli jest opcjonalny. HTTPS, zgodność wersji i SHA-256 modelu są nadal sprawdzane.")}
                  </p>
                ) : null}

                {extended ? (
                  <p className="local-ai-warning">
                    {t("Wartość przekracza natywne okno modelu (YaRN): więcej pamięci, jakość może być niższa.")}
                  </p>
                ) : null}
              </>
            ) : null}

            {data.runtime.progress ? (
              <div className="local-ai-progress">
                <div>
                  <strong>
                    {progressLabel(data.runtime.progress.phase)}
                  </strong>
                  <small>
                    {data.runtime.progress.label}
                  </small>
                </div>
                {data.runtime.progress.percent !== null ? (
                  <progress
                    max={100}
                    value={data.runtime.progress.percent}
                  />
                ) : data.runtime.provisioning ? (
                  <progress />
                ) : null}
                <small>
                  {formatBytes(data.runtime.progress.bytesDownloaded)}
                  {data.runtime.progress.bytesTotal !== null
                    ? ` / ${formatBytes(data.runtime.progress.bytesTotal)}`
                    : ""}
                  {data.runtime.progress.percent !== null
                    ? ` · ${data.runtime.progress.percent}%`
                    : ""}
                </small>
              </div>
            ) : null}

            {user.appRole === "ADMIN" ? (
              <>
                <button
                  type="button"
                  className="local-ai-primary"
                  disabled={!canProvision}
                  onClick={() => void provision()}
                >
                  {busy || data.runtime.provisioning
                    ? t("Operacja w toku…")
                    : configured
                      ? t("Zmień model, kontekst lub sposób obliczeń")
                      : t("Pobierz i skonfiguruj lokalną AI")}
                </button>

                {configured ? (
                  <div className="local-ai-actions">
                    <button
                      type="button"
                      disabled={busy || data.runtime.state === "READY"}
                      onClick={() => void startLocal()}
                    >
                      {t("Uruchom")}
                    </button>
                    <button
                      type="button"
                      disabled={busy || data.runtime.state === "STOPPED"}
                      onClick={() => void stopLocal()}
                    >
                      {t("Zatrzymaj")}
                    </button>
                    <button
                      type="button"
                      disabled={busy || data.runtime.provisioning}
                      onClick={() => void repair()}
                    >
                      {t("Napraw")}
                    </button>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        data.runtime.provisioning ||
                        modelUpdate?.status !== "AVAILABLE" ||
                        !selected ||
                        modelUpdate.modelId !==
                          selected.id
                      }
                      onClick={() => void applyModelUpdate()}
                    >
                      {t("Aktualizuj model")}
                    </button>
                    <button
                      type="button"
                      className="local-ai-danger"
                      disabled={busy || !selected?.installed}
                      onClick={() => void removeSelected()}
                    >
                      {t("Usuń model")}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <small>{t("Zmiany modelu lokalnego wykonuje administrator.")}</small>
            )}
          </>
        ) : null}

        <LocalOfflineSection admin={user.appRole === "ADMIN"} />

        {data ? <VisionOcrSection admin={user.appRole === "ADMIN"} /> : null}

        <TranscriptionSection admin={user.appRole === "ADMIN"} />

        <OcrAccelerationSection admin={user.appRole === "ADMIN"} />
        {user.appRole === "ADMIN" ? <ChatTurnsSection /> : null}

        {message ? <p className="local-ai-message">{message}</p> : null}

        {error ? (
          <p className="local-ai-error">
            {error.includes("PLATFORM_UNSUPPORTED")
              ? t("Ta operacja lokalnego AI nie jest jeszcze dostępna w tym systemie (działa w Windows).")
              : error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
