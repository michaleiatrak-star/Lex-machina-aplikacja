import { describe, expect, it } from "vitest";
import { searxngEnginesLine } from "./WebSearchSection.js";

describe("test wyszukiwarek: silniki SearXNG", () => {
  it("odpowiedziały z liczbą wyników, odmówiły z powodem po polsku", () => {
    expect(searxngEnginesLine({ answered: [{ name: "brave", results: 24 }, { name: "bing", results: 10 }], refused: [{ name: "google", reason: "access denied" }, { name: "duckduckgo", reason: "CAPTCHA" }] }))
      .toBe("W SearXNG odpowiedziały: Brave (24), Bing (10) · odmówiły: Google (odmowa dostępu), DuckDuckGo (weryfikacja CAPTCHA)");
    expect(searxngEnginesLine({ answered: [], refused: [{ name: "qwant", reason: "timeout" }] })).toBe("W SearXNG żadna wyszukiwarka nie dała wyników · odmówiły: Qwant (brak odpowiedzi w czasie)");
  });
});
