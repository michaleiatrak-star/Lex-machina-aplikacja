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
  onNewCase,
  onRenameCase
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
  // The case's owner renames it here too (as in the case list of the chat).
  onRenameCase?: (caseId: string, displayName: string) => Promise<void>;
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
  const [rename, setRename] = useState<{ caseId: string; value: string; error: string } | null>(null);
  const [renaming, setRenaming] = useState(false);

  async function saveRename(): Promise<void> {
    if (!rename || !onRenameCase) return;
    const value = rename.value.trim();
    const current = cases.find((item) => item.caseId === rename.caseId);
    if (!value || value === current?.displayName) {
      setRename(null);
      return;
    }
    setRenaming(true);
    try {
      await onRenameCase(rename.caseId, value);
      setRename(null);
    } catch (failure) {
      setRename({ ...rename, error: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      setRenaming(false);
    }
  }

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
              {recent.map((item) =>
                rename?.caseId === item.caseId ? (
                  <form
                    key={item.caseId}
                    className="matter-thread-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRename();
                    }}
                  >
                    <input
                      autoFocus
                      value={rename.value}
                      maxLength={160}
                      disabled={renaming}
                      aria-label="Nowa nazwa sprawy"
                      onChange={(event) => setRename({ ...rename, value: event.target.value, error: "" })}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRename(null);
                      }}
                    />
                    <div className="matter-thread-rename-actions">
                      <button type="submit" disabled={renaming || !rename.value.trim()}>
                        Zapisz
                      </button>
                      <button type="button" disabled={renaming} onClick={() => setRename(null)}>
                        Anuluj
                      </button>
                    </div>
                    {rename.error ? <small className="matter-thread-rename-error">{rename.error}</small> : null}
                  </form>
                ) : (
                  <div key={item.caseId} className="matter-thread-row">
                    <button
                      type="button"
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
                    {onRenameCase && item.role === "OWNER" ? (
                      <button
                        type="button"
                        className="matter-thread-edit"
                        disabled={renaming}
                        title="Zmień nazwę sprawy"
                        aria-label={`Zmień nazwę sprawy ${item.displayName || "bez nazwy"}`}
                        onClick={() => setRename({ caseId: item.caseId, value: item.displayName ?? "", error: "" })}
                      >
                        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                          <path
                            d="M11.3 1.9a1.5 1.5 0 0 1 2.1 0l.7.7a1.5 1.5 0 0 1 0 2.1l-8 8-3.3.9.9-3.3 7.6-8.4zM10 4.3l1.7 1.7"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                )
              )}
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
