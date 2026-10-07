// Time to answer as the user sees it: sends chat messages to a running lex-runtime exactly
// as lex-web does (envelope, auxiliaryText, primarySkill AUTO, X-Lex-Execution-Id).
//
// Run the runtime with its own HOME (this client sets the first-run admin password):
//   HOME=/tmp/lex-speed LEX_PORT=18920 GOOGLE_GENERATIVE_AI_API_KEY=... node dist/http/server.js
// Real Gemini: as above. Local stand-in instead (fixed model latency, logs the prompt):
//   node gemini-standin.mjs  and start the runtime with
//   STANDIN_URL=http://127.0.0.1:18911 node --import ./redirect-google.mjs dist/http/server.js
// Then: LEX_URL=http://127.0.0.1:18920 MODEL=gemini-2.5-flash node client.mjs questions.json label out.json
// (STANDIN_LOG=<stand-in log> adds time before the model call and prompt size per message.)
import fs from "node:fs";
import { randomUUID } from "node:crypto";
const base = process.env.LEX_URL ?? "http://127.0.0.1:18920";
const model = process.env.MODEL ?? "gemini-2.5-flash";
const standinLog = process.env.STANDIN_LOG;
const questions = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const label = process.argv[3] ?? "run";
const out = process.argv[4];
const post = async (path, body, token) => {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : {} };
};
let login = await post("/api/auth/login", { loginName: "admin", password: "Benchmark-Haslo-2026!" });
if (login.status !== 200) {
  login = await post("/api/auth/login", { loginName: "admin", password: "admin" });
  await post("/api/auth/password", { currentPassword: "admin", newPassword: "Benchmark-Haslo-2026!" }, login.body.sessionToken);
  login = await post("/api/auth/login", { loginName: "admin", password: "Benchmark-Haslo-2026!" });
}
const token = login.body.sessionToken;
if (!token) throw new Error("LOGIN " + JSON.stringify(login.body).slice(0, 300));
const envelope = (query) => `__LEX_SKILLS_V1__ ${JSON.stringify({ auto: true, manual: [], caseType: "AUTO" })}\n${query}`;
const lines = () => (standinLog && fs.existsSync(standinLog) ? fs.readFileSync(standinLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const results = [];
for (const item of questions) {
  const q = typeof item === "string" ? item : item.q;
  const history = typeof item === "string" ? "" : item.history ?? "";
  const query = history ? `${history}\n\nUżytkownik: ${q}` : q;
  const before = lines().length;
  const id = randomUUID();
  const t0 = performance.now();
  const wall0 = Date.now();
  let firstText = null;
  let polling = true;
  const poll = (async () => {
    while (polling) {
      const r = await fetch(`${base}/api/sessions/progress/${id}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      if (r?.ok) { const p = await r.json(); if (p.text && firstText === null) firstText = performance.now() - t0; }
      await new Promise((res) => setTimeout(res, 50));
    }
  })();
  const r = await fetch(`${base}/api/sessions/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "X-Lex-Execution-Id": id },
    body: JSON.stringify({ query: envelope(query), provider: "google", model, auxiliaryText: q, primarySkill: "AUTO", mode: "PRAWNIK" })
  });
  const body = await r.json().catch(() => ({}));
  const total = performance.now() - t0;
  polling = false; await poll;
  const calls = lines().slice(before);
  const firstCall = calls[0];
  // lex-web polls every 1000 ms: the draft shows at the first tick after it exists.
  const uiFirst = firstText === null ? total : Math.min(total, Math.ceil(firstText / 1000) * 1000);
  results.push({
    label, q, status: r.status, error: body.error ?? null,
    totalMs: Math.round(total), firstTextMs: firstText === null ? null : Math.round(firstText), uiFirstVisibleMs: Math.round(uiFirst),
    beforeModelMs: firstCall ? firstCall.at - wall0 : null, modelCalls: calls.length,
    promptChars: calls.reduce((s, c) => s + c.systemChars + c.contentsChars, 0), tools: firstCall?.tools ?? 0,
    thinking: firstCall?.thinking ?? null, loadedSkills: body.loadedSkills ?? null, answerChars: (body.output ?? "").length
  });
  process.stderr.write(`${label} ${r.status} ${Math.round(total)}ms calls=${calls.length} prompt=${results.at(-1).promptChars} ${q.slice(0, 40)}\n`);
}
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
