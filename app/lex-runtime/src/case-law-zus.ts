// ZUS written interpretations (bip.zus.pl/inne/interpretacje): the current ones (from 2013) are
// listed by the BIP search, each with the decision as a PDF; the earlier ones are published as RAR
// archives by subject (.doc and .pdf inside), read with node-unrar-js (WebAssembly, no native code).
// Full pass: the archives, then the list from 2013; afterwards only what is new.
import { DOC_MEDIA_TYPE, LocalOfficeDocumentTextExtractor, type EmbeddedImage } from "./office-document-extractor.js";
import type { ImageOcrEngine } from "./image-ingestion.js";
import type { SyncAdapter, SyncContext } from "./case-law-sync.js";

const BIP = "https://bip.zus.pl";
const PAGE = `${BIP}/inne/interpretacje`;
const PORTLET = "interpretationsportlet_WAR_interpretationsportlet";
const FIRST_DAY = "2013-01-01";
const PAGE_SIZE = 100;
// The archives are large (up to ~180 MB): one download, longer than an ordinary request.
const ARCHIVE_TIMEOUT_MS = 20 * 60 * 1000;
const ARCHIVE_MAX_BYTES = 400 * 1024 * 1024;
const COURT = "Zakład Ubezpieczeń Społecznych";

type ZusState = {
  archivesDone: string[];
  page: number;
  completedAt: string | null;
  // The incremental runs read the list from this day on (a margin before the last complete pass).
  since: string | null;
};

export type ZusListItem = { id: string; sign: string; decisionUrl: string; subject: string | null; published: string | null };

const decode = (text: string) =>
  text
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
const plain = (html: string) => decode(html.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();

/** The RAR archives listed on the interpretations page, with their link text. */
export function zusArchiveLinks(html: string): Array<{ url: string; label: string }> {
  const links: Array<{ url: string; label: string }> = [];
  for (const match of html.matchAll(/<a[^>]*href="([^"]+\.rar\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/giu)) {
    const url = new URL(decode(match[1]!), BIP).toString();
    if (!links.some((link) => link.url === url)) links.push({ url, label: plain(match[2] ?? "") || decodeURIComponent(url.split("/").at(-2) ?? "") });
  }
  return links;
}

/** One page of the BIP search: the case number, the decision's file and the subject of each item. */
export function zusListPage(html: string): ZusListItem[] {
  const items: ZusListItem[] = [];
  for (const block of html.split(/<li class="b-row b-table-row/u).slice(1)) {
    const item = block.split("</li>")[0] ?? "";
    const sign = plain(/Sprawa numer:\s*<span[^>]*>([\s\S]*?)<\/span>/u.exec(item)?.[1] ?? "");
    const decision = /Decyzja:\s*<a[^>]*href="([^"]+)"/u.exec(item)?.[1];
    if (!sign || !decision) continue;
    const decisionUrl = decode(decision);
    const id = new URL(decisionUrl).searchParams.get(`_${PORTLET}_id`) ?? sign;
    const paragraphs = [...item.matchAll(/<p class="fs-bigger">([\s\S]*?)<\/p>/gu)].map((match) => plain(match[1] ?? ""));
    const subject = paragraphs.find((text) => !/^(?:Sprawa numer|Wniosek|Decyzja):/u.test(text)) ?? null;
    const day = /Udostępnił:[^<]*?(\d{2})\.(\d{2})\.(\d{4})/u.exec(item);
    items.push({ id, sign, decisionUrl, subject, published: day ? `${day[3]}-${day[2]}-${day[1]}` : null });
  }
  return items;
}

export function zusListUrl(from: string, to: string, page: number): string {
  const params = new URLSearchParams({ p_p_id: PORTLET, p_p_lifecycle: "0", p_p_state: "normal", p_p_mode: "view" });
  const own = { sign: "", dateFrom: from, dateTo: to, subject: "", resetCur: "false", delta: String(PAGE_SIZE), cur: String(page) };
  for (const [key, value] of Object.entries(own)) params.set(`_${PORTLET}_${key}`, value);
  return `${PAGE}?${params.toString()}`;
}

