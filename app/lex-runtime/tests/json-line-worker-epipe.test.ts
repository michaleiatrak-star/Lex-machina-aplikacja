import { describe, expect, it } from "vitest";
import { JsonLineWorker } from "../src/privacy/json-line-worker.js";

// RD 121/26, live: a privacy worker that died while the runtime wrote to it (EPIPE) stopped the
// whole server mid-turn. The failure is the request's: it rejects, the process goes on.
describe("a worker that closes its input", () => {
  it("rejects the request instead of an unhandled EPIPE", async () => {
    const script = "process.stdout.write(JSON.stringify({ ready: true }) + '\\n'); process.stdin.destroy(); setTimeout(() => process.exit(0), 300);";
    const worker = new JsonLineWorker<unknown>("Test", process.execPath, ["-e", script], 5_000, 5_000);
    await expect(worker.ask("x".repeat(4_000_000))).rejects.toThrow();
    worker.close();
  });
});
