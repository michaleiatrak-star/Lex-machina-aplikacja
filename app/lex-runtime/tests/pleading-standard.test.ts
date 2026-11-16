import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { argumentSchemaGaps, isCourtPleading, pleadingStandardPrompt, schemaCorrection } from "../src/pleading-standard.js";

describe("a pleading to a court is built as pisma-procesowe-v3 prescribes (XI P 27/26)", () => {
  it("recognises the request for a pleading, not for an opinion", () => {
    expect(isCourtPleading("Przygotuj pismo procesowe powoda do sprawy XI P 27/26, w którym wykażę sprzeczności świadka")).toBe(true);
    expect(isCourtPleading("Przygotuj podważenie postanowienia zastępcy rzecznika dyscyplinarnego")).toBe(true);
    expect(isCourtPleading("Napisz apelację od wyroku")).toBe(true);
    expect(isCourtPleading("Czy świadek jest wiarygodny?")).toBe(false);
    expect(isCourtPleading("Streść protokół rozprawy")).toBe(false);
  });

  it("the application's XI P 27/26 draft lacks anticipation and the fallback; the chat's draft has all elements", () => {
    const app = "### UZASADNIENIE\n**I. Przebieg zatrudnienia**\n„Powód był zatrudniony na początku jako informatyk” [[LEXDOC:d:0]]\n**VI. Wnioski**\nwnoszę jak na wstępie";
    expect(argumentSchemaGaps(app).map((gap) => gap.element)).toEqual(["ANTYCYPACJA", "ZAMKNIĘCIE FURTKI"]);
    const chat = "Wnoszę o:\n### UZASADNIENIE\n**I. Tożsamość**\n„tekst protokołu z cytatem świadka” \n**III. Antycypacja**\nPozwany może podnieść, że rozbieżności wynikają z czasu. Argument ten jest chybiony.\n**IV. Zamknięcie furtki**\nNawet gdyby Sąd uznał inaczej, to…";
    expect(argumentSchemaGaps(chat)).toEqual([]);
    expect(schemaCorrection(argumentSchemaGaps(app))).toContain("ANTYCYPACJA");
  });

  it("the standard comes with the module's own text", () => {
    const corpus = "/home/user/lex-machina/Wersja rozwojowa rozpakowana/pisma-procesowe-v3/modules/MOD-BUDOWA-ARGUMENTU.md";
    const text = fs.existsSync(corpus) ? fs.readFileSync(corpus, "utf8") : "[1] FAKT [5] ANTYCYPACJA ZARZUTU";
    const prompt = pleadingStandardPrompt(text);
    expect(prompt).toContain("fakty z akt z dosłownym źródłem");
    expect(prompt).toContain("ANTYCYPACJA");
  });
});

describe("a conclusion that depends on a fact still to fill in is not stated as certain", () => {
  it("is caught without variants and passes with them", () => {
    const certain = "### UZASADNIENIE\nWiadomość nosi datę ⬛ [UZUPEŁNIJ: data]. Jedno z tych zeznań jest nieprawdziwe.\n\nPozwany może podnieść… Nawet gdyby… wnoszę";
    expect(argumentSchemaGaps(certain).map((gap) => gap.element)).toContain("TEZA WARUNKOWA");
    const variants = "### UZASADNIENIE\nWariant A: jeżeli wiadomość ma datę ⬛ sprzed 17.03, jedno z zeznań jest nieprawdziwe.\n\nPozwany może podnieść… Nawet gdyby… wnoszę";
    expect(argumentSchemaGaps(variants).map((gap) => gap.element)).not.toContain("TEZA WARUNKOWA");
  });
});
