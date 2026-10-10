import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ApiError,
  downloadApplicationUpdate,
  getSkillChannelStatus,
  getUpdateStatus,
  installStagedApplicationUpdate,
  isDesktopShell,
  refreshSkillsFromChannel,
  type ApplicationUpdateDownloadResponse,
  type AuthenticatedUser,
  type SkillChannel,
  type SkillChannelStatusResponse,
  type UpdateStatusResponse
} from "./api.js";
import {
  useFloatingPanelDrag
} from "./use-floating-panel.js";
import { CaseLawLibrarySection } from "./CaseLawLibrarySection.js";
import { DomainFallbackSection } from "./DomainFallbackSection.js";
import { CoreLawUpdatesSection } from "./CoreLawUpdatesSection.js";
import { AnomalyJournalSection } from "./AnomalyJournalSection.js";
import { QualityBenchmarkSection } from "./QualityBenchmarkSection.js";
import "./maintenance.css";

const CHANNEL_LABEL: Record<SkillChannel, string> = {
  stable: "stabilna",
  development: "rozwojowa"
};

function shortDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("pl-PL") : "—";
}

function channelUnavailableText(reason: string | undefined): string {
  if (!reason) return "Nie udało się sprawdzić kanału skilli.";
  if (/GITHUB_HTTP_(403|429)/.test(reason)) {
    return "GitHub odrzucił sprawdzenie (limit zapytań bez logowania). Spróbuj ponownie za godzinę.";
  }
  if (/fetch failed|ENOTFOUND|ECONN|timeout|aborted/i.test(reason)) {
    return "Brak połączenia z GitHub — nie sprawdzono kanału skilli.";
  }
  if (reason === "SKILL_CHANNEL_DIRECTORY_MISSING") {
    return "W repozytorium Lex Machina nie ma katalogu tego kanału.";
  }
  return `Nie udało się sprawdzić kanału skilli (${reason}).`;
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

  if (code === "SKILL_CHANNEL_SIGNED_POLICY_BLOCKED") {
    return "Polityka bezpieczeństwa wymaga podpisanych skilli, a kanał repozytorium nie jest podpisany — odświeżenie z kanału jest zablokowane.";
  }
  // Wydanie bez instalatora dla tego systemu (z sumą SHA-256 GitHub), nie błąd podpisu.
  if (code === "APPLICATION_UPDATE_INSTALLER_NOT_VERIFIED") {
    return "Najnowsze wydanie nie zawiera instalatora dla tego systemu (z sumą SHA-256) — aktualizacji nie można pobrać z poziomu programu.";
  }
  if (
    code.includes("SIGNER_POLICY_MISSING") ||
    code.includes("SIGNER_NOT_TRUSTED") ||
    code.includes("SIGNATURE_INVALID") ||
    code.includes("NOT_VERIFIED")
  ) {
    return "Aktualizacja programu jest zablokowana przez politykę bezpieczeństwa: produkcyjny podpis Authenticode nie został jeszcze poprawnie skonfigurowany albo nie przeszedł weryfikacji.";
  }
  if (
    code.includes("APPLICATION_UPDATE_MANUAL_INSTALL_REQUIRED") ||
    code.includes("APPLICATION_UPDATE_PLATFORM_UNSUPPORTED")
  ) {
    return "Aplikację aktualizuje się instalatorem ze strony wydania: pobierz najnowszy instalator Lex Machina (Windows: Online-x64-Setup.exe, macOS: .pkg) i uruchom go (dane i ustawienia zostają).";
  }
  if (code === "APPLICATION_UPDATE_NOT_AVAILABLE") {
    return "Brak nowszej wersji programu do pobrania.";
  }
  if (code === "SKILL_UPDATE_NOT_AVAILABLE") {
    return "Brak nowszego pakietu skilli do zastosowania.";
  }
  return code;
}

