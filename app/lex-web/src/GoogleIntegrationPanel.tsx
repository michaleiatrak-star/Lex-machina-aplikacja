import { currentLocale, t } from "./i18n";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  disconnectGoogleWorkspace,
  getGoogleWorkspaceStatus,
  googleWorkspaceConnectResult,
  importFromGoogle,
  listDriveFiles,
  searchGmailThreads,
  startGoogleWorkspaceConnect,
  type DriveItem,
  type GmailThreadSummary,
  type GoogleWorkspaceStatus
} from "./api.js";
import { InfoTip } from "./InfoTip";
import { openExternalUrl } from "./SnVerification.js";

const ERRORS: Record<string, string> = {
  GOOGLE_NOT_CONFIGURED: t("Brak klienta OAuth Google (plik google-oauth-client.json) — integracja jest wyłączona w tej instalacji."),
  GOOGLE_NOT_CONNECTED: t("Konto Google nie jest połączone — połącz je w Ustawieniach → Integracje."),
  GOOGLE_RECONNECT_REQUIRED: t("Google cofnął dostęp (odwołanie albo koniec 7-dniowego okresu aplikacji testowej). Połącz konto ponownie."),
  GOOGLE_CONSENT_DENIED: t("Odmówiono zgody w oknie Google."),
  GOOGLE_SCOPE_DENIED: t("Nie zaznaczono dostępu ani do Gmaila, ani do Dysku."),
  GOOGLE_REFRESH_TOKEN_MISSING: t("Google nie wydał trwałego dostępu. Usuń aplikację w myaccount.google.com/permissions i połącz ponownie."),
  GOOGLE_ACCOUNT_UNREADABLE: t("Zapisanego połączenia nie da się odczytać (zmiana klucza konta). Rozłącz i połącz ponownie."),
  GOOGLE_GMAIL_ACCESS_DENIED: t("Brak dostępu do Gmaila — przy łączeniu nie zaznaczono Gmaila."),
  GOOGLE_DRIVE_ACCESS_DENIED: t("Brak dostępu do Dysku — przy łączeniu nie zaznaczono Dysku."),
  GOOGLE_NETWORK_ERROR: t("Brak połączenia z Google."),
  GOOGLE_IMPORT_TOO_MANY: t("Naraz można dodać do 20 wątków i plików."),
  GOOGLE_FLOW_NOT_FOUND: t("Okno łączenia wygasło — spróbuj ponownie.")
};

// Ukryte do czasu dostarczenia klienta OAuth wydawcy w instalatorze (logowanie kontem Google).
export const GOOGLE_INTEGRATION_VISIBLE = false;

export function googleErrorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error);
  return ERRORS[code] ?? code;
}

