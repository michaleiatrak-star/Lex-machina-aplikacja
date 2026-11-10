import { currentLocale, t, N_ } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  disconnectMicrosoft,
  getMicrosoftStatus,
  importFromMicrosoft,
  listMicrosoftFiles,
  microsoftConnectResult,
  startMicrosoftConnect,
  type MicrosoftItem,
  type MicrosoftStatus
} from "./api.js";
import { InfoTip } from "./InfoTip";
import { openExternalUrl } from "./SnVerification.js";

const ERRORS: Record<string, string> = {
  MICROSOFT_NOT_CONFIGURED: N_("Brak aplikacji Microsoft (identyfikator klienta Entra ID) — integracja jest wyłączona w tej instalacji."),
  MICROSOFT_NOT_CONNECTED: N_("Konto Microsoft nie jest połączone — połącz je w Ustawieniach → Integracje."),
  MICROSOFT_RECONNECT_REQUIRED: N_("Microsoft cofnął dostęp (zmiana hasła, odwołanie zgody albo wygaśnięcie). Połącz konto ponownie."),
  MICROSOFT_CONSENT_DENIED: N_("Odmówiono zgody w oknie Microsoft (albo administrator organizacji jej nie udzielił)."),
  MICROSOFT_SCOPE_DENIED: N_("Nie udzielono dostępu do plików."),
  MICROSOFT_ACCESS_DENIED: N_("Brak dostępu do tego miejsca w OneDrive lub SharePoint."),
  MICROSOFT_ACCOUNT_UNREADABLE: N_("Zapisanego połączenia nie da się odczytać (zmiana klucza konta). Rozłącz i połącz ponownie."),
  MICROSOFT_NETWORK_ERROR: N_("Brak połączenia z Microsoft."),
  MICROSOFT_IMPORT_TOO_MANY: N_("Naraz można dodać do 20 plików lub folderów."),
  MICROSOFT_FLOW_NOT_FOUND: N_("Okno łączenia wygasło — spróbuj ponownie.")
};

export function microsoftErrorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error);
  return ERRORS[code] ? t(ERRORS[code]) : code;
}

