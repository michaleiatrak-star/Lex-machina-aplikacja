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

export function conversationBudgetChars(
  provider: string,
  model: string
): number {
  if (provider === "local" || model.startsWith("local/")) {
    return LOCAL_CONVERSATION_CHARS;
  }
  return HOSTED_CONVERSATION_CHARS[provider] ?? LOCAL_CONVERSATION_CHARS;
}

function turn(item: CaseChatMessage): string {
  return `${item.role === "user" ? "Użytkownik" : "Asystent"}: ${item.content}`;
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
