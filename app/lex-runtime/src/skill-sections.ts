// Sections of a skill file that the application itself executes. The skill's
// author marks such a section with a comment right above its heading:
//
//   <!-- lex:wykonuje-aplikacja: G8 -->
//   ## ZNACZNIK OBOWIĄZKOWY
//
// and the model receives a one-line reference instead of the procedure. Only
// components the application really runs are honoured; any other mark is
// ignored and the section stays. LEX_COMPACT_INSTRUCTIONS=0 sends every file whole.

export const APP_COMPONENTS: Readonly<Record<string, string>> = {
  ANONIMIZACJA: "pseudonimizacja danych przed wysłaniem do modelu (KROK 0A)",
  ROUTING: "wybór skilla wykonawczego z macierzy aktywacji i tabeli routingu KROK 2",
  PROFIL: "profil ścieżki obowiązkowej i wczytanie jej zasobów",
  "REJESTR-KROKOW": "rejestr kroków ścieżki obowiązkowej z faktycznych odczytów",
  "MAPA-AKTOW": "moduły aktów wskazywane mechanicznie z MAPA-AKTOW",
  RESOLVER: "rozwiązywanie adresów skilli i shared/ do jednej kopii korpusu aplikacji (wynik w śladzie KROK 3A)",
  "WERYFIKACJA-ELI": "odczyt przepisów w ELI i rejestr weryfikacji powołań",
  G8: "znaczniki statusu powołań i bramka końcowa HARD GATE (G8)",
  DISCLAIMER: "zastrzeżenie z shared/DISCLAIMER.md dokładane po bramkach",
  "CHECKPOINTY-PISM": "checkpointy pisma procesowego i ich kontrakt odpowiedzi",
  // Not a procedure: the file's change history, kept in the file for the audit.
  HISTORIA: "historia zmian pliku (metadane audytu)"
};

const MARK = /^<!--\s*lex:wykonuje-aplikacja:\s*([A-Z0-9-]+)\s*-->\s*$/u;

export type CompactedSection = { heading: string; component: string; chars: number };

// Frontmatter keys the application reads from the registry itself (skill graph,
// mandatory modules, version history, I/O description). Any other key stays:
// `escalation`, `limitations` and skill-specific keys carry rules for the model.
export const APP_METADATA_KEYS: ReadonlySet<string> = new Set([
  "dependencies",
  "required_modules",
  "changelog",
  "inputs",
  "outputs",
  "entrypoint",
  "compatibility",
  "type",
  "status",
  "confidence",
  "modules",
  "widgets",
  "references",
  "scripts"
]);

function compactFrontmatter(text: string): { text: string; keys: string[]; chars: number } {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
  if (!match) return { text, keys: [], chars: 0 };
  const kept: string[] = [];
  const keys: string[] = [];
  let dropping = false;
  for (const line of match[1]!.split("\n")) {
    const key = /^([A-Za-z_][\w-]*):/u.exec(line)?.[1];
    if (key) {
      dropping = APP_METADATA_KEYS.has(key);
      if (dropping) keys.push(key);
    }
    if (!dropping) kept.push(line);
  }
  if (!keys.length) return { text, keys, chars: 0 };
  const head = `---\n${kept.join("\n")}\n# pominięte metadane (czyta aplikacja): ${keys.join(", ")}\n---\n`;
  return { text: head + text.slice(match[0].length), keys, chars: match[0].length - head.length };
}

// Sections a skill needs only from a later stage of the thread, marked
//   <!-- lex:wczytaj-gdy: KOLEJNA-TURA -->
// above the heading. The application sends them once the stage is reached;
// before that the model gets the heading with a note. Unknown stages: whole.
export const STAGES: Readonly<Record<string, string>> = {
  "KOLEJNA-TURA": "od drugiej tury wątku, gdy jest już odpowiedź asystenta"
};

const STAGE_MARK = /^<!--\s*lex:wczytaj-gdy:\s*([A-Z0-9-]+)\s*-->\s*$/u;

/** A thread with an earlier answer of the assistant (or its summary). */
export function laterTurn(query: string): boolean {
  return /(?:^|\n\n)Asystent: /u.test(query) || query.includes("[Streszczenie wcześniejszej części rozmowy");
}

// `inactive`: components the application does not run in this turn (e.g. DISCLAIMER
// for a local model or structured output); their sections reach the model whole.
// `reached`: stages reached in this turn; undefined = every stage (whole files).
export function compactForModel(
  text: string,
  enabled = process.env.LEX_COMPACT_INSTRUCTIONS !== "0",
  inactive: ReadonlySet<string> = new Set(),
  reached?: ReadonlySet<string>
): { text: string; compacted: CompactedSection[] } {
  if (!enabled) return { text, compacted: [] };
  const front = compactFrontmatter(text);
  const compacted: CompactedSection[] = front.keys.length ? [{ heading: `frontmatter: ${front.keys.join(", ")}`, component: "METADANE", chars: front.chars }] : [];
  text = front.text;
  if (!text.includes("lex:wykonuje-aplikacja") && !(reached && text.includes("lex:wczytaj-gdy"))) return { text, compacted };
  const lines = text.split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.*)$/u.exec(lines[index + 1] ?? "");
    const component = MARK.exec(lines[index]!)?.[1];
    const stage = reached ? STAGE_MARK.exec(lines[index]!)?.[1] : undefined;
    const executed = component && APP_COMPONENTS[component] && !inactive.has(component);
    const deferred = stage && STAGES[stage] && !reached!.has(stage);
    if (!heading || (!executed && !deferred)) {
      out.push(lines[index]!);
      continue;
    }
    const level = heading[1]!.length;
    let end = index + 2;
    let inFence = false;
    for (; end < lines.length; end += 1) {
      if (/^```/u.test(lines[end]!)) inFence = !inFence;
      const next = !inFence ? /^(#{1,6})\s/u.exec(lines[end]!) : null;
      if (next && next[1]!.length <= level) break;
    }
    // A mark right above the next heading belongs to that section, not to this one.
    while (end > index + 2 && (MARK.test(lines[end - 1]!) || STAGE_MARK.test(lines[end - 1]!))) end -= 1;
    const removed = lines.slice(index, end).join("\n");
    if (deferred) {
      out.push(`${heading[1]} ${heading[2]} [etap późniejszy: aplikacja dołączy tę sekcję ${STAGES[stage!]}]`, "");
      compacted.push({ heading: heading[2]!.slice(0, 90), component: `ETAP:${stage}`, chars: removed.length });
    } else {
      out.push(
        ...(component === "HISTORIA"
          ? [`${heading[1]} ${heading[2]} [pominięte: ${APP_COMPONENTS[component]}]`, ""]
          : [
              `${heading[1]} ${heading[2]} [wykonuje aplikacja: ${component}]`,
              `Tę procedurę (${APP_COMPONENTS[component!]}) wykonuje aplikacja; nie powtarzaj jej, stosuj wynik podany przez aplikację.`,
              ""
            ])
      );
      compacted.push({ heading: heading[2]!.slice(0, 90), component: component!, chars: removed.length });
    }
    index = end - 1;
  }
  return { text: out.join("\n"), compacted };
}
