import { htmlToText } from "./core-law-index.js";
import { classifyKnownLegalSourceUrl } from "./legal-source-policy.js";
import type { VerificationKind, VerificationRecord } from "./verification-ledger.js";

// Źródła zastępcze przy BRAKU-AKTU w RZĘDZIE 1 (Sejm ELI nie działa), wg kanonu
// E-1…E-5 (shared/HIERARCHIA-ZRODEL.md) i 🟨 KOTWICA URZĘDOWA (PRAWO-HARDGATE-BLOKADA):
//   E-3  RZĄD 2A (urzędowe bazy; LEX/Legalis przy dostępie) -> ✅ [VER: źródło, data]
//   E-4  RZĄD 2B: dwa niezależne portale, zgodne, ze znacznikiem t.j. zgodnym z K-1
//        -> 🟨 [KOTWICA-URZĘDOWA: …] + 📚 [TREŚĆ: RZĄD 2B — …]
//   E-5  wszystko inne -> ⚠️ [NIEWERYFIKOWANE]; RZĄD 3 nigdy nie potwierdza przepisu.
// Hierarchia statusów jest zamknięta: żadnych nowych etykiet.

export class SubstituteSourceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SubstituteSourceError";
  }
}

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_URLS = 3;

// E-3: LEX / Legalis to w kanonie RZĄD 2A dla brzmienia przepisu (przy dostępie).
const E3_HOSTS = new Set(["lex.pl", "www.lex.pl", "sip.lex.pl", "legalis.pl", "www.legalis.pl", "sip.legalis.pl"]);

export type SubstituteTier = "R2A" | "R2B";

export function substituteTier(value: string): SubstituteTier | "R1" | "R3" {
  const host = new URL(value).hostname.toLowerCase();
  if (E3_HOSTS.has(host)) return "R2A";
  return classifyKnownLegalSourceUrl(value) ?? "R3";
}

/** K-1: tożsamość aktu i numer aktualnego t.j. z indeksu RZĘDU 1 (kopia ELI). */
export type ConsolidatedIdentity = { year: string; position: string };

export type SubstituteOutcome = {
  record: VerificationRecord;
  marker: string;
  status: "VER" | "KOTWICA" | "NIEWERYFIKOWANE";
  reasons: string[];
};

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pl")
    .trim();
}

/** Number of the article in a claim ("art. 233 § 1 KK" -> "233"). */
export function claimArticle(claim: string): string | null {
  return /\bart\.?\s*(\d+[a-z]{0,4})/iu.exec(claim)?.[1]?.toLocaleLowerCase("pl") ?? null;
}

