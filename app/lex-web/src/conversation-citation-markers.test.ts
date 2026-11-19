import { describe, expect, it } from "vitest";
import { conversationForProvider, modelCitationMarkers } from "./conversation-context.js";
import type { CaseChatMessage } from "./case-thread.js";

const citation = (citationId: string, documentId: string, chunkIndex: number) => ({
  citationId,
  marker: `[[LEXDOCREF:${citationId}]]`,
  label: "protokół",
  documentId,
  chunkIndex,
  pageStart: 1,
  pageEnd: 1,
  contextText: ""
});

describe("an earlier answer goes back to the model with its own case-file markers (live test 2026-11-19)", () => {
  it("a chip becomes the marker it came from; a chip without a record is dropped", () => {
    const item = {
      content: "Świadek zeznał „Nie słyszałem” [[LEXDOCREF:docref_1]] i „zarządzenie” [[LEXDOCREF:docref_9]].",
      documentCitations: [citation("docref_1", "doc_a", 4)]
    };
    expect(modelCitationMarkers(item)).toBe("Świadek zeznał „Nie słyszałem” [[LEXDOC:doc_a:4]] i „zarządzenie”.");
  });

  it("the conversation sent with the next step carries no chips", () => {
    const messages = [
      { role: "assistant", content: "Pismo [[LEXDOCREF:docref_1]]", documentCitations: [citation("docref_1", "doc_b", 0)] }
    ] as unknown as CaseChatMessage[];
    const sent = conversationForProvider(messages, "Kontynuuj.", 10_000);
    expect(sent).not.toContain("LEXDOCREF");
    expect(sent).toContain("[[LEXDOC:doc_b:0]]");
  });
});
