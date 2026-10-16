import { surnameMentions } from "./surname-propagation.js";
import { degradedRecognizers } from "./gazetteer-ner.js";
import { detectPeselNames } from "./pesel-names.js";
import { detectStreetAddresses } from "./street-addresses.js";
import { detectFirmNames, type FirmSpan } from "./firm-names.js";
import { genericWords, personPart } from "./generic-words.js";
import { detectIdentifiers } from "./identifiers.js";
import type { RegistryFormsProvider } from "./registry-enrichment.js";
import {
  PERSON_CASES,
  type PersonCase,
  type PersonEntity,
  type PersonMorphology
} from "./person-morphology.js";

export type PiiKind =
  | "PESEL"
  | "NIP"
  | "REGON"
  | "IBAN"
  | "EMAIL"
  | "PHONE"
  | "PERSON"
  | "ADDRESS"
  | "ID_CARD"
  | "PASSPORT"
  | "KRS"
  | "LAND_REGISTRY"
  | "BIRTH_DATE"
  | "VEHICLE_PLATE"
  | "BAR_NUMBER"
  | "PAYMENT_CARD"
  | "CUSTOM";

export type PiiSpan = {
  start: number;
  end: number;
  kind: PiiKind;
  value: string;
  confidence?: number;
  source?: "AUTO" | "USER";
  label?: string;
  // A person match a local model should confirm from its sentence.
  ambiguous?: boolean;
  // The local model read it as no person (its answer, e.g. "słowo pospolite"). Still masked:
  // the user unmasks it with one click.
  aiNotPerson?: string;
};

export type PrivacyDirectiveAction =
  | "PSEUDONYMIZE"
  | "KEEP"
  | "LABEL";

export type ManualPrivacyDirective = {
  start: number;
  end: number;
  action: PrivacyDirectiveAction;
  // "FIRM": the user's mark of a firm name - a PERSON token with the firm's identity
  // (declined as a name, its legal form left in the text), as found firms get.
  kind?: PiiKind | "FIRM";
  label?: string;
};

export interface NamedEntityRecognizer {
  recognize(text: string): Promise<PiiSpan[]>;
}

export type PseudonymizationFinding = {
  token: string;
  kind: PiiKind;
  // A firm's name: from a public register (VAT white list, KRS, CEIDG) or from the text
  // (legal form, business prefix, the user's "Firma" mark).
  firm?: "REGISTRY" | "TEXT";
  start: number;
  end: number;
  source: "AUTO" | "USER";
  label?: string;
  // A known person's surname where the word may also be a common noun (sentence start,
  // capitals): masked, for the user to confirm (surname-propagation.ts).
  uncertain?: string;
};

export type PrivacyAnnotation = {
  start: number;
  end: number;
  label: string;
};

export type PseudonymizationVaultToken = {
  token: string;
  kind: PiiKind;
  value: string;
  createdAt: string;
  // PERSON: canonical identity and the inflected forms used on restore.
  entity?: PersonEntity;
};

/** [PII:PERSON:0001] or, with the grammatical case a model asked for, [PII:PERSON:0001|INS]. */
export const PII_TOKEN_WITH_CASE =
  /\[PII:([A-Z_]+):(\d{4})(?:\|([A-Z]{2,4}))?\]/g;

function isShouting(text: string): boolean {
  return text === text.toLocaleUpperCase("pl") && /\p{L}{2}/u.test(text);
}

function titleCase(text: string): string {
  return text
    .toLocaleLowerCase("pl")
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toLocaleUpperCase("pl"));
}

/**
 * A name read from an all-caps heading ("JAN KOWALSKI") is restored in normal
 * spelling inside sentences; abbreviations of addresses (ul., al.) stay lower.
 */
function calmEntity(entity: PersonEntity): PersonEntity {
  if (!isShouting(entity.canonical)) return entity;
  const calm = (text: string) =>
    titleCase(text).replace(/\b(Ul|Al|Pl|Os|Ulica|Ulicy|Ulicę|Ulicą|Ulico|Aleja|Alei|Aleję|Aleją|Alejo|Plac|Placu|Placem|Osiedle|Osiedla|Osiedlu|Osiedlem)\b/gu, (word) =>
      word.toLocaleLowerCase("pl")
    );
  return {
    ...entity,
    canonical: calm(entity.canonical),
    forms: Object.fromEntries(
      Object.entries(entity.forms).map(([key, form]) => [key, { ...form, text: calm(form.text) }])
    ) as PersonEntity["forms"]
  };
}

// Persons and addresses with a paradigm: one token per canonical entity.
const ENTITY_KINDS = new Set<PiiKind>(["PERSON", "ADDRESS"]);

function personEntityKey(entity: PersonEntity, kind: PiiKind = "PERSON"): string {
  return `${kind}\u0000entity\u0000${entity.canonical.toLocaleLowerCase("pl")}\u0000${entity.gender}\u0000${entity.type ?? ""}${entity.number ?? ""}`;
}

// A firm named after a person has its own token, never the person's.
function valueKey(kind: PiiKind, value: string, entity?: PersonEntity): string {
  return entity?.type === "organization" ? `${kind}\u0000org\u0000${value}` : `${kind}\u0000${value}`;
}

// Words after which a surname names several persons ("państwo Kowalscy").
const GROUP_WORDS = new Set([
  "państwo", "państwa", "państwu", "państwem", "małżonkowie", "małżonków", "małżonkom", "małżonkami",
  "małżonkach", "rodzeństwo", "rodzeństwa", "rodzeństwu", "rodzeństwem", "rodzina", "rodziny", "rodzinie",
  "rodzinę", "rodziną", "powodowie", "pozwani", "powódki", "pozwane", "wnioskodawcy", "uczestnicy",
  "dłużnicy", "wierzyciele", "spadkobiercy", "najemcy", "oskarżeni", "obwinieni", "skarżący", "oboje", "obaj", "obie"
]);

