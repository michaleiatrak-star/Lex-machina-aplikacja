/**
 * A doubtful OCR line corrected straight in the "Niepewne" list: the line's text in the page
 * text is replaced by the user's version. The line is found by its text; when it appears more
 * than once, the occurrence nearest to the OCR line number (lines of the page text) is taken.
 * null: the line is not in the page text (a stamp read apart) - the page editor is for that.
 */
export function replaceOcrLine(pageText: string, line: { line: number; text: string }, corrected: string): string | null {
  const from = line.text;
  if (!from || corrected === from) return null;
  const starts: number[] = [];
  for (let at = pageText.indexOf(from); at >= 0; at = pageText.indexOf(from, at + 1)) starts.push(at);
  if (starts.length === 0) return null;
  const lineOf = (offset: number) => pageText.slice(0, offset).split("\n").length - 1;
  const best = starts.reduce((chosen, start) => (Math.abs(lineOf(start) - line.line) < Math.abs(lineOf(chosen) - line.line) ? start : chosen), starts[0]!);
  return pageText.slice(0, best) + corrected + pageText.slice(best + from.length);
}

type ReviewedPage = {
  text: string;
  review?: Array<{ text: string; reason: string }>;
  corrections?: Array<{ to: string }>;
};

/**
 * The page after a hand correction keeps what is still to check: the runtime returns an edited
 * page without its doubtful lines, so one saved line closed the whole "Niepewne" list (user
 * report 2026-11-06). A line still in the new text stays, a corrected one goes; a stamp (read
 * apart, never in the page text) stays until the user decides it.
 */
export function keepOpenReview<T extends { text: string }>(previous: ReviewedPage | undefined, saved: T & Partial<ReviewedPage>): T & Partial<ReviewedPage> {
  if (!previous || saved.review?.length) return saved;
  const review = (previous.review ?? []).filter((line) => line.reason === "STAMP" || saved.text.includes(line.text));
  const corrections = saved.corrections?.length ? saved.corrections : (previous.corrections ?? []).filter((fix) => saved.text.includes(fix.to));
  return {
    ...saved,
    ...(review.length ? { review } : {}),
    ...(corrections.length ? { corrections } : {})
  };
}
