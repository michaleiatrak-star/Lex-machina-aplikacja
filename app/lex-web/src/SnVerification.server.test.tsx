import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runSnProxyWindow, SN_SERVER_REASONS, SnVerification } from "./SnVerification.js";

describe("weryfikacja sn.pl w trybie serwerowym (przeglądarka)", () => {
  it("zamiast „tylko w aplikacji na komputerze”: próba serwera i wklejenie sesji", () => {
    const html = renderToStaticMarkup(<SnVerification verification={{ url: "https://www.sn.pl/pl/wyszukiwarka-orzeczen" }} onVerified={() => undefined} />);
    expect(html).toContain("Spróbuj na serwerze");
    expect(html).toContain("Wklej sesję");
    expect(html).toContain("Otwórz sn.pl");
    expect(html).not.toContain("dostępna w aplikacji Lex Machina na komputerze");
  });

  it("powód odmowy po stronie serwera wprost, z drogą zastępczą (SAOS)", () => {
    expect(SN_SERVER_REASONS.SN_SERVER_REJECTED).toContain("SAOS");
    expect(SN_SERVER_REASONS.SN_SERVER_BROWSER_MISSING).toContain("Playwright");
  });

  it("okno sn.pl przez serwer: zamyka się po złapaniu sesji, jak okno aplikacji na komputerze", async () => {
    const closed: string[] = [];
    let polls = 0;
    const popup = { closed: true, close: () => closed.push("popup") };
    const result = await runSnProxyWindow({
      open: async () => ({ ticket: "T", url: "/api/mcp-search/sn-proxy/s/T/pl/wyszukiwarka-orzeczen" }),
      status: async () => ({ ready: ++polls >= 3 }),
      close: async (ticket) => closed.push(`ticket:${ticket}`),
      openWindow: (url) => (url === "https://lex.firma.pl/api/mcp-search/sn-proxy/s/T/pl/wyszukiwarka-orzeczen" ? popup : null),
      wait: async () => undefined,
      base: "https://lex.firma.pl"
    });
    // popup.closed=true from the start (opener cut off by COOP) does not end the wait early.
    expect(result).toBe("ready");
    expect(polls).toBe(3);
    expect(closed).toEqual(["popup", "ticket:T"]);
  });

  it("zablokowane okno i anulowanie: bilet zawsze zwolniony", async () => {
    const released: string[] = [];
    const deps = {
      open: async () => ({ ticket: "T", url: "/x" }),
      status: async () => ({ ready: false }),
      close: async (ticket: string) => released.push(ticket),
      wait: async () => undefined,
      base: ""
    };
    expect(await runSnProxyWindow({ ...deps, openWindow: () => null })).toBe("blocked");
    let asked = 0;
    expect(await runSnProxyWindow({ ...deps, openWindow: () => ({ closed: false, close: () => undefined }), cancelled: () => ++asked > 2 })).toBe("closed");
    expect(released).toEqual(["T", "T"]);
  });
});
