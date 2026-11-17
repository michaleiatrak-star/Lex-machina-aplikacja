import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RegisterLine } from "./document-coverage-view.js";
import { readableDataSymbols } from "./DocumentEditor.js";
import { letterDocumentPlan } from "./MatterChatApp.js";

describe("0.1.100 in the interface", () => {
  it("shows the register D01..DN with what is read and what is left", () => {
    const html = renderToStaticMarkup(
      <RegisterLine
        entries={[
          { id: "D01", documentId: "doc_a", label: "protokół 13.11.2026", kind: "PROTOKOL", state: "READ", parts: 1, facts: 22 },
          { id: "D02", documentId: "doc_b", label: "zaświadczenie", kind: "ZASWIADCZENIE", state: "GAP", parts: 1, facts: 0, reasons: ["część 1 bez odpowiedzi"] }
        ]}
      />
    );
    expect(html).toContain("przeczytane 1 z 2");
    expect(html).toContain("D01 protokół 13.11.2026 — przeczytany (22 faktów)");
    expect(html).toContain("D02 zaświadczenie — do dokończenia (część 1 bez odpowiedzi)");
  });

  it("the preview names a personal-data symbol instead of showing it raw", () => {
    expect(readableDataSymbols("Powód: [LMPII:D00:PERSON:0001|NOM]")).toBe("Powód: [osoba 1 — dane po „Deanonimizuj”]");
  });

  it("STOP 2 in AUTO: the draft's file is made although a later W2 step wrote the last version", () => {
    const result = {
      status: "DRAFT_PRESENTABLE",
      answer: "pismo",
      verification: { unverified: 0 },
      processAuto: { stopped: "STAGE_STOP" },
      processWorkflow: { stage: "W3", documentStatus: "DRAFT", checkpoints: { "CP-ATAK": "CLOSED", "CP-QUALITY": "OPEN" }, draftWritten: { version: 2, checkpoint: "CP-PODMIOT" } }
    };
    expect(letterDocumentPlan(result as never)).toEqual({ documentType: "pleading", stage: "DRAFT" });
  });
});