// node-unrar-js (Emscripten) registers process-wide "uncaughtException" and "unhandledRejection"
// handlers that rethrow, when it opens its first archive: in the application's process they would turn
// any stray rejection into a crash. Whatever it adds there is removed at once.
const PROCESS_EVENTS = ["uncaughtException", "unhandledRejection"];
async function withoutProcessHandlers<T>(work: () => Promise<T>): Promise<T> {
  const emitter = process as unknown as NodeJS.EventEmitter;
  const before = new Map(PROCESS_EVENTS.map((event) => [event, new Set(emitter.listeners(event))]));
  try {
    return await work();
  } finally {
    for (const event of PROCESS_EVENTS) {
      for (const listener of emitter.listeners(event)) {
        if (!before.get(event)!.has(listener)) emitter.removeListener(event, listener as (...args: unknown[]) => void);
      }
    }
  }
}

/** The documents of a RAR archive, one at a time (directories left out). */
export async function* rarDocuments(data: Uint8Array): AsyncGenerator<{ name: string; bytes: Uint8Array }> {
  const { createExtractorFromData } = await import("node-unrar-js");
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const extractor = await withoutProcessHandlers(() => createExtractorFromData({ data: buffer }));
  for (const file of extractor.extract().files) {
    if (file.fileHeader.flags.directory || !file.extraction) continue;
    yield { name: file.fileHeader.name, bytes: file.extraction };
  }
}

const ZUS_SIGN = /\b((?:DI|WPI|WPZ|DPU|DUS|DZS)\/\d{6}\/[\w./-]{3,40}\d{4})\b/u;

export type ZusTextReaders = {
  pdf: (ctx: SyncContext, bytes: Uint8Array) => Promise<string>;
  doc?: (bytes: Uint8Array) => Promise<string>;
  /** Pictures OCR for a .doc that is a pasted scan (no text of its own). */
  imageOcr?: () => ImageOcrEngine | null;
  docImages?: (bytes: Uint8Array) => Promise<EmbeddedImage[]>;
  /** The documents of an archive; RAR by default. */
  archive?: (data: Uint8Array) => AsyncIterable<{ name: string; bytes: Uint8Array }>;
};

let officeExtractor: LocalOfficeDocumentTextExtractor | null = null;
const docText = async (bytes: Uint8Array) => {
  officeExtractor ??= new LocalOfficeDocumentTextExtractor();
  return officeExtractor.extract(bytes, DOC_MEDIA_TYPE).catch(() => "");
};
const docImages = async (bytes: Uint8Array) => {
  officeExtractor ??= new LocalOfficeDocumentTextExtractor();
  return officeExtractor.images(bytes, DOC_MEDIA_TYPE);
};
const isPdf = (bytes: Uint8Array) => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
const isDoc = (bytes: Uint8Array) => bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

