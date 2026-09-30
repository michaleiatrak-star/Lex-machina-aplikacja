// Preview of an official legal source page (search results: CBOSA, SAOS, EUREKA,
// UODO, ISAP/ELI, EUR-Lex, SN) inside the app. The desktop CSP forbids framing
// foreign sites, so the runtime fetches the page from an allow-listed official host
// and returns it without scripts; the UI shows it in a sandboxed frame.

export const SOURCE_PREVIEW_HOSTS = new Set([
  "orzeczenia.nsa.gov.pl",
  "www.saos.org.pl",
  "saos.org.pl",
  "eureka.mf.gov.pl",
  "orzeczenia.uodo.gov.pl",
  "uodo.gov.pl",
  "isap.sejm.gov.pl",
  "api.sejm.gov.pl",
  "eli.gov.pl",
  "eur-lex.europa.eu",
  "curia.europa.eu",
  "sn.pl",
  "www.sn.pl"
]);

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 20_000;

export type SourcePreview =
  | { kind: "html"; url: string; html: string }
  | { kind: "pdf"; url: string; data: Buffer };

export type PreviewFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function allowedPreviewUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SOURCE_PREVIEW_URL_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !SOURCE_PREVIEW_HOSTS.has(url.hostname.toLowerCase())
  ) {
    throw new Error("SOURCE_PREVIEW_HOST_NOT_ALLOWED");
  }
  return url;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The frame is sandboxed without scripts anyway; removing active content keeps the
// document small and inert. A <base> makes relative links and images resolvable.
export function inertHtml(html: string, url: string): string {
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<(iframe|frame|frameset|object|embed|applet|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(iframe|frame|object|embed|applet|meta\s+http-equiv)\b[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, "$1=\"#\"");
  const base = `<base href="${escapeHtml(url)}">`;
  return /<head\b[^>]*>/i.test(cleaned)
    ? cleaned.replace(/<head\b[^>]*>/i, (head) => `${head}${base}`)
    : `<!doctype html><html><head>${base}<meta charset="utf-8"></head><body>${cleaned}</body></html>`;
}

function charsetOf(contentType: string, head: Buffer): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const sniff = head.subarray(0, 4096).toString("latin1");
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(sniff)?.[1] ?? "utf-8";
}

function decode(data: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(data);
  } catch {
    return new TextDecoder("utf-8").decode(data);
  }
}

// Text a reader would see: without tags, styles and whitespace runs.
export function visibleText(html: string): string {
  return html
    .replace(/<(style|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Portals that render the document with JavaScript (the frame runs none)
// leave an empty shell; say so instead of showing a blank frame.
function scriptOnlyNotice(url: string): string {
  return inertHtml(
    `<p>Ta strona źródła wyświetla treść wyłącznie przez JavaScript, którego podgląd w aplikacji nie uruchamia (bezpieczeństwo). Użyj „Pokaż treść” albo „Otwórz w źródle”.</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
    url
  );
}

const EUREKA_HOST = "eureka.mf.gov.pl";
const EUREKA_DOCUMENT_PATH = /^\/informacje\/podglad\/(\d{1,10})\/?$/;

// EUREKA (Ministry of Finance) is a JavaScript application: its document page
// is an empty shell without scripts. The same document comes from the portal's
// public API (the source of "Pokaż treść"), rendered here as a static page.
export async function eurekaDocumentPreview(
  url: URL,
  fetcher: PreviewFetch
): Promise<SourcePreview | null> {
  const id = url.hostname === EUREKA_HOST ? EUREKA_DOCUMENT_PATH.exec(url.pathname)?.[1] : undefined;
  if (!id) return null;
  const response = await fetcher(`https://${EUREKA_HOST}/api/public/v1/informacje/${id}`, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`SOURCE_PREVIEW_HTTP_${response.status}`);
  const raw = JSON.parse((await readLimited(response)).toString("utf8")) as {
    dokument?: { fields?: Array<{ key?: string; value?: unknown }> };
  };
  const fields = new Map((raw.dokument?.fields ?? []).map((field) => [field.key, field.value]));
  const text = (key: string) => (typeof fields.get(key) === "string" ? (fields.get(key) as string) : "");
  const body = text("TRESC_INTERESARIUSZ") || text("TRESC");
  if (!body && !text("TEZA")) throw new Error("SOURCE_PREVIEW_EMPTY");
  const meta = [text("SYG") && `Sygnatura: ${escapeHtml(text("SYG"))}`, text("DT_WYD") && `data wydania: ${escapeHtml(text("DT_WYD").slice(0, 10))}`]
    .filter(Boolean)
    .join(" · ");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(text("TEZA") || text("SYG"))}</title></head><body style="font-family:Calibri,Arial,sans-serif;margin:16px;line-height:1.45"><h1 style="font-size:1.2em">${escapeHtml(text("TEZA"))}</h1><p style="color:#555">${meta} · źródło: EUREKA (Ministerstwo Finansów)</p><hr>${body}</body></html>`;
  return { kind: "html", url: url.toString(), html: inertHtml(html, url.toString()) };
}

async function readLimited(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (declared && declared > MAX_BYTES) throw new Error("SOURCE_PREVIEW_TOO_LARGE");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > MAX_BYTES) throw new Error("SOURCE_PREVIEW_TOO_LARGE");
  return body;
}

export async function fetchSourcePreview(
  value: string,
  fetcher: PreviewFetch = globalThis.fetch.bind(globalThis)
): Promise<SourcePreview> {
  let url = allowedPreviewUrl(value);
  const eureka = await eurekaDocumentPreview(url, fetcher);
  if (eureka) return eureka;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetcher(url.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("SOURCE_PREVIEW_REDIRECT_INVALID");
      // Redirects stay on the allow-list, like the first request.
      url = allowedPreviewUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`SOURCE_PREVIEW_HTTP_${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    const data = await readLimited(response);
    if (/application\/pdf/i.test(contentType) || data.subarray(0, 5).toString("latin1") === "%PDF-") {
      return { kind: "pdf", url: url.toString(), data };
    }
    const text = decode(data, charsetOf(contentType, data));
    if (/html|xml/i.test(contentType) || /^\s*</.test(text)) {
      const html = inertHtml(text, url.toString());
      return {
        kind: "html",
        url: url.toString(),
        html:
          /<script\b/i.test(text) && visibleText(html).length < 40
            ? scriptOnlyNotice(url.toString())
            : html
      };
    }
    return {
      kind: "html",
      url: url.toString(),
      html: inertHtml(`<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`, url.toString())
    };
  }
  throw new Error("SOURCE_PREVIEW_TOO_MANY_REDIRECTS");
}
