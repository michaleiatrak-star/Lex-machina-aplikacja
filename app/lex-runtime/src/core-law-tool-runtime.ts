import { searchStems } from "./core-law-search.js";
import type {
  NormalizedToolCall,
  NormalizedToolResult,
  NormalizedToolSchema
} from "./providers/types.js";
import {
  coreLawEliCaution,
  normalizeForSearch,
  type CoreActRef,
  type CoreLawIndex
} from "./core-law-index.js";
import {
  CoreLawActLookupError,
  lookupCoreLawAct,
  parseLegalActReference,
  type EliFetch
} from "./core-law-act-lookup.js";
import { anchoredUrl } from "./source-anchor.js";

const LIST_TOOL = "list_core_law_acts";
const SEARCH_TOOL = "search_core_law";
const READ_TOOL = "read_core_law_article";

const MAX_ARTICLE_CHARS = 20_000;
const MAX_SEARCH_HITS = 12;
const SNIPPET_CHARS = 320;

export type CoreLawAuditEvent = {
  tool: string;
  target: string;
  decision: "ALLOW" | "BLOCK";
  detail?: Record<string, unknown>;
};

const SCHEMAS: NormalizedToolSchema[] = [
  {
    type: "function",
    function: {
      name: LIST_TOOL,
      description:
        "List the Polish acts held locally from the official ELI text (acts named in the Lex domain act maps, acts added after verification and acts added by users), with ELI, title, status, article count, origin and whether the copy is current (eliCaution: verify the act in ELI before relying on the copy).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Optional title/abbreviation filter, e.g. KSH, VAT, zamówień publicznych."
          },
          domain: {
            type: "string",
            description: "Optional DR skill name filter, e.g. dr-03-prawo-karne-wykroczenia-egzekucja."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: SEARCH_TOOL,
      description:
        "Search the wording of the locally held core acts. Returns act ELI, article number and a snippet.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Words that must occur in the article, e.g. 'zachowek uprawniony'."
          },
          act: {
            type: "string",
            description: "Optional act: ELI (DU/2025/383), 'Dz.U. 2025 poz. 383' or abbreviation (KK, KC, KSH)."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: READ_TOOL,
      description:
        "Read the exact wording of one article of a core act from the locally held official ELI text. An act missing from the copy, given by ELI or Dz.U./M.P. reference, is fetched from Sejm ELI first. The copy is checked in ELI for a newer consolidated text before use.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["act", "article"],
        properties: {
          act: {
            type: "string",
            description: "ELI (DU/2025/383), 'Dz.U. 2025 poz. 383' or abbreviation/title (KK, KC, KSH, Kodeks spółek handlowych)."
          },
          article: {
            type: "string",
            description: "Article number, e.g. 148, 991, 17a."
          }
        }
      }
    }
  }
];

/** The part of an article around the first query term it contains. */
export function articleSnippet(body: string, query: string, chars = SNIPPET_CHARS): string {
  const normalized = normalizeForSearch(body);
  const term = searchStems(query).find((stem) => normalized.includes(stem));
  const at = term ? Math.max(0, normalized.indexOf(term) - 80) : 0;
  return body.slice(at, at + chars).replace(/\s+/g, " ");
}

const RAG_MAX_CHARS = 3_600;
const RAG_ARTICLE_CHARS = 1_100;
const RAG_MIN_SCORE = 4;

/**
 * Top core law articles for a question, as a prompt block. Placeholders are
 * ignored; nothing is returned for small talk or when nothing matches well.
 */
