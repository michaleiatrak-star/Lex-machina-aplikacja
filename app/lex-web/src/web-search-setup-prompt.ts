import type { WebSearchSettings } from "./api.js";

// After the first model is chosen the app sends the administrator to the web search settings
// once, with the local SearXNG recommended (best in the comparison test; user 2026-11-15).
let pending = false;
const listeners = new Set<() => void>();

export function requestWebSearchSetup(): void {
  if (listeners.size === 0) {
    pending = true;
    return;
  }
  for (const listener of listeners) listener();
}

/** A request made before the section was on screen: taken once. */
export function takeWebSearchSetupRequest(): boolean {
  const value = pending;
  pending = false;
  return value;
}

export function onWebSearchSetupRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function webSearchPromptKey(userId: string): string {
  return `lex-web-search-setup-shown:${userId}`;
}

/** Whether to send the user to the web search settings now. */
export function shouldPromptWebSearch(input: {
  admin: boolean;
  serverMode: boolean;
  modelAvailable: boolean;
  alreadyShown: boolean;
  settings: Pick<WebSearchSettings, "searxngUrl" | "searxngUrlForced" | "providerForced"> | null;
}): boolean {
  if (!input.admin || input.serverMode || !input.modelAvailable || input.alreadyShown || !input.settings) return false;
  return !input.settings.searxngUrl && !input.settings.searxngUrlForced && !input.settings.providerForced;
}

/** No local SearXNG yet and the user can create it: recommended in the section. */
export function localSearxngRecommended(admin: boolean, settings: Pick<WebSearchSettings, "searxngUrl" | "searxngUrlForced" | "providerForced">): boolean {
  return admin && !settings.searxngUrl && !settings.searxngUrlForced && !settings.providerForced;
}

/** Whether the web search settings were already shown once to this user (a per-user UI flag, no secret). */
export function webSearchPromptShown(userId: string): boolean {
  try {
    return window.localStorage.getItem(webSearchPromptKey(userId)) === "1";
  } catch {
    return false;
  }
}

export function markWebSearchPromptShown(userId: string): void {
  try {
    window.localStorage.setItem(webSearchPromptKey(userId), "1");
  } catch {
    // Shown again at the next start: harmless.
  }
}
