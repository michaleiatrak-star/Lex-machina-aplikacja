import { describe, expect, it } from "vitest";
import { pdfFormError } from "./PdfFormPanel.js";

describe("formularz PDF: komunikaty", () => {
  it("nazwa pola z kodu błędu", () => {
    expect(pdfFormError("PDF_FORM_VALUE_INVALID:sad")).toBe("Niedozwolona wartość pola „sad”.");
    expect(pdfFormError("PDF_FORM_READ_ONLY:sygn")).toBe("Pole „sygn” jest tylko do odczytu.");
    expect(pdfFormError("PDF_FORM_ENCRYPTED")).toBe("Formularz jest chroniony hasłem.");
  });
});
