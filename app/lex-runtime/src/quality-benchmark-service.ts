import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  compareSummaries,
  reportMarkdown,
  runSessionQuality,
  validateSessionQualityCorpus,
  type SessionQualityComparison,
  type SessionQualitySummary,
  type SessionTurnScore
} from "./session-quality-benchmark.js";
import { SESSION_QUALITY_CORPUS_V1 } from "./session-quality-corpus.js";

/**
 * The session quality benchmark run inside the installed application: the
 * runtime calls its own API with the administrator's session, so the models
 * connected in the app (accounts included) answer exactly as in the chat.
 * One run at a time; reports are kept under the data directory.
 */
export const CLIENT_HISTORY_CHARS: Record<string, number> = {
  anthropic: 300_000,
  google: 300_000,
  openai: 150_000,
  xai: 150_000
};

export type QualityBenchmarkReport = {
  reportId: string;
  createdAt: string;
  finishedAt: string;
  provider: string;
  model: string;
  historyChars: number;
  cases: string[];
  cancelled: boolean;
  summary: SessionQualitySummary;
  comparison?: { baselineReportId: string; items: SessionQualityComparison[] };
  scores: SessionTurnScore[];
  answers: Array<{ caseId: string; turn: number; status: string; answer: string }>;
};

export type QualityBenchmarkJob = {
  reportId: string;
  provider: string;
  model: string;
  startedAt: string;
  done: number;
  total: number;
  current: string | null;
  cancelling: boolean;
  error?: string;
};

export class QualityBenchmarkError extends Error {
  constructor(readonly code: string, readonly httpStatus: number) {
    super(code);
  }
}

const REPORT_ID = /^qb_[0-9]{17}_[0-9a-f]{8}$/;

export class QualityBenchmarkService {
  private job: (QualityBenchmarkJob & { cancel: boolean }) | null = null;
  // The failure stays visible until the next start.
  private lastFailure: QualityBenchmarkJob | null = null;
  private readonly directory: string;

  constructor(
    private readonly options: {
      rootDir: string;
      // The runtime's own address, known once it listens.
      baseUrl: () => string;
      desktopBootstrapToken?: string;
      fetcher?: typeof fetch;
    }
  ) {
    this.directory = path.join(options.rootDir, "benchmarks", "session-quality");
  }

  status(): {
    job: QualityBenchmarkJob | null;
    failed: QualityBenchmarkJob | null;
    reports: Array<Omit<QualityBenchmarkReport, "scores" | "answers">>;
  } {
    return {
      job: this.job ? this.publicJob() : null,
      failed: this.lastFailure,
      reports: this.reports().map(({ scores: _scores, answers: _answers, ...rest }) => rest)
    };
  }

  report(reportId: string): { report: QualityBenchmarkReport; markdown: string } {
    if (!REPORT_ID.test(reportId)) throw new QualityBenchmarkError("QUALITY_BENCHMARK_REPORT_INVALID", 400);
    const file = path.join(this.directory, `${reportId}.json`);
    if (!fs.existsSync(file)) throw new QualityBenchmarkError("QUALITY_BENCHMARK_REPORT_NOT_FOUND", 404);
    const report = JSON.parse(fs.readFileSync(file, "utf8")) as QualityBenchmarkReport;
    return {
      report,
      markdown: reportMarkdown({
        provider: report.provider,
        model: report.model,
        corpus: SESSION_QUALITY_CORPUS_V1,
        scores: report.scores,
        summary: report.summary,
        ...(report.comparison ? { comparison: report.comparison.items } : {})
      })
    };
  }

  cancel(): QualityBenchmarkJob | null {
    if (this.job) this.job.cancel = this.job.cancelling = true;
    return this.job ? this.publicJob() : null;
  }

