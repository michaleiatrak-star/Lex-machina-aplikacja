import { describe, expect, it } from "vitest";
import { LocalPolishPseudonymizer, PseudonymizationVault } from "../src/privacy/pseudonymizer.js";
import {
  addressForms,
  firmNameForms,
  RegistryEnrichment,
  registryKeys,
  titleCase,
  type RegistryCall
} from "../src/privacy/registry-enrichment.js";
import { placeholderGrammar } from "../src/privacy/token-legend.js";

// Replies in the shape of the wl_sprawdz_nip and krs_lookup connectors (audyt-systemu-v4 6.226).
const WL = {
  status: "FOUND",
  result: {
    identyfikator: "NIP 5261040828",
    tytul_lub_nazwa: "TRANSKOM SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    adres: "UL. JANA PAWŁA II 12/4, 25-001 KIELCE",
    osoby: [
      { rola: "reprezentant", imie: "ANNA", nazwisko: "WIŚNIEWSKA-KOWAL", nazwa_firmy: null, nip: null },
      { rola: "wspolnik", imie: null, nazwisko: null, nazwa_firmy: "BUDEX SPÓŁKA AKCYJNA", nip: "1234563218" }
    ]
  }
};
const KRS = { status: "FOUND", result: { tytul_lub_nazwa: "TRANSKOM SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", adres: "JANA PAWŁA II 12/4, 25-001 KIELCE" } };

function stub(replies: Record<string, unknown>, calls: string[] = []): RegistryCall {
  return async ({ source, arguments: args }) => {
    const id = String(args.nip ?? args.numerKrs);
    calls.push(`${source}:${id}`);
    return { ok: true, result: replies[`${source}:${id}`] ?? { status: "NOT_FOUND" } };
  };
}

describe("register forms", () => {
  it("firm name without the legal form, in the spellings of a pleading", () => {
    expect(firmNameForms("TRANSKOM SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ").map((form) => form.text)).toEqual(["TRANSKOM", "Transkom"]);
    expect(firmNameForms("TRANSKOM SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ")[0]!.organization).toEqual({ legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" });
    expect(firmNameForms("ORANGE POLSKA SPÓŁKA AKCYJNA").map((form) => form.text)).toContain("Orange Polska");
    // Nothing left but a generic word: no form (it would mask every "Polska").
    expect(firmNameForms("POLSKA S.A.")).toEqual([]);
  });

  it("address: street with and without its type, Roman numerals kept, code with town", () => {
    const forms = addressForms("UL. JANA PAWŁA II 12/4, 25-001 KIELCE").map((form) => form.text);
    expect(forms).toEqual(expect.arrayContaining(["Ul. Jana Pawła II 12/4", "Jana Pawła II 12/4", "25-001 Kielce"]));
    expect(forms).not.toContain("Kielce");
    expect(titleCase("SKŁODOWSKIEJ-CURIE 5")).toBe("Skłodowskiej-Curie 5");
  });

  it("keys: NIP in any spelling and KRS numbers", () => {
    expect(registryKeys("NIP 526-104-08-28, KRS 0000019193")).toEqual([
      { source: "wl", id: "5261040828" },
      { source: "krs", id: "0000019193" }
    ]);
  });
});

describe("pseudonymization with register data", () => {
  const text =
    "Pozwana: Transkom, NIP 526-104-08-28, KRS 0000019193, z siedzibą przy Jana Pawła II 12/4, 25-001 Kielce. " +
    "W imieniu TRANSKOM działała Anna Wiśniewska-Kowal. Wspólnikiem jest Budex.";

  it("name without a legal form, address, representative and partner firm are masked; firms keyed as firms", async () => {
    const vault = new PseudonymizationVault();
    const registry = new RegistryEnrichment(stub({ "wl:5261040828": WL, "krs:0000019193": KRS }));
    const result = await new LocalPolishPseudonymizer(vault, undefined, undefined, registry).pseudonymize(text);
    for (const leak of ["Transkom", "TRANSKOM", "Jana Pawła", "25-001", "Wiśniewska", "Budex"]) expect(result.text).not.toContain(leak);
    const firms = placeholderGrammar(result.text, vault).filter((item) => item.entity === "organization");
    expect(firms.length).toBeGreaterThanOrEqual(2);
    expect(registry.events.map((event) => `${event.source}:${event.status}`)).toEqual(["wl:FOUND", "krs:FOUND"]);
  });

  it("without the register the same text leaks the bare firm name (what the lookup adds)", async () => {
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault()).pseudonymize(text);
    expect(result.text).toContain("Transkom");
  });

  it("fails open: an error or a timeout leaves local detection, and is asked again later", async () => {
    const calls: string[] = [];
    let fail = true;
    const registry = new RegistryEnrichment(
      async (request) => {
        calls.push(request.source);
        if (fail) throw new Error("offline");
        return stub({ "wl:5261040828": WL })(request);
      },
      { timeoutMs: 50 }
    );
    const pseudonymizer = new LocalPolishPseudonymizer(new PseudonymizationVault(), undefined, undefined, registry);
    const first = await pseudonymizer.pseudonymize("Kontrahent NIP 5261040828, firma Transkom.");
    expect(first.text).not.toContain("5261040828");
    fail = false;
    const second = await pseudonymizer.pseudonymize("Kontrahent NIP 5261040828. Transkom nie zapłacił.");
    expect(second.text).not.toContain("Transkom");
    expect(calls).toEqual(["wl", "wl"]);

    const slow = new RegistryEnrichment(() => new Promise(() => {}), { timeoutMs: 20 });
    expect(await slow.forms("NIP 5261040828")).toEqual([]);
    expect(slow.events[0]).toMatchObject({ status: "TIMEOUT" });
  });

  it("one lookup per NIP across texts (cache)", async () => {
    const calls: string[] = [];
    const registry = new RegistryEnrichment(stub({ "wl:5261040828": WL }, calls));
    await registry.forms("NIP 5261040828");
    await registry.forms("NIP: 526-104-08-28 ponownie");
    expect(calls).toEqual(["wl:5261040828"]);
  });
});
