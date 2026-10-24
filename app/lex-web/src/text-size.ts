// Chat text size: a per-viewer reading preference (no case data), kept in localStorage.
export type ChatTextSize = "standard" | "large" | "larger";

export const CHAT_TEXT_SIZES: Array<{ size: ChatTextSize; label: string }> = [
  { size: "standard", label: "Standardowy" },
  { size: "large", label: "Większy" },
  { size: "larger", label: "Duży" }
];

const KEY = "lex.chatTextSize";

export function readChatTextSize(): ChatTextSize {
  try {
    const value = globalThis.localStorage?.getItem(KEY);
    return value === "large" || value === "larger" ? value : "standard";
  } catch {
    return "standard";
  }
}

export function applyChatTextSize(size: ChatTextSize): void {
  if (typeof document === "undefined") return;
  if (size === "standard") delete document.documentElement.dataset.chatText;
  else document.documentElement.dataset.chatText = size;
}

export function saveChatTextSize(size: ChatTextSize): void {
  try {
    globalThis.localStorage?.setItem(KEY, size);
  } catch {
    // Private window or blocked storage: the size still applies until reload.
  }
  applyChatTextSize(size);
}
