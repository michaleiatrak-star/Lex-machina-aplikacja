import { describe, expect, it } from "vitest";
import { detectFirmNames, firmFragments } from "../src/privacy/firm-names.js";
import { findNameApproximately } from "../src/privacy/fuzzy-names.js";
import { LocalPolishPseudonymizer, PseudonymizationVault, type PiiSpan } from "../src/privacy/pseudonymizer.js";
import {
  addressForms,
  ceidgForms,
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
const WL_COMPANY = { ...WL, result: { ...WL.result, krs: "0000019193" } };
// CEIDG: the fixture shape of ceidg_szukaj_firmy (fictitious data).
const CEIDG = {
  status: "FOUND",
  result: { identyfikator: "1234563218", tytul_lub_nazwa: "Marex Usługi Remontowe Marek Zając", wlasciciel: "Marek Zając", adres_dzialalnosci: "ul. Przykładowa 1/2 43-600 Jaworzno" }
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
    // A street name of ASCII letters only (found on live CEIDG data: the street was dropped).
    expect(addressForms("ul. Kolorowa 123 25-001 Kielce").map((form) => form.text)).toEqual(expect.arrayContaining(["Ul. Kolorowa 123", "Kolorowa 123", "25-001 Kielce"]));
    expect(addressForms("Polna 7A/12, 00-001 Warszawa").map((form) => form.text)).toContain("Polna 7A/12");
    expect(addressForms("12, 00-001 Warszawa").map((form) => form.text)).toEqual(["00-001 Warszawa", "00-001 WARSZAWA"]);
  });

  it("keys: NIP in any spelling and KRS numbers", () => {
    expect(registryKeys("NIP 526-104-08-28, KRS 0000019193")).toEqual([
      { source: "nip", id: "5261040828" },
      { source: "krs", id: "0000019193" }
    ]);
  });

  it("keys: a NIP as OCR damaged it (dash, letter for a digit, glued label) and a split KRS, digits only", () => {
    for (const damaged of ["NIP 526–104–08–28", "NIP 526-1O4-08-28", "NIP526 104 08 2B", "NlP: 526-104-08-2 8"]) {
      expect(registryKeys(damaged).filter((key) => key.source === "nip"), damaged).toEqual(
        damaged.endsWith("2B") ? [] : [{ source: "nip", id: "5261040828" }]
      );
    }
    // Checksum: digits that are no NIP are never asked.
    expect(registryKeys("NIP 526-104-08-29")).toEqual([]);
    expect(registryKeys("KRS 0000 019193")).toEqual([{ source: "krs", id: "0000019193" }]);
  });
});

describe("pseudonymization with register data", () => {
  const text =
    "Pozwana: Transkom, NIP 526-104-08-28, KRS 0000019193, z siedzibą przy Jana Pawła II 12/4, 25-001 Kielce. " +
    "W imieniu TRANSKOM działała Anna Wiśniewska-Kowal. Wspólnikiem jest Budex.";

  it("name without a legal form, address, representative and partner firm are masked; firms keyed as firms", async () => {
    const vault = new PseudonymizationVault();
    const registry = new RegistryEnrichment(stub({ "wl:5261040828": WL_COMPANY, "krs:0000019193": KRS }));
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
    expect(calls).toEqual(["wl", "ceidg", "wl", "ceidg"]);

    const slow = new RegistryEnrichment(() => new Promise(() => {}), { timeoutMs: 20 });
    expect(await slow.forms("NIP 5261040828")).toEqual([]);
    expect(slow.events[0]).toMatchObject({ status: "TIMEOUT" });
  });

  it("one lookup per NIP across texts (cache)", async () => {
    const calls: string[] = [];
    const registry = new RegistryEnrichment(stub({ "wl:5261040828": WL }, calls));
    await registry.forms("NIP 5261040828");
    await registry.forms("NIP: 526-104-08-28 ponownie");
    expect(calls).toEqual(["wl:5261040828", "ceidg:5261040828"]);
  });
});

