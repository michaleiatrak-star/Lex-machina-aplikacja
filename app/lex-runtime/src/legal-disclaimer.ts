// KROK 7 routera: ostatnim elementem odpowiedzi prawnej jest disclaimer z
// shared/DISCLAIMER.md (wariant LAIK albo PRAWNIK, przy projekcie pisma także
// WARIANT PISMO SĄDOWE). Gdy model go nie dał na końcu, dokłada go aplikacja.

export type DisclaimerTexts = { laik: string; prawnik: string; pismo?: string };

const CLOSING = /nie\s+stanowi\s+porady\s+prawnej/iu;

function block(markdown: string, heading: RegExp): string | null {
  const at = markdown.search(heading);
  if (at < 0) return null;
  const fence = /```[^\n]*\n([\s\S]*?)```/u.exec(markdown.slice(at));
  return fence?.[1]?.trim() || null;
}

/** Warianty z pliku kanonicznego; null, gdy plik nie ma oczekiwanej budowy. */
export function parseDisclaimer(markdown: string): DisclaimerTexts | null {
  const laik = block(markdown, /^###\s+TRYB LAIK/mu);
  const prawnik = block(markdown, /^###\s+TRYB PRAWNIK/mu);
  const pismo = block(markdown, /^###\s+WARIANT PISMO/mu);
  if (!laik || !prawnik) return null;
  return { laik, prawnik, ...(pismo ? { pismo } : {}) };
}

/** Disclaimer jest ostatnim akapitem odpowiedzi. */
export function endsWithDisclaimer(answer: string): boolean {
  const paragraphs = answer.trim().split(/\n\s*\n/u).filter((paragraph) => !/^\s*(?:-{3,}|\*{3,})\s*$/u.test(paragraph));
  return CLOSING.test(paragraphs.slice(-2).join("\n"));
}

export function withDisclaimer(
  answer: string,
  texts: DisclaimerTexts,
  options: { mode: "LAIK" | "PRAWNIK"; pleading: boolean }
): { text: string; appended: boolean } {
  if (endsWithDisclaimer(answer)) return { text: answer, appended: false };
  const parts = [options.mode === "LAIK" ? texts.laik : texts.prawnik];
  if (options.pleading && options.mode === "PRAWNIK" && texts.pismo) parts.push(texts.pismo);
  return { text: `${answer.trimEnd()}\n\n${parts.join("\n\n")}`, appended: true };
}
