/**
 * A scan with a foreign text layer (a PDF someone else OCR-ed): the application reads the page
 * image again and takes its own reading. Numbers that differ between the two readings (an amount,
 * a date, a signature number) are the place where one of them misread a digit (LEGAL GAUNTLET v3,
 * G68 / T06): such lines are listed for a person to check against the scan. Numbers are compared
 * by their digits only ("12 000,00" = "12.000,00", "08.10.2024" = "8.10.2024").
 */
const NUMBER = /\d(?:[\d\s.,/-]*\d)?/gu;

/** Digits of each number with two or more digits, leading zeros dropped. */
export function numberKeys(text: string): string[] {
  return (text.match(NUMBER) ?? [])
    .map((token) => token.replace(/\D/gu, "").replace(/^0+(?=\d)/u, ""))
    .filter((key) => key.length >= 2);
}

function counts(keys: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}

export type LayerMismatch = {
  // OCR line indexes with a number the text layer does not have.
  lines: number[];
  // Numbers read only from the scan, and only in the text layer.
  scanOnly: string[];
  layerOnly: string[];
};

export function compareWithTextLayer(lines: ReadonlyArray<{ text: string }>, layerText: string): LayerMismatch | null {
  const layer = counts(numberKeys(layerText));
  const scan = counts(lines.flatMap((line) => numberKeys(line.text)));
  // Too few numbers on either side (an empty or partial layer) proves nothing.
  if (!layer.size || !scan.size) return null;
  const remaining = new Map(layer);
  const flagged: number[] = [];
  const scanOnly: string[] = [];
  lines.forEach((line, index) => {
    let mismatch = false;
    for (const key of numberKeys(line.text)) {
      const left = remaining.get(key) ?? 0;
      if (left > 0) remaining.set(key, left - 1);
      else {
        mismatch = true;
        scanOnly.push(key);
      }
    }
    if (mismatch) flagged.push(index);
  });
  const layerOnly = [...remaining].flatMap(([key, left]) => Array<string>(left).fill(key));
  // A number missing on both sides points at a misread digit; one side only may be a layout split.
  if (!flagged.length || !layerOnly.length) return null;
  return { lines: flagged, scanOnly, layerOnly };
}