export function manualUpdateInstruction(userAgent: string): string {
  return /Mac OS X|Macintosh/i.test(userAgent)
    ? "Otworzono stronę wydania w przeglądarce: pobierz plik .pkg dla macOS (Apple silicon) i uruchom go. Dane i ustawienia zostają."
    : "Otworzono stronę wydania w przeglądarce: pobierz plik Online-x64-Setup.exe i uruchom go (instalator bez podpisu: w oknie SmartScreen wybierz „Więcej informacji” > „Uruchom mimo to”). Dane i ustawienia zostają.";
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

async function openReleasePage(url: string): Promise<void> {
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

  const badge = useMemo(() => {
    if (appUpdateAvailable || skillUpdateAvailable) {
      return "AKTUALIZACJA";
    }
    if (appStatus?.status === "UNAVAILABLE") {
      return "OFFLINE";
    }
    return "AKTUALNE";
  }, [
    appStatus?.status,
    appUpdateAvailable,
    skillUpdateAvailable
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
      "Pobieram instalator do stagingu i weryfikuję SHA-256, ProductVersion oraz wymaganą politykę Authenticode."
    );
    try {
      const result =
        await downloadApplicationUpdate();
      setStaged(result);
      setMessage(
        result.publisher.verification === "AUTHENTICODE"
          ? `Zweryfikowano ${result.filename} (${formatBytes(result.bytes)}). Authenticode + ProductVersion ${result.publisher.productVersion}: PASS. Aktualizacja jest gotowa do instalacji.`
          : `Zweryfikowano ${result.filename} (${formatBytes(result.bytes)}). SHA-256 + ProductVersion ${result.publisher.productVersion}: PASS. UWAGA: aktualizacja bez podpisu jest tymczasowo dozwolona.`
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
      "Przekazuję aktualizację do zewnętrznej transakcji. Program zostanie zamknięty, zaktualizowany, sprawdzony i uruchomiony ponownie."
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
      `Pobieram skille z kanału ${CHANNEL_LABEL[channel]} repozytorium Lex Machina, sprawdzam sumę każdego pliku i strukturę, potem aktywuję.`
    );
    try {
      const result = await refreshSkillsFromChannel(channel);
      setMessage(
        `Skille odświeżone z kanału ${CHANNEL_LABEL[result.channel]} (${result.directory}, commit ${result.commit.slice(0, 7)}, ${result.files} plików). Uruchom ponownie program, aby runtime załadował skille; przy nieudanym starcie wróci poprzednia wersja.`
      );
      setSkillStatus(await getSkillChannelStatus(channel));
    } catch (problem) {
      setMessage("");
      setError(friendlyError(problem));
    } finally {
      setBusy(null);
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
          title="Przeciągnij panel"
          aria-label="Przeciągnij panel utrzymania"
          {...floatingDrag.handleProps}
        >
          ⋮⋮
        </span>
        <button
          type="button"
          className="floating-icon-button"
          aria-label="Rozwiń panel utrzymania"
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
            aria-label="Dostępna aktualizacja"
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
            title="Przeciągnij panel"
            aria-label="Przeciągnij panel utrzymania"
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
          <strong>Utrzymanie</strong>
          <small>
            program · skille · bezpieczne aktualizacje
          </small>
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
            aria-label="Zminimalizuj panel utrzymania"
            title="Zminimalizuj do ikony"
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
              <strong>Program</strong>
              <small>
                {appStatus
                  ? `${appStatus.currentVersion} → ${appStatus.latestVersion ?? "—"}`
                  : "sprawdzanie…"}
              </small>
            </div>
            <span>{appStatus?.status ?? "—"}</span>
          </div>

          <small className="maintenance-trust-warning">
            Aktualizacja programu wymaga weryfikacji SHA-256, wersji oraz zaufanego podpisu Authenticode zgodnie z polityką runtime.
          </small>

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
                  ? "Pobieranie i weryfikacja…"
                  : staged
                    ? "Pobierz ponownie"
                    : "Pobierz i zweryfikuj"}
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
                Zainstaluj i uruchom ponownie
              </button>
            </div>
          ) : (
            <small>
              Aktualizację programu instaluje administrator.
            </small>
          )}
        </section>

        <section>
          <div className="maintenance-heading">
            <div>
              <strong>Skille</strong>
              <small>
                {skillStatus
                  ? skillStatus.installed
                    ? `zainstalowane: ${CHANNEL_LABEL[skillStatus.installed.channel]}, commit ${skillStatus.installed.commit.slice(0, 7)} (${shortDate(skillStatus.installed.installedAt)})`
                    : "zainstalowane: wbudowane w instalator aplikacji"
                  : user.appRole === "ADMIN"
                    ? "sprawdzanie…"
                    : "status dostępny administratorowi"}
              </small>
            </div>
            <span>
              {skillStatus?.status === "UNAVAILABLE"
                ? "niedostępne"
                : skillStatus?.status === "AVAILABLE"
                  ? "do odświeżenia"
                  : skillStatus?.status === "UP_TO_DATE"
                    ? "aktualne"
                    : "—"}
            </span>
          </div>

          {user.appRole === "ADMIN" ? (
            <label className="maintenance-channel">
              Kanał skilli (repozytorium Lex Machina)
              <select
                value={channel}
                disabled={Boolean(busy)}
                onChange={(event) =>
                  selectChannel(event.target.value === "development" ? "development" : "stable")
                }
              >
                <option value="stable">Wersja stabilna</option>
                <option value="development">Wersja rozwojowa</option>
              </select>
            </label>
          ) : null}

          {skillStatus?.latest ? (
            <small>
              Najnowsze w kanale: {skillStatus.latest.directory}, commit {skillStatus.latest.commit.slice(0, 7)} z {shortDate(skillStatus.latest.committedAt)}, {skillStatus.latest.files} plików.
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
                ? "Pobieranie, weryfikacja i aktywacja…"
                : "Odśwież skille"}
            </button>
          ) : null}
        </section>

        <CoreLawUpdatesSection user={user} />

        <CaseLawLibrarySection />
        <DomainFallbackSection />

        <AnomalyJournalSection user={user} />

        <QualityBenchmarkSection user={user} />

        <button
          type="button"
          className="maintenance-refresh"
          disabled={Boolean(busy)}
          onClick={() => void refresh()}
        >
          Sprawdź ponownie
        </button>

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
