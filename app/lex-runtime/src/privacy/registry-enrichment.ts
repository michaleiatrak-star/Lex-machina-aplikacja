import { detectIdentifiers } from "./identifiers.js";

// Firm data from public registers for pseudonymization ([FIRMA], REGULY-ANONIMIZACJI).
// A NIP or KRS number in the text is looked up once in the VAT white list (name, address,
// representatives, proxies, partners) and in KRS (name, legal form, seat address); every
// form of those found in the text is protected with the firm's token. Lookups fail open:
// an unreachable register leaves the local detection as it was.

export type RegistryForm = {
  text: string;
  kind: "PERSON" | "ADDRESS";
  // A firm's own name: one organization token, the legal form stays in the text.
  organization?: { legalForm?: string };
};

export interface RegistryFormsProvider {
  forms(text: string): Promise<RegistryForm[]>;
}

export type RegistryCall = (request: {
  source: string;
  tool: string;
  arguments: Record<string, unknown>;
}) => Promise<{ ok: boolean; result: unknown }>;

export type RegistryLookupEvent = {
  source: "wl" | "krs";
  status: "FOUND" | "NOT_FOUND" | "ERROR" | "TIMEOUT";
  forms: number;
};

type Row = Record<string, unknown>;

const LEGAL_FORM_TAIL =
  /[\s,]*(?:spółka\s+z\s+ograniczoną\s+odpowiedzialnością(?:\s+spółka\s+komandytowa)?|spółka\s+(?:akcyjna|komandytowa|komandytowo-akcyjna|jawna|partnerska|cywilna)|sp\.\s?z\s?o\.\s?o\.(?:\s?sp\.\s?k\.)?|s\.\s?a\.|sp\.\s?k\.(?:\s?a\.)?|sp\.\s?j\.|sp\.\s?p\.|s\.\s?c\.)\s*(?:w\s+(?:likwidacji|upadłości|restrukturyzacji))?\s*$/iu;
