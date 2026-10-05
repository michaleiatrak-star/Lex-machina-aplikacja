import type { ReactNode } from "react";

// Co aplikacja weryfikowała pod danym adresem (z listy źródeł odpowiedzi).
export type SourceClaim = { claim: string; url: string };

type SourceLinkedTextProps = {
  content: string;
  onOpenUrl?: (url: string) => Promise<void> | void;
  sources?: SourceClaim[];
  // Tekst przed tym fragmentem w tym samym wierszu (z MarkdownContent).
  before?: string;
};

function articleNumber(claim: string): string | null {
  return /art\.\s*(\d+[a-z]*)/iu.exec(claim)?.[1]?.toLocaleLowerCase("pl") ?? null;
}

// Opis linku VER: weryfikowany przepis zamiast adresu. Przy kilku przepisach
// z tej samej strony wybiera ten powołany w tekście najbliżej przed znacznikiem.
export function verifiedClaimLabel(url: string, before: string, sources: SourceClaim[]): string | null {
  const claims = [...new Set(sources.filter((item) => item.url === url).map((item) => item.claim))];
  if (claims.length <= 1) return claims[0] ?? null;
  const text = before.toLocaleLowerCase("pl");
  let best: { claim: string; at: number } | null = null;
  for (const claim of claims) {
    const number = articleNumber(claim);
    if (!number) continue;
    const pattern = new RegExp(`(?<![\\d])${number}(?![\\d])`, "gu");
    let at = -1;
    for (const found of text.matchAll(pattern)) at = found.index ?? at;
    if (at >= 0 && (!best || at > best.at)) best = { claim, at };
  }
  return best?.claim ?? claims.join(", ");
}

// Act abbreviation compared without dots and case: „k.k.” = „KK”.
function actKey(value: string): string {
  return value.replace(/\./gu, "").toLocaleUpperCase("pl");
}

const PROVISION =
  /(?<![\p{L}\d])(art\.\s*(\d+[a-z]*)(?:\s*§\s*\d+[a-z]*)?(?:\s*(?:ust\.|pkt)\s*\d+[a-z]*)*\s+((?:\p{Lu}[\p{L}]{0,5}\.?){1,4}))(?![\p{L}\d])/giu;

// Verified provisions named in the text become links to the verified source,
// at the page of the cited article (the anchor of the VER record).
export function provisionLinks(
  text: string,
  sources: SourceClaim[]
): Array<{ start: number; end: number; url: string; claim: string }> {
  if (!sources.length) return [];
  const verified = sources.flatMap((item) => {
    const found = /art\.\s*(\d+[a-z]*)[^\n]*?\s((?:\p{Lu}[\p{L}]{0,5}\.?){1,4})\s*$/iu.exec(item.claim.trim());
    return found ? [{ ...item, article: found[1]!.toLocaleLowerCase("pl"), act: actKey(found[2]!) }] : [];
  });
  const links: Array<{ start: number; end: number; url: string; claim: string }> = [];
  for (const match of text.matchAll(PROVISION)) {
    const article = match[2]!.toLocaleLowerCase("pl");
    const act = actKey(match[3]!);
    const candidates = verified.filter((item) => item.article === article && item.act === act);
    const best = candidates.find((item) => item.url.includes("#")) ?? candidates[0];
    const url = best ? safeHttpsUrl(best.url) : null;
    if (best && url) links.push({ start: match.index!, end: match.index! + match[1]!.length, url, claim: best.claim });
  }
  return links;
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeLinkMarkup(value: string): string {
  return value
    // Repair the malformed pattern occasionally emitted by account CLIs:
    // [label]\([https://source](https://source))
    .replace(
      /\[([^\]\n]+)\]\\?\(\[(https:\/\/[^\]\s]+)\]\((https:\/\/[^)\s]+)\)\\?\)/giu,
      (_match, label: string, _shown: string, target: string) =>
        `[${label}](${target})`
    )
    .replace(/\\\(/gu, "(")
    .replace(/\\\)/gu, ")");
}

