import type { EventDateCheck } from "./event-date-check.js";
import { detectLegalReferences } from "./finalization-gate.js";
import type { VerificationRecord } from "./verification-ledger.js";

/**
 * Model of the mandatory path of a legal turn, read from the corpus
 * (prawny-router-v3/references/PROFIL-LEKKI.md: irreducible core R-1…R-5 and
 * the closed table of mechanical triggers) and checked against what really
 * happened (audit events, verification registry, the answer). Four layers:
 * ROUTER, SKILL (the skills called in the turn), VERIFICATION and HARD_GATE.
 * The register comes from the runtime, never from the model's own account.
 */
export type PathLayer = "ROUTER" | "SKILL" | "VERIFICATION" | "HARD_GATE";
export type PathStepStatus = "MET" | "MISSING" | "NOT_TRIGGERED" | "NOT_EVALUATED";

export type PathStep = {
  layer: PathLayer;
  id: string;
  label: string;
  requirement: "CORE" | "TRIGGERED" | "CONDITIONAL";
  status: PathStepStatus;
  // Who did it: the application (runtime) or the model.
  by?: "APLIKACJA" | "MODEL";
  evidence: string;
};

export const ROUTER_SKILL = "prawny-router-v3";
const PROFILE = "references/PROFIL-LEKKI.md";

export type PathProfile = "LEKKI" | "PELNY";

export type MandatoryPathReport = {
  source: string;
  profile: PathProfile;
  complete: boolean;
  degraded: boolean;
  steps: PathStep[];
  missing: string[];
  // KROK 3A, wypisany przez aplikację z audytu.
  routingTrace?: string;
};

export type MandatoryPathModel = {
  source: string;
  core: Array<{ id: string; resource: string; label: string }>;
  triggered: Array<{ resources: string[]; trigger: string; deadline: string }>;
  // Profile PEŁNY: modules the router's mandatory gates point to ("ŁADOWANE
  // ZAWSZE", UP-6, rules 11a/12a/12b/12c/24) and the steps each gate names.
  full: Array<{ resource: string; rule: string; block?: string; steps: string[]; whenDocuments?: true }>;
};

const ROUTER_FILE = `${ROUTER_SKILL}/SKILL.md`;
const RESOURCE_PATH = /(?:shared|references)\/[A-Z0-9][A-Z0-9-]*\.md/g;

// Gate blocks and the step identifiers read from each module.
const GATES: Record<string, { block: string; step: RegExp }> = {
  "MOD-CN-GATE.md": { block: "CN-GATE", step: /\bCN-\d+\b/g },
  "MOD-REM-GATE.md": { block: "REM-GATE", step: /\bREM-\d+\b/g },
  "MOD-WYJATEK-GATE.md": { block: "WYJ-GATE", step: /\bS[1-4]\b/g },
  "MOD-STEP-TRACKER.md": { block: "ST", step: /\bST-INIT\b/g }
};

/** The PEŁNY profile from the router file and the modules its mandatory gates name. */
export function parseFullProfile(router: string, read: (resource: string) => string | null): MandatoryPathModel["full"] {
  const always = /## ŁADOWANE ZAWSZE[\s\S]*?(?=\n## )/.exec(router)?.[0] ?? "";
  const ruleLines = router
    .split("\n")
    .filter((line) => /UP-6|Reguła 1[12][a-c]|Reguła 24/.test(line))
    .join("\n");
  const entries = new Map<string, { rule: string; whenDocuments: boolean }>();
  // A point of "ŁADOWANE ZAWSZE" may be conditional ("Gdy w tej turze użytkownik dostarczył dokument…").
  const points = always.split(/\n(?=\d+\.\s)/);
  for (const point of points) {
    const lines = point.split("\n");
    for (const [index, line] of lines.entries()) {
      const conditional = /dostarczył dokument|wkleił|akta|korespondencj/i.test(lines.slice(Math.max(0, index - 2), index + 1).join(" "));
      for (const match of line.matchAll(RESOURCE_PATH)) {
        const resource = canonicalPath(match[0]);
        if (!entries.has(resource)) entries.set(resource, { rule: "ŁADOWANE ZAWSZE", whenDocuments: conditional });
      }
    }
  }
  for (const match of ruleLines.matchAll(RESOURCE_PATH)) {
    const resource = canonicalPath(match[0]);
    if (!entries.has(resource)) entries.set(resource, { rule: "reguły bramek (UP-6, 11a, 12a–12c, 24)", whenDocuments: false });
  }
  return [...entries.entries()].map(([resource, entry]) => {
    const gate = GATES[basename(resource)];
    const content = gate ? read(resource) ?? "" : "";
    const steps = gate ? [...new Set(content.match(gate.step) ?? [])].sort() : [];
    return {
      resource,
      rule: entry.whenDocuments ? `${entry.rule} (gdy w turze jest dokument)` : entry.rule,
      ...(gate ? { block: gate.block } : {}),
      steps,
      ...(entry.whenDocuments ? { whenDocuments: true as const } : {})
    };
  });
}

