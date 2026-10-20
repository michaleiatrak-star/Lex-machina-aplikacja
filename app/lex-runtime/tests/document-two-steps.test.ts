import { describe, expect, it } from "vitest";
import { CompleteDocumentIngestor } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import { LocalLlmPrivacyNamedEntityRecognizer } from "../src/privacy/local-llm-ner.js";
import type { PersonMorphology } from "../src/privacy/person-morphology.js";

const morphology: PersonMorphology = { analyze: async (surfaces) => surfaces.map(() => null) };

// Several files: the OCR of all of them first, then the text model is started once for the
// detection of personal data.
describe("reading and detection as two steps", () => {
  it("reads without detecting, then starts the text model and detects", async () => {
    const events: string[] = [];
    let ready = false;
    const recognizer = new LocalLlmPrivacyNamedEntityRecognizer(
      { stream: async () => ({ fullText: "[]" }) } as never,
      {
        configuredModelId: () => "local/bielik",
        status: () => ({ configured: true, state: ready ? "READY" : "STOPPED" })
      } as never,
      { recognize: async (text: string) => [{ start: text.indexOf("Jan"), end: text.indexOf("Jan") + 12, kind: "PERSON" as const, value: "Jan Kowalski" }] }
    );
    const service = new LocalPrivateDocumentService(
      new CompleteDocumentIngestor({ async extract() { return { bytes: 1, pages: [] }; } }),
      recognizer,
      24_000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      morphology,
      undefined,
      undefined,
      undefined,
      async () => {
        events.push("stop");
        ready = false;
      },
      async () => {
        events.push("start");
        ready = true;
      }
    );
    const text = "Umowę podpisał Jan Kowalski.";
    const read = await service.review(Buffer.from(text), "text/plain", { caseId: "case-1", localAi: true, detect: false });
    expect(read.suggestions).toEqual([]);
    expect(events).toEqual([]);
    const detected = await service.detect(read.documentId, { caseId: "case-1", localAi: true });
    expect(events).toEqual(["start"]);
    expect(detected.suggestions.map((item) => text.slice(item.start, item.end))).toEqual(["Jan Kowalski"]);
  });

  it("a retry after a dropped connection joins the running check (one model run)", async () => {
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const recognizer = new LocalLlmPrivacyNamedEntityRecognizer(
      { stream: async () => ({ fullText: "[]" }) } as never,
      { configuredModelId: () => "local/bielik", status: () => ({ configured: true, state: "READY" }) } as never,
      { recognize: async () => [] }
    );
    const service = new LocalPrivateDocumentService(
      new CompleteDocumentIngestor({ async extract() { return { bytes: 1, pages: [] }; } }),
      recognizer,
      24_000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      morphology,
      undefined,
      undefined,
      undefined,
      async () => undefined,
      async () => {
        starts += 1;
        await gate;
      }
    );
    const read = await service.review(Buffer.from("Umowa z dnia 1 marca."), "text/plain", { caseId: "case-1", localAi: true, detect: false });
    const first = service.detect(read.documentId, { caseId: "case-1", localAi: true });
    const retry = service.detect(read.documentId, { caseId: "case-1", localAi: true });
    release();
    const [a, b] = await Promise.all([first, retry]);
    expect(starts).toBe(1);
    expect(b).toBe(a);
    // Finished: a later request runs again (nothing stale is kept).
    await service.detect(read.documentId, { caseId: "case-1", localAi: true });
    expect(starts).toBe(2);
  });
});
