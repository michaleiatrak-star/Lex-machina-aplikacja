import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

// pisma-procesowe-v3 KROK 0 Test A (MOD-REDAKCJA: "wklejona, plik, .docx"): a pleading the user
// attaches as a file and asks to correct is a redaction, like a pasted one. Before, the HTTP
// layer asked only about pasted text and sent the attached pleading to the W1–W3 pipeline (409).

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const executor = new SafeSessionExecutor(registry, new ProviderGateway(new ProviderRegistry()));
const PLEADING =
  "POZEW O ZAPŁATĘ\nSąd Rejonowy w Krakowie\nPowód: Jan Kowalski\nPozwany: ABC sp. z o.o.\n" +
  "Wnoszę o zasądzenie kwoty 10 000 zł wraz z odsetkami. Uzasadnienie: pozwany nie zapłacił faktury nr 1/2026. Dowód: faktura.";
const attached = [{ chunks: [{ text: PLEADING }] }];

describe("pleading redaction with an attached file", () => {
  it("\"popraw ten pozew\" with the pleading attached is Test A", () => {
    expect(executor.pleadingRedactionFor("Popraw ten pozew, żeby był bardziej stanowczy.", attached)).toBe(true);
    expect(executor.pleadingRedactionFor("Skróć to pismo i wygładź styl.", attached)).toBe(true);
  });

  it("the attached pleading decides when the message does not name it", () => {
    const message = "Popraw styl i skróć uzasadnienie.";
    expect(executor.pleadingRedactionFor(message, [])).toBe(false);
    expect(executor.pleadingRedactionFor(message, attached)).toBe(true);
  });

  it("a new pleading or new substance is not Test A, with or without a file", () => {
    expect(executor.pleadingRedactionFor("Napisz pozew o zapłatę 30 000 zł.", attached)).toBe(false);
    expect(executor.pleadingRedactionFor("Dodaj do tego pozwu nowe zarzuty i orzecznictwo.", attached)).toBe(false);
  });

  it("a firm template attached is not the user's pleading", () => {
    expect(executor.pleadingRedactionFor("Popraw ten pozew.", [{ chunks: [{ text: PLEADING }], sourceScope: "FIRM_TEMPLATE" }])).toBe(
      executor.pleadingRedactionFor("Popraw ten pozew.", [])
    );
  });
});
