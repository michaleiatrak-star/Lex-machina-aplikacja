import { t } from "./i18n";
import { useEffect, useId, useMemo, useState } from "react";
import {
  addCaseScheduleEvent,
  deleteCaseScheduleEvent,
  updateCaseScheduleEvent,
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
  // The window above the calendar: the selected day's events, or the add / edit form.
  const [dialog, setDialog] = useState<"" | "day" | "form">("");
  const [editing, setEditing] = useState<UpcomingCaseEvent | null>(null);
  const [draft, setDraft] = useState({
    caseId: "",
    kind: "COURT_HEARING" as CaseScheduleKind,
    title: "",
    day: today,
    time: "09:00",
    location: "",
    notes: ""
  });
  const dialogTitleId = useId();

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

  useEffect(() => {
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  function openDay(key: string): void {
    selectDay(key);
    setError("");
    setDialog("day");
  }

  function openAdd(day: string): void {
    setEditing(null);
    setError("");
    setDraft((current) => ({ ...current, title: "", location: "", notes: "", day }));
    setDialog("form");
  }

  function openEdit(event: UpcomingCaseEvent): void {
    setEditing(event);
    setError("");
    setDraft({
      caseId: event.caseId,
      kind: event.kind,
      title: event.title,
      day: event.startsAt.slice(0, 10),
      time: event.startsAt.slice(11, 16),
      location: event.location ?? "",
      notes: event.notes ?? ""
    });
    setDialog("form");
  }

  async function remove(event: UpcomingCaseEvent): Promise<void> {
    if (busy || !window.confirm(t("Usunąć zdarzenie „{title}” ({value})?", { title: event.title, value: dayLabel(event.startsAt.slice(0, 10)) }))) return;
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
    if (
      busy ||
      !draft.caseId ||
      !draft.title.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.day) ||
      !/^\d{2}:\d{2}$/.test(draft.time)
    ) return;
    setBusy(true);
    setError("");
    const input = {
      kind: draft.kind,
      title: draft.title.trim(),
      startsAt: `${draft.day}T${draft.time}`,
      ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {})
    };
    try {
      if (editing) await updateCaseScheduleEvent(editing.caseId, editing.eventId, input);
      else await addCaseScheduleEvent(draft.caseId, input);
      setReload((value) => value + 1);
      onChanged(draft.caseId);
      selectDay(draft.day);
      setEditing(null);
      setDialog("day");
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
          <button type="button" className="chat-secondary-action" onClick={() => shiftMonth(-1)} aria-label={t("Poprzedni miesiąc")}>‹</button>
          <h2>
            {MONTH_NAMES[cursor.month]} {cursor.year}
          </h2>
          <button type="button" className="chat-secondary-action" onClick={() => shiftMonth(1)} aria-label={t("Następny miesiąc")}>›</button>
          <button
            type="button"
            className="chat-secondary-action"
            onClick={() => {
              const now = new Date();
              setCursor({ year: now.getFullYear(), month: now.getMonth() });
              setSelectedDay(today);
            }}
          >
            {t("Dziś")}
          </button>
          {writableCases.length > 0 ? (
            <button type="button" className="chat-primary-action lex-calendar-add" onClick={() => openAdd(selectedDay)}>
              {t("Dodaj zdarzenie")}
            </button>
          ) : null}
        </div>
        <div className="lex-calendar-grid" role="grid" aria-label={t("Kalendarz spraw")}>
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
                aria-label={`${dayLabel(day.key)}${count ? t(", zdarzeń: {count}", { count: count }) : ""}`}
                className={[
                  "lex-calendar-day",
                  day.inMonth ? "" : "outside",
                  day.key === today ? "today" : "",
                  day.key === selectedDay ? "selected" : ""
                ].join(" ").trim()}
                onClick={() => openDay(day.key)}
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
        {loading ? <p>{t("Ładuję zdarzenia…")}</p> : null}
        {error ? <p className="chat-error">{error}</p> : null}
      </article>

      <article className="chat-card matter-schedule-card">
        <p className="eyebrow">{t("Najbliższe")} {AGENDA_DAYS} {t("dni")}</p>
        <h2>{t("Nadchodzące terminy")}</h2>
        {agenda.length === 0 ? (
          <p>{t("Brak zdarzeń w najbliższych")} {AGENDA_DAYS} {t("dniach.")}</p>
        ) : (
          <ul className="lex-calendar-agenda">
            {agenda.map((event) => {
              const key = event.startsAt.slice(0, 10);
              return (
                <li key={event.eventId} className={event.kind === "DEADLINE" ? "deadline" : undefined}>
                  <button type="button" className="lex-calendar-agenda-day" onClick={() => openDay(key)}>
                    <strong>{relativeDayText(key, today)}</strong>
                    <small>
                      {dayLabel(key)} · {event.startsAt.slice(11)}
                    </small>
                  </button>
                  <span>
                    <span className="matter-schedule-kind">{caseScheduleKindLabel(event.kind)}</span> {event.title}
                    <small> · {event.caseDisplayName || t("Sprawa bez nazwy")}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </article>

      {writableCases.length === 0 ? (
        <p className="matter-collapsible-hint">{t("Brak spraw z prawem zapisu: najpierw załóż sprawę.")}</p>
      ) : null}

      {dialog ? (
        <div
          className="privacy-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          onClick={(event) => {
            if (event.target === event.currentTarget) setDialog("");
          }}
        >
          <section className="chat-card matter-section-dialog">
            <div className="matter-section-dialog-head">
              <div>
                <p className="eyebrow">{dialog === "day" ? relativeDayText(selectedDay, today) : t("Kalendarz spraw")}</p>
                <h2 id={dialogTitleId}>
                  {dialog === "day"
                    ? dayLabel(selectedDay)
                    : editing
                      ? t("Edytuj zdarzenie")
                      : t("Dodaj zdarzenie do kalendarza i sprawy")}
                </h2>
              </div>
              <button type="button" className="chat-secondary-action" onClick={() => setDialog("")}>
                {t("Zamknij")}
              </button>
            </div>
            {error ? <p className="chat-error">{error}</p> : null}
            {dialog === "day" ? (
              <>
                <div className="matter-schedule-list">
                  {dayEvents.length === 0 ? (
                    <p>{t("Brak zdarzeń tego dnia.")}</p>
                  ) : (
                    dayEvents.map((event) => (
                      <div className="matter-schedule-item" key={event.eventId}>
                        <div className="matter-schedule-item-main">
                          <span className="matter-schedule-kind">{caseScheduleKindLabel(event.kind)}</span>
                          <strong>
                            {event.startsAt.slice(11)} · {event.title}
                          </strong>
                          <small>
                            {event.caseDisplayName || t("Sprawa bez nazwy")}
                            {event.location ? ` · ${event.location}` : ""}
                          </small>
                          {event.notes ? <p>{event.notes}</p> : null}
                        </div>
                        <div className="matter-schedule-item-actions">
                          {canWrite(event.caseId) ? (
                            <button
                              type="button"
                              className="chat-secondary-action"
                              aria-label={t("Edytuj zdarzenie")}
                              title={t("Edytuj zdarzenie")}
                              disabled={busy}
                              onClick={() => openEdit(event)}
                            >
                              ✎ {t("Edytuj")}
                            </button>
                          ) : null}
                          <button type="button" className="chat-secondary-action" onClick={() => onOpenCase(event.caseId)}>
                            {t("Otwórz sprawę")}
                          </button>
                          {canWrite(event.caseId) ? (
                            <button
                              type="button"
                              className="chat-secondary-action danger"
                              disabled={busy}
                              onClick={() => void remove(event)}
                            >
                              {t("Usuń")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {writableCases.length > 0 ? (
                  <button type="button" className="chat-secondary-action matter-section-dialog-add" onClick={() => openAdd(selectedDay)}>
                    {t("+ Dodaj")}
                  </button>
                ) : null}
              </>
            ) : (
              <form
                className="matter-schedule-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <select
                  aria-label={t("Sprawa, której dotyczy zdarzenie")}
                  value={draft.caseId}
                  disabled={busy || Boolean(editing)}
                  onChange={(event) => setDraft((current) => ({ ...current, caseId: event.target.value }))}
                >
                  <option value="">{t("Wskaż sprawę (wymagane)")}</option>
                  {(editing && !writableCases.some((item) => item.caseId === editing.caseId)
                    ? [...writableCases, ...cases.filter((item) => item.caseId === editing.caseId)]
                    : writableCases
                  ).map((item) => (
                    <option key={item.caseId} value={item.caseId}>
                      {item.displayName || t("Sprawa bez nazwy")}
                    </option>
                  ))}
                </select>
                <div className="chat-form-row">
                  <select
                    aria-label={t("Rodzaj zdarzenia")}
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
                    aria-label={t("Data")}
                    value={draft.day}
                    disabled={busy}
                    onChange={(event) => setDraft((current) => ({ ...current, day: event.target.value }))}
                  />
                  <input
                    type="time"
                    aria-label={t("Godzina")}
                    value={draft.time}
                    disabled={busy}
                    onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))}
                  />
                </div>
                <input
                  maxLength={180}
                  placeholder={t("Opis, np. rozprawa apelacyjna")}
                  aria-label={t("Opis, np. rozprawa apelacyjna")}
                  value={draft.title}
                  disabled={busy}
                  autoFocus
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                />
                <input
                  maxLength={180}
                  placeholder={t("Miejsce / sala / adres (opcjonalnie)")}
                  aria-label={t("Miejsce / sala / adres (opcjonalnie)")}
                  value={draft.location}
                  disabled={busy}
                  onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))}
                />
                <textarea
                  maxLength={2000}
                  placeholder={t("Notatka (opcjonalnie)")}
                  aria-label={t("Notatka (opcjonalnie)")}
                  value={draft.notes}
                  disabled={busy}
                  onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                />
                <div className="chat-form-row">
                  <button
                    type="submit"
                    className="chat-primary-action"
                    disabled={busy || !draft.caseId || !draft.title.trim() || !draft.time || !draft.day}
                  >
                    {editing ? t("Zapisz") : t("Dodaj zdarzenie")}
                  </button>
                  <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => setDialog(editing ? "day" : "")}>
                    {t("Anuluj")}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