// "PHU Jan Kowalski", "pod firmą Jan Nowak", "Kancelaria Adwokacka Jan Kowalski".
const FIRM_BEFORE =
  /(?:\b(?:P\.?P\.?H\.?U\.?|P\.?H\.?U\.?|F\.?H\.?U\.?|F\.?P\.?H\.?U\.?|Firma|Przedsiębiorstwo|Zakład|Kancelaria|Biuro|Studio|Sklep|Warsztat|Hurtownia|Gabinet|Pracownia|Agencja)(?:\s+(?:\p{Lu}[\p{L}-]*|[\p{L}]+\.)){0,2}|\bpod\s+(?:firmą|nazwą))\s*[„"»]?\s*$/u;
// "Nowak sp. z o.o.", "Kowalski i Wspólnicy sp.k.", "Jan Nowak Transport".
const LEGAL_FORM =
  /(sp\.\s?z\s?o\.\s?o\.|spółk[aiąę]\s+z\s+ograniczoną\s+odpowiedzialnością|spółk[aiąę]\s+(?:akcyjn|komandytow|jawn|partnersk|cywiln)\p{L}*|S\.\s?A\.|sp\.\s?k\.(?:\s?a\.)?|sp\.\s?j\.|sp\.\s?p\.|s\.\s?c\.|S\.K\.A\.|P\.S\.A\.)/iu;
const FIRM_AFTER =
  /^\s*(?:i\s+(?:Wspólnicy|Partnerzy|Syn|Synowie|S-ka)\b|&|(?:Usługi|Transport|Handel|Budownictwo|Consulting|Group|Trade|Service|Serwis|Invest|Development|Logistics|Holding|Media|Design|Auto|Bud|Tech|Soft|Med|Eko)\b|,?\s*(?:[Ss][Pp]\.|[Ss][Pp][Óó][Łł][Kk]|S\.\s?A\.|[Ss]\.\s?[Cc]\.|S\.K\.A\.|P\.S\.A\.))/u;

/** The firm around a person-name mention, if the name is part of a firm name. */
export function firmContext(text: string, start: number, end: number): { legalForm?: string } | null {
  const before = text.slice(Math.max(0, start - 60), start).split(/[\n.;:!?](?=\s)/).pop() ?? "";
  // To the end of the sentence: "PHU Jan Kowalski. Umowę zawarła X sp.k." is not one firm.
  const lineAfter = (text.slice(end, end + 80).split("\n")[0] ?? "").split(/(?<=[.!?])\s+(?=\p{Lu})/u)[0] ?? "";
  if (!FIRM_BEFORE.test(before) && !FIRM_AFTER.test(lineAfter)) return null;
  const legal = LEGAL_FORM.exec(lineAfter.slice(0, 60));
  return legal ? { legalForm: legal[1]!.replace(/\s+/g, " ") } : {};
}

export function organizationEntity(value: string, legalForm?: string): PersonEntity {
  const form = { text: value, source: "frozen", confidence: 1 };
  return {
    canonical: value,
    gender: "n",
    genderAlternatives: [],
    status: "ok",
    forms: { NOM: form, GEN: form, DAT: form, ACC: form, INS: form, LOC: form, VOC: form },
    warnings: ["ORGANIZATION"],
    type: "organization",
    ...(legalForm ? { legalForm } : {})
  };
}

export type RestoredToken = {
  token: string;
  requestedCase: PersonCase | null;
  text: string;
  kind: PiiKind;
  source: string;
  confidence: number;
  // ok, invalid_case (unknown case suffix, nominative used), no_forms, unknown_token
  status: "ok" | "invalid_case" | "no_forms" | "unknown_token";
};

export type PseudonymizationVaultSnapshot = {
  counters:
    Partial<Record<PiiKind, number>>;
  tokens:
    PseudonymizationVaultToken[];
};

export type PseudonymizationResult = {
  text: string;
  findings: PseudonymizationFinding[];
  annotations: PrivacyAnnotation[];
  keptRanges: Array<{
    start: number;
    end: number;
  }>;
  counts: Partial<Record<PiiKind, number>>;
};

const PRIORITY: Record<PiiKind, number> = {
  PESEL: 100,
  PAYMENT_CARD: 99,
  ID_CARD: 98,
  PASSPORT: 97,
  LAND_REGISTRY: 96,
  NIP: 95,
  REGON: 90,
  IBAN: 85,
  EMAIL: 80,
  PHONE: 70,
  // A structural address wins over a name inside it ("ul. Jana Kowalskiego 5").
  ADDRESS: 65,
  PERSON: 60,
  BIRTH_DATE: 54,
  VEHICLE_PLATE: 53,
  BAR_NUMBER: 53,
  KRS: 52,
  CUSTOM: 50
};

function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start < b.end && a.end > b.start;
}

function nonOverlapping(spans: PiiSpan[]): PiiSpan[] {
  const sorted = [...spans].sort((a, b) =>
    a.start - b.start ||
    (a.source === "USER" ? -1 : 1) -
      (b.source === "USER" ? -1 : 1) ||
    PRIORITY[b.kind] - PRIORITY[a.kind] ||
    (b.end - b.start) - (a.end - a.start)
  );
  const accepted: PiiSpan[] = [];

  for (const candidate of sorted) {
    if (
      candidate.start < 0 ||
      candidate.end <= candidate.start
    ) {
      continue;
    }
    if (!accepted.some((current) => overlaps(candidate, current))) {
      accepted.push(candidate);
    }
  }

  return accepted.sort((a, b) => a.start - b.start);
}

function normalizeDirectives(
  text: string,
  directives: ManualPrivacyDirective[]
): ManualPrivacyDirective[] {
  const normalized = directives.map((directive) => {
    if (
      !Number.isInteger(directive.start) ||
      !Number.isInteger(directive.end) ||
      directive.start < 0 ||
      directive.end <= directive.start ||
      directive.end > text.length
    ) {
      throw new Error("INVALID_PRIVACY_DIRECTIVE_RANGE");
    }

    const label = directive.label?.trim();
    if (
      directive.action === "LABEL" &&
      (!label || label.length > 120)
    ) {
      throw new Error("INVALID_PRIVACY_DIRECTIVE_LABEL");
    }

    return {
      ...directive,
      ...(label ? { label } : {})
    };
  }).sort((a, b) => a.start - b.start || a.end - b.end);

  for (let index = 1; index < normalized.length; index += 1) {
    if (overlaps(normalized[index - 1]!, normalized[index]!)) {
      throw new Error("OVERLAPPING_PRIVACY_DIRECTIVES");
    }
  }

  return normalized;
}

