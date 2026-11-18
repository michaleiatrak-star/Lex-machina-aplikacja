// Strength of a pleading, checked after it is written (RD 121/26, 2026-11-16): the application
// pointed the model at the record's passages on the issue (the attorney's statement at 01:53:35)
// and read eight rulings of the bar's courts, yet the draft used none of the passages and two of
// the rulings, and conceded a thesis of the decision ("the letter cites no GDPR") without checking
// the substantive law (the principals were companies: no personal data at all). The chat did.
import type { FilePassage } from "./case-issue.js";

export type StrengthGap = { kind: "REQUIRED" | "PASSAGE" | "CASE_LAW" | "CONCEDED"; label: string; detail: string };

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

/**
 * Facts of the files on the person the question names (the user), found through the identity
 * legend: a verdict, a discontinuance, a notice of an offence about that person (RD 121/26: the
 * acquittal in VIII W 633/25 and the attorney's earlier notice of 6.10.2025 went unused).
 */
const DECISIVE = /\b(?:uniewinni\p{L}*|umarz\p{L}*|umorz\p{L}*|skazuj\p{L}*|skazan\p{L}*|oddal\p{L}*|uwzględni\p{L}*|zawiadom\p{L}*|zawiadomieni\p{L}*|oskarż\p{L}*|wszczęt\p{L}*|wniosek\s+o\s+ukaranie)/iu;

export function personKeyFacts(
  attachments: ReadonlyArray<{ documentId: string; chunks: ReadonlyArray<{ index: number; pageStart?: number; text: string }> }>,
  personTokens: readonly string[],
  limit = 4
): FilePassage[] {
  if (!personTokens.length) return [];
  const facts: FilePassage[] = [];
  for (const attachment of attachments) {
    for (const chunk of attachment.chunks) {
      for (const sentence of chunk.text.replace(/\s*\n\s*/gu, " ").match(/[^.!?]{20,}(?:[.!?]+|$)/gu) ?? []) {
        if (!personTokens.some((token) => sentence.includes(token)) || !DECISIVE.test(sentence)) continue;
        facts.push({ documentId: attachment.documentId, chunkIndex: chunk.index, page: chunk.pageStart ?? chunk.index + 1, text: sentence.replace(/\s+/gu, " ").trim().slice(0, 500) });
        break;
      }
      if (facts.length >= limit) return facts;
    }
  }
  return facts;
}

/** The passages a pleading must use or set aside by name: the strongest one and the key facts on the user. */
// A passage about another case ("w sprawie VIII W 633/25 …") is the model's to weigh, never a duty:
// required, it pulled the draft into a thread outside the case (XI P 27/26, 2026-11-17).
const OTHER_CASE = /\b[IVXLC]{1,6}\s+[A-Z][A-Za-z]{0,5}\s+\d{1,6}\/\d{2,4}\b/u;

export function requiredPassages(passages: readonly FilePassage[], keyFacts: readonly FilePassage[]): FilePassage[] {
  const seen = new Set<string>();
  const strongest = passages.slice(0, 2).filter((passage) => !OTHER_CASE.test(passage.text) && (passage.weight ?? 1) >= 0.5);
  return [...keyFacts, ...strongest].filter((item) => !seen.has(item.text) && Boolean(seen.add(item.text)));
}

// "W materiale brak danych o…", "w aktach nie ma…", "nie ma w odczytanych materiałach".
const DENIES_RECORD = /(?:brak\s+(?:danych|informacji|materiału)|nie\s+ma\s+(?:w\s+)?(?:aktach|materiale|odczytanych\s+materiałach)|w\s+(?:aktach|materiale)\s+(?:brak|nie\s+ma))/iu;

export function strengthGaps(answer: string, passages: readonly FilePassage[], rulings: readonly string[], required: readonly FilePassage[] = []): StrengthGap[] {
  const gaps: StrengthGap[] = [];
  const missing = required.filter((passage) => !passageUsed(answer, passage));
  if (missing.length) {
    gaps.push({
      kind: "REQUIRED",
      label: `${missing.length} kluczowych fragmentów akt niewykorzystanych${DENIES_RECORD.test(answer) ? " (projekt twierdzi, że czegoś w aktach brak)" : ""}`,
      detail: missing.map((passage) => `- [[LEXDOC:${passage.documentId}:${passage.chunkIndex}]] (s. ${passage.page}) „${passage.text}”`).join("\n")
    });
  }
  const unused = passages.slice(0, 5).filter((passage) => !passageUsed(answer, passage) && !missing.includes(passage));
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
    if (gap.kind === "REQUIRED") {
      parts.push(
        "0) FRAGMENTY AKT NAJŚCIŚLEJ ZWIĄZANE Z ZAGADNIENIEM I FAKTY O OSOBIE Z PYTANIA (wybrane przez aplikację z akt tej sprawy, dosłownie poniżej). Są w dokumentach — nie pisz, że czegoś w aktach nie ma. Oceń każdy sam: jeśli wspiera albo osłabia stanowisko strony, wykorzystaj go z cytatem i znacznikiem dokumentu; jeśli nie ma znaczenia, napisz w uwagach poza pismem jednym zdaniem dlaczego:",
        gap.detail
      );
    }
    if (gap.kind === "PASSAGE") {
      parts.push(
        "1) Fragmenty akt dotyczące zagadnienia, których projekt nie wykorzystał. Dla każdego: albo wykorzystaj go (cytat ze znacznikiem dokumentu), albo w uwagach poza pismem napisz jednym zdaniem, dlaczego go pomijasz. Zestaw fakty z różnych dokumentów chronologicznie, gdy razem pokazują wzorzec zachowania (wcześniejsze zawiadomienia, zapowiedzi na rozprawie, pismo):",
        gap.detail
      );
    }
    if (gap.kind === "CASE_LAW") {
      parts.push(
        "2) Orzecznictwo odczytane przez aplikację, a niewykorzystane. Zbuduj linię orzeczniczą: powołaj co najmniej trzy orzeczenia najbliższe stanowi faktycznemu tej sprawy (porównaj fakty orzeczenia z faktami z akt), każde z sygnaturą, datą i cytatem wyłącznie z tekstu w kontekście. Orzeczeń, których tekstu nie masz, nie powołuj.",
        gap.detail
      );
    }
    if (gap.kind === "CONCEDED") {
      parts.push(
        "3) Tezy zaskarżonego rozstrzygnięcia oddane bez odpowiedzi. Zanim oddasz tezę, sprawdź kontrargument z prawa materialnego i z akt (czy przesłanki pojęcia, na które powołuje się rozstrzygnięcie albo pismo, są w ogóle spełnione wobec tych podmiotów i tych faktów). Oddaj tezę tylko wtedy, gdy kontrargumentu naprawdę nie ma, i napisz dlaczego:",
        gap.detail
      );
    }
  }
  parts.push("Nie dodawaj wątków spoza przedmiotu postępowania. Zachowaj statusy weryfikacji przy powołaniach.");
  return parts.join("\n\n");
}

/** Under the answer, when the corrected pleading still leaves key passages out: the user sees them. */
export function requiredPassagesNote(answer: string, required: readonly FilePassage[]): string {
  const missing = required.filter((passage) => !passageUsed(answer, passage));
  if (!missing.length) return "";
  return [
    "",
    "---",
    "**Fragmenty akt wskazane przez aplikację, których projekt nie wykorzystał** (do rozważenia przed złożeniem):",
    ...missing.map((passage) => `- „${passage.text}” [[LEXDOC:${passage.documentId}:${passage.chunkIndex}]] (s. ${passage.page})`)
  ].join("\n");
}
