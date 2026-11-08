import fs from "node:fs";
import path from "node:path";
import { eliCapabilityNotice } from "./eli/eli-countries.js";

/**
 * Jurisdiction provider: the country whose law the application works with. Each country is a
 * package of the corpus with JURYSDYKCJA.md — the content keys (JUR:<key>) and the block
 * DOSTAWCA JURYSDYKCJI (language, currency, domain skills, MCP connectors and the providers of
 * the application's national components). Chosen in Settings ("Jurysdykcja"), Polish law by default.
 *
 * A component this application has no provider for in the chosen country is reported as missing
 * (degraded, named to the user and the model), never served by another country's component.
 */

export const DEFAULT_JURISDICTION_PACK = "prawo-polskie-v2";

/** National components of the application, each served by a provider of one country. */
export const JURISDICTION_COMPONENTS = [
  "weryfikacja-przepisow",
  "orzecznictwo",
  "rejestry",
  "anonimizacja",
  "ocr",
  "semantyka",
  "sady"
] as const;
export type JurisdictionComponent = (typeof JURISDICTION_COMPONENTS)[number];

/** Providers implemented in this application (the code that serves the component). */
export const IMPLEMENTED_PROVIDERS: Readonly<Record<JurisdictionComponent, readonly string[]>> = {
  "weryfikacja-przepisow": ["pl-eli"],
  orzecznictwo: ["pl-sady"],
  rejestry: ["pl-krs-vat-ceidg"],
  anonimizacja: ["pl"],
  ocr: ["pl"],
  semantyka: ["pl"],
  sady: ["pl"]
};

export const COMPONENT_LABELS: Readonly<Record<JurisdictionComponent, string>> = {
  "weryfikacja-przepisow": "weryfikacja przepisów",
  orzecznictwo: "orzecznictwo",
  rejestry: "rejestry podmiotów",
  anonimizacja: "anonimizacja (imiona, nazwiska, adresy, identyfikatory)",
  ocr: "OCR",
  semantyka: "reguły semantyczne",
  sady: "baza sądów"
};

export type JurisdictionProvider = {
  pack: string;
  country: string;
  name: string;
  language: string;
  currency: string;
  /** Map of the domain skills (dr-*) of this jurisdiction. */
  domains: string;
  /** Prefix of its domain skills: "dr" (dr-02-…) for Polish law, the country code (de-02-…) for another. */
  domainPrefix: string;
  /** Directory of the MCP connectors (dist/lex-mcp.mjs, installer), corpus-relative. */
  connectors: string;
  connectorServers: string[];
  /** Key of the source hierarchy module. */
  sourceHierarchy: string;
  localModel: string | null;
  components: Record<JurisdictionComponent, string>;
};

export type JurisdictionStatus = {
  provider: JurisdictionProvider;
  supported: JurisdictionComponent[];
  missing: Array<{ component: JurisdictionComponent; provider: string }>;
};

let settingsFile: string | null = null;

export function configureJurisdiction(dir: string | null): void {
  settingsFile = dir ? path.join(dir, "jurisdiction.json") : null;
}

/** The chosen package: LEX_JURISDICTION_PACK (deployment), then Settings, then Polish law. */
export function activeJurisdictionPack(): string {
  const configured = process.env.LEX_JURISDICTION_PACK?.trim();
  if (configured) return configured;
  if (settingsFile) {
    try {
      const value = (JSON.parse(fs.readFileSync(settingsFile, "utf8")) as { pack?: unknown }).pack;
      if (typeof value === "string" && /^[a-z0-9-]+$/u.test(value)) return value;
    } catch {
      // No choice saved: the default.
    }
  }
  return DEFAULT_JURISDICTION_PACK;
}

export function setActiveJurisdictionPack(root: string, pack: string): JurisdictionProvider {
  if (!settingsFile) throw new Error("JURISDICTION_NOT_CONFIGURED");
  const provider = readJurisdictionProvider(root, pack);
  if (!provider) throw new Error("JURISDICTION_UNKNOWN");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporary = `${settingsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ pack }), "utf8");
  fs.renameSync(temporary, settingsFile);
  return provider;
}

function manifestFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const match of text.matchAll(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|\s*`([^`]+)`\s*\|/gmu)) fields.set(match[1]!, match[2]!);
  return fields;
}

const providerCache = new Map<string, { mtimeMs: number; provider: JurisdictionProvider | null }>();

/** The provider block of a package's JURYSDYKCJA.md, or null when the package declares none. */
export function readJurisdictionProvider(root: string, pack: string): JurisdictionProvider | null {
  if (!/^[a-z0-9-]+$/u.test(pack)) return null;
  const file = path.join(root, pack, "JURYSDYKCJA.md");
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const cached = providerCache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.provider;
  const provider = parseProvider(fs.readFileSync(file, "utf8"), pack);
  providerCache.set(file, { mtimeMs, provider });
  return provider;
}

