import { describe, expect, it } from "vitest";
import { WorkerStartBackoff } from "../src/privacy/json-line-worker.js";

describe("stały proces Pythona po nieudanym starcie", () => {
  it("wraca do stałego procesu po przerwie, zamiast na zawsze uruchamiać Pythona dla każdej strony", () => {
    const backoff = new WorkerStartBackoff(60_000, 3);
    expect(backoff.usable(0)).toBe(true);
    backoff.failed(0);
    expect(backoff.usable(30_000)).toBe(false);
    expect(backoff.usable(60_000)).toBe(true);
    backoff.started();
    backoff.failed(100_000);
    backoff.failed(200_000);
    backoff.failed(300_000);
    expect(backoff.usable(10_000_000)).toBe(false);
  });
});
