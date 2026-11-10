import { t } from "./i18n";
import { useMemo, useState } from "react";
import { InfoTip } from "./InfoTip";
import { downloadBlob } from "./download-file.js";
import {
  parseTranscript,
  renameSpeaker,
  transcriptDocx,
  transcriptDuration,
  transcriptPageText,
  transcriptSpeakers,
  type TranscriptPage,
  type TranscriptTurn
} from "./transcript.js";

/**
 * A recording's transcript as a protocol: the speakers (renamed once for the whole transcript),
 * each utterance with its time, speaker and text to correct, saved back into the document's pages
 * and downloaded as a Word document.
 */
export function TranscriptEditor({
  pages,
  fileName,
  busy,
  onSave,
  onRetranscribe
}: {
  pages: ReadonlyArray<{ page: number; text: string }>;
  fileName: string;
  busy?: boolean;
  // Pages whose text changed, in the runtime's line form; resolves when they are saved.
  onSave: (changed: Array<{ page: number; text: string }>) => Promise<boolean>;
  // The recording transcribed again with this many speakers (0 = estimated by the models).
  onRetranscribe?: (speakers: number) => void;
}) {
  const original = useMemo(() => parseTranscript(pages), [pages]);
  const [draft, setDraft] = useState<TranscriptPage[]>(original);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [speakerCount, setSpeakerCount] = useState(0);
  const speakers = transcriptSpeakers(draft);
  const changed = draft
    .map((page) => ({ page: page.page, text: transcriptPageText(page.turns) }))
    .filter((page) => page.text !== (pages.find((item) => item.page === page.page)?.text ?? "").trim());

  function editTurn(page: number, index: number, patch: Partial<TranscriptTurn>) {
    setDraft((current) => current.map((item) => (item.page === page ? { ...item, turns: item.turns.map((turn, at) => (at === index ? { ...turn, ...patch } : turn)) } : item)));
  }

  function applyRename(from: string) {
    const to = renames[from] ?? "";
    setDraft((current) => renameSpeaker(current, from, to));
    setRenames(({ [from]: _done, ...rest }) => rest);
  }

  async function save() {
    if (!changed.length) return;
    setSaving(true);
    setMessage("");
    try {
      setMessage((await onSave(changed)) ? "Zapisano poprawki transkrypcji." : t("Nie udało się zapisać poprawek."));
    } finally {
      setSaving(false);
    }
  }

  async function download() {
    const bytes = transcriptDocx(draft, { fileName, madeAt: new Date(), duration: transcriptDuration(draft) });
    const name = `${fileName.replace(/\.[^.]+$/u, "") || "nagranie"} - transkrypcja.docx`;
    const saved = await downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), name);
    setMessage(saved ? `Zapisano: ${saved}` : `Pobrano: ${name}`);
  }

  const total = draft.reduce((sum, page) => sum + page.turns.length, 0);

  return (
    <section className="transcript-editor" aria-label={t("Transkrypcja nagrania")}>
      <header className="transcript-editor-head">
        <div>
          <p className="eyebrow">
            {t("Transkrypcja nagrania")}
            <InfoTip>
              {t("Tekst i rozmówców rozpoznano automatycznie na tym komputerze. Sprawdź je: popraw tekst wypowiedzi, nazwij rozmówców (np. „Sędzia”, „Świadek”) i zmień osobę przy wypowiedzi, jeśli została przypisana błędnie.")}
            </InfoTip>
          </p>
          <strong>{fileName}</strong>
          <small>
            {t("czas trwania")} {transcriptDuration(draft)} · {total} {t("wypowiedzi")}{speakers.length ? t(" · rozmówcy: {count}", { count: speakers.length }) : t(" · bez podziału na rozmówców")}
          </small>
        </div>
        <div className="case-court-actions">
          <button type="button" className="chat-secondary-action" disabled={busy || saving} onClick={() => void download()}>
            {t("Pobierz .docx")}
          </button>
          <button type="button" className="chat-primary-action" disabled={busy || saving || !changed.length} onClick={() => void save()}>
            {saving ? "Zapisywanie…" : changed.length ? `Zapisz poprawki (${changed.length} str.)` : t("Brak zmian")}
          </button>
        </div>
      </header>
      {onRetranscribe ? (
        <div className="transcript-retranscribe">
          <label>
            {t("Liczba rozmówców w nagraniu")}
            <InfoTip>
              {t("Podana liczba osób (np. sąd, strony, pełnomocnicy, świadek) daje dokładniejszy podział niż ocena automatyczna. Nagranie zostanie przetworzone ponownie; poprawki niezapisane przepadną.")}
            </InfoTip>
            <select value={speakerCount} onChange={(event) => setSpeakerCount(Number(event.target.value))}>
              <option value={0}>{t("automatycznie")}</option>
              {Array.from({ length: 11 }, (_, index) => index + 2).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="chat-secondary-action" disabled={busy || saving} onClick={() => onRetranscribe(speakerCount)}>
            {t("Rozpoznaj rozmówców ponownie")}
          </button>
        </div>
      ) : null}
      {speakers.length ? (
        <div className="transcript-speakers">
          {speakers.map((speaker) => (
            <label key={speaker}>
              <span>{speaker}</span>
              <input
                value={renames[speaker] ?? ""}
                maxLength={40}
                placeholder={t("Nazwa, np. Sędzia")}
                aria-label={t("Nowa nazwa dla: {speaker}", { speaker: speaker })}
                onChange={(event) => setRenames({ ...renames, [speaker]: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyRename(speaker);
                  }
                }}
              />
              <button type="button" className="chat-secondary-action" disabled={!(renames[speaker] ?? "").trim()} onClick={() => applyRename(speaker)}>
                {t("Zmień w całej transkrypcji")}
              </button>
            </label>
          ))}
        </div>
      ) : null}
      <ol className="transcript-turns">
        {draft.flatMap((page) =>
          page.turns.map((turn, index) => (
            <li key={`${page.page}:${index}`} className="transcript-turn">
              <span className="transcript-time">{turn.time.replace(/[[\]]/gu, "")}</span>
              {speakers.length ? (
                <select aria-label={`Osoba wypowiedzi ${turn.time}`} value={turn.speaker} onChange={(event) => editTurn(page.page, index, { speaker: event.target.value })}>
                  {speakers.map((speaker) => (
                    <option key={speaker} value={speaker}>
                      {speaker}
                    </option>
                  ))}
                </select>
              ) : null}
              <textarea
                aria-label={t("Wypowiedź {time}", { time: turn.time })}
                value={turn.text}
                rows={Math.min(6, Math.max(1, Math.ceil(turn.text.length / 90)))}
                onChange={(event) => editTurn(page.page, index, { text: event.target.value })}
              />
            </li>
          ))
        )}
      </ol>
      {message ? <p className="field-help">{message}</p> : null}
    </section>
  );
}