/** Ustawienia -> Integracje: konto Microsoft 365 każdego użytkownika, tylko odczyt (shown when configured). */
export function MicrosoftIntegrationPanel() {
  const [status, setStatus] = useState<MicrosoftStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    void getMicrosoftStatus().then(setStatus, () => setStatus(null));
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function connect(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const flow = await startMicrosoftConnect();
      await openExternalUrl(flow.authorizationUrl);
      setMessage(t("Dokończ logowanie w przeglądarce."));
      const until = Date.now() + 10 * 60 * 1000;
      while (!cancelled.current && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const result = await microsoftConnectResult(flow);
        if (result.status === "DONE" && result.result) {
          setStatus(result.result);
          setMessage("");
          return;
        }
        if (result.status === "FAILED") throw new ApiError(result.error ?? "MICROSOFT_FLOW_FAILED", 409);
      }
      if (!cancelled.current) setMessage(t("Nie dokończono logowania w 10 minut — spróbuj ponownie."));
    } catch (error) {
      setMessage(microsoftErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      setStatus(await disconnectMicrosoft());
    } catch (error) {
      setMessage(microsoftErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  if (!status?.configured) return null;
  return (
    <article className="chat-card">
      <p className="eyebrow">{t("Konto Microsoft 365")}</p>
      <h2>
        {t("OneDrive i SharePoint")}
        <InfoTip>
          {t("Tylko odczyt. Do akt trafiają wyłącznie pliki i foldery, które sam wskażesz w „Importuj z OneDrive/SharePoint” w plikach sprawy; potem przechodzą zwykły OCR i anonimizację. Aplikacja nie zmienia plików. Dostęp jest zaszyfrowany kluczem Twojego konta i działa tylko po zalogowaniu. Dostęp aplikacji usuniesz też w myapps.microsoft.com.")}
        </InfoTip>
      </h2>
      {status.connected ? (
        <>
          <p>
            {t("Połączono:")} <strong>{status.email}</strong> {t("· SharePoint:")} {status.sharepoint ? "tak" : "nie"}
            {status.connectedAt ? ` · od ${new Date(status.connectedAt).toLocaleDateString(currentLocale())}` : ""}
          </p>
          <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void disconnect()}>
            {t("Rozłącz konto Microsoft")}
          </button>
        </>
      ) : (
        <button type="button" className="chat-primary-action" disabled={busy} onClick={() => void connect()}>
          {busy ? t("Czekam na Microsoft…") : "Zaloguj kontem Microsoft"}
        </button>
      )}
      {message ? <p role="status">{message}</p> : null}
    </article>
  );
}

/** Pliki sprawy: przycisk tylko przy połączonym koncie Microsoft. */
export function useMicrosoftConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    getMicrosoftStatus().then(
      (status) => alive && setConnected(status.configured && status.connected),
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, []);
  return connected;
}

type Crumb = { place?: string; name: string };

const ROOTS: Array<{ key: string; label: string; crumb: Crumb }> = [
  { key: "onedrive", label: N_("Mój OneDrive"), crumb: { place: "onedrive", name: "Mój OneDrive" } },
  { key: "shared", label: N_("Udostępnione dla mnie"), crumb: { place: "shared", name: "Udostępnione" } },
  { key: "sites", label: "SharePoint", crumb: { place: "sites", name: "SharePoint" } }
];

// Pliki sprawy -> „Importuj z OneDrive/SharePoint”: pliki i foldery do akt.
export function MicrosoftImportDialog({
  caseId,
  onImported,
  onClose
}: {
  caseId: string;
  onImported: (uploadIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [path, setPath] = useState<Crumb[]>([ROOTS[0]!.crumb]);
  const [items, setItems] = useState<MicrosoftItem[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function guarded(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(microsoftErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  const open = (target: Crumb[], q = "") =>
    guarded(async () => {
      setPath(target);
      const place = target.at(-1)?.place;
      const result = await listMicrosoftFiles({ ...(place ? { place } : {}), ...(q ? { q } : {}) });
      setItems(result.items);
      setNext(result.next);
    });

  useEffect(() => {
    void open(path);
  }, []);

  const more = () =>
    guarded(async () => {
      if (!next) return;
      const result = await listMicrosoftFiles({ next });
      setItems((current) => [...current, ...result.items]);
      setNext(result.next);
    });

  const toggle = (item: MicrosoftItem) =>
    setPicked((current) => {
      const updated = new Map(current);
      if (updated.has(item.id)) updated.delete(item.id);
      else updated.set(item.id, item.name);
      return updated;
    });

  const submit = () =>
    guarded(async () => {
      const result = await importFromMicrosoft(caseId, [...picked.keys()]);
      const ids = (result.files as Array<{ uploadId?: string }>).map((file) => file.uploadId).filter((id): id is string => Boolean(id));
      await onImported(ids);
      onClose();
    });

  const root = path[0]?.place;
  const searchable = root === "onedrive" || root === "sites";
  return (
    <div className="privacy-preview-overlay" role="dialog" aria-modal="true" aria-label={t("Importuj z OneDrive lub SharePoint")}>
      <div className="chat-card google-import-dialog">
        <p className="eyebrow">{t("Importuj z OneDrive / SharePoint")}</p>
        <nav className="chat-settings-nav">
          {ROOTS.map((entry) => (
            <button key={entry.key} type="button" className={root === entry.crumb.place ? "active" : ""} disabled={busy} onClick={() => void open([entry.crumb])}>
              {t(entry.label)}
            </button>
          ))}
        </nav>
        {searchable && path.length === 1 ? (
          <form
            className="google-import-search"
            onSubmit={(event) => {
              event.preventDefault();
              void open(path, query.trim());
            }}
          >
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={root === "sites" ? "Nazwa witryny SharePoint" : t("Szukaj po nazwie pliku")} />
            <button type="submit" className="chat-secondary-action" disabled={busy}>
              {t("Szukaj")}
            </button>
            <InfoTip>{t("Zaznaczony folder dodaje pliki z trzech poziomów (do 100, każdy do 50 MB). Notesy OneNote są pomijane.")}</InfoTip>
          </form>
        ) : null}
        <p>
          {path.map((crumb, index) => (
            <span key={`${crumb.place ?? ""}-${index}`}>
              {index ? " / " : ""}
              <button type="button" className="chat-link-button" disabled={busy} onClick={() => void open(path.slice(0, index + 1))}>
                {crumb.name}
              </button>
            </span>
          ))}
        </p>
        <ul className="google-import-list">
          {items.map((item) => (
            <li key={item.id}>
              <label>
                {item.kind === "file" || item.kind === "folder" ? (
                  <input type="checkbox" checked={picked.has(item.id)} onChange={() => toggle(item)} />
                ) : null}
                {item.folder ? (
                  <button type="button" className="chat-link-button" disabled={busy} onClick={() => void open([...path, { place: item.id, name: item.name }])}>
                    {item.name}/
                  </button>
                ) : (
                  item.name
                )}
              </label>
            </li>
          ))}
          {!busy && !items.length ? <li>{t("Pusto.")}</li> : null}
        </ul>
        {next ? (
          <button type="button" className="chat-link-button" disabled={busy} onClick={() => void more()}>
            {t("Więcej…")}
          </button>
        ) : null}
        {message ? <p role="alert">{message}</p> : null}
        <div className="google-import-actions">
          <button type="button" className="chat-secondary-action" disabled={busy} onClick={onClose}>
            {t("Anuluj")}
          </button>
          <button type="button" className="chat-primary-action" disabled={busy || !picked.size} onClick={() => void submit()}>
            {busy ? "Pracuję…" : `Dodaj do akt (${picked.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