// Ustawienia -> Integracje: konto Google każdego użytkownika osobno, tylko odczyt.
export function GoogleIntegrationPanel() {
  const [status, setStatus] = useState<GoogleWorkspaceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    void getGoogleWorkspaceStatus().then(setStatus, (error) => setMessage(googleErrorText(error)));
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function connect(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      const flow = await startGoogleWorkspaceConnect();
      await openExternalUrl(flow.authorizationUrl);
      setMessage(t("Dokończ logowanie w przeglądarce i zaznacz dostęp do Gmaila lub Dysku."));
      const until = Date.now() + 10 * 60 * 1000;
      while (!cancelled.current && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const result = await googleWorkspaceConnectResult(flow);
        if (result.status === "DONE" && result.result) {
          setStatus(result.result);
          setMessage("");
          return;
        }
        if (result.status === "FAILED") throw new ApiError(result.error ?? "GOOGLE_FLOW_FAILED", 409);
      }
      if (!cancelled.current) setMessage(t("Nie dokończono logowania w 10 minut — spróbuj ponownie."));
    } catch (error) {
      setMessage(googleErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      setStatus(await disconnectGoogleWorkspace());
    } catch (error) {
      setMessage(googleErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="chat-card">
      <p className="eyebrow">{t("Konto Google")}</p>
      <h2>
        {t("Gmail i Dysk Google")}
        <InfoTip>
          {t("Tylko odczyt. Do akt trafiają wyłącznie wątki i pliki, które sam wskażesz w „Importuj z Google” w plikach sprawy; potem przechodzą zwykły OCR i anonimizację. Aplikacja nie wysyła poczty ani nie zmienia plików. Dostęp jest zaszyfrowany kluczem Twojego konta i działa tylko po zalogowaniu.")}
        </InfoTip>
      </h2>
      {!status ? (
        <p>{message || "Sprawdzam…"}</p>
      ) : !status.configured ? (
        <p>{t("Integracja Google nie jest skonfigurowana w tej instalacji (brak klienta OAuth).")}</p>
      ) : status.connected ? (
        <>
          <p>
            {t("Połączono:")} <strong>{status.email}</strong>
            {" · "}{t("Gmail:")} {status.gmail ? "tak" : "nie"} {t("· Dysk:")} {status.drive ? "tak" : "nie"}
            {status.connectedAt ? t(" · od {value}", { value: new Date(status.connectedAt).toLocaleDateString(currentLocale()) }) : ""}
          </p>
          <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void disconnect()}>
            {t("Rozłącz konto Google")}
          </button>
        </>
      ) : (
        <button type="button" className="chat-primary-action" disabled={busy} onClick={() => void connect()}>
          {busy ? t("Czekam na Google…") : t("Zaloguj kontem Google")}
        </button>
      )}
      {status && message ? <p role="status">{message}</p> : null}
    </article>
  );
}

// Pliki sprawy -> „Importuj z Google”: wątki Gmaila i pliki Dysku do akt.
export function GoogleImportDialog({
  caseId,
  onImported,
  onClose
}: {
  caseId: string;
  onImported: (uploadIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"gmail" | "drive">("gmail");
  const [query, setQuery] = useState("has:attachment");
  const [threads, setThreads] = useState<GmailThreadSummary[]>([]);
  const [folders, setFolders] = useState<Array<{ id?: string; name: string }>>([{ name: t("Mój dysk") }]);
  const [driveQuery, setDriveQuery] = useState("");
  const [items, setItems] = useState<DriveItem[]>([]);
  const [picked, setPicked] = useState<{ gmail: Set<string>; drive: Set<string> }>({ gmail: new Set(), drive: new Set() });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function guarded(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(googleErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  const searchMail = () => guarded(async () => setThreads((await searchGmailThreads(query)).threads));
  const openFolder = (path: Array<{ id?: string; name: string }>) =>
    guarded(async () => {
      setFolders(path);
      const folderId = path.at(-1)?.id;
      setItems((await listDriveFiles(folderId ? { folderId } : {})).items);
    });
  const searchDrive = () =>
    guarded(async () => {
      setItems((await listDriveFiles(driveQuery.trim() ? { q: driveQuery.trim() } : {})).items);
    });

  useEffect(() => {
    if (tab === "gmail" && !threads.length) void searchMail();
    if (tab === "drive" && !items.length) void openFolder(folders);
  }, [tab]);

  const toggle = (kind: "gmail" | "drive", id: string) =>
    setPicked((current) => {
      const next = new Set(current[kind]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, [kind]: next };
    });
  const count = picked.gmail.size + picked.drive.size;

  const submit = () =>
    guarded(async () => {
      const result = await importFromGoogle(caseId, { gmailThreadIds: [...picked.gmail], driveFileIds: [...picked.drive] });
      const ids = (result.files as Array<{ uploadId?: string }>).map((file) => file.uploadId).filter((id): id is string => Boolean(id));
      await onImported(ids);
      onClose();
    });

  return (
    <div className="privacy-preview-overlay" role="dialog" aria-modal="true" aria-label={t("Importuj z Google")}>
      <div className="chat-card google-import-dialog">
        <p className="eyebrow">{t("Importuj z Google")}</p>
        <nav className="chat-settings-nav">
          <button type="button" className={tab === "gmail" ? "active" : ""} onClick={() => setTab("gmail")}>{t("Gmail")}</button>
          <button type="button" className={tab === "drive" ? "active" : ""} onClick={() => setTab("drive")}>{t("Dysk Google")}</button>
        </nav>
        {tab === "gmail" ? (
          <>
            <form className="google-import-search" onSubmit={(event) => { event.preventDefault(); void searchMail(); }}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("np. filename:pdf from:sad.gov.pl after:2026/01/01")} />
              <button type="submit" className="chat-secondary-action" disabled={busy}>{t("Szukaj")}</button>
              <InfoTip>{t("Operatory Gmaila: filename:pdf, from:, to:, subject:, after:, before:, has:attachment. Wątek trafia do akt jako plik tekstowy, a każdy załącznik jako osobny plik.")}</InfoTip>
            </form>
            <ul className="google-import-list">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <label>
                    <input type="checkbox" checked={picked.gmail.has(thread.id)} onChange={() => toggle("gmail", thread.id)} />
                    <strong>{thread.subject}</strong> · {thread.from} · {thread.date}
                    {thread.messages > 1 ? ` · ${thread.messages} wiad.` : ""}
                    <small>{thread.snippet}</small>
                  </label>
                </li>
              ))}
              {!busy && !threads.length ? <li>{t("Brak wątków dla tego wyszukiwania.")}</li> : null}
            </ul>
          </>
        ) : (
          <>
            <form className="google-import-search" onSubmit={(event) => { event.preventDefault(); void searchDrive(); }}>
              <input value={driveQuery} onChange={(event) => setDriveQuery(event.target.value)} placeholder={t("Szukaj po nazwie pliku")} />
              <button type="submit" className="chat-secondary-action" disabled={busy}>{t("Szukaj")}</button>
              <InfoTip>{t("Zaznaczony folder dodaje pliki z trzech poziomów (do 100). Dokumenty i arkusze Google trafiają jako .docx i .xlsx.")}</InfoTip>
            </form>
            <p>
              {folders.map((folder, index) => (
                <span key={`${folder.id ?? "root"}-${index}`}>
                  {index ? " / " : ""}
                  <button type="button" className="chat-link-button" disabled={busy} onClick={() => void openFolder(folders.slice(0, index + 1))}>{folder.name}</button>
                </span>
              ))}
            </p>
            <ul className="google-import-list">
              {items.map((item) => (
                <li key={item.id}>
                  <label>
                    <input type="checkbox" checked={picked.drive.has(item.id)} onChange={() => toggle("drive", item.id)} />
                    {item.folder ? (
                      <button type="button" className="chat-link-button" disabled={busy} onClick={() => void openFolder([...folders, { id: item.id, name: item.name }])}>
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
          </>
        )}
        {message ? <p role="alert">{message}</p> : null}
        <div className="google-import-actions">
          <button type="button" className="chat-secondary-action" disabled={busy} onClick={onClose}>{t("Anuluj")}</button>
          <button type="button" className="chat-primary-action" disabled={busy || !count} onClick={() => void submit()}>
            {busy ? "Pracuję…" : t("Dodaj do akt ({count})", { count: count })}
          </button>
        </div>
      </div>
    </div>
  );
}
