import { deflateSync, inflateSync } from "node:zlib";

/**
 * A small PDF 1.4 writer for generated documents (invoices): A4 pages, the
 * standard Helvetica fonts with Polish letters (a /Differences encoding over
 * WinAnsi, so no font file is needed), lines, rectangles and PNG/JPEG images.
 */

// Polish letters outside WinAnsi, on codes of rarely used Latin-1 symbols.
const POLISH: Array<[string, number, string, number, number]> = [
  // char, code, glyph, Helvetica width, Helvetica-Bold width
  ["ą", 0xa4, "aogonek", 556, 556],
  ["ć", 0xa5, "cacute", 500, 556],
  ["ę", 0xa6, "eogonek", 556, 556],
  ["ł", 0xa8, "lslash", 222, 278],
  ["ń", 0xaa, "nacute", 556, 611],
  ["ś", 0xac, "sacute", 500, 556],
  ["ź", 0xaf, "zacute", 500, 500],
  ["ż", 0xb2, "zdotaccent", 500, 500],
  ["Ą", 0xb3, "Aogonek", 667, 722],
  ["Ć", 0xb4, "Cacute", 722, 722],
  ["Ę", 0xb5, "Eogonek", 667, 667],
  ["Ł", 0xb6, "Lslash", 556, 611],
  ["Ń", 0xb8, "Nacute", 722, 722],
  ["Ś", 0xb9, "Sacute", 667, 667],
  ["Ź", 0xba, "Zacute", 611, 611],
  ["Ż", 0xbc, "Zdotaccent", 611, 611]
];

// Helvetica and Helvetica-Bold widths of codes 32–126 (AFM, 1/1000 em).
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];
// WinAnsi characters used in Polish documents beyond ASCII.
const WIN_ANSI: Record<string, [number, number, number]> = {
  "ó": [0xf3, 556, 611],
  "Ó": [0xd3, 778, 778],
  "„": [0x84, 333, 500],
  "”": [0x94, 333, 500],
  "“": [0x93, 333, 500],
  "–": [0x96, 556, 556],
  "—": [0x97, 1000, 1000],
  "§": [0xa7, 556, 556],
  "€": [0x80, 556, 556],
  "é": [0xe9, 556, 556],
  "ü": [0xfc, 556, 611],
  "ö": [0xf6, 556, 611],
  "ä": [0xe4, 556, 556],
  "×": [0xd7, 584, 584],
  "°": [0xb0, 400, 400],
  "·": [0xb7, 278, 278],
  "’": [0x92, 222, 278],
  "‘": [0x91, 222, 278],
  "…": [0x85, 1000, 1000],
  "•": [0x95, 350, 350],
  "«": [0xab, 556, 556],
  "»": [0xbb, 556, 556],
  " ": [0x20, 278, 278]
};
const BY_CHAR = new Map<string, [number, number, number]>([
  ...POLISH.map(([char, code, , regular, bold]) => [char, [code, regular, bold]] as [string, [number, number, number]]),
  ...Object.entries(WIN_ANSI)
]);

export type FontName = "regular" | "bold";

function glyph(char: string): [number, number, number] {
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) return [code, HELVETICA[code - 32]!, HELVETICA_BOLD[code - 32]!];
  return BY_CHAR.get(char) ?? [63, 556, 611];
}

export function textWidth(text: string, font: FontName, size: number): number {
  let width = 0;
  for (const char of text) width += glyph(char)[font === "bold" ? 2 : 1];
  return (width * size) / 1000;
}

function encode(text: string): string {
  let out = "";
  for (const char of text) {
    const code = glyph(char)[0];
    out += code === 40 || code === 41 || code === 92 ? `\\${String.fromCharCode(code)}` : code < 32 || code > 126 ? `\\${code.toString(8).padStart(3, "0")}` : String.fromCharCode(code);
  }
  return out;
}

