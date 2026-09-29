import { describe, expect, it } from "vitest";
import {
  splitArticles,
  stripPdfPageHeaders
} from "../src/core-law-index.js";
import { LocalPdfTextExtractor } from "../src/pdf-text-extractor.js";

// Jednostronicowy PDF z osobnymi wierszami, jak tekst jednolity Dz.U. z ISAP.
function linesPdf(lines: string[]): Uint8Array {
  const escape = (value: string) =>
    value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream =
    "BT /F1 11 Tf 72 740 Td 14 TL " +
    lines.map((line, index) => (index === 0 ? "" : "T* ") + "(" + escape(line) + ") Tj").join(" ") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    "<< /Length " + Buffer.byteLength(stream, "latin1") + " >>\nstream\n" + stream + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "latin1");
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let id = 1; id <= 5; id += 1) pdf += String(offsets[id]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

const KK_PAGE = [
  "©Kancelaria Sejmu s. 91/180",
  "2025-03-20",
  "Dziennik Ustaw - 91 - Poz. 383",
  "Art. 178. § 1. Skazujac sprawce przestepstwa okreslonego w art. 173,",
  "sad wymierza kare pozbawienia wolnosci.",
  "Art. 178a. § 1. Kto, znajdujac sie w stanie nietrzezwosci lub pod wplywem",
  "srodka odurzajacego, prowadzi pojazd mecha-",
  "niczny w ruchu ladowym,",
  "podlega karze pozbawienia wolnosci do lat 3.",
  "Art. 179. Kto, wbrew szczegolnemu obowiazkowi, dopuszcza do ruchu pojazd."
];

describe("kopia ELI z PDF (kodeksy bez wersji HTML)", () => {
  it("bez wierszy PDF tekst jednolity nie dzieli sie na artykuly (CORE_LAW_TEXT_UNAVAILABLE)", async () => {
    const flat = await new LocalPdfTextExtractor().extract(linesPdf(KK_PAGE));
    expect(splitArticles(flat.text).order).toEqual([]);
  });

  it("z wierszami PDF artykuly i ich ciagi sa rozpoznane, naglowek strony usuniety", async () => {
    const extracted = await new LocalPdfTextExtractor(undefined, { lines: true }).extract(linesPdf(KK_PAGE));
    const { order, articles } = splitArticles(stripPdfPageHeaders(extracted.text));
    expect(order).toEqual(["178", "178a", "179"]);
    expect(articles["178a"]).toContain("prowadzi pojazd mechaniczny w ruchu ladowym");
    expect(articles["178a"]).toContain("do lat 3.");
    expect(articles["178a"]).not.toContain("Art. 179.");
    expect(stripPdfPageHeaders(extracted.text)).not.toContain("Kancelaria Sejmu");
    expect(stripPdfPageHeaders(extracted.text)).not.toContain("Dziennik Ustaw");
  });
});
