import { describe, expect, it } from "vitest";
import { firmKnowledgeDocumentIds, firmKnowledgeItems, parseFirmKnowledgeSelection } from "../src/firm-knowledge-scope.js";

const f = (n: string) => `folder_${n.repeat(32)}`;
const u = (n: string) => `upload_${n.repeat(32)}`;

// Know-how kancelarii w rozmowie: nie cała baza — wybrane pliki i foldery oraz foldery domyślne.
const index = {
  folders: [
    { folderId: f("a"), parentId: null, name: "Umowy", createdAt: "", chatDefault: true },
    { folderId: f("b"), parentId: f("a"), name: "Najem", createdAt: "" },
    { folderId: f("c"), parentId: null, name: "Procesowe", createdAt: "" },
    { folderId: f("d"), parentId: null, name: "Archiwum", createdAt: "" }
  ],
  itemLocations: { [u("1")]: f("b"), [u("2")]: f("c"), [u("3")]: f("d"), [u("4")]: null }
};

describe("zakres know-how kancelarii", () => {
  it("bez wyboru: tylko folder domyślny z podfolderami", () => {
    expect([...firmKnowledgeItems(index, { folderIds: [], itemIds: [] })]).toEqual([u("1")]);
  });

  it("wybrany folder i plik dochodzą; reszta bazy nie", () => {
    const items = firmKnowledgeItems(index, { folderIds: [f("c")], itemIds: [u("4")] });
    expect([...items].sort()).toEqual([u("1"), u("2"), u("4")].sort());
    expect(items.has(u("3"))).toBe(false);
  });

  it("dokumenty z sum SHA-256 wybranych plików", () => {
    const sha = "ab".repeat(32);
    expect([...firmKnowledgeDocumentIds(new Set([u("1")]), [{ uploadId: u("1"), sha256: sha }, { uploadId: u("3"), sha256: "cd".repeat(32) }])]).toEqual([
      `doc_${sha.slice(0, 24)}`
    ]);
  });

  it("odrzuca błędne identyfikatory", () => {
    expect(parseFirmKnowledgeSelection({ folderIds: ["x"] })).toBeNull();
    expect(parseFirmKnowledgeSelection(undefined)).toEqual({ folderIds: [], itemIds: [] });
  });
});
