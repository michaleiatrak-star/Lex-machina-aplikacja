import { N_, t } from "./i18n";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { probeWokandaSession, type WokandaCourtInfo } from "./api.js";
import { AUTO_TRIES, desktopInvoke } from "./SnVerification.js";

/** Court windows open at once in one round of the bulk verification. */
export const ROUND_SIZE = 10;

type CourtState = "waiting" | "open" | "verified" | "skipped" | "failed";

/** The courts split into rounds of ROUND_SIZE, in the given order. */
export function verificationRounds<T>(courts: readonly T[], size = ROUND_SIZE): T[][] {
  const rounds: T[][] = [];
  for (let start = 0; start < courts.length; start += size) rounds.push(courts.slice(start, start + size));
  return rounds;
}

const courtUrl = (court: WokandaCourtInfo) => court.url ?? `https://${court.domena}/wokanda`;

const STATE_LABEL: Record<CourtState, string> = {
  waiting: N_("czeka"),
  open: N_("okno otwarte"),
  verified: N_("zweryfikowany"),
  skipped: N_("pominięty"),
  failed: N_("okno się nie otworzyło")
};

/**
 * Bulk verification of courts without access for the application: the courts' windows open
 * ROUND_SIZE at a time (minimized first: most browser checks pass on their own, the rest are
 * shown to the user after a few probes). Each window closes itself once its court answers;
 * when every court of a round is settled, the round's courts are re-checked and the next round
 * opens. A window the user closes counts as skipped.
 */
export function WokandaBulkVerification({
  courts,
  onRoundDone,
  onClose
}: {
  courts: readonly WokandaCourtInfo[];
  onRoundDone: (verified: string[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const invoke = desktopInvoke();
  const titleId = useId();
  const rounds = useMemo(() => verificationRounds(courts), [courts]);
  const [round, setRound] = useState(0);
  const [states, setStates] = useState<Record<string, CourtState>>({});
  const statesRef = useRef(states);
  const onRoundDoneRef = useRef(onRoundDone);
  onRoundDoneRef.current = onRoundDone;
  const finished = round >= rounds.length;

  const mark = (name: string, state: CourtState) => {
    statesRef.current = { ...statesRef.current, [name]: state };
    setStates(statesRef.current);
  };

  useEffect(() => {
    if (!invoke || finished) return;
    const batch = rounds[round]!;
    let cancelled = false;
    let tries = 0;
    let shown = false;
    let busy = false;
    let closing = false;
    void Promise.all(
      batch.map((court, slot) =>
        invoke("wokanda_verification_open", { url: courtUrl(court), minimized: true, slot }).then(
          () => !cancelled && mark(court.nazwa, "open"),
          () => !cancelled && mark(court.nazwa, "failed")
        )
      )
    );
    batch.forEach((court) => mark(court.nazwa, "waiting"));

    async function probe(court: WokandaCourtInfo, slot: number): Promise<void> {
      let cookie: string;
      try {
        cookie = String(await invoke!("wokanda_verification_cookies", { url: courtUrl(court), slot }));
      } catch {
        // The user closed this court's window: skipped.
        if (!cancelled && statesRef.current[court.nazwa] === "open") mark(court.nazwa, "skipped");
        return;
      }
      const { ready } = await probeWokandaSession(court.domena, cookie, navigator.userAgent).catch(() => ({ ready: false }));
      if (ready && !cancelled && statesRef.current[court.nazwa] === "open") {
        mark(court.nazwa, "verified");
        await invoke!("wokanda_verification_close", { slot }).catch(() => undefined);
      }
    }

    async function tick(): Promise<void> {
      if (cancelled || busy || closing) return;
      busy = true;
      tries += 1;
      try {
        await Promise.all(batch.map((court, slot) => (statesRef.current[court.nazwa] === "open" ? probe(court, slot) : undefined)));
        if (cancelled) return;
        if (!shown && tries >= AUTO_TRIES) {
          shown = true;
          await Promise.all(
            batch.map((court, slot) =>
              statesRef.current[court.nazwa] === "open" ? invoke!("verification_window_show", { kind: "wokanda", slot }).catch(() => undefined) : undefined
            )
          );
        }
        const settled = batch.every((court) => !["waiting", "open"].includes(statesRef.current[court.nazwa] ?? "waiting"));
        if (settled && !cancelled) {
          closing = true;
          await onRoundDoneRef.current(batch.filter((court) => statesRef.current[court.nazwa] === "verified").map((court) => court.nazwa));
          if (!cancelled) setRound((current) => current + 1);
        }
      } finally {
        busy = false;
      }
    }

    const timer = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      batch.forEach((_, slot) => void invoke("wokanda_verification_close", { slot }).catch(() => undefined));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, rounds, finished]);

  function skipRest(): void {
    const batch = rounds[round] ?? [];
    batch.forEach((court, slot) => {
      if (statesRef.current[court.nazwa] === "open" || statesRef.current[court.nazwa] === "waiting") {
        mark(court.nazwa, "skipped");
        void invoke?.("wokanda_verification_close", { slot }).catch(() => undefined);
      }
    });
  }

  const verified = courts.filter((court) => states[court.nazwa] === "verified").length;
  const current = rounds[round] ?? [];

  return (
    <div className="privacy-preview-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <section className="chat-card matter-section-dialog wokanda-bulk-dialog">
        <div className="case-collaboration-head">
          <div>
            <p className="eyebrow">{t("Weryfikacja wokand")}</p>
            <h3 id={titleId}>
              {finished
                ? t("Weryfikacja zakończona")
                : t("Tura {round} z {rounds}", { round: String(round + 1), rounds: String(rounds.length) })}
            </h3>
          </div>
          <button type="button" className="chat-secondary-action" onClick={onClose}>
            {finished ? t("Zamknij") : t("Przerwij")}
          </button>
        </div>
        <p className="field-help" role="status">
          {t("Zweryfikowane: {done} z {count}.", { done: String(verified), count: String(courts.length) })}{" "}
          {finished
            ? null
            : t("Okna sądów otwierają się po {size} naraz. Przejdź weryfikację w każdym oknie, które się pokaże; okno zamknie się samo, a po całej turze otworzy się następna.", { size: String(ROUND_SIZE) })}
        </p>
        {!invoke ? <p className="alert">{t("Weryfikacja w oknach sądów działa w aplikacji na komputerze.")}</p> : null}
        {finished ? null : (
          <>
            <div className="case-list-scroll">
              <table className="lex-case-table wokanda-bulk-table">
                <thead>
                  <tr>
                    <th scope="col">{t("Sąd")}</th>
                    <th scope="col">{t("Stan")}</th>
                  </tr>
                </thead>
                <tbody>
                  {current.map((court) => (
                    <tr key={court.nazwa} className="lex-case-row">
                      <td>{court.nazwa}</td>
                      <td className={`wokanda-bulk-state is-${states[court.nazwa] ?? "waiting"}`}>{t(STATE_LABEL[states[court.nazwa] ?? "waiting"])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="case-list-bulk">
              <button type="button" className="chat-secondary-action" onClick={skipRest}>
                {t("Pomiń pozostałe w tej turze")}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
