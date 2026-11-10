import { currentLocale } from "./i18n";
// A recording's transcript as the runtime writes it (transcription.ts transcriptLine): one line per
// utterance, "[01:23] Osoba 1: tekst" ("[01:02:03]" past an hour; no speaker without the speaker
// models). Here: lines read back for the editor, written again after edits, and the protocol as
// a Word document.

export type TranscriptTurn = { time: string; seconds: number; speaker: string; text: string };
export type TranscriptPage = { page: number; turns: TranscriptTurn[] };

const LINE = /^\[(\d{2}):(\d{2})(?::(\d{2}))?\]\s?(.*)$/u;
const RECORDING = /\.(?:mp3|wav|m4a|aac|ogg|oga|opus|flac|weba|webm|mp4|m4v|mov|mkv|avi)$/iu;
// "Osoba 1", "Sędzia", "Pełnomocnik powoda": a label up to 40 characters before ": ".
const SPEAKER = /^([^:\n[\]]{1,40}):\s(.*)$/u;

function seconds(match: RegExpExecArray): number {
  const [a, b, c] = [Number(match[1]), Number(match[2]), match[3] === undefined ? null : Number(match[3])];
  return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
}

/** The pages of a recording's transcript: every non-empty line starts with its time. */
export function isTranscript(pages: ReadonlyArray<{ text: string }>, fileName = ""): boolean {
  const lines = pages.flatMap((page) => page.text.split("\n")).filter((line) => line.trim());
  if (!lines.length) return RECORDING.test(fileName);
  return lines.every((line) => LINE.test(line.trim()));
}

/**
 * The turns of the pages. A speaker is read only when most lines name one (a transcript without
 * speaker models has none, and "Uwaga: …" in a line is then its text).
 */
export function parseTranscript(pages: ReadonlyArray<{ page: number; text: string }>): TranscriptPage[] {
  const raw = pages.map((page) => ({
    page: page.page,
    lines: page.text
      .split("\n")
      .map((line) => LINE.exec(line.trim()))
      .filter((match): match is RegExpExecArray => Boolean(match))
  }));
  const all = raw.flatMap((page) => page.lines);
  const named = all.filter((match) => SPEAKER.test(match[4] ?? "")).length;
  const withSpeakers = all.length > 0 && named / all.length >= 0.8;
  return raw.map((page) => ({
    page: page.page,
    turns: page.lines.map((match) => {
      const time = match[0].slice(0, match[0].indexOf("]") + 1);
      const body = match[4] ?? "";
      const speaker = withSpeakers ? SPEAKER.exec(body) : null;
      return { time, seconds: seconds(match), speaker: speaker ? speaker[1]!.trim() : "", text: (speaker ? speaker[2]! : body).trim() };
    })
  }));
}

/** A page's text from its turns, in the runtime's form. */
export function transcriptPageText(turns: readonly TranscriptTurn[]): string {
  return turns.map((turn) => `${turn.time} ${turn.speaker.trim() ? `${turn.speaker.trim()}: ` : ""}${turn.text.replace(/\s*\n\s*/gu, " ").trim()}`).join("\n");
}

/** The speakers in order of first appearance. */
export function transcriptSpeakers(pages: readonly TranscriptPage[]): string[] {
  return [...new Set(pages.flatMap((page) => page.turns.map((turn) => turn.speaker)).filter(Boolean))];
}

/** Every turn of one speaker renamed (a label already used merges the two). */
export function renameSpeaker(pages: readonly TranscriptPage[], from: string, to: string): TranscriptPage[] {
  const name = to.replace(/[:\n[\]]/gu, "").trim().slice(0, 40);
  if (!name || name === from) return pages.map((page) => ({ ...page, turns: [...page.turns] }));
  return pages.map((page) => ({ ...page, turns: page.turns.map((turn) => (turn.speaker === from ? { ...turn, speaker: name } : turn)) }));
}

