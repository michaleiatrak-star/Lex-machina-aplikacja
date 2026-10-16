import { describe, expect, it } from "vitest";
import { looksLikeLetter } from "./MatterChatApp";

const letter = `[Miejscowość], dnia [data]
Nadawca:
⬛ [UZUPEŁNIJ: imię, nazwisko i adres]
Adresat:
Kancelaria Adwokatów i Radców Prawnych
Odpowiedź na wezwanie do zaprzestania naruszeń i zapłaty
W odpowiedzi na wezwanie z dnia 3 grudnia 2024 r. oświadczam, że kwestionuję w całości wszystkie zarzuty naruszenia porozumienia, kwestionuję obowiązek zapłaty kwoty 60 000 zł i zaprzeczam, aby doszło do ujawnienia jakichkolwiek informacji poufnych. Wezwanie nie wskazuje konkretnie, jakie działanie miałoby stanowić każde z trzech naruszeń ani w jaki sposób wyliczono kary. Wzywam do cofnięcia żądania zapłaty.
Niniejsze pismo nie stanowi uznania żadnego roszczenia.
[podpis]
⚖️ Ważna informacja: Niniejsza analiza ma charakter wyłącznie informacyjny.`;

describe("an answer that is itself a letter", () => {
  it("a letter with fields to fill in is a letter; questions about missing data are not", () => {
    expect(looksLikeLetter(letter)).toBe(true);
    expect(
      looksLikeLetter(
        "Nie mogę bezpiecznie przygotować finalnego pisma bez danych:\n* dane i adres nadawcy;\n* miejscowość sporządzenia;\n* adres kancelarii.\nPo ich podaniu przygotuję projekt odpowiedzi."
      )
    ).toBe(false);
    expect(looksLikeLetter("Nie mogę jeszcze sporządzić odpowiedzi. Dalsza odpowiedź zostanie przygotowana później.")).toBe(false);
  });

  it("a letter written in the chat's Markdown is a letter", () => {
    const markdown = letter
      .replace("[Miejscowość], dnia [data]", "**[Miejscowość], dnia [data]**")
      .replace("Odpowiedź na wezwanie do zaprzestania naruszeń i zapłaty", "### Odpowiedź na wezwanie do zaprzestania naruszeń i zapłaty")
      .replace("[podpis]", "_[podpis]_");
    expect(looksLikeLetter(markdown)).toBe(true);
  });
});
