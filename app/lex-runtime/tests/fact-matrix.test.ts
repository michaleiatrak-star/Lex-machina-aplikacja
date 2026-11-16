import { describe, expect, it } from "vitest";
import { factDescriptionRequest, factMatrixGoals, factMatrixPrompt, factMatrixRequired, factRows, verifiedFacts } from "../src/fact-matrix.js";

const M = "VII P 94/25, 17 marca 2026";
const N = "XI P 27/26, 13 listopada 2026";
const s = (documentId: string, heading: string, text: string) => ({ documentId, chunkIndex: 0, heading, text });
const statements = [
  s("m", M, "Po rozwiązaniu umowy powód kontaktował się ze mną smsowo wysyłał mi wiadomości, w których straszył mnie przepisami karnymi."),
  s("m", M, "Trwało to może 3 miesiące."),
  s("n", N, "Wysyłał na Whatsapp że mamy jako świadkowie mówić prawdę."),
  s("n", N, "Dostawałem je raz na miesiąc.")
];
// What the model returns: one invented quote among them.
const reply = JSON.stringify([
  { temat: "wiadomości od powoda", cecha: "okres", wartosc: "około 3 miesiące", protokol: M, cytat: "Trwało to może 3 miesiące" },
  { temat: "wiadomości od powoda", cecha: "okres", wartosc: "ponad rok, co miesiąc", protokol: N, cytat: "Dostawałem je raz na miesiąc" },
  { temat: "wiadomości od powoda", cecha: "kanał", wartosc: "SMS", protokol: M, cytat: "kontaktował się ze mną smsowo" },
  { temat: "wiadomości od powoda", cecha: "kanał", wartosc: "WhatsApp", protokol: N, cytat: "Wysyłał na Whatsapp że" },
  { temat: "wiadomości od powoda", cecha: "treść", wartosc: "groźby karne", protokol: M, cytat: "straszył mnie przepisami karnymi" },
  { temat: "wiadomości od powoda", cecha: "treść", wartosc: "mówić prawdę", protokol: N, cytat: "mamy jako świadkowie mówić prawdę" },
  { temat: "wiadomości od powoda", cecha: "treść", wartosc: "obelgi", protokol: N, cytat: "powód mnie obrażał codziennie" }
]);

describe("the fact matrix from the model's description of the facts (quotes checked in the record)", () => {
  it("the request carries every statement by record and asks for verbatim quotes", () => {
    const ask = factDescriptionRequest("Kast", statements);
    expect(ask.user).toContain(`## ${M}`);
    expect(ask.user).toContain("- Trwało to może 3 miesiące.");
    expect(ask.system).toContain("DOSŁOWNY");
  });

  it("an invented quote is dropped; topic × attribute rows with RÓŻNE where the records differ", () => {
    const { facts, dropped } = verifiedFacts(`Oto fakty:\n${reply}`, statements);
    expect(dropped).toBe(1);
    expect(facts).toHaveLength(6);
    const rows = factRows(facts);
    expect(rows.map((row) => `${row.attribute}:${row.differs}`)).toEqual(expect.arrayContaining(["okres:true", "kanał:true", "treść:true"]));
    const prompt = factMatrixPrompt("Kast", rows, dropped);
    expect(prompt).toContain("## wiadomości od powoda");
    expect(prompt).toContain("okres · RÓŻNE");
    expect(prompt).toContain("odrzucono 1");
    expect(prompt).not.toContain("obrażał");
    expect(factMatrixGoals("Kast", rows)).toEqual(["Wykazać sprzeczność lub zmianę wersji zeznań świadka Kast: wiadomości od powoda (okres, kanał, treść)"]);
    expect(factMatrixRequired(rows).length).toBe(6);
  });

  it("no JSON: nothing (the word-matching matrix takes over)", () => {
    expect(verifiedFacts("nie umiem", statements).facts).toEqual([]);
  });
});
