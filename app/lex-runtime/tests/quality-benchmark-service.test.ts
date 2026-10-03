import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QualityBenchmarkService } from "../src/quality-benchmark-service.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fakeRuntime(answer: string) {
  const calls: Array<{ method: string; path: string; headers: Record<string, string>; body: unknown }> = [];
  let cases = 0;
  const fetcher = vi.fn(async (url: URL | string, init?: RequestInit) => {
    const target = new URL(String(url));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path: target.pathname, headers: init?.headers as Record<string, string>, body });
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    if (target.pathname === "/api/cases") return json({ caseId: `case_${String(++cases).padStart(32, "0")}` });
    if (target.pathname === "/api/sessions/execute") {
      return json({ status: "DRAFT_PRESENTABLE", answer, usage: { inputTokens: 10, outputTokens: 5, modelCalls: 1, unmeteredCalls: 0 } });
    }
    return json({});
  });
  return { calls, fetcher };
}

async function finished(service: QualityBenchmarkService) {
  for (let attempt = 0; attempt < 100 && service.status().job; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  return service.status();
}

describe("quality benchmark in the installed application", () => {
  it("runs through the runtime's own API with the caller's session and the desktop secret, then archives the matters", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-qb-"));
    roots.push(root);
    const runtime = fakeRuntime("Odpowiedź: przedawnienie, art. 415 k.c. ✅ [VER: https://eli.gov.pl/x, 2026-10-03]");
    const service = new QualityBenchmarkService({
      rootDir: root,
      baseUrl: () => "http://127.0.0.1:4317",
      desktopBootstrapToken: "desktop-secret",
      fetcher: runtime.fetcher as unknown as typeof fetch
    });
    const job = service.start({ authorization: "Bearer session", provider: "openai", model: "account/openai/default", cases: ["kc-delikt-szkoda"] });
    expect(job).toMatchObject({ total: 3, done: 0 });
    expect(() => service.start({ authorization: "Bearer session", provider: "openai", model: "x" })).toThrow("QUALITY_BENCHMARK_ALREADY_RUNNING");

    const state = await finished(service);
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]).toMatchObject({ model: "account/openai/default", cases: ["kc-delikt-szkoda"], summary: { turns: 3, inputTokens: 30 } });
    expect(runtime.calls.every((call) => call.headers.authorization === "Bearer session" && call.headers["x-lex-desktop-bootstrap"] === "desktop-secret")).toBe(true);
    expect(runtime.calls.filter((call) => call.path === "/api/sessions/execute")).toHaveLength(3);
    expect(runtime.calls.at(-1)?.path).toMatch(/^\/api\/cases\/case_\d{32}\/archive$/);
    const { markdown } = service.report(state.reports[0]!.reportId);
    expect(markdown).toContain("kc-delikt-szkoda");

    // A second run of the same model is compared with the first.
    service.start({ authorization: "Bearer session", provider: "openai", model: "account/openai/default", cases: ["kc-delikt-szkoda"] });
    const second = await finished(service);
    expect(second.reports[0]!.comparison?.baselineReportId).toBe(state.reports[0]!.reportId);
    expect(() => service.report("../../etc/passwd")).toThrow("QUALITY_BENCHMARK_REPORT_INVALID");
  });

  it("stops after the current message when cancelled", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-qb-"));
    roots.push(root);
    const runtime = fakeRuntime("x");
    const service = new QualityBenchmarkService({ rootDir: root, baseUrl: () => "http://127.0.0.1:1", fetcher: runtime.fetcher as unknown as typeof fetch });
    service.start({ authorization: "Bearer s", provider: "anthropic", model: "account/anthropic/default" });
    service.cancel();
    const state = await finished(service);
    expect(state.reports[0]!.cancelled).toBe(true);
    expect(state.reports[0]!.summary.turns).toBeLessThan(26);
  });
});
