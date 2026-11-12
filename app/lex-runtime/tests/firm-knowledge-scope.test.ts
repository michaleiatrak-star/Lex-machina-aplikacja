import { describe, expect, it } from "vitest";
import { firmDocumentPurposes, firmKnowledgeDocumentIds, firmKnowledgeItems, folderPurpose, parseFirmKnowledgeSelection } from "../src/firm-knowledge-scope.js";

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

describe("rodzaje folderów kancelarii (wzory, orzeczenia, zasady)", () => {
  const typed = {
    folders: [
      { folderId: f("a"), parentId: null, name: "Wzory", createdAt: "", purpose: "TEMPLATES" as const },
      { folderId: f("b"), parentId: null, name: "Orzeczenia", createdAt: "", purpose: "CASE_LAW" as const },
      { folderId: f("c"), parentId: f("b"), name: "NSA", createdAt: "" },
      { folderId: f("d"), parentId: null, name: "Zasady", createdAt: "", purpose: "RULES" as const },
      { folderId: f("e"), parentId: null, name: "Inne", createdAt: "" }
    ],
    itemLocations: { [u("1")]: f("a"), [u("2")]: f("c"), [u("3")]: f("d"), [u("4")]: f("e") }
  };

  it("podfolder dziedziczy rodzaj; folder bez rodzaju to wiedza ogólna", () => {
    expect(folderPurpose(typed, f("c"))).toBe("CASE_LAW");
    expect(folderPurpose(typed, f("e"))).toBeNull();
    expect(folderPurpose(typed, null)).toBeNull();
  });

  it("zasady trafiają do każdej rozmowy bez wyboru", () => {
    expect([...firmKnowledgeItems(typed, { folderIds: [], itemIds: [] })]).toEqual([u("3")]);
  });

  it("rodzaj każdego dokumentu po folderze", () => {
    const sha = (n: string) => n.repeat(64);
    const purposes = firmDocumentPurposes(typed, [
      { uploadId: u("1"), sha256: sha("1") },
      { uploadId: u("2"), sha256: sha("2") },
      { uploadId: u("3"), sha256: sha("3") },
      { uploadId: u("4"), sha256: sha("4") }
    ]);
    expect(Object.fromEntries(purposes)).toEqual({
      [`doc_${sha("1").slice(0, 24)}`]: "TEMPLATES",
      [`doc_${sha("2").slice(0, 24)}`]: "CASE_LAW",
      [`doc_${sha("3").slice(0, 24)}`]: "RULES"
    });
  });
});