// SGJP gives some surnames two declensions (Stępień: Stępnia and Stępienia) and the
// nominative alone does not tell which one a person uses. A later mention written in
// the other one ("Wojciecha Stępnia") is the document's evidence: its forms replace the
// generated ones in the dependent cases; the nominative stays as written.
function documentVariant(current: PersonEntity, incoming: PersonEntity, surface: string): PersonEntity | null {
  if (current.type === "organization" || incoming.type === "organization" || isShouting(surface)) return null;
  const same = (a: string, b: string) => a.toLocaleLowerCase("pl") === b.toLocaleLowerCase("pl");
  if ((current.number ?? "") !== (incoming.number ?? "") || current.gender !== incoming.gender) return null;
  if (!same(current.forms.NOM.text, incoming.forms.NOM.text)) return null;
  if (Object.values(current.forms).some((form) => same(form.text, surface))) return null;
  if (!Object.values(incoming.forms).some((form) => same(form.text, surface))) return null;
  return { ...current, forms: { ...incoming.forms, NOM: current.forms.NOM } };
}

export class PseudonymizationVault {
  private readonly tokenToValue =
    new Map<string, string>();
  private readonly keyToToken =
    new Map<string, string>();
  private readonly counters =
    new Map<PiiKind, number>();
  private readonly tokenMetadata =
    new Map<
      string,
      {
        kind: PiiKind;
        createdAt: string;
      }
    >();
  private readonly tokenEntities =
    new Map<string, PersonEntity>();
  // Every surface mapped to a token in this session (for entity merging).
  private readonly tokenSurfaces =
    new Map<string, Set<string>>();

  constructor(
    snapshot?:
      PseudonymizationVaultSnapshot
  ) {
    if (snapshot) {
      this.hydrate(snapshot);
    }
  }

  private hydrate(
    snapshot:
      PseudonymizationVaultSnapshot
  ): void {
    for (
      const [
        kind,
        rawCount
      ] of Object.entries(
        snapshot.counters
      ) as Array<
        [PiiKind, number]
      >
    ) {
      if (
        !Number.isInteger(
          rawCount
        ) ||
        rawCount < 0
      ) {
        throw new Error(
          "INVALID_PRIVACY_VAULT_COUNTER"
        );
      }
      this.counters.set(
        kind,
        rawCount
      );
    }

    for (
      const item
      of snapshot.tokens
    ) {
      const match =
        /^\[PII:([A-Z_]+):(\d{4})\]$/
          .exec(item.token);
      if (
        !match ||
        match[1] !== item.kind ||
        typeof item.value !==
          "string" ||
        typeof item.createdAt !==
          "string" ||
        !Number.isFinite(
          Date.parse(
            item.createdAt
          )
        ) ||
        this.tokenToValue.has(
          item.token
        )
      ) {
        throw new Error(
          "INVALID_PRIVACY_VAULT_TOKEN"
        );
      }

      const key = valueKey(item.kind, item.value, item.entity);
      if (
        this.keyToToken.has(key)
      ) {
        throw new Error(
          "DUPLICATE_PRIVACY_VAULT_VALUE"
        );
      }

      const sequence =
        Number(match[2]);
      const counter =
        this.counters.get(
          item.kind
        ) ?? 0;
      if (
        sequence > counter
      ) {
        this.counters.set(
          item.kind,
          sequence
        );
      }

      this.keyToToken.set(
        key,
        item.token
      );
      this.tokenToValue.set(
        item.token,
        item.value
      );
      // As in getOrCreate: a key read from disk merges entities by surface too.
      this.tokenSurfaces.set(item.token, new Set([item.value]));
      this.tokenMetadata.set(
        item.token,
        {
          kind: item.kind,
          createdAt:
            item.createdAt
        }
      );
      if (item.entity) {
        this.tokenEntities.set(
          item.token,
          item.entity
        );
        this.keyToToken.set(
          personEntityKey(item.entity, item.kind),
          item.token
        );
      }
    }
  }

  getOrCreate(
    kind: PiiKind,
    value: string,
    entity?: PersonEntity
  ): string {
    const key = valueKey(kind, value, entity);
    const existing =
      this.keyToToken.get(key);
    if (existing) {
      return existing;
    }
    // One person, one token: "Jana Kowalskiego" and "Janem Kowalskim" are the
    // same Jan Kowalski.
    const entityKey =
      ENTITY_KINDS.has(kind) && entity
        ? personEntityKey(entity, kind)
        : null;
    const sameEntity =
      entityKey
        ? this.keyToToken.get(entityKey) ?? this.overlappingEntityToken(kind, entity!, value)
        : undefined;
    if (sameEntity) {
      this.keyToToken.set(
        key,
        sameEntity
      );
      if (entityKey) this.keyToToken.set(entityKey, sameEntity);
      // The document's own nominative decides the paradigm: "Martyna Jurga"
      // wins over "Martyna Jurda" read from "Martynie Jurdze".
      this.tokenSurfaces.get(sameEntity)?.add(value);
      const current = this.tokenEntities.get(sameEntity);
      const nominative =
        entity &&
        current &&
        value.toLocaleLowerCase("pl") === entity.canonical.toLocaleLowerCase("pl") &&
        current.canonical.toLocaleLowerCase("pl") !== entity.canonical.toLocaleLowerCase("pl") &&
        this.keyToToken.get(valueKey(kind, current.canonical, current)) !== sameEntity;
      // An unambiguous reading replaces an ambiguous one, and a normally
      // written name replaces one read from an all-caps heading.
      const clearer = entity && current && current.status !== "ok" && entity.status === "ok";
      const calmer = entity && current && isShouting(current.canonical) && !isShouting(entity.canonical);
      if (entity && (nominative || clearer || calmer)) {
        this.tokenEntities.set(sameEntity, calmEntity(entity));
      } else if (entity && current) {
        const variant = documentVariant(current, entity, value);
        if (variant) this.tokenEntities.set(sameEntity, variant);
      }
      return sameEntity;
    }

    // "JAN KOWALSKI" from a heading, without a paradigm: the same person as a
    // known "Jan Kowalski" (one token, restored in normal spelling).
    if (ENTITY_KINDS.has(kind) && !entity && isShouting(value)) {
      const upper = value.toLocaleUpperCase("pl");
      for (const [token, known] of this.tokenToValue) {
        if (this.tokenMetadata.get(token)?.kind !== kind || this.tokenEntities.get(token)?.type === "organization") continue;
        if (known.toLocaleUpperCase("pl") === upper) {
          this.keyToToken.set(key, token);
          this.tokenSurfaces.get(token)?.add(value);
          return token;
        }
      }
    }

    const next =
      (
        this.counters.get(
          kind
        ) ?? 0
      ) + 1;
    this.counters.set(
      kind,
      next
    );
    const token =
      `[PII:${kind}:${String(
        next
      ).padStart(4, "0")}]`;
    this.keyToToken.set(
      key,
      token
    );
    this.tokenToValue.set(
      token,
      value
    );
    this.tokenSurfaces.set(token, new Set([value]));
    this.tokenMetadata.set(
      token,
      {
        kind,
        createdAt:
          new Date()
            .toISOString()
      }
    );
    if (entity && entityKey) {
      this.tokenEntities.set(
        token,
        calmEntity(entity)
      );
      this.keyToToken.set(
        entityKey,
        token
      );
    }
    return token;
  }

