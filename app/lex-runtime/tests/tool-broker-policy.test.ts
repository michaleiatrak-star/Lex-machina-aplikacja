import { describe, expect, it } from "vitest";
import { discloseRegistryIdentifiers, personalDataIn } from "../src/tool-broker-policy.js";

const values: Record<string, string> = {
  "[PII:NIP:0001]": "5260250274",
  "[PII:KRS:0001]": "0000019193",
  "[PII:PESEL:0001]": "44051401359",
  "[PII:IBAN:0001]": "PL61109010140000071219812874"
};
const resolve = (token: string) => values[token] ?? null;

describe("broker narzędzi: identyfikatory do rejestrów", () => {
  it("odtwarza NIP i KRS kontrahenta tylko dla rejestru, który za nie odpowiada", () => {
    const krs = discloseRegistryIdentifiers(
      { id: "1", name: "search_federated_legal_sources", input: { source: "krs", query: "[PII:KRS:0001]" } },
      resolve
    );
    expect(krs.call.input.query).toBe("0000019193");
    expect(krs.disclosed).toEqual(["KRS"]);

    const wl = discloseRegistryIdentifiers(
      { id: "2", name: "call_federated_legal_source", input: { source: "wl", tool: "wl_sprawdz_rachunek", arguments: { nip: "[PII:NIP:0001]", rachunek: "[PII:IBAN:0001]" } } },
      resolve
    );
    expect(wl.call.input.arguments).toEqual({ nip: "5260250274", rachunek: "PL61109010140000071219812874" });
  });

  it("nie odtwarza PESEL ani niczego dla źródeł prawa", () => {
    const pesel = discloseRegistryIdentifiers(
      { id: "3", name: "search_federated_legal_sources", input: { source: "krs", query: "[PII:PESEL:0001]" } },
      resolve
    );
    expect(pesel.call.input.query).toBe("[PII:PESEL:0001]");
    expect(pesel.disclosed).toEqual([]);
    const saos = discloseRegistryIdentifiers(
      { id: "4", name: "search_federated_legal_sources", input: { source: "saos", query: "[PII:NIP:0001]" } },
      resolve
    );
    expect(saos.call.input.query).toBe("[PII:NIP:0001]");
  });
});

describe("broker narzędzi: jawne dane osobowe w argumentach", () => {
  it("wykrywa PESEL, e-mail i telefon, przepuszcza zwykłe zapytania prawne", () => {
    expect(personalDataIn({ query: "wyrok dla 44051401359" })).toEqual(["PESEL"]);
    expect(personalDataIn({ arguments: { fraza: "jan.kowalski@example.com tel. 600 100 200" } }).sort()).toEqual(["EMAIL", "PHONE"]);
    for (const query of ["art. 415 KC odpowiedzialność deliktowa", "III CZP 11/20", "Dz.U. 2024 poz. 1061", "43447/19", "NIP 5260250274"]) {
      expect(personalDataIn({ query })).toEqual([]);
    }
  });
});
