import { describe, expect, it } from "vitest";
import { ocrRunSummary } from "./LocalAiSetupPanel.js";

describe("statystyka ostatniego OCR", () => {
  it("średnio na stronę, wczytanie modeli, silnik", () => {
    expect(ocrRunSummary({ at: "", loadSeconds: 6.1, pageSeconds: [20, 25], threads: 28, mkldnn: true, accel: null, workers: 1 })).toBe(
      "Ostatni OCR: 2 str., 22,5 s/str. (wczytanie modeli 6,1 s), procesor z oneDNN, 28 wątków."
    );
    expect(ocrRunSummary({ at: "", loadSeconds: 3, pageSeconds: [2], threads: 8, mkldnn: false, accel: "DmlExecutionProvider", workers: 2 })).toBe(
      "Ostatni OCR: 1 str., 2 s/str. (wczytanie modeli 3 s), karta (Dml), 8 wątków, 2 procesy."
    );
  });
});
