import {
  useEffect,
  useMemo,
  useState
} from "react";
import {
  acceptProcessPleadingWorkflowStart,
  confirmProcessPleadingCheckpoint,
  getProcessPleadingDraft,
  getProcessPleadingWorkflow,
  initializeProcessPleadingWorkflow,
  resetCaseWorkflow,
  reviseProcessPleadingCheckpoint,
  saveProcessPleadingDraft,
  type ProcessPleadingDraftView,
  type ProcessPleadingCheckpoint,
  type ProcessPleadingWorkflowState
} from "./api.js";
import "./process-workflow.css";

const CHECKPOINT_ORDER: readonly ProcessPleadingCheckpoint[] = [
  "CP-1a",
  "CP-1b",
  "CP-1c-skan",
  "CP-PD",
  "CP-FSL-D",
  "CP-1c-macierz",
  "CP-1c-lancuch",
  "CP-1d-anomalie",
  "CP-1d",
  "CP-W1",
  "CP-PRE-W2",
  "CP-ATAK",
  "CP-PODMIOT",
  "CP-QUALITY",
  "CP-AUDYT",
  "CP-PEER"
];

const STAGE_LABELS: Record<
  ProcessPleadingWorkflowState["stage"],
  string
> = {
  CG_ACCEPTANCE: "Akceptacja startu",
  W1: "W1 · rama i strategia",
  PRE_W2: "PRE-W2 · weryfikacja",
  W2: "W2 · projekt i red-team",
  W3: "W3 · walidacja końcowa",
  FINAL: "FINAL"
};

function checkpointStats(
  state: ProcessPleadingWorkflowState
) {
  let closed = 0;
  let na = 0;
  let open = 0;
  for (const checkpoint of CHECKPOINT_ORDER) {
    const status =
      state.checkpoints[checkpoint];
    if (status === "CLOSED") closed += 1;
    else if (status === "NA") na += 1;
    else open += 1;
  }
  return { closed, na, open };
}

