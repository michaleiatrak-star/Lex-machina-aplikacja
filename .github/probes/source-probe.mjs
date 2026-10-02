// Jednorazowa sonda: co jest na stronach-obrazach PDF ELI (OCR tesseract).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
const CASES = [["DU/1965/232", [1]], ["DU/2009/858", [1, 2, 3, 4, 6, 10, 20, 40, 80, 150, 300, 450, 600, 605, 606, 607, 608]]];
for (const [eli, pages] of CASES) {
  const r = await fetch(`https://api.sejm.gov.pl/eli/acts/${eli}/text.pdf`, { headers: { "User-Agent": "LexMachina-probe/1.0" } });
  const file = eli.replace(/\//g, "_") + ".pdf";
  writeFileSync(file, new Uint8Array(await r.arrayBuffer()));
  console.log("=== " + eli);
  console.log(run("pdfinfo", [file]).split("\n").filter((l) => /Pages|Page size|Producer|Creator/.test(l)).join("\n"));
  console.log(run("pdfimages", ["-list", "-f", "1", "-l", "3", file]).slice(0, 1200));
  for (const p of pages) {
    run("pdftoppm", ["-r", "200", "-gray", "-f", String(p), "-l", String(p), "-png", file, "pg"]);
    const png = run("bash", ["-c", "ls pg-*.png | head -1"]).trim();
    const text = run("tesseract", [png, "-", "-l", "pol+ukr"]);
    run("bash", ["-c", "rm -f pg-*.png"]);
    const layer = run("pdftotext", ["-f", String(p), "-l", String(p), "-layout", file, "-"]);
    console.log(`--- p${p} layer=${layer.trim().length} ocr=${text.trim().length}\n${text.trim().slice(0, p === 1 ? 6000 : 700)}`);
  }
}
