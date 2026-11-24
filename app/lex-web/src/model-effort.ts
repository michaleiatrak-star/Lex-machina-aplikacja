// The reasoning effort of Claude through the account, chosen in the case card (user 2026-11-24:
// usually medium, the user may set it). Per user in the app's local storage; nothing secret.
export type ModelEffort = "low" | "medium" | "high";

export const DEFAULT_MODEL_EFFORT: ModelEffort = "medium";

function storageKey(userId: string): string {
  return `lex.modelEffort.${userId}`;
}

export function parseModelEffort(raw: string | null): ModelEffort {
  return raw === "low" || raw === "medium" || raw === "high" ? raw : DEFAULT_MODEL_EFFORT;
}

export function loadModelEffort(userId: string): ModelEffort {
  try {
    return parseModelEffort(window.localStorage.getItem(storageKey(userId)));
  } catch {
    return DEFAULT_MODEL_EFFORT;
  }
}

export function saveModelEffort(userId: string, effort: ModelEffort): void {
  try {
    window.localStorage.setItem(storageKey(userId), effort);
  } catch {
    // Storage unavailable (private window): the choice holds for this session only.
  }
}
