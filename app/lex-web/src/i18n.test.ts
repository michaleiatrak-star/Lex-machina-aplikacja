import { describe, expect, it } from "vitest";
import { LOCALES, N_, preferredLocale, registerCatalog, setLocale, t } from "./i18n";

describe("i18n", () => {
  it("keeps Polish as the source and falls back to English, then Polish", () => {
    registerCatalog("en", { "Zapisz": "Save", "Plik {name}": "File {name}" });
    registerCatalog("de", { "Zapisz": "Speichern" });
    setLocale("pl");
    expect(t("Zapisz")).toBe("Zapisz");
    setLocale("de");
    expect(t("Zapisz")).toBe("Speichern");
    expect(t("Plik {name}", { name: "a.pdf" })).toBe("File a.pdf");
    expect(t("Brak tłumaczenia")).toBe("Brak tłumaczenia");
    setLocale("xx");
    expect(t("Zapisz")).toBe("Zapisz");
    setLocale("pl");
    expect(N_("Tekst")).toBe("Tekst");
  });

  it("picks the stored language, then the system one, then Polish", () => {
    expect(preferredLocale("de", ["en-US"])).toBe("de");
    expect(preferredLocale(null, ["nn-NO"])).toBe("nb");
    expect(preferredLocale(null, ["ja-JP", "fr-CA"])).toBe("fr");
    expect(preferredLocale(null, ["ja-JP"])).toBe("pl");
    expect(new Set(LOCALES.map((locale) => locale.code)).size).toBe(LOCALES.length);
  });
});
