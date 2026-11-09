import fs from "node:fs";
import path from "node:path";

/**
 * Tryb offline modelu lokalnego (Ustawienia administratora, domyślnie wyłączony): model lokalny
 * odpowiada bez źródeł zewnętrznych — tylko lokalna kopia ELI (RAG), biblioteka orzeczeń na dysku
 * i materiały sprawy. Żadnego zapytania do ELI, EUR-Lex, SN, SAOS, CBOSA, EUREKA, portali sądów,
 * konektorów MCP ani wyszukiwarki. Modele w chmurze nie są objęte (i tak wymagają sieci).
 */
let settingsFile: string | null = null;

export function configureLocalOfflineMode(dir: string | null): void {
  settingsFile = dir ? path.join(dir, "local-offline.json") : null;
}

export function localOfflineMode(): boolean {
  if (process.env.LEX_LOCAL_OFFLINE === "on") return true;
  if (process.env.LEX_LOCAL_OFFLINE === "off" || !settingsFile) return false;
  try {
    return (JSON.parse(fs.readFileSync(settingsFile, "utf8")) as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

export function setLocalOfflineMode(enabled: boolean): void {
  if (!settingsFile) throw new Error("LOCAL_OFFLINE_NOT_CONFIGURED");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporary = `${settingsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ enabled }), "utf8");
  fs.renameSync(temporary, settingsFile);
}

/** The turn runs offline: a local model while the mode is on. */
export function offlineTurn(model: string): boolean {
  return model.startsWith("local/") && localOfflineMode();
}

export const OFFLINE_ANSWER_NOTE =
  "Tryb offline: źródła zewnętrzne wyłączone — przepisy wyłącznie z lokalnej kopii ELI (stan na dzień kopii), orzeczenia tylko z biblioteki na dysku; aktualności przepisów nie sprawdzono w ELI.";
