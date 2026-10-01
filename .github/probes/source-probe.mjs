// Sonda 4: skąd strona wyników KIO dociąga listę (AJAX).
const out = (...a) => console.log(...a);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LexMachina-probe", "Accept-Language": "pl-PL,pl;q=0.9" };
const jar = new Map();
async function req(url, init = {}) {
  const headers = { ...UA, ...(init.headers ?? {}) };
  if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const t0 = Date.now();
  let r;
  try { r = await fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(40000) }); }
  catch (e) { out(`  ERROR ${url} ${e.message}`); return null; }
  for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  const body = await r.text();
  out(`\n### ${init.method ?? "GET"} ${url} -> ${r.status} ${r.headers.get("content-type")} len=${body.length} (${Date.now() - t0} ms)`);
  return { r, body };
}
const page = await req("https://orzeczenia.uzp.gov.pl/Home/Search?Phrase=ra%C5%BC%C4%85co+niska+cena&Fle=1&SCnt=1&CountStats=True");
if (page) {
  const scripts = [...page.body.matchAll(/<script[^>]*src="([^"]+)"/gi)].map((m) => new URL(m[1], "https://orzeczenia.uzp.gov.pl/").toString());
  out(`scripts: ${scripts.join("\n  ")}`);
  const inline = [...page.body.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).filter((s) => s.trim());
  inline.forEach((s, i) => out(`--- inline ${i} (${s.length}) ---\n${s.replace(/\s+/g, " ").slice(0, 3000)}`));
  for (const s of scripts.filter((u) => u.includes("uzp.gov.pl") && !/jquery|bootstrap|select2|adminlte|datepicker|typeahead/i.test(u))) {
    const js = await req(s);
    if (js) out(`${js.body.replace(/\s+/g, " ").slice(0, 6000)}`);
  }
  const data = [...page.body.matchAll(/data-(?:url|action|href|src)="([^"]+)"/gi)].map((m) => m[1]);
  out(`data-url: ${[...new Set(data)].join(" ")}`);
  const i = page.body.indexOf("Proszę czekać");
  out(`near wait: ${page.body.slice(Math.max(0, i - 1500), i + 800).replace(/\s+/g, " ")}`);
}
