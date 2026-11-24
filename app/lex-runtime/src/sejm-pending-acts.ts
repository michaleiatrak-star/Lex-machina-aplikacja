// Task 08.4a: a cited act with a bill amending it still in the Sejm gets one line in the answer
// (print number and stage). A process's own `ELI` is the act it produced once published, not the
// act it amends (checked in api.sejm.gov.pl 2026-11-24), so the amended act is found by its name in
// the bill's title ("o zmianie ustawy – Kodeks pracy").
import type { CoreLawFetch } from "./core-law-index.js";

const SEJM = "https://api.sejm.gov.pl/sejm";
const LIST_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_NAME = 8;

export type SejmProcessItem = {
  number: string;
  term?: number;
  title?: string;
  documentType?: string;
  documentTypeEnum?: string;
  passed?: boolean;
  closureDate?: string;
  changeDate?: string;
};
export type SejmStage = { stageName?: string; date?: string; children?: SejmStage[] };
export type PendingAmendment = { act: string; name: string; number: string; term: number; stage: string | null; stageDate: string | null };

function normalized(value: string): string {
  return value
    .toLocaleLowerCase("pl")
    .replace(/[„”"«»]/gu, "")
    .replace(/\s*[-–—]\s*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The act's own name: "Ustawa z dnia 26 czerwca 1974 r. – Kodeks pracy" -> "kodeks pracy". */
export function actName(title: string): string {
  const text = normalized(title)
    .replace(/^obwieszczenie .*? w sprawie ogłoszenia jednolitego tekstu\s+/u, "")
    .replace(/^ustaw[ay]\s+z\s+dnia\s+\d{1,2}\s+\p{L}+\s+\d{4}\s*r\.\s*/u, "")
    .replace(/^ustaw[ay]\s+/u, "");
  return text;
}

/** The act's name as written in its title, for the note ("Kodeks pracy"). */
export function actDisplayName(title: string): string {
  return title
    .replace(/[„”"]/gu, "")
    .replace(/^Obwieszczenie .*? w sprawie ogłoszenia jednolitego tekstu\s+/iu, "")
    .replace(/^ustaw[ay]\s+z\s+dnia\s+\d{1,2}\s+\p{L}+\s+\d{4}\s*r\.\s*(?:[-–—]\s*)?/iu, "")
    .replace(/^ustaw[ay]\s+(?:[-–—]\s*)?/iu, "")
    .trim();
}

/** A bill still before Parliament (not passed, not closed) that amends acts. */
export function pendingBill(process: SejmProcessItem): boolean {
  if (process.passed === true || process.closureDate) return false;
  const kind = `${process.documentTypeEnum ?? ""} ${process.documentType ?? ""}`;
  if (!/BILL|projekt ustawy/iu.test(kind)) return false;
  return /o zmianie ustaw/iu.test(process.title ?? "");
}

/**
 * The pending bills naming the act after "ustawy". A longer known name at the same place wins
 * ("Kodeks karny wykonawczy" is not "Kodeks karny").
 */
export function billsAmending(name: string, processes: SejmProcessItem[], knownNames: string[] = []): SejmProcessItem[] {
  const own = normalized(name);
  if (own.length < MIN_NAME) return [];
  const longer = knownNames.map(normalized).filter((other) => other !== own && other.startsWith(own));
  return processes.filter((process) => {
    if (!pendingBill(process)) return false;
    const title = normalized(process.title ?? "");
    for (let at = title.indexOf(`ustawy ${own}`); at >= 0; at = title.indexOf(`ustawy ${own}`, at + 1)) {
      const rest = title.slice(at + 7);
      const end = rest.charAt(own.length);
      if (end && /\p{L}/u.test(end)) continue;
      if (longer.some((other) => rest.startsWith(other))) continue;
      return true;
    }
    return false;
  });
}

export function latestStage(stages: SejmStage[]): { name: string; date: string | null } | null {
  const flat = stages.flatMap((stage) => [stage, ...(stage.children ?? [])]).filter((stage) => stage.stageName);
  const last = flat.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")).at(-1);
  return last ? { name: last.stageName!, date: last.date ?? null } : null;
}

export function pendingAmendmentLine(item: PendingAmendment): string {
  const stage = item.stage ? `, etap: ${item.stage}${item.stageDate ? ` (${item.stageDate})` : ""}` : "";
  return `Prace legislacyjne: w Sejmie jest projekt zmiany aktu ${item.name} — druk nr ${item.number} (${item.term}. kadencja)${stage}. Do uchwalenia i wejścia zmian w życie obowiązuje brzmienie powołane wyżej.`;
}

/** Current term's processes, kept for 12 hours; a failure keeps the previous list (or none). */
export class SejmPendingActs {
  private list: { at: number; term: number; processes: SejmProcessItem[] } | null = null;
  private loading: Promise<void> | null = null;
  private stages = new Map<string, { name: string; date: string | null } | null>();

  constructor(
    private readonly fetcher: CoreLawFetch = globalThis.fetch.bind(globalThis),
    private readonly now: () => number = Date.now
  ) {}

  private async load(): Promise<void> {
    const terms = (await (await this.fetcher(`${SEJM}/term`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) })).json()) as Array<{ num: number; current?: boolean }>;
    const term = terms.find((item) => item.current)?.num ?? terms.at(-1)?.num;
    if (!term) return;
    const reply = await this.fetcher(`${SEJM}/term${term}/processes?limit=5000`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!reply.ok) return;
    this.list = { at: this.now(), term, processes: ((await reply.json()) as SejmProcessItem[]).filter(pendingBill) };
  }

  /** Starts loading when stale; waits at most waitMs for it. */
  async ready(waitMs = 4_000): Promise<boolean> {
    if (!this.list || this.now() - this.list.at > LIST_TTL_MS) {
      this.loading ??= this.load()
        .catch(() => undefined)
        .finally(() => {
          this.loading = null;
        });
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([this.loading, new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))]);
      clearTimeout(timer);
    }
    return this.list !== null;
  }

  private async stageOf(term: number, number: string): Promise<{ name: string; date: string | null } | null> {
    const key = `${term}/${number}`;
    if (this.stages.has(key)) return this.stages.get(key)!;
    let stage: { name: string; date: string | null } | null = null;
    try {
      const reply = await this.fetcher(`${SEJM}/term${term}/processes/${encodeURIComponent(number)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000) });
      if (reply.ok) stage = latestStage(((await reply.json()) as { stages?: SejmStage[] }).stages ?? []);
    } catch {
      stage = null;
    }
    this.stages.set(key, stage);
    return stage;
  }

  /** Pending bills for the cited acts (names as the answer's acts are titled), at most two per act. */
  async forActs(names: string[]): Promise<PendingAmendment[]> {
    if (!(await this.ready())) return [];
    const { term, processes } = this.list!;
    const known = names.map(actName);
    const display = new Map(names.map((title) => [actName(title), actDisplayName(title)]));
    const found: PendingAmendment[] = [];
    for (const name of [...new Set(known)]) {
      for (const bill of billsAmending(name, processes, known).slice(0, 2)) {
        const stage = await this.stageOf(bill.term ?? term, bill.number);
        found.push({ act: name, name: display.get(name) || name, number: bill.number, term: bill.term ?? term, stage: stage?.name ?? null, stageDate: stage?.date ?? null });
      }
    }
    return found;
  }
}

let shared: SejmPendingActs | null = null;
export function configureSejmPendingActs(instance: SejmPendingActs | null): void {
  shared = instance;
}
export function sejmPendingActs(): SejmPendingActs | null {
  return shared;
}

/**
 * Each note goes under the first paragraph citing its act (not inside a table or a heading);
 * a note without such a paragraph goes at the end.
 */
export function placeLegislativeNotes(text: string, notes: Array<{ anchors: string[]; line: string }>): string {
  const lines = text.split("\n");
  const tail: string[] = [];
  const after = new Map<number, string[]>();
  for (const note of notes) {
    const index = lines.findIndex((line) => !/^\s*(?:\||#)/u.test(line) && note.anchors.some((anchor) => anchor && line.includes(anchor)));
    if (index < 0) {
      tail.push(note.line);
      continue;
    }
    // The paragraph's last line (a list item ends at its own line).
    let end = index;
    while (end + 1 < lines.length && lines[end + 1]!.trim() && !/^\s*(?:[-*]|\d+\.|\||#)/u.test(lines[end + 1]!)) end += 1;
    after.set(end, [...(after.get(end) ?? []), note.line]);
  }
  const out: string[] = [];
  lines.forEach((line, index) => {
    out.push(line);
    for (const note of after.get(index) ?? []) out.push("", `> ${note}`);
  });
  return [out.join("\n"), ...tail.map((line) => `> ${line}`)].join("\n\n");
}
