import { useEffect, useState } from "react";
import { ApiError, buildLegiIndex, getLegiIndex, type LegiIndexStatus } from "./api.js";
import { InfoTip } from "./InfoTip";

/** French codes without a PISTE key: the local index of DILA's LEGI open-data dump. */
export function LegiIndexSection() {
  const [status, setStatus] = useState<LegiIndexStatus | null>(null);
  const [error, setError] = useState("");

  const refresh = () =>
    getLegiIndex()
      .then(setStatus)
      .catch((failure) => setError(failure instanceof ApiError ? failure.code : String(failure)));

  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (status?.build?.state !== "BUILDING") return;
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [status?.build?.state]);

  async function start(): Promise<void> {
    try {
      setStatus(await buildLegiIndex());
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    }
  }

  const building = status?.build?.state === "BUILDING";
  return (
    <section className="core-law-updates">
      <div className="maintenance-heading">
        <div>
          <strong>
            Prawo francuskie (LEGI)
            <InfoTip>
              Kodeksy francuskie bez klucza API: zrzut LEGI z otwartych danych DILA (około 1,2 GB) pobierany raz i
              indeksowany lokalnie. Tekst skonsolidowany nie ma mocy urzędowej; moc ma Journal officiel.
            </InfoTip>
          </strong>
        </div>
        <span>{status?.built ? `indeks z ${String(status.built.built).slice(0, 10)}: ${status.built.codes} kodeksów` : "brak indeksu"}</span>
      </div>
      <button type="button" disabled={building || !status} onClick={() => void start()}>
        {building ? `Indeksowanie… (${status?.build?.files ?? 0} plików)` : status?.built ? "Odśwież indeks LEGI" : "Zbuduj indeks LEGI"}
      </button>
      {status?.build?.state === "FAILED" ? <p className="field-error">Indeksowanie nie powiodło się: {status.build.error}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}