/** Both profiles from the corpus; fails closed when a canonical file is unreadable. */
export function loadMandatoryPathModel(read: (resource: string) => string | null): MandatoryPathModel {
  const profile = read(canonicalPath(PROFILE));
  const router = read(ROUTER_FILE);
  if (!profile || !router) throw new Error("MANDATORY_PATH_MODEL_UNREADABLE");
  return { ...parseMandatoryPathModel(profile), full: parseFullProfile(router, read) };
}


// Corpus paths are router-relative ("references/X") or skill-qualified ("shared/X").
export function canonicalPath(resource: string): string {
  const clean = resource.trim().replace(/^\/+/, "");
  return clean.startsWith("references/") ? `${ROUTER_SKILL}/${clean}` : clean;
}

const CRIMINAL_QUALIFIER = "dr-03-prawo-karne-wykroczenia-egzekucja/modules/mod-KK-kwalifikator-karnomaterialny.md";

export function parseMandatoryPathModel(profile: string): MandatoryPathModel {
  const core = [...profile.matchAll(/^(R-\d)\s+(\S+)\s+—\s+(.+)$/gm)].map((match) => ({
    id: match[1]!,
    resource: canonicalPath(match[2]!),
    label: match[3]!.trim()
  }));
  const triggered: MandatoryPathModel["triggered"] = [];
  // Only the table of the deferred layer (the cost table also has backticks).
  const deferred = /## WARSTWA ODROCZONA[\s\S]*?(?=\n## |$)/.exec(profile)?.[0] ?? "";
  for (const line of deferred.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 5 || !cells[1]!.includes("`")) continue;
    const resources = [...cells[1]!.matchAll(/`([^`]+)`/g)]
      .map((match) => match[1]!)
      .map((resource) => (resource.startsWith("dr-03/") && resource.includes("kwalifikator") ? CRIMINAL_QUALIFIER : resource))
      .map((resource) => (/^[A-Z][A-Z0-9-]+\.md$/.test(resource) ? `shared/${resource}` : resource))
      .map(canonicalPath);
    triggered.push({ resources, trigger: cells[2]!, deadline: cells[3]! });
  }
  if (core.length < 5 || triggered.length === 0) throw new Error("MANDATORY_PATH_MODEL_UNREADABLE");
  return { source: canonicalPath(PROFILE), core, triggered, full: [] };
}

/**
 * PEŁNY for a typical professional matter, and always where PROFIL-LEKKI
 * forbids the light profile (criminal matter, document generation); LEKKI
 * for simple questions and lay users.
 */
export function pathProfile(args: { mode: "LAIK" | "PRAWNIK"; simple: boolean; criminal: boolean; documentGeneration: boolean }): PathProfile {
  if (args.criminal || args.documentGeneration) return "PELNY";
  return args.mode === "PRAWNIK" && !args.simple ? "PELNY" : "LEKKI";
}

export type TurnFacts = {
  profile: PathProfile;
  // Resources the runtime put into the model's context this turn.
  contextResources: Set<string>;
  query: string;
  answer: string;
  legal: boolean;
  criminal: boolean;
  documents: boolean;
  documentsTruncated: boolean;
  documentGeneration: boolean;
  foreignJurisdiction: boolean;
  federationTools: boolean;
  records: VerificationRecord[];
  // Audit events of the turn (type, target, status, detail).
  events: Array<{ type: string; target: string; status: string; detail?: Record<string, unknown> }>;
  loadedSkills: string[];
  primarySkill: string;
  finalization: string;
  // PRAWO-HARDGATE KROK 4: brzmienie na dzień zdarzenia z pytania (aplikacja, ELI asOf).
  eventDateCheck?: EventDateCheck;
  // KROK 7: kto dał disclaimer na końcu odpowiedzi (aplikacja dokłada brakujący).
  disclaimerBy?: "MODEL" | "APLIKACJA";
};

const DATE = /\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b|\b\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4}\b/giu;
const ARTICLE = /\bart\.?\s*\d+/i;

// Triggers known before the answer (the runtime can load the resource up front).
type PreFacts = Pick<TurnFacts, "profile" | "query" | "legal" | "criminal" | "documents" | "documentsTruncated" | "documentGeneration" | "foreignJurisdiction">;

function preTrigger(name: string, facts: PreFacts): boolean | null {
  switch (name) {
    case "MOD-CN-GATE.md":
    case "MOD-REM-GATE.md":
      // UP-6: every case; read up front in PEŁNY, on the first ruling in LEKKI.
      return facts.profile === "PELNY" ? facts.legal : false;
    case "MOD-WYJATEK-GATE.md":
      return facts.legal && ARTICLE.test(facts.query);
    case "MOD-OS-CZASU-PRZESLANEK.md":
      return (facts.query.match(DATE) ?? []).length >= 2;
    case "MOD-SKAN-DOWODOW-KOMPLETNY.md":
      return facts.documents;
    case "MOD-PORCJOWANIE-DOWODOW.md":
      return facts.documentsTruncated;
    case "MOD-KONTEKST-SESJI.md":
      return /#\s*KONTEKST SESJI|masz kontekst|wczytaj sesj|plik z poprzedniej sesji/i.test(facts.query);
    case "MOD-REJESTR-POKRYCIA-JEDNOSTEK.md":
      return (facts.query.match(/^\s*\d+[.)]\s/gm) ?? []).length >= 10;
    case "PRAWO-HARDGATE-AKT-MIEJSCOWY.md":
      return /akt\w* prawa miejscowego|miejscow\w+ plan\w*|uchwał\w* rady (gminy|miasta|powiatu)/i.test(facts.query);
    case "MIEDZYNARODOWE-GATES.md":
    case "HIERARCHIA-ZRODEL-MIEDZYNARODOWE.md":
      return facts.foreignJurisdiction;
    case "PRE-W2-VERIFICATION-GATE.md":
    case "CP-GATE.md":
    case "HYBRID-VALIDATION.md":
    case "MOD-REJESTR-ZALACZNIKOW-CHECKPOINT.md":
      return facts.documentGeneration;
    case "mod-KK-kwalifikator-karnomaterialny.md":
      return facts.criminal;
    case "DOSTEP-MASZYNOWY-API.md":
      return false; // The application has no code channel (bash/curl).
    default:
      return null;
  }
}

const basename = (resource: string): string => resource.split("/").at(-1)!;

/** Resources the runtime loads up front for this turn (triggers known before the answer). */
export function preloadForTurn(model: MandatoryPathModel, facts: PreFacts): string[] {
  if (!facts.legal) return [];
  const core = model.core.map((item) => item.resource);
  const triggered = model.triggered.flatMap((row) =>
    row.resources.filter((resource) => preTrigger(basename(resource), facts) === true)
  );
  const full = facts.profile === "PELNY" ? model.full.filter((item) => !item.whenDocuments || facts.documents).map((item) => item.resource) : [];
  // The qualifier index is preloaded by the engine (criminal-qualifier).
  return [...new Set([...core, ...full, ...triggered])].filter((resource) => resource !== CRIMINAL_QUALIFIER);
}

function readEvidence(facts: Pick<TurnFacts, "events" | "contextResources">, resource: string): { by: "APLIKACJA" | "MODEL"; detail: string } | null {
  const target = canonicalPath(resource);
  if (facts.contextResources.has(target)) return { by: "APLIKACJA", detail: "wczytany przez aplikację do kontekstu modelu" };
  for (const event of facts.events) {
    if ((event.type !== "resource_read" && event.type !== "skill_read") || event.status !== "OK") continue;
    const read = canonicalPath(event.target);
    if (read !== target && !(event.type === "skill_read" && `${read}/SKILL.md` === target)) continue;
    const detail = String(event.detail?.detail ?? event.detail?.tool ?? "");
    // Required-module availability checks (G39L) only prove the file exists.
    if (!detail && event.type === "resource_read") continue;
    return /runtime-preload/.test(detail) ? { by: "APLIKACJA", detail: "wczytany przez aplikację do kontekstu modelu" } : { by: "MODEL", detail: `odczyt modelu (${detail || "skill"})` };
  }
  return null;
}

// Post-answer triggers and what the application did instead of the model.
function postTrigger(name: string, facts: TurnFacts): boolean | null {
  const references = detectLegalReferences(facts.answer);
  switch (name) {
    case "HIERARCHIA-ZRODEL.md":
      return /https?:\/\//.test(facts.answer);
    case "ZRODLA-AKTOW-FALLBACK.md":
      return references.some((reference) => reference.kind === "statute");
    case "MOD-WYJATEK-GATE.md":
      return facts.legal && ARTICLE.test(facts.answer);
    case "DISCLAIMER.md":
      return facts.legal && references.length > 0;
    case "TABELE-OPLAT.md":
      return /(opłat|wpis|taks)\w*[^.\n]{0,80}\d[\d\s]*(?:,\d+)?\s*(?:zł|PLN)/i.test(facts.answer);
    case "PRAWO-HARDGATE-BLOKADA.md":
      return facts.records.some((record) => record.substituteFor === "R1" || record.officialAnchor);
    case "MOD-STEP-TRACKER.md":
      return facts.legal;
    case "MOD-CN-GATE.md":
    case "MOD-REM-GATE.md":
      // The first ruling, claim or qualification: an answer citing the law.
      return facts.legal && references.length > 0;
    case "MCP-INTEGRACJA.md":
      return facts.federationTools;
    default:
      return null;
  }
}

function applicationDid(name: string, facts: TurnFacts): string | null {
  switch (name) {
    case "MOD-STEP-TRACKER.md":
      return "rejestr kroków (ST-INIT) prowadzi aplikacja: ten rejestr";
    case "HIERARCHIA-ZRODEL.md": {
      const urls = facts.answer.match(/https?:\/\/[^\s)\]]+/g) ?? [];
      const markerUrls = new Set(
        (facts.answer.match(/\[(?:VER|KOTWICA-URZĘDOWA):\s*(https?:\/\/[^\s,\]]+)/g) ?? []).map((marker) => marker.replace(/^\[[^:]+:\s*/, ""))
      );
      return urls.length > 0 && urls.every((url) => markerUrls.has(url))
        ? "każdy adres w odpowiedzi to znacznik z rejestru weryfikacji; RZĄD źródła nadała aplikacja"
        : null;
    }
    case "ZRODLA-AKTOW-FALLBACK.md":
      return facts.records.some((record) => record.kind === "statute")
        ? "tekst aktów pobrała aplikacja (Sejm ELI, kopia ELI przy awarii)"
        : null;
    case "MCP-INTEGRACJA.md":
      return "konektory MCP podłącza i opisuje aplikacja (prompt narzędzi)";
    default:
      return null;
  }
}

// "Odpytuję ISAP", "sprawdziłem w SAOS": a claim of running a source.
const EXECUTION_CLAIM = /(odpytuj\w*|odpytał\w*|sprawdził\w*|sprawdzam|zweryfikował\w*|weryfikuj\w*|pobrał\w*|pobieram|wyszukał\w*|wyszukuj\w*|przeszukał\w*)[^.\n]{0,60}?\b(ISAP|SAOS|CBOSA|EUR-?Lex|KRS|UODO|EUREKA|Sejm ELI|ELI|SN)\b/giu;
const SOURCE_TOOL: Record<string, RegExp> = {
  ISAP: /isap|eli|core_law|verify_legal/i,
  ELI: /isap|eli|core_law|verify_legal/i,
  "SEJM ELI": /isap|eli|core_law|verify_legal/i,
  SAOS: /saos|case/i,
  CBOSA: /cbosa|case/i,
  EURLEX: /eurlex|eur-lex|tsue/i,
  "EUR-LEX": /eurlex|eur-lex|tsue/i,
  KRS: /krs/i,
  UODO: /uodo/i,
  EUREKA: /eureka/i,
  SN: /sn|case|saos/i
};

export function evaluateMandatoryPath(model: MandatoryPathModel, facts: TurnFacts): MandatoryPathReport {
  const steps: PathStep[] = [];
  const legal = facts.legal;

  // ROUTER: core R-1…R-5.
  for (const item of model.core) {
    const read = readEvidence(facts, item.resource);
    steps.push({
      layer: "ROUTER",
      id: item.id,
      label: `${item.id} ${basename(item.resource)} — ${item.label}`,
      requirement: "CORE",
      status: !legal ? "NOT_TRIGGERED" : read ? "MET" : "MISSING",
      ...(read ? { by: read.by } : {}),
      evidence: read?.detail ?? (legal ? "brak odczytu w tej turze" : "tura bez sprawy prawnej")
    });
  }
  // KROK 0A is also executed by the application itself.
  const privacy = facts.events.find((event) => event.target === "G39I_CHAT_PRIVACY");
  steps.push({
    layer: "ROUTER",
    id: "KROK-0A-WYKONANIE",
    label: "Anonimizator: pseudonimizacja przed wysłaniem do modelu",
    requirement: "CORE",
    status: privacy?.status === "OK" ? "MET" : "MISSING",
    by: "APLIKACJA",
    evidence: privacy?.status === "OK" ? `lokalnie przez aplikację (symboli: ${String(privacy.detail?.pseudonymized ?? 0)})` : "brak zdarzenia G39I_CHAT_PRIVACY"
  });

  // ROUTER: the closed table of triggers.
  for (const row of model.triggered) {
    for (const resource of row.resources) {
      const name = basename(resource);
      const pre = legal ? preTrigger(name, facts) : false;
      const post = legal ? postTrigger(name, facts) : false;
      const fired = pre === true || post === true;
      const read = readEvidence(facts, resource);
      const instead = fired && !read ? applicationDid(name, facts) : null;
      const unknown = pre === null && post === null;
      steps.push({
        layer: "ROUTER",
        id: name.replace(/\.md$/, ""),
        label: `${name} — wyzwalacz: ${row.trigger}`,
        requirement: "TRIGGERED",
        status: unknown && !read ? "NOT_EVALUATED" : !fired && !read ? "NOT_TRIGGERED" : read || instead ? "MET" : "MISSING",
        ...(read ? { by: read.by } : instead ? { by: "APLIKACJA" as const } : {}),
        evidence: read?.detail ?? instead ?? (unknown ? "wyzwalacz bez mechanicznej oceny w aplikacji" : fired ? `wyzwalacz padł, brak odczytu (najpóźniej: ${row.deadline})` : "wyzwalacz nie padł")
      });
    }
  }

  // PEŁNY: every module of the router's mandatory gates, read and applied
  // visibly (the block and each step it names).
  if (facts.profile === "PELNY" && legal) {
    const core = new Set(model.core.map((item) => item.resource));
    for (const item of model.full.filter((entry) => !core.has(entry.resource) && (!entry.whenDocuments || facts.documents))) {
      const name = basename(item.resource);
      const read = readEvidence(facts, item.resource);
      steps.push({
        layer: "ROUTER",
        id: `PELNY:${name.replace(/\.md$/, "")}`,
        label: `${name} — ${item.rule}`,
        requirement: "CORE",
        status: read ? "MET" : "MISSING",
        ...(read ? { by: read.by } : {}),
        evidence: read?.detail ?? "brak odczytu w tej turze"
      });
      if (!item.block || item.block === "ST") continue;
      const gate = item.block;
      if (gate === "WYJ-GATE" && !ARTICLE.test(facts.answer)) continue;
      const visible = new RegExp(gate.replace("-", "[- ]?"), "i").test(facts.answer);
      const shown = item.steps.filter((step) => new RegExp(`\\b${step}\\b`).test(facts.answer));
      steps.push({
        layer: "ROUTER",
        id: `${gate}-BLOK`,
        label: `Blok ${gate} w odpowiedzi${item.steps.length ? ` z krokami ${item.steps.join(", ")}` : ""}`,
        requirement: "CORE",
        status: visible && shown.length === item.steps.length ? "MET" : "MISSING",
        by: "MODEL",
        evidence: !visible
          ? "brak bloku w odpowiedzi"
          : shown.length === item.steps.length
            ? "blok i wszystkie kroki obecne"
            : `brak kroków: ${item.steps.filter((step) => !shown.includes(step)).join(", ")}`
      });
    }
  }

  // SKILL: the skills called in the turn and their runtime-required reads.
  for (const skill of [...new Set([facts.primarySkill, ...facts.loadedSkills])].filter((name) => name && name !== "AUTO")) {
    const events = facts.events.filter((event) => event.type === "skill_read" && event.target === skill);
    const read = events.find((event) => event.status === "OK");
    const partial = events.find((event) => event.status === "DEGRADED");
    const how = String(read?.detail?.how ?? "");
    steps.push({
      layer: "SKILL",
      id: `SKILL:${skill}`,
      label: `${skill}/SKILL.md`,
      requirement: "CORE",
      status: read ? "MET" : "MISSING",
      by: how === "tool" || how === "native" ? "MODEL" : "APLIKACJA",
      evidence: read
        ? how === "tool"
          ? `przeczytany w całości (${String(read.detail?.totalChars ?? "")} znaków)`
          : how === "native"
            ? "odczyt modelu narzędziem Read"
            : "wczytany do kontekstu"
        : partial
          ? `przeczytany tylko w części: ${String(partial.detail?.readChars ?? "?")} z ${String(partial.detail?.totalChars ?? "?")} znaków (dalsza część przez nextOffset)`
          : "brak odczytu skilla"
    });
  }
  for (const event of facts.events.filter((item) => item.target === "G39H_WORKFLOW_RESOURCE_READS")) {
    const missing = (event.detail?.missing as string[] | undefined) ?? [];
    const required = (event.detail?.required as string[] | undefined) ?? [];
    if (required.length === 0) continue;
    steps.push({
      layer: "SKILL",
      id: `WORKFLOW:${String(event.detail?.workflow ?? "")}`,
      label: `Odczyty wymagane przez workflow ${String(event.detail?.workflow ?? "")}`,
      requirement: "CORE",
      status: missing.length === 0 ? "MET" : "MISSING",
      by: "MODEL",
      evidence: missing.length === 0 ? `${required.length} odczytów` : `brak: ${missing.join(", ")}`
    });
  }

  // VERIFICATION: every statute reference of the answer against the registry.
  const references = detectLegalReferences(facts.answer).filter((reference) => reference.kind === "statute");
  const verifiedLines = references.filter((reference) => /✅\s*\[VER:/.test(reference.lineText)).length;
  const markedLines = references.filter((reference) => /NIEWERYFIKOWANE|🟨\s*\[KOTWICA/.test(reference.lineText)).length;
  steps.push({
    layer: "VERIFICATION",
    id: "VER-GRAIN",
    label: "Każde powołanie przepisu ze statusem z rejestru weryfikacji",
    requirement: "CORE",
    status: !legal || references.length === 0 ? "NOT_TRIGGERED" : verifiedLines + markedLines >= references.length ? "MET" : "MISSING",
    by: "APLIKACJA",
    evidence: references.length
      ? `${references.length} powołań: ${verifiedLines} ze znacznikiem ✅ z rejestru, ${markedLines} oznaczonych jako niezweryfikowane; znaczniki wstawia aplikacja (kotwica #page/#id wskazuje jednostkę redakcyjną, to nie rozbieżność)`
      : "brak powołań przepisów"
  });
  steps.push({
    layer: "VERIFICATION",
    id: "REJESTR",
    label: "Weryfikacja w źródle w tej turze lub z pamięci sprawy po kontroli ELI",
    requirement: "CONDITIONAL",
    status: facts.records.length ? "MET" : references.length ? "MISSING" : "NOT_TRIGGERED",
    by: "APLIKACJA",
    evidence: facts.records.length
      ? `${facts.records.filter((record) => record.status === "VERIFIED").length} VERIFIED, ${facts.records.filter((record) => record.status !== "VERIFIED").length} pozostałych`
      : "brak rekordów weryfikacji"
  });

  const eventCheck = facts.eventDateCheck;
  if (legal && eventCheck && eventCheck.dates.length > 0) {
    const open = eventCheck.items.filter((item) => item.result !== "SAME");
    steps.push({
      layer: "VERIFICATION",
      id: "KROK-4-DATA-ZDARZENIA",
      label: `Brzmienie przepisów na dzień zdarzenia (${eventCheck.dates.join(", ")})`,
      requirement: "CONDITIONAL",
      status: eventCheck.items.length === 0 ? "NOT_TRIGGERED" : open.length === 0 ? "MET" : "MISSING",
      by: "APLIKACJA",
      evidence: eventCheck.items.length
        ? eventCheck.items.map((item) => `${item.claim}: ${item.detail}`).join("; ")
        : "brak przepisów zweryfikowanych w brzmieniu aktualnym"
    });
  }

  if (legal && facts.disclaimerBy) {
    steps.push({
      layer: "HARD_GATE",
      id: "DISCLAIMER-OSTATNI",
      label: "Disclaimer z shared/DISCLAIMER.md jako ostatni element odpowiedzi (KROK 7)",
      requirement: "CORE",
      status: "MET",
      by: facts.disclaimerBy,
      evidence: facts.disclaimerBy === "APLIKACJA" ? "model go nie dał; dołożyła aplikacja (wariant trybu)" : "na końcu odpowiedzi modelu"
    });
  }

  // HARD GATE: finalization and claims of running a source.
  steps.push({
    layer: "HARD_GATE",
    id: "G8",
    label: "Bramka końcowa HARD GATE (G8)",
    requirement: "CORE",
    status: !legal ? "NOT_TRIGGERED" : facts.finalization === "BLOCKED" ? "MISSING" : "MET",
    by: "APLIKACJA",
    evidence: `wynik ${facts.finalization}${facts.finalization === "DEGRADED" ? " (niezweryfikowane powołania oznaczone, odpowiedź robocza)" : ""}`
  });
  const tools = facts.events
    .filter((event) => event.status === "OK" && (event.type === "tool_decision" || event.type === "resource_read" || event.type === "tool_call"))
    .map((event) => `${event.target} ${String(event.detail?.tool ?? "")}`)
    .join(" ");
  const recordSources = facts.records.map((record) => `${record.sourceUrl ?? ""} ${record.verificationMethod ?? ""}`).join(" ");
  const unbacked = [...facts.answer.matchAll(EXECUTION_CLAIM)]
    .map((match) => ({ text: match[0], source: match[2]!.toUpperCase().replace("EURLEX", "EUR-LEX") }))
    .filter((claim) => !(SOURCE_TOOL[claim.source] ?? /./).test(`${tools} ${recordSources}`));
  steps.push({
    layer: "HARD_GATE",
    id: "DEKLARACJE-WYKONANIA",
    label: "Opis odpytywania źródeł tylko po faktycznym wywołaniu",
    requirement: "CORE",
    status: unbacked.length ? "MISSING" : "MET",
    by: "MODEL",
    evidence: unbacked.length
      ? `bez zdarzenia w przebiegu: ${unbacked.map((claim) => `„${claim.text.trim()}”`).join("; ")}`
      : "każdy opis odpytania źródła ma zdarzenie w przebiegu"
  });

  const missing = steps.filter((step) => step.status === "MISSING").map((step) => step.id);
  return {
    source: model.source,
    profile: facts.profile,
    complete: missing.length === 0,
    degraded: steps.some((step) => step.requirement === "CORE" && step.layer === "ROUTER" && step.status === "MISSING"),
    steps,
    missing
  };
}