/** Fragment of the source text from the article heading, or null. */
export function articleEvidence(text: string, article: string): string | null {
  const escaped = article.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)(?:art\\.|artykuł)\\s*${escaped}\\.?(?=\\s)`, "iu").exec(text);
  if (!match) return null;
  return text.slice(match.index, match.index + 3_000).trim();
}

/** K-3: znacznik t.j. na stronie zgodny z K-1 ("Dz.U. 2025 poz. 383" w treści). */
export function showsConsolidated(text: string, identity: ConsolidatedIdentity): boolean {
  const flat = normalize(text).replace(/dz\.\s*u\./g, "dz.u.");
  return new RegExp(`dz\\.u\\.\\s*(?:z\\s*)?${identity.year}\\s*r?\\.?\\s*,?\\s*poz\\.\\s*${identity.position}(?!\\d)`).test(flat);
}

async function fetchText(url: URL, fetcher: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, {
      redirect: "error",
      headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new SubstituteSourceError("SUBSTITUTE_FETCH_FAILED");
  }
  if (!response.ok) throw new SubstituteSourceError(`SUBSTITUTE_FETCH_FAILED:HTTP_${response.status}`);
  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/text\/html|xhtml|text\/plain/.test(type)) throw new SubstituteSourceError("SUBSTITUTE_CONTENT_UNSUPPORTED");
  const raw = await response.text();
  if (raw.length > MAX_BYTES) throw new SubstituteSourceError("SUBSTITUTE_TOO_LARGE");
  return type.includes("text/plain") ? raw : htmlToText(raw);
}

function checkedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SubstituteSourceError("SUBSTITUTE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new SubstituteSourceError("SUBSTITUTE_URL_INVALID");
  // Adres nie może nieść danych sprawy (długie zapytania, symbole zastępcze).
  if (url.search.length > 200 || /\[(?:PII|LMPII)/i.test(decodeURIComponent(url.href))) {
    throw new SubstituteSourceError("SUBSTITUTE_URL_INVALID");
  }
  return url;
}

export async function verifySubstituteSources(args: {
  urls: string[];
  claim: string;
  kind: VerificationKind;
  quote?: string;
  identity: ConsolidatedIdentity | null;
  r1Cause: string;
  toolCallId: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}): Promise<SubstituteOutcome> {
  if (args.kind !== "statute") throw new SubstituteSourceError("SUBSTITUTE_STATUTE_ONLY");
  const article = claimArticle(args.claim);
  if (!article) throw new SubstituteSourceError("SUBSTITUTE_ARTICLE_REQUIRED");
  const urls = [...new Set(args.urls.map((url) => url.trim()).filter(Boolean))].slice(0, MAX_URLS).map(checkedUrl);
  if (urls.length === 0) throw new SubstituteSourceError("SUBSTITUTE_URL_INVALID");
  const tiers = urls.map((url) => substituteTier(url.toString()));
  if (tiers.includes("R1")) throw new SubstituteSourceError("SUBSTITUTE_IS_R1_SOURCE");
  if (tiers.every((tier) => tier === "R3")) throw new SubstituteSourceError("SUBSTITUTE_R3_AUXILIARY_ONLY");

  const fetcher = args.fetcher ?? globalThis.fetch.bind(globalThis);
  const fetchedAt = (args.now ?? (() => new Date()))().toISOString();
  const day = fetchedAt.slice(0, 10);
  const reasons: string[] = [];
  const quoteOk = (evidence: string) => !args.quote?.trim() || normalize(evidence).includes(normalize(args.quote));
  const base = {
    claim: args.claim,
    kind: args.kind,
    substituteFor: "R1" as const,
    fetchedAt,
    toolCallId: args.toolCallId,
    verificationMethod: "web_fetch" as const
  };

  // E-3: pierwsze źródło RZĘDU 2A z przepisem (i cytatem) wystarcza do ✅ [VER].
  for (const [index, url] of urls.entries()) {
    if (tiers[index] !== "R2A") continue;
    const text = await fetchText(url, fetcher).catch((error: unknown) => {
      reasons.push(`${url.hostname}: ${error instanceof SubstituteSourceError ? error.code : "SUBSTITUTE_FETCH_FAILED"}`);
      return null;
    });
    const evidence = text ? articleEvidence(text, article) : null;
    if (text && !evidence) reasons.push(`${url.hostname}: brak art. ${article}`);
    if (evidence && !quoteOk(evidence)) reasons.push(`${url.hostname}: cytat niezgodny`);
    if (evidence && quoteOk(evidence)) {
      const record: VerificationRecord = { ...base, status: "VERIFIED", sourceUrl: url.toString(), sourceTier: "R2A", evidence };
      return { record, marker: `✅ [VER: ${url.toString()}, ${day}]`, status: "VER", reasons };
    }
  }

  // E-4: 🟨 KOTWICA URZĘDOWA tylko przy łącznym spełnieniu K-1…K-4.
  const portals: Array<{ url: URL; evidence: string; text: string }> = [];
  for (const [index, url] of urls.entries()) {
    if (tiers[index] !== "R2B") continue;
    if (portals.some((portal) => portal.url.hostname === url.hostname)) continue;
    const text = await fetchText(url, fetcher).catch((error: unknown) => {
      reasons.push(`${url.hostname}: ${error instanceof SubstituteSourceError ? error.code : "SUBSTITUTE_FETCH_FAILED"}`);
      return null;
    });
    const evidence = text ? articleEvidence(text, article) : null;
    if (text && !evidence) reasons.push(`${url.hostname}: brak art. ${article}`);
    if (text && evidence) portals.push({ url, evidence, text });
  }
  const head = (value: string) => normalize(value).slice(0, 400);
  const k1 = args.identity !== null;
  const k2 = portals.length >= 2 && head(portals[0]!.evidence) === head(portals[1]!.evidence) && portals.every((portal) => quoteOk(portal.evidence));
  const k3 = k1 && portals.length >= 2 && portals.slice(0, 2).every((portal) => showsConsolidated(portal.text, args.identity!));
  if (!k1) reasons.push("K-1: brak tożsamości t.j. z indeksu ELI");
  if (!k2) reasons.push("K-2: brak dwóch zgodnych portali RZĘDU 2B");
  if (k1 && !k3) reasons.push("K-3: brak znacznika t.j. zgodnego z K-1 na stronach 2B");
  if (k1 && k2 && k3) {
    const [first, second] = portals;
    const record: VerificationRecord = {
      ...base,
      status: "UNVERIFIED",
      sourceUrl: first!.url.toString(),
      sourceTier: "R2B",
      evidence: first!.evidence,
      officialAnchor: true
    };
    const marker =
      `🟨 [KOTWICA-URZĘDOWA: eli.gov.pl indeks — Dz.U. ${args.identity!.year} poz. ${args.identity!.position} t.j., ${day}] ` +
      `📚 [TREŚĆ: RZĄD 2B — ${first!.url.hostname} + ${second!.url.hostname}, znacznik t.j. sprawdzony, ${day}]`;
    return { record, marker, status: "KOTWICA", reasons };
  }
  const record: VerificationRecord = {
    ...base,
    status: "UNVERIFIED",
    ...(portals[0] ? { sourceUrl: portals[0].url.toString(), sourceTier: "R2B" as const, evidence: portals[0].evidence } : {})
  };
  return { record, marker: "⚠️ [NIEWERYFIKOWANE]", status: "NIEWERYFIKOWANE", reasons };
}
