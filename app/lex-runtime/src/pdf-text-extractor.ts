export type PdfTextExtractionResult = {
  text: string;
  pages: number;
  bytes: number;
  // Tekst każdej strony (indeks 0 = strona 1).
  pageTexts?: string[];
};

export type PdfTextLimits = {
  maxBytes: number;
  maxPages: number;
  maxTextChars: number;
};

export interface PdfTextExtractor {
  extract(
    data: Uint8Array
  ): Promise<PdfTextExtractionResult>;
}

export const DEFAULT_PDF_MAX_BYTES =
  16 * 1024 * 1024;

const DEFAULT_LIMITS: PdfTextLimits = {
  maxBytes: DEFAULT_PDF_MAX_BYTES,
  maxPages: 600,
  maxTextChars: 6_000_000
};

export class PdfTextExtractionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "PDF_TOO_LARGE"
      | "PDF_TOO_MANY_PAGES"
      | "PDF_TEXT_TOO_LARGE"
      | "PDF_NO_TEXT"
      | "PDF_PARSE_FAILED"
  ) {
    super(message);
    this.name = "PdfTextExtractionError";
  }
}

type LineItem = {
  str?: unknown;
  hasEOL?: boolean;
  width?: number;
  transform?: number[];
};

// Odstęp węższy niż ten ułamek wysokości czcionki to rozstrzelenie liter przy justowaniu,
// nie spacja: pdf.js dzieli wtedy wyraz na dwa elementy („ubezwłas” + „nowolnione”).
const GLUE_GAP_EM = 0.12;

// Znacznik wiersza złożonego mniejszą czcionką niż treść strony (przypisy Dz.U.: 9 pt wobec
// 9,96 pt). Ustawiany tylko z opcją markSmallLines; czytelnik musi go usunąć.
export const SMALL_LINE_MARK = "\u2063";
const SMALL_LINE_RATIO = 0.93;

/**
 * Elementy tekstu strony w wiersze; wyraz rozbity na dwa elementy bez odstępu wraca w całości.
 * markSmall: wiersze, których największa czcionka jest wyraźnie mniejsza od czcionki treści
 * strony, dostają na początku SMALL_LINE_MARK.
 */
export function joinLineItems(items: readonly unknown[], markSmall = false): string {
  if (markSmall) {
    // Czcionka treści: rozmiar o największej liczbie znaków na stronie.
    const weight = new Map<number, number>();
    for (const raw of items) {
      const item = raw as LineItem;
      if (typeof item.str !== "string" || !Array.isArray(item.transform)) continue;
      const size = Math.round(Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) * 10) / 10;
      weight.set(size, (weight.get(size) ?? 0) + item.str.trim().length);
    }
    const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    // Największa czcionka każdego wiersza; wiersze dzieli hasEOL, jak przy składaniu tekstu.
    const lines: number[] = [0];
    for (const raw of items) {
      const item = raw as LineItem;
      if (typeof item.str !== "string") continue;
      if (item.str.trim() && Array.isArray(item.transform)) {
        const size = Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0);
        lines[lines.length - 1] = Math.max(lines[lines.length - 1]!, size);
      }
      if (item.hasEOL) lines.push(0);
    }
    // Złożenie wierszy jak bez znacznika, potem znacznik na początku małych wierszy.
    const joined = joinLineItems(items).split("\n");
    return joined
      .map((text, index) => {
        const size = lines[index] ?? 0;
        return body > 0 && size > 0 && size < body * SMALL_LINE_RATIO && text.trim() ? SMALL_LINE_MARK + text : text;
      })
      .join("\n");
  }
  let out = "";
  let previous: { str: string; x: number; y: number; end: number; size: number; eol: boolean } | null = null;
  for (const raw of items) {
    const item = raw as LineItem;
    if (typeof item.str !== "string") continue;
    const transform = Array.isArray(item.transform) ? item.transform : null;
    const x = transform?.[4] ?? 0;
    const y = transform?.[5] ?? 0;
    const size = transform ? Math.hypot(transform[2] ?? 0, transform[3] ?? 0) : 0;
    if (previous) {
      if (previous.eol) {
        out += "\n";
      } else {
        const em = Math.max(previous.size, size);
        const gap = x - previous.end;
        const glue =
          transform !== null &&
          em > 0 &&
          Math.abs(y - previous.y) < em * 0.5 &&
          gap < em * GLUE_GAP_EM &&
          gap > -em * 0.5 &&
          /\p{L}$/u.test(previous.str) &&
          // Dywiz przeniesienia bywa osobnym elementem innym fontem („przedsię” + „-”).
          /^(?:\p{L}|-$)/u.test(item.str);
        out += glue ? "" : " ";
      }
    }
    out += item.str;
    previous = {
      str: item.str,
      x,
      y,
      end: x + (typeof item.width === "number" ? item.width : 0),
      size,
      eol: Boolean(item.hasEOL)
    };
  }
  return out;
}

