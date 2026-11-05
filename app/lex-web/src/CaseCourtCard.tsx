import { useEffect, useMemo, useState } from "react";
import { InfoTip } from "./InfoTip";
import { WokandaVerification } from "./WokandaVerification.js";
import {
  addCaseScheduleEvent,
  checkCaseWokanda,
  getCaseCourt,
  listWokandaCourts,
  setCaseCourt,
  type CaseCourtInfo,
  type WokandaCheck,
  type WokandaCourtInfo,
  type WokandaHearing
} from "./api.js";

export const WOKANDA_STATUS_LABEL: Record<WokandaCourtInfo["status"], string> = {
  PORTAL: "wokanda dostępna dla aplikacji",
  BROWSER: "wokanda tylko w przeglądarce",
  NONE: "sąd nie publikuje wokandy",
  UNREACHABLE: "strona sądu nie odpowiada"
};

const SOURCE_LABEL: Record<CaseCourtInfo["zrodlo"], string> = {
  AKTA: "z dokumentów sprawy",
  PISMO: "z pierwszego pisma",
  UZYTKOWNIK: "wpisane ręcznie"
};

/** "2026-11-05" + "08:00" as the local time of this computer (Poland). */
export function hearingStartsAt(hearing: Pick<WokandaHearing, "data" | "godzina">): string {
  const time = /^\d{2}:\d{2}$/u.test(hearing.godzina) ? hearing.godzina : "00:00";
  return new Date(`${hearing.data}T${time}:00`).toISOString();
}

