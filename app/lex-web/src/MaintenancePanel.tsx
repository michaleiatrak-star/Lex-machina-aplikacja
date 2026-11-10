import { currentLocale, t } from "./i18n";
import { ApplicationDownloadProgress } from "./ApplicationDownloadProgress.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ApiError,
  downloadApplicationUpdate,
  getSkillAutoUpdate,
  getSkillChannelStatus,
  getUpdateStatus,
  installStagedApplicationUpdate,
  isDesktopShell,
  refreshSkillsFromChannel,
  setSkillAutoUpdate,
  type ApplicationUpdateDownloadResponse,
  type AuthenticatedUser,
  type SkillAutoUpdateStateResponse,
  type SkillChannel,
  type SkillChannelStatusResponse,
  type UpdateStatusResponse
} from "./api.js";
import {
  useFloatingPanelDrag
} from "./use-floating-panel.js";
import { CaseLawLibrarySection } from "./CaseLawLibrarySection.js";
import { DomainFallbackSection } from "./DomainFallbackSection.js";
import { WebSearchSection } from "./WebSearchSection.js";
import { JurisdictionSection } from "./JurisdictionSection.js";
import { LegiIndexSection } from "./LegiIndexSection.js";
import { CoreLawUpdatesSection } from "./CoreLawUpdatesSection.js";
import { AnomalyJournalSection } from "./AnomalyJournalSection.js";
import { useDeveloperMode } from "./developer-mode.js";
import "./maintenance.css";
import { InfoTip } from "./InfoTip";

const CHANNEL_LABEL: Record<SkillChannel, string> = {
  stable: "stabilna",
  development: "rozwojowa"
};

function shortDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString(currentLocale()) : "—";
}

function autoUpdateOutcomeText(result: NonNullable<SkillAutoUpdateStateResponse["lastResult"]>): string {
  const source = result.source === "channel" && result.channel ? t("kanał {value}", { value: CHANNEL_LABEL[result.channel] }) : "wydanie skilli";
  const target = result.target ? (result.source === "channel" ? ` (commit ${result.target.slice(0, 7)})` : ` ${result.target}`) : "";
  switch (result.outcome) {
    case "INSTALLED":
      return `zainstalowano: ${source}${target}.`;
    case "UP_TO_DATE":
      return `aktualne (${source}).`;
    case "BLOCKED":
      return t("nowsze skille są, ale wydanie nie ma kompletu do weryfikacji ({value}); bez instalacji.", { value: result.detail ?? "brak" });
    default:
      return t("nie udało się ({source}: {value}).", { source: source, value: result.detail ?? "błąd" });
  }
}

