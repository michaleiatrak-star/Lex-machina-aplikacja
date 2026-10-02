import { useEffect, useMemo, useState } from "react";
import {
  addCaseScheduleEvent,
  deleteCaseScheduleEvent,
  listUpcomingEvents,
  type CaseListItem,
  type CaseScheduleKind,
  type UpcomingCaseEvent
} from "./api.js";
import {
  CASE_SCHEDULE_KINDS,
  MONTH_NAMES,
  canWriteCase,
  casesNewestFirst,
  caseScheduleKindLabel,
  dayKey,
  dayLabel,
  relativeDayText,
  groupByDay,
  monthGrid
} from "./case-calendar.js";

const WEEKDAYS = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];
const AGENDA_DAYS = 14;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Month calendar of all the user's cases. A new event always belongs to a
 * case: the user has to pick it before saving.
 */
export function CalendarPanel({
  cases,
  refreshToken,
  onOpenCase,
  onChanged
}: {
  cases: readonly CaseListItem[];
  refreshToken: number;
  onOpenCase: (caseId: string) => void;
  onChanged: (caseId: string) => void;
}) {
  const today = dayKey(new Date());
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(today);
  const [events, setEvents] = useState<UpcomingCaseEvent[]>([]);
  const [agenda, setAgenda] = useState<UpcomingCaseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState({
    caseId: "",
    kind: "COURT_HEARING" as CaseScheduleKind,
    title: "",
    time: "09:00",
    location: "",
    notes: ""
  });

  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const byDay = useMemo(() => groupByDay(events), [events]);
  const writableCases = useMemo(
    () => casesNewestFirst(cases).filter((item) => canWriteCase(item)),
    [cases]
  );
  const canWrite = (caseId: string) => canWriteCase(cases.find((item) => item.caseId === caseId));
  const firstKey = weeks[0]?.[0]?.key;
  const lastKey = weeks.at(-1)?.at(-1)?.key;

  useEffect(() => {
    if (!firstKey || !lastKey) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void listUpcomingEvents({ from: `${firstKey}T00:00`, until: `${lastKey}T23:59`, limit: 500 })
      .then((result) => {
        if (!cancelled) setEvents(result.events);
      })
      .catch((failure) => {
        if (!cancelled) {
          setEvents([]);
          setError(errorText(failure));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firstKey, lastKey, refreshToken, reload]);

  // Najbliższe terminy niezależnie od oglądanego miesiąca.
  useEffect(() => {
    let cancelled = false;
    const until = new Date();
    until.setDate(until.getDate() + AGENDA_DAYS);
    void listUpcomingEvents({ from: `${today}T00:00`, until: `${dayKey(until)}T23:59`, limit: 30 })
      .then((result) => {
        if (!cancelled) setAgenda(result.events);
      })
      .catch(() => {
        if (!cancelled) setAgenda([]);
      });
    return () => {
      cancelled = true;
    };
  }, [today, refreshToken, reload]);

  function selectDay(key: string): void {
    setSelectedDay(key);
    const [year, month] = key.split("-").map(Number);
    if (year && month && (year !== cursor.year || month - 1 !== cursor.month)) {
      setCursor({ year, month: month - 1 });
    }
  }

  async function remove(event: UpcomingCaseEvent): Promise<void> {
    if (busy || !window.confirm(`Usunąć zdarzenie „${event.title}” (${dayLabel(event.startsAt.slice(0, 10))})?`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteCaseScheduleEvent(event.caseId, event.eventId);
      setReload((value) => value + 1);
      onChanged(event.caseId);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  function shiftMonth(delta: number): void {
    setCursor((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  async function save(): Promise<void> {
    if (busy || !draft.caseId || !draft.title.trim() || !/^\d{2}:\d{2}$/.test(draft.time)) return;
    setBusy(true);
    setError("");
    try {
      await addCaseScheduleEvent(draft.caseId, {
        kind: draft.kind,
        title: draft.title.trim(),
        startsAt: `${selectedDay}T${draft.time}`,
        ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
        ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {})
      });
      setDraft((current) => ({ ...current, title: "", location: "", notes: "" }));
      setReload((value) => value + 1);
      onChanged(draft.caseId);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const dayEvents = byDay.get(selectedDay) ?? [];

  return (
    <section className="chat-card-stack">
      <article className="chat-card">
        <div className="lex-calendar-head">
          <button type="button" className="chat-secondary-action" onClick={() => shiftMonth(-1)} aria-label="Poprzedni miesiąc">‹</button>
          <h2>
            {MONTH_NAMES[cursor.month]} {cursor.year}
          </h2>
          <button type="button" className="chat-secondary-action" onClick={() => shiftMonth(1)} aria-label="Następny miesiąc">›</button>
          <button
            type="button"
            className="chat-secondary-action"
            onClick={() => {
              const now = new Date();
              setCursor({ year: now.getFullYear(), month: now.getMonth() });
              setSelectedDay(today);
            }}
          >
            Dziś
          </button>
        </div>
        <div className="lex-calendar-grid" role="grid" aria-label="Kalendarz spraw">
          {WEEKDAYS.map((name) => (
            <span key={name} className="lex-calendar-weekday">{name}</span>
          ))}
          {weeks.flat().map((day) => {
            const items = byDay.get(day.key) ?? [];
            const count = items.length;
            return (
              <button
                key={day.key}
                type="button"
                title={items.map((item) => `${item.startsAt.slice(11)} ${caseScheduleKindLabel(item.kind)}: ${item.title}`).join("\n") || undefined}
                aria-label={`${dayLabel(day.key)}${count ? `, zdarzeń: ${count}` : ""}`}
                className={[
                  "lex-calendar-day",
                  day.inMonth ? "" : "outside",
                  day.key === today ? "today" : "",
                  day.key === selectedDay ? "selected" : ""
                ].join(" ").trim()}
                onClick={() => setSelectedDay(day.key)}
              >
                <span>{day.day}</span>
                {count > 0 ? <small>{count}</small> : null}
                {count > 0 ? (
                  <span className="lex-calendar-kinds" aria-hidden="true">
                    {[...new Set(items.map((item) => item.kind))].map((kind) => (
                      <i key={kind} className={`lex-calendar-kind kind-${kind.toLowerCase()}`} />
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="lex-calendar-legend" aria-hidden="true">
          {CASE_SCHEDULE_KINDS.map(([id, label]) => (
            <span key={id}>
              <i className={`lex-calendar-kind kind-${id.toLowerCase()}`} /> {label}
            </span>
          ))}
        </div>
        {loading ? <p>Ładuję zdarzenia…</p> : null}
        {error ? <p className="chat-error">{error}</p> : null}
      </article>

      <article className="chat-card matter-schedule-card">
        <p className="eyebrow">Najbliższe {AGENDA_DAYS} dni</p>
        <h2>Nadchodzące terminy</h2>
        {agenda.length === 0 ? (
          <p>Brak zdarzeń w najbliższych {AGENDA_DAYS} dniach.</p>
        ) : (
          <ul className="lex-calendar-agenda">
            {agenda.map((event) => {
              const key = event.startsAt.slice(0, 10);
              return (
                <li key={event.eventId} className={event.kind === "DEADLINE" ? "deadline" : undefined}>
                  <button type="button" className="lex-calendar-agenda-day" onClick={() => selectDay(key)}>
                    <strong>{relativeDayText(key, today)}</strong>
                    <small>
                      {dayLabel(key)} · {event.startsAt.slice(11)}
                    </small>
                  </button>
                  <span>
                    <span className="matter-schedule-kind">{caseScheduleKindLabel(event.kind)}</span> {event.title}
                    <small> · {event.caseDisplayName || "Sprawa bez nazwy"}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </article>

      <article className="chat-card matter-schedule-card">
        <p className="eyebrow">{relativeDayText(selectedDay, today)}</p>
        <h2>{dayLabel(selectedDay)}</h2>
        <div className="matter-schedule-list">
          {dayEvents.length === 0 ? (
            <p>Brak zdarzeń tego dnia.</p>
          ) : (
            dayEvents.map((event) => (
              <div className="matter-schedule-item" key={event.eventId}>
                <div className="matter-schedule-item-main">
                  <span className="matter-schedule-kind">{caseScheduleKindLabel(event.kind)}</span>
                  <strong>
                    {event.startsAt.slice(11)} · {event.title}
                  </strong>
                  <small>
                    {event.caseDisplayName || "Sprawa bez nazwy"}
                    {event.location ? ` · ${event.location}` : ""}
                  </small>
                  {event.notes ? <p>{event.notes}</p> : null}
                </div>
                <div className="matter-schedule-item-actions">
                  <button type="button" className="chat-secondary-action" onClick={() => onOpenCase(event.caseId)}>
                    Otwórz sprawę
                  </button>
                  {canWrite(event.caseId) ? (
                    <button
                      type="button"
                      className="chat-secondary-action danger"
                      disabled={busy}
                      onClick={() => void remove(event)}
                    >
                      Usuń
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        <h3>Dodaj zdarzenie do kalendarza i sprawy</h3>
        <div className="matter-schedule-form">
          <select
            aria-label="Sprawa, której dotyczy zdarzenie"
            value={draft.caseId}
            disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, caseId: event.target.value }))}
          >
            <option value="">Wskaż sprawę (wymagane)</option>
            {writableCases.map((item) => (
              <option key={item.caseId} value={item.caseId}>
                {item.displayName || "Sprawa bez nazwy"}
              </option>
            ))}
          </select>
          <div className="chat-form-row">
            <select
              aria-label="Rodzaj zdarzenia"
              value={draft.kind}
              disabled={busy}
              onChange={(event) =>
                setDraft((current) => ({ ...current, kind: event.target.value as CaseScheduleKind }))
              }
            >
              {CASE_SCHEDULE_KINDS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            <input
              type="date"
              aria-label="Data"
              value={selectedDay}
              disabled={busy}
              onChange={(event) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) selectDay(event.target.value);
              }}
            />
            <input
              type="time"
              aria-label="Godzina"
              value={draft.time}
              disabled={busy}
              onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))}
            />
          </div>
          <input
            maxLength={180}
            placeholder="Opis, np. rozprawa apelacyjna"
            value={draft.title}
            disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
          <div className="chat-form-row">
            <input
              maxLength={180}
              placeholder="Miejsce / sala / adres (opcjonalnie)"
              value={draft.location}
              disabled={busy}
              onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))}
            />
            <button
              type="button"
              className="chat-primary-action"
              disabled={busy || !draft.caseId || !draft.title.trim() || !draft.time}
              onClick={() => void save()}
            >
              Dodaj zdarzenie
            </button>
          </div>
          <textarea
            maxLength={2000}
            placeholder="Notatka (opcjonalnie)"
            value={draft.notes}
            disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          />
          {writableCases.length === 0 ? (
            <small>Brak spraw z prawem zapisu: najpierw załóż sprawę.</small>
          ) : null}
        </div>
      </article>
    </section>
  );
}
