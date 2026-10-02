import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  clearAnomalies,
  exportAnomalies,
  getAnomalies,
  type AnomalyEntry,
  type AnomalySeverity,
  type AnomalySummaryRow,
  type AuthenticatedUser
} from "./api.js";
import { downloadBlob } from "./download-file.js";

const CODE_TEXT: Record<string, string> = {
  RESOURCE_PATH_CORRECTED: "model podał błędną ścieżkę lub nazwę; podano jedyny pasujący plik",
  LEGAL_RESOURCE_NOT_FOUND: "model próbował wczytać nieistniejący plik skilla",
  LEGAL_SKILL_NOT_FOUND: "model podał nieistniejący skill",
  ROUTER_V3_REQUIRED_FIRST: "odczyt przed routerem v3",
  SESSION_BLOCKED: "odpowiedź zablokowana przez bramki",
  FINALIZATION_DEGRADED: "odpowiedź z niezweryfikowanymi przepisami lub orzeczeniami",
  SESSION_EXECUTION_FAILED: "nieobsłużony błąd wykonania"
};

const AREA_TEXT: Record<string, string> = {
  SKILL_PATH: "ścieżka skilla",
  CORPUS: "korpus skilli",
  GATE: "bramka",
  SESSION: "sesja",
  EXECUTION: "wykonanie"
};

const PERIODS = [
  { label: "24 godziny", hours: 24 },
  { label: "7 dni", hours: 24 * 7 },
  { label: "30 dni", hours: 24 * 30 }
];

function when(value: string): string {
  return new Date(value).toLocaleString("pl-PL");
}

function detailText(entry: AnomalyEntry): string {
  if (!entry.detail) return "";
  return Object.entries(entry.detail)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}

export function AnomalyJournalSection({ user }: { user: AuthenticatedUser }) {
  const [summary, setSummary] = useState<AnomalySummaryRow[]>([]);
  const [entries, setEntries] = useState<AnomalyEntry[]>([]);
  const [hours, setHours] = useState(24 * 7);
  const [severity, setSeverity] = useState<AnomalySeverity | "">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Błąd odczytu dziennika nie może wyglądać jak pusty dziennik ("0 błędów").
  const [loadError, setLoadError] = useState("");
  const admin = user.appRole === "ADMIN";

  const load = useCallback(async () => {
    if (!admin) return;
    setBusy(true);
    try {
      const since = new Date(Date.now() - hours * 3_600_000).toISOString();
      const result = await getAnomalies({ since, limit: 100, ...(severity ? { severity } : {}) });
      setSummary(result.summary);
      setEntries(result.entries);
      setLoadError("");
      setMessage("");
    } catch (failure) {
      setSummary([]);
      setEntries([]);
      setLoadError(failure instanceof ApiError ? failure.code : String(failure));
    } finally {
      setBusy(false);
    }
  }, [admin, hours, severity]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!admin) return null;

  const errors = summary.filter((row) => row.severity === "ERROR").reduce((sum, row) => sum + row.count, 0);
  const warnings = summary.filter((row) => row.severity === "WARN").reduce((sum, row) => sum + row.count, 0);

  async function onExport() {
    try {
      const saved = await downloadBlob(await exportAnomalies(), "lex-nieprawidlowosci.jsonl");
      setMessage(saved ? `Zapisano: ${saved}` : "");
    } catch (failure) {
      setMessage(failure instanceof ApiError ? failure.code : String(failure));
    }
  }

  async function onClear() {
    if (!window.confirm("Wyczyścić cały dziennik nieprawidłowości?")) return;
    try {
      await clearAnomalies();
      await load();
    } catch (failure) {
      setMessage(failure instanceof ApiError ? failure.code : String(failure));
    }
  }

  return (
    <section className="anomaly-journal">
      <div className="maintenance-heading">
        <div>
          <strong>Dziennik nieprawidłowości</strong>
          <small>
            błędne ścieżki skilli, blokady i błędy sesji · bez treści spraw
          </small>
        </div>
        <span className={errors || loadError ? "anomaly-count anomaly-count-error" : "anomaly-count"}>
          {loadError ? "dziennik niedostępny" : `${errors} błędów · ${warnings} ostrzeżeń`}
        </span>
      </div>

      <div className="anomaly-filters">
        <select value={hours} onChange={(event) => setHours(Number(event.target.value))} aria-label="Okres">
          {PERIODS.map((period) => (
            <option key={period.hours} value={period.hours}>{period.label}</option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value as AnomalySeverity | "")}
          aria-label="Waga"
        >
          <option value="">wszystkie</option>
          <option value="ERROR">błędy</option>
          <option value="WARN">ostrzeżenia</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void load()}>Odśwież</button>
        <button type="button" disabled={busy || !summary.length} onClick={() => void onExport()}>Eksportuj</button>
        <button type="button" disabled={busy || !summary.length} onClick={() => void onClear()}>Wyczyść</button>
      </div>

      {loadError ? (
        <p className="maintenance-error">Nie udało się wczytać dziennika: {loadError}</p>
      ) : summary.length ? (
        <>
          <small>Powtarzające się (ten sam kod i plik):</small>
          <table className="anomaly-table">
            <thead>
              <tr><th>Waga</th><th>Kod</th><th>Plik / cel</th><th>Ile</th><th>Ostatnio</th><th>Model</th></tr>
            </thead>
            <tbody>
              {summary.slice(0, 30).map((row) => (
                <tr key={`${row.severity}|${row.code}|${row.target ?? ""}`} className={row.severity === "ERROR" ? "anomaly-error" : ""}>
                  <td>{row.severity === "ERROR" ? "błąd" : "ostrzeżenie"}</td>
                  <td title={CODE_TEXT[row.code] ?? AREA_TEXT[row.area]}>
                    {row.code}
                    {CODE_TEXT[row.code] ? <small>{CODE_TEXT[row.code]}</small> : null}
                  </td>
                  <td className="anomaly-target">{row.target ?? "—"}</td>
                  <td>{row.count}</td>
                  <td>{when(row.lastAt)}</td>
                  <td>{row.providers.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <details>
            <summary>Ostatnie wpisy ({entries.length})</summary>
            <ul className="anomaly-entries">
              {entries.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className={entry.severity === "ERROR" ? "anomaly-error" : ""}>
                  <strong>{when(entry.at)}</strong> {entry.code} · {AREA_TEXT[entry.area] ?? entry.area}
                  {entry.target ? ` · ${entry.target}` : ""}
                  {entry.provider ? ` · ${entry.provider}/${entry.model ?? ""}` : ""}
                  {entry.detail ? <small>{detailText(entry)}</small> : null}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <small>Brak nieprawidłowości w wybranym okresie.</small>
      )}

      {message ? <p className="maintenance-error">{message}</p> : null}
    </section>
  );
}
