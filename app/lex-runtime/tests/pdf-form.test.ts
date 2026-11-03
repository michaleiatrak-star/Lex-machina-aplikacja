import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalPdfFormFiller, pdfFormValues } from "../src/pdf-form.js";

// Text, text with a length limit, checkbox, radio group (2 options), combo with Polish options.
const FORM = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "pdf-form.pdf"));
const python = process.env.LEX_STORAGE_PYTHON ?? "python3";
const pymupdf = spawnSync(python, ["-c", "import pymupdf"]).status === 0;
const filler = new LocalPdfFormFiller();

function pageText(pdf: Buffer): string {
  return spawnSync(python, ["-c", "import sys, pymupdf; d = pymupdf.open(stream=sys.stdin.buffer.read(), filetype='pdf'); print(len(list(d[0].widgets() or []))); print(d[0].get_text())"], {
    input: pdf
  }).stdout.toString("utf8");
}

describe("formularze PDF", () => {
  it("wartości od klienta: tylko tekst, prawda/fałsz i null", () => {
    expect(pdfFormValues({ a: "x", b: true, c: null, d: 5, e: { x: 1 } })).toEqual({ a: "x", b: true, c: null });
    expect(() => pdfFormValues(["a"])).toThrow("PDF_FORM_INVALID_REQUEST");
  });

  it.skipIf(!pymupdf)("odczyt pól, wypełnienie i ponowny odczyt; spłaszczenie z polskimi literami", async () => {
    const fields = await filler.fields(FORM);
    expect(fields.map((field) => [field.name, field.type])).toEqual([
      ["tryb", "radio"],
      ["imie_nazwisko", "text"],
      ["pesel", "text"],
      ["zgoda", "checkbox"],
      ["sad", "combo"]
    ]);
    expect(fields.find((field) => field.name === "tryb")!.options).toEqual(["zwykly", "pilny"]);
    expect(fields.find((field) => field.name === "pesel")!.maxLength).toBe(11);
    expect(fields.find((field) => field.name === "imie_nazwisko")!.label).toBe("Imię i nazwisko");

    const values = { imie_nazwisko: "Zażółć Gęślą", pesel: "00000000000", zgoda: true, sad: "Sąd Okręgowy", tryb: "pilny" };
    const filled = await filler.fill(FORM, values, false);
    const again = Object.fromEntries((await filler.fields(filled)).map((field) => [field.name, field.value]));
    expect(again).toEqual(values);

    const flat = await filler.fill(FORM, values, true);
    const text = pageText(flat);
    expect(text.split("\n")[0]).toBe("0");
    expect(text).toContain("Zażółć Gęślą");
    expect(text).toContain("Sąd Okręgowy");
  });

  it.skipIf(!pymupdf)("odrzuca nieznane pole, złą wartość wyboru, za długi tekst, zły typ pola wyboru", async () => {
    await expect(filler.fill(FORM, { brak: "x" }, false)).rejects.toThrow("PDF_FORM_UNKNOWN_FIELD:brak");
    await expect(filler.fill(FORM, { sad: "Sąd Najwyższy" }, false)).rejects.toThrow("PDF_FORM_VALUE_INVALID:sad");
    await expect(filler.fill(FORM, { pesel: "123456789012" }, false)).rejects.toThrow("PDF_FORM_VALUE_INVALID:pesel");
    await expect(filler.fill(FORM, { zgoda: "tak" }, false)).rejects.toThrow("PDF_FORM_VALUE_INVALID:zgoda");
    await expect(filler.fields(Buffer.from("%PDF-nie"))).rejects.toThrow("PDF_FORM_INVALID");
  });
});
