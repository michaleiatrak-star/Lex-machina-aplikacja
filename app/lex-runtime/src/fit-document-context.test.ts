import { describe, expect, it } from "vitest";
import { fitDocumentContext } from "./execution-engine.js";

describe("documents fit the model's window after the system prompt", () => {
  const context = Array.from({ length: 4_000 }, (_, i) => `Linia akt numer ${i + 1} z treścią dokumentu sprawy.`).join("\n");
  it("keeps the documents when they fit", () => {
    expect(fitDocumentContext(context, 10_000, 200_000)).toBe(context);
    expect(fitDocumentContext(context, 10_000, undefined)).toBe(context);
  });
  it("cuts at a line and names what was left out when the system prompt leaves less room", () => {
    // 200k-token window, 553k characters of system prompt (2026-11-13): about 3k tokens left for documents.
    const fitted = fitDocumentContext(context, 450_000, 200_000)!;
    expect(fitted.length).toBeLessThan(context.length);
    expect(fitted).toMatch(/pominięto \d+ znaków akt \(limit okna modelu: 200000 tokenów\)/u);
    expect(fitted.split("\n").slice(0, -1).every((line) => /^Linia akt numer \d+ z treścią dokumentu sprawy\.$/u.test(line))).toBe(true);
  });
  it("no room at all: the model is told to read the files with the tool", () => {
    expect(fitDocumentContext(context, 700_000, 200_000)).toMatch(/read_case_file/u);
  });
});
