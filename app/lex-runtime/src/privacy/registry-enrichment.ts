import { detectIdentifiers } from "./identifiers.js";

// Firm data from public registers for pseudonymization ([FIRMA], REGULY-ANONIMIZACJI).
// A NIP or KRS number in the text is looked up once in the VAT white list (name, address,
// representatives, proxies, partners), in KRS (name, legal form, seat address) and, for a
// NIP outside KRS, in CEIDG when its key is set (business name, owner, address); every
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
  source: "wl" | "krs" | "ceidg";
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
      // A house number keeps its letter: "7A/12".
      if (/^\d/u.test(word)) return upper;
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
  // "UL. DŁUGA 5, 25-001 KIELCE" (white list) and "ul. Długa 5/3 25-001 Kielce" (CEIDG).
  const parts = address.split(",").flatMap((item) => item.split(/\s+(?=\d{2}-\d{3}\s)/u));
  for (const part of parts.map((item) => item.trim()).filter(Boolean)) {
    const postal = /^(\d{2}-\d{3})\s+(.+)$/u.exec(part);
    if (postal) {
      forms.push(`${postal[1]} ${titleCase(postal[2]!)}`, `${postal[1]} ${postal[2]!.toLocaleUpperCase("pl")}`);
      continue;
    }
    if (!/\d/u.test(part)) continue;
    const street = titleCase(part);
    const bare = street.replace(STREET_PREFIX, "");
    // A street name before the house number ("Kolorowa 12", "Długa 5/3", "Polna 7A"), not a bare number.
    if (bare.replace(/\s*\d+\p{L}?(?:\s*\/\s*\d+\p{L}?)?$/u, "").trim().length < 3) continue;
    forms.push(street, bare, part, part.replace(STREET_PREFIX, ""), part.toLocaleUpperCase("pl"), part.toLocaleUpperCase("pl").replace(STREET_PREFIX, ""));
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

/** A sole trader in CEIDG: business name, owner and business address. */
export function ceidgForms(reply: unknown): RegistryForm[] {
  const row = reply && typeof reply === "object" ? (reply as Row) : {};
  if (row.status !== "FOUND" || !row.result || typeof row.result !== "object") return [];
  const result = row.result as Row;
  const owner = text(result.wlasciciel)?.split(/\s+/u) ?? [];
  return [
    ...firmNameForms(text(result.tytul_lub_nazwa) ?? ""),
    ...(owner.length >= 2 ? personForms(owner.slice(0, -1).join(" "), owner.at(-1)) : []),
    ...addressForms(text(result.adres_dzialalnosci))
  ];
}

/** Identifiers in the text to look up: NIP (VAT white list, then CEIDG) and KRS numbers. */
export function registryKeys(value: string): Array<{ source: "nip" | "krs"; id: string }> {
  const keys = new Map<string, { source: "nip" | "krs"; id: string }>();
  for (const span of detectIdentifiers(value)) {
    if (span.kind === "NIP") {
      const id = span.value.replace(/\D/gu, "");
      keys.set(`nip:${id}`, { source: "nip", id });
    } else if (span.kind === "KRS") {
      keys.set(`krs:${span.value}`, { source: "krs", id: span.value });
    }
  }
  return [...keys.values()];
}

type Answer = { status: RegistryLookupEvent["status"] | "UNAVAILABLE"; row: Row };
type Entry = { pending: Promise<RegistryForm[]>; expires: number };

// A connector not installed (no CEIDG key) is asked again after this time: the key may be added in the settings.
const UNAVAILABLE_TTL_MS = 10 * 60_000;

export class RegistryEnrichment implements RegistryFormsProvider {
  private readonly cache = new Map<string, Entry>();
  // The latest lookups (no identifiers): which register answered and how many forms it gave.
  readonly events: RegistryLookupEvent[] = [];

  constructor(
    private readonly call: RegistryCall,
    private readonly options: { timeoutMs?: number; maxLookups?: number; cacheSize?: number; now?: () => number } = {}
  ) {}

  async forms(value: string): Promise<RegistryForm[]> {
    const keys = registryKeys(value).slice(0, this.options.maxLookups ?? 12);
    const found = await Promise.all(keys.map((key) => this.within(this.lookup(key.source, key.id), key.source)));
    const unique = new Map<string, RegistryForm>();
    for (const form of found.flat()) if (!unique.has(`${form.kind}\u0000${form.text}`)) unique.set(`${form.kind}\u0000${form.text}`, form);
    return [...unique.values()];
  }

  private record(event: RegistryLookupEvent): void {
    this.events.push(event);
    if (this.events.length > 100) this.events.shift();
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  // A slow register (CEIDG answers in 20-40 s) does not hold the text: it goes on without the
  // forms, and the answer, kept in the cache, protects the next text with the same number.
  private async within(pending: Promise<RegistryForm[]>, source: "nip" | "krs"): Promise<RegistryForm[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"TIMEOUT">((resolve) => {
      timer = setTimeout(() => resolve("TIMEOUT"), this.options.timeoutMs ?? 6000);
    });
    try {
      const result = await Promise.race([pending, timeout]);
      if (result !== "TIMEOUT") return result;
      this.record({ source: source === "nip" ? "wl" : "krs", status: "TIMEOUT", forms: 0 });
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  private lookup(source: "nip" | "krs", id: string): Promise<RegistryForm[]> {
    const key = `${source}:${id}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > this.now()) return cached.pending;
    const entry: Entry = { pending: Promise.resolve([]), expires: Number.POSITIVE_INFINITY };
    entry.pending = this.resolve(source, id).then(
      ({ forms, retry }) => {
        if (retry === 0) this.cache.delete(key);
        else entry.expires = this.now() + retry;
        return forms;
      },
      () => {
        this.cache.delete(key);
        return [];
      }
    );
    this.cache.delete(key);
    this.cache.set(key, entry);
    if (this.cache.size > (this.options.cacheSize ?? 500)) this.cache.delete(this.cache.keys().next().value!);
    return entry.pending;
  }

  /** Forms of one number and how long they hold (0: ask again next time). */
  private async resolve(source: "nip" | "krs", id: string): Promise<{ forms: RegistryForm[]; retry: number }> {
    if (source === "krs") {
      const krs = await this.ask("krs", "krs_lookup", { numerKrs: id });
      const forms = krsForms(krs.row);
      this.record({ source: "krs", status: krs.status === "UNAVAILABLE" ? "ERROR" : krs.status, forms: forms.length });
      return { forms, retry: this.retryAfter([krs]) };
    }
    const list = await this.ask("wl", "wl_sprawdz_nip", { nip: id });
    const listForms = whiteListForms(list.row);
    this.record({ source: "wl", status: list.status === "UNAVAILABLE" ? "ERROR" : list.status, forms: listForms.length });
    // A company in KRS is fully described by the white list; a sole trader (or a NIP the
    // list does not know) is also asked in CEIDG for the owner and the business address.
    const result = list.row.result && typeof list.row.result === "object" ? (list.row.result as Row) : {};
    if (list.status === "FOUND" && text(result.krs)) return { forms: listForms, retry: Number.POSITIVE_INFINITY };
    const ceidg = await this.ask("ceidg", "ceidg_szukaj_firmy", { nip: id });
    const ceidgFound = ceidgForms(ceidg.row);
    if (ceidg.status !== "UNAVAILABLE") this.record({ source: "ceidg", status: ceidg.status, forms: ceidgFound.length });
    return { forms: [...listForms, ...ceidgFound], retry: this.retryAfter([list, ceidg]) };
  }

  private retryAfter(answers: Answer[]): number {
    if (answers.some((answer) => answer.status === "ERROR")) return 0;
    if (answers.some((answer) => answer.status === "UNAVAILABLE")) return UNAVAILABLE_TTL_MS;
    return Number.POSITIVE_INFINITY;
  }

  private async ask(source: string, tool: string, args: Record<string, unknown>): Promise<Answer> {
    try {
      const reply = await this.call({ source, tool, arguments: args });
      const row = reply.result && typeof reply.result === "object" ? (reply.result as Row) : {};
      if (!reply.ok) return { status: "UNAVAILABLE", row };
      return { status: row.status === "FOUND" ? "FOUND" : row.status === "NOT_FOUND" ? "NOT_FOUND" : "ERROR", row };
    } catch {
      return { status: "ERROR", row: {} };
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
