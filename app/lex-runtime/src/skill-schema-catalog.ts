// A skill's catalogue of document schemas ("SCHEMATY PISM (ładuj TYLKO odpowiedni
// schemat)" in pisma-proste-v2): one row per kind of document with its schema file.
// The application picks the one row the request names and loads only that schema
// (with the files the row says to read first).

export type SchemaEntry = {
  code: string;
  label: string;
  resources: string[];
  alternatives: string[][];
};

const SECTION = /^(#{2,4})\s+SCHEMATY\b.*$/mu;
const FUNCTION_WORDS = new Set([
  "wniosek", "wniosku", "pismo", "pisma", "przez", "oraz", "albo", "lub", "dla", "nad", "pod", "art", "ust",
  "kpc", "kpa", "przed", "po", "do", "od", "na", "o", "w", "z", "ze", "się", "nie", "bez", "jako", "typ", "sekcja"
]);

// One word per stem ("wezwanie", "wezwaniu" -> one).
function keyWords(text: string): string[] {
  const seen = new Set<string>();
  return (text.match(/\p{L}{3,}/gu) ?? [])
    .map((word) => word.toLocaleLowerCase("pl"))
    .filter((word) => !FUNCTION_WORDS.has(word))
    .filter((word) => {
      const stem = word.slice(0, Math.max(4, word.length - 2));
      if (seen.has(stem)) return false;
      seen.add(stem);
      return true;
    });
}

export function parseSchemaCatalog(markdown: string, skill: string): SchemaEntry[] {
  const start = SECTION.exec(markdown);
  if (!start) return [];
  const level = start[1]!.length;
  const rest = markdown.slice(start.index + start[0].length);
  const end = new RegExp(`^#{1,${level}}\\s`, "mu").exec(rest);
  const section = end ? rest.slice(0, end.index) : rest;
  const entries: SchemaEntry[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const code = /\*\*\s*(SP[A-Z](?:-[A-Z])?)\b/u.exec(cells[1]!)?.[1];
    if (!code) continue;
    const own = [...cells[2]!.matchAll(/(?:references|modules|assets|templates)\/[A-Za-z0-9._\-/]+?\.md\b/g)].map((match) => `${skill}/${match[0]}`);
    // "UWAGA: wczytaj najpierw <dr-.../modules/...md>": read before the schema.
    const first = [...cells[3]!.matchAll(/[a-z0-9-]+-v?\d*[a-z0-9-]*\/(?:modules|references)\/[A-Za-z0-9._\-/]+?\.md\b/g)].map((match) => match[0]);
    const kind = cells[3]!.split(/\s+—\s+\*\*UWAGA|\*\*UWAGA/u)[0]!.replace(/\([^)]*\)/g, " ").replace(/\*\*/g, " ");
    const alternatives = kind
      .split(/,|\s\/\s/u)
      .map((part) => keyWords(part))
      .filter((words) => words.length > 0);
    // "Skarga na czynności komornika / na zaniechanie": a one-word part qualifies the first, it is no row of its own.
    const named = alternatives.length > 1 ? alternatives.filter((words) => words.length > 1) : alternatives;
    if (!own.length || !named.length) continue;
    entries.push({ code, label: kind.replace(/\s+/g, " ").trim(), resources: [...first, ...own], alternatives: named });
  }
  return entries;
}

function wordPattern(word: string): RegExp {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (word.length <= 4) return new RegExp(`(?<![\\p{L}])${escape(word)}(?![\\p{L}])`, "iu");
  const base = word.slice(0, Math.max(4, word.length - 2));
  // "wezwanie" -> "wezwani"; "pozew" -> "pozw"
  const dropped = /e[a-ząćęłńóśźż]$/u.test(word) ? word.slice(0, -2) + word.slice(-1) : null;
  const stems = [base, ...(dropped && dropped.length >= 4 ? [dropped.slice(0, Math.max(4, dropped.length - 1))] : [])];
  return new RegExp(`(?<![\\p{L}])(?:${stems.map(escape).join("|")})`, "iu");
}

/** The single schema the text names (most words of one alternative), or null. */
export function matchSchema(entries: SchemaEntry[], text: string): (SchemaEntry & { why: string }) | null {
  let best: { entry: SchemaEntry; hits: number; ratio: number; words: string[] } | null = null;
  for (const entry of entries) {
    for (const words of entry.alternatives) {
      const matched = words.filter((word) => wordPattern(word).test(text));
      if (matched.length < Math.min(words.length, 2)) continue;
      const ratio = matched.length / words.length;
      if (!best || matched.length > best.hits || (matched.length === best.hits && ratio > best.ratio)) {
        best = { entry, hits: matched.length, ratio, words: matched };
      }
    }
  }
  return best ? { ...best.entry, why: `schemat ${best.entry.code}: ${best.entry.label} (${best.words.join(", ")})` } : null;
}
