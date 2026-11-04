import { describe, expect, it } from "vitest";
import { ocrAccelHeadline, ocrRunSummary } from "./LocalAiSetupPanel.js";

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

describe("OCR: procesor czy karta — zdanie dla użytkownika", () => {
  const base = { active: false, installed: false, benchmark: null, state: "IDLE" as const, auto: true, provider: "dml" as const };
  it("przed pomiarem, w trakcie, karta wybrana, procesor wybrany", () => {
    expect(ocrAccelHeadline(base)).toMatch(/sama, jednorazowo sprawdzi/u);
    expect(ocrAccelHeadline({ ...base, state: "MEASURING" })).toMatch(/Trwa jednorazowe/u);
    expect(ocrAccelHeadline({ ...base, installed: true, active: true })).toMatch(/z karty graficznej/u);
    const bench = { cpuSeconds: 10, accelSeconds: 12, lines: 10, sameLines: 10, accepted: false, reason: "NOT_FASTER" as const };
    expect(ocrAccelHeadline({ ...base, installed: true, benchmark: bench })).toMatch(/procesor jest szybszy|szybszy od karty/u);
  });
});

describe("ostatni OCR: cały dokument", () => {
  it("2 procesy naraz: czas dokumentu na stronę, czas procesu osobno", () => {
    expect(
      ocrRunSummary({ at: "", loadSeconds: 3.1, pageSeconds: Array(54).fill(3.1), threads: 14, mkldnn: true, accel: "DmlExecutionProvider", workers: 2, pages: 54, wallSeconds: 88.4 })
    ).toBe("Ostatni OCR: 54 str. w 88,4 s, 1,6 s/str. dokumentu (2 procesy naraz, w każdym 3,1 s/str.) (wczytanie modeli 3,1 s), karta (Dml), 14 wątków.");
  });
});
