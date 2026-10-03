import type { LegalActDescriptor } from "./legal-act-resolver.js";
import type { TemporalFreshnessResult } from "./temporal-source-freshness.js";
import type { VerificationRecord } from "./verification-ledger.js";

/**
 * Evidence memory of a matter's thread: provisions verified in earlier
 * messages (with the consolidated text they were checked against), skills
 * read and sources used. Stored by the runtime in the encrypted case
 * workspace, never taken from the client.
 */
export type ThreadEvidence = {
  schemaVersion: 1;
  updatedAt: string;
  provisions: VerificationRecord[];
  skills: string[];
  sources: Array<{ claim: string; status: string; url: string; fetchedAt: string }>;
};

const MAX_PROVISIONS = 80;
const MAX_SKILLS = 40;
const MAX_SOURCES = 40;
const MAX_ACT_CHECKS = 12;

// A provision may be reused only when it was checked against the current
// consolidated text of a known act (not a substitute source, not historical).
export function reusableProvision(record: VerificationRecord): boolean {
  return (
    record.kind === "statute" &&
    record.status === "VERIFIED" &&
    (record.temporalMode ?? "CURRENT") === "CURRENT" &&
    record.temporalFreshnessStatus === "CURRENT" &&
    Boolean(record.currentEli) &&
    Boolean(record.actDescriptor?.baseEli) &&
    !record.substituteFor &&
    !record.officialAnchor &&
    Boolean(record.sourceUrl)
  );
}

const claimKey = (claim: string): string => claim.replace(/\s+/g, " ").trim().toLowerCase();

/** Previous evidence updated with one answer's records; newest wins per claim. */
export function mergeThreadEvidence(
  previous: ThreadEvidence | null,
  records: VerificationRecord[],
  skills: string[],
  now: string
): ThreadEvidence {
  const provisions = new Map<string, VerificationRecord>();
  for (const record of [...(previous?.provisions ?? []), ...records.filter(reusableProvision)]) {
    const key = claimKey(record.claim);
    provisions.delete(key);
    provisions.set(key, { ...record });
  }
  const sources = new Map<string, ThreadEvidence["sources"][number]>();
  for (const source of [
    ...(previous?.sources ?? []),
    ...records
      .filter((record) => record.kind !== "statute" && record.sourceUrl)
      .map((record) => ({ claim: record.claim, status: record.status, url: record.sourceUrl!, fetchedAt: record.fetchedAt }))
  ]) {
    sources.delete(claimKey(source.claim));
    sources.set(claimKey(source.claim), source);
  }
  return {
    schemaVersion: 1,
    updatedAt: now,
    provisions: [...provisions.values()].slice(-MAX_PROVISIONS),
    skills: [...new Set([...(previous?.skills ?? []), ...skills])].slice(-MAX_SKILLS),
    sources: [...sources.values()].slice(-MAX_SOURCES)
  };
}

export function validThreadEvidence(value: unknown): ThreadEvidence | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ThreadEvidence>;
  if (
    raw.schemaVersion !== 1 ||
    typeof raw.updatedAt !== "string" ||
    !Array.isArray(raw.provisions) ||
    !Array.isArray(raw.skills) ||
    !Array.isArray(raw.sources)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    updatedAt: raw.updatedAt,
    provisions: raw.provisions.filter(
      (record): record is VerificationRecord =>
        Boolean(record) && typeof record.claim === "string" && typeof record.fetchedAt === "string" && reusableProvision(record)
    ),
    skills: raw.skills.filter((skill): skill is string => typeof skill === "string"),
    sources: raw.sources.filter(
      (source) => Boolean(source) && typeof source.claim === "string" && typeof source.url === "string"
    )
  };
}

export type ThreadEvidenceReuse = {
  // Records unchanged in ELI: added to this turn's ledger.
  reused: VerificationRecord[];
  // Consolidated text replaced, amendments after it, or ELI did not answer.
  recheck: Array<{ claim: string; reason: string }>;
};