describe("CEIDG for a NIP outside KRS (sole trader), when its key is set", () => {
  it("forms: business name, owner in both orders, address without a comma before the code", () => {
    const texts = ceidgForms(CEIDG).map((form) => form.text);
    expect(texts).toEqual(expect.arrayContaining(["Marex Usługi Remontowe Marek Zając", "Marek Zając", "Zając Marek", "Przykładowa 1/2", "43-600 Jaworzno"]));
  });

  it("a company with KRS on the white list is not asked in CEIDG; a sole trader is", async () => {
    const calls: string[] = [];
    const registry = new RegistryEnrichment(stub({ "wl:5261040828": WL_COMPANY, "ceidg:1234563218": CEIDG }, calls));
    await registry.forms("NIP 5261040828");
    const forms = await registry.forms("NIP 1234563218");
    expect(calls).toEqual(["wl:5261040828", "wl:1234563218", "ceidg:1234563218"]);
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), undefined, undefined, registry).pseudonymize(
      "Wykonawca: Marex Usługi Remontowe Marek Zając, NIP 1234563218, ul. Przykładowa 1/2, 43-600 Jaworzno. Zając Marek nie usunął wad."
    );
    for (const leak of ["Marex", "Zając", "Przykładowa", "43-600"]) expect(result.text).not.toContain(leak);
    expect(forms.length).toBeGreaterThan(0);
  });

  it("no CEIDG key: the white list alone, CEIDG asked again only after 10 minutes", async () => {
    let now = 0;
    const calls: string[] = [];
    const registry = new RegistryEnrichment(
      async (request) => {
        calls.push(request.source);
        if (request.source === "ceidg") return { ok: false, result: { status: "SOURCE_UNAVAILABLE" } };
        return { ok: true, result: WL };
      },
      { now: () => now }
    );
    expect((await registry.forms("NIP 5261040828")).map((form) => form.text)).toContain("Transkom");
    await registry.forms("NIP 5261040828");
    expect(calls).toEqual(["wl", "ceidg"]);
    now = 11 * 60_000;
    await registry.forms("NIP 5261040828");
    expect(calls).toEqual(["wl", "ceidg", "wl", "ceidg"]);
    expect(registry.events.some((event) => event.source === "ceidg")).toBe(false);
  });

  it("a slow CEIDG answer does not hold the text and protects the next one", async () => {
    let answer: (value: { ok: boolean; result: unknown }) => void = () => {};
    const registry = new RegistryEnrichment(
      async (request) =>
        request.source === "ceidg" ? new Promise((resolve) => (answer = resolve)) : { ok: true, result: { status: "NOT_FOUND" } },
      { timeoutMs: 30 }
    );
    expect(await registry.forms("NIP 1234563218")).toEqual([]);
    answer({ ok: true, result: CEIDG });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await registry.forms("NIP 1234563218")).map((form) => form.text)).toContain("Marek Zając");
  });
});