function parseProvider(text: string, pack: string): JurisdictionProvider | null {
  const fields = manifestFields(text);
  const country = fields.get("kraj");
  if (!country) return null;
  const components = Object.fromEntries(
    JURISDICTION_COMPONENTS.map((component) => [component, fields.get(component) ?? ""])
  ) as Record<JurisdictionComponent, string>;
  return {
    pack,
    country,
    name: fields.get("nazwa") ?? pack,
    language: fields.get("jezyk") ?? "",
    currency: fields.get("waluta") ?? "",
    domains: fields.get("dziedziny") ?? "",
    domainPrefix: fields.get("prefiks-dziedzin") ?? "dr",
    connectors: fields.get("konektory") ?? "",
    connectorServers: (fields.get("konektory-serwery") ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    sourceHierarchy: fields.get("hierarchia-zrodel") ?? "",
    localModel: fields.get("model-lokalny") ?? null,
    components
  };
}

/** Every package of the corpus with a provider block: the entries of the "Jurysdykcja" list. */
export function listJurisdictions(root: string): JurisdictionProvider[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .map((entry) => readJurisdictionProvider(root, entry))
    .filter((provider): provider is JurisdictionProvider => Boolean(provider))
    .sort((a, b) => (a.pack === DEFAULT_JURISDICTION_PACK ? -1 : b.pack === DEFAULT_JURISDICTION_PACK ? 1 : a.name.localeCompare(b.name)));
}

export function activeJurisdiction(root: string): JurisdictionProvider | null {
  return readJurisdictionProvider(root, activeJurisdictionPack());
}

/** Which national components the application serves for the provider and which it lacks. */
export function jurisdictionStatus(provider: JurisdictionProvider): JurisdictionStatus {
  const supported: JurisdictionComponent[] = [];
  const missing: JurisdictionStatus["missing"] = [];
  for (const component of JURISDICTION_COMPONENTS) {
    const id = provider.components[component];
    // A provider serves only its own country ("pl-…" for PL): another country's package never gets it.
    const ownCountry = id.split("-")[0] === provider.country.toLowerCase();
    if (id && ownCountry && IMPLEMENTED_PROVIDERS[component].includes(id)) supported.push(component);
    else missing.push({ component, provider: id || "brak" });
  }
  return { provider, supported, missing };
}

/** The sentence for the model and the answer when the chosen country lacks components (degraded). */
export function jurisdictionDegradedNotice(status: JurisdictionStatus): string | null {
  if (!status.missing.length) return null;
  // No provider reads the country's acts: what its ELI still gives (the official address).
  const eli = status.missing.some((item) => item.component === "weryfikacja-przepisow") ? eliCapabilityNotice(status.provider.country) : null;
  return (
    `Jurysdykcja ${status.provider.name}: aplikacja nie ma dostawcy dla: ` +
    status.missing.map((item) => COMPONENT_LABELS[item.component]).join(", ") +
    ". Te elementy nie są wykonywane automatycznie (TRYB ZDEGRADOWANY); nie zastępuj ich prawem innego kraju." +
    (eli ? ` ${eli}` : "")
  );
}

/** The MCP connector package (dist/lex-mcp.mjs) of the chosen jurisdiction. */
export function jurisdictionConnectorPackage(root: string): string | null {
  const provider = activeJurisdiction(root);
  return provider?.connectors ? path.join(root, ...provider.connectors.split("/"), "dist", "lex-mcp.mjs") : null;
}

/** The routing map of the chosen jurisdiction's domain skills (field `dziedziny`), corpus-relative. */
export function jurisdictionDomainMap(root: string): string {
  return activeJurisdiction(root)?.domains || `${activeJurisdictionPack()}/ROUTING-MAP.md`;
}

// The corpus the registry scanned last: the domain prefix of the chosen jurisdiction is read there.
let corpusRoot: string | null = null;

export function registerJurisdictionCorpus(root: string): void {
  corpusRoot = root;
}

/** Prefix of the chosen jurisdiction's domain skills ("dr" for Polish law). */
export function domainSkillPrefix(root: string | null = corpusRoot): string {
  return (root ? activeJurisdiction(root)?.domainPrefix : null) || "dr";
}

/** A domain skill of the chosen jurisdiction ("dr-02-…" for Polish law); another country's is not. */
export function isDomainSkill(name: string | null | undefined, root: string | null = corpusRoot): boolean {
  return Boolean(name) && new RegExp(`^${domainSkillPrefix(root)}-\\d{2}-`, "u").test(name!);
}

/** The domain-skill name pattern of the chosen jurisdiction, for patterns that embed it. */
export function domainSkillSource(root: string | null = corpusRoot): string {
  return `${domainSkillPrefix(root)}-\\d{2}`;
}