export function coreLawRetrievalPrompt(
  index: Pick<CoreLawIndex, "search" | "currentRecord">,
  query: string
): string | null {
  const clean = query.replace(/\[(?:PII|LMPII):[^\]]+\]/g, " ");
  if (clean.replace(/\s+/g, " ").trim().length < 12) return null;
  const blocks: string[] = [];
  let used = 0;
  for (const hit of index.search(clean, { limit: 6 })) {
    if (hit.score < RAG_MIN_SCORE) break;
    const body = index.currentRecord(hit.eli)?.articles[hit.article];
    if (!body) continue;
    const text = body.length > RAG_ARTICLE_CHARS ? body.slice(0, RAG_ARTICLE_CHARS) + " […]" : body;
    const block = `[${hit.eli}] ${hit.title} — art. ${hit.article}\n${text}`;
    if (used + block.length > RAG_MAX_CHARS) break;
    blocks.push(block);
    used += block.length;
  }
  if (blocks.length === 0) return null;
  return [
    "# LOKALNE TEKSTY USTAW (dobrane automatycznie z kopii ELI)",
    "Poniższe artykuły pochodzą z lokalnej kopii tekstów jednolitych aktów z map DR. Cytuj je z ELI i numerem artykułu, nigdy z pamięci. Jeśli nie wystarczą, użyj search_core_law / read_core_law_article; brak artykułu tutaj nie oznacza braku przepisu.",
    ...blocks
  ].join("\n\n");
}

export class CoreLawToolRuntime {
  private readonly events: CoreLawAuditEvent[] = [];

  constructor(
    private readonly index: CoreLawIndex,
    // Sejm ELI dla aktów, których brak w kopii.
    private readonly fetcher: EliFetch = globalThis.fetch.bind(globalThis)
  ) {}

  schemas(): NormalizedToolSchema[] {
    return SCHEMAS;
  }

  handles(name: string): boolean {
    return name === LIST_TOOL || name === SEARCH_TOOL || name === READ_TOOL;
  }

  systemPromptAppendix(): string {
    const withText = this.index.summaries().filter((act) => act.articleCount > 0);
    const added = withText.filter((act) => act.origin === "USER").length;
    const cautious = withText.filter((act) => coreLawEliCaution(act)).length;
    return [
      "# RDZEŃ PRAWA (TEKSTY Z ELI)",
      `Lokalnie dostępne są oficjalne teksty aktów z map dziedzinowych DR i prawo-polskie, aktów dołączonych po weryfikacji w ELI i aktów dodanych przez użytkowników (${withText.length} aktów z tekstem${added ? `, w tym ${added} dodanych przez użytkowników` : ""}); listę podaje list_core_law_acts.`,
      ...(cautious
        ? [`Kopia ${cautious} aktów nie jest aktualnym brzmieniem (eliCaution w list_core_law_acts): ich przepisy potwierdzaj verify_legal_reference w ELI.`]
        : []),
      "Dosłowne brzmienie przepisu bierz z read_core_law_article (albo search_core_law, gdy nie znasz numeru artykułu); nigdy nie cytuj przepisu z pamięci.",
      "Wynik podaje ELI, status aktu i datę pobrania. Jeśli mapa lub status wskazuje nowelizacje po tekście jednolitym, potwierdź aktualne brzmienie verify_legal_reference przed przedstawieniem go jako obowiązującego."
    ].join("\n");
  }

  auditEvents(): CoreLawAuditEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  async runTools(calls: NormalizedToolCall[]): Promise<NormalizedToolResult[]> {
    const results: NormalizedToolResult[] = [];
    for (const call of calls) results.push(await this.runTool(call));
    return results;
  }