// One element, whatever the words: a firm's name is the firm's in any part of two or more
// words, a name before a legal form stays whole, the board from KRS is found by its mask, and
// a register form is found as OCR distorted it (fictitious names; no rule names a word).
describe("register and firm names as whole elements", () => {
  it("parts of a firm's name of two or more words, not connectors or generic words alone", () => {
    expect(firmFragments("Nordic Trade Solutions")).toEqual(["Nordic Trade", "Trade Solutions"]);
    expect(firmFragments("Nowak i Wspólnicy Doradztwo")).toEqual(["Nowak i Wspólnicy", "Wspólnicy Doradztwo"]);
    expect(firmFragments("Global Group Holding")).toEqual([]);
    expect(firmFragments("Nordic Trade")).toEqual([]);
  });

  it("a part of a known firm's name OCR left alone is the firm, not a person", () => {
    const text = "Nordic Trade Solutions sp. z o.o. z siedzibą w Gdyni.\nordic Trade Solutions\nPieczęć: Trade Solutions";
    const spans = detectFirmNames(text);
    expect(spans.map((span) => span.value)).toEqual(expect.arrayContaining(["Nordic Trade Solutions", "Trade Solutions"]));
  });

  it("a name before a legal form stays whole though its words are surnames of persons in the text", async () => {
    const text = "Pełnomocnicy: Jan Nowak i Anna Lis z kancelarii Nowak Lis Spółka Komandytowa.";
    const persons: PiiSpan[] = ["Jan Nowak", "Anna Lis"].map((value) => ({ start: text.indexOf(value), end: text.indexOf(value) + value.length, kind: "PERSON", value }));
    for (const value of ["Nowak", "Lis"]) {
      const start = text.indexOf(value, text.indexOf("kancelarii"));
      persons.push({ start, end: start + value.length, kind: "PERSON", value });
    }
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), { recognize: async () => persons }).pseudonymize(text);
    const firm = result.findings.find((finding) => finding.firm);
    expect(firm && text.slice(firm.start, firm.end)).toBe("Nowak Lis");
  });

  it("the board from KRS by its mask, in either order and case; only when the white list names no one", async () => {
    const list = { status: "FOUND", result: { tytul_lub_nazwa: "NORDIC TRADE SOLUTIONS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", krs: "0000123456", osoby: [] } };
    const board = { status: "FOUND", result: { reprezentacja: { sklad: [{ funkcja: "PREZES ZARZĄDU", osoba_maska: "M******* W*********" }, { osoba_maska: "E** K**" }] } } };
    const calls: string[] = [];
    const registry = new RegistryEnrichment(async ({ tool, arguments: args }) => {
      calls.push(tool);
      return { ok: true, result: tool === "krs_reprezentacja" ? board : tool === "wl_sprawdz_nip" && args.nip ? list : { status: "NOT_FOUND" } };
    });
    const text = "Spółkę reprezentuje Mirosław Wiśniewski (NIP 5261040828). Pismo doręczono Mirosławowi Wiśniewskiemu; Wiśniewski Mirosław podpisał. Ewa Kot przyszła.";
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), undefined, undefined, registry).pseudonymize(text);
    for (const leak of ["Mirosław Wiśniewski", "Wiśniewski Mirosław"]) expect(result.text).not.toContain(leak);
    expect(result.findings.some((finding) => finding.uncertain?.includes("KRS"))).toBe(true);
    // "E** K**" is too short to match without the name: "Ewa Kot" is left to the other recognizers.
    expect(result.text).toContain("Ewa Kot");
    expect(calls).toContain("krs_reprezentacja");

    const named = { ...list, result: { ...list.result, osoby: [{ rola: "reprezentant", imie: "MIROSŁAW", nazwisko: "WIŚNIEWSKI" }] } };
    const calls2: string[] = [];
    await new RegistryEnrichment(async ({ tool }) => {
      calls2.push(tool);
      return { ok: true, result: tool === "wl_sprawdz_nip" ? named : board };
    }).forms("NIP 5261040828");
    expect(calls2).toEqual(["wl_sprawdz_nip"]);
  });

  it("a register form as OCR distorted it is masked and marked for confirmation", async () => {
    const registry = new RegistryEnrichment(stub({ "wl:5261040828": WL_COMPANY, "krs:0000019193": KRS }));
    const text = "NIP 5261040828. Umowę zawarła Anna Wisniewska-Kowa1, a podpisała Ana Wiśniewska-Kowal.";
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), undefined, undefined, registry).pseudonymize(text);
    for (const leak of ["Wisniewska", "Ana Wi"]) expect(result.text).not.toContain(leak);
    expect(result.findings.filter((finding) => finding.uncertain?.startsWith("odczyt zniekształcony")).length).toBeGreaterThanOrEqual(2);
  });

  it("a firm's name as OCR distorted it is the register's firm: one token, marked for confirmation", async () => {
    const wl = { status: "FOUND", result: { tytul_lub_nazwa: "HUMAN PARK GLOBAL SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ", krs: "0000019193", adres: "UL. KOLOROWA 15, 40-001 KATOWICE", osoby: [] } };
    const registry = new RegistryEnrichment(stub({ "wl:5261040828": wl }));
    const text = "Human Park Global sp. z o.o., NIP 526-104-08-28.\nDziałając w imieniu Spółki Human Park Giobal sp. z o.o. wzywam do zapłaty.";
    const result = await new LocalPolishPseudonymizer(new PseudonymizationVault(), undefined, undefined, registry).pseudonymize(text);
    expect(result.text).not.toContain("Giobal");
    const tokens = new Set(result.findings.filter((finding) => finding.firm).map((finding) => finding.token));
    // Two tokens would read to the model as two companies ("rozbieżność umocowania").
    expect(tokens.size).toBe(1);
    expect(result.findings.some((finding) => finding.uncertain?.includes("w rejestrze: "))).toBe(true);
  });

  it("the whole name decides: a letter lost or misread in a long name, never a short or a single word", () => {
    const text = "uman Park Global\nHurnan Park Global\nHuman Park Global sp. z o.o.\nhuman park global\nLorem Park Global";
    const found = findNameApproximately(text, "Human Park Global").map((match) => `${match.value}:${match.exact}`);
    expect(found).toEqual(["uman Park Global:false", "Hurnan Park Global:false", "Human Park Global:true"]);
    // Up to 7 letters no edit is allowed; one word alone is never matched loosely.
    expect(findNameApproximately("Ewa Kos przyszła", "Ewa Kot")).toEqual([]);
    expect(findNameApproximately("Transkon", "Transkom")).toEqual([]);
  });
});