const MARK: Record<PathStepStatus, string> = { MET: "spełniony", MISSING: "BRAK", NOT_TRIGGERED: "nie dotyczy", NOT_EVALUATED: "nie oceniany" };

/** What the model is told before answering: the profile and the gates it must show. */
export function mandatoryPathInstructions(model: MandatoryPathModel, profile: PathProfile, preloaded: string[]): string {
  const lines = [
    `# ŚCIEŻKA OBOWIĄZKOWA — PROFIL ${profile === "PELNY" ? "PEŁNY" : "LEKKI"} (ustalony przez aplikację)`,
    `Źródło: ${model.source} i ${ROUTER_FILE}. Aplikacja wczytała do kontekstu: ${preloaded.map(basename).join(", ") || "rdzeń"}; nie otwieraj ich ponownie.`,
    "Rejestr kroków (ST-INIT) prowadzi aplikacja na podstawie audytu; nie opisuj kroków, których nie wykonałeś, i nie opisuj odpytywania źródeł bez wywołania narzędzia."
  ];
  if (profile === "PELNY") {
    const gates = model.full.filter((item) => item.block && item.block !== "ST");
    lines.push(
      "Sprawa prawnicza typowa: wykonaj bramki obowiązkowe routera i pokaż je w odpowiedzi jako widoczne bloki z krokami:",
      ...gates.map((item) => `- ${item.block}${item.steps.length ? `: ${item.steps.join(", ")}` : ""} (${basename(item.resource)})${item.block === "WYJ-GATE" ? " — przy pierwszym powołaniu aktu" : ""}`),
      "Każdy przepis ze statusem z rejestru weryfikacji (VER-GRAIN); disclaimer z shared/DISCLAIMER.md na końcu."
    );
  } else {
    lines.push("Sprawa prosta lub pytanie laika: rdzeń R-1…R-5 obowiązuje; zasoby warunkowe czytaj na wyzwalacz z tabeli PROFIL-LEKKI (CN-GATE i REM-GATE przy pierwszym rozstrzygnięciu).");
  }
  return lines.join("\n");
}

