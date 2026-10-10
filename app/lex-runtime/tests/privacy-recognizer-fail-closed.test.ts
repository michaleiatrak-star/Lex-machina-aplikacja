import { describe, expect, it, vi } from "vitest";
import { CompositeRecognizer } from "../src/privacy/gazetteer-ner.js";
import { mayContainPersonalNames } from "../src/privacy/name-candidates.js";
import { LocalLlmPrivacyNamedEntityRecognizer } from "../src/privacy/local-llm-ner.js";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";
import type { LocalModelRuntime } from "../src/local-model-runtime.js";
import type { ProviderGateway } from "../src/providers/gateway.js";

const failing = { recognize: vi.fn(async () => { throw new Error("GAZETTEER_TIMEOUT"); }) };
const text = "Anna Nowak podpisała dokument.";
const nowak = { start: 0, end: 10, kind: "PERSON" as const, value: "Anna Nowak" };

describe("rozpoznawanie osób: awaria blokuje wysyłkę (fail closed)", () => {
  it("CompositeRecognizer rzuca błąd, gdy padną wszystkie detektory", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(new CompositeRecognizer([failing, failing]).recognize(text)).rejects.toThrow(
      "PRIVACY_RECOGNIZER_UNAVAILABLE"
    );
    stderr.mockRestore();
  });

  it("CompositeRecognizer zwraca wyniki działającego detektora, gdy padnie tylko jeden", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const working = { recognize: vi.fn(async () => [nowak]) };
    await expect(new CompositeRecognizer([failing, working]).recognize(text)).resolves.toEqual([nowak]);
    stderr.mockRestore();
  });

  it("lokalny rozpoznawacz nie przepuszcza tekstu, gdy padnie słownik/Stanza", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const recognizer = new LocalLlmPrivacyNamedEntityRecognizer(
      { stream: vi.fn() } as unknown as ProviderGateway,
      { configuredModelId: () => undefined, status: () => ({ configured: false }) } as unknown as LocalModelRuntime,
      new CompositeRecognizer([failing])
    );
    await expect(recognizer.recognize(text)).rejects.toThrow("PRIVACY_RECOGNIZER_UNAVAILABLE");
    await expect(
      new LocalPolishPseudonymizer(new PseudonymizationVault(), recognizer).pseudonymize(text)
    ).rejects.toThrow("PRIVACY_RECOGNIZER_UNAVAILABLE");
    stderr.mockRestore();
  });
});

describe("awaria detektorów a tekst bez nazwisk i adresów", () => {
  it("pytanie bez kandydatów na nazwisko przechodzi (identyfikatory nadal maskowane)", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const query = "wyszukaj wyroku dotyczącego grupy przestępczej na stronach Sądu Najwyższego i podaj mi zweryfikowany wyrok";
    await expect(new CompositeRecognizer([failing, failing]).recognize(query)).resolves.toEqual([]);
    stderr.mockRestore();
  });

  it("przyczyna awarii jest w komunikacie błędu", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(new CompositeRecognizer([failing]).recognize(text)).rejects.toThrow("PRIVACY_RECOGNIZER_UNAVAILABLE:GAZETTEER_TIMEOUT");
    stderr.mockRestore();
  });

  it.each([
    ["Wczoraj przyszedł Sadowski i zabrał rower.", true],
    ["POWÓD: JAN NOWAK", true],
    ["Mieszkam przy ul. Lipowej 5 w Krakowie.", true],
    ["Dostałem pismo z ZUS i z Urzędu Skarbowego w sprawie VAT.", false],
    ["Czy Trybunał Konstytucyjny może uchylić ustawę w styczniu?", false]
  ])("%s -> kandydat %s", (value, expected) => {
    expect(mayContainPersonalNames(value)).toBe(expected);
  });
});
