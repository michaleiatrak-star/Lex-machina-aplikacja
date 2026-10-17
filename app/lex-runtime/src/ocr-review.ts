import { ocrLineText, type IngestedPage, type OcrReviewLine } from "./document-ingestion.js";

/**
 * Lines of an OCR page a person should check against the scan: handwriting, stamps and
 * signatures come out as confident-looking nonsense ("Wire mats Mithet" for "Wiatrak
 * Michał", "Erymelean 2" for "Otrzymałem dnia"). A line is flagged when the engine was
 * unsure of it, or fairly unsure and most of its words are unknown to the dictionary
 * (SGJP, PESEL names, TERYT), or a line without words read with doubt. Measured on two real
 * scans: 11 of 11 handwritten lines flagged, none of 137 printed lines.
 * A stamp's own line (coloured ink read apart) is always listed. A line a black stamp ran
 * through is read as one word glued from both ("przeproWadzZZidBW5d6z"): a capital inside a
 * word or letters around a digit, read with doubt, is listed too.
 */

export type { OcrReviewLine };

// Put before a flagged line in the text, so a model reading the document does not take it as written.
export const REVIEW_MARK = "[OCR: odczyt niepewny, sprawdź w skanie]";

export type KnownWords = (words: string[]) => Promise<boolean[]>;

export const REVIEW_SCORE = 0.85;
const DOUBT_SCORE = 0.95;
const UNKNOWN_SHARE = 0.34;

const WORD = /\p{L}{3,}/gu;
// "OkregANCELABkoWieDeY", "przeproWadzZZidBW5d6z": not a Polish word or abbreviation.
const GARBLED = /\p{Ll}\p{Lu}+\p{Ll}|\p{Ll}\p{Lu}{2,}|\p{L}\d+\p{L}/u;

export async function ocrReviewLines(page: IngestedPage, knownWords: KnownWords): Promise<OcrReviewLine[]> {
  if (page.source !== "OCR" || !page.lines?.length) return [];
  const lines = page.lines;
  const vocabulary = [...new Set(lines.flatMap((line) => line.text.match(WORD) ?? []))];
  const flags = vocabulary.length ? await knownWords(vocabulary) : [];
  const known = new Set(vocabulary.filter((_, index) => flags[index]));
  const found: OcrReviewLine[] = [];
  lines.forEach((line, index) => {
    const score = typeof line.score === "number" ? line.score : undefined;
    if (line.stamp) {
      found.push({ line: index, text: line.text, ...(score !== undefined ? { score } : {}), reason: "STAMP" });
      return;
    }
    if (score === undefined) return;
    if (score < REVIEW_SCORE) {
      found.push({ line: index, text: line.text, score, reason: "LOW_CONFIDENCE" });
      return;
    }
    const words = line.text.match(WORD) ?? [];
    const unknown = words.filter((word) => !known.has(word)).length;
    // A line of digits alone read with doubt: a handwritten date ("810.2024" for "8.10.2024").
    if (score < DOUBT_SCORE && (words.length === 0 || unknown / words.length >= UNKNOWN_SHARE)) {
      found.push({ line: index, text: line.text, score, reason: "UNKNOWN_WORDS" });
      return;
    }
    if (score < DOUBT_SCORE && line.text.split(/\s+/u).some((token) => GARBLED.test(token))) {
      found.push({ line: index, text: line.text, score, reason: "GARBLED" });
    }
  });
  return found;
}

/**
 * The page with flagged lines marked in its text and listed in `review`. The OCR lines stay
 * as read: evidence masking places boxes by the characters of each line on the scan.
 */
export async function markOcrReview(page: IngestedPage, knownWords: KnownWords): Promise<IngestedPage> {
  const review = await ocrReviewLines(page, knownWords);
  if (!review.length) return page;
  const flagged = new Set(review.filter((item) => item.reason !== "STAMP").map((item) => item.line));
  const text = page.lines!.map((line, index) => (flagged.has(index) ? `${REVIEW_MARK} ${line.text}` : ocrLineText(line))).join("\n");
  return { ...page, text, review };
}