// Words that alone are no firm name ("ZAKŁAD", "POLSKA" left after stripping the form).
const TOO_GENERIC = new Set([
  "polska", "polski", "firma", "spółka", "zakład", "przedsiębiorstwo", "usługi", "handel", "transport", "grupa", "group",
  "centrum", "biuro", "serwis", "service", "invest", "development", "holding", "consulting", "trade", "budownictwo"
]);
const STREET_PREFIX = /^(?:ul\.?|ulica|al\.?|aleja|aleje|pl\.?|plac|os\.?|osiedle|rondo)\s+/iu;
const ROMAN = /^[IVXLC]+$/u;
const LOWER_WORDS = new Set(["i", "z", "w", "na", "do", "od", "dla", "pod", "nad", "przy", "oraz"]);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** "JANA PAWŁA II" -> "Jana Pawła II", "SKŁODOWSKIEJ-CURIE" -> "Skłodowskiej-Curie". */
export function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("pl")
    .split(/(\s+)/u)
    .map((word, index) => {
      if (/^\s+$/u.test(word) || !word) return word;
      const upper = word.toLocaleUpperCase("pl");
      if (ROMAN.test(upper.replace(/[.,]$/u, ""))) return upper;
      if (index > 0 && LOWER_WORDS.has(word)) return word;
      return word.replace(/(^|[-'’„"(])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toLocaleUpperCase("pl"));
    })
    .join("");
}

function spellings(value: string): string[] {
  return [...new Set([value, value.toLocaleUpperCase("pl"), titleCase(value)])];
}

/** The firm's own name without its legal form, in the spellings a pleading uses. */
export function firmNameForms(name: string): RegistryForm[] {
  const clean = name.replace(/[„”"«»]/gu, "").replace(/\s+/gu, " ").trim();
  const legal = LEGAL_FORM_TAIL.exec(clean);
  const core = (legal ? clean.slice(0, legal.index) : clean).replace(/[\s,]+$/u, "");
  const legalForm = legal ? legal[0].replace(/^[\s,]+/u, "") : undefined;
  if (core.length < 3 || TOO_GENERIC.has(core.toLocaleLowerCase("pl"))) return [];
  if (!/\s/u.test(core) && core.length < 4) return [];
  return spellings(core).map((form) => ({ text: form, kind: "PERSON", organization: legalForm ? { legalForm } : {} }));
}

/** A natural person from the register: "Jan Kowalski", "KOWALSKI Jan" and the capitals. */
export function personForms(first: string | undefined, last: string | undefined): RegistryForm[] {
  if (!last) return [];
  const surname = titleCase(last);
  const given = first ? titleCase(first) : undefined;
  if (!given) return [];
  const forms = [`${given} ${surname}`, `${surname} ${given}`, `${surname.toLocaleUpperCase("pl")} ${given}`];
  return [...new Set(forms.flatMap(spellings))].map((form) => ({ text: form, kind: "PERSON" }));
}

/** "UL. DŁUGA 5/3, 25-001 KIELCE" -> street with number (with and without its type) and code with town. */
export function addressForms(address: string | undefined): RegistryForm[] {
  if (!address) return [];
  const forms: string[] = [];
  for (const part of address.split(",").map((item) => item.trim()).filter(Boolean)) {
    const postal = /^(\d{2}-\d{3})\s+(.+)$/u.exec(part);
    if (postal) {
      forms.push(`${postal[1]} ${titleCase(postal[2]!)}`, `${postal[1]} ${postal[2]!.toLocaleUpperCase("pl")}`);
      continue;
    }
    if (!/\d/u.test(part)) continue;
    const street = titleCase(part);
    const bare = street.replace(STREET_PREFIX, "");
    if (bare.replace(/[\d\s/a-zA-Z]*$/u, "").length < 3) continue;
    forms.push(street, bare, part.toLocaleUpperCase("pl"), part.toLocaleUpperCase("pl").replace(STREET_PREFIX, ""));
  }
  return [...new Set(forms)].map((form) => ({ text: form, kind: "ADDRESS" }));
}

export function whiteListForms(reply: unknown): RegistryForm[] {
  const row = reply && typeof reply === "object" ? (reply as Row) : {};
  if (row.status !== "FOUND" || !row.result || typeof row.result !== "object") return [];
  const result = row.result as Row;
  const persons = Array.isArray(result.osoby) ? (result.osoby as Row[]) : [];
  return [
    ...firmNameForms(text(result.tytul_lub_nazwa) ?? ""),
    ...addressForms(text(result.adres)),
    ...addressForms(text(result.adres_zamieszkania)),
    ...persons.flatMap((person) =>
      text(person.nazwa_firmy) ? firmNameForms(text(person.nazwa_firmy)!) : personForms(text(person.imie), text(person.nazwisko))
    )
  ];
}

export function krsForms(reply: unknown): RegistryForm[] {
  const row = reply && typeof reply === "object" ? (reply as Row) : {};
  if (row.status !== "FOUND" || !row.result || typeof row.result !== "object") return [];
  const result = row.result as Row;
  return [...firmNameForms(text(result.tytul_lub_nazwa) ?? ""), ...addressForms(text(result.adres))];
}

/** Identifiers in the text to look up: NIP (VAT white list) and KRS numbers. */
export function registryKeys(value: string): Array<{ source: "wl" | "krs"; id: string }> {
  const keys = new Map<string, { source: "wl" | "krs"; id: string }>();
  for (const span of detectIdentifiers(value)) {
    if (span.kind === "NIP") {
      const id = span.value.replace(/\D/gu, "");
      keys.set(`wl:${id}`, { source: "wl", id });
    } else if (span.kind === "KRS") {
      keys.set(`krs:${span.value}`, { source: "krs", id: span.value });
    }
  }
  return [...keys.values()];
}

export class RegistryEnrichment implements RegistryFormsProvider {
  private readonly cache = new Map<string, Promise<RegistryForm[]>>();
  // The latest lookups (no identifiers): which register answered and how many forms it gave.
  readonly events: RegistryLookupEvent[] = [];

  constructor(
    private readonly call: RegistryCall,
    private readonly options: { timeoutMs?: number; maxLookups?: number; cacheSize?: number } = {}
  ) {}

  async forms(value: string): Promise<RegistryForm[]> {
    const keys = registryKeys(value).slice(0, this.options.maxLookups ?? 12);
    const found = await Promise.all(keys.map((key) => this.lookup(key.source, key.id)));
    const unique = new Map<string, RegistryForm>();
    for (const form of found.flat()) if (!unique.has(`${form.kind}\u0000${form.text}`)) unique.set(`${form.kind}\u0000${form.text}`, form);
    return [...unique.values()];
  }

  private record(event: RegistryLookupEvent): void {
    this.events.push(event);
    if (this.events.length > 100) this.events.shift();
  }

  private lookup(source: "wl" | "krs", id: string): Promise<RegistryForm[]> {
    const key = `${source}:${id}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.fetch(source, id);
    this.cache.set(key, pending);
    const limit = this.options.cacheSize ?? 500;
    if (this.cache.size > limit) this.cache.delete(this.cache.keys().next().value!);
    return pending;
  }

  private async fetch(source: "wl" | "krs", id: string): Promise<RegistryForm[]> {
    const request =
      source === "wl"
        ? { source, tool: "wl_sprawdz_nip", arguments: { nip: id } }
        : { source, tool: "krs_lookup", arguments: { numerKrs: id } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"TIMEOUT">((resolve) => {
      timer = setTimeout(() => resolve("TIMEOUT"), this.options.timeoutMs ?? 6000);
    });
    try {
      const reply = await Promise.race([this.call(request), timeout]);
      if (reply === "TIMEOUT") {
        // A slow register is asked again next time.
        this.cache.delete(`${source}:${id}`);
        this.record({ source, status: "TIMEOUT", forms: 0 });
        return [];
      }
      const row = reply.result && typeof reply.result === "object" ? (reply.result as Row) : {};
      const forms = source === "wl" ? whiteListForms(row) : krsForms(row);
      const status = row.status === "FOUND" ? "FOUND" : row.status === "NOT_FOUND" ? "NOT_FOUND" : "ERROR";
      if (status === "ERROR") this.cache.delete(`${source}:${id}`);
      this.record({ source, status, forms: forms.length });
      return forms;
    } catch {
      this.cache.delete(`${source}:${id}`);
      this.record({ source, status: "ERROR", forms: 0 });
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Off with LEX_REGISTRY_ENRICHMENT=off (no register lookups from pseudonymization). */
export function registryEnrichmentFor(
  runtime: { direct(request: { source: string; tool?: string; arguments?: Record<string, unknown> }): Promise<{ ok: boolean; result: unknown }> } | undefined
): RegistryEnrichment | undefined {
  if (!runtime || /^(off|0|false)$/i.test(process.env.LEX_REGISTRY_ENRICHMENT?.trim() ?? "")) return undefined;
  return new RegistryEnrichment((request) => runtime.direct(request));
}