  private async runTool(call: NormalizedToolCall): Promise<NormalizedToolResult> {
    try {
      return { tool_use_id: call.id, content: await this.execute(call) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.push({
        tool: call.name,
        target: String(call.input.act ?? call.input.query ?? "core-law"),
        decision: "BLOCK",
        detail: { error: message }
      });
      return {
        tool_use_id: call.id,
        content: JSON.stringify({ status: "BLOCKED", error: message })
      };
    }
  }

  /**
   * Akt z kopii; gdy go brak, a podano ELI albo Dz.U./M.P., sprawdzenie w Sejm ELI
   * i pobranie do kopii. Tekst, który jeszcze się pobiera, zwraca wynik DOWNLOADING.
   */
  private async resolveAct(value: unknown): Promise<{ ref: CoreActRef } | { result: string }> {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("CORE_LAW_ACT_REQUIRED");
    }
    const ref = this.index.resolve(value);
    if (ref) return { ref };
    if (!parseLegalActReference(value)) throw new Error("CORE_LAW_ACT_NOT_IN_MAPS");

    let added: { eli: string; added: boolean; ready: boolean };
    try {
      added = await this.index.addMissingAct(await lookupCoreLawAct(value, this.fetcher));
    } catch (error) {
      throw new Error(error instanceof CoreLawActLookupError ? error.code : "CORE_LAW_ACT_SOURCE_UNAVAILABLE");
    }
    this.events.push({
      tool: "core_law_fetch_missing",
      target: added.eli,
      decision: "ALLOW",
      detail: { added: added.added, ready: added.ready }
    });
    const fetched = this.index.ref(added.eli);
    if (added.ready && fetched) return { ref: fetched };
    return {
      result: JSON.stringify({
        status: "DOWNLOADING",
        eli: added.eli,
        sourceUrl: `https://api.sejm.gov.pl/eli/acts/${added.eli}`,
        instruction:
          "Akt nie był w lokalnej kopii; został sprawdzony w Sejm ELI i jego tekst jednolity jest pobierany do kopii. Do tego czasu potwierdź przepis verify_legal_reference w ELI; nie cytuj go z pamięci."
      })
    };
  }

