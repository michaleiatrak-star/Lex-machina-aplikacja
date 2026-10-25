import { InfoTip } from "./InfoTip";
import { CASE_ROLE_LABEL } from "./api";
import { useEffect, useState } from "react";
import {
  listInvoices,
  listUpcomingEvents,
  type AuthenticatedUser,
  type CaseListItem,
  type InvoiceView,
  type UpcomingCaseEvent
} from "./api.js";
import { greeting, homeAttention } from "./home-attention.js";
import {
  casesNewestFirst,
  caseScheduleKindLabel,
  caseScheduleStartLabel
} from "./case-calendar.js";

const UPCOMING_LIMIT = 8;
const RECENT_CASES = 8;

/** Start screen: who is signed in, the model, the nearest events and cases. */
export function HomeDashboard({
  user,
  cases,
  modelLabel,
  modelStatus,
  refreshToken,
  onOpenCase,
  onOpenCalendar,
  onOpenFirm,
  onOpenModels,
  onOpenInvoices,
  onNewCase
}: {
  user: AuthenticatedUser;
  cases: readonly CaseListItem[];
  modelLabel: string;
  modelStatus: string;
  refreshToken: number;
  onOpenCase: (caseId: string) => void;
  onOpenCalendar: () => void;
  onOpenFirm: () => void;
  onOpenModels: () => void;
  onOpenInvoices?: () => void;
  onNewCase: () => void;
}) {
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  useEffect(() => {
    let cancelled = false;
    // Invoices are optional on Start (no access, no module): nothing to show then.
    void listInvoices("", "date-desc")
      .then((result) => {
        if (!cancelled) setInvoices(result.invoices);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);
  const [events, setEvents] = useState<UpcomingCaseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listUpcomingEvents({ limit: UPCOMING_LIMIT })
      .then((result) => {
        if (!cancelled) setEvents(result.events);
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const recent = casesNewestFirst(cases).slice(0, RECENT_CASES);

  return (
    <section className="chat-card-stack lex-home">
      <article className="chat-card lex-home-header">
        <div>
          <p className="eyebrow">
            {new Date().toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
          <h2>{greeting(new Date())}, {user.displayName}.</h2>
          <small>Wróć do sprawy lub sprawdź, co wymaga uwagi. · @{user.loginName}</small>
        </div>
        <div>
          <p className="eyebrow">
            Model domyślny<InfoTip>Ostatnio używany model; nowe rozmowy startują z nim.</InfoTip>
          </p>
          <strong>{modelLabel || "nie wybrano"}</strong>
          <small>{modelStatus}</small>
          <button type="button" className="chat-secondary-action" onClick={onOpenModels}>
            Zmień model
          </button>
        </div>
      </article>

      {(() => {
        const attention = loading ? [] : homeAttention(events, invoices, new Date());
        return attention.length ? (
          <article className="chat-card lex-home-attention" aria-label="Wymaga uwagi">
            <div className="lex-home-card-head">
              <h2>Wymaga uwagi</h2>
            </div>
            <ul>
              {attention.map((item) => (
                <li key={item.key}>
                  {item.key === "events" ? (
                    <button type="button" className="chat-secondary-action" onClick={onOpenCalendar}>{item.text}</button>
                  ) : onOpenInvoices ? (
                    <button type="button" className="chat-secondary-action" onClick={onOpenInvoices}>{item.text}</button>
                  ) : (
                    <span>{item.text}</span>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ) : null;
      })()}

      <div className="lex-home-columns">
        <article className="chat-card">
          <div className="lex-home-card-head">
            <h2>Najbliższe zdarzenia</h2>
            <button type="button" className="chat-secondary-action" onClick={onOpenCalendar}>
              Kalendarz
            </button>
          </div>
          {loading ? (
            <p>Ładuję zdarzenia…</p>
          ) : error ? (
            <p className="chat-error">{error}</p>
          ) : events.length === 0 ? (
            <p>Brak zaplanowanych zdarzeń.</p>
          ) : (
            <div className="matter-schedule-list">
              {events.map((event) => (
                <button
                  type="button"
                  key={event.eventId}
                  className="matter-schedule-item lex-home-item"
                  onClick={() => onOpenCase(event.caseId)}
                >
                  <span className="matter-schedule-item-main">
                    <span className="matter-schedule-kind">{caseScheduleKindLabel(event.kind)}</span>
                    <strong>{event.title}</strong>
                    <small>
                      {caseScheduleStartLabel(event.startsAt)} · {event.caseDisplayName || "Sprawa bez nazwy"}
                      {event.location ? ` · ${event.location}` : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="chat-card">
          <div className="lex-home-card-head">
            <h2>Sprawy od najnowszych</h2>
            <button type="button" className="chat-secondary-action" onClick={onNewCase}>
              + Nowa sprawa
            </button>
          </div>
          {recent.length === 0 ? (
            <p>Brak spraw.</p>
          ) : (
            <div className="matter-schedule-list">
              {recent.map((item) => (
                <button
                  type="button"
                  key={item.caseId}
                  className="matter-schedule-item lex-home-item"
                  onClick={() => onOpenCase(item.caseId)}
                >
                  <span className="matter-schedule-item-main">
                    <strong>{item.displayName || "Sprawa bez nazwy"}</strong>
                    <small>
                      zmieniona {new Date(item.updatedAt || item.createdAt).toLocaleString("pl-PL")}
                      {" · "}
                      {item.archivedAt ? "archiwalna" : CASE_ROLE_LABEL[item.role]}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="chat-card lex-home-card-head">
        <div>
          <h2>
            Kancelaria<InfoTip>Wiedza kancelarii, wzory pism i materiały wspólne.</InfoTip>
          </h2>
        </div>
        <button type="button" className="chat-primary-action" onClick={onOpenFirm}>
          Przejdź do modułu Kancelaria
        </button>
      </article>
    </section>
  );
}