/** The register as text for the next turn (the model answers from facts). */
export function mandatoryPathPrompt(report: MandatoryPathReport, at: string): string {
  const relevant = report.steps.filter((step) => step.status === "MET" || step.status === "MISSING");
  return [
    `# PRZEBIEG POPRZEDNIEJ ODPOWIEDZI (rejestr aplikacji, profil ${report.profile === "PELNY" ? "PEŁNY" : "LEKKI"}, ${at.slice(0, 16).replace("T", " ")})`,
    "Rejestr kroków obowiązkowych prowadzi aplikacja na podstawie audytu, nie relacji modelu. Pytany o przebieg, odpowiadaj z tego rejestru; nie twierdź, że krok nie przeszedł, gdy rejestr go potwierdza, i odwrotnie.",
    ...relevant.map((step) => `- [${step.layer}] ${step.label}: ${MARK[step.status]}${step.by ? ` (${step.by})` : ""} — ${step.evidence}`),
    ...(report.routingTrace ? ["Ślad routingu (KROK 3A, wypisany przez aplikację):", report.routingTrace] : []),
    report.complete ? "Wszystkie wyzwolone kroki spełnione." : `Brakujące kroki: ${report.missing.join(", ")}.`
  ].join("\n");
}

/** PEŁNY: gate blocks of the router's mandatory modules missing from the answer, with their missing steps. */
export function missingGateBlocks(model: MandatoryPathModel, profile: PathProfile, answer: string): Array<{ block: string; resource: string; steps: string[] }> {
  if (profile !== "PELNY") return [];
  const missing: Array<{ block: string; resource: string; steps: string[] }> = [];
  for (const item of model.full) {
    if (!item.block || item.block === "ST" || item.whenDocuments) continue;
    if (item.block === "WYJ-GATE" && !ARTICLE.test(answer)) continue;
    const visible = new RegExp(item.block.replace("-", "[- ]?"), "i").test(answer);
    const absent = item.steps.filter((step) => !new RegExp(`\\b${step}\\b`).test(answer));
    if (!visible || absent.length) missing.push({ block: item.block, resource: item.resource, steps: visible ? absent : item.steps });
  }
  return missing;
}