  start(input: {
    authorization: string;
    provider: string;
    model: string;
    cases?: string[];
    historyChars?: number;
  }): QualityBenchmarkJob {
    if (this.job) throw new QualityBenchmarkError("QUALITY_BENCHMARK_ALREADY_RUNNING", 409);
    const corpus = validateSessionQualityCorpus(SESSION_QUALITY_CORPUS_V1);
    const known = new Set(corpus.cases.map((item) => item.id));
    if (input.cases?.some((id) => !known.has(id))) throw new QualityBenchmarkError("QUALITY_BENCHMARK_CASE_UNKNOWN", 400);
    const cases = input.cases?.length ? input.cases : corpus.cases.map((item) => item.id);
    const historyChars = input.historyChars ?? CLIENT_HISTORY_CHARS[input.provider] ?? 28_000;
    this.lastFailure = null;
    const now = new Date();
    const reportId = `qb_${now.toISOString().replace(/\D/g, "").slice(0, 17)}_${randomBytes(4).toString("hex")}`;
    const total = corpus.cases.filter((item) => cases.includes(item.id)).reduce((sum, item) => sum + item.turns.length, 0);
    this.job = {
      reportId,
      provider: input.provider,
      model: input.model,
      startedAt: now.toISOString(),
      done: 0,
      total,
      current: null,
      cancelling: false,
      cancel: false
    };
    const fetcher = this.options.fetcher ?? globalThis.fetch.bind(globalThis);
    const call = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
      const response = await fetcher(new URL(route, this.options.baseUrl()), {
        method,
        headers: {
          "content-type": "application/json",
          authorization: input.authorization,
          ...(this.options.desktopBootstrapToken ? { "x-lex-desktop-bootstrap": this.options.desktopBootstrapToken } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP_${response.status}:${text.slice(0, 300)}`);
      return (text ? JSON.parse(text) : {}) as T;
    };
    const job = this.job;
    void runSessionQuality({
      call,
      corpus,
      provider: input.provider,
      model: input.model,
      historyChars,
      cases,
      messageId: () => `message_${randomBytes(16).toString("hex")}`,
      cancelled: () => job.cancel,
      onTurn: ({ caseId, turn, done }) => {
        job.done = done;
        job.current = `${caseId} #${turn}`;
      }
    })
      .then((run) => {
        const baseline = this.reports().find((report) => report.provider === input.provider && report.model === input.model && !report.cancelled);
        const report: QualityBenchmarkReport = {
          reportId,
          createdAt: job.startedAt,
          finishedAt: new Date().toISOString(),
          provider: input.provider,
          model: input.model,
          historyChars,
          cases,
          cancelled: run.cancelled,
          summary: run.summary,
          ...(baseline ? { comparison: { baselineReportId: baseline.reportId, items: compareSummaries(baseline.summary, run.summary) } } : {}),
          scores: run.scores,
          answers: run.answers
        };
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(this.directory, `${reportId}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
        this.job = null;
      })
      .catch((error: unknown) => {
        job.error = error instanceof Error ? error.message : String(error);
        process.stderr.write(`QUALITY_BENCHMARK_FAILED:${job.error}\n`);
        this.job = null;
        this.lastFailure = this.publicJobOf(job);
      });
    return this.publicJob();
  }

  private publicJobOf(job: QualityBenchmarkJob & { cancel?: boolean }): QualityBenchmarkJob {
    const { cancel: _cancel, ...rest } = job;
    return rest;
  }

  private publicJob(): QualityBenchmarkJob {
    return this.publicJobOf(this.job!);
  }

  // Newest first.
  private reports(): QualityBenchmarkReport[] {
    if (!fs.existsSync(this.directory)) return [];
    return fs
      .readdirSync(this.directory)
      .filter((name) => REPORT_ID.test(name.replace(/\.json$/, "")))
      .sort()
      .reverse()
      .slice(0, 50)
      .flatMap((name) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(this.directory, name), "utf8")) as QualityBenchmarkReport];
        } catch {
          return [];
        }
      });
  }
}
