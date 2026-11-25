// Task 08.4b: acts changed in ELI since the last check (`/eli/changes/acts?since=`) instead of a
// per-act relations check every day. An act whose own record, consolidated text or amending acts
// changed is checked now; every act is still checked in full once a week.
import type { CoreLawFetch } from "./core-law-index.js";

const ELI_API = "https://api.sejm.gov.pl/eli";
const PAGE = 500;
const MAX_PAGES = 20;

export type EliChangedAct = {
  ELI: string;
  changeDate?: string;
  title?: string;
  references?: Record<string, Array<{ id?: string }>>;
};

// Relations that mean the tracked act's text or its consolidated text is no longer the latest.
const AFFECTING = ["Akty zmienione", "Tekst jednolity dla aktu", "Akty uchylone", "Akty uznane za uchylone", "Sprostowanie", "Orzeczenie TK"];

/** "2026-11-20T09:25:48" form (the API refuses an ISO string with milliseconds or a zone). */
export function eliSince(date: Date | string): string {
  return new Date(date).toISOString().slice(0, 19);
}

export async function fetchEliChanges(since: string, fetcher: CoreLawFetch, timeoutMs = 30_000): Promise<EliChangedAct[]> {
  const items: EliChangedAct[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = `${ELI_API}/changes/acts?since=${encodeURIComponent(since)}&limit=${PAGE}&offset=${page * PAGE}`;
    const reply = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!reply.ok) throw new Error(`ELI_CHANGES_HTTP_${reply.status}`);
    const body = (await reply.json()) as { items?: EliChangedAct[]; totalCount?: number };
    if (!Array.isArray(body.items)) throw new Error("ELI_CHANGES_FORMAT");
    const batch = body.items;
    items.push(...batch);
    if (batch.length < PAGE || items.length >= (body.totalCount ?? 0)) break;
  }
  return items;
}

/** Tracked acts (map ELI with its current consolidated ELI) touched by the changed records. */
export function affectedTrackedActs(changed: EliChangedAct[], tracked: Array<{ eli: string; currentEli?: string | undefined }>): string[] {
  const owner = new Map<string, string>();
  for (const act of tracked) {
    owner.set(act.eli, act.eli);
    if (act.currentEli) owner.set(act.currentEli, act.eli);
  }
  const hit = new Set<string>();
  for (const item of changed) {
    const own = owner.get(item.ELI);
    if (own) hit.add(own);
    for (const key of AFFECTING) {
      for (const ref of item.references?.[key] ?? []) {
        const target = ref.id ? owner.get(ref.id) : undefined;
        if (target) hit.add(target);
      }
    }
  }
  return [...hit];
}

/** The next "since": the latest change seen, never later than the moment the check started. */
export function nextEliSince(changed: EliChangedAct[], startedAt: string): string {
  const latest = changed.map((item) => item.changeDate ?? "").filter(Boolean).sort().at(-1);
  return latest && latest < startedAt ? latest : startedAt;
}
