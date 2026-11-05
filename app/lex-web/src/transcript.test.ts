import { describe, expect, it } from "vitest";
import { isTranscript, parseTranscript, renameSpeaker, storedZip, transcriptDocx, transcriptDuration, transcriptPageText, transcriptSpeakers } from "./transcript.js";

const pages = [
  { page: 1, text: "[00:00] Osoba 1: Otwieram rozprawę.\n[00:04] Osoba 2: Dzień dobry, Wysoki Sądzie.\n[00:09] Osoba 1: Proszę o stawiennictwo." },
  { page: 2, text: "[10:02] Osoba 2: Uwaga: wnoszę o odroczenie." }
];

describe("transkrypcja nagrania: odczyt, edycja, zapis", () => {
  it("rozpoznaje transkrypcję i czyta czas, osobę i tekst każdej wypowiedzi", () => {
    expect(isTranscript(pages, "rozprawa.m4a")).toBe(true);
    expect(isTranscript([{ text: "Zwykły dokument." }], "pismo.pdf")).toBe(false);
    const parsed = parseTranscript(pages);
    expect(parsed[0]!.turns[1]).toEqual({ time: "[00:04]", seconds: 4, speaker: "Osoba 2", text: "Dzień dobry, Wysoki Sądzie." });
    expect(parsed[1]!.turns[0]).toMatchObject({ seconds: 602, speaker: "Osoba 2", text: "Uwaga: wnoszę o odroczenie." });
    expect(transcriptSpeakers(parsed)).toEqual(["Osoba 1", "Osoba 2"]);
    expect(transcriptDuration(parsed)).toBe("10:02");
  });

  it("bez rozmówców dwukropek w tekście nie jest osobą", () => {
    const parsed = parseTranscript([{ page: 1, text: "[00:00] Uwaga: początek.\n[00:05] Dalszy ciąg.\n[01:02:03] Koniec." }]);
    expect(parsed[0]!.turns.map((turn) => turn.speaker)).toEqual(["", "", ""]);
    expect(parsed[0]!.turns[0]!.text).toBe("Uwaga: początek.");
    expect(parsed[0]!.turns[2]!.seconds).toBe(3723);
  });

  it("zmiana nazwy osoby w całej transkrypcji i zapis w tej samej postaci linii", () => {
    const renamed = renameSpeaker(parseTranscript(pages), "Osoba 1", "Sędzia");
    expect(transcriptPageText(renamed[0]!.turns)).toBe("[00:00] Sędzia: Otwieram rozprawę.\n[00:04] Osoba 2: Dzień dobry, Wysoki Sądzie.\n[00:09] Sędzia: Proszę o stawiennictwo.");
    // Characters that would break the line form are dropped from a name.
    expect(transcriptSpeakers(renameSpeaker(renamed, "Osoba 2", "Pełnomocnik: powoda"))).toEqual(["Sędzia", "Pełnomocnik powoda"]);
    // A text edited across lines stays one line.
    expect(transcriptPageText([{ time: "[00:01]", seconds: 1, speaker: "", text: "a\nb" }])).toBe("[00:01] a b");
  });

  it("dokument Word: poprawny ZIP z częściami OOXML i treścią protokołu", () => {
    const bytes = transcriptDocx(renameSpeaker(parseTranscript(pages), "Osoba 1", "Sędzia"), { fileName: "rozprawa.m4a", madeAt: new Date("2026-11-05T10:00:00Z"), duration: "10:02" });
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    const text = new TextDecoder().decode(bytes);
    for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"]) expect(text).toContain(part);
    expect(text).toContain("Transkrypcja nagrania");
    expect(text).toContain("Sędzia");
    expect(text).toContain("Uwaga: wnoszę o odroczenie.");
    expect(text).toContain("Wysoki Sądzie");
    expect(storedZip([]).length).toBe(22);
  });
});