export function ProcessPleadingWorkflowPanel({
  caseId,
  forceVisible,
  refreshToken,
  canWrite,
  busy,
  onContinue,
  onDownloadDraft
}: {
  caseId: string;
  forceVisible: boolean;
  refreshToken: number;
  canWrite: boolean;
  busy: boolean;
  onContinue: () => void;
  // A .docx of the stored pleading (marked PROJEKT – NIE SKŁADAĆ until FINAL).
  onDownloadDraft?: () => void;
}) {
  const [state, setState] =
    useState<ProcessPleadingWorkflowState | null>(null);
  const [draft, setDraft] = useState<ProcessPleadingDraftView>(null);
  // Editing the pleading: the user's version and whether it changes facts or legal basis.
  const [editText, setEditText] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const [loading, setLoading] = useState(false);
  const [operation, setOperation] = useState(false);
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    if (!caseId) {
      setState(null);
      return;
    }
    setLoading(true);
    try {
      const result =
        await getProcessPleadingWorkflow(caseId);
      setState(result.state);
      setDraft(result.state ? (await getProcessPleadingDraft(caseId).catch(() => ({ draft: null }))).draft : null);
      setError("");
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : String(problem)
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [caseId, refreshToken]);

  const stats = useMemo(
    () => state
      ? checkpointStats(state)
      : null,
    [state]
  );

  if (!caseId) return null;
  if (!forceVisible && !state && !loading) {
    return null;
  }

  async function run(
    operationFn: () => Promise<{
      state: ProcessPleadingWorkflowState;
    }>
  ): Promise<void> {
    if (operation || !canWrite) return;
    setOperation(true);
    setError("");
    try {
      const result =
        await operationFn();
      setState(result.state);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : String(problem)
      );
    } finally {
      setOperation(false);
    }
  }

  const locked =
    operation ||
    busy ||
    !canWrite;

  async function saveEdit(change: "MINOR" | "SUBSTANTIVE"): Promise<void> {
    if (editText === null) return;
    await run(async () => {
      const result = await saveProcessPleadingDraft(caseId, {
        text: editText,
        change,
        expectedRevision: draft?.revision ?? 0
      });
      setDraft(result.draft);
      setEditText(null);
      return result;
    });
  }

  async function sendBack(): Promise<void> {
    if (!state?.pendingCheckpoint || !remarks?.trim()) return;
    const checkpoint = state.pendingCheckpoint;
    await run(async () => {
      const result = await reviseProcessPleadingCheckpoint(caseId, checkpoint, remarks);
      setRemarks(null);
      return result;
    });
    await refresh();
  }

  async function restart(): Promise<void> {
    if (operation || !canWrite) return;
    if (!window.confirm("Rozpocząć nowe pismo? Bieżący pipeline i zapisany projekt zostaną usunięte (historia czatu zostaje).")) return;
    setOperation(true);
    try {
      await resetCaseWorkflow(caseId, { kind: "process-pleading" });
      setState(null);
      setDraft(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setOperation(false);
    }
  }

  const latest = draft?.latest ?? null;
  const draftSection = state && state.stage !== "CG_ACCEPTANCE" ? (
    <div className="process-workflow-draft">
      <div className="process-workflow-draft-head">
        <strong>Projekt pisma</strong>
        <span>
          {latest
            ? `wersja ${latest.version} · ${latest.source === "USER" ? "Twoja poprawka" : `pipeline, etap ${latest.stage}`}`
            : "jeszcze nie powstał (pojawi się po W2)"}
        </span>
      </div>
      {latest && editText === null ? (
        <div className="process-workflow-actions">
          <button type="button" onClick={() => setShowDraft((value) => !value)}>
            {showDraft ? "Ukryj tekst" : "Pokaż tekst"}
          </button>
          <button type="button" disabled={locked} onClick={() => setEditText(latest.text)}>
            Edytuj projekt
          </button>
          {onDownloadDraft ? (
            <button type="button" disabled={locked} onClick={onDownloadDraft}>
              {state.documentStatus === "FINAL" ? "Pobierz pismo (.docx)" : "Pobierz szkic (.docx)"}
            </button>
          ) : null}
        </div>
      ) : null}
      {latest && showDraft && editText === null ? <pre className="process-workflow-draft-text">{latest.text}</pre> : null}
      {editText !== null ? (
        <>
          <textarea
            className="process-workflow-draft-edit"
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            aria-label="Edycja projektu pisma"
          />
          <div className="process-workflow-actions">
            <button type="button" disabled={locked || !editText.trim()} onClick={() => void saveEdit("MINOR")} title="literówki, styl, układ — zamknięte kontrole zostają">
              Zapisz: drobna poprawka
            </button>
            <button type="button" disabled={locked || !editText.trim()} onClick={() => void saveEdit("SUBSTANTIVE")} title="fakty, żądania, podstawa prawna — atak na projekt i kontrole W3 od nowa">
              Zapisz: zmiana merytoryczna
            </button>
            <button type="button" disabled={operation} onClick={() => setEditText(null)}>
              Anuluj
            </button>
          </div>
          <small>
            Zmiana merytoryczna (fakty, żądania, podstawa prawna) cofa pismo do W2: atak na projekt i kontrole W3
            zostaną wykonane ponownie, status wraca do DRAFT. Drobna poprawka zachowuje zamknięte kontrole.
          </small>
        </>
      ) : null}
      {draft && draft.versions.length > 1 ? (
        <details>
          <summary>Historia wersji ({draft.versions.length})</summary>
          <ul className="process-workflow-versions">
            {draft.versions
              .slice()
              .reverse()
              .map((item) => (
                <li key={item.version}>
                  {`v${item.version} · ${item.source === "USER" ? `użytkownik${item.change === "SUBSTANTIVE" ? " (merytoryczna)" : " (drobna)"}` : `pipeline ${item.checkpoint ?? item.stage}`} · ${new Date(item.createdAt).toLocaleString("pl-PL")}`}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  ) : null;

  return (
    <section className="process-workflow-panel">
      <div className="process-workflow-heading">
        <div>
          <p className="eyebrow">
            Deterministyczny pipeline pisma
          </p>
          <h3>
            {state
              ? STAGE_LABELS[state.stage]
              : "Pisma procesowe v3"}
          </h3>
        </div>
        <span
          className={
            state?.documentStatus === "FINAL"
              ? "process-workflow-status final"
              : "process-workflow-status"
          }
        >
          {state?.documentStatus ?? "NIEAKTYWNY"}
        </span>
      </div>

      {!state ? (
        <>
          <p>
            To zadanie wymaga wieloturowego pipeline W1 → PRE-W2 → W2 → W3.
            Runtime zapisuje checkpointy w zaszyfrowanym stanie tej sprawy i
            nie pozwala przejść dalej bez wymaganych potwierdzeń.
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() =>
              void run(() =>
                initializeProcessPleadingWorkflow(
                  caseId,
                  "CHECKPOINT"
                )
              )
            }
          >
            Uruchom pipeline w trybie checkpoint
          </button>
        </>
      ) : state.stage === "CG_ACCEPTANCE" ? (
        <>
          <p>
            Pipeline ma wiele etapów kontroli jakości. Dokument pozostaje
            DRAFT, dopóki cały wymagany rejestr CP nie zostanie rozwiązany.
            Każde przejście jest zapisywane w zaszyfrowanym workspace sprawy.
          </p>
          <button
            type="button"
            disabled={locked}
            onClick={() =>
              void run(() =>
                acceptProcessPleadingWorkflowStart(
                  caseId
                )
              )
            }
          >
            Akceptuję warunki i rozpoczynam W1
          </button>
        </>
      ) : (
        <>
          <div className="process-workflow-stats">
            <span>
              Zamknięte: {stats?.closed ?? 0}
            </span>
            <span>
              N/A: {stats?.na ?? 0}
            </span>
            <span>
              Otwarte / oczekujące: {stats?.open ?? 0}
            </span>
            <span>
              Rewizja: {state.revision}
            </span>
          </div>

          {state.pendingCheckpoint ? (
            <div className="process-workflow-checkpoint">
              <strong>
                Oczekuje na potwierdzenie: {state.pendingCheckpoint}
              </strong>
              <p>
                Runtime nie uruchomi następnego checkpointu, dopóki nie
                potwierdzisz wyniku bieżącego kroku.
              </p>
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  void run(() =>
                    confirmProcessPleadingCheckpoint(
                      caseId,
                      state.pendingCheckpoint!
                    )
                  )
                }
              >
                Potwierdź checkpoint i odblokuj kolejny krok
              </button>
              {remarks === null ? (
                <button type="button" disabled={locked} onClick={() => setRemarks("")}>
                  Popraw z uwagami
                </button>
              ) : (
                <>
                  <textarea
                    className="process-workflow-remarks"
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                    placeholder="Co poprawić w tym kroku (np. dodaj zarzut przedawnienia, zmień kwotę żądania)"
                    aria-label="Uwagi do kroku"
                  />
                  <div className="process-workflow-actions">
                    <button type="button" disabled={locked || !remarks.trim()} onClick={() => void sendBack()}>
                      Odeślij krok do poprawy
                    </button>
                    <button type="button" disabled={operation} onClick={() => setRemarks(null)}>
                      Anuluj
                    </button>
                  </div>
                  <small>Krok wróci do wykonania z Twoimi uwagami po kliknięciu „Kontynuuj pipeline”.</small>
                </>
              )}
            </div>
          ) : state.stage === "FINAL" ? (
            <div>
              <p className="process-workflow-final">
                Wszystkie wymagane checkpointy są rozwiązane. Status procesu: FINAL.
                Poprawki: „Edytuj projekt” — drobna zostawia FINAL, merytoryczna cofa do W2.
              </p>
              <button type="button" disabled={locked} onClick={() => void restart()}>
                Nowe pismo w tej sprawie
              </button>
            </div>
          ) : (
            <div className="process-workflow-checkpoint">
              <strong>
                Etap gotowy do następnego checkpointu
              </strong>
              <p>
                Kolejne wykonanie zostanie związane przez runtime z pierwszym
                nierozwiązanym CP w kanonicznej kolejności. Model nie może
                przeskoczyć do późniejszego etapu.
              </p>
              <button
                type="button"
                disabled={locked}
                onClick={onContinue}
              >
                Kontynuuj pipeline
              </button>
            </div>
          )}
        </>
      )}

      {draftSection}

      {!canWrite ? (
        <small>
          Sprawa jest tylko do odczytu albo Twoja rola nie pozwala zmieniać
          stanu pipeline.
        </small>
      ) : null}
      {loading ? (
        <small>Odświeżam stan procesu…</small>
      ) : null}
      {error ? (
        <p className="process-workflow-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
