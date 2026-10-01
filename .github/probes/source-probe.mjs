// Sonda 2: EUR-Lex przez Cellar, CBOSA (przyczyna błędu), ELI text.pdf.
const out = (...a) => console.log(...a);
async function chain(url, headers = {}, max = 10) {
  out(`\n### CHAIN ${url} ${JSON.stringify(headers)}`);
  for (let hop = 0; hop <= max; hop += 1) {
    let r;
    try {
      r = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 LexMachina-probe", ...headers }, signal: AbortSignal.timeout(30000) });
    } catch (e) { out(`  hop${hop} ERROR ${e.message} cause=${e.cause?.code ?? ""} ${e.cause?.message ?? ""}`); return null; }
    out(`  hop${hop} ${r.status} ${r.headers.get("content-type") ?? ""} loc=${r.headers.get("location") ?? ""}`);
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = new URL(r.headers.get("location"), url).toString(); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const body = buf.toString("utf8");
    out(`  final ${url} len=${buf.length}`);
    out(`  head: ${body.slice(0, 500).replace(/\s+/g, " ")}`);
    return body;
  }
  out("  TOO MANY REDIRECTS");
  return null;
}
for (const celex of ["32016R0679", "62014CJ0362"]) {
  await chain(`https://publications.europa.eu/resource/celex/${celex}`, { Accept: "text/html", "Accept-Language": "pl" });
  await chain(`https://publications.europa.eu/resource/celex/${celex}`, { Accept: "application/xhtml+xml", "Accept-Language": "pol" });
  await chain(`https://publications.europa.eu/resource/celex/${celex}.POL.xhtml`, { Accept: "application/xhtml+xml" });
}
await chain("https://eur-lex.europa.eu/legal-content/PL/TXT/HTML/?uri=CELEX:32016R0679", { Accept: "text/html", "Accept-Language": "pl" });
await chain("https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf", {}, 3);
await chain("https://api.sejm.gov.pl/eli/acts/DU/1964/16/text.html", {}, 3);
for (const ua of ["lex-machina-cbosa/1.0", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"]) {
  const b = await chain("https://orzeczenia.nsa.gov.pl/doc/EE1FD428A5", { "User-Agent": ua, "Accept-Language": "pl-PL,pl;q=0.9" }, 4);
  if (b) {
    const rows = [...b.matchAll(/<td[^>]*class="[^"]*lista-label[^"]*"[^>]*>([\s\S]*?)<\/td>([\s\S]{0,700}?)<\/tr>/gi)]
      .map((m) => `${m[1].replace(/<[^>]+>/g, "").trim()} => ${m[2].replace(/\s+/g, " ").slice(0, 400)}`);
    out(`  ROWS:\n    ${rows.join("\n    ")}`);
    break;
  }
}
await chain("http://orzeczenia.nsa.gov.pl/doc/EE1FD428A5", { "Accept-Language": "pl-PL" }, 4);
