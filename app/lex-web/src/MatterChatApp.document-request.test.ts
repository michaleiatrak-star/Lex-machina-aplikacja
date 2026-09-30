import { describe, expect, it } from "vitest";
import { directDocumentRequest } from "./MatterChatApp.js";

describe("rozpoznanie prośby o plik pisma", () => {
  it("doc, docx, Word i „plik” z czasownikiem to generowanie .docx", () => {
    for (const text of [
      "Wygeneruj plik doc z napisem ok",
      "wygeneruj plik docx z napisem ok",
      "Przygotuj to w Wordzie",
      "daj plik z tym pismem",
      "ok wygeneruj to w pliku docx"
    ]) {
      expect(directDocumentRequest(text)?.format).toBe("docx");
    }
    expect(directDocumentRequest("zapisz jako odt")?.format).toBe("odt");
  });

  it("zwykłe pytanie nie uruchamia generowania pliku", () => {
    expect(directDocumentRequest("Jaki jest termin przedawnienia?")).toBeNull();
    expect(directDocumentRequest("co jest w tym pliku?")).toBeNull();
  });
});
