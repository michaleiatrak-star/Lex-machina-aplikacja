import fs from "node:fs";
import path from "node:path";
import { defaultCoreLawDir } from "./core-law-index.js";

/**
 * Last good answer of a deterministic EU source query (EUR-Lex act by
 * CELEX), served only when the source fails and always labelled as a local
 * copy with its date - never passed off as a fresh answer. Polish acts have
 * their own copy with ELI checks (core-law); searches are not kept (their
 * results change).
 */
const KEYS: Record<string, (args: Record<string, unknown>) => string | null> = {
  eurlex_lookup: (args) =>
    typeof args.celex === "string" && /^[0-9A-Z()]{6,24}$/u.test(args.celex.trim().toUpperCase())
      ? args.celex.trim().toUpperCase()
      : null
};

type Stored = { tool: string; key: string; fetchedAt: string; text: string };

export class LegalSourceFallbackStore {
  constructor(private readonly dir: string = path.join(defaultCoreLawDir(), "eu-sources")) {}

  private file(tool: string, key: string): string {
    return path.join(this.dir, `${tool}-${key.replace(/[^0-9A-Z]/gu, "_")}.json`);
  }

  key(tool: string, args: Record<string, unknown>): string | null {
    return KEYS[tool]?.(args) ?? null;
  }

  save(tool: string, args: Record<string, unknown>, text: string, now = new Date()): void {
    const key = this.key(tool, args);
    if (!key) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const stored: Stored = { tool, key, fetchedAt: now.toISOString(), text };
      fs.writeFileSync(this.file(tool, key), JSON.stringify(stored), "utf8");
    } catch {
      // A copy that cannot be written only means no fallback later.
    }
  }

  load(tool: string, args: Record<string, unknown>): Stored | null {
    const key = this.key(tool, args);
    if (!key) return null;
    try {
      const stored = JSON.parse(fs.readFileSync(this.file(tool, key), "utf8")) as Stored;
      return stored.tool === tool && stored.key === key && typeof stored.text === "string" ? stored : null;
    } catch {
      return null;
    }
  }
}

function status(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { status?: unknown };
    return typeof parsed.status === "string" ? parsed.status : null;
  } catch {
    return null;
  }
}

/** The answer to pass on: a good one is kept; a failure is replaced by the dated copy if there is one. */
export function withSourceFallback(
  store: LegalSourceFallbackStore,
  tool: string,
  args: Record<string, unknown>,
  text: string | null
): string | null {
  if (!store.key(tool, args)) return text;
  const state = text === null ? "ERROR" : status(text);
  if (text !== null && state !== "ERROR") {
    if (state === "FOUND") store.save(tool, args, text);
    return text;
  }
  const copy = store.load(tool, args);
  if (!copy) return text;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(copy.text) as Record<string, unknown>;
  } catch {
    return text;
  }
  const date = copy.fetchedAt.slice(0, 10);
  return JSON.stringify({
    ...parsed,
    kopia_lokalna: true,
    pobrano: copy.fetchedAt,
    uwaga: `KOPIA LOKALNA — dane pobrane ${date}; źródło chwilowo niedostępne. Podaj tę datę przy powołaniu i nie przedstawiaj danych jako aktualnych.`
  });
}
