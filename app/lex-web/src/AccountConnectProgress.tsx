import type { AccountClientProvisionProgress } from "./api.js";

export type AccountConnectPhase =
  | { kind: "provision"; progress: AccountClientProvisionProgress }
  | { kind: "login" }
  | { kind: "done" }
  | { kind: "failed"; message: string };

const STEPS = [
  "Sprawdzanie klienta",
  "Pobieranie klienta (npm)",
  "Sprawdzanie pobranego klienta",
  "Logowanie w oknie dostawcy"
] as const;

function stepIndex(phase: AccountConnectPhase): number {
  if (phase.kind === "login") return 3;
  if (phase.kind === "done") return 4;
  if (phase.kind === "failed") return -1;
  switch (phase.progress.stage) {
    case "DOWNLOADING":
      return 1;
    case "VERIFYING":
    case "READY":
      return 2;
    default:
      return 0;
  }
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",");
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Stage bar for connecting an account: npm does not report the total download
// size up front, so the bar advances by stage and the live counters (packages,
// MB on disk, time) show that the download is moving.
export function AccountConnectProgress(props: {
  phase: AccountConnectPhase | null;
  clientLabel: string;
}) {
  const { phase } = props;
  if (!phase) return null;
  if (phase.kind === "failed") {
    return (
      <p className="chat-inline-error" role="alert">
        {phase.message}
      </p>
    );
  }
  const current = stepIndex(phase);
  const progress = phase.kind === "provision" ? phase.progress : null;
  return (
    <div className="account-connect-progress" aria-live="polite">
      <progress max={STEPS.length} value={Math.min(current + (phase.kind === "done" ? 0 : 0.5), STEPS.length)} />
      <ol>
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={index < current ? "done" : index === current ? "current" : undefined}
          >
            {index === 1 ? `Pobieranie: ${props.clientLabel}` : label}
            {index === 1 && index === current && progress ? (
              <small>
                {" "}
                · pakiety: {progress.packagesFetched} · {megabytes(progress.bytesOnDisk)} MB ·{" "}
                {clock(progress.elapsedMs)}
              </small>
            ) : null}
          </li>
        ))}
      </ol>
      {phase.kind === "provision" && current <= 1 ? (
        <small>Jednorazowo, zwykle 1–5 minut. Okno logowania otworzy się po pobraniu.</small>
      ) : phase.kind === "login" ? (
        <small>
          Dokończ logowanie w otwartym oknie lub przeglądarce. Gemini CLI: po zalogowaniu wpisz /quit.
        </small>
      ) : phase.kind === "done" ? (
        <small>Konto połączone.</small>
      ) : null}
    </div>
  );
}
