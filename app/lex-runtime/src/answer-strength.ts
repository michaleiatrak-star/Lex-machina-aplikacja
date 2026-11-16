// Strength of a pleading, checked after it is written (RD 121/26, 2026-11-16): the application
// pointed the model at the record's passages on the issue (the attorney's statement at 01:53:35)
// and read eight rulings of the bar's courts, yet the draft used none of the passages and two of
// the rulings, and conceded a thesis of the decision ("the letter cites no GDPR") without checking
// the substantive law (the principals were companies: no personal data at all). The chat did.
import type { FilePassage } from "./case-issue.js";

export type StrengthGap = { kind: "PASSAGE" | "CASE_LAW" | "CONCEDED"; label: string; detail: string };

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ł/gu, "l")
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim();

/** The answer uses the passage: its marker, or four of its words in a row. */
export function passageUsed(answer: string, passage: FilePassage): boolean {
  if (answer.includes(`LEXDOC:${passage.documentId}:${passage.chunkIndex}]`)) return true;
  const text = ` ${fold(answer)} `;
  const words = fold(passage.text).split(" ").filter((word) => word.length >= 3);
  for (let index = 0; index + 4 <= words.length; index++) {
    if (text.includes(` ${words.slice(index, index + 4).join(" ")} `)) return true;
  }
  return false;
}

const signatureIn = (answer: string, signature: string) => new RegExp(signature.replace(/[/]/gu, "\\s*/\\s*").replace(/\s+/gu, "\\s+"), "u").test(answer);

export function strengthGaps(answer: string, passages: readonly FilePassage[], rulings: readonly string[]): StrengthGap[] {
  const gaps: StrengthGap[] = [];
  const unused = passages.slice(0, 5).filter((passage) => !passageUsed(answer, passage));
  // The answer may set a passage aside, but not by silence: three or more of the five strongest unused.
  if (unused.length >= 3) {
    gaps.push({
      kind: "PASSAGE",
      label: `${unused.length} z 5 najważniejszych fragmentów akt pominiętych`,
      detail: unused.map((passage) => `- [[LEXDOC:${passage.documentId}:${passage.chunkIndex}]] (s. ${passage.page}) „${passage.text}”`).join("\n")
    });
  }
  const cited = rulings.filter((signature) => signatureIn(answer, signature));
  const wanted = Math.min(3, rulings.length);
  if (rulings.length >= 3 && cited.length < wanted) {
    gaps.push({
      kind: "CASE_LAW",
      label: `orzecznictwo: powołane ${cited.length} z ${rulings.length} odczytanych`,
      detail: `Odczytane przez aplikację (tekst w kontekście): ${rulings.join(", ")}. Powołane: ${cited.join(", ") || "żadne"}.`
    });
  }
  const conceded = (answer.match(/[^\n]*(?:teza\s+trafna|bez\s+odpowiedzi)[^\n]*/giu) ?? []).slice(0, 6);
  if (conceded.length) {
    gaps.push({ kind: "CONCEDED", label: `${conceded.length} tez rozstrzygnięcia oddanych bez odpowiedzi`, detail: conceded.join("\n") });
  }
  return gaps;
}

export function strengthCorrection(gaps: readonly StrengthGap[]): string {
  const parts = ["KONTROLA APLIKACJI — siła pisma. Popraw projekt i oddaj go w całości:"];
  for (const gap of gaps) {
    if (gap.kind === "PASSAGE") {
      parts.push(
        "1) Fragmenty akt dotyczące zagadnienia, których projekt nie wykorzystał. Dla każdego: albo wykorzystaj go (cytat ze znacznikiem dokumentu), albo w uwagach poza pismem napisz jednym zdaniem, dlaczego go pomijasz. Zestaw fakty z różnych dokumentów chronologicznie, gdy razem pokazują wzorzec zachowania (wcześniejsze zawiadomienia, zapowiedzi na rozprawie, pismo):",
        gap.detail
      );
    }
    if (gap.kind === "CASE_LAW") {
      parts.push(
        "2) Orzecznictwo odczytane przez aplikację, a niewykorzystane. Zbuduj linię orzeczniczą: powołaj co najmniej trzy orzeczenia, najbliższe stanowi faktycznemu sprawy (podobna groźba, podobne pismo), każde z sygnaturą, datą i cytatem wyłącznie z tekstu w kontekście. Orzeczeń, których tekstu nie masz, nie powołuj.",
        gap.detail
      );
    }
    if (gap.kind === "CONCEDED") {
      parts.push(
        "3) Tezy zaskarżonego rozstrzygnięcia oddane bez odpowiedzi. Zanim oddasz tezę, sprawdź kontrargument z prawa materialnego i z akt (np. czy pojęcie użyte w piśmie w ogóle pasuje do adresata — dane osobowe dotyczą tylko osób fizycznych, spółka ich nie ma). Oddaj tezę tylko wtedy, gdy kontrargumentu naprawdę nie ma, i napisz dlaczego:",
        gap.detail
      );
    }
  }
  parts.push("Nie dodawaj wątków spoza przedmiotu postępowania. Zachowaj statusy weryfikacji przy powołaniach.");
  return parts.join("\n\n");
}
