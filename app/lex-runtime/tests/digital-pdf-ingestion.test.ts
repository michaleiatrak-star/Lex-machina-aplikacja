import {
  describe,
  expect,
  it
} from "vitest";
import {
  CompleteDocumentIngestor,
  type OcrEngine
} from "../src/document-ingestion.js";
import {
  PdfJsDocumentPageSource
} from "../src/pdf-document-page-source.js";

const DIGITAL_PDF =
  "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA1OTUuMjc1NiA4NDEuODg5OCBdIC9QYXJlbnQgNiAwIFIgL1Jlc291cmNlcyA8PAovRm9udCAxIDAgUiAvUHJvY1NldCBbIC9QREYgL1RleHQgL0ltYWdlQiAvSW1hZ2VDIC9JbWFnZUkgXQo+PiAvUm90YXRlIDAgL1RyYW5zIDw8Cgo+PiAKICAvVHlwZSAvUGFnZQo+PgplbmRvYmoKNCAwIG9iago8PAovUGFnZU1vZGUgL1VzZU5vbmUgL1BhZ2VzIDYgMCBSIC9UeXBlIC9DYXRhbG9nCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9BdXRob3IgKGFub255bW91cykgL0NyZWF0aW9uRGF0ZSAoRDoyMDI2MDkxNjEzMTcyNyswMCcwMCcpIC9DcmVhdG9yIChhbm9ueW1vdXMpIC9LZXl3b3JkcyAoKSAvTW9kRGF0ZSAoRDoyMDI2MDkxNjEzMTcyNyswMCcwMCcpIC9Qcm9kdWNlciAoUmVwb3J0TGFiIFBERiBMaWJyYXJ5IC0gXChvcGVuc291cmNlXCkpIAogIC9TdWJqZWN0ICh1bnNwZWNpZmllZCkgL1RpdGxlICh1bnRpdGxlZCkgL1RyYXBwZWQgL0ZhbHNlCj4+CmVuZG9iago2IDAgb2JqCjw8Ci9Db3VudCAxIC9LaWRzIFsgMyAwIFIgXSAvVHlwZSAvUGFnZXMKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0ZpbHRlciBbIC9BU0NJSTg1RGVjb2RlIC9GbGF0ZURlY29kZSBdIC9MZW5ndGggMTYxCj4+CnN0cmVhbQpHYXBARjVta0lfJ0xfW1lgRVRAI1IkPDMqWGBjIT1uaV01aC5BVWZhTG1DcTdEXE8oVmBIcVxzY21lLC9GYiMrS1hVSE9IKUdIaDNqTkwzJGA2RWVDYkxwWmoiQk9YNGAsVCtuKlwwOTVlPzY6LkhjOC4sWlhwQFhSLi8zY2JFVUBdKCNsZ2ZNaGNZIy47cnNcWyloRCw1a1k1KG4wTmh+PmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAwOTIgMDAwMDAgbiAKMDAwMDAwMDE5OSAwMDAwMCBuIAowMDAwMDAwNDAyIDAwMDAwIG4gCjAwMDAwMDA0NzAgMDAwMDAgbiAKMDAwMDAwMDczMSAwMDAwMCBuIAowMDAwMDAwNzkwIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPDNlODdiZTU1MDAzMmI4NWE5NTRhMTU1MDg0N2E4NzNiPjwzZTg3YmU1NTAwMzJiODVhOTU0YTE1NTA4NDdhODczYj5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKMTA0MQolJUVPRgo=";

describe("digital PDF ingestion", () => {
  it("uses the embedded text layer without invoking OCR when text is sufficient", async () => {
    let ocrCalls = 0;
    const ocr:
      OcrEngine = {
        async recognizePages() {
          ocrCalls += 1;
          return [];
        }
      };

    const ingestor =
      new CompleteDocumentIngestor(
        new PdfJsDocumentPageSource(),
        ocr
      );

    const result =
      await ingestor.ingest(
        Uint8Array.from(
          Buffer.from(
            DIGITAL_PDF,
            "base64"
          )
        )
      );

    expect(
      result.totalPages
    ).toBe(1);
    expect(
      result.digitalPages
    ).toBe(1);
    expect(
      result.ocrPages
    ).toBe(0);
    expect(
      ocrCalls
    ).toBe(0);
    expect(
      result.pages[0]?.text
    ).toContain(
      "Cyfrowy PDF kancelarii"
    );
  });
});

