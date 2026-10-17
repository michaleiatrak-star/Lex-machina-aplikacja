// An answer the provider cut at its output limit and continued ("Kontynuuj dokładnie od miejsca
// przerwania", the Claude CLI's "Output token limit hit. Resume directly"): the pieces are joined
// here. The model resumes mid-thought and often repeats what it already wrote, from a few letters
// ("Zarządc" + "cy") to whole lines; that repetition is dropped. A long document should not rely
// on such seams at all: it is written in parts that end on a whole unit (long-document.ts).

const MAX_OVERLAP = 2_000;
const NEVER_DOUBLED = new Set(["c", "ł", "w", "y", "h", "ą", "ę", "ś", "ć", "ź", "ż", "ó", "ń"]);

/** `next` appended to `text` without the part of it that repeats the end of `text`. */
export function joinContinuation(text: string, next: string): string {
  if (!text) return next;
  if (!next) return text;
  // A whole repeated run (a line, a paragraph): the longest suffix of `text` that `next` starts with.
  const limit = Math.min(MAX_OVERLAP, text.length, next.length);
  for (let size = limit; size >= 12; size -= 1) {
    if (text.endsWith(next.slice(0, size))) return text + next.slice(size);
  }
  // Mid-word: 2-3 letters re-emitted ("przedwstęp" + "tępna"); a single letter only below.
  const tail = /(\p{L}+)$/u.exec(text)?.[1] ?? "";
  const head = /^(\p{L}+)/u.exec(next)?.[1] ?? "";
  if (tail && head) {
    for (let size = Math.min(3, tail.length, head.length - 1); size >= 2; size -= 1) {
      if (tail.endsWith(head.slice(0, size))) return text + next.slice(size);
    }
    // One letter repeated where Polish never doubles it ("Zarządc" + "cy" -> "Zarządcy").
    const last = tail.at(-1)!.toLocaleLowerCase("pl");
    if (head.length > 1 && head[0]!.toLocaleLowerCase("pl") === last && NEVER_DOUBLED.has(last)) return text + next.slice(1);
  }
  return text + next;
}

const TAIL_MAX = 4_000;
const START_PROBE = 40;

/**
 * The answer up to its last whole paragraph (or, in one long paragraph, its last whole sentence)
 * and the unfinished rest. Asking for that rest again from its first word puts the seam on a
 * paragraph boundary, where no letter is doubled or lost; null when the answer ends whole or has
 * no such boundary (then it is continued where it stopped).
 */
export function unfinishedTail(text: string): { kept: string; tail: string } | null {
  if (!text.trim() || /\n\s*$/u.test(text)) return null;
  const line = text.lastIndexOf("\n");
  if (line > 0 && text.length - line - 1 <= TAIL_MAX && text.slice(0, line).trim() && text.slice(line + 1).trim()) {
    return { kept: text.slice(0, line + 1), tail: text.slice(line + 1) };
  }
  const sentences = [...text.matchAll(/[.!?…;][”"»)]?\s+(?=\S)/gu)];
  const last = sentences.at(-1);
  if (last && text.length - (last.index! + last[0].length) <= TAIL_MAX) {
    const at = last.index! + last[0].length;
    return { kept: text.slice(0, at), tail: text.slice(at) };
  }
  return null;
}

/** The request for the paragraph the limit cut, rewritten whole, and the rest of the answer. */
export function rewriteTailPrompt(tail: string): string {
  const start = tail.trim().replace(/\s+/gu, " ");
  const shown = start.length > 160 ? `${start.slice(0, 160)}…` : start;
  return `Twoja poprzednia odpowiedź została ucięta na limicie długości w połowie akapitu. Ten niedokończony akapit usunięto; zaczynał się od: „${shown}”. Napisz ten akapit od jego pierwszego słowa, w całości, a potem kontynuuj odpowiedź. Bez wstępu, bez powtarzania wcześniejszych akapitów i bez podsumowania.`;
}

/**
 * The answer kept to its last whole paragraph joined with the model's rewrite of the cut one,
 * from where the rewrite starts that paragraph (a preamble or a repeated paragraph before it is
 * dropped). A reply that only continues the cut words (lower case, punctuation) is joined to the
 * whole text instead; a reworded paragraph replaces the cut one.
 */
export function joinRewrittenTail(kept: string, tail: string, next: string): string {
  const probe = tail.trim().slice(0, START_PROBE);
  const at = probe.length >= 8 ? next.slice(0, 2_000 + probe.length).indexOf(probe) : -1;
  if (at >= 0) return kept + next.slice(at);
  if (/^\s*[\p{Ll},.;:)\]]/u.test(next)) return joinContinuation(kept + tail, next);
  return kept + next.trimStart();
}

/** Continuation pieces joined in order. */
export function joinContinuations(pieces: readonly string[]): string {
  return pieces.reduce((text, piece) => joinContinuation(text, piece), "");
}
