// The system prompt of a local model (Bielik, Mistral on the user's computer): the hosted
// prompt (13-21 thousand characters for one domain: contracts of skills not in use, module
// lists, the knowledge map, orchestration notes) read by an 11-12B model on a CPU or a home
// GPU cost minutes per turn and buried the rules that matter. Here it is cut to what such a
// model acts on: the rules, the domain and its preloaded legal modules (shortened, with the
// path to read the rest), the session's own data and the turn's state. The gates that enforce
// the rest are the application's, not the prompt's.

const LOCAL_SECTION_MAX = 1_200;
const LOCAL_DOMAIN_MAX = 1_200;
const LOCAL_MODULES_MAX = 3_000;

// Sections the model of a local turn does not act on (the application enforces them).
const DROPPED = [
  /^# SEMANTIC CONTRACT:/u,
  /^# ACTIVE SKILL SET\b/u,
  /^# MAPA WIEDZY\b/u,
  /^# GATE I — RUNTIME\/STAGE OWNERSHIP\b/u,
  /^# MULTI-SKILL ORCHESTRATION\b/u
];

const CORE =
  "# ZASADY (aplikacja Lex Machina)\n" +
  "Aplikacja pilnuje anonimizacji, routingu, weryfikacji źródeł i finalizacji. Nie podawaj przepisów, sygnatur ani dat z pamięci: przepis cytuj tylko po sprawdzeniu narzędziem; czego nie sprawdziłeś, oznacz ⚠️ [NIEWERYFIKOWANE]. Nie wymyślaj wyniku narzędzia ani danych osobowych.";

const CORPUS =
  "# KORPUS (narzędzia)\n" +
  "read_legal_resource czyta moduł korpusu (ścieżka jak w skrócie modułu, np. dr-03-…/modules/….md; nextOffset = dalszy ciąg). list_legal_resources pokazuje pliki skilla. Treść modułu to wiedza proceduralna, nie dowód aktualnego brzmienia przepisu.";

