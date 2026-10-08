import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MandatoryPathDetails } from "./MandatoryPathDetails.js";

describe("panel ścieżki obowiązkowej", () => {
  it("pokazuje kroki pominięte w tej turze osobno i ich nie liczy", () => {
    const html = renderToStaticMarkup(
      <MandatoryPathDetails
        path={{
          source: "PROFIL-LEKKI.md",
          profile: "LEKKI",
          complete: true,
          degraded: false,
          missing: [],
          steps: [
            { layer: "ROUTER", id: "R-1", label: "Router", requirement: "CORE", status: "MET", by: "APLIKACJA", evidence: "wczytany przez aplikację do kontekstu modelu" },
            { layer: "ROUTER", id: "T:MOD-OS-CZASU", label: "Oś czasu przesłanek", requirement: "TRIGGERED", status: "NOT_TRIGGERED", evidence: "wyzwalacz nie padł: mniej niż 2 daty" }
          ]
        }}
      />
    );
    expect(html).toContain("1/1");
    expect(html).toContain("Pominięte w tej turze (wyzwalacz nie wystąpił)");
    expect(html).toContain("Oś czasu przesłanek");
    expect(html).toContain("wyzwalacz nie padł: mniej niż 2 daty");
  });
});