export function hearingLine(hearing: WokandaHearing): string {
  return [
    `${hearing.data} ${hearing.godzina}`,
    hearing.sala ? `sala ${hearing.sala}` : "",
    hearing.miejsce ?? "",
    hearing.wydzial,
    hearing.przewodniczacy ? `przewodniczący: ${hearing.przewodniczacy}` : "",
    hearing.status ? `status: ${hearing.status}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The court and signature of a case and its hearings on the court's wokanda (on request). */
export function CaseCourtCard({ caseId, canWrite, onScheduleChanged }: { caseId: string; canWrite: boolean; onScheduleChanged?: () => void }) {
  const [court, setCourt] = useState<CaseCourtInfo | null>(null);
  const [wokanda, setWokanda] = useState<WokandaCourtInfo | null>(null);
  const [courts, setCourts] = useState<WokandaCourtInfo[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ nazwa: "", wydzial: "", sygnatura: "" });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [check, setCheck] = useState<WokandaCheck | null>(null);

  useEffect(() => {
    let active = true;
    setCheck(null);
    setMessage("");
    getCaseCourt(caseId)
      .then((result) => {
        if (!active) return;
        setCourt(result.court);
        setWokanda(result.wokanda);
        setDraft({ nazwa: result.court?.nazwa ?? "", wydzial: result.court?.wydzial ?? "", sygnatura: result.court?.sygnatura ?? "" });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [caseId]);

  useEffect(() => {
    if (!editing || courts.length) return;
    listWokandaCourts().then((result) => setCourts(result.courts), () => undefined);
  }, [editing, courts.length]);

  const courtNames = useMemo(() => courts.map((item) => item.nazwa).sort((a, b) => a.localeCompare(b, "pl")), [courts]);

  async function save(clear = false) {
    setBusy("save");
    setMessage("");
    try {
      const result = await setCaseCourt(caseId, clear ? {} : { nazwa: draft.nazwa.trim(), wydzial: draft.wydzial.trim(), sygnatura: draft.sygnatura.trim() });
      setCourt(result.court);
      setWokanda(result.wokanda);
      setCheck(null);
      setEditing(false);
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setMessage(
        code.includes("CASE_COURT_UNKNOWN")
          ? "Wybierz sąd z listy sądów powszechnych."
          : code.includes("CASE_SIGNATURE_INVALID")
            ? "Sygnatura w postaci: wydział repertorium numer/rok, np. XI C 1768/26."
            : code
      );
    } finally {
      setBusy("");
    }
  }

  async function runCheck() {
    setBusy("check");
    setMessage("");
    try {
      setCheck(await checkCaseWokanda(caseId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function addToCalendar(hearing: WokandaHearing) {
    setBusy(`add:${hearing.url}`);
    try {
      await addCaseScheduleEvent(caseId, {
        kind: "COURT_HEARING",
        title: `Rozprawa ${hearing.sygnatura}`,
        startsAt: hearingStartsAt(hearing),
        location: [court?.nazwa, hearing.miejsce, hearing.sala ? `sala ${hearing.sala}` : ""].filter(Boolean).join(", "),
        notes: `Z wokandy sądu (${hearing.url}).${hearing.przewodniczacy ? ` Przewodniczący: ${hearing.przewodniczacy}.` : ""}`
      });
      setMessage(`Termin ${hearing.data} ${hearing.godzina} dodany do kalendarza sprawy.`);
      onScheduleChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="chat-card case-court-card">
      <p className="eyebrow">
        Sąd i sygnatura
        <InfoTip>
          Sąd i sygnatura sprawy. Wokandę sprawdzasz na żądanie: aplikacja wysyła jedno zapytanie o tę sygnaturę na stronę sądu, jak przeglądarka. Nie
          odpytuje sądów w tle.
        </InfoTip>
      </p>
      {editing ? (
        <form
          className="case-court-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            Sąd
            <input list={`courts-${caseId}`} value={draft.nazwa} placeholder="Sąd Rejonowy w …" onChange={(event) => setDraft({ ...draft, nazwa: event.target.value })} />
            <datalist id={`courts-${caseId}`}>
              {courtNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label>
            Wydział
            <input value={draft.wydzial} maxLength={120} placeholder="I Wydział Cywilny" onChange={(event) => setDraft({ ...draft, wydzial: event.target.value })} />
          </label>
          <label>
            Sygnatura
            <input value={draft.sygnatura} maxLength={40} placeholder="I C 123/26" onChange={(event) => setDraft({ ...draft, sygnatura: event.target.value })} />
          </label>
          <div className="case-court-actions">
            <button type="submit" className="chat-primary-action" disabled={Boolean(busy) || !draft.nazwa.trim()}>
              Zapisz
            </button>
            <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => setEditing(false)}>
              Anuluj
            </button>
            {court ? (
              <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => void save(true)}>
                Usuń sąd ze sprawy
              </button>
            ) : null}
          </div>
        </form>
      ) : court ? (
        <div className="case-court-view">
          <strong>{court.nazwa}</strong>
          <small>
            {[court.wydzial, court.sygnatura ? `sygn. ${court.sygnatura}` : "bez sygnatury", SOURCE_LABEL[court.zrodlo]].filter(Boolean).join(" · ")}
          </small>
          {wokanda ? <small>Wokanda: {WOKANDA_STATUS_LABEL[wokanda.status]}</small> : null}
        </div>
      ) : (
        <p className="field-help">Sprawa nie ma przypisanego sądu.</p>
      )}
      {!editing ? (
        <div className="case-court-actions">
          {canWrite ? (
            <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => setEditing(true)}>
              {court ? "Zmień sąd lub sygnaturę" : "Przypisz sąd"}
            </button>
          ) : null}
          {court?.sygnatura ? (
            <button type="button" className="chat-primary-action" disabled={Boolean(busy)} onClick={() => void runCheck()}>
              {busy === "check" ? "Sprawdzanie wokandy…" : "Sprawdź wokandę"}
            </button>
          ) : null}
        </div>
      ) : null}
      {check ? <WokandaCheckView check={check} canWrite={canWrite} busy={busy} onAdd={(hearing) => void addToCalendar(hearing)} onVerified={() => void runCheck()} /> : null}
      {message ? <p className="field-help">{message}</p> : null}
    </article>
  );
}

function WokandaCheckView({
  check,
  canWrite,
  busy,
  onAdd,
  onVerified
}: {
  check: WokandaCheck;
  canWrite: boolean;
  busy: string;
  onAdd: (hearing: WokandaHearing) => void;
  onVerified: () => void;
}) {
  const when = new Date(check.checkedAt).toLocaleString("pl-PL");
  if (check.state === "FOUND" || check.state === "NOT_FOUND") {
    return (
      <div className="case-court-result" role="status">
        <small>
          Wokanda {check.court}, sygn. {check.signature} · sprawdzono {when} ·{" "}
          <a href={check.searchUrl} target="_blank" rel="noreferrer">
            strona sądu
          </a>
        </small>
        {check.note ? <p className="field-help">{check.note}</p> : null}
        {check.state === "NOT_FOUND" ? (
          <p className="field-help">Na wokandzie nie ma terminów tej sprawy (wokanda pokazuje zwykle najbliższe posiedzenia jawne).</p>
        ) : (
          <ul className="case-court-hearings">
            {check.hearings.map((hearing) => (
              <li key={hearing.url + hearing.data + hearing.godzina}>
                <span>{hearingLine(hearing)}</span>
                {hearing.sklad ? <small>skład: {hearing.sklad}</small> : null}
                <span className="case-court-actions">
                  <a href={hearing.url} target="_blank" rel="noreferrer">
                    szczegóły
                  </a>
                  {canWrite ? (
                    <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => onAdd(hearing)}>
                      Dodaj do kalendarza
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  // Narrowed by hand: the application build (tsc -b) does not narrow the union by the return above.
  const blocked = check as Extract<WokandaCheck, { reason: string }>;
  if (blocked.verification) {
    return (
      <div className="case-court-result" role="status">
        <WokandaVerification verification={blocked.verification} onVerified={onVerified} />
      </div>
    );
  }
  return (
    <div className="case-court-result" role="status">
      <p className="field-help">
        {blocked.reason}{" "}
        {blocked.url ? (
          <a href={blocked.url} target="_blank" rel="noreferrer">
            Otwórz wokandę sądu
          </a>
        ) : null}
      </p>
    </div>
  );
}
