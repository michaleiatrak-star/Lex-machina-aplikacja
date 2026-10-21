import { InfoTip } from "./InfoTip";
import { MarkdownContent } from "./MarkdownContent.js";
import { useDeveloperMode } from "./developer-mode.js";
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
  refreshToken,
  onRequestOverview
}: {
  caseId: string;
  canWrite: boolean;
  refreshToken: unknown;
  // Sends the summary request to the chat (the answer is kept here).
  onRequestOverview?: () => void;
}) {
  const [memory, setMemory] = useState<CaseMemory | null>(null);
  const developer = useDeveloperMode();
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
  const overview = memory?.overview ?? null;
  // "## SECTION" parts of the summary: each one a collapsible entry of its table of contents.
  const overviewSections = overview ? overviewParts(overview.text) : [];
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
          <span className="eyebrow">Pamięć sprawy</span>
          <InfoTip>
            Kolejne odpowiedzi w sprawie zaczynają od tych ustaleń. Przepis jest użyty bez ponownej weryfikacji tylko, gdy w Sejm ELI nie ma nowszego tekstu jednolitego ani nowelizacji.
          </InfoTip>{" "}
          {provisions.length ? `${provisions.length} przepisów` : "bez przepisów"}
          {summary ? `, streszczenie ${summary.coveredMessages} wiadomości` : ""}
          {overview ? ", podsumowanie" : ""}
          {chronology ? ", oś czasu" : ""}
          {work.length ? `, prace: ${work.filter((item) => item.status === "DONE").length} zamkniętych, ${work.filter((item) => item.status === "OPEN").length} otwartych` : ""}
        </summary>
        <h3>
          Podsumowanie sprawy
          <InfoTip>
            Metryka, dokumenty, podmioty, oś czasu, kwoty, fakty kluczowe, spory i braki z dokumentów sprawy. Kolejne odpowiedzi
            zaczynają od niego; nowe podsumowanie zastępuje poprzednie.
          </InfoTip>
        </h3>
        {overview ? (
          <>
            <p className="field-help">Stan z {date(overview.updatedAt)}.</p>
            <div className="case-overview">
              {overviewSections.map((part, index) => (
                <details key={`${index}-${part.title}`} open={index === 0}>
                  <summary>{part.title}</summary>
                  <MarkdownContent content={part.body} renderText={(text) => text} />
                </details>
              ))}
            </div>
          </>
        ) : (
          <p className="field-help">Brak. Utwórz je z dokumentów sprawy.</p>
        )}
        {canWrite && onRequestOverview ? (
          <button type="button" className="chat-secondary-action" disabled={busy} onClick={onRequestOverview}>
            {overview ? "Odśwież podsumowanie sprawy" : "Utwórz podsumowanie sprawy"}
          </button>
        ) : null}

        <h3>
          Streszczenie wcześniejszej części rozmowy
          <InfoTip>Zastępuje najstarsze wiadomości, które nie mieszczą się w oknie modelu.</InfoTip>
        </h3>
        {summary ? (
          <>
            <p className="field-help">
              {summary.coveredMessages} wiadomości, stan z {date(summary.updatedAt)}
              {summary.editedByUser ? ", poprawione ręcznie" : ""}.
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

        <h3>
          Prace w sprawie
          <InfoTip>Kolejne odpowiedzi korzystają z wyników zamkniętych prac zamiast wykonywać je od nowa; otwarte dokańczają.</InfoTip>
        </h3>
        {work.length ? (
          <ul className="case-memory-list">
            {work.map((item) => (
              <li key={item.key}>{item.line}</li>
            ))}
          </ul>
        ) : (
          <p className="field-help">Brak zapisanych prac.</p>
        )}

        <h3>
          Oś czasu sprawy
          <InfoTip>Zapisuje się po chronologii sprawy. Kolejne prace (także w nowym wątku) dostają ją jako materiał; nowa chronologia ją zastępuje.</InfoTip>
        </h3>
        {chronology ? (
          <>
            <p className="field-help">
              Z chronologii z {date(chronology.updatedAt)}.
            </p>
            <pre className="case-memory-summary">{chronology.text}</pre>
          </>
        ) : (
          <p className="field-help">Brak.</p>
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
        {developer && memory?.evidence?.skills.length ? (
          <p className="field-help">Skille użyte w sprawie: {memory.evidence.skills.join(", ")}</p>
        ) : null}

        {canWrite && (summary || provisions.length || chronology || overview || work.length) ? (
          <button
            type="button"
            className="chat-secondary-action"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await clearCaseMemory(caseId);
                setMemory({ summary: null, evidence: null, chronology: null, overview: null, work: [] });
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

/** The summary split at its "## " headings (text before the first one goes under "Podsumowanie"). */
export function overviewParts(text: string): Array<{ title: string; body: string }> {
  const parts: Array<{ title: string; body: string }> = [];
  let current = { title: "Podsumowanie", body: "" };
  for (const line of text.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    if (heading) {
      if (current.body.trim()) parts.push({ ...current, body: current.body.trim() });
      current = { title: heading[1]!.replace(/\s+—.*$/u, ""), body: "" };
    } else if (!/^#\s+/u.test(line)) {
      current.body += `${line}\n`;
    }
  }
  if (current.body.trim()) parts.push({ ...current, body: current.body.trim() });
  return parts;
}
