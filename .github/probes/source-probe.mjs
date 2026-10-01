// Jednorazowa sonda zachowania źródeł (przekierowania, typy treści, API), uruchamiana w CI.
const UA = { "User-Agent": "Mozilla/5.0 LexMachina-probe" };
const out = (...a) => console.log(...a);

async function chain(url, { max = 10, accept = "text/html,application/pdf;q=0.9,*/*;q=0.5", cookies = false } = {}) {
  out(`\n### CHAIN ${url} (cookies=${cookies})`);
  const jar = new Map();
  for (let hop = 0; hop <= max; hop += 1) {
    const headers = { ...UA, Accept: accept };
    if (cookies && jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let r;
    try {
      r = await fetch(url, { redirect: "manual", headers, signal: AbortSignal.timeout(25000) });
    } catch (e) { out(`  hop${hop} ERROR ${e.message}`); return null; }
    const sc = r.headers.getSetCookie?.() ?? [];
    for (const c of sc) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    out(`  hop${hop} ${r.status} ${r.headers.get("content-type") ?? ""} loc=${r.headers.get("location") ?? ""} set-cookie=${sc.map((c) => c.split("=")[0]).join(",")}`);
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = new URL(r.headers.get("location"), url).toString(); continue; }
    const body = await r.text();
    out(`  final ${url} len=${body.length}`);
    out(`  head: ${body.slice(0, 400).replace(/\s+/g, " ")}`);
    return body;
  }
  out("  TOO MANY REDIRECTS");
  return null;
}

async function json(url) {
  out(`\n### JSON ${url}`);
  try {
    const r = await fetch(url, { headers: { ...UA, Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    out(`  ${r.status} ${r.headers.get("content-type")} len=${t.length}`);
    out(`  ${t.slice(0, 1500).replace(/\s+/g, " ")}`);
    try { return JSON.parse(t); } catch { return null; }
  } catch (e) { out(`  ERROR ${e.message}`); return null; }
}

const keys = (o, depth = 0, prefix = "") => {
  if (!o || typeof o !== "object" || depth > 3) return [];
  return Object.entries(o).flatMap(([k, v]) => [`${prefix}${k}${Array.isArray(v) ? "[]" : ""}`, ...(Array.isArray(v) ? [] : keys(v, depth + 1, `${prefix}${k}.`))]);
};

// A. ISAP / ELI
await chain("https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000383");
await chain("https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000383", { cookies: true });
await chain("https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20250000383/O/D20250383.pdf", { max: 4 });
const eli = await json("https://api.sejm.gov.pl/eli/acts/DU/2025/383");
if (eli) out(`  textHTML=${eli.textHTML} textPDF=${eli.textPDF} texts=${JSON.stringify(eli.texts ?? null)}`);
await chain("https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.html", { max: 3 });
await chain("https://eli.gov.pl/eli/DU/2025/383/ogl", { max: 6 });

// C. EUR-Lex
for (const u of [
  "https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:32016R0679",
  "https://eur-lex.europa.eu/legal-content/PL/TXT/HTML/?uri=CELEX:32016R0679",
  "https://eur-lex.europa.eu/legal-content/PL/TXT/HTML/?uri=CELEX:62014CJ0362"
]) {
  const b = await chain(u, { max: 6 });
  if (b) out(`  waf=${/awswaf|challenge|captcha/i.test(b)} title=${/<title>([^<]*)/i.exec(b)?.[1] ?? ""} scripts=${(b.match(/<script/gi) ?? []).length}`);
}

// D. KRS
const krs = await json("https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000028860?rejestr=P&format=json");
if (krs) out(`  KEYS ${keys(krs).slice(0, 200).join(" | ")}`);
const krsPelny = await json("https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000028860?rejestr=P&format=json");
if (krsPelny) out(`  PELNY KEYS ${keys(krsPelny).slice(0, 60).join(" | ")}`);
await chain("https://prs.ms.gov.pl/krs/podglad-informacji-aktualnej/0000028860", { max: 6 });
const wk = await chain("https://wyszukiwarka-krs.ms.gov.pl/", { max: 6 });
if (wk) {
  const scripts = [...wk.matchAll(/<script[^>]+src="([^"]+)"/gi)].map((m) => new URL(m[1], "https://wyszukiwarka-krs.ms.gov.pl/").toString());
  out(`  scripts: ${scripts.join(" ")}`);
  for (const s of scripts.slice(0, 6)) {
    try {
      const js = await (await fetch(s, { headers: UA, signal: AbortSignal.timeout(25000) })).text();
      const apis = [...new Set([...js.matchAll(/https?:\/\/[a-z0-9.-]+\.gov\.pl[^"'`\s]*/gi)].map((m) => m[0]))].slice(0, 40);
      const paths = [...new Set([...js.matchAll(/["'`](\/?api\/[A-Za-z0-9/_-]+)["'`]/g)].map((m) => m[1]))].slice(0, 60);
      const nip = [...new Set([...js.matchAll(/.{0,80}(?:nip|regon)["']?\s*:.{0,80}/gi)].map((m) => m[0]))].slice(0, 15);
      out(`  JS ${s} len=${js.length}\n    hosts=${apis.join(" ")}\n    paths=${paths.join(" ")}\n    nip/regon=${nip.join("\n      ")}`);
    } catch (e) { out(`  JS ${s} ERROR ${e.message}`); }
  }
}

// E. Biała lista
const wl = await json("https://wl-api.mf.gov.pl/api/search/nip/7740001454?date=2026-10-01");
await json("https://wl-api.mf.gov.pl/api/search/regon/610188201?date=2026-10-01");
await chain("https://www.podatnik.info/", { max: 6 });
await chain("https://www.podatki.gov.pl/wykaz-podatnikow-vat-wyszukiwarka", { max: 6 });

// F. NBP
await json("https://api.nbp.pl/api/exchangerates/rates/c/eur/2026-09-17/2026-10-01/?format=json");
await json("https://api.nbp.pl/api/exchangerates/rates/c/huf/2026-09-17/2026-10-01/?format=json");
await json("https://api.nbp.pl/api/exchangerates/tables/c/?format=json");
await chain("https://nbp.pl/statystyka-i-sprawozdawczosc/kursy/tabela-a/", { max: 6 });
await chain("https://nbp.pl/statystyka-i-sprawozdawczosc/kursy/tabela-c/", { max: 6 });

// G. CBOSA dokument z błędem „brak pól Data orzeczenia”
const cb = await chain("https://orzeczenia.nsa.gov.pl/doc/EE1FD428A5", { max: 4 });
if (cb) {
  const labels = [...cb.matchAll(/<td[^>]*class="[^"]*(?:lista-label|info-list-label)[^"]*"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((m) => `${m[1].replace(/<[^>]+>/g, "").trim()} => ${m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)}`);
  out(`  CBOSA labels:\n    ${labels.join("\n    ")}`);
  const i = cb.search(/Data orzeczenia|Data wydania|data/i);
  out(`  near: ${cb.slice(Math.max(0, i - 600), i + 900).replace(/\s+/g, " ")}`);
}
await chain("https://orzeczenia.nsa.gov.pl/doc/2B2C1D1B5C", { max: 4 });

// H. CEIDG (publiczna wyszukiwarka)
await chain("https://aplikacja.ceidg.gov.pl/ceidg/ceidg.public.ui/search.aspx", { max: 6 });
