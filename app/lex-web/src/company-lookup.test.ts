import { describe, expect, it } from "vitest";
import { lookupCompanyByNip, normalizeNip } from "./company-lookup.js";

type Reply = Record<string, unknown>;

function fake(replies: Record<string, Reply | Error>) {
  const calls: string[] = [];
  const query = async (source: string, tool: string, args: Record<string, unknown>) => {
    calls.push(`${source}:${tool}:${String(args.nip)}`);
    const reply = replies[source];
    if (reply instanceof Error) throw reply;
    return { source, tool, ok: true, result: reply ?? { status: "NOT_FOUND" } };
  };
  return { calls, query };
}

const WL_FOUND = {
  status: "FOUND",
  result: {
    identyfikator: "NIP 5260250274",
    tytul_lub_nazwa: "MINISTERSTWO FINANSÓW",
    status_vat: "Czynny",
    adres: "ŚWIĘTOKRZYSKA 12, 00-916 WARSZAWA",
    rachunki: ["12345678901234567890123456"]
  },
  dowod_sprawdzenia: { requestId: "abc-123" }
};

describe("company lookup by NIP", () => {
  it("normalizes NIP and checks the control digit", () => {
    expect(normalizeNip("PL 526-025-02-74")).toBe("5260250274");
    expect(normalizeNip("5260250275")).toBeNull();
    expect(normalizeNip("123")).toBeNull();
  });

  it("fills name and address from the VAT white list without asking CEIDG", async () => {
    const { calls, query } = fake({ wl: WL_FOUND });
    const lookup = await lookupCompanyByNip("526-025-02-74", query);
    expect(lookup.party).toEqual({ name: "MINISTERSTWO FINANSÓW", nip: "5260250274", address: "ŚWIĘTOKRZYSKA 12, 00-916 WARSZAWA" });
    expect(lookup.accounts).toEqual(["12345678901234567890123456"]);
    expect(lookup.evidence).toBe("abc-123");
    expect(lookup.warnings).toEqual([]);
    expect(calls).toEqual(["wl:wl_sprawdz_nip:5260250274"]);
  });

  it("warns when the VAT status is not active", async () => {
    const { query } = fake({
      wl: { ...WL_FOUND, result: { ...WL_FOUND.result, status_vat: "Niezarejestrowany", data_wykreslenia: "2024-01-31" } }
    });
    const lookup = await lookupCompanyByNip("5260250274", query);
    expect(lookup.warnings[0]).toContain("Niezarejestrowany (wykreślony 2024-01-31)");
  });

  it("falls back to CEIDG for a sole trader outside the VAT list", async () => {
    const { calls, query } = fake({
      wl: { status: "NOT_FOUND" },
      ceidg: {
        status: "FOUND",
        result: {
          identyfikator: "5260250274",
          tytul_lub_nazwa: "Jan Kowalski Usługi",
          status_ceidg: "AKTYWNY",
          adres_dzialalnosci: "Prosta 5/2 00-001 Warszawa",
          id_ceidg: "ce-1"
        }
      }
    });
    const lookup = await lookupCompanyByNip("5260250274", query);
    expect(lookup.source).toBe("ceidg");
    expect(lookup.party.address).toBe("Prosta 5/2, 00-001 Warszawa");
    expect(calls).toHaveLength(2);
  });

  it("refuses a CEIDG record for another NIP", async () => {
    const { query } = fake({
      wl: { status: "NOT_FOUND" },
      ceidg: { status: "FOUND", result: { identyfikator: "1234563218", tytul_lub_nazwa: "X", adres_dzialalnosci: "Y" } }
    });
    await expect(lookupCompanyByNip("5260250274", query)).rejects.toThrow(/inny NIP/);
  });

  it("explains why nothing was filled", async () => {
    const { query } = fake({
      wl: new Error("UNKNOWN_MCP_SERVER"),
      ceidg: { status: "ERROR", detail: "Brak CEIDG_API_KEY w zmiennych środowiskowych" }
    });
    await expect(lookupCompanyByNip("5260250274", query)).rejects.toThrow(
      "Nie udało się pobrać danych (biała lista VAT: UNKNOWN_MCP_SERVER; CEIDG: brak klucza API (Ustawienia → Konektory MCP)). Wpisz dane ręcznie."
    );
    const none = fake({});
    await expect(lookupCompanyByNip("5260250274", none.query)).rejects.toThrow(/Nie znaleziono podmiotu/);
    await expect(lookupCompanyByNip("5260250275", none.query)).rejects.toThrow(/Nieprawidłowy NIP/);
    expect(none.calls).toHaveLength(2);
  });
});
