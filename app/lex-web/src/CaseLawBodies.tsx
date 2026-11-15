import { useEffect, useId, useState } from "react";
import { t } from "./i18n";
import {
  getCaseLawServerDocuments,
  runCaseLawSource,
  type CaseLawBody,
  type CaseLawServerDocument,
  type CaseLawServerStatus
} from "./api.js";

/**
 * The chambers of one source in the database window (user, 2026-11-15: no chamber to choose):
 * every chamber with its count, the ones that do not publish with the reason, the chosen chamber's
 * rulings held on the server (50 a page) and its own "Pobierz teraz".
 */
export function CaseLawBodies(props: {
  title: string;
  source: string;
  bodies: CaseLawBody[];
  active: boolean;
  onServer: (server: CaseLawServerStatus) => void;
  onError: (message: string) => void;
}) {
  const { title, source, bodies, active, onServer, onError } = props;
  const [chosen, setChosen] = useState("");
  const [items, setItems] = useState<CaseLawServerDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const selectId = useId();
  const body = bodies.find((item) => item.body === chosen) ?? null;
  const publishing = bodies.filter((item) => !item.notPublished);
  const silent = bodies.filter((item) => item.notPublished);

  useEffect(() => {
    setItems([]);
    setTotal(0);
    if (!chosen) return;
    let live = true;
    setBusy(true);
    getCaseLawServerDocuments(source, chosen)
      .then((page) => {
        if (!live) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((failure: unknown) => onError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [chosen, source, onError]);

  async function more(): Promise<void> {
    setBusy(true);
    try {
      const page = await getCaseLawServerDocuments(source, chosen, items.length);
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  // The chamber's place only ("w Gdańsku"): the group's heading names the court; the full name
  // stands under the list once chosen.
  const place = (body: string) => body.replace(/^(?:Sąd Dyscyplinarny Izby Adwokackiej|Okręgowy Sąd Dyscyplinarny OIRP)\s+/u, "");
  const label = (item: CaseLawBody) =>
    item.notPublished ? `${place(item.body)} — ${t("nie publikuje")}` : `${place(item.body)} (${item.documents})`;
  const byPlace = (a: CaseLawBody, b: CaseLawBody) => place(a.body).replace(/^we? /u, "").localeCompare(place(b.body).replace(/^we? /u, ""), "pl");

  return (
    <div className="case-law-bodies">
      <label htmlFor={selectId}>
        {title}
        {silent.length ? ` (${t("publikuje {published} z {count}", { published: publishing.length, count: bodies.length })})` : ""}
      </label>
      <select id={selectId} value={chosen} onChange={(event) => setChosen(event.target.value)}>
        <option value="">{t("Wybierz ({count})", { count: bodies.length })}</option>
        <optgroup label={t("Publikują orzeczenia ({count})", { count: publishing.length })}>
          {[...publishing].sort(byPlace).map((item) => (
            <option key={item.body} value={item.body}>
              {label(item)}
            </option>
          ))}
        </optgroup>
        {silent.length ? (
          <optgroup label={t("Nie publikują orzeczeń ({count})", { count: silent.length })}>
            {[...silent].sort(byPlace).map((item) => (
              <option key={item.body} value={item.body}>
                {label(item)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      {body ? (
        <div className="case-law-body">
          <p className="field-help">
            <strong>{body.body}</strong>
          </p>
          {body.notPublished ? <p className="field-help">{body.notPublished}</p> : null}
          {body.run && active ? (
            <button
              type="button"
              className="case-access-link case-law-session-button"
              disabled={Boolean(body.running)}
              onClick={() => {
                void runCaseLawSource(body.run!)
                  .then((reply) => onServer(reply.server))
                  .catch((failure: unknown) => onError(failure instanceof Error ? failure.message : String(failure)));
              }}
            >
              {body.running ? t("pobieranie trwa") : t("Pobierz teraz")}
            </button>
          ) : null}
          {total ? (
            <>
              <p className="field-help">{t("Orzeczeń w bazie serwera: {count}", { count: total })}</p>
              <ul className="case-law-body-list">
                {items.map((item) => (
                  <li key={item.id}>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.signatures[0] ?? item.id}
                      </a>
                    ) : (
                      (item.signatures[0] ?? item.id)
                    )}
                    {item.kind ? ` · ${item.kind}` : ""}
                    {item.date ? ` · ${item.date}` : ""}
                  </li>
                ))}
              </ul>
              {items.length < total ? (
                <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void more()}>
                  {t("Pokaż kolejne ({count})", { count: Math.min(50, total - items.length) })}
                </button>
              ) : null}
            </>
          ) : busy ? (
            <p className="field-help">{t("Wczytywanie…")}</p>
          ) : body.notPublished ? null : (
            <p className="field-help">{t("Brak orzeczeń tej izby w bazie serwera.")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