  private async execute(call: NormalizedToolCall): Promise<string> {
    if (call.name === LIST_TOOL) {
      const query =
        typeof call.input.query === "string"
          ? normalizeForSearch(call.input.query.trim())
          : "";
      const domain =
        typeof call.input.domain === "string" ? call.input.domain.trim() : "";
      const acts = this.index
        .summaries()
        .filter((act) => !domain || act.domains.includes(domain))
        .filter(
          (act) =>
            !query ||
            [act.eli, act.title ?? "", ...act.labels].some((name) =>
              normalizeForSearch(name).includes(query)
            )
        )
        .slice(0, 80)
        .map((act) => ({
          eli: act.eli,
          title: act.title,
          labels: act.labels.slice(0, 3),
          status: act.status,
          consolidatedText: act.consolidated,
          articles: act.articleCount,
          fetchedAt: act.fetchedAt,
          available: act.articleCount > 0 || act.textSource !== null,
          origin: act.origin,
          eliCaution: coreLawEliCaution(act)
        }));
      this.events.push({
        tool: call.name,
        target: "core-law",
        decision: "ALLOW",
        detail: { returned: acts.length }
      });
      return JSON.stringify({ status: "OK", acts });
    }

    if (call.name === READ_TOOL) {
      const article = String(call.input.article ?? "")
        .replace(/^art\.?\s*/i, "")
        .trim()
        .toLowerCase();
      if (!article) throw new Error("CORE_LAW_ARTICLE_REQUIRED");
      const resolved = await this.resolveAct(call.input.act);
      if ("result" in resolved) return resolved.result;
      const { ref } = resolved;
      // Kopia to pamięć podręczna ELI: przed użyciem sprawdzenie, czy w ELI nie ma nowszej wersji.
      const liveCheck = await this.index.confirmCurrent(ref.eli);
      const record = this.index.currentRecord(ref.eli);
      if (!record) throw new Error("CORE_LAW_TEXT_NOT_YET_DOWNLOADED");
      const text = record.articles[article];
      if (text === undefined) throw new Error("CORE_LAW_ARTICLE_NOT_FOUND");
      const summary = this.index.summary(ref.eli);
      const amendmentsAfter = summary?.amendmentsAfter ?? [];
      const pendingUpdate = Boolean(
        summary?.pendingConsolidated || (summary?.pendingAmendments.length ?? 0) > 0
      );
      this.events.push({
        tool: call.name,
        target: `${ref.eli}:art.${article}`,
        decision: "ALLOW"
      });
      return JSON.stringify({
        status: "OK",
        eli: record.eli,
        title: record.title,
        actStatus: record.status,
        promulgation: record.promulgation,
        fetchedAt: record.fetchedAt,
        sourceUrl: record.sourceUrl,
        sourceAnchorUrl: anchoredUrl(record.sourceUrl, record.articleAnchors?.[article]) ?? record.sourceUrl,
        consolidatedText: ref.consolidated,
        liveCheck: {
          state: liveCheck.state,
          checkedAt: liveCheck.checkedAt,
          ...(liveCheck.state === "UNREACHABLE"
            ? {
                notice: `ELI niedostępne (${liveCheck.error ?? "brak odpowiedzi"}); brzmienie z lokalnej kopii z dnia ${record.fetchedAt.slice(0, 10)}. Podaj to użytkownikowi przy przepisie.`
              }
            : {})
        },
        ...(record.eli !== ref.eli
          ? {
              mapEli: ref.eli,
              newerConsolidatedText:
                `Mapa wskazuje ${ref.eli}; ELI ma nowszy tekst jednolity ${record.eli} i to jego brzmienie jest podane.`
            }
          : {}),
        amendmentsAfter,
        article,
        text: text.slice(0, MAX_ARTICLE_CHARS),
        truncated: text.length > MAX_ARTICLE_CHARS,
        mapNotes: ref.notes,
        ...(pendingUpdate
          ? {
              pendingUpdate: {
                consolidated: summary?.pendingConsolidated ?? null,
                amendments: summary?.pendingAmendments ?? []
              }
            }
          : {}),
        warning: pendingUpdate
          ? "W ELI jest nowszy tekst jednolity albo nowelizacja, jeszcze niezastosowane w lokalnej kopii (pendingUpdate). Brzmienie może być nieaktualne: potwierdź je verify_legal_reference przed przedstawieniem jako obowiązujące."
          : amendmentsAfter.length > 0
            ? `Po tym tekście jednolitym ogłoszono ${amendmentsAfter.length} nowelizację/nowelizacje (amendmentsAfter). Sprawdź, czy zmieniają ten artykuł (read_core_law_article z ELI nowelizacji albo verify_legal_reference), zanim przedstawisz brzmienie jako obowiązujące.`
            : "Brzmienie z najnowszego pobranego tekstu jednolitego. Jeśli mapNotes lub actStatus wskazują zmiany, potwierdź brzmienie verify_legal_reference przed przedstawieniem go jako obowiązującego."
      });
    }

    if (call.name === SEARCH_TOOL) {
      const query = String(call.input.query ?? "").trim();
      if (!query) throw new Error("CORE_LAW_QUERY_REQUIRED");
      let act: CoreActRef | undefined;
      if (call.input.act !== undefined && call.input.act !== "") {
        const resolved = await this.resolveAct(call.input.act);
        if ("result" in resolved) return resolved.result;
        act = resolved.ref;
      }
      const hits = this.index
        .search(query, { ...(act ? { eli: act.eli } : {}), limit: MAX_SEARCH_HITS })
        .map((hit) => {
          const body = this.index.currentRecord(hit.eli)?.articles[hit.article] ?? "";
          return {
            eli: hit.eli,
            title: hit.title,
            article: hit.article,
            snippet: articleSnippet(body, query)
          };
        });
      this.events.push({
        tool: call.name,
        target: "core-law",
        decision: "ALLOW",
        detail: { hits: hits.length }
      });
      return JSON.stringify({
        status: hits.length > 0 ? "OK" : "NO_HITS",
        hits
      });
    }

    throw new Error("UNKNOWN_CORE_LAW_TOOL");
  }
}
