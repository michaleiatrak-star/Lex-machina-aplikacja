import type { PiiSpan } from "./pseudonymizer.js";

// Street addresses by structure, in the application itself: the same rules as the local
// gazetteer (privacy/polish_pii_gazetteer.py: STREET_ADDRESS_RE, GLUED_STREET_ADDRESS_RE,
// POSTAL_RE), so an address is masked also when the Python worker does not start (a missing
// Morfeusz left every address in clear while names were still found). A line break may fall
// anywhere in an address ("przy ul. Śródziemnomorskiej⏎11/5", "Śródziemno-⏎morskiej 11/5").

// A marker in any letter case ("UL.", "Ul.", "ulicy") without making the name's capitals optional.
const anyCase = (word: string) =>
  [...word].map((char) => (/\p{L}/u.test(char) ? `[${char.toLocaleLowerCase("pl")}${char.toLocaleUpperCase("pl")}]` : char.replace(/[.]/gu, "\\."))).join("");

const MARKER = `(?:${[
  "ul.", "ulica", "ulicą", "ulicę", "ulicy", "ulici", "al.", "aleja", "aleją", "aleję", "alei", "pl.", "plac", "placu", "placem",
  "os.", "osiedle", "osiedla", "osiedlu", "osiedlem", "rondo", "ronda", "rondzie", "rondem", "skwer", "skweru", "skwerze", "skwerem",
  "bulwar", "bulwaru", "bulwarze", "bulwarem", "wybrzeże", "wybrzeża", "wybrzeżu", "wybrzeżem"
]
  .sort((a, b) => b.length - a.length)
  .map(anyCase)
  .join("|")})`;

// A word of a street name; a word split at a line end stays one word ("Śródziemno-⏎morskiej").
const NAME_TOKEN =
  String.raw`(?:\p{Lu}[\p{L}’'-]{0,3}\.(?=\s)|\p{Lu}[\p{L}\p{N}’'-]*(?:-\s*\n\s*\p{Ll}+)?|\d{1,3}(?=\s+\p{Lu})|\d{1,4}-\p{Ll}+|[IVX]{1,4}(?![\p{L}\p{N}])|[„"][^"”\n]{1,30}[”"]|\p{Ll}{1,5}\.(?=\s+\S))`;
const NAME_LINK = "(?:i|pod|za|przy|nad|na|w|we|z|ze|od|do)";
const HOUSE_NUMBER = String.raw`(?:nr\s*)?\d{1,4}[A-Za-z]?(?:\s*[/-]\s*\d{1,4}[A-Za-z]?)?(?:\s*(?:m\.|lok\.|lokal|m)\s*\d{1,4}[A-Za-z]?)?`;
const TOWN = String.raw`\p{Lu}[\p{L}-]+(?:[ -]\p{Lu}[\p{L}-]+){0,2}`;
const POSTAL = String.raw`\d{2}-\d{3}\s+${TOWN}`;
// A contact label after the house number starts the next field ("ul. Lipowa 7⏎Tel. 32-111").
const CONTACT = "(?:[Tt][Ee][Ll]|[Ff][Aa][Xx]|[Kk][Oo][Mm]|[Ee]-?[Mm][Aa][Ii][Ll]|[Ww][Ww][Ww])(?![\\p{L}])";

const STREET_ADDRESS = new RegExp(
  String.raw`(?<![\p{L}\p{N}.@/-])${MARKER}\s+${NAME_TOKEN}(?:\s+(?!${CONTACT})(?:${NAME_LINK}\s+)?${NAME_TOKEN}){0,6}\s+${HOUSE_NUMBER}(?![\p{L}\p{N}/])(?:\s*,?\s*${POSTAL})?`,
  "gu"
);
// OCR drops the space before the house number: "ul. Pukowca15, 40-847 Katowice".
const GLUED_STREET_ADDRESS = new RegExp(
  String.raw`(?<![\p{L}\p{N}.@/-])${MARKER}\s*(?:\p{Lu}\p{Ll}+\s+){0,3}\p{Lu}\p{Ll}+\d{1,4}[A-Za-z]?(?:/\d{1,4}[A-Za-z]?)?(?![\p{L}\p{N}/])(?:\s*,?\s*${POSTAL})?`,
  "gu"
);
const POSTAL_ONLY = new RegExp(String.raw`(?<![\d-])${POSTAL}`, "gu");

export function detectStreetAddresses(text: string): PiiSpan[] {
  const spans: PiiSpan[] = [];
  for (const pattern of [STREET_ADDRESS, GLUED_STREET_ADDRESS, POSTAL_ONLY]) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      const value = match[0].replace(/[\s,]+$/u, "");
      const end = start + value.length;
      if (spans.some((span) => start < span.end && span.start < end)) continue;
      spans.push({ start, end, kind: "ADDRESS", value, confidence: 0.9, source: "AUTO" });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