/**
 * One ELI check per act: a provision is reused only when the act's current
 * consolidated text is still the one it was verified against and no
 * amendment followed it.
 */
export async function revalidateThreadEvidence(
  evidence: ThreadEvidence,
  check: (act: LegalActDescriptor) => Promise<TemporalFreshnessResult>
): Promise<ThreadEvidenceReuse> {
  const byAct = new Map<string, VerificationRecord[]>();
  for (const record of evidence.provisions) {
    const base = record.actDescriptor!.baseEli;
    byAct.set(base, [...(byAct.get(base) ?? []), record]);
  }
  const reused: VerificationRecord[] = [];
  const recheck: ThreadEvidenceReuse["recheck"] = [];
  const acts = [...byAct.entries()];
  for (const [index, [, records]] of acts.entries()) {
    if (index >= MAX_ACT_CHECKS) {
      recheck.push(...records.map((record) => ({ claim: record.claim, reason: "ACT_CHECK_LIMIT" })));
      continue;
    }
    let result: TemporalFreshnessResult | null = null;
    try {
      result = await check(records[0]!.actDescriptor!);
    } catch {
      result = null;
    }
    for (const record of records) {
      const reason = !result
        ? "ELI_UNAVAILABLE"
        : result.status !== "CURRENT"
          ? result.status
          : result.currentEli !== record.currentEli
            ? "CONSOLIDATED_TEXT_CHANGED"
            : result.amendmentsAfter.length > 0
              ? "POST_TJ_AMENDMENTS"
              : null;
      if (reason) recheck.push({ claim: record.claim, reason });
      else reused.push({ ...record, freshnessCheckedAt: result!.checkedAt });
    }
  }
  return { reused, recheck };
}

export function threadEvidencePrompt(evidence: ThreadEvidence, reuse: ThreadEvidenceReuse): string {
  const lines = [
    "# JUŻ USTALONE W TEJ SPRAWIE (pamięć dowodowa wątku)",
    "Z poprzednich wiadomości. Status pochodzi z rejestru weryfikacji, nie z pamięci modelu."
  ];
  if (reuse.reused.length) {
    lines.push(
      "Przepisy zweryfikowane wcześniej; aktualność potwierdzona teraz w Sejm ELI (ten sam tekst jednolity, bez nowelizacji po nim). Nie weryfikuj ich ponownie; znacznik wstawi aplikacja z rejestru. Brzmienie cytuj wyłącznie z narzędzia (read_core_law_article), nigdy z pamięci:",
      ...reuse.reused.map(
        (record) =>
          `- ${record.claim}: VERIFIED, ${record.currentEli ? `t.j. ELI ${record.currentEli}, ` : ""}pobrano ${record.fetchedAt.slice(0, 10)}, aktualność potwierdzona ${record.freshnessCheckedAt?.slice(0, 10) ?? "teraz"} (${record.sourceAnchorUrl ?? record.sourceUrl})`
      )
    );
  }
  if (reuse.recheck.length) {
    lines.push(
      "Przepisy zweryfikowane wcześniej, ale do ponownej weryfikacji (zmiana w ELI albo brak odpowiedzi ELI); bez nowej weryfikacji są niezweryfikowane:",
      ...reuse.recheck.map((item) => `- ${item.claim}: ${item.reason}`)
    );
  }
  if (evidence.sources.length) {
    lines.push(
      "Inne źródła użyte wcześniej (status z chwili użycia; orzeczenia NSA/WSA z CBOSA pozostają snapshotem):",
      ...evidence.sources.slice(-15).map((source) => `- ${source.claim}: ${source.status}, ${source.url}, ${source.fetchedAt.slice(0, 10)}`)
    );
  }
  if (evidence.skills.length) {
    lines.push(`Skille przeczytane wcześniej w tej sprawie: ${evidence.skills.join(", ")}.`);
  }
  return lines.join("\n");
}
