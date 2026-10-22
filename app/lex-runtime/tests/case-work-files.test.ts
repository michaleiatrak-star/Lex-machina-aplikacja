import { describe, expect, it } from "vitest";
import { caseWorkLine, recordCaseWork, validCaseWork } from "../src/case-work.js";

describe("generated files in the case's work register", () => {
  it("records each file once, valid for the store", () => {
    const now = "2026-10-22T12:00:00.000Z";
    const first = recordCaseWork([], { now, files: [{ artifactId: "artifact_1", filename: "Analiza-286-KK.docx" }] });
    const again = recordCaseWork(first, { now, files: [{ artifactId: "artifact_1", filename: "Analiza-286-KK.docx" }] });
    expect(again).toHaveLength(1);
    expect(validCaseWork(again)).toEqual(again);
    expect(caseWorkLine(again[0]!)).toBe("ZAMKNIĘTE: plik „Analiza-286-KK.docx”, 2026-10-22");
  });
});