function channelUnavailableText(reason: string | undefined): string {
  if (!reason) return t("Nie udało się sprawdzić kanału skilli.");
  if (/GITHUB_HTTP_(403|429)/.test(reason)) {
    return t("GitHub odrzucił sprawdzenie (limit zapytań bez logowania). Spróbuj ponownie za godzinę.");
  }
  if (/fetch failed|ENOTFOUND|ECONN|timeout|aborted/i.test(reason)) {
    return t("Brak połączenia z GitHub — nie sprawdzono kanału skilli.");
  }
  if (reason === "SKILL_CHANNEL_DIRECTORY_MISSING") {
    return t("W repozytorium Lex Machina nie ma katalogu tego kanału.");
  }
  return t("Nie udało się sprawdzić kanału skilli ({reason}).", { reason: reason });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function friendlyError(error: unknown): string {
  const code =
    error instanceof ApiError
      ? error.code
      : error instanceof Error
        ? error.message
        : String(error);

  if (/UPDATE_ASSET_HASH|UPDATE_ASSET_SIZE|UPDATE_ASSET_RANGE/.test(code)) {
    return t("Pobrane pliki są niekompletne lub uszkodzone. Spróbuj pobrać aktualizację ponownie.");
  }
  if (/UPDATE_ASSET_DOWNLOAD|fetch failed|Failed to fetch|TimeoutError|AbortError/.test(code)) {
    return t("Pobieranie zostało przerwane. Sprawdź połączenie z internetem i spróbuj ponownie.");
  }
  // The update runner (PowerShell) ended at once: it never ran the update script.
  if (code.startsWith("APPLICATION_UPDATE_RUNNER_EXITED")) {
    const detail = code.split(":").slice(2).join(":").trim();
    return (
      t("Instalator aktualizacji nie mógł się uruchomić: Windows zatrzymał skrypt aktualizacji (najczęściej zasady wykonywania ") +
      t("skryptów PowerShell ustawione przez administratora albo program antywirusowy). Aplikacja pozostaje bez zmian. ") +
      t("Zainstaluj nową wersję instalatorem ze strony wydania; szczegóły: %LOCALAPPDATA%\\LexMachina\\update-runner-start.log") +
      (detail ? ` (${detail.slice(0, 300)})` : "")
    );
  }
  if (code === "SKILL_CHANNEL_SIGNED_POLICY_BLOCKED") {
    return t("Polityka bezpieczeństwa wymaga podpisanych skilli, a kanał repozytorium nie jest podpisany — odświeżenie z kanału jest zablokowane.");
  }
  // Wydanie bez instalatora dla tego systemu (z sumą SHA-256 GitHub), nie błąd podpisu.
  if (code === "APPLICATION_UPDATE_INSTALLER_NOT_VERIFIED") {
    return t("Najnowsze wydanie nie zawiera instalatora dla tego systemu (z sumą SHA-256) — aktualizacji nie można pobrać z poziomu programu.");
  }
  if (
    code.includes("SIGNER_POLICY_MISSING") ||
    code.includes("SIGNER_NOT_TRUSTED") ||
    code.includes("SIGNATURE_INVALID") ||
    code.includes("NOT_VERIFIED")
  ) {
    return t("Aktualizacja programu jest zablokowana przez politykę bezpieczeństwa: produkcyjny podpis Authenticode nie został jeszcze poprawnie skonfigurowany albo nie przeszedł weryfikacji.");
  }
  if (
    code.includes("APPLICATION_UPDATE_MANUAL_INSTALL_REQUIRED") ||
    code.includes("APPLICATION_UPDATE_PLATFORM_UNSUPPORTED")
  ) {
    return t("Aplikację aktualizuje się instalatorem ze strony wydania: pobierz najnowszy instalator Lex Machina (Windows: Online-x64-Setup.exe, macOS: .pkg) i uruchom go (dane i ustawienia zostają).");
  }
  if (code === "APPLICATION_UPDATE_NOT_AVAILABLE") {
    return t("Brak nowszej wersji programu do pobrania.");
  }
  if (code === "SKILL_UPDATE_NOT_AVAILABLE") {
    return t("Brak nowszego pakietu skilli do zastosowania.");
  }
  return code;
}

export function appStatusLabel(status: string | undefined): string {
  switch (status) {
    case "UP_TO_DATE":
      return "aktualny";
    case "AVAILABLE":
      return t("dostępna aktualizacja");
    case "UNAVAILABLE":
      return t("nie można sprawdzić");
    case "NO_RELEASE":
      return "brak opublikowanego wydania";
    case undefined:
      return "sprawdzanie…";
    default:
      return status;
  }
}

export function manualUpdateInstruction(userAgent: string): string {
  return /Mac OS X|Macintosh/i.test(userAgent)
    ? t("Otworzono stronę wydania w przeglądarce: pobierz plik .pkg dla macOS (Apple silicon) i uruchom go. Dane i ustawienia zostają.")
    : t("Otworzono stronę wydania w przeglądarce: pobierz plik Online-x64-Setup.exe i uruchom go (instalator bez podpisu: w oknie SmartScreen wybierz „Więcej informacji” > „Uruchom mimo to”). Dane i ustawienia zostają.");
}

/**
 * macOS, and Windows while no Authenticode publisher is trusted: no in-app installer; the release page of the discovered version opens in the
 * browser so the user can take the new .pkg (only an https GitHub release page).
 */
export function manualUpdateReleaseUrl(
  error: unknown,
  status: UpdateStatusResponse | null
): string | null {
  const code =
    error instanceof ApiError
      ? error.code
      : error instanceof Error
        ? error.message
        : String(error);
  const url = status?.releaseUrl;
  if (
    !code.includes("APPLICATION_UPDATE_MANUAL_INSTALL_REQUIRED") ||
    !url ||
    !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/releases\/[^\s]*$/.test(url)
  ) {
    return null;
  }
  return url;
}

export async function openReleasePage(url: string): Promise<void> {
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
  if (internals?.invoke) {
    await internals.invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function MaintenancePanel({
  user,
  embedded = false
}: {
  user: AuthenticatedUser;
  embedded?: boolean;
}) {
  const developer = useDeveloperMode();
  const [appStatus, setAppStatus] =
    useState<UpdateStatusResponse | null>(null);
  const [channel, setChannel] =
    useState<SkillChannel>("stable");
  // Bez wyboru użytkownika panel pokazuje kanał zainstalowanych skilli (znacznik nakładki).
  // Ref, nie stan: refresh() wywołany zaraz po wyborze (i odświeżenie już w toku)
  // widziałby starą wartość i cofał panel do kanału zainstalowanego.
  const channelChosen =
    useRef(false);
  const [skillStatus, setSkillStatus] =
    useState<SkillChannelStatusResponse | null>(null);
  const [autoUpdate, setAutoUpdate] =
    useState<SkillAutoUpdateStateResponse | null>(null);
  const [staged, setStaged] =
    useState<ApplicationUpdateDownloadResponse | null>(null);
  const [busy, setBusy] = useState<
    "refresh" | "app-download" | "app-install" | "skills" | null
  >(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [
    minimized,
    setMinimized
  ] = useState(!embedded);
  const floatingDrag =
    useFloatingPanelDrag();

  const desktop = isDesktopShell();
  const appUpdateAvailable =
    appStatus?.status === "AVAILABLE";
  const skillUpdateAvailable =
    skillStatus?.status === "AVAILABLE";

  // "AKTUALNE" only after a finished check said so: never while checking, after an
  // error, or without any result.
  const badge = useMemo(() => {
    if (appUpdateAvailable || skillUpdateAvailable) {
      return "AKTUALIZACJA";
    }
    if (appStatus?.status === "UNAVAILABLE") {
      return "OFFLINE";
    }
    if (!desktop) {
      return "—";
    }
    if (busy === "refresh" || !appStatus) {
      return "SPRAWDZANIE";
    }
    if (error) {
      return t("BŁĄD SPRAWDZANIA");
    }
    return "AKTUALNE";
  }, [
    appStatus,
    appUpdateAvailable,
    skillUpdateAvailable,
    busy,
    error,
    desktop
  ]);

  async function refresh(
    selected: SkillChannel = channel
  ): Promise<void> {
    if (!desktop || busy) return;
    setBusy("refresh");
    setError("");
    try {
      const [application, skills] =
        await Promise.all([
          getUpdateStatus(),
          user.appRole === "ADMIN"
            ? getSkillChannelStatus(selected)
            : Promise.resolve(null)
        ]);
      setAppStatus(application);
      if (user.appRole === "ADMIN") {
        // Starszy runtime bez automatu (404): sekcja bez przełącznika.
        setAutoUpdate(await getSkillAutoUpdate().catch(() => null));
      }
      const installedChannel = skills?.installed?.channel;
      if (!channelChosen.current && installedChannel && installedChannel !== selected) {
        setChannel(installedChannel);
        setSkillStatus(await getSkillChannelStatus(installedChannel));
      } else {
        setSkillStatus(skills);
      }
    } catch (problem) {
      setError(friendlyError(problem));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void refresh();
  }, [desktop, user.appRole]);

  async function downloadUpdate(): Promise<void> {
    if (
      user.appRole !== "ADMIN" ||
      busy ||
      !appUpdateAvailable
    ) {
      return;
    }
    setBusy("app-download");
    setError("");
    setMessage(
      t("Pobieram aktualizację i sprawdzam, czy pliki są kompletne.")
    );
    try {
      const result =
        await downloadApplicationUpdate();
      setStaged(result);
      setMessage(
        t("Aktualizacja {version} jest gotowa do instalacji ({bytes}).", { version: result.version, bytes: formatBytes(result.bytes) })
      );
    } catch (problem) {
      setMessage("");
      const releaseUrl = manualUpdateReleaseUrl(problem, appStatus);
      if (releaseUrl) {
        try {
          await openReleasePage(releaseUrl);
          setMessage(
            manualUpdateInstruction(
              typeof navigator === "undefined" ? "" : navigator.userAgent
            )
          );
          return;
        } catch {
          // Fall through to the instruction without the page.
        }
      }
      setError(friendlyError(problem));
    } finally {
      setBusy(null);
    }
  }

  async function installUpdate(): Promise<void> {
    if (
      user.appRole !== "ADMIN" ||
      busy ||
      !staged
    ) {
      return;
    }
    setBusy("app-install");
    setError("");
    setMessage(
      /Mac OS X|Macintosh/i.test(navigator.userAgent)
        ? t("Otwieram instalator. Przejdź jego kroki; potem Lex Machina pokaże dalsze przygotowanie.")
        : t("Instaluję aktualizację. Aplikacja zamknie się i uruchomi ponownie po zakończeniu.")
    );
    try {
      await installStagedApplicationUpdate(
        staged.receiptToken
      );
    } catch (problem) {
      setBusy(null);
      setMessage("");
      setError(friendlyError(problem));
    }
  }

  async function updateSkills(): Promise<void> {
    if (
      user.appRole !== "ADMIN" ||
      busy
    ) {
      return;
    }
    setBusy("skills");
    setError("");
    setMessage(
      t("Pobieram skille z kanału {value} repozytorium Lex Machina, sprawdzam sumę każdego pliku i strukturę, potem aktywuję.", { value: CHANNEL_LABEL[channel] })
    );
    try {
      const result = await refreshSkillsFromChannel(channel);
      setMessage(
        t("Skille odświeżone z kanału {value} ({directory}, commit {value2}, {files} plików). Uruchom ponownie program, aby wczytał nowe skille; przy nieudanym starcie wróci poprzednia wersja.", { value: CHANNEL_LABEL[result.channel], directory: result.directory, value2: result.commit.slice(0, 7), files: result.files })
      );
      setSkillStatus(await getSkillChannelStatus(channel));
    } catch (problem) {
      setMessage("");
      setError(friendlyError(problem));
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutoUpdate(enabled: boolean): Promise<void> {
    setError("");
    try {
      setAutoUpdate(await setSkillAutoUpdate(enabled));
    } catch (problem) {
      setError(friendlyError(problem));
    }
  }

  function selectChannel(next: SkillChannel): void {
    setChannel(next);
    channelChosen.current = true;
    setSkillStatus(null);
    void refresh(next);
  }

  if (!desktop) return null;

  if (minimized && !embedded) {
    return (
      <div
        className="maintenance-panel maintenance-panel-minimized"
        data-floating-panel="true"
        style={
          floatingDrag.style
        }
      >
        <span
          className="floating-drag-handle"
          title={t("Przeciągnij panel")}
          aria-label={t("Przeciągnij panel utrzymania")}
          {...floatingDrag.handleProps}
        >
          ⋮⋮
        </span>
        <button
          type="button"
          className="floating-icon-button"
          aria-label={t("Rozwiń panel utrzymania")}
          title={
            `Utrzymanie · ${badge.toLowerCase()}`
          }
          onClick={() =>
            setMinimized(false)
          }
        >
          🛠
        </button>
        {badge === "AKTUALIZACJA" ? (
          <span
            className="floating-update-dot"
            aria-label={t("Dostępna aktualizacja")}
          />
        ) : null}
      </div>
    );
  }

  return (
    <details
      className={
        embedded
          ? "maintenance-panel maintenance-panel-embedded"
          : "maintenance-panel"
      }
      open={embedded ? true : undefined}
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
            aria-label={t("Przeciągnij panel utrzymania")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            {...floatingDrag.handleProps}
          >
            ⋮⋮
          </span>
        ) : null}
        <span className="maintenance-title">
          <strong>{t("Utrzymanie")}</strong>
        </span>
        <span
          className={
            badge === "AKTUALIZACJA"
              ? "maintenance-badge update"
              : "maintenance-badge"
          }
        >
          {badge}
        </span>
        {!embedded ? (
          <button
            type="button"
            className="floating-minimize-button"
            aria-label={t("Zminimalizuj panel utrzymania")}
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

      <div className="maintenance-body">
        <section>
          <div className="maintenance-heading">
            <div>
              <strong>
                {t("Program")}
                {!/Mac OS X|Macintosh/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "") ? (
                  <InfoTip>{t("Aktualizacja jest instalowana tylko po sprawdzeniu sumy kontrolnej, wersji i podpisu wydawcy.")}</InfoTip>
                ) : null}
              </strong>
              <small>
                {appStatus
                  ? `${appStatus.currentVersion} → ${appStatus.latestVersion ?? "—"}`
                  : "sprawdzanie…"}
              </small>
            </div>
            <span>{appStatusLabel(appStatus?.status)}</span>
          </div>

          {user.appRole === "ADMIN" ? (
            <div className="maintenance-actions">
              <button
                type="button"
                disabled={
                  Boolean(busy) ||
                  !appUpdateAvailable
                }
                onClick={() =>
                  void downloadUpdate()
                }
              >
                {busy === "app-download"
                  ? t("Pobieranie i weryfikacja…")
                  : staged
                    ? t("Pobierz ponownie")
                    : t("Pobierz i zweryfikuj")}
              </button>
              <button
                type="button"
                disabled={
                  Boolean(busy) ||
                  !staged
                }
                onClick={() =>
                  void installUpdate()
                }
              >
                {t("Zainstaluj i uruchom ponownie")}
              </button>
            </div>
          ) : (
            <small>
              {t("Aktualizację programu instaluje administrator.")}
            </small>
          )}
        </section>

        <section>
          <div className="maintenance-heading">
            <div>
              <strong>{t("Skille")}</strong>
              <small>
                {skillStatus
                  ? skillStatus.installed
                    ? `zainstalowane: ${CHANNEL_LABEL[skillStatus.installed.channel]}, commit ${skillStatus.installed.commit.slice(0, 7)} (${shortDate(skillStatus.installed.installedAt)})`
                    : t("zainstalowane: wbudowane w instalator aplikacji")
                  : user.appRole === "ADMIN"
                    ? "sprawdzanie…"
                    : t("stan dostępny administratorowi")}
              </small>
            </div>
            <span>
              {skillStatus?.status === "UNAVAILABLE"
                ? "niedostępne"
                : skillStatus?.status === "AVAILABLE"
                  ? t("do odświeżenia")
                  : skillStatus?.status === "UP_TO_DATE"
                    ? "aktualne"
                    : "—"}
            </span>
          </div>

          {user.appRole === "ADMIN" ? (
            <label className="maintenance-channel">
              {t("Kanał skilli")}
              <InfoTip>{t("Skille są pobierane z repozytorium Lex Machina.")}</InfoTip>
              <select
                value={channel}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  selectChannel(event.target.value === "development" ? "development" : "stable")
                }
              >
                <option value="stable">{t("Wersja stabilna")}</option>
                <option value="development">{t("Wersja rozwojowa")}</option>
              </select>
            </label>
          ) : null}

          {user.appRole === "ADMIN" && autoUpdate ? (
            <label className="maintenance-auto-update">
              <input
                type="checkbox"
                checked={autoUpdate.enabled}
                disabled={Boolean(busy)}
                onChange={(event) => void toggleAutoUpdate(event.target.checked)}
              />
              {t("Aktualizuj skille automatycznie")}
              <InfoTip>
                {t("Co")} {autoUpdate.intervalHours} {t("godz. program sprawdza skille: zainstalowane z kanału — ten sam kanał; wbudowane — podpisane wydanie skilli, tylko nowsza wersja. Pliki są weryfikowane jak przy ręcznym odświeżeniu, a nowe skille działają po ponownym uruchomieniu programu (nieudany start wraca do poprzednich).")}
              </InfoTip>
            </label>
          ) : null}

          {autoUpdate?.pendingActivation ? (
            <small className="maintenance-trust-warning">
              {t("Nowe skille są pobrane i sprawdzone. Uruchom ponownie program, aby zaczęły działać.")}
            </small>
          ) : null}

          {autoUpdate?.lastResult ? (
            <small>
              {t("Ostatnie automatyczne sprawdzenie:")} {shortDate(autoUpdate.lastResult.at)} — {autoUpdateOutcomeText(autoUpdate.lastResult)}
            </small>
          ) : null}

          {skillStatus?.latest ? (
            <small>
              {t("Najnowsze w kanale:")} {skillStatus.latest.directory}{t(", commit")} {skillStatus.latest.commit.slice(0, 7)} z {shortDate(skillStatus.latest.committedAt)}, {skillStatus.latest.files} {t("plików.")}
            </small>
          ) : null}

          {skillStatus?.status === "UNAVAILABLE" ? (
            <small className="maintenance-trust-warning">
              {channelUnavailableText(skillStatus.unavailableReason)}
            </small>
          ) : null}

          {user.appRole === "ADMIN" ? (
            <button
              type="button"
              disabled={
                Boolean(busy) ||
                skillStatus?.status === "UNAVAILABLE"
              }
              onClick={() =>
                void updateSkills()
              }
            >
              {busy === "skills"
                ? t("Pobieranie, weryfikacja i aktywacja…")
                : t("Odśwież skille")}
            </button>
          ) : null}
        </section>

        <CoreLawUpdatesSection user={user} />

        <CaseLawLibrarySection />
        <JurisdictionSection />
        <LegiIndexSection />
        <DomainFallbackSection />
        <WebSearchSection admin={user.appRole === "ADMIN"} />

        {developer ? <AnomalyJournalSection user={user} /> : null}

        <button
          type="button"
          className="maintenance-refresh"
          disabled={Boolean(busy)}
          onClick={() => void refresh()}
        >
          {t("Sprawdź ponownie")}
        </button>

        {busy === "app-download" ? <ApplicationDownloadProgress /> : null}
        {message ? (
          <p className="maintenance-message">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="maintenance-error">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