  /**
   * Two analyses of one person can reach different lemmas (Malek from
   * "Daniel Malek", Malc from "Danielem Malkiem"); when two paradigms share at
   * a case form they are the same entity.
   */
  private overlappingEntityToken(
    kind: PiiKind,
    entity: PersonEntity,
    value: string
  ): string | undefined {
    const lower = (text: string) => text.toLocaleLowerCase("pl");
    const forms = new Set(Object.values(entity.forms).map((form) => lower(form.text)));
    if (entity.type === "organization") return undefined;
    for (const [token, other] of this.tokenEntities) {
      if (this.tokenMetadata.get(token)?.kind !== kind) continue;
      // A firm, or one person against a family: never the same entity.
      if (other.type === "organization" || (other.number ?? "sg") !== (entity.number ?? "sg")) continue;
      const otherForms = new Set(Object.values(other.forms).map((form) => lower(form.text)));
      // The mention is one of the forms of a known entity, or a known mention
      // is one of this entity's forms - whatever gender either analysis chose
      // for an ambiguous form ("Martynie Jurdze").
      if (otherForms.has(lower(value))) return token;
      const surfaces = this.tokenSurfaces.get(token);
      if (surfaces && [...surfaces].some((surface) => forms.has(lower(surface)))) return token;
      if (other.gender === entity.gender && [...otherForms].some((text) => forms.has(text))) return token;
    }
    return undefined;
  }

  entity(
    token: string
  ): PersonEntity | undefined {
    return this.tokenEntities.get(
      token
    );
  }

  /**
   * Value for a token in a model's output. A person token with a case
   * ([PII:PERSON:0001|INS]) gets that inflected form; a bare person token gets
   * the nominative. Other kinds return the stored value.
   */
  restore(
    token: string,
    requestedCase: string | null
  ): RestoredToken {
    const value =
      this.tokenToValue.get(
        token
      );
    const metadata =
      this.tokenMetadata.get(
        token
      );
    if (value === undefined || !metadata) {
      throw new Error(
        `Unknown pseudonymization token: ${token}`
      );
    }
    const entity =
      this.tokenEntities.get(
        token
      );
    const validCase =
      requestedCase &&
      (PERSON_CASES as readonly string[]).includes(
        requestedCase
      )
        ? requestedCase as PersonCase
        : null;
    if (!entity) {
      return {
        token,
        requestedCase: validCase,
        text: value,
        kind: metadata.kind,
        source: "stored",
        confidence: 1,
        status:
          metadata.kind === "PERSON" && requestedCase
            ? "no_forms"
            : "ok"
      };
    }
    const form =
      entity.forms[
        validCase ?? "NOM"
      ];
    return {
      token,
      requestedCase: validCase,
      text: form.text,
      kind: metadata.kind,
      source: form.source,
      confidence: form.confidence,
      status:
        requestedCase && !validCase
          ? "invalid_case"
          : "ok"
    };
  }

  /**
   * Every known written form of every person in this vault: the surfaces
   * found so far and, with the morphology engine, all seven cases.
   */
  /** Drops a token and everything that maps to it (the user un-anonymized it). */
  remove(token: string): boolean {
    if (!this.tokenToValue.has(token)) return false;
    this.tokenToValue.delete(token);
    this.tokenMetadata.delete(token);
    this.tokenEntities.delete(token);
    this.tokenSurfaces.delete(token);
    for (const [key, value] of [...this.keyToToken]) {
      if (value === token) this.keyToToken.delete(key);
    }
    return true;
  }

  /**
   * Case forms corrected by the user: each given form becomes a manual,
   * certain form; the nominative also becomes the entity's canonical name.
   */
  updateForms(token: string, forms: Partial<Record<PersonCase, string>>): PersonEntity {
    const entity = this.tokenEntities.get(token);
    if (!entity) throw new Error("PRIVACY_KEY_ENTITY_NOT_FOUND");
    const next: PersonEntity = {
      ...entity,
      forms: { ...entity.forms },
      warnings: [...entity.warnings]
    };
    for (const personCase of PERSON_CASES) {
      const text = forms[personCase]?.trim();
      if (!text) continue;
      next.forms[personCase] = { text, source: "manual", confidence: 1 };
    }
    next.canonical = next.forms.NOM.text;
    next.status = "ok";
    this.tokenEntities.set(token, next);
    this.keyToToken.set(`${this.tokenMetadata.get(token)!.kind}\u0000${next.canonical}`, token);
    return next;
  }