/** The correcting request for one more model round (the gates the router requires, shown visibly). */
export function gateCorrectionPrompt(missing: Array<{ block: string; resource: string; steps: string[] }>): string {
  return [
    "Ścieżka obowiązkowa routera (profil PEŁNY): w odpowiedzi brakuje widocznych bloków bramek obowiązkowych.",
    ...missing.map((item) => `- ${item.block}${item.steps.length ? ` z krokami ${item.steps.join(", ")}` : ""} (${basename(item.resource)})`),
    "Wykonaj te bramki według modułów podanych w instrukcji i zwróć PEŁNĄ poprawioną odpowiedź (nie opis zmian), z blokami i krokami w treści.",
    "Nie dodawaj przepisów, sygnatur ani wartości liczbowych, których nie było w odpowiedzi; zachowaj bez zmian istniejące znaczniki ✅/🟨/⚠️."
  ].join("\n");
}

/**
 * KROK 3A trace written by the application from the audit (the model's own
 * account is not evidence). ODRZUCONE: the candidates the model weighed are
 * not visible to the application, which says so instead of guessing.
 */
export function routingTrace(args: {
  mode: "LAIK" | "PRAWNIK";
  report: MandatoryPathReport;
  primarySkill: string;
  loadedSkills: string[];
  events: TurnFacts["events"];
  routerVersion: string | null;
  sharedRoot: string;
  duplicates: string[];
}): { text: string; primaryRead: boolean } {
  const skipped = new Set([ROUTER_SKILL, "prawo-polskie-v2", "AUTO", ""]);
  const read = (skill: string) =>
    args.events.some((event) => event.type === "skill_read" && event.status === "OK" && event.target === skill);
  const readSkills = args.events
    .filter((event) => event.type === "skill_read" && event.status === "OK" && !skipped.has(event.target))
    .map((event) => event.target);
  const primary = !skipped.has(args.primarySkill)
    ? args.primarySkill
    : readSkills[0] ?? (read("prawo-polskie-v2") ? "prawo-polskie-v2" : "");
  const primaryRead = Boolean(primary) && read(primary);
  const secondary = [...new Set([...args.loadedSkills, ...readSkills])].filter((skill) => !skipped.has(skill) && skill !== primary);
  const core = args.report.steps.filter((step) => step.layer === "ROUTER" && /^R-\d$/.test(step.id));
  const coreMet = core.length > 0 && core.every((step) => step.status === "MET");
  const deferred = args.report.steps
    .filter((step) => step.requirement === "TRIGGERED" && step.status === "NOT_TRIGGERED")
    .map((step) => step.id);
  return {
    primaryRead,
    text: [
      `TRYB: ${args.mode}`,
      `PRIMARY: ${primary || "BRAK"} — ROUTER-WCZYTANY: ${primaryRead ? `TAK: ${primary}/SKILL.md` : "NIE"}`,
      `SECONDARY: ${secondary.length ? secondary.map((skill) => `${skill} (${read(skill) ? "TAK" : "NIE"})`).join(", ") : "BRAK"} — ROUTER-WCZYTANY: ${secondary.length ? (secondary.every(read) ? "TAK" : "NIE") : "N-D"}`,
      "ODRZUCONE: brak danych aplikacji — kandydatów rozważa model; aplikacja rejestruje tylko faktyczne odczyty",
      `PROFIL: ${args.report.profile === "PELNY" ? "PEŁNY" : "LEKKI"} — rdzeń R-1…R-5: ${coreMet ? "TAK" : `NIE (${core.filter((step) => step.status !== "MET").map((step) => step.id).join(", ")})`}`,
      `ODROCZONE: ${deferred.length ? deferred.join(", ") : "BRAK"}`,
      `WERSJA ROUTERA: ${args.routerVersion ?? "nieznana"}`,
      `RESOLVER: shared → ${args.sharedRoot}; DUPLIKATY: ${args.duplicates.length ? args.duplicates.join(", ") : "BRAK"}`
    ].join("\n")
  };
}
