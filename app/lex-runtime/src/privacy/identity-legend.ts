// The same person under different placeholders (2026-11-16): every document of a case
// has its own key, so the user (in the question) and the person acquitted in a verdict, or an
// attorney named in full in one document and by surname in another, were different symbols to
// the model; it wrote that the acquittal "concerned another person". The application restores
// the placeholders locally, compares the names and tells the model only which symbols are one
// person, never the name.

const PERSON_TOKEN = /\[(?:LMPII:D\d{2}|PII):PERSON:\d{4}\]/gu;

const fold = (text: string) =>
  text
    .replace(/ł/gu, "l")
    .replace(/Ł/gu, "L")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pl")
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/[\s-]+/u)
    .filter((word) => word.length >= 2);

// A case form to its stem: "Kowalczyka", "Kowalczykowi" -> "kowalczyk"; "Michała" -> "michal";
// "Zawadzkiego" -> "zawadzki".
export function nameStem(word: string): string {
  for (const ending of ["skiego", "skiemu", "skim", "ckiego", "ckiemu", "ckim", "dzkiego"]) {
    if (word.endsWith(ending)) return word.slice(0, word.length - ending.length + 3);
  }
  for (const ending of ["owi", "iem", "em", "ie", "a", "u", "y", "ej", "ą", "e"]) {
    if (word.length - ending.length >= 4 && word.endsWith(ending)) return word.slice(0, -ending.length);
  }
  return word;
}

/** The placeholders of persons in the texts (each once, in order). */
export function personTokens(texts: readonly string[]): string[] {
  return [...new Set(texts.flatMap((text) => text.match(PERSON_TOKEN) ?? []))];
}

/**
 * Groups of placeholders that stand for one person: the same name (case forms aside), and a
 * surname alone joined to the one full name with that surname (none when two persons share it).
 */
export function samePersonGroups(tokens: readonly string[], restore: (token: string) => string | null): string[][] {
  const named = tokens
    .map((token) => ({ token, words: fold(restore(token) ?? "").map(nameStem) }))
    .filter((item) => item.words.length > 0);
  const full = new Map<string, string[]>();
  for (const item of named.filter((entry) => entry.words.length >= 2)) {
    // A given name in another transliteration ("Jurij" / "Yurii", "Aleksandr" / "Oleksandr")
    // with the same surname is the same person: the first key whose surname matches and whose
    // given name is within transliteration distance.
    const exact = [...item.words].sort().join(" ");
    const near = [...full.keys()].find((key) => key !== exact && sameNameAcrossScripts(key.split(" "), item.words));
    const key = full.has(exact) ? exact : near ?? exact;
    full.set(key, [...(full.get(key) ?? []), item.token]);
  }
  // A surname alone: the full names ending with it.
  for (const item of named.filter((entry) => entry.words.length === 1)) {
    const matches = [...full.keys()].filter((key) => key.split(" ").includes(item.words[0]!));
    if (matches.length === 1) full.get(matches[0]!)!.push(item.token);
  }
  return [...full.values()].filter((group) => group.length >= 2).map((group) => [...new Set(group)]).filter((group) => group.length >= 2);
}

// The grammatical gender of a person's name, for the model to inflect a symbol right ("[PII:PERSON:0003]
// zeznała" / "zeznał") without the name: the given name's ending, or the surname's (-ska / -ski).
const MALE_IN_A = new Set(["kuba", "barnaba", "bonawentura", "kosma", "jarema", "nikita", "sasza", "misza", "grisza", "ilia", "ilja", "foma", "zosima"]);
export function grammaticalGender(name: string): "męski" | "żeński" | null {
  const words = fold(name);
  if (!words.length) return null;
  if (words.length >= 2) {
    const given = words[0]!;
    if (MALE_IN_A.has(given)) return "męski";
    return /a$/u.test(given) ? "żeński" : "męski";
  }
  const surname = words[0]!;
  if (/(?:ska|cka|dzka)$/u.test(surname)) return "żeński";
  if (/(?:ski|cki|dzki)$/u.test(surname)) return "męski";
  return null;
}

/** Persons' symbols by grammatical gender (names restored locally, never sent). */
export function genderLegend(tokens: readonly string[], restore: (token: string) => string | null, limit = 120): string {
  const byGender: Record<"męski" | "żeński", string[]> = { męski: [], żeński: [] };
  for (const token of tokens.slice(0, limit)) {
    const name = restore(token);
    const gender = name ? grammaticalGender(name) : null;
    if (gender) byGender[gender].push(token);
  }
  if (!byGender.męski.length && !byGender.żeński.length) return "";
  return [
    "# RODZAJ GRAMATYCZNY OSÓB POD SYMBOLAMI (ustalony lokalnie z imienia; do odmiany, nie do opisu osoby)",
    ...(byGender.męski.length ? [`- męski: ${byGender.męski.join(", ")}`] : []),
    ...(byGender.żeński.length ? [`- żeński: ${byGender.żeński.join(", ")}`] : [])
  ].join("\n");
}

export function identityLegendPrompt(groups: readonly string[][], questionTokens: ReadonlySet<string> = new Set()): string {
  if (!groups.length) return "";
  return [
    "# TE SAME OSOBY POD RÓŻNYMI SYMBOLAMI (ustalone lokalnie przez aplikację)",
    "Każdy dokument ma własne symbole osób. Symbole w jednym wierszu to ta sama osoba (aplikacja porównała nazwiska na tym komputerze, odmiana i samo nazwisko uwzględnione). Traktuj je jako jedną osobę we wszystkich dokumentach; nie pisz, że dokument dotyczy „innej osoby”, gdy jej symbol jest w tym samym wierszu.",
    ...groups.map((group) => `- ${group.join(" = ")}${group.some((token) => questionTokens.has(token)) ? " (osoba wymieniona w pytaniu użytkownika)" : ""}`)
  ].join("\n");
}

// Latin spellings of one Cyrillic name: y/j/i, kh/h/ch, ii/ij/iy at the end, doubled letters.
export function transliterated(word: string): string {
  return word
    .replace(/^y/u, "j")
    // "Iurii", "Iaroslav": the Ukrainian passport spelling of Ю/Я.
    .replace(/^i(?=[aeou])/u, "j")
    .replace(/(?:ii|iy|ij|yj|yi)$/u, "ij")
    .replace(/kh|ch/gu, "h")
    .replace(/y/gu, "i")
    .replace(/(.)\1/gu, "$1");
}

function sameNameAcrossScripts(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  const left = a.map(transliterated).sort();
  const right = b.map(transliterated).sort();
  return left.every((word, index) => word === right[index]);
}
