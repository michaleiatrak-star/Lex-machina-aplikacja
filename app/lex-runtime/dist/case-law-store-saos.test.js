import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CaseLawRepository, inLibrary } from "./case-law-store.js";
describe("baza orzeczeń (RAG): bez kopii SAOS", () => {
    it("orzeczenie z SAOS trafia do akt sprawy, nie do biblioteki; oficjalne trafia do obu", () => {
        const repository = new CaseLawRepository(fs.mkdtempSync(path.join(os.tmpdir(), "lex-rag-")));
        repository.setLibraryEnabled(true);
        const caseId = "c1";
        repository.put({ cardUrl: "https://www.saos.org.pl/judgments/1", signature: "I ACa 1/20", text: "treść orzeczenia ".repeat(5) }, caseId);
        repository.put({ cardUrl: "https://orzeczenia.nsa.gov.pl/doc/ABC", signature: "II FSK 1/20", text: "treść orzeczenia ".repeat(5) }, caseId);
        expect(repository.catalog().map((item) => item.cardUrl)).toEqual(["https://orzeczenia.nsa.gov.pl/doc/ABC"]);
        expect(repository.get("https://www.saos.org.pl/judgments/1")).toBeNull();
        expect(inLibrary("https://orzeczenia.ms.gov.pl/details/x")).toBe(true);
    });
});
