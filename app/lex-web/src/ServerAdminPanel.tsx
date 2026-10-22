import { useEffect, useState } from "react";
import {
  ApiError,
  assignServerPlan,
  clearServerProviderKey,
  deleteServerPlan,
  getServerSettings,
  listLiveTurns,
  listServerAccounts,
  listServerPlans,
  listServerProviderKeys,
  saveServerPlan,
  sendServerTestMail,
  setServerAccountStatus,
  setServerModeEnabled,
  setServerBrowserProtocol,
  setServerNetworkAccess,
  setServerProviderKey,
  updateServerSettings,
  type BrowserProtocol,
  type LiveTurn,
  type NetworkAccess,
  type ProviderId,
  type ServerAccount,
  type ServerPlan,
  type ServerProviderKey,
  type ServerSettings
} from "./api.js";

const PROVIDERS: Array<[ProviderId, string]> = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["xai", "xAI"],
  ["google", "Google"]
];

const STAGES: Record<string, string> = {
  PREPARE: "przygotowanie",
  ROUTING: "routing",
  SKILLS: "skille",
  MODEL: "model",
  VERIFY: "weryfikacja",
  RESTORE: "przywracanie danych"
};

function failureText(failure: unknown): string {
  if (!(failure instanceof ApiError)) return "Brak połączenia z runtime.";
  const known: Record<string, string> = {
    AUTHORIZATION_DENIED: "Brak uprawnień administratora.",
    SERVER_MODE_FORCED: "Tryb jest ustalony zmienną LEX_SERVER_MODE_FORCE i nie można go zmienić tutaj.",
    INVALID_SMTP_SETTINGS: "Nieprawidłowe ustawienia SMTP.",
    INVALID_PUBLIC_BASE_URL: "Nieprawidłowy adres aplikacji (https://…).",
    MAIL_NOT_CONFIGURED: "Uzupełnij serwer SMTP, nadawcę i adres aplikacji.",
    MAIL_DELIVERY_FAILED: "Serwer SMTP odrzucił wiadomość albo jest nieosiągalny.",
    INVALID_PLAN: "Nieprawidłowy plan (nazwa, limit tokenów).",
    PLAN_NAME_EXISTS: "Plan o tej nazwie już istnieje.",
    PLAN_IN_USE: "Plan jest przypisany do kont albo jest planem domyślnym.",
    INVALID_PROVIDER_API_KEY: "Nieprawidłowy klucz API.",
    INVALID_GLOBAL_TOKEN_LIMIT: "Limit globalny musi być liczbą całkowitą (0 lub puste: bez limitu).",
    ADMIN_HAS_NO_PLAN: "Administrator nie podlega planom.",
    USER_STATUS_CONFLICT: "Nie można zmienić statusu konta administratora.",
    SERVER_MODE_REQUIRED: "Dostęp z sieci wymaga włączonego trybu serwerowego.",
    NETWORK_CHANGE_LOCAL_ONLY: "Dostęp z sieci zmienia się tylko na komputerze serwera (http://127.0.0.1).",
    HTTPS_REQUIRED_FOR_NETWORK: "Dostęp z sieci działa tylko z HTTPS.",
    TEMPORARY_ADMIN_PASSWORD: "Najpierw zmień tymczasowe hasło administratora (admin/admin).",
    BROWSER_ACCESS_UNAVAILABLE: "Strona aplikacji nie nasłuchuje (port zajęty albo wyłączony)."
  };
  return known[failure.code] ?? failure.code;
}

function tokens(value: number): string {
  return value.toLocaleString("pl-PL");
}

type PlanDraft = { planId: string | null; name: string; limit: string; providers: ProviderId[]; external: string };

const EMPTY_PLAN: PlanDraft = { planId: null, name: "", limit: "", providers: ["openai", "anthropic", "xai", "google"], external: "" };

