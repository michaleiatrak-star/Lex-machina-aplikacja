import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SN_SERVER_REASONS, SnVerification } from "./SnVerification.js";

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
});