export class LocalPdfTextExtractor
implements PdfTextExtractor {
  constructor(
    private readonly limits: PdfTextLimits =
      DEFAULT_LIMITS,
    // true = koniec wiersza w PDF (hasEOL) zostaje "\n". Potrzebne tam, gdzie tekst dzieli
    // się po nagłówkach wierszy (Art. N. w kopii ELI); domyślnie strona to jeden wiersz,
    // jak dotąd (hasze i cytaty dokumentów sprawy się nie zmieniają).
    // allowEmpty: strony bez warstwy tekstowej nie są błędem (wywołujący robi OCR tych stron).
    // markSmallLines: wiersze mniejszą czcionką (przypisy) z SMALL_LINE_MARK na początku.
    private readonly options: { lines?: boolean; allowEmpty?: boolean; markSmallLines?: boolean } = {}
  ) {}

  async extract(
    data: Uint8Array
  ): Promise<PdfTextExtractionResult> {
    if (
      data.byteLength >
      this.limits.maxBytes
    ) {
      throw new PdfTextExtractionError(
        "PDF exceeds the configured byte limit.",
        "PDF_TOO_LARGE"
      );
    }

    let loadingTask:
      | ReturnType<
          typeof import(
            "pdfjs-dist/legacy/build/pdf.mjs"
          )["getDocument"]
        >
      | undefined;

    try {
      const pdfjs = await import(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );

      loadingTask = pdfjs.getDocument({
        // pdf.js rejects Buffer and transfers (detaches) what it gets: pass a plain copy.
        data: new Uint8Array(data),
        useSystemFonts: false,
        disableFontFace: true,
        verbosity: 0
      });

      const document =
        await loadingTask.promise;

      if (
        document.numPages >
        this.limits.maxPages
      ) {
        throw new PdfTextExtractionError(
          "PDF exceeds the configured page limit.",
          "PDF_TOO_MANY_PAGES"
        );
      }

      const chunks: string[] = [];
      let textChars = 0;

      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const page =
          await document.getPage(
            pageNumber
          );
        const content =
          await page.getTextContent();

        const pageText =
          this.options.lines
            ? joinLineItems(content.items, this.options.markSmallLines === true)
                .replace(/[ \t]+/g, " ")
                .replace(/ *\n */g, "\n")
                .trim()
            : content.items
                .map((item) =>
                  "str" in item &&
                  typeof item.str === "string"
                    ? item.str
                    : ""
                )
                .filter(Boolean)
                .join(" ");

        textChars +=
          pageText.length + 1;

        if (
          textChars >
          this.limits.maxTextChars
        ) {
          throw new PdfTextExtractionError(
            "Extracted PDF text exceeds the configured character limit.",
            "PDF_TEXT_TOO_LARGE"
          );
        }

        chunks.push(pageText);
        page.cleanup();
      }

      const text =
        chunks.join("\n").trim();

      if (!text && !this.options.allowEmpty) {
        throw new PdfTextExtractionError(
          "PDF contains no extractable text; OCR is intentionally disabled.",
          "PDF_NO_TEXT"
        );
      }

      return {
        text,
        pages: document.numPages,
        bytes: data.byteLength,
        pageTexts: chunks
      };
    } catch (error) {
      if (
        error instanceof
        PdfTextExtractionError
      ) {
        throw error;
      }

      throw new PdfTextExtractionError(
        "PDF could not be parsed safely.",
        "PDF_PARSE_FAILED"
      );
    } finally {
      if (loadingTask) {
        try {
          await loadingTask.destroy();
        } catch {
          // Best-effort cleanup only.
        }
      }
    }
  }
}
