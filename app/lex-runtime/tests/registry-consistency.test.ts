import { describe, expect, it } from "vitest";
import { RegistryEnrichment, registryConsistencyText } from "../src/privacy/registry-enrichment.js";

// The comparycja of the contract test 2026-11-07: both KRS numbers belong to other firms in
// the register and both NIPs have a wrong check digit (found by the chat, missed by the app).
const contract = [
  "ALFA LOGISTYKA spółka z ograniczoną odpowiedzialnością z siedzibą w Gdyni, ul. Portowa 12, 81-001 Gdynia, wpisaną do rejestru przedsiębiorców KRS pod numerem 0000999001, NIP 5860000001, reprezentowaną przez Prezesa Zarządu,",
  "",
  "a",
  "",
  "BETA SOFTWARE spółka z ograniczoną odpowiedzialnością z siedzibą w Krakowie, ul. Kodowa 5, 30-001 Kraków, wpisaną do rejestru przedsiębiorców KRS pod numerem 0000999002, NIP 6760000002,"
].join("\n");

function krsReply(name: string, seat: string, nip: string, krs: string) {
  return { status: "FOUND", result: { identyfikator: `KRS ${krs}`, tytul_lub_nazwa: name, siedziba: seat, nip, forma_prawna: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", status_rejestru: "wpisany" } };
}

describe("party data checked against the register", () => {
  it("names the wrong check digit and every mismatch of name, seat and NIP", async () => {
    const registry = new RegistryEnrichment(async ({ tool, arguments: args }) => {
      if (tool === "krs_lookup" && args.numerKrs === "0000999001") return { ok: true, result: krsReply("SAPPHIRE ENTERPRISES SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", "WIELICZKA", "6832124891", "0000999001") };
      return { ok: true, result: { status: "NOT_FOUND" } };
    });
    await registry.forms("KRS 0000999001");
    const text = registryConsistencyText(contract, registry.facts(["0000999001"]));
    expect(text).toContain("NIP 5860000001: błędna cyfra kontrolna (wyliczona 2, w numerze 1)");
    expect(text).toContain("NIP 6760000002: błędna cyfra kontrolna (wyliczona 3, w numerze 2)");
    expect(text).toMatch(/KRS 0000999001: NIEZGODNE z dokumentem: nazwa w KRS: „SAPPHIRE ENTERPRISES.*siedziba w KRS: Wieliczka.*NIP w KRS: 6832124891 — dokument podaje 5860000001/u);
  });

  it("a party that agrees with its extract is reported as agreeing", async () => {
    const registry = new RegistryEnrichment(async ({ tool }) =>
      tool === "krs_lookup" ? { ok: true, result: krsReply("ALFA LOGISTYKA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", "GDYNIA", "5860000001", "0000999001") } : { ok: true, result: { status: "NOT_FOUND" } }
    );
    await registry.forms("KRS 0000999001");
    const text = registryConsistencyText(contract.split("\n")[0]!.replace("NIP 5860000001", ""), registry.facts(["0000999001"]));
    expect(text).toContain("KRS 0000999001: zgodne z dokumentem (nazwa, siedziba)");
  });
});
