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
import { InfoTip } from "./InfoTip";
import { checkpointLabel, plainErrorMessage, useDeveloperMode } from "./developer-mode.js";
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

// The same stages for a lawyer (developer mode off): no stage codes.
const PLAIN_STAGE_LABELS: Record<
  ProcessPleadingWorkflowState["stage"],
  string
> = {
  CG_ACCEPTANCE: "Akceptacja startu",
  W1: "Etap 1 · rama i strategia",
  PRE_W2: "Etap 2 · weryfikacja",
  W2: "Etap 3 · projekt i przegląd krytyczny",
  W3: "Etap 4 · kontrola końcowa",
  FINAL: "Pismo gotowe"
};

const PLAIN_DOCUMENT_STATUS: Record<string, string> = {
  DRAFT: "projekt",
  FINAL: "gotowe"
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
  const developer = useDeveloperMode();
  const stageLabels = developer ? STAGE_LABELS : PLAIN_STAGE_LABELS;
  const shownError = error && !developer ? plainErrorMessage(error, error) : error;

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
            ? `wersja ${latest.version} · ${latest.source === "USER" ? "Twoja poprawka" : developer ? `pipeline, etap ${latest.stage}` : "przygotowana przez aplikację"}`
            : developer ? "jeszcze nie powstał (pojawi się po W2)" : "jeszcze nie powstał (pojawi się w etapie projektu)"}
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
            {developer ? "Zmiana merytoryczna cofa pismo do W2 i statusu DRAFT." : "Zmiana merytoryczna cofa pismo do etapu projektu."}
            <InfoTip>
              Merytoryczna (fakty, żądania, podstawa prawna): atak na projekt i kontrole W3 od nowa. Drobna zachowuje
              zamknięte kontrole.
            </InfoTip>
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
                  {`v${item.version} · ${item.source === "USER" ? `użytkownik${item.change === "SUBSTANTIVE" ? " (merytoryczna)" : " (drobna)"}` : developer ? `pipeline ${item.checkpoint ?? item.stage}` : "aplikacja"} · ${new Date(item.createdAt).toLocaleString("pl-PL")}`}
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
            {developer ? "Deterministyczny pipeline pisma" : "Pismo procesowe"}
          </p>
          <h3>
            {state
              ? stageLabels[state.stage]
              : developer ? "Pisma procesowe v3" : "Pismo procesowe etapami"}
          </h3>
        </div>
        <span
          className={
            state?.documentStatus === "FINAL"
              ? "process-workflow-status final"
              : "process-workflow-status"
          }
        >
          {developer
            ? (state?.documentStatus ?? "NIEAKTYWNY")
            : state?.documentStatus
              ? (PLAIN_DOCUMENT_STATUS[state.documentStatus] ?? "projekt")
              : "nieaktywne"}
        </span>
      </div>

      {!state ? (
        <>
          <p>
            {developer ? "Pipeline W1 → PRE-W2 → W2 → W3." : "Pismo powstaje w czterech etapach: rama, weryfikacja, projekt, kontrola końcowa."}
            <InfoTip>
              {developer
                ? "Checkpointy zapisują się w zaszyfrowanym stanie sprawy; bez wymaganych potwierdzeń nie da się przejść dalej."
                : "Postęp zapisuje się w zaszyfrowanej sprawie; bez Twoich potwierdzeń pismo nie przejdzie dalej."}
            </InfoTip>
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
            {developer ? "Uruchom pipeline w trybie checkpoint" : "Rozpocznij pismo z potwierdzaniem etapów"}
          </button>
        </>
      ) : state.stage === "CG_ACCEPTANCE" ? (
        <>
          <p>
            {developer
              ? "Dokument pozostaje DRAFT, dopóki cały wymagany rejestr CP nie zostanie rozwiązany."
              : "Pismo pozostaje projektem, dopóki wszystkie wymagane etapy nie zostaną zakończone."}
            <InfoTip>
              {developer
                ? "Pipeline ma wiele etapów kontroli jakości; każde przejście jest zapisywane w zaszyfrowanym workspace sprawy."
                : "Pismo przechodzi kilka kontroli jakości; postęp zapisuje się w zaszyfrowanej sprawie."}
            </InfoTip>
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
            {developer ? "Akceptuję warunki i rozpoczynam W1" : "Akceptuję warunki i rozpoczynam"}
          </button>
        </>
      ) : (
        <>
          <div className="process-workflow-stats">
            <span>
              {developer ? "Zamknięte" : "Zakończone kroki"}: {stats?.closed ?? 0}
            </span>
            <span>
              {developer ? "N/A" : "Pominięte"}: {stats?.na ?? 0}
            </span>
            <span>
              {developer ? "Otwarte / oczekujące" : "Pozostało"}: {stats?.open ?? 0}
            </span>
            {developer ? (
              <span>
                Rewizja: {state.revision}
              </span>
            ) : null}
          </div>

          {state.pendingCheckpoint ? (
            <div className="process-workflow-checkpoint">
              <strong>
                Oczekuje na potwierdzenie: {developer ? state.pendingCheckpoint : checkpointLabel(state.pendingCheckpoint)}
              </strong>
              <InfoTip>
                {developer
                  ? "Następny checkpoint ruszy dopiero po potwierdzeniu wyniku tego kroku."
                  : "Następny krok ruszy dopiero po potwierdzeniu wyniku tego kroku."}
              </InfoTip>
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
                {developer ? "Potwierdź checkpoint i odblokuj kolejny krok" : "Potwierdź i przejdź do kolejnego kroku"}
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
                  <small>Krok wróci do wykonania z Twoimi uwagami po kliknięciu „{developer ? "Kontynuuj pipeline" : "Kontynuuj"}”.</small>
                </>
              )}
            </div>
          ) : state.stage === "FINAL" ? (
            <div>
              <p className="process-workflow-final">
                {developer
                  ? "Wszystkie wymagane checkpointy są rozwiązane. Status procesu: FINAL."
                  : "Wszystkie wymagane etapy są zakończone. Pismo jest gotowe."}
                <InfoTip>Poprawki przez „Edytuj projekt”: drobna zostawia FINAL, merytoryczna cofa do W2.</InfoTip>
              </p>
              <button type="button" disabled={locked} onClick={() => void restart()}>
                Nowe pismo w tej sprawie
              </button>
            </div>
          ) : (
            <div className="process-workflow-checkpoint">
              <strong>
                {developer ? "Etap gotowy do następnego checkpointu" : "Etap gotowy do kolejnego kroku"}
              </strong>
              <InfoTip>
                {developer
                  ? "Kolejny krok dotyczy pierwszego nierozwiązanego CP; model nie przeskoczy do późniejszego etapu."
                  : "Kroki idą po kolei; aplikacja nie przeskoczy do późniejszego etapu."}
              </InfoTip>
              <button
                type="button"
                disabled={locked}
                onClick={onContinue}
              >
                {developer ? "Kontynuuj pipeline" : "Kontynuuj"}
              </button>
            </div>
          )}
        </>
      )}

      {draftSection}

      {!canWrite ? (
        <small>
          {developer
            ? "Tylko odczyt: sprawa lub Twoja rola nie pozwala zmieniać pipeline."
            : "Tylko odczyt: sprawa lub Twoja rola nie pozwala zmieniać pisma."}
        </small>
      ) : null}
      {loading ? (
        <small>{developer ? "Odświeżam stan procesu…" : "Odświeżam stan pisma…"}</small>
      ) : null}
      {error ? (
        <p className="process-workflow-error">
          {shownError}
        </p>
      ) : null}
    </section>
  );
}
