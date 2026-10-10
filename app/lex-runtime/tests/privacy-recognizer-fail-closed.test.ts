import { describe, expect, it, vi } from "vitest";
import { CompositeRecognizer } from "../src/privacy/gazetteer-ner.js";
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