// Two pages with a short text line and no images (like a signature page).
const SHORT_TEXT_PDF = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUiA0IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNSAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNyAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvQ29udGVudHMgNiAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNyAwIFIgPj4gPj4gPj4KZW5kb2JqCjUgMCBvYmoKPDwgL0xlbmd0aCA4NiA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDcwMCBUZCAoU3Ryb25hIDEgLSBQb3pldyBvIHphcGxhdGUpIFRqIEVUIDAgMCAxIHJnIDcyIDUwMCAyMDAgMTAwIHJlIGYKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8IC9MZW5ndGggODYgPj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiA3MiA3MDAgVGQgKFN0cm9uYSAyIC0gUG96ZXcgbyB6YXBsYXRlKSBUaiBFVCAwIDAgMSByZyA3MiA1MDAgMjAwIDEwMCByZSBmCmVuZHN0cmVhbQplbmRvYmoKNyAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKMDAwMDAwMDI0NyAwMDAwMCBuIAowMDAwMDAwMzczIDAwMDAwIG4gCjAwMDAwMDA1MDkgMDAwMDAgbiAKMDAwMDAwMDY0NSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDggL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjcxNQolJUVPRgo=";

describe("stored PDF bytes", () => {
  it("accepts a Node Buffer, keeps it intact and skips OCR on pages without images", async () => {
    const data = Buffer.from(SHORT_TEXT_PDF, "base64");
    const before = Buffer.from(data);
    let ocrPages: number[] = [];
    const ocr: OcrEngine = {
      async recognizePages(bytes, pages) {
        ocrPages = pages;
        expect(Buffer.from(bytes).equals(before)).toBe(true);
        return pages.map((page) => ({ page, text: "" }));
      }
    };
    const result = await new CompleteDocumentIngestor(new PdfJsDocumentPageSource(), ocr).ingest(data);
    expect(result.totalPages).toBe(2);
    expect(result.ocrPages).toBe(0);
    expect(result.digitalPages).toBe(2);
    expect(ocrPages).toEqual([]);
    expect(data.equals(before)).toBe(true);
  });
});

describe("OCR candidates", () => {
  it("sends short pages with images or unknown content to OCR, never image-free ones", async () => {
    let requested: number[] = [];
    const ingestor = new CompleteDocumentIngestor(
      {
        async extract() {
          return {
            bytes: 1,
            pages: [
              { page: 1, text: "", hasImages: true },
              { page: 2, text: "", hasImages: false },
              { page: 3, text: "" },
              { page: 4, text: "x".repeat(80) }
            ]
          };
        }
      },
      {
        async recognizePages(_data, pages) {
          requested = pages;
          return pages.map((page) => ({ page, text: "tekst ze skanu" }));
        }
      }
    );
    const result = await ingestor.ingest(new Uint8Array([1]));
    expect(requested).toEqual([1, 3]);
    expect(result.pages.map((page) => page.source)).toEqual(["OCR", "BLANK", "OCR", "DIGITAL"]);
  });
});

// A scanned page with another program's invisible OCR text (render mode 3) over the image,
// as iLovePDF leaves it; that layer read "sp. z o.o." as "sp. z 0.0.".
const FOREIGN_OCR_LAYER_PDF = "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";

describe("scan with a foreign OCR text layer", () => {
  const data = () => Uint8Array.from(Buffer.from(FOREIGN_OCR_LAYER_PDF, "base64"));

  it("is read again by the local OCR, whose text replaces the foreign layer", async () => {
    let ocrPages: number[] = [];
    const ocr: OcrEngine = {
      async recognizePages(_bytes, pages) {
        ocrPages = pages;
        return pages.map((page) => ({ page, text: "Human Park Global sp. z o.o.", confidence: 0.98, engine: "fake" }));
      }
    };
    const result = await new CompleteDocumentIngestor(new PdfJsDocumentPageSource(), ocr).ingest(data());
    expect(ocrPages).toEqual([1]);
    expect(result.pages[0]).toMatchObject({ source: "OCR", text: "Human Park Global sp. z o.o." });
  });

  it("keeps the foreign layer when no local OCR is configured", async () => {
    const result = await new CompleteDocumentIngestor(new PdfJsDocumentPageSource()).ingest(data());
    expect(result.pages[0]).toMatchObject({ source: "DIGITAL" });
    expect(result.pages[0]?.text).toContain("sp. z 0.0.");
  });

  it("a digital PDF is not taken for a scan", async () => {
    const extracted = await new PdfJsDocumentPageSource().extract(Uint8Array.from(Buffer.from(DIGITAL_PDF, "base64")));
    expect(extracted.pages[0]).not.toHaveProperty("ocrTextLayer");
  });
});
