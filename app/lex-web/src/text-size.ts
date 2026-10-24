// Reading preferences of this viewer (no case data), kept in localStorage: chat text size
// and the colour theme (theme.css).
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

export type Theme = "office" | "neutral" | "night" | "contrast" | "system";

export const THEMES: Array<{ theme: Theme; label: string }> = [
  { theme: "office", label: "Kancelaria (zielony)" },
  { theme: "neutral", label: "Jasny neutralny" },
  { theme: "night", label: "Nocny" },
  { theme: "contrast", label: "Czarno-biały (wysoki kontrast)" },
  { theme: "system", label: "Jak w systemie (dzień / noc)" }
];

const THEME_KEY = "lex.theme";

export function readTheme(): Theme {
  try {
    const value = globalThis.localStorage?.getItem(THEME_KEY);
    return THEMES.some((item) => item.theme === value) ? (value as Theme) : "office";
  } catch {
    return "office";
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (theme === "office") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
  try {
    globalThis.localStorage?.setItem(THEME_KEY, theme);
  } catch {
    // Private window or blocked storage: the theme still applies until reload.
  }
  applyTheme(theme);
}
