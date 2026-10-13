import {
  describe,
  expect,
  it
} from "vitest";
import {
  MAX_DOCUMENT_DROP_QUEUE,
  consumeDocumentDropFile,
  createDocumentDropQueueState,
  describeDocumentFile,
  documentDropSummary,
  documentStepLabel,
  enqueueDocumentDropFiles
} from "./document-drop-queue.js";

function file(
  name: string,
  size = 1024,
  type = ""
): File {
  return {
    name,
    size,
    type,
    lastModified: 1
  } as File;
}

describe("document drop queue", () => {
  it("processes multiple files sequentially and resets the next completed batch", () => {
    let state =
      enqueueDocumentDropFiles(
        createDocumentDropQueueState(),
        [
          file("a.pdf", 2048, "application/pdf"),
          file("b.docx", 4096)
        ]
      );

    expect(state.files.map((item) => item.name))
      .toEqual(["a.pdf", "b.docx"]);
    expect(state.total).toBe(2);
    expect(state.completed).toBe(0);

    state =
      consumeDocumentDropFile(state);
    expect(state.files.map((item) => item.name))
      .toEqual(["b.docx"]);
    expect(state.completed).toBe(1);

    state =
      consumeDocumentDropFile(state);
    expect(state.files).toEqual([]);
    expect(state.completed).toBe(2);

    state =
      enqueueDocumentDropFiles(
        state,
        [file("next.txt", 10, "text/plain")]
      );
    expect(state.total).toBe(1);
    expect(state.completed).toBe(0);
    expect(state.files[0]?.name)
      .toBe("next.txt");
  });

  it("caps pending files and reports empty or over-limit entries as rejected", () => {
    const input =
      Array.from(
        {
          length:
            MAX_DOCUMENT_DROP_QUEUE + 2
        },
        (_, index) =>
          file(
            `file-${index}.pdf`,
            index === 0
              ? 0
              : 512,
            "application/pdf"
          )
      );

    const state =
      enqueueDocumentDropFiles(
        createDocumentDropQueueState(),
        input
      );

    expect(state.files).toHaveLength(
      MAX_DOCUMENT_DROP_QUEUE
    );
    expect(state.rejected).toBe(2);
  });

  it("exposes per-file size and type metadata", () => {
    expect(
      describeDocumentFile(
        file(
          "opinia.pdf",
          2 * 1024 * 1024,
          "application/pdf"
        )
      )
    ).toBe(
      "2.0 MB · application/pdf"
    );
    expect(
      describeDocumentFile(
        file(
          "notatka.md",
          512
        )
      )
    ).toBe(
      "512 B · .md"
    );
  });

  it("keeps outcomes apart: a skipped file is not ready (0 gotowych, 1 pominięty)", () => {
    const txt = new File(["Anna Testowa zamówiła usługę."], "DEMO-audyt.txt", { type: "text/plain" });
    let state = enqueueDocumentDropFiles(createDocumentDropQueueState(), [txt]);
    expect(documentDropSummary(state)).toBe("plik 1 z 1");
    state = consumeDocumentDropFile(state, "SKIPPED");
    expect(state).toMatchObject({ ready: 0, skipped: 1, stored: 0, completed: 1, files: [] });
    expect(documentDropSummary(state)).toBe("1 plik w kolejce · 1 pominięty");
    expect(documentDropSummary(state)).not.toMatch(/gotow|zakończono/u);
  });

  it("names the step by file kind: OCR only where a scan can need it", () => {
    expect(documentStepLabel(new File(["x"], "a.txt", { type: "text/plain" }))).toBe("Odczytaj i ukryj dane osobowe");
    expect(documentStepLabel(new File(["x"], "a.docx", { type: "" }))).toBe("Odczytaj i ukryj dane osobowe");
    expect(documentStepLabel(new File(["x"], "skan.jpg", { type: "image/jpeg" }))).toMatch(/OCR/u);
    expect(documentStepLabel(new File(["x"], "pozew.pdf", { type: "application/pdf" }))).toMatch(/OCR tylko dla skanowanych/u);
  });
});
