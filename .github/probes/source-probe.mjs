// Sonda 3: wyszukiwarka orzeczeń KIO (orzeczenia.uzp.gov.pl) i czas odpowiedzi SAOS.
const out = (...a) => console.log(...a);
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LexMachina-probe", "Accept-Language": "pl-PL,pl;q=0.9" };
const jar = new Map();
async function req(url, init = {}) {
  const headers = { ...UA, ...(init.headers ?? {}) };
  if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const t0 = Date.now();
  let r;
  try { r = await fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(40000) }); }
  catch (e) { out(`  ERROR ${url} ${e.message} ${e.cause?.code ?? ""} (${Date.now() - t0} ms)`); return null; }
  for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  const body = await r.text();
  out(`\n### ${init.method ?? "GET"} ${url} -> ${r.status} ${r.headers.get("content-type")} loc=${r.headers.get("location") ?? ""} len=${body.length} (${Date.now() - t0} ms)`);
  return { r, body };
}
const strip = (s) => s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const home = await req("https://orzeczenia.uzp.gov.pl/");
if (home) {
  const forms = [...home.body.matchAll(/<form[\s\S]*?<\/form>/gi)].map((m) => m[0]);
  for (const f of forms) {
    out(`FORM ${/<form[^>]*>/i.exec(f)?.[0]}`);
    for (const i of f.matchAll(/<(input|select|textarea)[^>]*>/gi)) out(`   ${i[0].slice(0, 220)}`);
  }
  const scripts = [...home.body.matchAll(/<script[^>]*src="([^"]+)"/gi)].map((m) => new URL(m[1], "https://orzeczenia.uzp.gov.pl/").toString());
  out(`scripts: ${scripts.join(" ")}`);
  const inline = [...home.body.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  out(`inline ajax: ${[...new Set([...inline.matchAll(/["'](\/[A-Za-z]+\/[A-Za-z]+[^"']*)["']/g)].map((m) => m[1]))].join(" ")}`);
  for (const s of scripts.filter((u) => u.includes("uzp.gov.pl")).slice(0, 6)) {
    const js = await req(s);
    if (js) out(`   urls: ${[...new Set([...js.body.matchAll(/["'](\/(?:Home|Api|api|Search|Result|Document)[A-Za-z0-9/_?=&.-]*)["']/g)].map((m) => m[1]))].slice(0, 40).join(" ")}`);
  }
  out(`TEXT: ${strip(home.body).slice(0, 1500)}`);
}

for (const q of ["Phrase=odrzucenie+oferty", "Sign=KIO+827%2F18", "Phrase=odrzucenie+oferty&SCnt=10&Dt=0", "Sign=KIO%20827/18&Phrase=&Dt=0"]) {
  const r = await req(`https://orzeczenia.uzp.gov.pl/Home/Search?${q}`);
  if (r) {
    const links = [...new Set([...r.body.matchAll(/href="([^"]*(?:Details|Document|ContentViewer|Orzeczenie|Download)[^"]*)"/gi)].map((m) => m[1]))].slice(0, 10);
    out(`  links: ${links.join(" ")}`);
    out(`  count: ${/(znaleziono|wyników|wyniki|Liczba)[^<]{0,80}/i.exec(r.body)?.[0] ?? "-"}`);
    out(`  text: ${strip(r.body).slice(0, 700)}`);
  }
}
// POST z formularza
const post = await req("https://orzeczenia.uzp.gov.pl/Home/Search", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "Phrase=odrzucenie+oferty&Sign=&Dt=0"
});
if (post) {
  out(`  links: ${[...new Set([...post.body.matchAll(/href="([^"]*(?:Details|Document|ContentViewer|Download)[^"]*)"/gi)].map((m) => m[1]))].slice(0, 10).join(" ")}`);
  out(`  text: ${strip(post.body).slice(0, 700)}`);
}
for (const u of ["https://orzeczenia.uzp.gov.pl/Home/GetResults", "https://orzeczenia.uzp.gov.pl/Home/ContentViewer", "https://orzeczenia.uzp.gov.pl/api/", "https://orzeczenia.uzp.gov.pl/swagger"]) await req(u);

// SAOS: czas odpowiedzi
for (const u of [
  "https://www.saos.org.pl/api/search/judgments?all=odrzucenie+oferty&pageSize=5",
  "https://www.saos.org.pl/api/search/judgments?caseNumber=KIO+827%2F18&pageSize=5",
  "https://www.saos.org.pl/api/search/judgments?all=najem&courtType=COMMON&pageSize=5"
]) {
  const r = await req(u, { headers: { Accept: "application/json" } });
  if (r) out(`  ${r.body.slice(0, 300).replace(/\s+/g, " ")}`);
}