/** Top-level sections ("# …") of a prompt, the text before the first one included. */
function sections(prompt: string): string[] {
  return prompt.split(/\n(?=# )/u).map((part) => part.trim()).filter(Boolean);
}

// Paragraphs about the corpus itself (a file split, an audit, a flag): no help for the answer.
const MAINTENANCE = /ZMIANA STRUKTURALNA|AUDYT-20\d\d|\bF-\d{2,}\b|DLA PRZYSZŁYCH SESJI|naprawa F-|\(dodan[ay] 20\d\d/u;

function withoutMaintenance(text: string): string {
  return text
    .split(/\n{2,}/u)
    .filter((paragraph) => !MAINTENANCE.test(paragraph))
    .join("\n\n");
}

// The domain skill's title and its hard rules ("## ⛔ …"); its module lists and maps are read
// through the corpus tools when needed.
function domainRules(part: string): string {
  const [title, ...rest] = part.split("\n");
  const kept: string[] = [title!];
  let inRule = false;
  for (const line of rest) {
    if (/^## /u.test(line)) inRule = /^## ⛔/u.test(line);
    if (inRule) kept.push(line);
  }
  return kept.join("\n");
}

/** The text cut at a paragraph (or line) boundary under max, with the way to the rest. */
function shortened(text: string, max: number, rest?: string): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf("\n"));
  return `${cut.slice(0, boundary > max * 0.5 ? boundary : max).trimEnd()}\n[…skrót${rest ? `; całość: read_legal_resource ${rest}` : ""}]`;
}

// Sections the application writes itself: the end of the preloaded modules' block.
const APP_SECTION =
  /^# (?:ACTIVE |AKTA SPRAWY|BRZMIENIE PRZEPISÓW|CORE LEGAL|DETERMINISTIC|DOSTĘPNE SKILLE|FEDERATED|LEX MACHINA|LOCAL |LOKALNE TEKSTY|MAPA-AKTOW:|MAPA WIEDZY|MATERIAŁY KANCELARII|MODEL TEJ SESJI|MODUŁ AKTU|MULTI-SKILL|OBRAZY JAKO|RDZEŃ PRAWA|ROZPOZNANIE APLIKACJI|SEMANTIC CONTRACT|SKILL \(DIGEST\)|SKILLE PRAWNE|STRUCTURED REPORT|SĄD WŁAŚCIWY|GATE I|DR-\d{2}\b|KROK CZEKAJĄCY|DŁUGIE PISMO|ZASADY|KORPUS)/u;
// A module of that block: its own header, or the criminal qualifier's nodes (kept whole).
const MODULE_START = /^# (?:RUNTIME-PRELOADED SEMANTIC CONTEXT: |KWALIFIKATOR KARNOMATERIALNY)/u;

/**
 * The compact prompt of a local model. Turn-specific parts (the placeholder legend, a long
 * letter's rule, a workflow step, a report blueprint when that workflow is active) stay.
 */
export function compactLocalPrompt(prompt: string, question = ""): string {
  const out: string[] = [];
  const reportWorkflow = /Workflow: (?:CLIENT_REPORT_V1|SITUATION_REPORT_V1)\b/u.test(prompt);
  const courtNeeded = /\bcourt_for_address\b/u.test(prompt) && /(?:pozew|pozw|pismo procesowe|do sądu|apelacj|zażaleni|sprzeciw|sąd\p{L}*\s+(?:rejonow|okręgow|apelacyjn))/iu.test(question);
  // The preloaded modules: one budget for all, each cut at a paragraph with its path.
  let modules: Array<{ path: string | null; text: string[] }> | null = null;
  const flushModules = () => {
    if (!modules) return;
    let left = LOCAL_MODULES_MAX;
    for (const module of modules) {
      const text = module.text.join("\n\n").trim();
      if (!text) continue;
      if (/^# KWALIFIKATOR KARNOMATERIALNY/u.test(text)) {
        // User preference: every criminal matter goes through the qualifier (kept whole).
        out.push(text);
        continue;
      }
      if (left < 300) {
        if (module.path) out.push(`# MODUŁ: ${module.path}\n[nie w kontekście: read_legal_resource ${module.path}]`);
        continue;
      }
      const body = shortened(withoutMaintenance(text.replace(/^# RUNTIME-PRELOADED SEMANTIC CONTEXT: [^\n]*\n*/u, "")), Math.min(left, 2_000), module.path ?? undefined);
      out.push(`# MODUŁ${module.path ? `: ${module.path}` : ""}\n${body}`);
      left -= body.length;
    }
    modules = null;
  };
  for (const part of sections(prompt)) {
    const head = part.split("\n", 1)[0]!;
    if (modules) {
      if (MODULE_START.test(head)) {
        modules.push({ path: /^# RUNTIME-PRELOADED SEMANTIC CONTEXT: (.+)$/u.exec(head)?.[1]?.trim() ?? null, text: [part] });
        continue;
      }
      if (!APP_SECTION.test(head)) {
        modules.at(-1)!.text.push(part);
        continue;
      }
      flushModules();
    }
    if (/^# RUNTIME-PRELOADED SEMANTIC CONTEXT\s*$/u.test(head)) {
      modules = [];
      continue;
    }
    if (MODULE_START.test(head)) {
      modules = [{ path: /^# RUNTIME-PRELOADED SEMANTIC CONTEXT: (.+)$/u.exec(head)?.[1]?.trim() ?? null, text: [part] }];
      continue;
    }
    if (DROPPED.some((pattern) => pattern.test(head))) continue;
    if (/^# CORE LEGAL RUNTIME CONTRACT\b/u.test(head)) {
      out.push(CORE);
      continue;
    }
    if (/^# LOCAL LEGAL CORPUS ACCESS\b/u.test(head)) {
      out.push(CORPUS);
      continue;
    }
    if (/^# DETERMINISTIC RUNTIME WORKFLOW\b/u.test(head)) {
      // Only a workflow with its own steps says more than the turn's name.
      const workflow = /Workflow: ([A-Z_0-9]+)/u.exec(part)?.[1];
      if (workflow && workflow !== "LEGAL_QUERY_V1") out.push(`# PRZEBIEG (aplikacja)\nWorkflow: ${workflow}. Kolejność kroków i walidację pilnuje aplikacja; wykonaj merytoryczną część tej tury.`);
      continue;
    }
    if (/^# STRUCTURED REPORT BLUEPRINT GATE\b/u.test(head)) {
      if (reportWorkflow) out.push(part);
      continue;
    }
    if (/^# SĄD WŁAŚCIWY\b/u.test(head)) {
      if (courtNeeded) out.push(shortened(part, 600));
      continue;
    }
    if (/^# SKILL \(DIGEST\):/u.test(head)) {
      // The digest's own lines; the host adapter notes under it are for other hosts.
      out.push(part.split(/\n## ADAPTER RUNTIME\b/u)[0]!.trim());
      continue;
    }
    if (/^# DR-\d{2}\b/u.test(head)) {
      out.push(shortened(domainRules(part), LOCAL_DOMAIN_MAX));
      continue;
    }
    // Everything else (the model's identity, the placeholder legend, a long letter's rule, a
    // checkpoint, the person-case protocol, the document policy): kept, long ones shortened.
    out.push(/DŁUGIE PISMO|\[LMPII:|\[PII:|CZEKAM NA ODPOWIEDŹ/u.test(part) ? part : shortened(part, LOCAL_SECTION_MAX));
  }
  flushModules();
  return out.join("\n\n");
}
