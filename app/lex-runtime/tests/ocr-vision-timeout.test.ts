import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalVisionLineReader } from "../src/ocr-vision.js";

// A llama.cpp server that says it is ready and never answers a line (first start on some cards).
describe.skipIf(process.platform === "win32")("model wizyjny: limit czasu odczytu linii", () => {
  it("serwer bez odpowiedzi: błąd VISION_MODEL_TIMEOUT po limicie, serwer zatrzymany", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-vision-hang-"));
    const server = path.join(dir, "llama-server");
    fs.writeFileSync(
      server,
      `#!${process.execPath}
const http = require("node:http");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
http.createServer((req, res) => {
  if (req.url === "/health") { res.end("ok"); return; }
  // /v1/chat/completions: never answered.
}).listen(port, "127.0.0.1");
`
    );
    fs.chmodSync(server, 0o755);
    const reader = new LocalVisionLineReader(server, { model: "m.gguf", projector: "p.gguf", bytes: 1 } as never, { readTimeoutMs: 1_000, startTimeoutMs: 10_000 });
    const started = Date.now();
    try {
      await expect(reader.readLine("AAAA", "tekst")).rejects.toThrow("VISION_MODEL_TIMEOUT:1000");
      expect(Date.now() - started).toBeLessThan(8_000);
      expect((reader as unknown as { child: unknown }).child).toBeNull();
    } finally {
      reader.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
