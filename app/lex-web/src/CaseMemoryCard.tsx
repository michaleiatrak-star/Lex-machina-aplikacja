import { useEffect, useState } from "react";
import {
  clearCaseMemory,
  getCaseMemory,
  updateCaseSummary,
  type CaseMemory
} from "./api.js";

const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("pl-PL") : "—");

/**
 * What the next answers in this matter start from: the summary of older
 * messages (editable) and provisions verified earlier (reused only when ELI
 * still has the same consolidated text).
 */
export function CaseMemoryCard({
  caseId,
  canWrite,
  refreshToken
}: {
  caseId: string;
  canWrite: boolean;
  refreshToken: unknown;
}) {
  const [memory, setMemory] = useState<CaseMemory | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setMessage("");
    getCaseMemory(caseId)
      .then((next) => {
        if (!active) return;
        setMemory(next);
        setDraft(next.summary?.text ?? "");
        setEditing(false);
      })
      .catch((error: unknown) => {
        if (active) setMessage(`Pamięć sprawy niedostępna: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      active = false;
    };
  }, [caseId, refreshToken]);

  const provisions = memory?.evidence?.provisions ?? [];
  const summary = memory?.summary ?? null;
  const chronology = memory?.chronology ?? null;
  const work = memory?.work ?? [];

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage("");
    try {
      await work();
      setMessage(done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="chat-card">
      <details>
        <summary>
          <span className="eyebrow">Pamięć sprawy</span>{" "}
          {provisions.length ? `${provisions.length} przepisów` : "bez przepisów"}
          {summary ? `, streszczenie ${summary.coveredMessages} wiadomości` : ""}
          {chronology ? ", oś czasu" : ""}
          {work.length ? `, prace: ${work.filter((item) => item.status === "DONE").length} zamkniętych, ${work.filter((item) => item.status === "OPEN").length} otwartych` : ""}
        </summary>
        <p className="field-help">
          Kolejne odpowiedzi w tej sprawie zaczynają od tych ustaleń. Przepis zweryfikowany wcześniej jest użyty bez ponownej weryfikacji tylko wtedy, gdy Sejm ELI ma ten sam tekst jednolity i nie ma nowelizacji po nim.
        </p>

        <h3>Streszczenie wcześniejszej części rozmowy</h3>
        {summary ? (
          <>
            <p className="field-help">
              Zastępuje {summary.coveredMessages} najstarszych wiadomości, które nie mieszczą się w oknie modelu (stan z {date(summary.updatedAt)}
              {summary.editedByUser ? ", poprawione ręcznie" : ""}).
            </p>
            {editing ? (
              <>
                <textarea rows={12} value={draft} onChange={(event) => setDraft(event.target.value)} />
                <div className="chat-form-row">
                  <button
                    type="button"
                    className="chat-primary-action"
                    disabled={busy || !draft.trim()}
                    onClick={() =>
                      void run(async () => {
                        const next = await updateCaseSummary(caseId, draft);
                        setMemory((current) => (current ? { ...current, summary: next.summary } : current));
                        setEditing(false);
                      }, "Streszczenie zapisane.")
                    }
                  >
                    Zapisz streszczenie
                  </button>
                  <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => setEditing(false)}>
                    Anuluj
                  </button>
                </div>
              </>
            ) : (
              <>
                <pre className="case-memory-summary">{summary.text}</pre>
                {canWrite ? (
                  <button type="button" className="chat-secondary-action" onClick={() => setEditing(true)}>
                    Popraw streszczenie
                  </button>
                ) : null}
              </>
            )}
          </>
        ) : (
          <p className="field-help">Brak: cała rozmowa mieści się w oknie modelu.</p>
        )}

        <h3>Prace w sprawie</h3>
        {work.length ? (
          <>
            <p className="field-help">Kolejne odpowiedzi korzystają z wyników zamkniętych prac zamiast wykonywać je od nowa; otwarte dokańczają.</p>
            <ul className="case-memory-list">
              {work.map((item) => (
                <li key={item.key}>{item.line}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="field-help">Brak zapisanych prac.</p>
        )}

        <h3>Oś czasu sprawy</h3>
        {chronology ? (
          <>
            <p className="field-help">
              Z chronologii z {date(chronology.updatedAt)}; kolejne prace w tej sprawie (także w nowym wątku) dostają ją jako materiał. Nowa chronologia ją zastępuje.
            </p>
            <pre className="case-memory-summary">{chronology.text}</pre>
          </>
        ) : (
          <p className="field-help">Brak: zapisuje się po chronologii sprawy (oś czasu zdarzeń).</p>
        )}

        <h3>Przepisy ustalone wcześniej</h3>
        {provisions.length ? (
          <ul className="case-memory-list">
            {provisions.map((provision) => (
              <li key={provision.claim}>
                {provision.sourceUrl ? (
                  <a href={provision.sourceUrl} target="_blank" rel="noreferrer">
                    {provision.claim}
                  </a>
                ) : (
                  provision.claim
                )}{" "}
                — {provision.status}, t.j. {provision.consolidatedText ?? "—"}, pobrano {date(provision.fetchedAt)}
                {provision.freshnessCheckedAt ? `, aktualność sprawdzona ${date(provision.freshnessCheckedAt)}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-help">Brak.</p>
        )}
        {memory?.evidence?.skills.length ? (
          <p className="field-help">Skille użyte w sprawie: {memory.evidence.skills.join(", ")}</p>
        ) : null}

        {canWrite && (summary || provisions.length || chronology || work.length) ? (
          <button
            type="button"
            className="chat-secondary-action"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await clearCaseMemory(caseId);
                setMemory({ summary: null, evidence: null, chronology: null, work: [] });
                setDraft("");
              }, "Pamięć sprawy wyczyszczona.")
            }
          >
            Wyczyść pamięć sprawy
          </button>
        ) : null}
        {message ? <p className="field-help">{message}</p> : null}
      </details>
    </article>
  );
}
