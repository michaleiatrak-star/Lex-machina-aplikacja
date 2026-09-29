import {
  useEffect,
  useState
} from "react";
import {
  ApiError,
  checkMcpConnector,
  clearCeidgApiKey,
  getMcpConnectors,
  installMcpConnector,
  isDesktopShell,
  setCeidgApiKey,
  uninstallMcpConnector,
  type McpConnectorStatusResponse,
  type McpServerStatus
} from "./api.js";
import { INTEGRITY_TEXT } from "./McpSearchPanel.js";

const ERRORS: Record<string, string> = {
  CEIDG_KEY_NOT_JWT: "To nie wygląda na token CEIDG (JWT: trzy części rozdzielone kropkami). Wklej cały token.",
  CEIDG_KEY_REJECTED: "CEIDG odrzucił token (HTTP 401/403) — jest nieprawidłowy albo wygasł. Wygeneruj nowy w Hurtowni danych CEIDG.",
  CEIDG_KEY_REQUIRED: "CEIDG wymaga klucza API. Najpierw wklej i zatwierdź klucz poniżej.",
  CLAUDE_DESKTOP_NOT_INSTALLED: "Na tym komputerze nie znaleziono Claude Desktop — odznacz synchronizację.",
  CLAUDE_DESKTOP_CONFIG_INVALID: "Plik claude_desktop_config.json jest uszkodzony (niepoprawny JSON) — popraw go ręcznie.",
  LEX_MCP_PACKAGE_MISSING: "Brak pakietu serwerów MCP (audyt-systemu-v4/mcp-servers/dist/lex-mcp.mjs) w korpusie skilli.",
  LEX_MCP_PROBE_TIMEOUT: "Serwer MCP nie odpowiedział w 30 s — instalacja przerwana.",
  LEX_MCP_PROBE_NO_TOOLS: "Serwer MCP uruchomił się, ale nie zgłosił narzędzi — instalacja przerwana.",
  AUTHORIZATION_DENIED: "Konektorami MCP zarządza administrator aplikacji."
};

function checkText(server: McpServerStatus): string {
  const check = server.lastCheck;
  if (!check) return "";
  const at = new Date(check.at).toLocaleString("pl-PL");
  return check.ok
    ? ` · działa (sprawdzono ${at})`
    : ` · nie działa: ${ERRORS[check.error ?? ""] ?? check.error} (sprawdzono ${at})`;
}

