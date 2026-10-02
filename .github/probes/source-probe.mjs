// Jednorazowa sonda: teksty ELI dla aktów, których PDF nie daje się wczytać.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const UA = { "User-Agent": "LexMachina-probe/1.0" };
const ACTS = ["DU/1965/232", "DU/2009/858"];
async function pdfInfo(url) {
  const t = Date.now();
  const r = await fetch(url, { headers: UA });
  const buf = new Uint8Array(await r.arrayBuffer());
  const out = { url, status: r.status, type: r.headers.get("content-type"), bytes: buf.byteLength, ms: Date.now() - t };
  if (!r.ok) return out;
  try {
    const doc = await getDocument({ data: buf, verbosity: 0, disableFontFace: true }).promise;
    out.pages = doc.numPages;
    const sample = [];
    let chars = 0, textPages = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const c = await (await doc.getPage(p)).getTextContent();
      const s = c.items.map((i) => i.str ?? "").join(" ").trim();
      chars += s.length; if (s.length > 20) textPages++;
      if ([1, 2, 3, Math.floor(doc.numPages / 2), doc.numPages].includes(p)) sample.push(`p${p}: ${s.slice(0, 300)}`);
      if (p % 100 === 0) { const m = s.match(/Art\.\s*\d+/g); if (m) sample.push(`p${p} arts: ${m.slice(0, 5)}`); }
    }
    Object.assign(out, { chars, textPages, sample });
    const ops = await (await doc.getPage(1)).getOperatorList();
    out.page1Images = ops.fnArray.filter((f) => f === 85 || f === 86 || f === 82).length;
  } catch (e) { out.error = String(e); }
  return out;
}
for (const eli of ACTS) {
  const base = `https://api.sejm.gov.pl/eli/acts/${eli}`;
  const meta = await (await fetch(base, { headers: { ...UA, Accept: "application/json" } })).json();
  console.log("=== " + eli);
  console.log(JSON.stringify({ title: meta.title, status: meta.status, textHTML: meta.textHTML, textPDF: meta.textPDF, texts: meta.texts, volume: meta.volume, pos: meta.pos }, null, 1));
  const refs = await (await fetch(base + "/references", { headers: { ...UA, Accept: "application/json" } })).json();
  console.log("refs:", JSON.stringify(Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.map((x) => x.id)]))));
  for (const t of meta.texts ?? []) {
    if (/\.pdf$/i.test(t.fileName)) console.log(JSON.stringify(await pdfInfo(`${base}/text/${t.type}/${t.fileName}`), null, 1));
  }
  console.log(JSON.stringify(await pdfInfo(`${base}/text.pdf`), null, 1));
  if (meta.textHTML) { const h = await (await fetch(`${base}/text.html`, { headers: UA })).text(); console.log("html bytes", h.length, h.slice(0, 300)); }
}
