import { describe, expect, it } from "vitest";
import { caseFileListing } from "./case-file-listing.js";

const file = (filename: string, storedAt: string, mediaType = "application/pdf") => ({ filename, storedAt, mediaType, archive: false });
const files = [file("Protokół 17.03.pdf", "2026-11-02"), file("Zdjęcie.jpg", "2026-11-03", "image/jpeg"), file("pozew.pdf", "2026-11-01"), file("Protokol 13.11.pdf", "2026-11-04")];

describe("the side panel's case file list", () => {
  it("search ignores case and Polish marks, every word must match", () => {
    expect(caseFileListing(files, "protokol", "name").map((item) => item.filename)).toEqual(["Protokol 13.11.pdf", "Protokół 17.03.pdf"]);
    expect(caseFileListing(files, "PROTOKÓŁ 17", "name").map((item) => item.filename)).toEqual(["Protokół 17.03.pdf"]);
  });
  it("orders by date added either way", () => {
    expect(caseFileListing(files, "", "newest")[0]!.filename).toBe("Protokol 13.11.pdf");
    expect(caseFileListing(files, "", "oldest")[0]!.filename).toBe("pozew.pdf");
  });
  it("by kind keeps the file types apart", () => {
    const kinds = caseFileListing(files, "", "kind").map((item) => item.mediaType);
    expect(kinds.indexOf("image/jpeg")).not.toBe(1);
    expect(kinds.filter((kind, index) => index > 0 && kind !== kinds[index - 1]).length).toBe(1);
  });
});
