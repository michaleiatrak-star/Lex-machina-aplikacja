import type {
  CaseChatMessage
} from "./case-thread.js";

// Conversation history sent with each message, in characters (~3 per token).
// Hosted windows: Claude 200k, OpenAI/xAI 128k tokens; the history takes about half,
// the rest stays for the system prompt, skills, attached documents and the answer.
// A local model keeps the small budget: long prompts make it slow and unreliable.
export const LOCAL_CONVERSATION_CHARS = 28_000;
const HOSTED_CONVERSATION_CHARS: Record<string, number> = {
  anthropic: 300_000,
  openai: 150_000,
  xai: 150_000,
  google: 300_000
};

// With the model's own window known (the runtime's model list): half of it for the history, ~3
// characters per token (task 02: a 1M-token model was cut to the 200k default).
const HISTORY_SHARE = 0.5;
const CHARS_PER_TOKEN = 3;

export function conversationBudgetChars(
  provider: string,
  model: string,
  contextWindow?: number
): number {
  if (provider === "local" || model.startsWith("local/")) {
    return LOCAL_CONVERSATION_CHARS;
  }
  if (contextWindow && contextWindow > 0) {
    return Math.max(LOCAL_CONVERSATION_CHARS, Math.floor(contextWindow * CHARS_PER_TOKEN * HISTORY_SHARE));
  }
  return HOSTED_CONVERSATION_CHARS[provider] ?? LOCAL_CONVERSATION_CHARS;
}

// What the application recorded for an earlier answer (its verification register and
// auxiliary sources): asked "what went wrong", the model answers from it, not by guessing.
function register(item: CaseChatMessage): string {
  if (item.role !== "assistant") return "";
  const evidence = (item.evidence ?? []).filter((record) => record.role !== "gate");
  const auxiliary = item.auxiliarySources ?? [];
  if (!evidence.length && !auxiliary.length) {
    return item.mandatoryPath ? "\n[Rejestr aplikacji dla tej odpowiedzi: brak zapisów weryfikacji i źródeł pomocniczych]" : "";
  }
  const items = [
    ...evidence.map((record) => `${record.status} ${record.claim}${record.sourceTier ? ` (${record.sourceTier})` : ""}`),
    ...auxiliary.map((source) => `pomocnicze ${source.sourceTier} ${source.sourceUrl}`)
  ];
  const shown = items.slice(0, 8).join("; ");
  return `\n[Rejestr aplikacji dla tej odpowiedzi: ${shown}${items.length > 8 ? `; i ${items.length - 8} więcej` : ""}]`;
}

// What the application's correcting round removed from this answer: asked "which claims
// did you remove?", the model quotes this record instead of reconstructing it.
function corrections(item: CaseChatMessage): string {
  if (item.role !== "assistant" || !item.corrections?.length) return "";
  return item.corrections
    .map((correction) => {
      const removed = correction.removed.length
        ? `usunięte zdania pierwszej wersji: ${correction.removed.map((sentence) => `„${sentence}”`).join("; ")}`
        : "bez usuniętych zdań (tylko uzupełnienia)";
      return `\n[Runda poprawcza aplikacji (${correction.round === "CASE_GROUNDING" ? "zgodność z tekstem dokumentów" : correction.round === "NO_ANSWER" ? "odpowiedź bez treści" : correction.round === "ACT_NAME" ? "nazwa aktu przy powołaniu" : correction.round === "QUOTE_SOURCE" ? "cytat zgodny ze źródłem" : correction.round === "STATUTE_CONTENT" ? "teza zgodna z brzmieniem przepisu" : correction.round === "STRENGTH" ? "siła pisma: fragmenty akt i orzecznictwo" : "ścieżka obowiązkowa"}): zarzuty: ${correction.findings.join("; ") || "brak"}; ${removed}]`;
    })
    .join("");
}

// The chat shows an answer's case-file citations as [[LEXDOCREF:docref_N]] chips; the model knows only
// [[LEXDOC:document:chunk]] markers. Sent back as chips, they reached the next turn and the letter's file
// as text ("pola do uzupełnienia: [LEXDOCREF:docref_1] …", live test 2026-11-19): each goes back as the
// marker it came from, one with no record is dropped.
export function modelCitationMarkers(item: Pick<CaseChatMessage, "content" | "documentCitations">): string {
  if (!item.content.includes("[[LEXDOCREF:")) return item.content;
  const byId = new Map((item.documentCitations ?? []).map((citation) => [citation.citationId, citation]));
  return item.content.replace(/\s?\[\[LEXDOCREF:(docref_\d+)\]\]/gu, (whole, id: string) => {
    const citation = byId.get(id);
    return citation ? `${whole.startsWith(" ") ? " " : ""}[[LEXDOC:${citation.documentId}:${citation.chunkIndex}]]` : "";
  });
}

function turn(item: CaseChatMessage): string {
  return `${item.role === "user" ? "Użytkownik" : "Asystent"}: ${modelCitationMarkers(item)}${register(item)}${corrections(item)}`;
}

// Newest turns first, whole messages only; older turns that do not fit are dropped
// with an explicit note instead of being cut mid-sentence.
export function conversationForProvider(
  messages: CaseChatMessage[],
  next: string,
  budgetChars = LOCAL_CONVERSATION_CHARS
): string {
  const current = `Użytkownik: ${next}`;
  const history = messages.filter((item) => item.role !== "system");
  if (history.length === 0) {
    return next.length > budgetChars ? next.slice(-budgetChars) : next;
  }
  const kept: string[] = [];
  let used = current.length;
  let index = history.length - 1;
  for (; index >= 0; index -= 1) {
    const text = turn(history[index]!);
    if (used + text.length + 2 > budgetChars) break;
    kept.unshift(text);
    used += text.length + 2;
  }
  const dropped = index + 1;
  if (kept.length === 0 && dropped > 0) {
    // Even the newest reply does not fit whole: keep its end.
    const room = budgetChars - current.length - 200;
    if (room > 500) {
      const text = turn(history[history.length - 1]!);
      kept.push(`[…] ${text.slice(-room)}`);
    }
  }
  const note =
    dropped > 0
      ? `[Wcześniejsza część rozmowy pominięta (${dropped} wiadomości) — nie mieści się w oknie modelu.]`
      : "";
  const combined = [note, ...kept, current].filter(Boolean).join("\n\n");
  return combined.length > budgetChars ? combined.slice(-budgetChars) : combined;
}
