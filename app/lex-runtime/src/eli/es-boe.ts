// Spain: the consolidated text of an article from the BOE open-data API (legislación
// consolidada), every version with the act that gave it and its date in force, and the
// wording on the date of the event (shared/TEMPORAL-LAW-CHECK.md: version at a point in time).
// The API answers XML only with "Accept: application/xml" (otherwise 400).
// Endpoints (checked 2026-11-08):
//   /datosabiertos/api/legislacion-consolidada/id/{BOE-A-…}/texto/indice
//   /datosabiertos/api/legislacion-consolidada/id/{BOE-A-…}/texto/bloque/{a1}

const API = "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id";

export type BoeVersion = {
  // The act that gave this wording (the original act for the first version).
  act: string;
  published: string;
  inForce: string;
  text: string;
};

export type BoeArticle = {
  id: string;
  block: string;
  title: string;
  versions: BoeVersion[];
  apiUrl: string;
};

export type BoeFetch = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function plain(xml: string): string {
  return xml
    .replace(/<\/p>\s*/gu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/giu, (whole, code: string) =>
      code.startsWith("#x") ? String.fromCodePoint(parseInt(code.slice(2), 16)) : code.startsWith("#") ? String.fromCodePoint(Number(code.slice(1))) : ENTITIES[code] ?? whole
    )
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s+/gu, "\n")
    .trim();
}

const isoDate = (value: string): string => value.replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3");

/** The article of a BOE block response (XML), versions in order of entry into force. */
export function parseBoeBlock(xml: string, id: string, block: string): BoeArticle {
  const status = /<code>(\d+)<\/code>/u.exec(xml)?.[1];
  if (status && status !== "200") throw new Error(`BOE_API_${status}`);
  const head = /<bloque\b[^>]*\bid="([^"]+)"[^>]*\btitulo="([^"]*)"/u.exec(xml);
  if (!head) throw new Error("BOE_BLOCK_NOT_FOUND");
  const versions = [...xml.matchAll(/<version\b([^>]*)>([\s\S]*?)<\/version>/gu)].map((match): BoeVersion => {
    const attrs = match[1]!;
    const attr = (name: string): string => new RegExp(`${name}="([^"]*)"`, "u").exec(attrs)?.[1] ?? "";
    return { act: attr("id_norma"), published: isoDate(attr("fecha_publicacion")), inForce: isoDate(attr("fecha_vigencia")), text: plain(match[2]!) };
  });
  versions.sort((a, b) => a.inForce.localeCompare(b.inForce));
  return { id, block: head[1] ?? block, title: plain(head[2] ?? ""), versions, apiUrl: `${API}/${encodeURIComponent(id)}/texto/bloque/${encodeURIComponent(block)}` };
}

/** The wording in force on `date` (YYYY-MM-DD): the last version in force on that day, or null before the first. */
export function boeVersionOn(article: BoeArticle, date: string): BoeVersion | null {
  let found: BoeVersion | null = null;
  for (const version of article.versions) if (version.inForce && version.inForce <= date) found = version;
  return found;
}

/** Versions that entered into force after `date`: the changes the analysis must name (T-2/T-3). */
export function boeChangesAfter(article: BoeArticle, date: string): BoeVersion[] {
  return article.versions.filter((version) => version.inForce > date);
}

/** Reads the article from the BOE API (official source, rank 1 for Spain). */
export async function boeArticle(id: string, block: string, fetchImpl: BoeFetch = fetch as unknown as BoeFetch): Promise<BoeArticle> {
  if (!/^BOE-[A-Z]-\d{4}-\d{1,6}$/u.test(id)) throw new Error("BOE_ID_INVALID");
  if (!/^[a-z0-9_-]{1,40}$/iu.test(block)) throw new Error("BOE_BLOCK_INVALID");
  const url = `${API}/${encodeURIComponent(id)}/texto/bloque/${encodeURIComponent(block)}`;
  const response = await fetchImpl(url, { headers: { accept: "application/xml" } });
  if (!response.ok) throw new Error(`BOE_API_${response.status}`);
  return parseBoeBlock(await response.text(), id, block);
}
