import { useCallback, useEffect, useState } from "react";
import {
  cancelQualityBenchmark,
  getModels,
  getQualityBenchmark,
  getQualityBenchmarkReport,
  startQualityBenchmark,
  type AuthenticatedUser,
  type ModelDescriptor,
  type ProviderId,
  type QualityBenchmarkJob,
  type QualityBenchmarkReportSummary
} from "./api.js";
import { downloadBlob } from "./download-file.js";

const PROVIDERS: Array<[ProviderId, string]> = [
  ["openai", "OpenAI / ChatGPT"],
  ["anthropic", "Anthropic / Claude"],
  ["google", "Google / Gemini"],
  ["xai", "xAI / Grok"]
];

// Szybki zestaw: po jednej sprawie z wątkiem i bez, z różnych dziedzin.
const QUICK_CASES = ["kc-delikt-szkoda", "kk-falszywe-zeznania", "kp-wypowiedzenie", "rodo-wyciek", "kpa-bezczynnosc"];

const METRICS: Array<[keyof QualityBenchmarkReportSummary["summary"], string]> = [
  ["score", "wynik"],
  ["blockedRate", "blokady"],
  ["verificationRate", "przepisy zweryfikowane"],
  ["topicCoverage", "kompletność"],
  ["actCoverage", "akty"],
  ["continuity", "ciągłość wątku"]
];

const percent = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`);

/**
 * Ustawienia → Konserwacja: the session quality benchmark on this installed
 * application, with the models connected here (accounts included).
 */
export function QualityBenchmarkSection({ user }: { user: AuthenticatedUser }) {
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [model, setModel] = useState("");
  const [quick, setQuick] = useState(true);
  const [summaryTest, setSummaryTest] = useState(false);
  const [job, setJob] = useState<QualityBenchmarkJob | null>(null);
  const [failed, setFailed] = useState<QualityBenchmarkJob | null>(null);
  const [reports, setReports] = useState<QualityBenchmarkReportSummary[]>([]);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const state = await getQualityBenchmark();
    setJob(state.job);
    setFailed(state.failed);
    setReports(state.reports);
  }, []);

  useEffect(() => {
    if (user.appRole === "ADMIN") void refresh().catch((error: unknown) => setMessage(String(error)));
  }, [refresh, user.appRole]);

  useEffect(() => {
    if (!job) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [job, refresh]);

  useEffect(() => {
    let active = true;
    getModels(provider)
      .then((response) => {
        if (!active) return;
        const usable = response.models.filter((item) => item.selectable && !item.id.startsWith("local/"));
        setModels(usable);
        setModel((current) => (usable.some((item) => item.id === current) ? current : usable[0]?.id ?? ""));
      })
      .catch(() => active && setModels([]));
    return () => {
      active = false;
    };
  }, [provider]);

  if (user.appRole !== "ADMIN") return null;

  const start = async () => {
    setMessage("");
    try {
      const started = await startQualityBenchmark({
        provider,
        model,
        ...(quick ? { cases: QUICK_CASES } : {}),
        // Small budget: older messages are summarized, so the summary is measured too.
        ...(summaryTest ? { historyChars: 4_000 } : {})
      });
      setJob(started.job);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const download = async (reportId: string, format: "md" | "json") => {
    const { report, markdown } = await getQualityBenchmarkReport(reportId);
    downloadBlob(
      format === "md"
        ? new Blob([markdown], { type: "text/markdown;charset=utf-8" })
        : new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      `miernik-${report.model.replace(/[^\w.-]+/g, "_")}-${reportId}.${format}`
    );
  };

  return (
    <section className="anomaly-journal quality-benchmark">
      <h3>Miernik jakości odpowiedzi</h3>
      <p className="field-help">
        Zanonimizowane pytania z różnych dziedzin (część jako rozmowy kilku wiadomości) wysyłane do wybranego modelu tak jak z czatu sprawy, z weryfikacją w Sejm ELI. Mierzy blokady, odsetek przepisów zweryfikowanych, kompletność, ciągłość w wątku, czas i tokeny (przy koncie tokenów nie widać). Każda wiadomość liczy się do limitu konta lub kosztu klucza API; sprawy testowe są po pomiarze archiwizowane.
      </p>
      <div className="chat-form-row">
        <label>
          Dostawca
          <select value={provider} disabled={Boolean(job)} onChange={(event) => setProvider(event.target.value as ProviderId)}>
            {PROVIDERS.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Model
          <select value={model} disabled={Boolean(job) || models.length === 0} onChange={(event) => setModel(event.target.value)}>
            {models.length === 0 ? <option value="">brak połączonego modelu</option> : null}
            {models.map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="chat-check-row">
        <label>
          <input type="checkbox" checked={quick} disabled={Boolean(job)} onChange={(event) => setQuick(event.target.checked)} />
          Szybki zestaw (5 spraw, 10 wiadomości) zamiast pełnego (18 spraw)
        </label>
        <label>
          <input type="checkbox" checked={summaryTest} disabled={Boolean(job)} onChange={(event) => setSummaryTest(event.target.checked)} />
          Sprawdź też streszczenie rozmowy (mały budżet historii)
        </label>
      </div>
      {job ? (
        <div className="chat-form-row">
          <span>
            Trwa pomiar {job.model}: {job.done}/{job.total}
            {job.current ? `, ostatnio ${job.current}` : ""}
            {job.cancelling ? " — przerywanie po bieżącej wiadomości" : ""}
          </span>
          <button type="button" className="chat-secondary-action" disabled={job.cancelling} onClick={() => void cancelQualityBenchmark().then(refresh)}>
            Przerwij
          </button>
        </div>
      ) : (
        <button type="button" className="chat-primary-action" disabled={!model} onClick={() => void start()}>
          Uruchom pomiar
        </button>
      )}
      {failed ? <p className="chat-inline-error">Pomiar {failed.model} przerwany błędem: {failed.error}</p> : null}
      {message ? <p className="chat-inline-error">{message}</p> : null}

      {reports.length ? (
        <div className="chat-md-table-wrap">
          <table className="chat-md-table">
            <thead>
              <tr>
                <th>Pomiar</th>
                <th>Model</th>
                <th>Tury</th>
                {METRICS.map(([, label]) => (
                  <th key={label}>{label}</th>
                ))}
                <th>Śr. czas</th>
                <th>Zmiana wyniku</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const change = report.comparison?.items.find((item) => item.metric === "score");
                const regressions = report.comparison?.items.filter((item) => item.regression).map((item) => item.metric) ?? [];
                return (
                  <tr key={report.reportId}>
                    <td>
                      {new Date(report.finishedAt).toLocaleString("pl-PL")}
                      {report.cancelled ? " (przerwany)" : ""}
                    </td>
                    <td>{report.model}</td>
                    <td>{report.summary.turns}</td>
                    {METRICS.map(([key]) => (
                      <td key={key}>{percent(report.summary[key])}</td>
                    ))}
                    <td>{Math.round(report.summary.meanTimeMs / 1000)} s</td>
                    <td>
                      {change?.delta === null || change?.delta === undefined
                        ? "—"
                        : `${change.delta > 0 ? "+" : ""}${Math.round(change.delta * 100)} pp`}
                      {regressions.length ? ` · regresja: ${regressions.join(", ")}` : ""}
                    </td>
                    <td>
                      <button type="button" className="chat-secondary-action" onClick={() => void download(report.reportId, "md")}>
                        Raport
                      </button>{" "}
                      <button type="button" className="chat-secondary-action" onClick={() => void download(report.reportId, "json")}>
                        JSON
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
