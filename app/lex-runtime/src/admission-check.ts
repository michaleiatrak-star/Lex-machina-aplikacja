// An admission in a pleading is checked before it stays (RD 121/26 plan, point 5): the draft wrote
// that the decision's GDPR thesis "jest trafna" while the persons concerned were companies (not data
// subjects, art. 4 pkt 1 RODO) and art. 17 ust. 3 lit. e RODO did not fit the facts. When the draft
// concedes a thesis or drops a charge, one correcting round asks whether the premises of the concept
// are met for these entities and these facts, with the wording of the provisions read by the
// application (EU acts from EUR-Lex and statutes from ELI through verify_legal_reference, a code of
// professional ethics from its council's consolidated text).
import { citedEthicsParagraphs, ethicsPrompt, readEthicsParagraphs, type EthicsReading } from "./courts/ethics-codes.js";
import type { NormalizedToolCall, NormalizedToolResult } from "./providers/types.js";

const ADMISSION =
  /(?<![\p{L}])(?:tez\p{L}*\s+(?:\p{L}+\s+){0,6}?(?:jest\s+)?trafn\p{L}*|trafn\p{L}*\s+(?:jest\s+)?tez\p{L}*|(?:ma|mają|miał\p{L}*)\s+rację|rację\s+(?:ma|mają|należy\s+przyznać)|nie\s+podtrzymuj\p{L}*|nie\s+odpieram\p{L}*|nie\s+kwestionuj\p{L}*|przyznaj\p{L}*\s+(?:rację|że)|słusznie\s+(?:\p{L}+\s+)?(?:wskaza\p{L}*|przyj\p{L}*|uzna\p{L}*|stwierdzi\p{L}*|ustali\p{L}*)|rezygnuj\p{L}*\s+z\s+zarzut\p{L}*|wycofuj\p{L}*\s+zarzut\p{L}*)(?![\p{L}])/iu;

/** Lines (sentences) of the draft that concede a thesis or drop a charge, at most `limit`. */
export function admissions(answer: string, limit = 6): string[] {
  const found: string[] = [];
  for (const line of answer.split(/\n+/u)) {
    for (const sentence of line.split(/(?<=[.;!?])\s+(?=[\p{Lu}„(])/u)) {
      if (!ADMISSION.test(sentence)) continue;
      const text = sentence.trim().slice(0, 400);
      if (text && !found.includes(text)) found.push(text);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

export type CitedProvision = { claim: string; act: string };

const ACT_WORDS =
  "RODO|DSA|AI\\s+Act|k\\.?\\s?p\\.?\\s?a\\.?|k\\.?\\s?p\\.?\\s?c\\.?|k\\.?\\s?k\\.?|k\\.?\\s?p\\.?\\s?k\\.?|k\\.?\\s?c\\.?|k\\.?\\s?p\\.?|Pr\\.\\s*adw\\.|u\\.?\\s?o\\.?\\s?d\\.?\\s?o\\.?|p\\.?\\s?p\\.?\\s?s\\.?\\s?a\\.?|ustaw\\p{L}*\\s+(?:o\\s+)?[\\p{L} ]{3,60}?(?=[,.;)]|\\s+(?:i|oraz|w|z)\\s)";
const PROVISION = new RegExp(`(?<![\\p{L}])art\\.\\s*\\d+[a-z]?(?:\\s*(?:ust\\.|§|pkt|lit\\.|zd\\.)\\s*[\\da-z]+\\)?)*\\s+(${ACT_WORDS})`, "giu");

/** The provisions the admitted sentences and their context cite ("art. 4 pkt 1 RODO", "art. 88a Pr. adw."). */
export function citedProvisions(text: string, limit = 6): CitedProvision[] {
  const found: CitedProvision[] = [];
  for (const match of text.matchAll(PROVISION)) {
    const claim = match[0].replace(/\s+/gu, " ").trim();
    if (found.some((item) => item.claim === claim)) continue;
    found.push({ claim, act: match[1]!.replace(/\s+/gu, " ").trim() });
    if (found.length >= limit) break;
  }
  return found;
}

export type ProvisionWording = { claim: string; status: "VERIFIED" | "UNVERIFIED"; text: string; source: string | null };

/** The wording of each provision through verify_legal_reference (ELI, EUR-Lex for EU acts). */
export async function provisionWordings(provisions: readonly CitedProvision[], runTools: (calls: NormalizedToolCall[]) => Promise<NormalizedToolResult[]>): Promise<ProvisionWording[]> {
  if (!provisions.length) return [];
  const calls = provisions.map((provision, index) => ({
    id: `admission-${index + 1}`,
    name: "verify_legal_reference",
    input: { claim: provision.claim, kind: "statute", act: provision.act }
  }) satisfies NormalizedToolCall);
  const results = await runTools(calls).catch(() => [] as NormalizedToolResult[]);
  return calls.map((call, index) => {
    let payload: { status?: string; evidence?: string | null; sourceUrl?: string | null } = {};
    try {
      payload = JSON.parse(results.find((result) => result.tool_use_id === call.id)?.content ?? "{}") as typeof payload;
    } catch {
      payload = {};
    }
    return payload.status === "VERIFIED" && payload.evidence
      ? { claim: provisions[index]!.claim, status: "VERIFIED" as const, text: payload.evidence.slice(0, 2_500), source: payload.sourceUrl ?? null }
      : { claim: provisions[index]!.claim, status: "UNVERIFIED" as const, text: "", source: null };
  });
}

/** The cited paragraphs of a code of professional ethics (KEA from the Bar's consolidated text). */
export async function ethicsWordings(text: string): Promise<EthicsReading[]> {
  return Promise.all(citedEthicsParagraphs(text).map((item) => readEthicsParagraphs(item.code, item.paragraphs)));
}

export function admissionCorrection(conceded: readonly string[], wordings: readonly ProvisionWording[], ethics: readonly EthicsReading[]): string {
  return [
    "KONTROLA APLIKACJI — przyznanie w projekcie. Projekt oddaje tezę rozstrzygnięcia albo rezygnuje z zarzutu:",
    ...conceded.map((item, index) => `${index + 1}. „${item}”`),
    "Zanim to zostawisz, sprawdź na brzmieniu przepisów poniżej, czy przesłanki pojęcia, na którym opiera się teza, są spełnione wobec TYCH podmiotów i TYCH faktów (np. czy podmiot jest osobą fizyczną, której dane dotyczą; czy wyjątek obejmuje tę czynność; czy termin liczy się według brzmienia z dnia zdarzenia). Gdy przesłanki nie są spełnione, odeprzyj tezę i przywróć zarzut z tym argumentem. Przyznanie zostaw tylko wtedy, gdy kontrargumentu naprawdę nie ma, i napisz w uwagach poza pismem dlaczego. Oddaj cały projekt.",
    ...(wordings.length
      ? [
          "Brzmienie przepisów odczytane przez aplikację:",
          ...wordings.map((item) =>
            item.status === "VERIFIED"
              ? `- ${item.claim}${item.source ? ` (${item.source})` : ""}: ${item.text}`
              : `- ${item.claim}: brzmienia nie odczytano — nie opieraj na nim przyznania; oznacz powołanie jako niezweryfikowane.`
          )
        ]
      : []),
    ...(ethics.length ? [ethicsPrompt(ethics)] : [])
  ].join("\n\n");
}
