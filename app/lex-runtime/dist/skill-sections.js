// Sections of a skill file that the application itself executes. The skill's
// author marks such a section with a comment right above its heading:
//
//   <!-- lex:wykonuje-aplikacja: G8 -->
//   ## ZNACZNIK OBOWIĄZKOWY
//
// and the model receives a one-line reference instead of the procedure. Only
// components the application really runs are honoured; any other mark is
// ignored and the section stays. LEX_COMPACT_INSTRUCTIONS=0 sends every file whole.
export const APP_COMPONENTS = {
    ANONIMIZACJA: "pseudonimizacja danych przed wysłaniem do modelu (KROK 0A)",
    ROUTING: "routing KROK 2: dziedzinę wskazała aplikacja, skill wykonawczy wybrał użytkownik w trybie mechanicznym; ślad KROK 3A wypisuje aplikacja",
    PROFIL: "profil ścieżki obowiązkowej i wczytanie jej zasobów",
    "REJESTR-KROKOW": "rejestr kroków ścieżki obowiązkowej z faktycznych odczytów",
    "MAPA-AKTOW": "moduły aktów wskazywane mechanicznie z MAPA-AKTOW",
    RESOLVER: "rozwiązywanie adresów skilli i shared/ do jednej kopii korpusu aplikacji (wynik w śladzie KROK 3A)",
    "WERYFIKACJA-ELI": "odczyt przepisów w ELI i rejestr weryfikacji powołań",
    G8: "znaczniki statusu powołań i bramka końcowa HARD GATE (G8)",
    "STRIP-VER": "usunięcie znaczników weryfikacji z pliku pisma przed zapisem (STRIP-VER-GATE); ślad weryfikacji zostaje w rejestrze i w czacie",
    DISCLAIMER: "zastrzeżenie z shared/DISCLAIMER.md dokładane po bramkach",
    "CHECKPOINTY-PISM": "checkpointy pisma procesowego i ich kontrakt odpowiedzi",
    "WIDGET-DANE": "widget z szablonu korpusu zasilany danymi (show_widget z path i data) oraz pasek eksportu/importu",
    "REJESTR-MODULOW": "rejestr modułów dziedziny: moduły aktów wskazanych w sprawie wczytuje aplikacja (MAPA-AKTOW), pozostałe czytasz narzędziem korpusu; poniżej indeks nazw",
    // Not a procedure: the file's change history, kept in the file for the audit.
    HISTORIA: "historia zmian pliku (metadane audytu)"
};
// Components the application runs only in some turns: their sections are replaced only
// when the caller names them in `optIn` (ROUTING: the mechanical mode, where the user chose
// the executive skill; in AUTO the model routes and reads the section whole).
// REJESTR-MODULOW: in the mechanical mode the application resolves the act modules itself;
// the model keeps an index of names (first line of each description) instead of the register.
export const OPT_IN_COMPONENTS = new Set(["ROUTING", "REJESTR-MODULOW"]);
const MODULE_ENTRY = /^\s*\[[✓☐x ]\]\s*(?:[A-ZĄĆĘŁŃÓŚŹŻ]+\s+)?([\w./-]+)/u;
/** The register reduced to module names and the first line of each description. */
export function moduleIndex(section) {
    const lines = section.split("\n");
    const index = [];
    for (let at = 0; at < lines.length; at += 1) {
        const entry = MODULE_ENTRY.exec(lines[at]);
        if (!entry)
            continue;
        const note = /^\s{6,}\((.*)/u.exec(lines[at + 1] ?? "")?.[1]?.replace(/\)\s*$/u, "").trim();
        index.push(`- ${entry[1]}${note ? ` — ${note.length > 110 ? `${note.slice(0, 110)}…` : note}` : ""}`);
    }
    return index;
}
const MARK = /^<!--\s*lex:wykonuje-aplikacja:\s*([A-Z0-9-]+)\s*-->\s*$/u;
// Frontmatter keys the application reads from the registry itself (skill graph,
// mandatory modules, version history, I/O description). Any other key stays:
// `escalation`, `limitations` and skill-specific keys carry rules for the model.
export const APP_METADATA_KEYS = new Set([
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
function compactFrontmatter(text) {
    const match = /^---\n([\s\S]*?)\n---\n/u.exec(text);
    if (!match)
        return { text, keys: [], chars: 0 };
    const kept = [];
    const keys = [];
    let dropping = false;
    for (const line of match[1].split("\n")) {
        const key = /^([A-Za-z_][\w-]*):/u.exec(line)?.[1];
        if (key) {
            dropping = APP_METADATA_KEYS.has(key);
            if (dropping)
                keys.push(key);
        }
        if (!dropping)
            kept.push(line);
    }
    if (!keys.length)
        return { text, keys, chars: 0 };
    const head = `---\n${kept.join("\n")}\n# pominięte metadane (czyta aplikacja): ${keys.join(", ")}\n---\n`;
    return { text: head + text.slice(match[0].length), keys, chars: match[0].length - head.length };
}
// Sections a skill needs only from a later stage of the thread, marked
//   <!-- lex:wczytaj-gdy: KOLEJNA-TURA -->
// above the heading. The application sends them once the stage is reached;
// before that the model gets the heading with a note. Unknown stages: whole.
export const STAGES = {
    "KOLEJNA-TURA": "etap późniejszy: aplikacja dołączy tę sekcję od drugiej tury wątku, gdy jest już odpowiedź asystenta",
    "ZAMOWIENIA-PUBLICZNE": "sprawa nie dotyczy zamówień publicznych według aplikacji; jeśli jednak dotyczy (KIO, Pzp), przeczytaj tę sekcję z pliku skilla"
};
// The same note in every turn (prompt cache): the section's text follows the prefix once reached.
const STAGE_TAIL_NOTES = {
    "KOLEJNA-TURA": "etap późniejszy: od drugiej tury wątku aplikacja podaje treść tej sekcji niżej, w SEKCJE ETAPU WĄTKU",
    "ZAMOWIENIA-PUBLICZNE": "zamówienia publiczne: gdy sprawa ich dotyczy, aplikacja podaje treść tej sekcji niżej, w SEKCJE ETAPU WĄTKU; jeśli dotyczy, a treści tam brak, przeczytaj ją z pliku skilla"
};
const PUBLIC_PROCUREMENT = /zam[óo]wie\p{L}*\s+publiczn|\bKIO\b|Krajow\p{L}*\s+Izb\p{L}*\s+Odwo|\bPzp\b|\bp\.?z\.?p\b|przetarg|\bSWZ\b|ra[żz][ąa]co\s+nisk|odrzuc\p{L}*\s+ofert|wyklucz\p{L}*\s+wykonawc|zamawiaj[ąa]c/iu;
/** Stages of a skill reached by this turn, from the thread and its matter. */
export function reachedStages(query) {
    return new Set([...(laterTurn(query) ? ["KOLEJNA-TURA"] : []), ...(PUBLIC_PROCUREMENT.test(query) ? ["ZAMOWIENIA-PUBLICZNE"] : [])]);
}
const STAGE_MARK = /^<!--\s*lex:wczytaj-gdy:\s*([A-Z0-9-]+)\s*-->\s*$/u;
/** A thread with an earlier answer of the assistant (or its summary). */
export function laterTurn(query) {
    return /(?:^|\n\n)Asystent: /u.test(query) || query.includes("[Streszczenie wcześniejszej części rozmowy");
}
export function compactForModel(text, enabled = process.env.LEX_COMPACT_INSTRUCTIONS !== "0", inactive = new Set(), reached, optIn = new Set(), tail) {
    if (tail)
        reached = new Set();
    if (!enabled)
        return { text, compacted: [] };
    const front = compactFrontmatter(text);
    const compacted = front.keys.length ? [{ heading: `frontmatter: ${front.keys.join(", ")}`, component: "METADANE", chars: front.chars }] : [];
    text = front.text;
    if (!text.includes("lex:wykonuje-aplikacja") && !(reached && text.includes("lex:wczytaj-gdy")))
        return { text, compacted };
    const lines = text.split("\n");
    const out = [];
    for (let index = 0; index < lines.length; index += 1) {
        const heading = /^(#{1,6})\s+(.*)$/u.exec(lines[index + 1] ?? "");
        const component = MARK.exec(lines[index])?.[1];
        const stage = reached ? STAGE_MARK.exec(lines[index])?.[1] : undefined;
        const executed = component && APP_COMPONENTS[component] && !inactive.has(component) && (!OPT_IN_COMPONENTS.has(component) || optIn.has(component));
        const deferred = stage && STAGES[stage] && !reached.has(stage);
        if (!heading || (!executed && !deferred)) {
            out.push(lines[index]);
            continue;
        }
        const level = heading[1].length;
        let end = index + 2;
        let inFence = false;
        for (; end < lines.length; end += 1) {
            if (/^```/u.test(lines[end]))
                inFence = !inFence;
            const next = !inFence ? /^(#{1,6})\s/u.exec(lines[end]) : null;
            if (next && next[1].length <= level)
                break;
        }
        // A mark right above the next heading belongs to that section, not to this one.
        while (end > index + 2 && (MARK.test(lines[end - 1]) || STAGE_MARK.test(lines[end - 1])))
            end -= 1;
        const removed = lines.slice(index, end).join("\n");
        if (deferred && tail) {
            out.push(`${heading[1]} ${heading[2]} [${STAGE_TAIL_NOTES[stage] ?? STAGES[stage]}]`, "");
            if (tail.reached.has(stage)) {
                tail.sections.push(removed.split("\n").filter((line) => !STAGE_MARK.test(line)).join("\n").trim());
                compacted.push({ heading: heading[2].slice(0, 90), component: `ETAP:${stage}:TURA`, chars: 0 });
            }
            else {
                compacted.push({ heading: heading[2].slice(0, 90), component: `ETAP:${stage}`, chars: removed.length });
            }
        }
        else if (deferred) {
            out.push(`${heading[1]} ${heading[2]} [${STAGES[stage]}]`, "");
            compacted.push({ heading: heading[2].slice(0, 90), component: `ETAP:${stage}`, chars: removed.length });
        }
        else {
            out.push(...(component === "HISTORIA"
                ? [`${heading[1]} ${heading[2]} [pominięte: ${APP_COMPONENTS[component]}]`, ""]
                : component === "REJESTR-MODULOW"
                    ? [`${heading[1]} ${heading[2]} [indeks; ${APP_COMPONENTS[component]}]`, ...moduleIndex(removed), ""]
                    : [
                        `${heading[1]} ${heading[2]} [wykonuje aplikacja: ${component}]`,
                        `Tę procedurę (${APP_COMPONENTS[component]}) wykonuje aplikacja; nie powtarzaj jej, stosuj wynik podany przez aplikację.`,
                        ""
                    ]));
            compacted.push({ heading: heading[2].slice(0, 90), component: component, chars: removed.length });
        }
        index = end - 1;
    }
    return { text: out.join("\n"), compacted };
}
/**
 * One section of a Markdown file: from the first heading line matching `heading` to the
 * next heading of the same or a higher level. Lines inside ``` blocks are not headings
 * (a report template with "## 1. IDENTYFIKACJA" in a code block stays in its section).
 */
export function markdownSection(text, heading) {
    const lines = text.split("\n");
    let inFence = false;
    let start = -1;
    let level = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\s*```/u.test(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence)
            continue;
        const match = /^(#{1,6})\s+(.*)$/u.exec(line);
        if (!match)
            continue;
        if (start < 0) {
            if (heading.test(line)) {
                start = index;
                level = match[1].length;
            }
        }
        else if (match[1].length <= level) {
            return lines.slice(start, index).join("\n").trim();
        }
    }
    return start < 0 ? "" : lines.slice(start).join("\n").trim();
}
/** The stage sections of this turn, after the cached prefix; null when none. */
export function stageTailPrompt(sections) {
    const unique = [...new Set(sections)];
    return unique.length ? ["# SEKCJE ETAPU WĄTKU (aplikacja; pełna treść sekcji oznaczonych w skillach wyżej)", ...unique].join("\n\n") : null;
}
