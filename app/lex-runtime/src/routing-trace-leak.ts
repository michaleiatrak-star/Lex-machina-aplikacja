/**
 * The router's KROK 3A trace written by the model into the answer ("TRYB: LAIK", "PRIMARY: dr-02…
 * ROUTER-WCZYTANY: TAK", "WERSJA ROUTERA: 3.74"): the application writes that trace itself from the
 * audit (mandatoryPath.routingTrace), so the model's copy is internal text shown to the user (live
 * B02-P04, C09-058: graders took a point for form every time). Only a block of such lines naming the
 * router's own fields is removed, never a single "TRYB:" line of a letter.
 */
const TRACE_LINE =
  /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:TRYB|PRIMARY|SECONDARY|ODRZUCONE|PROFIL|ODROCZONE|WERSJA ROUTERA|BLUEPRINT|KROK 3A|ŚLAD ROUTINGU)(?:\*\*)?\s*[:—-]/iu;
const TRACE_HEADING = /^\s*(?:#+\s*)?(?:\*\*)?(?:KROK 3A|Ślad routingu|Routing)(?:\*\*)?\s*:?\s*$/iu;
const ROUTER_FIELD = /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:PRIMARY|WERSJA ROUTERA)(?:\*\*)?\s*:/iu;
// A single line naming the router's or resolver's own data ("• WERSJA ROUTERA i RESOLVER: wynik
// aplikacji, nie podano ich w tej turze", user report 2026-11-06): developer data, never the user's.
const DEVELOPER_LINE =
  /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:WERSJA ROUTERA|RESOLVER|ROUTER-WCZYTANY|ŚLAD ROUTINGU)(?:\s+(?:i|oraz)\s+(?:\*\*)?(?:RESOLVER|WERSJA ROUTERA)\b)?[^:\n]{0,40}(?:\*\*)?\s*:|ROUTER-WCZYTANY\s*:/u;

// The model telling the user how the application routed the question ("Aplikacja skierowała tę
// sprawę do `orzeczenia-sadowe-v2` … dociągnąłem `dr-04-prawo-pracy-zus-swiadczenia/SKILL.md`",
// "W DR-04 nie ma dedykowanego modułu (sprawdzony: `mod-KP-….md`)", live test 2026-11-15): skill
// ids, skill files and modules are the application's internals, never part of the answer.
// A skill's file or module is always internal; a bare skill id only in a sentence about the routing
// ("skierowała … do", "dociągnąłem", "PRIMARY") — a proposal to switch ("Proponuję pisma-proste-v2
// (Test B). Czy przełączyć?") names the skill on purpose and stays.
const SKILL_FILE_REF = /\bdr-\d{2}-[a-z]+(?:-[a-z]+)*\/|\bmod-[\w-]+\.md\b|\bSKILL\.md\b|\b(?:shared|references|modules)\/[\w./-]+\.md\b|\b(?:[a-z]+-){1,5}v\d+\/[\w./-]+/u;
const SKILL_ID = /`?\b(?:[a-z]+-){1,5}v\d+\b`?|\bdr-\d{2}-[a-z]+(?:-[a-z]+)*\b/u;
const ROUTING_WORDS = /skierował\p{L}*|skierowan\p{L}*|dociągn\p{L}*|wczytał\p{L}*|wczytan\p{L}*|\bPRIMARY\b|\bSECONDARY\b|routing\p{L}*|posłużył\p{L}*|dedykowan\p{L}*\s+modu\p{L}*/iu;

export function isSkillNarration(line: string): boolean {
  return SKILL_FILE_REF.test(line) || (SKILL_ID.test(line) && ROUTING_WORDS.test(line));
}

export function withoutModelRoutingTrace(text: string): string {
  const lines = text.split("\n");
  const drop = new Set<number>();
  let index = 0;
  while (index < lines.length) {
    if (!TRACE_LINE.test(lines[index]!)) {
      index += 1;
      continue;
    }
    let end = index;
    const traced: number[] = [];
    while (end < lines.length && (TRACE_LINE.test(lines[end]!) || (!lines[end]!.trim() && TRACE_LINE.test(lines[end + 1] ?? "")))) {
      if (lines[end]!.trim()) traced.push(end);
      end += 1;
    }
    if (traced.length >= 3 && traced.some((line) => ROUTER_FIELD.test(lines[line]!))) {
      for (let line = index; line < end; line += 1) drop.add(line);
      const heading = index - 1;
      if (heading >= 0 && TRACE_HEADING.test(lines[heading]!)) drop.add(heading);
    }
    index = end;
  }
  lines.forEach((line, at) => {
    if (DEVELOPER_LINE.test(line) || isSkillNarration(line)) drop.add(at);
  });
  if (drop.size === 0) return text;
  return lines
    .filter((_line, at) => !drop.has(at))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/\n+$/u, text.endsWith("\n") ? "\n" : "");
}
