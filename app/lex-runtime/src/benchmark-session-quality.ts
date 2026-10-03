/**
 * Session quality benchmark against a running Lex Machina runtime (HTTP API,
 * live Sejm ELI). Each case gets its own matter; turns go through the same
 * request as the chat client (conversation history, thread in the matter).
 *
 * npm run benchmark:session -- --base-url http://127.0.0.1:4317 \
 *   --provider anthropic --model claude-... --out reports/session-quality \
 *   [--corpus own-corpus.json] [--baseline old/report.json]
 *   [--history-chars 4000] [--cases kc-delikt-szkoda,kp-wypowiedzenie]
 *
 * Login: LEX_BENCH_LOGIN / LEX_BENCH_PASSWORD; on an empty runtime
 * --bootstrap creates that administrator first; on a fresh desktop runtime
 * (admin/admin pending a password) --initial-admin sets LEX_BENCH_PASSWORD. --api-key-env NAME sets the
 * provider key from that environment variable (kept in runtime memory only).
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  compareSummaries,
  reportMarkdown,
  runSessionQuality,
  validateSessionQualityCorpus,
  type SessionQualitySummary
} from "./session-quality-benchmark.js";
import { SESSION_QUALITY_CORPUS_V1 } from "./session-quality-corpus.js";

// Chat client budgets (lex-web conversation-context.ts).
const CLIENT_HISTORY_CHARS: Record<string, number> = { anthropic: 300_000, google: 300_000, openai: 150_000, xai: 150_000 };

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`MISSING_ARGUMENT:--${name}`);
  return value;
}

async function call<T>(baseUrl: string, token: string | null, method: string, route: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP_${response.status}:${route}:${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const messageId = (): string => `message_${randomBytes(16).toString("hex")}`;

async function main(): Promise<void> {
  const baseUrl = required("base-url");
  const provider = required("provider");
  const model = required("model");
  const outDir = path.resolve(argument("out") ?? "session-quality-report");
  const corpusPath = argument("corpus");
  const historyChars = Number(argument("history-chars") ?? CLIENT_HISTORY_CHARS[provider] ?? 28_000);
  const only = argument("cases")?.split(",").filter(Boolean);
  const login = process.env.LEX_BENCH_LOGIN ?? "benchmark";
  const password = process.env.LEX_BENCH_PASSWORD;
  if (!password) throw new Error("MISSING_ENV:LEX_BENCH_PASSWORD");

  const corpus = validateSessionQualityCorpus(
    corpusPath ? JSON.parse(await readFile(path.resolve(corpusPath), "utf8")) : SESSION_QUALITY_CORPUS_V1
  );
  // --initial-admin: a fresh desktop runtime starts with admin/admin pending a
  // new password; the benchmark sets LEX_BENCH_PASSWORD and logs in again.
  if (process.argv.includes("--initial-admin")) {
    const first = await call<{ sessionToken: string }>(baseUrl, null, "POST", "/api/auth/login", { loginName: "admin", password: "admin" });
    await call(baseUrl, first.sessionToken, "POST", "/api/auth/password", { currentPassword: "admin", newPassword: password });
  }
  const account = process.argv.includes("--initial-admin") ? "admin" : login;
  const session = process.argv.includes("--bootstrap")
    ? await call<{ sessionToken: string }>(baseUrl, null, "POST", "/api/auth/bootstrap", {
        loginName: login,
        displayName: "Miernik jakości",
        password
      })
    : await call<{ sessionToken: string }>(baseUrl, null, "POST", "/api/auth/login", { loginName: account, password });
  const token = session.sessionToken;
  const keyEnv = argument("api-key-env");
  if (keyEnv) {
    const apiKey = process.env[keyEnv];
    if (!apiKey) throw new Error(`MISSING_ENV:${keyEnv}`);
    await call(baseUrl, token, "PUT", `/api/admin/providers/${provider}/credential`, { apiKey });
  }

  const run = await runSessionQuality({
    call: (method, route, body) => call(baseUrl, token, method, route, body),
    corpus,
    provider,
    model,
    historyChars,
    ...(only ? { cases: only } : {}),
    messageId,
    onTurn: ({ caseId, turn, score }) =>
      process.stdout.write(`${caseId}#${turn}: ${score.error ? "ERROR" : score.blocked ? "BLOCKED" : "OK"} wynik=${score.score.toFixed(2)} czas=${Math.round(score.timeMs / 1000)}s\n`)
  });
  const { scores, answers } = run;
  const summary = run.summary;
  const baselinePath = argument("baseline");
  const baseline = baselinePath
    ? (JSON.parse(await readFile(path.resolve(baselinePath), "utf8")) as { summary: SessionQualitySummary }).summary
    : null;
  const comparison = baseline ? compareSummaries(baseline, summary) : undefined;
  await mkdir(outDir, { recursive: true });
  const report = {
    kind: "LEX_MACHINA_SESSION_QUALITY_REPORT",
    createdAt: new Date().toISOString(),
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    provider,
    model,
    historyChars,
    summary,
    ...(comparison ? { comparison } : {}),
    scores
  };
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  // Answers stay out of report.json: they may carry case text; this file is for review.
  await writeFile(path.join(outDir, "answers.json"), JSON.stringify(answers, null, 2));
  const markdown = reportMarkdown({ provider, model, corpus, scores, summary, ...(comparison ? { comparison } : {}) });
  await writeFile(path.join(outDir, "report.md"), markdown);
  process.stdout.write(`\n${markdown}\n`);
  if (comparison?.some((item) => item.regression) && process.argv.includes("--fail-on-regression")) {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`SESSION_QUALITY_BENCHMARK_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