/** Words of a text in lines no wider than `width`; long words are cut. */
export function wrapText(text: string, font: FontName, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, font, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (textWidth(rest, font, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), font, size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export type PdfImage = { width: number; height: number; objects: (ref: (n: number) => string) => Array<{ dict: string; data: Buffer }> };

function jpegImage(data: Buffer): PdfImage {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) throw new Error("PDF_IMAGE_JPEG_INVALID");
    const marker = data[offset + 1]!;
    const length = data.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = data.readUInt16BE(offset + 5);
      const width = data.readUInt16BE(offset + 7);
      const components = data[offset + 9]!;
      const space = components === 1 ? "/DeviceGray" : components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
      return {
        width,
        height,
        objects: () => [
          {
            dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode${components === 4 ? " /Decode [1 0 1 0 1 0 1 0]" : ""}`,
            data
          }
        ]
      };
    }
    offset += 2 + length;
  }
  throw new Error("PDF_IMAGE_JPEG_INVALID");
}

function pngImage(data: Buffer): PdfImage {
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("latin1", offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      colorType = body[9]!;
      interlace = body[12]!;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!width || !height || !channels || interlace !== 0 || (depth !== 8 && depth !== 16) || (colorType === 3 && depth !== 8)) {
    throw new Error("PDF_IMAGE_PNG_UNSUPPORTED");
  }
  if (width * height > 25_000_000) throw new Error("PDF_IMAGE_TOO_LARGE");
  const bytesPerPixel = channels * (depth / 8);
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)]!;
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const current = pixels.subarray(row * stride, (row + 1) * stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= bytesPerPixel ? current[index - bytesPerPixel]! : 0;
      const up = previous[index]!;
      const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel]! : 0;
      const value = line[index]!;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      current[index] = (value + predicted) & 0xff;
    }
    previous = current;
  }
  const color = colorType === 0 || colorType === 4 ? 1 : 3;
  const rgb = Buffer.alloc(width * height * color);
  const alpha = Buffer.alloc(width * height, 255);
  let hasAlpha = false;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sample = (channel: number) => pixels[pixel * bytesPerPixel + channel * (depth / 8)]!;
    if (colorType === 3) {
      const index = sample(0);
      palette!.copy(rgb, pixel * 3, index * 3, index * 3 + 3);
      if (transparency && index < transparency.length) {
        alpha[pixel] = transparency[index]!;
        hasAlpha ||= transparency[index]! < 255;
      }
      continue;
    }
    for (let channel = 0; channel < color; channel += 1) rgb[pixel * color + channel] = sample(channel);
    if (colorType === 4 || colorType === 6) {
      alpha[pixel] = sample(color);
      hasAlpha ||= alpha[pixel]! < 255;
    }
  }
  const space = color === 1 ? "/DeviceGray" : "/DeviceRGB";
  return {
    width,
    height,
    objects: (ref) => [
      {
        dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /FlateDecode${hasAlpha ? ` /SMask ${ref(1)}` : ""}`,
        data: deflateSync(rgb)
      },
      ...(hasAlpha
        ? [{ dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, data: deflateSync(alpha) }]
        : [])
    ]
  };
}

export function pdfImage(data: Buffer): PdfImage {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return pngImage(data);
  if (data[0] === 0xff && data[1] === 0xd8) return jpegImage(data);
  throw new Error("PDF_IMAGE_TYPE");
}

const num = (value: number) => (Math.round(value * 100) / 100).toString();

export class PdfPage {
  readonly ops: string[] = [];
  readonly images = new Set<number>();
  constructor(readonly width = 595.28, readonly height = 841.89) {}

  text(x: number, y: number, value: string, options: { font?: FontName; size?: number; color?: [number, number, number] } = {}): void {
    const size = options.size ?? 9;
    const [r, g, b] = options.color ?? [0, 0, 0];
    this.ops.push(`BT /${options.font === "bold" ? "F2" : "F1"} ${num(size)} Tf ${num(r)} ${num(g)} ${num(b)} rg ${num(x)} ${num(y)} Td (${encode(value)}) Tj ET`);
  }

  textRight(right: number, y: number, value: string, options: { font?: FontName; size?: number } = {}): void {
    this.text(right - textWidth(value, options.font ?? "regular", options.size ?? 9), y, value, options);
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.6): void {
    this.ops.push(`${num(gray)} G ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  }

  rect(x: number, y: number, width: number, height: number, fillGray: number): void {
    this.ops.push(`${num(fillGray)} g ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f 0 g`);
  }

  image(index: number, x: number, y: number, width: number, height: number): void {
    this.images.add(index);
    this.ops.push(`q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(y)} cm /Im${index} Do Q`);
  }
}

export class PdfDocument {
  readonly pages: PdfPage[] = [];
  private readonly images: PdfImage[] = [];

  constructor(private readonly info: { title: string; author?: string; created: Date }) {}

  addPage(): PdfPage {
    const page = new PdfPage();
    this.pages.push(page);
    return page;
  }

  addImage(image: PdfImage): number {
    this.images.push(image);
    return this.images.length - 1;
  }

  toBuffer(): Buffer {
    const objects: Array<string | { dict: string; data: Buffer }> = [];
    const reserve = () => objects.push("") ;
    const catalog = reserve();
    const pagesId = reserve();
    const differences = POLISH.map(([, code, name]) => `${code} /${name}`).join(" ");
    const fontRegular = reserve();
    objects[fontRegular - 1] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${differences}] >> >>`;
    const fontBold = reserve();
    objects[fontBold - 1] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${differences}] >> >>`;
    const imageIds = this.images.map((image) => {
      const first = objects.length + 1;
      const parts = image.objects((n) => `${first + n} 0 R`);
      for (const part of parts) objects.push({ dict: part.dict, data: part.data });
      return first;
    });
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const content = deflateSync(Buffer.from(page.ops.join("\n"), "latin1"));
      const contentId = objects.push({ dict: "/Filter /FlateDecode", data: content });
      const xobjects = [...page.images].map((index) => `/Im${index} ${imageIds[index]} 0 R`).join(" ");
      pageIds.push(
        objects.push(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> /Contents ${contentId} 0 R >>`
        )
      );
    }
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    const pdfString = (value: string) => `<FEFF${Buffer.from(value, "utf16le").swap16().toString("hex").toUpperCase()}>`;
    const stamp = this.info.created.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const infoId = objects.push(
      `<< /Title ${pdfString(this.info.title)}${this.info.author ? ` /Author ${pdfString(this.info.author)}` : ""} /Producer (Lex Machina) /CreationDate (D:${stamp}Z) >>`
    );

    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    let length = chunks[0]!.length;
    const offsets: number[] = [];
    objects.forEach((object, index) => {
      offsets.push(length);
      const head = `${index + 1} 0 obj\n`;
      const part =
        typeof object === "string"
          ? Buffer.from(`${head}${object}\nendobj\n`, "latin1")
          : Buffer.concat([
              Buffer.from(`${head}<< ${object.dict} /Length ${object.data.length} >>\nstream\n`, "latin1"),
              object.data,
              Buffer.from("\nendstream\nendobj\n", "latin1")
            ]);
      chunks.push(part);
      length += part.length;
    });
    const xref = [
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
      ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${length}\n%%EOF\n`
    ].join("");
    chunks.push(Buffer.from(xref, "latin1"));
    return Buffer.concat(chunks);
  }
}
