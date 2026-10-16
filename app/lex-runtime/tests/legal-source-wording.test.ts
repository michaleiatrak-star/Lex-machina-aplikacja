import { describe, expect, it } from "vitest";
import { OfficialLegalSourceVerifier, claimedUnitState, htmlFootnotes, statuteWording } from "../src/legal-source-verifier.js";

// Like legal-cite-pl: of two wordings the consolidated text prints, the one in force today goes
// to the evidence and the later one to pendingWording; an unreadable date, a repealed article or
// a change not in force that the footnotes do not settle is not verified.
const NOTES = {
  "25": "W tym brzmieniu obowiązuje do wejścia w życie zmiany, o której mowa w odnośniku 26.",
  "26": "W brzmieniu ustalonym przez art. 1 pkt 1 ustawy z dnia 2 lutego 2099 r. (Dz. U. poz. 77), która wejdzie w życie z dniem 1 lipca 2099 r.",
  "27": "Dodany przez art. 1 pkt 2 ustawy, o której mowa w odnośniku 26."
};
const ARTICLE = [
  "Art. 94. Pracodawca jest obowiązany w szczególności:",
  "2a) organizować pracę;",
  "2b) 25 ) przeciwdziałać dyskryminacji w zatrudnieniu;",
  "2b) 26 ) przeciwdziałać wszelkiemu nierównemu traktowaniu;",
  "2c) 27 ) przeciwdziałać naruszaniu godności;",
  "3) (uchylony)",
  "Dziennik Ustaw – 46 – Poz. 1245"
].join("\n");

describe("brzmienie przepisu z odnośników tekstu jednolitego", () => {
  it("przed datą zmiany: obecne brzmienie, przyszłe osobno; nagłówek strony poza tekstem", () => {
    const wording = statuteWording(ARTICLE, NOTES, "2099-06-30");
    expect(wording.evidence).toContain("przeciwdziałać dyskryminacji");
    expect(wording.evidence).not.toContain("nierównemu");
    expect(wording.evidence).not.toContain("godności");
    expect(wording.evidence).not.toContain("Dziennik Ustaw");
    expect(wording.pending.map((item) => item.from)).toEqual(["2099-07-01", "2099-07-01"]);
    expect(wording.unresolved || wording.repealed).toBe(false);
  });

  it("od dnia zmiany: nowe brzmienie i dodany punkt", () => {
    const wording = statuteWording(ARTICLE, NOTES, "2099-07-01");
    expect(wording.evidence).toContain("nierównemu traktowaniu");
    expect(wording.evidence).toContain("godności");
    expect(wording.evidence).not.toContain("przeciwdziałać dyskryminacji");
    expect(wording.pending).toEqual([]);
  });

  it("odnośnik zapowiada zmianę bez czytelnej daty: nierozstrzygnięte; artykuł uchylony rozpoznany", () => {
    expect(statuteWording(ARTICLE, { ...NOTES, "26": "W brzmieniu ustalonym przez ustawę, która wejdzie w życie w terminie późniejszym." }, "2099-06-30").unresolved).toBe(true);
    expect(statuteWording("Art. 10. (uchylony)", {}, "2026-10-16").repealed).toBe(true);
  });

  it("HTML ELI: treść odnośnika z dymka nie wchodzi do przepisu", () => {
    const html = '<div>Art. 5. <a class="gloss-link tooltip" href="#g"><sup>3)</sup><span class="tooltip-text">Dodany przez art. 1 ustawy z dnia 1 stycznia 2099 r., która wejdzie w życie z dniem 1 lipca 2099 r.</span></a> Treść.</div>';
    const split = htmlFootnotes(html);
    expect(split.html).toContain("Art. 5.  3 ) Treść.");
    expect(split.footnotes["3"]).toMatch(/^Dodany przez art\. 1/u);
  });

  it("weryfikator: zmiana nieobowiązująca w t.j. bez rozstrzygających odnośników = bez VER", async () => {
    const page = "<html><body><h1>Kodeks pracy</h1><p>Art. 860.</p><p>§ 1. Treść.</p><p>Art. 861.</p></body></html>";
    const verifier = new OfficialLegalSourceVerifier(
      async () => new Response(page, { headers: { "content-type": "text/html" } }),
      () => "2026-10-16T10:00:00.000Z"
    );
    const request = { claim: "art. 860 KP", kind: "statute" as const, url: "https://api.sejm.gov.pl/eli/acts/DU/2026/1245/text.html", toolCallId: "t", expectedTitle: "Kodeks pracy" };
    expect((await verifier.verify(request)).record.status).toBe("VERIFIED");
    const required = await verifier.verify({ ...request, requireFootnoteWording: true });
    expect(required.record.status).toBe("UNVERIFIED");
    expect(required.record.evidence).toMatch(/jeszcze nie obowiązuje/u);
  });
});

describe("jednostka niższego rzędu w powołaniu (§, ust., pkt)", () => {
  const wording = statuteWording(ARTICLE, NOTES, "2099-06-30");
  it.each([
    ["art. 94 pkt 2a KP", "IN_FORCE"],
    ["art. 94 pkt 2c KP", "PENDING"],
    ["art. 94 pkt 3 KP", "REPEALED"],
    ["art. 94 pkt 9 KP", "MISSING"],
    ["art. 94 KP", "NOT_CHECKED"]
  ])("%s -> %s", (claim, state) => {
    expect(claimedUnitState(claim, wording.evidence, wording.pending).state).toBe(state);
  });

  it("§ w artykule bez paragrafów i § z indeksem górnym", () => {
    expect(claimedUnitState("art. 5 § 2 KC", "Art. 5. Nie można czynić ze swego prawa użytku…", []).state).toBe("MISSING");
    expect(claimedUnitState("art. 22 § 1¹ KP", "Art. 22. § 1. Przez nawiązanie…\n§ 1^1. Zatrudnienie…", []).state).toBe("IN_FORCE");
    expect(claimedUnitState("art. 860 § 3 KC", "Art. 860. § 1. Przez umowę spółki…\n§ 2. Umowa…", [{ from: "2028-11-01", text: "§ 3. Jeżeli przepis ustawy tak stanowi…" }])).toEqual({ state: "PENDING", from: "2028-11-01" });
  });
});