  /**
   * Replaces a person token's entity after the user set what it is (a man,
   * a woman, several persons, a firm): the token and its surfaces stay, the
   * keys follow the new kind of entity.
   */
  setEntity(token: string, next: PersonEntity): void {
    const kind = this.tokenMetadata.get(token)?.kind;
    const current = this.tokenEntities.get(token);
    if (kind !== "PERSON" || !current) throw new Error("PRIVACY_KEY_ENTITY_NOT_FOUND");
    const wasFirm = current.type === "organization";
    const isFirm = next.type === "organization";
    for (const [key, value] of [...this.keyToToken]) {
      if (value !== token) continue;
      if (key.startsWith(`${kind}\u0000entity\u0000`)) {
        this.keyToToken.delete(key);
      } else if (wasFirm !== isFirm) {
        const surface = wasFirm ? key.slice(`${kind}\u0000org\u0000`.length) : key.slice(`${kind}\u0000`.length);
        const moved = valueKey(kind, surface, next);
        const other = this.keyToToken.get(moved);
        if (other && other !== token) throw new Error("PRIVACY_KEY_CONFLICT");
        this.keyToToken.delete(key);
        this.keyToToken.set(moved, token);
      }
    }
    const entityKey = personEntityKey(next, kind);
    const other = this.keyToToken.get(entityKey);
    if (other && other !== token) throw new Error("PRIVACY_KEY_CONFLICT");
    this.keyToToken.set(entityKey, token);
    this.tokenEntities.set(token, next);
  }

  knownEntityForms(): Array<{ text: string; kind: PiiKind; entity?: PersonEntity }> {
    const forms = new Map<string, { kind: PiiKind; entity?: PersonEntity }>();
    for (const [token, value] of this.tokenToValue) {
      const kind = this.tokenMetadata.get(token)?.kind;
      if (!kind || !ENTITY_KINDS.has(kind)) continue;
      const stored = this.tokenEntities.get(token);
      // A firm's name also protects other mentions, but they are read afresh
      // (the same words may be the owner's name).
      const entity = stored?.type === "organization" ? undefined : stored;
      if (!forms.has(value)) forms.set(value, entity ? { kind, entity } : { kind });
      if (entity) {
        for (const form of Object.values(entity.forms)) {
          if (!forms.has(form.text)) forms.set(form.text, { kind, entity });
        }
      }
    }
    return [...forms]
      .filter(([text]) => text.trim().length >= 4)
      .map(([text, item]) => ({ text, ...item }));
  }

  hasToken(
    token: string
  ): boolean {
    return this.tokenToValue
      .has(token);
  }

  resolveToken(
    token: string
  ): string {
    const value =
      this.tokenToValue.get(
        token
      );
    if (value === undefined) {
      throw new Error(
        `Unknown pseudonymization token: ${token}`
      );
    }
    return value;
  }

  snapshot():
    PseudonymizationVaultSnapshot {
    const counters:
      Partial<
        Record<PiiKind, number>
      > = {};
    for (
      const [kind, count]
      of this.counters
    ) {
      counters[kind] = count;
    }

    const tokens =
      [...this.tokenToValue
        .entries()]
        .map(
          ([token, value]) => {
            const metadata =
              this.tokenMetadata
                .get(token);
            if (!metadata) {
              throw new Error(
                "PRIVACY_VAULT_METADATA_MISSING"
              );
            }
            const entity =
              this.tokenEntities.get(
                token
              );
            return {
              token,
              kind:
                metadata.kind,
              value,
              createdAt:
                metadata.createdAt,
              ...(entity
                ? { entity }
                : {})
            };
          }
        )
        .sort((a, b) =>
          a.token.localeCompare(
            b.token,
            "en"
          )
        );

    return {
      counters,
      tokens
    };
  }

  deanonymize(
    text: string
  ): string {
    return text.replace(
      PII_TOKEN_WITH_CASE,
      (_match, kind: string, sequence: string, requestedCase?: string) =>
        this.restore(
          `[PII:${kind}:${sequence}]`,
          requestedCase ?? null
        ).text
    );
  }

  get size(): number {
    return this.tokenToValue
      .size;
  }
}

/** A line naming a role or an office ("Radców Prawnych", "Kancelaria Adwokatów"), not a person. */
function roleHeading(line: string): boolean {
  const first = /\p{L}+/u.exec(line)?.[0]?.toLowerCase();
  const words = genericWords();
  return Boolean(first && (words.personOnlyTriggers.has(first) || words.institutions.has(first)));
}

export class LocalPolishPseudonymizer {
  constructor(
    private readonly vault: PseudonymizationVault,
    private readonly namedEntities?: NamedEntityRecognizer,
    private readonly morphology?: PersonMorphology,
    // Firm name, address and representatives from the VAT white list and KRS for a NIP/KRS in the text.
    private readonly registry?: RegistryFormsProvider
  ) {}