// Krótka etykieta linku znacznika VER: „Dz.U. 2025 poz. 383, s. 54” zamiast pełnego adresu.
export function shortSourceLabel(url: string): string {
  const eli = /\/eli\/acts\/(DU|MP)\/(\d{4})\/(\d+)\//iu.exec(url);
  const page = /#page=(\d+)/u.exec(url)?.[1];
  const base = eli
    ? `${eli[1]!.toUpperCase() === "DU" ? "Dz.U." : "M.P."} ${eli[2]} poz. ${eli[3]}`
    : (() => {
        try {
          return new URL(url).hostname.replace(/^www\./u, "");
        } catch {
          return url;
        }
      })();
  return page ? `${base}, s. ${page}` : base;
}

export function SourceLinkedText({
  content,
  onOpenUrl,
  sources = [],
  before = ""
}: SourceLinkedTextProps) {
  const normalized = normalizeLinkMarkup(content);
  const pattern =
    /\[VER:\s*(https:\/\/[^\s,\]]+)\s*,\s*([^\]\n]{1,40})\]|\[([^\]\n]+)\]\((https:\/\/[^)\s]+)\)|(https:\/\/[^\s<>\[\]{}()]+)/giu;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  const plain = (start: number, end: number) => {
    const text = normalized.slice(start, end);
    let at = 0;
    for (const link of provisionLinks(text, sources)) {
      if (link.start > at) nodes.push(text.slice(at, link.start));
      nodes.push(
        <a
          key={`provision-${start + link.start}`}
          className="source-inline-link provision-link"
          href={link.url}
          title={`${link.claim} · ${shortSourceLabel(link.url)} · ${link.url}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={
            onOpenUrl
              ? (event) => {
                  event.preventDefault();
                  void onOpenUrl(link.url);
                }
              : undefined
          }
        >
          {text.slice(link.start, link.end)}
        </a>
      );
      at = link.end;
    }
    if (at < text.length) nodes.push(text.slice(at));
  };

  while ((match = pattern.exec(normalized)) !== null) {
    if (match.index > cursor) {
      plain(cursor, match.index);
    }

    const verUrl = match[1] ? safeHttpsUrl(match[1]) : null;
    if (verUrl) {
      const claim = verifiedClaimLabel(verUrl, before + normalized.slice(0, match.index), sources);
      nodes.push(
        <span key={`source-ver-${match.index}`} className="source-ver">
          [VER:{" "}
          <a
            className="source-inline-link"
            href={verUrl}
            title={`${shortSourceLabel(verUrl)} · sprawdzono ${match[2]} · ${verUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={
              onOpenUrl
                ? (event) => {
                    event.preventDefault();
                    void onOpenUrl(verUrl);
                  }
                : undefined
            }
          >
            {claim ?? shortSourceLabel(verUrl)}
          </a>
          , <span className="source-ver-date">{match[2]}</span>]
        </span>
      );
      cursor = pattern.lastIndex;
      continue;
    }

    const label = match[3];
    const rawUrl = match[4] ?? match[5] ?? "";
    const trailing = !match[4]
      ? rawUrl.match(/[.,;:!?]+$/u)?.[0] ?? ""
      : "";
    const candidate = trailing
      ? rawUrl.slice(0, -trailing.length)
      : rawUrl;
    const url = safeHttpsUrl(candidate);

    if (!url) {
      nodes.push(match[0]);
    } else {
      nodes.push(
        <a
          key={`source-link-${match.index}`}
          className="source-inline-link"
          href={url}
          title={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={
            onOpenUrl
              ? (event) => {
                  event.preventDefault();
                  void onOpenUrl(url);
                }
              : undefined
          }
        >
          {label ?? shortSourceLabel(url)}
        </a>
      );
      if (trailing) {
        nodes.push(trailing);
      }
    }

    cursor = pattern.lastIndex;
  }

  if (cursor < normalized.length) {
    plain(cursor, normalized.length);
  }

  return <>{nodes}</>;
}