function failureText(error: unknown): string {
  const code =
    error instanceof ApiError
      ? error.code
      : error instanceof Error
        ? error.message
        : String(error);
  return ERRORS[code] ?? code;
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
    if (internals?.invoke) {
      await internals.invoke("open_external_url", { url });
      return;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function groupsOf(
  servers: McpServerStatus[]
): Array<[string, McpServerStatus[]]> {
  const groups = new Map<string, McpServerStatus[]>();
  for (const server of servers) {
    groups.set(server.group, [...(groups.get(server.group) ?? []), server]);
  }
  return [...groups.entries()];
}

export function McpConnectorsPanel() {
  const [status, setStatus] =
    useState<McpConnectorStatusResponse | null>(null);
  const [busy, setBusy] =
    useState<string | null>(null);
  const [error, setError] =
    useState("");
  const [message, setMessage] =
    useState("");
  const [syncDesktop, setSyncDesktop] =
    useState(false);
  const [ceidgKey, setCeidgKey] =
    useState("");

  useEffect(() => {
    void getMcpConnectors()
      .then((next) => {
        setStatus(next);
        setSyncDesktop(next.desktop.available);
      })
      .catch((failure) => setError(failureText(failure)));
  }, []);

  async function run(
    label: string,
    action: () => Promise<{ status: McpConnectorStatusResponse }>,
    success: (result: unknown) => string
  ): Promise<void> {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const result = await action();
      setStatus(result.status);
      setMessage(success(result));
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(null);
    }
  }

  function install(server: McpServerStatus): void {
    void run(
      server.id,
      () => installMcpConnector(server.id, syncDesktop && Boolean(status?.desktop.available)),
      (result) =>
        `Zainstalowano ${server.id}: ${(result as { tools: string[] }).tools.join(", ")}.` +
        (syncDesktop && status?.desktop.available ? " Zrestartuj Claude Desktop." : "")
    );
  }

  function check(server: McpServerStatus): void {
    void run(
      `check-${server.id}`,
      () => checkMcpConnector(server.id),
      (result) => {
        const { check: outcome } = result as { check: { ok: boolean; tools?: string[]; error?: string } };
        return outcome.ok
          ? `${server.id} działa: ${outcome.tools?.join(", ")}.`
          : `${server.id} nie działa: ${ERRORS[outcome.error ?? ""] ?? outcome.error}.`;
      }
    );
  }

  function uninstall(server: McpServerStatus): void {
    void run(
      server.id,
      () => uninstallMcpConnector(server.id, syncDesktop && Boolean(status?.desktop.available)),
      () => `Odinstalowano ${server.id}.`
    );
  }

  function saveCeidgKey(): void {
    const key = ceidgKey.trim();
    if (!key) return;
    void run(
      "ceidg-key",
      () => setCeidgApiKey(key),
      (result) => {
        setCeidgKey("");
        const { verification, containsPersonalData } = result as {
          verification: string;
          containsPersonalData: boolean;
        };
        const verdict =
          verification === "VERIFIED"
            ? "Klucz CEIDG zatwierdzony — API przyjęło token."
            : verification === "RATE_LIMITED"
              ? "Klucz zapisany; CEIDG zwrócił limit zapytań (429), więc nie sprawdzono go teraz — nie ponawiaj od razu."
              : "Klucz zapisany, ale API CEIDG było nieosiągalne — sprawdzenie nastąpi przy pierwszym zapytaniu.";
        return verdict +
          " Teraz możesz zainstalować CEIDG." +
          (containsPersonalData ? " Token zawiera Twoje dane osobowe (PESEL) — nie udostępniaj go." : "");
      }
    );
  }

  function removeCeidgKey(): void {
    void run(
      "ceidg-key",
      () => clearCeidgApiKey(),
      () => "Klucz CEIDG usunięty. CEIDG nie będzie uruchamiany do czasu podania nowego klucza."
    );
  }

  return (
    <article className="chat-card">
      <p className="eyebrow">
        Audyt systemu · FAZA 0E
      </p>
      <h2>
        Konektory MCP Lex Machina
      </h2>
      <p>
        Serwery z <code>audyt-systemu-v4/mcp-servers</code> (własne, zamiast @matematicsolutions). Instalacja uruchamia serwer i sprawdza handshake MCP; zainstalowane źródła są dostępne w czacie przez federację źródeł prawa.
      </p>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert">{message}</div> : null}

      {status?.packageAvailable ? (
        <p className={status.package.integrity === "MATCH" ? "field-help" : "alert alert-error"}>
          Pakiet serwerów{status.package.version ? ` ${status.package.version}` : ""}
          {status.package.skillVersion ? ` (audyt-systemu-v4 ${status.package.skillVersion})` : ""}: {INTEGRITY_TEXT[status.package.integrity]}.
        </p>
      ) : null}

      {status && !status.packageAvailable ? (
        <div className="alert alert-error">
          Brak pakietu <code>{status.packagePath}</code> — zaktualizuj skille.
        </div>
      ) : null}

      {status ? (
        <>
          <label className="chat-toggle-row field-help">
            <input
              type="checkbox"
              checked={syncDesktop}
              disabled={!status.desktop.available || Boolean(busy)}
              onChange={(event) => setSyncDesktop(event.target.checked)}
            />
            <span>
              Instaluj i odinstalowuj także w Claude Desktop
              {status.desktop.available
                ? <> — <code>{status.desktop.configPath}</code> (kopia zapasowa przed każdą zmianą)</>
                : " — nie wykryto Claude Desktop na tym komputerze"}
            </span>
          </label>

          {groupsOf(status.servers).map(([group, servers]) => (
            <section key={group}>
              <h3>{group}</h3>
              <ul className="mcp-connector-list">
                {servers.map((server) => (
                  <li key={server.id}>
                    <span>
                      <strong>{server.id}</strong> — {server.label}
                      <small className="field-help">
                        {" · "}
                        {server.installed
                          ? server.ready
                            ? "zainstalowany"
                            : "zainstalowany, czeka na klucz"
                          : "niezainstalowany"}
                        {server.desktopInstalled ? " · Claude Desktop" : ""}
                        {checkText(server)}
                      </small>
                    </span>
                    {server.installed ? (
                      <span className="chat-form-row compact">
                        <button
                          type="button"
                          className="chat-secondary-action"
                          disabled={Boolean(busy) || !status.packageAvailable}
                          onClick={() => check(server)}
                        >
                          {busy === `check-${server.id}` ? "Sprawdzam…" : "Sprawdź"}
                        </button>
                        <button
                          type="button"
                          className="chat-secondary-action"
                          disabled={Boolean(busy)}
                          onClick={() => uninstall(server)}
                        >
                          {busy === server.id ? "Odinstalowuję…" : "Odinstaluj"}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="chat-primary-action"
                        disabled={
                          Boolean(busy) ||
                          !status.packageAvailable ||
                          (server.requiresKey !== undefined && !status.ceidg.keyConfigured)
                        }
                        onClick={() => install(server)}
                      >
                        {busy === server.id ? "Instaluję…" : "Zainstaluj"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section>
            <h3>Klucz API CEIDG</h3>
            <p className="field-help">
              CEIDG wymaga tokenu z Hurtowni danych CEIDG i Biznes.gov.pl (wniosek o dostęp, logowanie Profilem Zaufanym).{" "}
              <a
                href={status.ceidg.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void openExternalUrl(status.ceidg.keyUrl);
                }}
              >
                Uzyskaj klucz CEIDG
              </a>
            </p>
            <p className="field-help">
              Stan: {status.ceidg.keyConfigured ? "klucz zapisany" : "brak klucza"}. Klucz jest zapisywany lokalnie z uprawnieniami tylko dla Twojego konta, nigdy w repozytorium.
            </p>
            <label>
              Token CEIDG
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={ceidgKey}
                placeholder="eyJ…"
                onChange={(event) => setCeidgKey(event.target.value)}
              />
            </label>
            <div className="chat-form-row compact">
              <button
                type="button"
                className="chat-primary-action"
                disabled={Boolean(busy) || !ceidgKey.trim()}
                onClick={saveCeidgKey}
              >
                {busy === "ceidg-key" ? "Sprawdzam…" : "Zatwierdź klucz"}
              </button>
              <button
                type="button"
                className="chat-secondary-action"
                disabled={Boolean(busy) || !status.ceidg.keyConfigured}
                onClick={removeCeidgKey}
              >
                Usuń klucz
              </button>
            </div>
          </section>
        </>
      ) : !error ? (
        <p>Wczytywanie konektorów…</p>
      ) : null}
    </article>
  );
}