  async pseudonymize(
    text: string,
    directives: ManualPrivacyDirective[] = []
  ): Promise<PseudonymizationResult> {
    const manual = normalizeDirectives(text, directives);
    const keep = manual.filter(
      (item) => item.action === "KEEP"
    );
    const labelDirectives = manual.filter(
      (item) => item.action === "LABEL"
    );
    const annotations: PrivacyAnnotation[] =
      labelDirectives.map((item) => ({
        start: item.start,
        end: item.end,
        label: item.label!
      }));

    const manualPseudonyms: PiiSpan[] = manual
      .filter(
        (item) => item.action === "PSEUDONYMIZE"
      )
      .map((item) => ({
        start: item.start,
        end: item.end,
        kind: item.kind === "FIRM" ? "PERSON" as const : item.kind ?? "CUSTOM",
        value: text.slice(item.start, item.end),
        source: "USER" as const,
        ...(item.label ? { label: item.label } : {})
      }));

    const autoSpans: PiiSpan[] = detectIdentifiers(text);
    // Street addresses by structure, also when the local gazetteer worker is unavailable.
    autoSpans.push(...detectStreetAddresses(text));
    // Private firms ([FIRMA]): a name before a legal form or after a business prefix,
    // and its later mentions; one organization token per name.
    const firms = detectFirmNames(text);
    autoSpans.push(...firms);

    // Register data of firms named by NIP/KRS: their names, addresses and people are
    // protected even where no legal form or prefix marks them ("umowę z Transkomem").
    const registryFirms = new Map<string, string | undefined>();
    let registered: Awaited<ReturnType<RegistryFormsProvider["forms"]>> = [];
    try {
      registered = this.registry ? await this.registry.forms(text) : [];
    } catch (error) {
      process.stderr.write(`REGISTRY_ENRICHMENT_DEGRADED:${error instanceof Error ? error.message : String(error)}\n`);
    }
    for (const form of registered) {
      // Any letter case and spacing ("UL. DŁUGA 5", "Długa  5", "DŁUGA 5"): the same letters with
      // the register's house number do not appear by chance. A firm's name in any case too,
      // but not written all in small letters (a common phrase, not the name).
      const escaped = form.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/gu, "\\s+");
      const anyCase = form.kind === "ADDRESS" || Boolean(form.organization);
      for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, anyCase ? "giu" : "gu"))) {
        if (form.organization && match[0] !== form.text && match[0] === match[0].toLocaleLowerCase("pl")) continue;
        autoSpans.push({ start: match.index!, end: match.index! + match[0].length, kind: form.kind, value: match[0], confidence: 1, source: "AUTO" });
        if (form.organization) registryFirms.set(match[0], form.organization.legalForm);
      }
    }

    // A person found once is protected everywhere: mentions the recognizer
    // missed (another page, another case form) are matched by known forms.
    const propagatedEntities =
      new Map<string, PersonEntity>();
    // Also the all-caps spelling of a known form ("POWÓD: JAN KOWALSKI" in a heading).
    const knownForms = this.vault.knownEntityForms().flatMap((form) => {
      const shouted = form.text.toLocaleUpperCase("pl");
      return shouted === form.text ? [form] : [form, { ...form, text: shouted }];
    });
    for (const form of knownForms) {
      const escaped = form.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const match of text.matchAll(
        new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu")
      )) {
        autoSpans.push({
          start: match.index!,
          end: match.index! + match[0].length,
          kind: form.kind,
          value: match[0],
          confidence: 1,
          source: "AUTO"
        });
        if (form.entity) propagatedEntities.set(`${form.kind}\u0000${match[0]}`, form.entity);
      }
    }

    if (this.namedEntities) {
      const named =
        await this.namedEntities.recognize(text);
      for (const recognized of named) {
        // A name never runs over a line: "Paweł Kania⏎os. Kosmonautów 86/9" (a heading
        // and the address under it) is the name; the address is found on its own.
        const lineEnd = recognized.kind === "PERSON" ? recognized.value.indexOf("\n") : -1;
        // A role heading on the first line ("Radców Prawnych⏎Nowak Lis"): the name is below.
        const heading = lineEnd > 0 && roleHeading(recognized.value.slice(0, lineEnd));
        const below = heading ? recognized.value.slice(lineEnd + 1).split("\n")[0]!.trim() : "";
        const found =
          heading
            ? { ...recognized, start: recognized.start + recognized.value.indexOf(below, lineEnd + 1), value: below }
            : lineEnd > 0
              ? { ...recognized, end: recognized.start + lineEnd, value: recognized.value.slice(0, lineEnd).trimEnd() }
              : recognized;
        if (lineEnd > 0) found.end = found.start + found.value.length;
        if (!found.value) continue;
        // A double surname the recognizer cut at the hyphen ("Nicole Brzezińska" of "Nicole Brzezińska-Król").
        if (found.kind === "PERSON") {
          const rest = /^-\p{Lu}\p{Ll}+/u.exec(text.slice(found.end, found.end + 40));
          if (rest) {
            found.end += rest[0].length;
            found.value = text.slice(found.start, found.end);
          }
        }
        // "Bank", "Rada Gminy": an institution; "Najemca Jan Kowalski": the name only.
        const span = found.kind === "PERSON" ? personPart(text, found) : found;
        if (
          span &&
          text.slice(
            span.start,
            span.end
          ) === span.value
        ) {
          autoSpans.push({
            ...span,
            source: "AUTO"
          });
        }
      }
    }

    // The gazetteer is down (Morfeusz not started): names from the PESEL registers instead,
    // so a given name with a surname is not left in clear (pesel-names.ts).
    if (degradedRecognizers().some((item) => item.name.startsWith("Morfeusz"))) {
      for (const span of detectPeselNames(text)) {
        if (!autoSpans.some((other) => other.kind === "PERSON" && other.start < span.end && span.start < other.end)) autoSpans.push(span);
      }
    }

    // A maiden name after "z d." / "z domu" ("Anna Nowak z d. Kot"): a person, whatever the word.
    for (const match of text.matchAll(/(?<![\p{L}])z\s*(?:d\.|domu)\s+(\p{Lu}[\p{L}'’]+(?:-\p{Lu}[\p{L}'’]+)?)/gu)) {
      const start = match.index! + match[0].length - match[1]!.length;
      autoSpans.push({ start, end: start + match[1]!.length, kind: "PERSON", value: match[1]!, confidence: 0.95, source: "AUTO" });
    }

    // A firm name read after a prefix may run into its owner's name ("P.H.U. Marex Marek
    // Nowak"): the firm ends where a recognized person starts; the person keeps its own token.
    for (const firm of firms) {
      const owner = autoSpans
        .filter((span) => span.kind === "PERSON" && !firms.includes(span) && span.start > firm.start && span.start < firm.end && span.end >= firm.end)
        .sort((a, b) => a.start - b.start)[0];
      if (!owner) continue;
      const value = text.slice(firm.start, owner.start).trimEnd();
      firm.end = firm.start + value.length;
      firm.value = value;
    }
    for (let index = autoSpans.length - 1; index >= 0; index -= 1) {
      const span = autoSpans[index]!;
      if (firms.includes(span as (typeof firms)[number]) && !/\p{L}{2}/u.test(span.value)) autoSpans.splice(index, 1);
    }

    // The bare surname of a person recognized in this text, written with a capital inside a
    // sentence ("spotkał się z Lis", "Lis" also being a common noun the recognizer skips).
    const surnames = new Set(
      autoSpans
        .filter((span) => span.kind === "PERSON" && /\s/u.test(span.value) && !isShouting(span.value))
        .map((span) => span.value.split(/\s+/u).at(-1)!)
        .filter((surname) => /^\p{Lu}\p{Ll}{2,}(?:-\p{Lu}\p{Ll}+)?$/u.test(surname))
    );
    for (const surname of surnames) {
      for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}.-])${surname}(?![\\p{L}\\p{N}-])`, "gu"))) {
        const before = text.slice(Math.max(0, match.index! - 3), match.index!);
        if (/(?:^|[.!?]\s*|\n\s*)$/u.test(before) && !/\p{L}\s$/u.test(before)) continue;
        autoSpans.push({ start: match.index!, end: match.index! + match[0].length, kind: "PERSON", value: match[0], confidence: 0.9, source: "AUTO" });
      }
    }

    // A name recognized in the text also protects its all-caps spelling in the same text
    // ("NICOLE BARAN" in a heading above "Nicole Baran"): NER misses names in capitals.
    for (const found of [...autoSpans]) {
      if (found.kind !== "PERSON" || !/\s/u.test(found.value) || isShouting(found.value)) continue;
      const shouted = found.value.toLocaleUpperCase("pl");
      const escaped = shouted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"))) {
        autoSpans.push({ start: match.index!, end: match.index! + match[0].length, kind: "PERSON", value: match[0], confidence: 1, source: "AUTO" });
      }
    }

    const autoAllowed = autoSpans.filter(
      (span) =>
        !keep.some((item) => overlaps(span, item)) &&
        !labelDirectives.some(
          (item) => overlaps(span, item)
        ) &&
        !manualPseudonyms.some(
          (item) => overlaps(span, item)
        )
    );

    const findings = nonOverlapping([
      ...manualPseudonyms,
      ...autoAllowed
    ]);
    let output = text;
    const publicFindings: PseudonymizationFinding[] = [];

    // Canonical identity and paradigm of every person mention. Without the
    // morphology engine tokens fall back to exact-surface identity.
    // Canonical identity and paradigm of every person and address mention,
    // keyed by kind and surface. Without the morphology engine tokens fall back
    // to exact-surface identity.
    const entities =
      new Map<string, PersonEntity>(propagatedEntities);
    // An inflected mention ("z Transkomem") shares the firm's canonical name and so its token.
    for (const firm of firms) entities.set(`PERSON\u0000${firm.value}`, organizationEntity(firm.canonical ?? firm.value, firm.legalForm));
    for (const [value, legalForm] of registryFirms) {
      if (!entities.has(`PERSON\u0000${value}`)) entities.set(`PERSON\u0000${value}`, organizationEntity(value, legalForm));
    }
    // The user's "Firma" marks: the firm's identity, with the legal form written next to it.
    for (const item of manual) {
      if (item.action !== "PSEUDONYMIZE" || item.kind !== "FIRM") continue;
      const value = text.slice(item.start, item.end);
      entities.set(`PERSON\u0000${value}`, organizationEntity(value, firmContext(text, item.start, item.end)?.legalForm));
    }
    // Surfaces written after "państwo", "małżonkowie", a plural role...: a family.
    const plural = new Set(
      findings
        .filter((finding) => finding.kind === "PERSON")
        .filter((finding) => {
          const previous = /([\p{L}]+)\s*$/u.exec(text.slice(Math.max(0, finding.start - 30), finding.start));
          return previous && GROUP_WORDS.has(previous[1]!.toLocaleLowerCase("pl"));
        })
        .map((finding) => finding.value)
    );
    const analyse = async (
      kind: PiiKind,
      run: ((surfaces: string[]) => Promise<Array<PersonEntity | null>>) | undefined
    ) => {
      if (!run) return;
      const surfaces = [
        ...new Set(
          findings
            .filter((finding) => finding.kind === kind)
            .map((finding) => finding.value)
            .filter((value) => !entities.has(`${kind}\u0000${value}`))
        )
      ];
      if (surfaces.length === 0) return;
      try {
        const analysed = await run(surfaces);
        surfaces.forEach((surface, index) => {
          const entity = analysed[index];
          if (entity) entities.set(`${kind}\u0000${surface}`, entity);
        });
      } catch (error) {
        process.stderr.write(
          `${kind}_MORPHOLOGY_DEGRADED:${error instanceof Error ? error.message : String(error)}\n`
        );
      }
    };
    if (this.morphology) {
      const morphology = this.morphology;
      await analyse("PERSON", (surfaces) =>
        morphology.analyze(surfaces, surfaces.map((surface) => (plural.has(surface) ? { numberHint: "pl" as const } : undefined)))
      );
      await analyse(
        "ADDRESS",
        morphology.analyzeAddresses
          ? (surfaces) => morphology.analyzeAddresses!(surfaces)
          : undefined
      );
    }

    // A known person by surname alone or surname first ("Nowakowi", "Pan Wilk", "WILK JAN"):
    // the full name's token, so the model sees one person (surname-propagation.ts).
    {
      const known = [...new Set(entities.values())];
      const singleWordPerson = (item: PiiSpan) => item.kind === "PERSON" && !/\s/u.test(item.value.trim());
      const blocked = (start: number, end: number) =>
        [...keep, ...labelDirectives, ...findings.filter((item) => !singleWordPerson(item))].some((item) => overlaps({ start, end }, item));
      for (const mention of surnameMentions(text, known, blocked)) {
        const same = findings.find((item) => item.kind === "PERSON" && item.start === mention.start && item.end === mention.end);
        // A longer mention ("Nowak Piotr") takes the place of a lone surname found inside it,
        // which would leave the given name in clear text under another token.
        const inside = findings.filter(
          (item) => item !== same && singleWordPerson(item) && item.source !== "USER" && item.start >= mention.start && item.end <= mention.end
        );
        for (const item of inside) findings.splice(findings.indexOf(item), 1);
        if (!same && findings.some((item) => overlaps(mention, item))) continue;
        if (!same) {
          findings.push({
            start: mention.start,
            end: mention.end,
            kind: "PERSON",
            value: mention.value,
            confidence: 0.9,
            source: "AUTO",
            ...(mention.ambiguous ? { ambiguous: true } : {})
          });
        }
        entities.set(`PERSON\u0000${mention.value}`, mention.entity);
      }
    }

    // Per mention: a firm named after a person, a family the recognizer
    // missed ("małżonkowie Kowalscy") and given names that share the next
    // person's surname ("Piotrowi i Marii Nowakom"). New mentions are added
    // only when the dictionary confirms them.
    const byFinding = new Map<PiiSpan, PersonEntity>();
    for (const finding of findings) {
      if (finding.kind !== "PERSON" || finding.source === "USER") continue;
      const firm = firmContext(text, finding.start, finding.end);
      if (firm) byFinding.set(finding, organizationEntity((finding as FirmSpan).canonical ?? finding.value, firm.legalForm));
    }
    if (this.morphology) {
      const morphology = this.morphology;
      const taken = (start: number, end: number) =>
        [...keep, ...labelDirectives, ...findings].some((item) => overlaps({ start, end }, item));
      const analyseSafely = async (surfaces: string[], hints?: Array<{ numberHint: "pl" } | undefined>) => {
        try {
          return await morphology.analyze(surfaces, hints);
        } catch (error) {
          process.stderr.write(`PERSON_MORPHOLOGY_DEGRADED:${error instanceof Error ? error.message : String(error)}\n`);
          return surfaces.map(() => null);
        }
      };

      const families: PiiSpan[] = [];
      for (const match of text.matchAll(/(?<![\p{L}])(\p{L}+)\s+(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)(?![\p{L}])/gu)) {
        if (!GROUP_WORDS.has(match[1]!.toLocaleLowerCase("pl"))) continue;
        const start = match.index! + match[0].length - match[2]!.length;
        const end = start + match[2]!.length;
        if (!taken(start, end)) families.push({ start, end, kind: "PERSON", value: match[2]!, confidence: 0.9, source: "AUTO" });
      }
      if (families.length) {
        const analysed = await analyseSafely(families.map((span) => span.value), families.map(() => ({ numberHint: "pl" as const })));
        families.forEach((span, position) => {
          const entity = analysed[position];
          if (entity?.number !== "pl" || taken(span.start, span.end)) return;
          findings.push(span);
          entities.set(`PERSON\u0000${span.value}`, entity);
        });
      }

      const shared: Array<{ span: PiiSpan; surface: string; added: boolean }> = [];
      for (const finding of [...findings]) {
        const entity = entities.get(`PERSON\u0000${finding.value}`);
        if (finding.kind !== "PERSON" || byFinding.has(finding) || !entity?.warnings.includes("SHARED_SURNAME")) continue;
        const surname = finding.value.split(/\s+/).pop()!;
        let cursor = finding.start;
        for (let step = 0; step < 5; step += 1) {
          const before = text.slice(Math.max(0, cursor - 60), cursor);
          const match = /(?<![\p{L}])(\p{Lu}\p{Ll}+)\s*(?:,|\bi\b|\boraz\b)\s*$/u.exec(before);
          if (!match) break;
          const start = cursor - before.length + match.index;
          const end = start + match[1]!.length;
          const existing = findings.find((item) => item.start === start && item.end === end && item.kind === "PERSON");
          if (!existing && taken(start, end)) break;
          shared.push({
            span: existing ?? { start, end, kind: "PERSON", value: match[1]!, confidence: 0.9, source: "AUTO" },
            surface: `${match[1]} ${surname}`,
            added: !existing
          });
          cursor = start;
        }
      }
      if (shared.length) {
        const analysed = await analyseSafely(shared.map((item) => item.surface));
        shared.forEach((item, position) => {
          const entity = analysed[position];
          // Only a name SGJP knows as a given name gets the shared surname.
          if (!entity?.warnings.includes("SHARED_SURNAME")) return;
          if (item.added) {
            if (taken(item.span.start, item.span.end)) return;
            findings.push(item.span);
          }
          byFinding.set(item.span, entity);
        });
      }
      findings.sort((a, b) => a.start - b.start);
    }

    for (
      let index = findings.length - 1;
      index >= 0;
      index -= 1
    ) {
      const finding = findings[index]!;
      const token = this.vault.getOrCreate(
        finding.kind,
        finding.value,
        byFinding.get(finding) ?? entities.get(`${finding.kind}\u0000${finding.value}`)
      );
      output =
        output.slice(0, finding.start) +
        token +
        output.slice(finding.end);
      const entity = byFinding.get(finding) ?? entities.get(`${finding.kind}\u0000${finding.value}`);
      publicFindings.push({
        token,
        kind: finding.kind,
        ...(entity?.type === "organization" ? { firm: registryFirms.has(finding.value) ? "REGISTRY" as const : "TEXT" as const } : {}),
        start: finding.start,
        end: finding.end,
        source: finding.source ?? "AUTO",
        ...(finding.label
          ? { label: finding.label }
          : {}),
        ...(finding.ambiguous && finding.kind === "PERSON" && finding.source !== "USER" && entity
          ? { uncertain: `nazwisko osoby ${entity.canonical} czy słowo pospolite?` }
          : {})
      });
    }

    publicFindings.reverse();
    const counts: Partial<Record<PiiKind, number>> = {};
    for (const finding of publicFindings) {
      counts[finding.kind] =
        (counts[finding.kind] ?? 0) + 1;
    }

    return {
      text: output,
      findings: publicFindings,
      annotations,
      keptRanges: keep.map((item) => ({
        start: item.start,
        end: item.end
      })),
      counts
    };
  }

  deanonymize(text: string): string {
    return this.vault.deanonymize(text);
  }
}

/**
 * Leak test of the outgoing text (as in a pre-send tightness check): a value the
 * pseudonymizer replaced must not survive anywhere else in the protected text
 * (a second occurrence the recognizer missed). Every remaining occurrence is
 * replaced by the same token, so the answer still restores it. Values shorter
 * than 3 characters are skipped (they also occur inside ordinary words).
 */
export function sealResidualValues(
  original: string,
  protectedText: string,
  findings: ReadonlyArray<Pick<PseudonymizationFinding, "start" | "end" | "token">>
): { text: string; sealed: number } {
  const byValue = new Map<string, string>();
  for (const finding of findings) {
    const value = original.slice(finding.start, finding.end).trim();
    if (value.length >= 3 && !byValue.has(value)) byValue.set(value, finding.token);
  }
  let text = protectedText;
  let sealed = 0;
  // Longest values first: "Jan Kowalski" before "Kowalski".
  for (const [value, token] of [...byValue.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu");
    text = text.replace(pattern, () => {
      sealed += 1;
      return token;
    });
  }
  return { text, sealed };
}