async function downloadArchive(ctx: SyncContext, url: string): Promise<Uint8Array | null> {
  ctx.requests += 1;
  const response = await ctx.fetcher(url, { signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS), headers: { accept: "*/*" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP_${response.status} ${url.slice(0, 120)}`);
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > ARCHIVE_MAX_BYTES) throw new Error(`ZUS_ARCHIVE_TOO_LARGE ${size}`);
  return new Uint8Array(await response.arrayBuffer());
}

export function zusAdapter(readers: ZusTextReaders, rulingDate: (text: string) => string | null): SyncAdapter {
  const textOf = async (ctx: SyncContext, bytes: Uint8Array): Promise<string> => {
    try {
      if (isPdf(bytes)) return await readers.pdf(ctx, bytes);
      if (isDoc(bytes)) {
        const own = (await (readers.doc ?? docText)(bytes)).trim();
        if (own.length > 200) return own;
        // A scan pasted into the .doc: its pictures through OCR, page after page.
        const ocr = readers.imageOcr?.();
        if (!ocr) return own;
        const pages: string[] = [];
        for (const picture of await (readers.docImages ?? docImages)(bytes)) {
          const read = await ocr.recognizeImage(picture.data, picture.mediaType).catch(() => null);
          if (read?.text.trim()) pages.push(read.text.trim());
        }
        return [own, ...pages].filter(Boolean).join("\n\n");
      }
    } catch {
      // A file that cannot be read is held with its card and link, without text.
    }
    return "";
  };
  return {
    source: "ZUS",
    label: "ZUS — pisemne interpretacje (BIP ZUS)",
    progress: (db) => {
      const state = db.state<ZusState>("ZUS");
      if (!state) return "nie rozpoczęto";
      if (state.completedAt) return `pobrane w całości (${state.completedAt.slice(0, 10)}); dociąganie nowych`;
      return `pełne pobieranie: archiwa RAR ${state.archivesDone.length}, aktualne interpretacje strona ${state.page}`;
    },
    async run(ctx) {
      const state: ZusState = ctx.db.state<ZusState>("ZUS") ?? { archivesDone: [], page: 1, completedAt: null, since: null };
      const save = () => ctx.db.saveState("ZUS", state);
      // 1. The archives (until 2013), one per run: each is a single large download.
      const page = await ctx.html(PAGE);
      const archive = zusArchiveLinks(page ?? "").find((link) => !state.archivesDone.includes(link.url));
      if (archive && ctx.open) {
        const data = await downloadArchive(ctx, archive.url);
        if (data) {
          const topic = archive.label.replace(/^Pobierz\s+/u, "").replace(/\s*\.RAR.*$/iu, "").trim();
          for await (const file of (readers.archive ?? rarDocuments)(data)) {
            const sourceId = `${archive.url.split("/").at(-2)}/${file.name}`;
            if (ctx.db.has("ZUS", sourceId)) continue;
            const text = await textOf(ctx, file.bytes);
            const name = file.name.split("/").at(-1)!.replace(/\.(pdf|docx?)$/iu, "");
            ctx.store(
              {
                source: "ZUS", sourceId, court: COURT, courtType: "AUTHORITY", division: topic || null,
                signatures: [ZUS_SIGN.exec(text.slice(0, 4000))?.[1] ?? name], date: rulingDate(text.slice(0, 4000)),
                kind: "interpretacja ZUS (archiwum)", judges: [], keywords: topic ? [topic] : [], legalBases: [], summary: null,
                url: archive.url, modified: null
              },
              text
            );
          }
        }
        state.archivesDone.push(archive.url);
        save();
        return;
      }
      // 2. The current interpretations, page by page; after the full pass, from `since` on.
      const from = state.completedAt ? (state.since ?? FIRST_DAY) : FIRST_DAY;
      while (ctx.open) {
        const items = zusListPage((await ctx.html(zusListUrl(from, ctx.today(), state.page))) ?? "");
        if (!items.length) {
          const today = ctx.today();
          state.completedAt = ctx.now().toISOString();
          // A month back: an interpretation published late with an earlier date is not missed.
          state.since = new Date(Date.parse(`${today}T00:00:00Z`) - 31 * 86_400_000).toISOString().slice(0, 10);
          state.page = 1;
          save();
          return;
        }
        for (const item of items) {
          if (!ctx.open) return save();
          if (ctx.db.has("ZUS", item.id)) continue;
          const reply = await ctx.get(item.decisionUrl);
          const bytes = reply ? new Uint8Array(await reply.arrayBuffer()) : null;
          const text = bytes ? await textOf(ctx, bytes) : "";
          ctx.store(
            {
              source: "ZUS", sourceId: item.id, court: COURT, courtType: "AUTHORITY", division: item.subject,
              signatures: [item.sign], date: rulingDate(text.slice(0, 4000)) ?? item.published,
              kind: "interpretacja ZUS (decyzja)", judges: [], keywords: item.subject ? [item.subject] : [], legalBases: [], summary: null,
              url: item.decisionUrl, modified: item.published
            },
            text
          );
        }
        state.page += 1;
        save();
      }
    }
  };
}
