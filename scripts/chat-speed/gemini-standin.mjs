// Local stand-in for the Gemini API (generativelanguage.googleapis.com): models list and
// streamGenerateContent (SSE). Logs what the app sends; answers after a configured delay.
import http from "node:http";
import fs from "node:fs";
const port = Number(process.env.STANDIN_PORT ?? 18911);
const log = process.env.STANDIN_LOG;
// Latency model (ms): first token after TTFT_MS + input chars * PREFILL_MS_PER_KCHAR / 1000,
// plus THINK_MS when thinking is on; then text at TOKENS_PER_S.
const TTFT_MS = Number(process.env.TTFT_MS ?? 0);
const PREFILL_MS_PER_KCHAR = Number(process.env.PREFILL_MS_PER_KCHAR ?? 0);
const THINK_MS = Number(process.env.THINK_MS ?? 0);
const TOKENS_PER_S = Number(process.env.TOKENS_PER_S ?? 0);
const ANSWER = "To jest krótka odpowiedź testowa na pytanie użytkownika, napisana tak, jak zrobiłby to model językowy w zwykłej rozmowie. Składa się z kilku zdań, aby strumień miał kilka fragmentów. Dziękuję za pytanie.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/v1beta/models") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ models: [
      { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1048576 },
      { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1048576 },
      { name: "models/gemini-3-flash-preview", displayName: "Gemini 3 Flash", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1048576 }
    ] }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const received = Date.now();
  let parsed = {};
  try { parsed = JSON.parse(body); } catch {}
  const system = JSON.stringify(parsed.systemInstruction ?? "").length;
  const contents = JSON.stringify(parsed.contents ?? "").length;
  const tools = (parsed.tools ?? []).flatMap((t) => t.functionDeclarations ?? []).length;
  const thinking = parsed.generationConfig?.thinkingConfig ?? null;
  const thinkingOn = !(thinking && (thinking.thinkingBudget === 0 || thinking.thinkingLevel === "minimal"));
  const entry = { at: received, path: url.pathname, systemChars: system, contentsChars: contents, tools, thinking };
  if (log) fs.appendFileSync(log, JSON.stringify(entry) + "\n");
  if (/gemini-2\.5-pro/.test(url.pathname) && thinking?.thinkingBudget === 0) {
    // Real API: "Budget 0 is invalid. This model only works in thinking mode."
    res.statusCode = 400; res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { code: 400, message: "Budget 0 is invalid. This model only works in thinking mode.", status: "INVALID_ARGUMENT" } }));
    return;
  }
  await sleep(TTFT_MS + ((system + contents) / 1000) * PREFILL_MS_PER_KCHAR + (thinkingOn ? THINK_MS : 0));
  res.setHeader("content-type", "text/event-stream");
  const words = ANSWER.split(" ");
  const step = 6;
  for (let i = 0; i < words.length; i += step) {
    const last = i + step >= words.length;
    const text = words.slice(i, i + step).join(" ") + (last ? "" : " ");
    const event = { candidates: [{ content: { role: "model", parts: [{ text }] }, index: 0, ...(last ? { finishReason: "STOP" } : {}) }],
      ...(last ? { usageMetadata: { promptTokenCount: Math.round((system + contents) / 4), candidatesTokenCount: 50, totalTokenCount: Math.round((system + contents) / 4) + 50 } } : {}) };
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (!last && TOKENS_PER_S) await sleep((step * 1.3 / TOKENS_PER_S) * 1000);
  }
  res.end();
}).listen(port, "127.0.0.1", () => console.log("standin on", port));
