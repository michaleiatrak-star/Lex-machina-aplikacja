const DEFAULT_LIMITS = {
    maxPages: 10_000,
    maxTextChars: 100_000_000
};
const IMAGE_OPERATORS = [
    "paintImageXObject",
    "paintInlineImageXObject",
    "paintInlineImageXObjectGroup",
    "paintImageXObjectRepeat",
    "paintImageMaskXObject",
    "paintImageMaskXObjectGroup",
    "paintImageMaskXObjectRepeat",
    "paintSolidColorImageMask",
    "paintJpegXObject"
];
/**
 * A scanned page whose text is all drawn invisible (render mode 3) over an image: the text
 * layer of another program's OCR, not the document's own digital text.
 */
async function pageHasForeignOcrLayer(page, ops) {
    const images = new Set(IMAGE_OPERATORS.map((name) => ops[name]).filter((value) => typeof value === "number"));
    const shows = new Set(["showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText"]
        .map((name) => ops[name])
        .filter((value) => typeof value === "number"));
    try {
        const list = await page.getOperatorList();
        // The render mode belongs to the graphics state: q/Q save and restore it.
        let mode = 0;
        const saved = [];
        let image = false;
        let invisible = 0;
        let visible = 0;
        list.fnArray.forEach((fn, index) => {
            if (fn === ops.setTextRenderingMode)
                mode = Number(list.argsArray[index]?.[0] ?? 0);
            else if (fn === ops.save)
                saved.push(mode);
            else if (fn === ops.restore)
                mode = saved.pop() ?? 0;
            else if (images.has(fn))
                image = true;
            else if (shows.has(fn)) {
                if (mode === 3)
                    invisible += 1;
                else
                    visible += 1;
            }
        });
        return image && invisible > 0 && visible === 0;
    }
    catch {
        return false;
    }
}
async function pageHasImages(page, ops) {
    const wanted = new Set(IMAGE_OPERATORS.map((name) => ops[name]).filter((value) => typeof value === "number"));
    try {
        const list = await page.getOperatorList();
        return list.fnArray.some((fn) => wanted.has(fn));
    }
    catch {
        // Unknown content: let OCR decide.
        return true;
    }
}
export class PdfJsDocumentPageSource {
    limits;
    minTextForImageCheck;
    constructor(limits = DEFAULT_LIMITS, minTextForImageCheck = 40) {
        this.limits = limits;
        this.minTextForImageCheck = minTextForImageCheck;
    }
    async extract(data) {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const task = pdfjs.getDocument({
            // pdf.js rejects Buffer and transfers (detaches) what it gets; OCR reads
            // the caller's bytes afterwards, so pass a plain copy.
            data: new Uint8Array(data),
            useSystemFonts: false,
            disableFontFace: true,
            verbosity: 0
        });
        try {
            const document = await task.promise;
            if (document.numPages > this.limits.maxPages) {
                throw new Error("PDF_PAGE_LIMIT");
            }
            const pages = [];
            let totalChars = 0;
            for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
                const page = await document.getPage(pageNumber);
                const content = await page.getTextContent();
                const text = content.items
                    .map((item) => "str" in item && typeof item.str === "string"
                    ? item.str
                    : "")
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                totalChars += text.length;
                if (totalChars > this.limits.maxTextChars) {
                    throw new Error("PDF_TEXT_LIMIT");
                }
                // Only pages with little text are OCR candidates; for those, record
                // whether the page draws any image, so text-free vector pages
                // (blank, lines, signatures as paths) skip OCR.
                const hasImages = text.length < this.minTextForImageCheck
                    ? await pageHasImages(page, pdfjs.OPS)
                    : undefined;
                const ocrTextLayer = text.length >= this.minTextForImageCheck
                    ? await pageHasForeignOcrLayer(page, pdfjs.OPS)
                    : false;
                pages.push({
                    page: pageNumber,
                    text,
                    ...(hasImages !== undefined ? { hasImages } : {}),
                    ...(ocrTextLayer ? { ocrTextLayer } : {})
                });
                page.cleanup();
            }
            return {
                bytes: data.byteLength,
                pages
            };
        }
        finally {
            await task.destroy().catch(() => undefined);
        }
    }
}
