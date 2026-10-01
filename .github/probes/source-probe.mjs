// Sonda 5: KIO POST /Home/GetResults, sygnatura, strona szczegółów.
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
  const buf = Buffer.from(await r.arrayBuffer());
  const body = buf.toString("utf8");
  out(`\n### ${init.method ?? "GET"} ${url} -> ${r.status} ${r.headers.get("content-type")} loc=${r.headers.get("location") ?? ""} len=${buf.length} (${Date.now() - t0} ms)`);
  return { r, body, buf };
}
await req("https://orzeczenia.uzp.gov.pl/Home/Search?Fle=1&SCnt=1");
const post = (fields) => req("https://orzeczenia.uzp.gov.pl/Home/GetResults", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest", Referer: "https://orzeczenia.uzp.gov.pl/Home/Search" },
  body: new URLSearchParams(fields).toString()
});
let first = null;
for (const fields of [
  { Phrase: "rażąco niska cena", Fle: "1", SCnt: "1", CountStats: "True", Kind: "KIO", Pg: "1" },
  { Sign: "KIO 827/18", CountStats: "True", Kind: "", Pg: "1" },
  { Sign: "KIO 99999/18", CountStats: "True", Kind: "", Pg: "1" },
  { Phrase: "rażąco niska cena", Fle: "1", SCnt: "1", CountStats: "False", Kind: "KIO", Pg: "2", Srt: "date_desc" }
]) {
  const r = await post(fields);
  if (!r) continue;
  out(`  fields=${JSON.stringify(fields)}`);
  out(`  resultCounts=${/id="resultCounts"[^>]*value="([^"]*)"/.exec(r.body)?.[1] ?? /value="([^"]*)"[^>]*id="resultCounts"/.exec(r.body)?.[1] ?? "-"}`);
  const links = [...r.body.matchAll(/href="([^"]*)"[^>]*class="[^"]*link-details|class="[^"]*link-details[^"]*"[^>]*href="([^"]*)"/g)].map((m) => m[1] ?? m[2]);
  out(`  details: ${links.slice(0, 5).join(" ")}`);
  out(`  all hrefs: ${[...new Set([...r.body.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]))].slice(0, 15).join(" ")}`);
  if (!first) { first = { r, links }; out(`  HTML: ${r.body.replace(/\s+/g, " ").slice(0, 4500)}`); }
}
if (first?.links?.[0]) {
  const d = await req(new URL(first.links[0], "https://orzeczenia.uzp.gov.pl/").toString());
  if (d) {
    out(`  hrefs: ${[...new Set([...d.body.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]))].filter((h) => !/\.css|lib\//.test(h)).slice(0, 25).join(" ")}`);
    out(`  iframes: ${[...d.body.matchAll(/<(?:iframe|object|embed)[^>]*>/g)].map((m) => m[0]).join(" ")}`);
    const t = d.body.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    out(`  text: ${t.slice(0, 2500)}`);
    const i = d.body.search(/Sygnatura|Data wydania|Rodzaj/);
    out(`  meta html: ${d.body.slice(Math.max(0, i - 200), i + 2500).replace(/\s+/g, " ")}`);
    const pdf = [...d.body.matchAll(/href="([^"]*(?:pdf|Pdf|Download|Content)[^"]*)"/g)].map((m) => m[1])[0];
    if (pdf) {
      const p = await req(new URL(pdf, "https://orzeczenia.uzp.gov.pl/").toString());
      if (p) out(`  pdf head: ${p.buf.subarray(0, 8).toString("latin1")} ${p.r.headers.get("content-disposition") ?? ""}`);
    }
  }
}