/** Administrator: włączenie trybu serwerowego, SMTP, klucze API, limit globalny, plany, konta i podgląd tur na żywo. */
export function ServerAdminPanel({ onModeChanged }: { onModeChanged?: (enabled: boolean) => void }) {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [plans, setPlans] = useState<ServerPlan[]>([]);
  const [accounts, setAccounts] = useState<ServerAccount[]>([]);
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [smtp, setSmtp] = useState({ host: "", port: "587", secure: false, user: "", from: "", password: "" });
  const [testTo, setTestTo] = useState("");
  const [plan, setPlan] = useState<PlanDraft>(EMPTY_PLAN);
  const [providerKeys, setProviderKeys] = useState<ServerProviderKey[]>([]);
  const [keyInputs, setKeyInputs] = useState<Partial<Record<ProviderId, string>>>({});
  const [globalLimit, setGlobalLimit] = useState("");

  async function refresh(): Promise<void> {
    const current = await getServerSettings();
    setSettings(current);
    setBaseUrl(current.publicBaseUrl);
    setGlobalLimit(current.globalMonthlyTokenLimit === null ? "" : String(current.globalMonthlyTokenLimit));
    if (current.smtp) {
      setSmtp({ host: current.smtp.host, port: String(current.smtp.port), secure: current.smtp.secure, user: current.smtp.user, from: current.smtp.from, password: "" });
    }
    const [planList, accountList, keyList] = await Promise.all([listServerPlans(), listServerAccounts(), listServerProviderKeys()]);
    setPlans(planList);
    setAccounts(accountList);
    setProviderKeys(keyList);
  }

  useEffect(() => {
    void refresh().catch((failure: unknown) => setError(failureText(failure)));
  }, []);

  // Podgląd tur: same metadane (konto, sprawa, skill, etap, tokeny), co 3 sekundy.
  useEffect(() => {
    if (!settings?.serverMode) return;
    let cancelled = false;
    const poll = () =>
      void listLiveTurns()
        .then((items) => {
          if (!cancelled) setTurns(items);
        })
        .catch(() => undefined);
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [settings?.serverMode]);

  async function run(work: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      await refresh();
      setMessage(done);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <article className="chat-card">
        <p className="eyebrow">Tryb serwerowy</p>
        {error ? <div className="alert alert-error">{error}</div> : <p>Wczytywanie…</p>}
      </article>
    );
  }

  return (
    <section className="admin-users-panel">
      <div>
        <p className="eyebrow">Administracja</p>
        <h3>Tryb serwerowy</h3>
        <p className="field-help">
          W trybie serwerowym ukryte są funkcje działające na komputerze (logowanie kontem dostawcy przez klienta CLI, instalacja modeli
          lokalnych, aktualizacje aplikacji, zapis do folderu Pobrane). Dochodzi rejestracja e-mailem, plany z limitem tokenów oraz globalne
          klucze API i globalny limit tokenów ustawiane przez administratora. Płatności nie są obsługiwane.
        </p>
        <label className="chat-settings-channel-option">
          <input
            type="checkbox"
            checked={settings.serverMode}
            disabled={busy || settings.forced}
            onChange={(event) => {
              const enabled = event.target.checked;
              void run(async () => {
                await setServerModeEnabled(enabled);
                onModeChanged?.(enabled);
              }, enabled ? "Tryb serwerowy włączony." : "Tryb serwerowy wyłączony.");
            }}
          />
          Tryb serwerowy {settings.forced ? "(ustalony przez LEX_SERVER_MODE_FORCE)" : ""}
        </label>
      </div>

      <div>
        <h3>Dostęp przez przeglądarkę</h3>
        <p className="field-help">
          {settings.browser?.state === "LISTENING"
            ? `Aplikacja: ${settings.browser.addresses.join(", ")}.`
            : `Strona aplikacji nie nasłuchuje${settings.browser?.error ? ` (${settings.browser.error})` : ""}.`}
        </p>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy || settings.browser?.state !== "LISTENING"}>
          {(
            [
              ["LOCAL", "Lokalny (domyślny)", "Tylko z tego komputera (127.0.0.1). Połączenia z sieci są odrzucane."],
              [
                "NETWORK",
                "Z sieci",
                "Także z innych komputerów, tylko przez HTTPS: adresy IP serwera i nazwy wskazane przez administratora, ta sama strona, bez funkcji komputera serwera, limit logowań. Wymaga trybu serwerowego."
              ]
            ] as Array<[NetworkAccess, string, string]>
          ).map(([mode, label, help]) => (
            <label key={mode} className="chat-settings-channel-option">
              <input
                type="radio"
                name="lex-network-access"
                checked={settings.networkAccess === mode}
                disabled={mode === "NETWORK" && !settings.serverMode}
                onChange={() => {
                  void run(async () => {
                    await setServerNetworkAccess(mode);
                    // Serwer nasłuchuje od nowa; chwila na zamknięcie połączeń.
                    await new Promise((resolve) => window.setTimeout(resolve, 600));
                  }, mode === "NETWORK" ? "Dostęp z sieci włączony." : "Dostęp tylko z tego komputera.");
                }}
              />
              <span>
                <strong>{label}</strong> — {help}
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy || settings.browser?.state !== "LISTENING"}>
          {(
            [
              ["HTTPS", "HTTPS (domyślny)", "Połączenie szyfrowane. Wpisany adres http:// przechodzi na https://."],
              ["HTTP", "HTTP", "Bez szyfrowania; tylko dostęp lokalny albo za serwerem pośredniczącym z HTTPS."]
            ] as Array<[BrowserProtocol, string, string]>
          ).map(([protocol, label, help]) => (
            <label key={protocol} className="chat-settings-channel-option">
              <input
                type="radio"
                name="lex-browser-protocol"
                checked={settings.browserProtocol === protocol}
                disabled={protocol === "HTTP" && settings.networkAccess === "NETWORK"}
                onChange={() => {
                  void run(async () => {
                    await setServerBrowserProtocol(protocol);
                    await new Promise((resolve) => window.setTimeout(resolve, 600));
                    // Strona otwarta pod innym protokołem przechodzi na nowy adres.
                    const target = protocol === "HTTPS" ? "https:" : "http:";
                    if (window.location.protocol !== target) {
                      window.location.href = `${target}//${window.location.host}${window.location.pathname}`;
                    }
                  }, protocol === "HTTPS" ? "HTTPS włączone." : "HTTP włączone.");
                }}
              />
              <span>
                <strong>{label}</strong> — {help}
              </span>
            </label>
          ))}
        </fieldset>
        {settings.browser?.certificate && (
          <p className="field-help">
            Certyfikat {settings.browser.certificate.custom ? "kancelarii" : "aplikacji (przeglądarka ostrzega, dopóki nie dodasz go do zaufanych)"},
            ważny do {settings.browser.certificate.validTo.slice(0, 10)}, dla: {settings.browser.certificate.names.join(", ")}.
            Odcisk SHA-256: <code>{settings.browser.certificate.fingerprint256}</code>.{" "}
            <a href="/lex-certificate.crt" download="lex-machina.crt">Pobierz certyfikat</a>. Własny certyfikat: pliki custom.crt i
            custom.key w katalogu danych server/tls albo zmienne LEX_TLS_CERT i LEX_TLS_KEY.
          </p>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert">{message}</div>}

      <div>
        <h3>Poczta (SMTP)</h3>
        <p className="field-help">
          Bez skonfigurowanej poczty rejestracja i reset hasła są niedostępne. Hasło SMTP jest szyfrowane i nie wraca do przeglądarki.
        </p>
        <div className="admin-user-create">
          <label>
            Adres aplikacji (do linków w wiadomościach)
            <input value={baseUrl} placeholder="https://kancelaria.example.pl" onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label>
            Serwer SMTP
            <input value={smtp.host} onChange={(event) => setSmtp({ ...smtp, host: event.target.value })} />
          </label>
          <label>
            Port
            <input value={smtp.port} inputMode="numeric" onChange={(event) => setSmtp({ ...smtp, port: event.target.value })} />
          </label>
          <label className="chat-settings-channel-option">
            <input type="checkbox" checked={smtp.secure} onChange={(event) => setSmtp({ ...smtp, secure: event.target.checked })} />
            TLS od początku połączenia (port 465); bez zaznaczenia STARTTLS
          </label>
          <label>
            Użytkownik
            <input value={smtp.user} autoComplete="off" onChange={(event) => setSmtp({ ...smtp, user: event.target.value })} />
          </label>
          <label>
            Hasło ({settings.smtp?.passwordSet ? "ustawione" : "nieustawione"})
            <input
              type="password"
              value={smtp.password}
              autoComplete="new-password"
              placeholder={settings.smtp?.passwordSet ? "pozostaw puste, aby nie zmieniać" : ""}
              onChange={(event) => setSmtp({ ...smtp, password: event.target.value })}
            />
          </label>
          <label>
            Nadawca (adres e-mail)
            <input value={smtp.from} onChange={(event) => setSmtp({ ...smtp, from: event.target.value })} />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  updateServerSettings({
                    publicBaseUrl: baseUrl,
                    ...(smtp.host
                      ? {
                          smtp: {
                            host: smtp.host.trim(),
                            port: Number(smtp.port),
                            secure: smtp.secure,
                            user: smtp.user.trim(),
                            from: smtp.from.trim(),
                            ...(smtp.password ? { password: smtp.password } : {})
                          }
                        }
                      : {})
                  }),
                "Zapisano ustawienia poczty."
              )
            }
          >
            Zapisz
          </button>
        </div>
        <div className="admin-user-create">
          <label>
            Wyślij wiadomość testową na adres
            <input value={testTo} onChange={(event) => setTestTo(event.target.value)} />
          </label>
          <button type="button" disabled={busy || !testTo.trim()} onClick={() => void run(() => sendServerTestMail(testTo.trim()), "Wiadomość testowa wysłana.")}>
            Wyślij test
          </button>
        </div>
      </div>

      <div>
        <h3>Klucze API dostawców</h3>
        <p className="field-help">
          Jeden klucz na dostawcę dla wszystkich kont. Klucz jest szyfrowany kluczem serwera i nie wraca do przeglądarki; widać tylko, czy jest
          ustawiony. Bez klucza używany jest klucz ze zmiennej środowiskowej serwera, jeśli jest.
        </p>
        <div className="admin-users-list">
          {PROVIDERS.map(([id, label]) => {
            const stored = providerKeys.find((item) => item.provider === id);
            return (
              <article key={id} className="admin-user-row">
                <div>
                  <strong>{label}</strong>
                  <span>
                    {stored?.configured
                      ? `klucz ustawiony${stored.updatedAt ? ` (${new Date(stored.updatedAt).toLocaleString("pl-PL")})` : ""}`
                      : "klucz nieustawiony"}
                  </span>
                </div>
                <div className="admin-user-actions">
                  <input
                    type="password"
                    autoComplete="off"
                    aria-label={`Klucz API ${label}`}
                    placeholder={stored?.configured ? "nowy klucz zastąpi obecny" : "Wklej klucz API"}
                    value={keyInputs[id] ?? ""}
                    onChange={(event) => setKeyInputs({ ...keyInputs, [id]: event.target.value })}
                  />
                  <button
                    type="button"
                    disabled={busy || !(keyInputs[id] ?? "").trim()}
                    onClick={() =>
                      void run(async () => {
                        await setServerProviderKey(id, (keyInputs[id] ?? "").trim());
                        setKeyInputs({ ...keyInputs, [id]: "" });
                      }, `Zapisano klucz ${label}.`)
                    }
                  >
                    Zapisz
                  </button>
                  {stored?.configured && (
                    <button type="button" className="danger-button" disabled={busy} onClick={() => void run(() => clearServerProviderKey(id), `Usunięto klucz ${label}.`)}>
                      Usuń
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div>
        <h3>Limit globalny</h3>
        <p className="field-help">
          Suma tokenów wejścia i wyjścia wszystkich kont w miesiącu kalendarzowym (UTC). Sprawdzany przed każdym wywołaniem modelu razem z
          limitem planu. 0 albo puste: bez limitu globalnego.
        </p>
        <p>
          Zużycie w {settings.month}: <strong>{tokens(settings.globalUsage.inputTokens + settings.globalUsage.outputTokens)}</strong>
          {settings.globalMonthlyTokenLimit !== null ? ` z ${tokens(settings.globalMonthlyTokenLimit)}` : " (bez limitu)"} tokenów
        </p>
        <div className="admin-user-create">
          <label>
            Limit tokenów miesięcznie (wszystkie konta)
            <input value={globalLimit} inputMode="numeric" onChange={(event) => setGlobalLimit(event.target.value)} />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => updateServerSettings({ globalMonthlyTokenLimit: globalLimit.trim() ? Number(globalLimit.trim()) : null }),
                "Zapisano limit globalny."
              )
            }
          >
            Zapisz limit
          </button>
        </div>
      </div>

      <div>
        <h3>Plany</h3>
        <p className="field-help">
          Limit to suma tokenów wejścia i wyjścia w miesiącu kalendarzowym (UTC). Konto bez planu korzysta z planu domyślnego; bez niego
          (poza administratorem) model nie jest dostępny.
        </p>
        <label>
          Plan domyślny nowych kont
          <select
            value={settings.defaultPlanId ?? ""}
            disabled={busy}
            onChange={(event) => void run(() => updateServerSettings({ defaultPlanId: event.target.value || null }), "Zapisano plan domyślny.")}
          >
            <option value="">(brak)</option>
            {plans.map((item) => (
              <option key={item.planId} value={item.planId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-users-list">
          {plans.map((item) => (
            <article key={item.planId} className="admin-user-row">
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.monthlyTokenLimit === null ? "bez limitu" : `${tokens(item.monthlyTokenLimit)} tokenów / mies.`} ·{" "}
                  {item.allowedProviders.join(", ") || "brak dostawców"}
                </span>
              </div>
              <div className="admin-user-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    setPlan({
                      planId: item.planId,
                      name: item.name,
                      limit: item.monthlyTokenLimit === null ? "" : String(item.monthlyTokenLimit),
                      providers: item.allowedProviders,
                      external: item.externalSubscriptionId ?? ""
                    })
                  }
                >
                  Edytuj
                </button>
                <button type="button" className="danger-button" disabled={busy} onClick={() => void run(() => deleteServerPlan(item.planId), "Plan usunięty.")}>
                  Usuń
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="admin-user-create">
          <label>
            Nazwa planu
            <input value={plan.name} maxLength={80} onChange={(event) => setPlan({ ...plan, name: event.target.value })} />
          </label>
          <label>
            Limit tokenów miesięcznie (puste: bez limitu)
            <input value={plan.limit} inputMode="numeric" onChange={(event) => setPlan({ ...plan, limit: event.target.value })} />
          </label>
          <fieldset className="chat-settings-channel">
            <legend>Dozwoleni dostawcy</legend>
            {PROVIDERS.map(([id, label]) => (
              <label key={id} className="chat-settings-channel-option">
                <input
                  type="checkbox"
                  checked={plan.providers.includes(id)}
                  onChange={(event) =>
                    setPlan({ ...plan, providers: event.target.checked ? [...plan.providers, id] : plan.providers.filter((item) => item !== id) })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <label>
            Identyfikator subskrypcji zewnętrznej (opcjonalnie, bez płatności)
            <input value={plan.external} maxLength={200} onChange={(event) => setPlan({ ...plan, external: event.target.value })} />
          </label>
          <button
            type="button"
            disabled={busy || !plan.name.trim()}
            onClick={() =>
              void run(async () => {
                await saveServerPlan(plan.planId, {
                  name: plan.name.trim(),
                  monthlyTokenLimit: plan.limit.trim() ? Number(plan.limit.trim()) : null,
                  allowedProviders: plan.providers,
                  externalSubscriptionId: plan.external.trim() || null
                });
                setPlan(EMPTY_PLAN);
              }, plan.planId ? "Plan zapisany." : "Plan dodany.")
            }
          >
            {plan.planId ? "Zapisz plan" : "Dodaj plan"}
          </button>
          {plan.planId && (
            <button type="button" disabled={busy} onClick={() => setPlan(EMPTY_PLAN)}>
              Anuluj edycję
            </button>
          )}
        </div>
      </div>

      <div>
        <h3>Konta</h3>
        <div className="admin-users-list">
          {accounts.map((account) => (
            <article key={account.userId} className="admin-user-row">
              <div>
                <strong>{account.loginName}</strong>
                <span>
                  {account.appRole} · {account.status === "ACTIVE" ? "aktywne" : "wyłączone"} ·{" "}
                  {account.emailVerified ? "e-mail potwierdzony" : "konto lokalne"} · plan: {account.appRole === "ADMIN" ? "bez ograniczeń planu" : account.planName ?? "brak"} · w tym miesiącu:{" "}
                  {tokens(account.usage.inputTokens + account.usage.outputTokens)}
                  {account.monthlyTokenLimit !== null ? ` / ${tokens(account.monthlyTokenLimit)}` : ""} tokenów
                </span>
              </div>
              <div className="admin-user-actions">
                {account.appRole !== "ADMIN" && (
                <select
                  aria-label={`Plan konta ${account.loginName}`}
                  value={account.planId ?? ""}
                  disabled={busy}
                  onChange={(event) => void run(() => assignServerPlan(account.userId, event.target.value || null), "Plan konta zmieniony.")}
                >
                  <option value="">(plan domyślny)</option>
                  {plans.map((item) => (
                    <option key={item.planId} value={item.planId}>
                      {item.name}
                    </option>
                  ))}
                </select>
                )}
                {account.appRole === "USER" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => setServerAccountStatus(account.userId, account.status === "ACTIVE" ? "DISABLED" : "ACTIVE"),
                        account.status === "ACTIVE" ? "Konto wyłączone." : "Konto włączone."
                      )
                    }
                  >
                    {account.status === "ACTIVE" ? "Wyłącz" : "Włącz"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>

      {settings.serverMode && (
        <div>
          <h3>Tury na żywo</h3>
          <p className="field-help">Tylko metadane: konto, identyfikator sprawy, skill, etap, tokeny i status. Treść spraw nie jest pokazywana.</p>
          {turns.length === 0 ? (
            <p className="field-help">Brak trwających tur.</p>
          ) : (
            <div className="admin-users-list">
              {turns.map((turn) => (
                <article key={turn.turnId} className="admin-user-row">
                  <div>
                    <strong>
                      {turn.loginName} · {turn.status === "RUNNING" ? "trwa" : turn.status === "DONE" ? "zakończona" : "błąd"}
                    </strong>
                    <span>
                      sprawa: {turn.caseId ?? "brak"} · skill: {turn.skill ?? "?"} · etap {turn.step}/{turn.totalSteps}
                      {turn.stage ? ` (${STAGES[turn.stage] ?? turn.stage})` : ""} · tokeny: {tokens(turn.inputTokens)} we / {tokens(turn.outputTokens)} wy · start{" "}
                      {new Date(turn.startedAt).toLocaleTimeString("pl-PL")}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