// --- The protocol as a Word document (OOXML in a stored ZIP, no library) -------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP of stored (uncompressed) entries: what Word needs to open a .docx. */
export function storedZip(entries: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, entry.data);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, entry.data.length, true);
    head.setUint32(24, entry.data.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const xml = (text: string) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
const run = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const paragraph = (runs: string, props = "") => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs}</w:p>`;
const cell = (content: string, width: number, shade = false) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade ? '<w:shd w:val="clear" w:color="auto" w:fill="E7ECEA"/>' : ""}</w:tcPr>${content}</w:tc>`;

export type TranscriptDocumentMeta = { fileName: string; caseName?: string; madeAt: Date; duration: string };

/** The transcript as a protocol: title, details, a table of time, speaker and words, a note. */
export function transcriptDocx(pages: readonly TranscriptPage[], meta: TranscriptDocumentMeta): Uint8Array<ArrayBuffer> {
  const turns = pages.flatMap((page) => page.turns);
  const speakers = transcriptSpeakers(pages);
  const withSpeakers = speakers.length > 0;
  const widths = withSpeakers ? [1100, 1900, 6300] : [1100, 8200];
  const header = paragraph(run("Czas", "<w:b/>"));
  const headRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(header, widths[0]!, true)}${withSpeakers ? cell(paragraph(run("Osoba", "<w:b/>")), widths[1]!, true) : ""}${cell(paragraph(run("Wypowiedź", "<w:b/>")), widths[widths.length - 1]!, true)}</w:tr>`;
  const rows = turns
    .map(
      (turn) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(paragraph(run(turn.time.replace(/[[\]]/gu, ""), '<w:color w:val="555555"/>')), widths[0]!)}${
          withSpeakers ? cell(paragraph(run(turn.speaker || "—", "<w:b/>")), widths[1]!) : ""
        }${cell(paragraph(run(turn.text)), widths[widths.length - 1]!)}</w:tr>`
    )
    .join("");
  const border = '<w:top w:val="single" w:sz="4" w:color="BFC8C4"/><w:bottom w:val="single" w:sz="4" w:color="BFC8C4"/><w:insideH w:val="single" w:sz="4" w:color="BFC8C4"/>';
  const table = `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths
    .map((width) => `<w:gridCol w:w="${width}"/>`)
    .join("")}</w:tblGrid>${headRow}${rows}</w:tbl>`;
  const detail = (label: string, value: string) => paragraph(`${run(`${label}: `, "<w:b/>")}${run(value)}`, '<w:spacing w:after="40"/>');
  const body = [
    paragraph(run("Transkrypcja nagrania", '<w:b/><w:sz w:val="32"/>'), '<w:jc w:val="center"/><w:spacing w:after="240"/>'),
    detail("Nagranie", meta.fileName),
    ...(meta.caseName ? [detail("Sprawa", meta.caseName)] : []),
    detail("Czas trwania", meta.duration),
    ...(withSpeakers ? [detail("Rozmówcy", speakers.join(", "))] : []),
    detail("Sporządzono", meta.madeAt.toLocaleString(currentLocale())),
    paragraph(
      run(
        "Transkrypcja automatyczna (rozpoznawanie mowy i rozmówców na komputerze użytkownika); przed użyciem porównaj ją z nagraniem. Czas przy wypowiedzi wskazuje jej początek w nagraniu.",
        '<w:i/><w:color w:val="555555"/><w:sz w:val="18"/>'
      ),
      '<w:spacing w:before="120" w:after="240"/>'
    ),
    table
  ].join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
  const encoder = new TextEncoder();
  return storedZip([
    {
      name: "[Content_Types].xml",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
      )
    },
    {
      name: "_rels/.rels",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      )
    },
    {
      name: "word/_rels/document.xml.rels",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
      )
    },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
    { name: "word/styles.xml", data: encoder.encode(styles) }
  ]);
}

/** The recording's length from its last turn ("12:34", "1:02:03"). */
export function transcriptDuration(pages: readonly TranscriptPage[]): string {
  const last = pages.flatMap((page) => page.turns).at(-1);
  if (!last) return "—";
  const total = last.seconds;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
