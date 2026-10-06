/** Readable text of an official decision page (HTML), shared by verification, preview and the local store. */

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d{1,6});/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, "&");
}

/** Readable text of a decision page: paragraphs kept, markup and scripts dropped. */
export function documentText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head|title|nav|header|footer|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|table|section|article|blockquote)\s*>/gi, "\n")
      .replace(/<(p|div|li|h[1-6]|tr|blockquote)\b[^>]*>/gi, "\n")
      .replace(/<\/t[dh]\s*>/gi, " \t ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
